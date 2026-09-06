import type { Binding, LanguageId } from '../../types/models';
import { resolveBinding, resolveValue } from '../bindings';
import { contextAt, escapeValue } from './escape';

export interface RenderIssue { name: string; start: number; message: string; kind: 'missing' | 'context' | 'leak' }
export interface RenderResult {
  text: string;
  issues: RenderIssue[];
  used: string[];
  /** Where a private value was substituted in the local projection. Drives masking and the second
   * confirmation before Copy Local, so it covers every value rather than only secrets. */
  secretRanges: { start: number; end: number }[];
  /** Where each placeholder ended up in the rendered text, for both projections. Without this the
   * two views look like ordinary code and the substitution is invisible. `source` is the same
   * placeholder's range in the template, which is what lets a range of the template be mapped onto
   * the rendered text. */
  substitutions: { start: number; end: number; name: string; source: { start: number; end: number } }[];
}
export interface RenderOptions { mode: 'local' | 'ai'; language: LanguageId; projectId: string; versionId: string | null; profileId: string | null; maskSecrets?: boolean }
export const placeholderRegex = () => /\{\{([A-Z][A-Z0-9_]{1,63})\}\}/g;

export function render(template: string, bindings: Binding[], options: RenderOptions): RenderResult {
  const issues: RenderIssue[] = [], used: string[] = [], secretRanges: { start: number; end: number }[] = [];
  const substitutions: RenderResult['substitutions'] = [];
  let output = '', cursor = 0;
  for (const match of template.matchAll(placeholderRegex())) {
    const start = match.index, name = match[1];
    output += template.slice(cursor, start);
    const binding = resolveBinding(name, bindings, options.projectId, options.versionId);
    let replacement = match[0];
    const value = binding ? options.mode === 'ai' ? binding.aiReplacement : resolveValue(binding, options.profileId) : undefined;
    if (!binding || value === undefined || value === '') issues.push({ name, start, kind: 'missing', message: 'Binding eller värde saknas.' });
    else {
      used.push(name);
      const escaped = binding.escapeMode === 'raw' ? { text: value } : escapeValue(value, options.language, contextAt(template, start, options.language));
      if (escaped.error) issues.push({ name, start, kind: 'context', message: escaped.error });
      else replacement = escaped.text;
      // Every substituted private value counts, not only the ones categorised 'secret'. The
      // category is a guess made from the variable name, and `$p = "Hunter2"` guesses 'identity',
      // which used to leave a password unmasked and skip the second confirmation before Copy
      // Local. Invariant 9 must not rest on a heuristic.
      if (!escaped.error) substitutions.push({ start: output.length, end: output.length + replacement.length, name, source: { start, end: start + match[0].length } });
      if (options.mode === 'local' && !escaped.error) {
        if (options.maskSecrets) replacement = '•'.repeat(Math.min(12, Math.max(4, value.length)));
        secretRanges.push({ start: output.length, end: output.length + replacement.length });
      }
    }
    output += replacement;
    cursor = start + match[0].length;
  }
  output += template.slice(cursor);
  // The exact-value check used to live here and ran on every keystroke over every value in the
  // vault. It now belongs to auditForCopy, which the copy path must call. render() is projection
  // only; it must never be treated as a safety gate on its own.
  return { text: output, issues, used, secretRanges, substitutions };
}
export function usage(template: string): { bindingName: string; occurrences: number }[] {
  const counts = new Map<string, number>();
  for (const m of template.matchAll(placeholderRegex())) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  return [...counts].map(([bindingName, occurrences]) => ({ bindingName, occurrences }));
}
