/* eslint-disable no-control-regex -- Escaping control characters is this module's purpose. */
import type { LanguageId } from '../../types/models';

export interface Context {
  quote: string;
  blocked?: string;
  /** A string where a backslash is literal and the quote is escaped by doubling it: C#'s @"…".
   * Go's raw string is told apart by its backtick, so it needs no flag. */
  verbatim?: boolean;
}
/** A conservative lexer over original source (never over substituted private values).
 * Comments, escaped quotes, PS here strings and Python raw/triple strings are tracked.
 * Contexts we cannot reliably escape are blocked rather than guessed.
 */
export function contextAt(source: string, position: number, language: LanguageId): Context {
  return contextsAt(source, [position], language)[0];
}

/** Report P3. The lexer used to be re-run from position 0 for every placeholder, which is O(n·m):
 * measured at 11 ms for a 500-line file with 50 placeholders and 184 ms at 2000 lines with 200 —
 * and render() runs twice per keystroke, once per projection.
 *
 * This is the same scan, paused at each requested position instead of restarted. The loop body is
 * unchanged on purpose; contextsAt with a single position does exactly what contextAt did, which is
 * what the differential property test in context.test.ts pins down.
 *
 * Results come back in the order the positions were given. */
export function contextsAt(source: string, positions: number[], language: LanguageId): Context[] {
  const results = Array.from<Context>({ length: positions.length });
  if (language === 'plaintext') return results.fill({ quote: '' });
  if (language === 'xml') return positions.map((position) => xmlContext(source, position));

  // Ascending, but the answers go back in the caller's order.
  const order = positions.map((position, index) => ({ position, index })).sort((a, b) => a.position - b.position);
  let pending = 0;
  const record = (state: State, upTo: number) => {
    while (pending < order.length && order[pending].position <= upTo) {
      const { position, index } = order[pending++];
      results[index] = resolve(state, source, position, language);
    }
  };
  const state: State = { here: '', quote: '', lineComment: false, blockComment: false, raw: false, triple: false, regex: false, dollarUntil: -1, verbatim: false, stringBlock: '' };
  scan(source, language, Math.min(Math.max(0, ...positions), source.length), state, record);
  record(state, Infinity);
  return results;
}

interface State {
  here: string; quote: string; lineComment: boolean; blockComment: boolean; raw: boolean; triple: boolean;
  regex: boolean; dollarUntil: number;
  /** Inside a string a backslash does not escape: C# @"…" and Go `…`. */
  verbatim: boolean;
  /** Why the string currently open cannot be substituted into, cleared when it closes. */
  stringBlock: string;
}

function xmlContext(source: string, position: number): Context {
  // XML has no strings to be inside, but it does have two regions where escaping would be wrong:
  // a comment, and CDATA where entities are not interpreted at all.
  for (const [open, close, message] of [
    ['<!--', '-->', 'Platshållaren finns i en XML-kommentar. Använd raw-läge endast efter granskning.'],
    ['<![CDATA[', ']]>', 'CDATA tolkar inga entiteter, så escaping skulle skriva in dem ordagrant.'],
  ] as const) {
    const start = source.lastIndexOf(open, position);
    if (start !== -1 && source.indexOf(close, start) >= position) return { quote: '', blocked: message };
  }
  return { quote: '' };
}

/** The scan itself, shared by every position. `record` is called at the top of each character with
 * the state as it stands before that character, which is exactly the state the old per-position
 * loop ended with for any position at or before it. */
function scan(source: string, language: LanguageId, until: number, s: State, record: (state: State, upTo: number) => void) {
  // Which characters actually open a string differs, and getting it wrong is not cosmetic: an
  // apostrophe in an HCL comment would otherwise open a string that never closes, and a SQL double
  // quote encloses an identifier rather than a value.
  const cFamily = language === 'csharp' || language === 'go' || language === 'java';
  const quotes = language === 'hcl' ? '"' : language === 'sql' ? "'" : language === 'dotenv' ? '"\''
    // In C#, Go and Java an apostrophe opens a character literal, not a string. Treating it as a
    // quote would leave the lexer inside a string that never closes and misread the rest of the file.
    : language === 'go' ? '"`' : cFamily ? '"' : null;
  for (let i = 0; i < until; i++) {
    record(s, i);
      const c = source[i], next = source[i + 1];
      const lineStart = i === 0 || source[i - 1] === '\n';
      if (s.here) {
        // PowerShell closes with "@ or '@; a shell here-document closes with the word alone on a line.
        if (lineStart && language === 'powershell' && source.startsWith(s.here + '@', i)) { s.here = ''; i++; }
        else if (lineStart && language === 'shell') {
          const line = source.slice(i, source.indexOf('\n', i) === -1 ? undefined : source.indexOf('\n', i));
          if (line.trim() === s.here) s.here = '';
        }
        continue;
      }
      if (s.regex) {
        if (c === '\\') { i++; continue; }
        if (c === '/' || c === '\n') s.regex = false;
        continue;
      }
      if (s.lineComment) { if (c === '\n') s.lineComment = false; continue; }
      if (s.blockComment) {
        if ((language === 'powershell' && c === '#' && next === '>') || (c === '*' && next === '/')) { s.blockComment = false; i++; }
        continue;
      }
      if (s.quote) {
        // Where a backslash escapes the next character. Not in a POSIX single-quoted string, not in
        // a dotenv single-quoted string, and not in SQL, where the standard escape is a doubled
        // apostrophe and a backslash stands for itself.
        const literal = ((language === 'shell' || language === 'dotenv') && s.quote === "'") || s.verbatim;
        if ((language === 'powershell' && s.quote === '"' && c === '`')
          || (language !== 'powershell' && language !== 'sql' && !literal && c === '\\')) { i++; continue; }
        if ((language === 'powershell' || language === 'yaml' || language === 'sql') && s.quote === "'" && c === "'" && next === "'") { i++; continue; }
        // @"…" writes a quote by doubling it, so "" is one character rather than a close and reopen.
        if (language === 'csharp' && s.verbatim && c === '"' && next === '"') { i++; continue; }
        if (c === s.quote) {
          if (s.triple) { if (source.slice(i, i + 3) === s.quote.repeat(3)) { i += 2; s.quote = ''; s.triple = false; s.raw = false; s.verbatim = false; s.stringBlock = ''; } }
          else { s.quote = ''; s.raw = false; s.verbatim = false; s.stringBlock = ''; }
        }
        continue;
      }
      if (language === 'powershell' && c === '@' && (next === '"' || next === "'") && /^(?:\r?\n)/.test(source.slice(i + 2))) { s.here = next; i++; continue; }
      if ((language === 'shell' || language === 'hcl') && c === '<' && next === '<') {
        const opener = /^<<[-~]?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(source.slice(i));
        if (opener) { s.here = opener[1]; i += opener[0].length - 1; continue; }
      }
      // Postgres dollar quoting: $tag$ ... $tag$ interprets nothing at all inside. Recorded as the
      // furthest index a closer sits at, so any position up to there resolves as blocked; an
      // unterminated one blocks nothing.
      //
      // The furthest, not the latest: the old code returned as soon as it found an opener whose
      // closer lay at or beyond the position, so a position is blocked if ANY earlier opener
      // reaches it. Overwriting instead let `$t$$t$"` unblock itself — the second opener's closer
      // is -1, and position 3 stopped being inside the first region. The property test found it.
      if (language === 'sql' && c === '$') {
        const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
        if (opener) s.dollarUntil = Math.max(s.dollarUntil, source.indexOf(opener[0], i + opener[0].length));
      }
      // A slash after an operator or the start of an expression opens a regular expression; after a
      // value it is division. Looking back at the last meaningful character separates the two.
      if (['javascript', 'typescript'].includes(language) && c === '/' && next !== '/' && next !== '*') {
        const preceding = source.slice(0, i).replace(/\s+$/, '').slice(-1);
        if (!preceding || /[=(,:[!&|?{};+\-*%<>~^]/.test(preceding)) { s.regex = true; continue; }
      }
      if (language === 'powershell' && c === '<' && next === '#') { s.blockComment = true; i++; continue; }
      if (['javascript', 'typescript'].includes(language) && c === '/' && next === '*') { s.blockComment = true; i++; continue; }
      if (['javascript', 'typescript'].includes(language) && c === '/' && next === '/') { s.lineComment = true; i++; continue; }
      if (['powershell', 'python', 'shell', 'yaml', 'dotenv', 'hcl'].includes(language) && c === '#') { s.lineComment = true; continue; }
      if (language === 'hcl' && c === '/' && next === '*') { s.blockComment = true; i++; continue; }
      if (language === 'hcl' && c === '/' && next === '/') { s.lineComment = true; i++; continue; }
      if (language === 'sql' && c === '/' && next === '*') { s.blockComment = true; i++; continue; }
      if (language === 'sql' && c === '-' && next === '-') { s.lineComment = true; i++; continue; }
      if (cFamily && c === '/' && next === '*') { s.blockComment = true; i++; continue; }
      if (cFamily && c === '/' && next === '/') { s.lineComment = true; i++; continue; }
      if (quotes ? quotes.includes(c) : c === '"' || c === "'" || (['javascript', 'typescript'].includes(language) && c === '`')) {
        s.quote = c;
        if (language === 'python') {
          // The two characters before the quote, not a slice of the whole prefix: the pattern is
          // anchored at the end and matches at most two, so this is the same answer without the
          // O(n) copy that made every string in a long file cost the file's length.
          const prefix = /([rRuUfFbB]{1,2})$/.exec(source.slice(Math.max(0, i - 2), i))?.[1] || '';
          s.raw = /[rfb]/i.test(prefix);
          s.triple = source.slice(i, i + 3) === c.repeat(3);
          if (s.triple) i += 2;
        }
        if (cFamily) openCFamilyString(source, i, language, c, s);
        // A triple quote consumes its two extra characters whatever the language.
        if (s.triple && language !== 'python') i += 2;
      }
  }
}

/** The C family's string prefixes, which decide whether a backslash escapes and whether the string
 * can be substituted into at all.
 *
 * C# has four openers that all start a string of some kind, and they matter:
 *   "…"    ordinary, backslash escapes
 *   @"…"   verbatim, backslash is literal, a quote is written by doubling it
 *   $"…"   interpolated — and C# reads {{ as an escaped {, so a placeholder written {{NAME}} would
 *          be read by the language as the literal text {NAME}. The tool's own syntax collides with
 *          the language's, which is not something escaping can fix, so it is refused.
 *   """…""" raw, whose delimiter length is decided by the opening run. Refused.
 *
 * Java has "…" and the """…""" text block, whose value depends on the indentation of the closing
 * delimiter. Refused. Go's raw string is opened by a backtick and needs nothing here. */
function openCFamilyString(source: string, i: number, language: LanguageId, quote: string, s: State) {
  if (quote === '`') { s.verbatim = true; return; }

  if ((language === 'csharp' || language === 'java') && source.slice(i, i + 3) === '"""') {
    s.triple = true;
    s.stringBlock = language === 'csharp'
      ? 'Rå stränglitteral i C#: avgränsarens längd bestäms av öppningen. Använd en vanlig eller verbatim sträng.'
      : 'Java text block: värdet beror på indraget vid den avslutande avgränsaren. Använd en vanlig sträng.';
    return;
  }
  if (language !== 'csharp') return;

  const before = source[i - 1], twoBefore = source[i - 2];
  const interpolated = before === '$' || (before === '@' && twoBefore === '$');
  if (before === '@' || (before === '$' && twoBefore === '@')) s.verbatim = true;
  if (interpolated) {
    s.stringBlock = 'Interpolerad C#-sträng: språket läser {{ som ett escapat {, så platshållaren skulle sväljas. Använd en vanlig sträng.';
  }
}

/** The old function's tail: turn the state at a position into an answer. */
function resolve(s: State, source: string, position: number, language: LanguageId): Context {
  if (language === 'yaml') {
    const block = yamlBlockScalar(source, position);
    if (block) return block;
  }
  if (position <= s.dollarUntil) return { quote: '', blocked: 'Dollarciterad SQL-sträng tolkar ingenting alls. Flytta värdet till en vanlig sträng med apostrofer.' };
  if (s.here) return { quote: '', blocked: language === 'shell' || language === 'hcl'
    ? 'Here-document: inget är citerat där, så escaping skulle förvanska värdet. Flytta det till en citerad sträng.'
    : 'PowerShell here-string: flytta värdet till en vanlig citerad sträng.' };
  if (s.regex) return { quote: '', blocked: 'Platshållare i ett reguljärt uttryck stöds inte. Bygg uttrycket av en citerad sträng i stället.' };
  if (s.stringBlock) return { quote: s.quote, blocked: s.stringBlock };
  if (s.raw || s.triple) return { quote: s.quote, blocked: 'Python raw-, f-, byte- eller trippelsträng: använd en vanlig sträng.' };
  if (s.blockComment || s.lineComment) return { quote: '', blocked: 'Platshållaren finns i en kommentar. Använd raw-läge endast efter granskning.' };
  // Do not attempt to parse nested template expressions or Bash command substitutions. Both look
  // backwards only as far as the nearest closer, rather than slicing the whole prefix, which was
  // the other half of the quadratic cost.
  if (s.quote === '`' && unclosed(source, position, '${', '}')) return { quote: s.quote, blocked: 'Platshållare inuti JavaScript-uttryck stöds inte automatiskt.' };
  if (language === 'shell' && s.quote === '"' && unclosed(source, position, '$(', ')')) return { quote: s.quote, blocked: 'Platshållare i kommandosubstitution stöds inte.' };
  return s.verbatim ? { quote: s.quote, verbatim: true } : { quote: s.quote };
}

/** True when `open` appears before `position` with no `close` between: the equivalent of the
 * /\$\{[^}]*$/ test the tail used to run over a slice of the whole source. */
function unclosed(source: string, position: number, open: string, close: string): boolean {
  for (let i = position - 1; i >= 0; i--) {
    if (source[i] === close) return false;
    if (source[i] === open[1] && source[i - 1] === open[0]) return true;
  }
  return false;
}

/** A YAML block scalar takes its value from indentation, not from quotes. Reads back to the
 * previous non-empty line rather than splitting the whole prefix into lines. */
function yamlBlockScalar(source: string, position: number): Context | null {
  const lineStart = source.lastIndexOf('\n', position - 1) + 1;
  const current = source.slice(lineStart, position);
  let end = lineStart - 1;
  while (end > 0) {
    const start = source.lastIndexOf('\n', end - 1) + 1;
    const line = source.slice(start, end);
    if (line.trim()) {
      if (/:\s*[|>][+-]?\d*\s*$/.test(line)) {
        const indent = line.length - line.trimStart().length;
        // Still inside while the placeholder's line is indented past the key that opened it.
        if (current.length - current.trimStart().length > indent) {
          return { quote: '', blocked: 'YAML-blockskalär: värdet styrs av indrag, inte av citattecken. Flytta det till en citerad sträng.' };
        }
      }
      return null;
    }
    end = start - 1;
  }
  return null;
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
  if (language === 'csharp' || language === 'java') {
    if (q !== '"') return { text: '', error: 'Värdet måste ligga i en sträng. En apostrof omger ett teckenliterall, inte ett värde.' };
    // @"…" has no escape sequences at all; a quote is written by doubling it, which is exactly why
    // it is used for Windows paths. Escaping the backslash there would write it into the value.
    if (context.verbatim) return { text: value.replace(/"/g, '""') };
    return { text: backslash(value, '"') };
  }
  if (language === 'go') {
    // Everything between backticks is literal, so a value goes in as it stands — but a raw string
    // has no way to write a backtick, and Go discards a carriage return inside one.
    if (q === '`') {
      if (value.includes('`')) return { text: '', error: 'En rå Go-sträng kan inte innehålla ett bakåtcitat. Använd en vanlig sträng med citattecken.' };
      if (value.includes('\r')) return { text: '', error: 'Go tar bort vagnretur i en rå sträng. Använd en vanlig sträng med citattecken.' };
      return { text: value };
    }
    if (q !== '"') return { text: '', error: 'Värdet måste ligga i en sträng. En apostrof omger ett teckenliterall, inte ett värde.' };
    return { text: backslash(value, '"') };
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

