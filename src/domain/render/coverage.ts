import type { LanguageId } from '../../types/models';
import { placeholderRegex } from './index';

export interface Literal {
  start: number;
  end: number;
  text: string;
}
export interface Coverage {
  literals: number;
  bound: number;
  unbound: Literal[];
}

const lineComment: Partial<Record<LanguageId, string[]>> = {
  powershell: ['#'],
  python: ['#'],
  shell: ['#'],
  yaml: ['#'],
  javascript: ['//'],
  typescript: ['//'],
};
const quotes: Partial<Record<LanguageId, string[]>> = {
  powershell: ['"', "'"],
  python: ['"', "'"],
  shell: ['"', "'"],
  yaml: ['"', "'"],
  json: ['"'],
  javascript: ['"', "'", '`'],
  typescript: ['"', "'", '`'],
};

/** One pass over the source collecting the contents of quoted strings.
 *
 * Deliberately simpler than contextAt: this drives a count shown to the user, not the decision of
 * whether escaping is safe. It errs toward reporting a literal, because under-counting would
 * overstate how much of the file is protected, and overstating protection is the whole defect
 * this measurement exists to fix. */
export function stringLiterals(source: string, language: LanguageId): Literal[] {
  const open = quotes[language];
  if (!open) return [];
  const comments = lineComment[language] ?? [];
  const found: Literal[] = [];
  for (let i = 0; i < source.length; i++) {
    const rest = source.slice(i);
    const comment = comments.find((c) => rest.startsWith(c));
    if (comment) {
      const next = source.indexOf('\n', i);
      if (next === -1) break;
      i = next;
      continue;
    }
    const quote = open.find((q) => rest.startsWith(q));
    if (!quote) continue;
    const start = i + quote.length;
    let j = start;
    for (; j < source.length; j++) {
      if (source[j] === '\\' && language !== 'shell') j++;
      else if (source[j] === quote) break;
      else if (source[j] === '\n' && quote !== '`') break;
    }
    if (source[j] === quote) found.push({ start, end: j, text: source.slice(start, j) });
    i = j;
  }
  return found;
}

/** How much of what looks like a value in this file is actually behind a placeholder.
 *
 * A literal counts as protected when a placeholder covers all of it. A literal that merely contains
 * one alongside other text is left in `unbound`, because a partly replaced value is exactly the
 * failure mode where half a password stays in the template. */
export function coverage(source: string, language: LanguageId): Coverage {
  const whole = new RegExp(`^\\s*(?:${placeholderRegex().source}\\s*)+$`);
  const literals = stringLiterals(source, language).filter((l) => l.text.trim() !== '');
  const bound = literals.filter((l) => whole.test(l.text));
  return { literals: literals.length, bound: bound.length, unbound: literals.filter((l) => !whole.test(l.text)) };
}
