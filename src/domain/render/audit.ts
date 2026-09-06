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
    message: 'Ett känt privat värde står i klartext här. Kopiering till AI är blockerad tills det är borta.',
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
