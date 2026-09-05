import type { Binding, LanguageId } from '../../types/models';
import { resolveBinding, resolveValue } from '../bindings';
import { contextAt, escapeValue } from './escape';

export interface RenderIssue { name: string; start: number; message: string; kind: 'missing' | 'context' | 'leak' }
export interface RenderResult { text: string; issues: RenderIssue[]; used: string[]; secretRanges: { start: number; end: number }[] }
export interface RenderOptions { mode: 'local' | 'ai'; language: LanguageId; projectId: string; versionId: string | null; profileId: string | null; maskSecrets?: boolean }
export const placeholderRegex = () => /\{\{([A-Z][A-Z0-9_]{1,63})\}\}/g;

export function render(template: string, bindings: Binding[], options: RenderOptions): RenderResult {
  const issues: RenderIssue[] = [], used: string[] = [], secretRanges: { start: number; end: number }[] = [];
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
      if (options.mode === 'local' && binding.category === 'secret' && !escaped.error) {
        if (options.maskSecrets) replacement = '••••••••';
        secretRanges.push({ start: output.length, end: output.length + replacement.length });
      }
    }
    output += replacement;
    cursor = start + match[0].length;
  }
  output += template.slice(cursor);
  // Safety invariant in the renderer, even before the full scanner ships.
  if (options.mode === 'ai') {
    for (const b of bindings) for (const value of Object.values(b.values)) {
      if (!value) continue;
      const start = output.indexOf(value);
      // Report where it is: an unlocatable problem cannot be acted on, and start was always 0.
      if (start >= 0) issues.push({ name: b.name, start, kind: 'leak', message: 'Ett känt privat värde står i klartext här. Kopiering till AI är blockerad tills det är borta.' });
    }
  }
  return { text: output, issues, used, secretRanges };
}
export function usage(template: string): { bindingName: string; occurrences: number }[] {
  const counts = new Map<string, number>();
  for (const m of template.matchAll(placeholderRegex())) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  return [...counts].map(([bindingName, occurrences]) => ({ bindingName, occurrences }));
}
