/* eslint-disable no-control-regex -- Escaping control characters is this module's purpose. */
import type { LanguageId } from '../../types/models';

export interface Context { quote: string; blocked?: string }
/** A conservative lexer over original source (never over substituted private values).
 * Comments, escaped quotes, PS here strings and Python raw/triple strings are tracked.
 * Contexts we cannot reliably escape are blocked rather than guessed.
 */
export function contextAt(source: string, position: number, language: LanguageId): Context {
  if (language === 'plaintext') return { quote: '' };
  // XML has no strings to be inside, but it does have two regions where escaping would be wrong:
  // a comment, and CDATA where entities are not interpreted at all.
  if (language === 'xml') {
    for (const [open, close, message] of [
      ['<!--', '-->', 'Platshållaren finns i en XML-kommentar. Använd raw-läge endast efter granskning.'],
      ['<![CDATA[', ']]>', 'CDATA tolkar inga entiteter, så escaping skulle skriva in dem ordagrant.'],
    ] as const) {
      const start = source.lastIndexOf(open, position);
      if (start !== -1 && source.indexOf(close, start) >= position) return { quote: '', blocked: message };
    }
    return { quote: '' };
  }
  // A YAML block scalar takes its value from indentation, not from quotes.
  if (language === 'yaml') {
    const before = source.slice(0, position);
    const lines = before.split('\n');
    for (let i = lines.length - 2; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (/:\s*[|>][+-]?\d*\s*$/.test(line)) {
        const indent = line.length - line.trimStart().length;
        const current = lines[lines.length - 1];
        // Still inside while the placeholder's line is indented past the key that opened it.
        if (current.length - current.trimStart().length > indent) {
          return { quote: '', blocked: 'YAML-blockskalär: värdet styrs av indrag, inte av citattecken. Flytta det till en citerad sträng.' };
        }
      }
      break;
    }
  }
  // Which characters actually open a string differs, and getting it wrong is not cosmetic: an
  // apostrophe in an HCL comment would otherwise open a string that never closes, and a SQL double
  // quote encloses an identifier rather than a value.
  const quotes = language === 'hcl' ? '"' : language === 'sql' ? "'" : language === 'dotenv' ? '"\'' : null;
  let here = '';
  let quote = '', lineComment = false, blockComment = false, raw = false, triple = false, regex = false;
  for (let i = 0; i < position; i++) {
    const c = source[i], next = source[i + 1];
    const lineStart = i === 0 || source[i - 1] === '\n';
    if (here) {
      // PowerShell closes with "@ or '@; a shell here-document closes with the word alone on a line.
      if (lineStart && language === 'powershell' && source.startsWith(here + '@', i)) { here = ''; i++; }
      else if (lineStart && language === 'shell') {
        const line = source.slice(i, source.indexOf('\n', i) === -1 ? undefined : source.indexOf('\n', i));
        if (line.trim() === here) here = '';
      }
      continue;
    }
    if (regex) {
      if (c === '\\') { i++; continue; }
      if (c === '/' || c === '\n') regex = false;
      continue;
    }
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) {
      if ((language === 'powershell' && c === '#' && next === '>') || (c === '*' && next === '/')) { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      // Where a backslash escapes the next character. Not in a POSIX single-quoted string, not in
      // a dotenv single-quoted string, and not in SQL, where the standard escape is a doubled
      // apostrophe and a backslash stands for itself.
      const literal = (language === 'shell' || language === 'dotenv') && quote === "'";
      if ((language === 'powershell' && quote === '"' && c === '`')
        || (language !== 'powershell' && language !== 'sql' && !literal && c === '\\')) { i++; continue; }
      if ((language === 'powershell' || language === 'yaml' || language === 'sql') && quote === "'" && c === "'" && next === "'") { i++; continue; }
      if (c === quote) {
        if (triple) { if (source.slice(i, i + 3) === quote.repeat(3)) { i += 2; quote = ''; triple = false; raw = false; } }
        else { quote = ''; raw = false; }
      }
      continue;
    }
    if (language === 'powershell' && c === '@' && (next === '"' || next === "'") && /^(?:\r?\n)/.test(source.slice(i + 2))) { here = next; i++; continue; }
    if ((language === 'shell' || language === 'hcl') && c === '<' && next === '<') {
      const opener = /^<<[-~]?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(source.slice(i));
      if (opener) { here = opener[1]; i += opener[0].length - 1; continue; }
    }
    // Postgres dollar quoting: $tag$ ... $tag$ interprets nothing at all inside.
    if (language === 'sql' && c === '$') {
      const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (opener && source.indexOf(opener[0], i + opener[0].length) >= position) {
        return { quote: '', blocked: 'Dollarciterad SQL-sträng tolkar ingenting alls. Flytta värdet till en vanlig sträng med apostrofer.' };
      }
    }
    // A slash after an operator or the start of an expression opens a regular expression; after a
    // value it is division. Looking back at the last meaningful character separates the two.
    if (['javascript', 'typescript'].includes(language) && c === '/' && next !== '/' && next !== '*') {
      const preceding = source.slice(0, i).replace(/\s+$/, '').slice(-1);
      if (!preceding || /[=(,:[!&|?{};+\-*%<>~^]/.test(preceding)) { regex = true; continue; }
    }
    if (language === 'powershell' && c === '<' && next === '#') { blockComment = true; i++; continue; }
    if (['javascript', 'typescript'].includes(language) && c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (['javascript', 'typescript'].includes(language) && c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (['powershell', 'python', 'shell', 'yaml', 'dotenv', 'hcl'].includes(language) && c === '#') { lineComment = true; continue; }
    if (language === 'hcl' && c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (language === 'hcl' && c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (language === 'sql' && c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (language === 'sql' && c === '-' && next === '-') { lineComment = true; i++; continue; }
    if (quotes ? quotes.includes(c) : c === '"' || c === "'" || (['javascript', 'typescript'].includes(language) && c === '`')) {
      quote = c;
      if (language === 'python') {
        const prefix = /([rRuUfFbB]{1,2})$/.exec(source.slice(0, i))?.[1] || '';
        raw = /[rfb]/i.test(prefix);
        triple = source.slice(i, i + 3) === c.repeat(3);
        if (triple) i += 2;
      }
    }
  }
  if (here) return { quote: '', blocked: language === 'shell' || language === 'hcl'
    ? 'Here-document: inget är citerat där, så escaping skulle förvanska värdet. Flytta det till en citerad sträng.'
    : 'PowerShell here-string: flytta värdet till en vanlig citerad sträng.' };
  if (regex) return { quote: '', blocked: 'Platshållare i ett reguljärt uttryck stöds inte. Bygg uttrycket av en citerad sträng i stället.' };
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
  if (language === 'dotenv') {
    // Double quotes: most parsers expand $VAR and ${VAR} here, and which ones do is not knowable
    // from the file, so a value containing a dollar is refused rather than escaped hopefully.
    if (q === '"') {
      if (value.includes('$')) return { text: '', error: 'Värdet innehåller $, som många .env-läsare expanderar. Använd apostrofer runt platshållaren i stället.' };
      return { text: value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n') };
    }
    // Single quotes are literal in every reader, which also means they can hold no apostrophe.
    if (q === "'") {
      if (/['\r\n]/.test(value)) return { text: '', error: 'En apostrofciterad .env-sträng kan varken innehålla apostrof eller radbrytning. Använd citattecken.' };
      return { text: value };
    }
    if (/[\s#'"\\]/.test(value)) return { text: '', error: 'Ett ociterat .env-värde får inte innehålla blanksteg, #, citattecken eller bakstreck. Citera platshållaren.' };
    return { text: value };
  }
  if (language === 'hcl') {
    if (q !== '"') return { text: '', error: 'HCL-värden utanför en sträng är uttryck. Citera platshållaren.' };
    // ${...} and %{...} are evaluated by Terraform. Doubling the sigil is how HCL writes one
    // literally; without it a value could be made to read another variable.
    return { text: value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
      // Function form deliberately: in a replacement string `$$` means a single `$`, so the
      // literal '$${' would emit '${' and leave the interpolation live.
      .replace(/\$\{/g, () => '$${').replace(/%\{/g, () => '%%{') };
  }
  if (language === 'sql') {
    if (q === '"') return { text: '', error: 'Citattecken omger ett identifierarnamn i SQL, inte ett värde. Använd apostrofer.' };
    if (q === "'") {
      // MySQL treats a backslash as an escape by default; the standard and PostgreSQL do not.
      // Either choice is wrong somewhere, so the value is refused instead.
      if (value.includes('\\')) return { text: '', error: 'SQL-dialekter är oense om bakstreck i strängar. Lägg värdet i en parameter i stället för i texten.' };
      return { text: value.replace(/'/g, "''") };
    }
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) return { text: '', error: 'Ett ociterat SQL-värde måste vara ett tal. Citera platshållaren med apostrofer.' };
    return { text: value };
  }
  if (!/^[A-Za-z0-9_./:\\-]+$/.test(value)) return { text: '', error: 'Värdet innehåller specialtecken utanför en sträng. Citera platshållaren eller granska raw-läge.' };
  return { text: value };
}

