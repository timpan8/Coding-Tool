import type { Binding, BlocklistEntry } from '../../types/models';
import { freeName } from '../bindings';
import { buildValueIndex } from '../render/leak';

export interface BlocklistMatch {
  entry: BlocklistEntry;
  /** The text exactly as it stood, which is not always the term: matching ignores case, and Local
   * has to give back the file the user pasted, character for character. Two casings of one term are
   * therefore two values and two bindings. */
  matched: string;
  name: string;
  /** True when a binding already held this value and its placeholder was reused. */
  existing: boolean;
  count: number;
}
export interface BlocklistResult {
  text: string;
  matches: BlocklistMatch[];
  replacements: number;
}

const PLACEHOLDER = /(\{\{[A-Z][A-Z0-9_]*\}\})/g;
const escapeLiteral = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** A word boundary only where the term has a word character to be bounded by. `\banna\b` must not
 * match `annandag`, but `\b.internal\b` would refuse to match after a space, because there is no
 * boundary between two non-word characters. */
function pattern(term: string): RegExp {
  const left = /^\w/.test(term) ? String.raw`\b` : '';
  const right = /\w$/.test(term) ? String.raw`\b` : '';
  return new RegExp(`${left}${escapeLiteral(term)}${right}`, 'gi');
}

/** `mittforetag.se` becomes MITTFORETAG_SE. Derived from the term rather than the surrounding line,
 * so the same term gets the same name wherever it turns up. */
export function nameForTerm(term: string): string {
  const base = term.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const named = /^[A-Z]/.test(base) ? base : `TERM_${base}`;
  return (named.length > 1 ? named : `${named}_VARDE`).slice(0, 64);
}

/** Turns the terms the user has decided may never reach an AI into placeholders, and says which
 * bindings the caller has to create for them.
 *
 * Pure: it neither reads nor writes the vault, and it does not build the bindings itself, because
 * the category and the AI value are decided the same way `createBinding` decides them. Substitution
 * here is the same act as binding a selection by hand, which is why the rest of the app — escaping,
 * the leak check, `ingest`, the coverage count — needs to know nothing about the blocklist.
 *
 * Longest term first, so a term contained in a longer one does not claim the match. Existing
 * placeholders are stepped over: a term inside `{{NAME}}` is part of the placeholder, not the code.
 *
 * Reuse is limited to bindings that resolve in this scope. Borrowing the name of a binding in
 * another project would write a placeholder that resolves to nothing here. */
export function applyBlocklist(
  text: string,
  entries: BlocklistEntry[],
  bindings: Binding[],
  scope: Pick<Binding, 'scope' | 'scopeRef'>,
): BlocklistResult {
  const reachable = bindings.filter(b => b.scope === 'global' || (b.scope === scope.scope && b.scopeRef === scope.scopeRef));
  // Project before global, the order resolveBinding would resolve them in.
  const index = buildValueIndex([...reachable].sort((a, b) => (a.scope === 'global' ? 1 : 0) - (b.scope === 'global' ? 1 : 0)));
  // A copy: names decided during this pass are added so the same one is not proposed twice, and
  // the caller's array must not grow bindings that were never created.
  const taken: Pick<Binding, 'name' | 'scope' | 'scopeRef'>[] = [...bindings];
  const matches: BlocklistMatch[] = [];
  let out = text, replacements = 0;

  for (const entry of [...entries].filter(e => e.enabled && e.term.trim()).sort((a, b) => b.term.length - a.term.length)) {
    const parts = out.split(PLACEHOLDER);
    for (let part = 0; part < parts.length; part += 2) {
      parts[part] = parts[part].replace(pattern(entry.term), found => {
        let match = matches.find(m => m.matched === found);
        if (!match) {
          // The plain values only: a blocklist term matched in the text is a literal, never a
          // base64 run, and a variant would name the binding after a form it does not have.
          const owner = index.plain.find(v => v.value === found && !v.retired);
          const name = owner?.name ?? freeName(nameForTerm(entry.term), taken, scope);
          if (!owner) taken.push({ name, scope: scope.scope, scopeRef: scope.scopeRef });
          match = { entry, matched: found, name, existing: Boolean(owner), count: 0 };
          matches.push(match);
        }
        match.count++;
        replacements++;
        return `{{${match.name}}}`;
      });
    }
    out = parts.join('');
  }
  return { text: out, matches, replacements };
}
