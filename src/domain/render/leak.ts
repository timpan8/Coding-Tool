import type { Binding } from '../../types/models';
import { base64Runs, decodeBase64Variants, encodedVariants, type Encoding } from './encoding';

export interface LeakHit {
  bindingName: string;
  /** Which project's binding the value belongs to, so the message can say where it came from. */
  ownerScopeRef: string | null;
  start: number;
  end: number;
  /** How the value appears in the output: itself, or one of the forms it can be written in.
   * Never the value, and never the encoded text either — invariant 5 covers both. */
  encoding: Encoding;
  /** True when the value is no longer a binding's current one but was, and is still watched. */
  retired: boolean;
}
export interface IndexedValue { name: string; value: string; scopeRef: string | null; encoding: Encoding; retired: boolean }
export interface ValueIndex {
  values: IndexedValue[];
  /** The plain values, for the second pass that looks inside base64 runs. Decoding is only worth
   * doing against the values themselves; a variant of a variant is noise. */
  plain: IndexedValue[];
}

/** Flattens every private value in the whole vault into one list, once.
 *
 * Reading the whole vault rather than the open project's bindings is deliberate, and is the
 * guarantee behind invariant 4: a value bound in one project must not be able to walk into an AI
 * copy made from another. Scope resolution is a separate question, handled by resolveBinding.
 *
 * Retired values — what a binding's value used to be — are indexed too. A rotated password is
 * still the password that was on the account last week, and code written then still carries it. */
export function buildValueIndex(bindings: Binding[]): ValueIndex {
  const values: IndexedValue[] = [], plain: IndexedValue[] = [];
  const add = (name: string, scopeRef: string | null, value: string, retired: boolean) => {
    if (!value) return;
    const exact: IndexedValue = { name, value, scopeRef, encoding: 'exact', retired };
    values.push(exact);
    plain.push(exact);
    // A one-character value has a variant for every escape rule and matches half the file; the
    // exact form still blocks it, which is what the gate is for.
    if (value.length < 4) return;
    for (const variant of encodedVariants(value)) values.push({ name, value: variant.text, scopeRef, encoding: variant.encoding, retired });
  };
  for (const binding of bindings) {
    for (const value of Object.values(binding.values)) add(binding.name, binding.scopeRef, value, false);
    for (const value of binding.retired ?? []) add(binding.name, binding.scopeRef, value, true);
  }
  return { values, plain };
}

/** A plain scan, on purpose.
 *
 * A prefix-filtered index was written first and measured against this: with 50 bindings over 24 kB
 * of text it was twice as slow, and it only overtook a plain scan somewhere past 200 bindings.
 * String.prototype.indexOf is native; building a JavaScript index over the text to avoid it is not
 * a trade that pays at the sizes this app sees.
 *
 * The cost that mattered was never this loop — it was that the loop ran on every keystroke. It now
 * runs when a projection is rebuilt or a copy is made. If a vault ever grows large enough for this
 * to be felt while typing, the answer is Aho–Corasick over one pass, not a partial index.
 *
 * The second pass decodes long base64 runs and looks for the values inside them. A run is reported
 * at the position of the run, since there is no offset inside it that means anything to a reader. */
export function findLeaks(output: string, index: ValueIndex): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const entry of index.values) {
    const start = output.indexOf(entry.value);
    if (start >= 0) hits.push({ bindingName: entry.name, ownerScopeRef: entry.scopeRef, start, end: start + entry.value.length, encoding: entry.encoding, retired: entry.retired });
  }
  for (const run of base64Runs(output)) {
    const decoded = decodeBase64Variants(run.run);
    if (!decoded.length) continue;
    for (const entry of index.plain) {
      if (decoded.some(text => text.includes(entry.value))) {
        hits.push({ bindingName: entry.name, ownerScopeRef: entry.scopeRef, start: run.start, end: run.end, encoding: 'inside-base64', retired: entry.retired });
      }
    }
  }
  // One value, one hit. A base64 run can match both as an encoded variant and by being decoded,
  // and the exact form of a value can sit inside its own escaped form; reporting the same binding
  // twice for one span of text says nothing extra and makes the panel look worse than it is.
  const widest = hits.filter((hit, i) => !hits.some((other, j) =>
    j !== i && other.bindingName === hit.bindingName && other.start <= hit.start && other.end >= hit.end
    && (other.end - other.start > hit.end - hit.start || (other.end - other.start === hit.end - hit.start && j < i))));
  return widest.sort((a, b) => a.start - b.start);
}
