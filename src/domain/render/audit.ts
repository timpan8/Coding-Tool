import type { Binding } from '../../types/models';
import { coverage, type Coverage } from './coverage';
import { buildValueIndex, findLeaks, type LeakHit, type ValueIndex } from './leak';
import { render, type RenderIssue, type RenderOptions, type RenderResult } from './index';

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
