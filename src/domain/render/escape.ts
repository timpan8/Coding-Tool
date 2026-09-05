/* eslint-disable no-control-regex -- Escaping control characters is this module's purpose. */
import type { LanguageId } from '../../types/models';

export interface Context { quote: string; blocked?: string }
/** A conservative lexer over original source (never over substituted private values).
 * Comments, escaped quotes, PS here strings and Python raw/triple strings are tracked.
 * Contexts we cannot reliably escape are blocked rather than guessed.
 */
export function contextAt(source: string, position: number, language: LanguageId): Context {
  if (language === 'plaintext' || language === 'xml') return { quote: '' };
  let quote = '', lineComment = false, blockComment = false, here = '', raw = false, triple = false;
  for (let i = 0; i < position; i++) {
    const c = source[i], next = source[i + 1];
    const lineStart = i === 0 || source[i - 1] === '\n';
    if (here) {
      if (lineStart && source.startsWith(here + '@', i)) { here = ''; i++; }
      continue;
    }
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) {
      if ((language === 'powershell' && c === '#' && next === '>') || (c === '*' && next === '/')) { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if ((language === 'powershell' && quote === '"' && c === '`')
        || (language !== 'powershell' && !(language === 'shell' && quote === "'") && c === '\\')) { i++; continue; }
      if ((language === 'powershell' || language === 'yaml') && quote === "'" && c === "'" && next === "'") { i++; continue; }
      if (c === quote) {
        if (triple) { if (source.slice(i, i + 3) === quote.repeat(3)) { i += 2; quote = ''; triple = false; raw = false; } }
        else { quote = ''; raw = false; }
      }
      continue;
    }
    if (language === 'powershell' && c === '@' && (next === '"' || next === "'") && /^(?:\r?\n)/.test(source.slice(i + 2))) { here = next; i++; continue; }
    if (language === 'powershell' && c === '<' && next === '#') { blockComment = true; i++; continue; }
    if (['javascript', 'typescript'].includes(language) && c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (['javascript', 'typescript'].includes(language) && c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (['powershell', 'python', 'shell', 'yaml'].includes(language) && c === '#') { lineComment = true; continue; }
    if (c === '"' || c === "'" || (['javascript', 'typescript'].includes(language) && c === '`')) {
      quote = c;
      if (language === 'python') {
        const prefix = /([rRuUfFbB]{1,2})$/.exec(source.slice(0, i))?.[1] || '';
        raw = /[rfb]/i.test(prefix);
        triple = source.slice(i, i + 3) === c.repeat(3);
        if (triple) i += 2;
      }
    }
  }
  if (here) return { quote: '', blocked: 'PowerShell here-string: flytta värdet till en vanlig citerad sträng.' };
  if (raw || triple) return { quote, blocked: 'Python raw-, f-, byte- eller trippelsträng: använd en vanlig sträng.' };
  if (blockComment || lineComment) return { quote: '', blocked: 'Platshållaren finns i en kommentar. Använd raw-läge endast efter granskning.' };
  // Do not attempt to parse nested template expressions or Bash command substitutions.
  const prefix = source.slice(0, position);
  if (quote === '`' && /\$\{[^}]*$/.test(prefix)) return { quote, blocked: 'Platshållare inuti JavaScript-uttryck stöds inte automatiskt.' };
  if (language === 'shell' && quote === '"' && /\$\([^)]*$/.test(prefix)) return { quote, blocked: 'Platshållare i kommandosubstitution stöds inte.' };
  return { quote };
}

function backslash(value: string, quote: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/\u0000/g, '\\x00').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    .split(quote).join('\\' + quote);
}
export function escapeValue(value: string, language: LanguageId, context: Context): { text: string; error?: string } {
  if (context.blocked) return { text: '', error: context.blocked };
  const q = context.quote;
  if (language === 'plaintext') return { text: value };
  if (language === 'xml') return { text: value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') };
  if (language === 'json') return q === '"' ? { text: JSON.stringify(value).slice(1, -1) } : { text: '', error: 'JSON-värdet måste placeras inuti en sträng.' };
  if (language === 'powershell' && q === '"') return { text: value.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$').replace(/\r/g, '`r').replace(/\n/g, '`n').replace(/\u0000/g, '`0') };
  if (language === 'powershell' && q === "'") return { text: value.replace(/'/g, "''") };
  if (['javascript', 'typescript', 'python'].includes(language) && q) return { text: q === '`' ? backslash(value, q).replace(/\$\{/g, '\\${') : backslash(value, q) };
  if (language === 'shell' && q === '"') return { text: value.replace(/[\\$`"!]/g, '\\$&') };
  if (language === 'shell' && q === "'") return { text: value.replace(/'/g, "'\\''") };
  if (language === 'yaml') {
    if (q === '"') return { text: JSON.stringify(value).slice(1, -1) };
    if (q === "'") return /[\r\n]/.test(value) ? { text: '', error: 'YAML med radbrytning behöver en dubbelciterad sträng.' } : { text: value.replace(/'/g, "''") };
    return { text: JSON.stringify(value) };
  }
  if (!/^[A-Za-z0-9_./:\\-]+$/.test(value)) return { text: '', error: 'Värdet innehåller specialtecken utanför en sträng. Citera platshållaren eller granska raw-läge.' };
  return { text: value };
}

