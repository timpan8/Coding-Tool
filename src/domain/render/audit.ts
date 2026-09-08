import type { Binding } from '../../types/models';
import { coverage, type Coverage } from './coverage';
import { buildValueIndex, findLeaks, type LeakHit, type ValueIndex } from './leak';
import { render, type RenderIssue, type RenderOptions, type RenderResult } from './index';
import type { LanguageId } from '../../types/models';

const lineComment: Partial<Record<LanguageId, string>> = {
  powershell: '#', python: '#', shell: '#', yaml: '#', javascript: '//', typescript: '//',
};

/** Prepended to the AI copy so the model is told what the placeholders are and to leave them
 * alone. It raises the chance the code comes back in a shape ingest() can put together again.
 * Written as a comment where the language has one, and omitted where it does not, rather than
 * pasted as loose prose that would break the file. */
export function promptBlock(text: string, language: LanguageId): string {
  const marker = lineComment[language];
  if (!marker) return '';
  return text
    .split('\n')
    .map((line) => `${marker} ${line}`.trimEnd())
    .join('\n');
}

/** What a leak hit is called on screen. Never the value and never the encoded text: invariant 5
 * covers the message as much as the error object. */
const encodingName: Record<LeakHit['encoding'], string> = {
  exact: 'i klartext',
  url: 'URL-kodat',
  html: 'HTML-escapat',
  json: 'JSON-escapat',
  backtick: 'escapat med backtick',
  'doubled-quote': 'med dubblerade apostrofer',
  regex: 'escapat som reguljärt uttryck',
  base64: 'base64-kodat',
  'base64-utf16': 'base64-kodat (UTF-16)',
  'inside-base64': 'inuti en base64-sträng',
};
const leakMessage = (hit: LeakHit, where: string) =>
  `Ett känt privat värde står ${encodingName[hit.encoding]}${hit.retired ? ' — ett värde bindingen har haft tidigare' : ''} ${where}. Kopiering till AI är blockerad tills det är borta.`;

/** The first line of a Copy Local, so the file it lands in says what it holds.
 *
 * Two jobs, both small: a person who finds the file later knows it carries real values, and the
 * app recognises the line when such a file is pasted back in as an AI answer — which is a mistake
 * worth catching, because the values in it were never sanitised. */
export const SENTINEL = '[REAL VALUES - never paste into AI] v1';
export const sentinelLine = (language: LanguageId) => {
  const marker = lineComment[language];
  return marker ? `${marker} ${SENTINEL}` : '';
};
export const hasSentinel = (text: string) => text.slice(0, 400).includes(SENTINEL);

export interface CopyAudit extends RenderResult {
  leaks: LeakHit[];
  coverage: Coverage;
  /** Every reason copying is refused, in one place. */
  blocking: RenderIssue[];
  canCopy: boolean;
}

/** The only function the copy path may call.
 *
 * render() is pure substitution and escaping; it no longer scans for leaked values, so it is cheap
 * enough to run while typing. The exact-value check lives here instead, which means it must be run
 * before every copy rather than assumed to have run at some point — invariant 4 depends on it. */
export function auditForCopy(template: string, bindings: Binding[], options: RenderOptions, index?: ValueIndex): CopyAudit {
  const result = render(template, bindings, options);
  const leaks =
    options.mode === 'ai' ? findLeaks(result.text, index ?? buildValueIndex(bindings)) : [];
  const leakIssues: RenderIssue[] = leaks.map((hit) => ({
    name: hit.bindingName,
    start: hit.start,
    kind: 'leak',
    message: leakMessage(hit, 'här'),
  }));
  const blocking = [...result.issues, ...leakIssues];
  return {
    ...result,
    issues: blocking,
    leaks,
    coverage: coverage(template, options.language),
    blocking,
    canCopy: blocking.length === 0,
  };
}

/** Maps an offset in the template onto the rendered text.
 *
 * Only successfully escaped placeholders shift anything: one that failed keeps its literal
 * `{{NAME}}` and so has the same length in both. An offset that lands inside a placeholder snaps to
 * its edge, because half a placeholder is not something anyone meant to select. */
function mapOffset(subs: RenderResult['substitutions'], offset: number, edge: 'start' | 'end'): number {
  let delta = 0;
  for (const s of subs) {
    if (s.source.end <= offset) delta += s.end - s.start - (s.source.end - s.source.start);
    else if (s.source.start < offset) return edge === 'start' ? s.start : s.end;
    else break;
  }
  return offset + delta;
}

export interface SelectionAudit extends CopyAudit {
  /** The rendered text of the selection alone. */
  text: string;
}

/** Report U19: copying one function rather than the whole file.
 *
 * The whole template is rendered first, never the fragment on its own — escaping depends on the
 * surrounding source, and a fragment that starts inside a string literal would be lexed wrongly.
 * Only then is the result cut down to the selection.
 *
 * The gate is applied to what is actually copied: the exact-value check runs on the slice, and an
 * unresolved placeholder outside the selection does not block it. Invariant 4 still holds, because
 * the slice is the output. */
export function auditSelection(
  template: string,
  bindings: Binding[],
  options: RenderOptions,
  range: { start: number; end: number },
  index?: ValueIndex,
): SelectionAudit {
  const whole = render(template, bindings, options);
  const from = mapOffset(whole.substitutions, Math.max(0, Math.min(range.start, template.length)), 'start');
  const to = mapOffset(whole.substitutions, Math.max(0, Math.min(range.end, template.length)), 'end');
  const text = whole.text.slice(from, to);

  const inside = <T extends { start: number; end: number }>(r: T) => r.start >= from && r.end <= to;
  const shift = <T extends { start: number; end: number }>(r: T) => ({ ...r, start: r.start - from, end: r.end - from });
  const substitutions = whole.substitutions.filter(inside).map(shift);
  const leaks = options.mode === 'ai' ? findLeaks(text, index ?? buildValueIndex(bindings)) : [];
  const leakIssues: RenderIssue[] = leaks.map((hit) => ({
    name: hit.bindingName,
    start: hit.start,
    kind: 'leak',
    message: leakMessage(hit, 'i markeringen'),
  }));
  // Only problems inside the selection can block it; one further down the file is not being copied.
  const own = whole.issues.filter((issue) => issue.start >= range.start && issue.start < range.end);
  const blocking = [...own, ...leakIssues];
  return {
    text,
    issues: blocking,
    used: substitutions.map((s) => s.name),
    secretRanges: whole.secretRanges.filter(inside).map(shift),
    substitutions,
    leaks,
    coverage: coverage(template.slice(range.start, range.end), options.language),
    blocking,
    canCopy: blocking.length === 0,
  };
}
