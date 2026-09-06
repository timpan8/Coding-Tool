import type { LanguageId } from '../../types/models';
import { stringLiterals } from '../render/coverage';

export interface Expansion {
  start: number;
  end: number;
  text: string;
  /** True when the selection was widened, so the dialog can show what it did rather than doing it
   * silently. */
  widened: boolean;
}

/** Widens a selection to the whole string literal containing it.
 *
 * Double-clicking `Hunter2!` selects `Hunter2` and leaves the `!`, so the template keeps half the
 * password and the copy is not protected at all. The same happens with any value a word boundary
 * cuts: `sql01.corp.local` selects `sql01`. This is the quietest way the tool can fail, because
 * everything afterwards looks like it worked. */
export function expandToLiteral(source: string, start: number, end: number, language: LanguageId): Expansion {
  const selected = source.slice(start, end);
  const literal = stringLiterals(source, language).find((l) => l.start <= start && l.end >= end);
  // Only widen within one literal, and never when the selection already covers it exactly.
  if (!literal || (literal.start === start && literal.end === end)) {
    return { start, end, text: selected, widened: false };
  }
  return { start: literal.start, end: literal.end, text: literal.text, widened: literal.text !== selected };
}
