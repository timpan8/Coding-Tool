import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { contextAt, contextsAt, escapeValue } from './escape';
import type { LanguageId } from '../../types/models';
import type { Context } from './escape';

/** Oracle for contextAt. The lexer decides escape-vs-block, so a rewrite of it (report P3 wants a
 * single pass instead of the current O(n·m) rescan) must reproduce every case below exactly.
 * Only PowerShell and JavaScript were covered before; shell, YAML and JSON were not. */
const at = (source: string, language: LanguageId) => contextAt(source, source.indexOf('{{'), language);

describe('contextAt · shell', () => {
  it('reads the enclosing quote', () => {
    expect(at('X="{{V}}"', 'shell').quote).toBe('"');
    expect(at("X='{{V}}'", 'shell').quote).toBe("'");
    expect(at('X={{V}}', 'shell').quote).toBe('');
  });
  it('treats a backslash as literal inside single quotes but as an escape inside double quotes', () => {
    // POSIX: nothing is escaped inside '...', so the quote closes and the placeholder is unquoted.
    expect(at("a='b\\' {{V}}", 'shell').quote).toBe('');
    // Inside "...", the backslash escapes the next character, so this quote is still open.
    expect(at('a="b\\" {{V}}"', 'shell').quote).toBe('"');
  });
  it('blocks a placeholder in a comment', () => {
    expect(at('# {{V}}', 'shell').blocked).toBeTruthy();
    expect(at('echo hi # {{V}}', 'shell').blocked).toBeTruthy();
  });
  it('blocks command substitution rather than guessing', () => {
    expect(at('X="$( {{V}}', 'shell').blocked).toBeTruthy();
  });
  it('does not treat a hash inside a string as a comment', () => {
    expect(at('X="# not a comment" Y="{{V}}"', 'shell').quote).toBe('"');
  });
});

describe('contextAt · yaml', () => {
  it('reads the enclosing quote', () => {
    expect(at('k: "{{V}}"', 'yaml').quote).toBe('"');
    expect(at("k: '{{V}}'", 'yaml').quote).toBe("'");
    expect(at('k: {{V}}', 'yaml').quote).toBe('');
  });
  it('honours the doubled single quote as YAML escape', () => {
    expect(at("k: 'it''s {{V}}'", 'yaml').quote).toBe("'");
  });
  it('blocks a placeholder in a comment', () => {
    expect(at('# {{V}}', 'yaml').blocked).toBeTruthy();
    expect(at('k: v # {{V}}', 'yaml').blocked).toBeTruthy();
  });
});

describe('contextAt · json', () => {
  it('reads the enclosing quote and reports an unquoted position', () => {
    expect(at('{"k":"{{V}}"}', 'json').quote).toBe('"');
    expect(at('{"k":{{V}}}', 'json').quote).toBe('');
  });
  it('does not treat a hash as a comment, since JSON has none', () => {
    expect(at('{"a":"#","k":"{{V}}"}', 'json').quote).toBe('"');
  });
  it('tracks the backslash escape so an escaped quote does not close the string', () => {
    expect(at('{"k":"a\\" {{V}}"}', 'json').quote).toBe('"');
  });
  it('refuses to place a value outside a string', () => {
    expect(escapeValue('x', 'json', { quote: '' }).error).toBeTruthy();
  });
});

describe('contextAt · plaintext and xml short-circuit', () => {
  it('returns an unquoted context without lexing', () => {
    for (const language of ['plaintext', 'xml'] as LanguageId[]) {
      expect(at('# "{{V}}"', language)).toEqual({ quote: '' });
    }
  });
});

/** Report K-f. Contexts the lexer did not know about, where it fell through to a guess rather than
 * blocking. Each one can change what the surrounding code means. */
describe('contextAt · contexts that must be blocked rather than guessed', () => {
  it('blocks a shell here-document', () => {
    // Inside <<EOF nothing is quoted, so escaping for a quote would corrupt the value.
    expect(at('cat <<EOF\n{{V}}\nEOF\n', 'shell').blocked).toBeTruthy();
    expect(at("cat <<'EOF'\n{{V}}\nEOF\n", 'shell').blocked).toBeTruthy();
    expect(at('cat <<-EOF\n{{V}}\nEOF\n', 'shell').blocked).toBeTruthy();
  });
  it('reads normally again after the here-document ends', () => {
    expect(at('cat <<EOF\nplain\nEOF\nX="{{V}}"\n', 'shell').quote).toBe('"');
  });
  it('blocks a JavaScript regular expression literal', () => {
    // A slash is not a quote, and backslash escaping differs.
    expect(at('const r = /{{V}}/g;', 'javascript').blocked).toBeTruthy();
  });
  it('does not mistake division for a regular expression', () => {
    expect(at('const a = b / c;\nconst d = "{{V}}";', 'javascript').quote).toBe('"');
  });
  it('blocks a YAML block scalar', () => {
    expect(at('script: |\n  {{V}}\n', 'yaml').blocked).toBeTruthy();
    expect(at('script: >\n  {{V}}\n', 'yaml').blocked).toBeTruthy();
    expect(at('script: |-\n  {{V}}\n', 'yaml').blocked).toBeTruthy();
  });
  it('blocks an XML comment and a CDATA section', () => {
    expect(at('<!-- {{V}} -->', 'xml').blocked).toBeTruthy();
    expect(at('<![CDATA[{{V}}]]>', 'xml').blocked).toBeTruthy();
  });
  it('still escapes ordinary XML text', () => {
    expect(at('<user>{{V}}</user>', 'xml')).toEqual({ quote: '' });
  });
});

/** Report P3. The scan used to restart from position 0 for every placeholder. It is one pass now,
 * paused at each position, which is a change to the most safety-critical module in the app: getting
 * it wrong means escaping a value for the wrong context, silently.
 *
 * Below is the implementation as it stood before that change, copied here verbatim and living
 * nowhere else. The case tests above say what the lexer should do; this says the rewrite did not
 * change what it does for anything else either. It is dead weight the day the rewrite is trusted,
 * and worth every line until then.
 *
 * Two deliberate differences the property test therefore has to tolerate: none. If this ever needs
 * an exception, the exception is the bug. */
const SQ = String.fromCharCode(39), BS = String.fromCharCode(92), NL = String.fromCharCode(10), TRIPLE = SQ + SQ + SQ;
function referenceContextAt(source: string, position: number, language: LanguageId): Context {
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

describe('contextAt · the single pass agrees with the old scan-per-position', () => {
  // Frozen on purpose: these are the languages the reference implementation knew. A language added
  // after it cannot be compared against it — the reference has no opinion about C#'s verbatim
  // strings or Go's backticks, so adding one here would fail for a reason that is not a bug. New
  // languages are covered by their own case tests and by the batching property below.
  const languages: LanguageId[] = ['powershell', 'javascript', 'typescript', 'python', 'json', 'xml', 'yaml', 'shell', 'dotenv', 'hcl', 'sql', 'plaintext'];
  // Chosen for what the lexer branches on, so a random source lands inside strings, comments,
  // here-documents and escapes rather than in plain prose.
  const pieces = ['"', SQ, '`', BS, '#', '//', '/*', '*/', '--', '<<EOF', NL, 'EOF', '${', '}', '$(', ')', '@"', '"@', 'x = ', '|', '  ', '<!--', '-->', '$t$', 'r"', TRIPLE, '/', ': ', '[|]', 'k:'];

  it('gives the same answer as the old implementation, for every language and position', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...pieces), { minLength: 1, maxLength: 40 }).map((parts) => parts.join('')),
        fc.constantFrom(...languages),
        fc.array(fc.nat(300), { minLength: 1, maxLength: 12 }),
        (source, language, raw) => {
          const positions = raw.map((n) => n % (source.length + 1));
          const batch = contextsAt(source, positions, language);
          positions.forEach((position, index) => {
            expect(batch[index]).toEqual(referenceContextAt(source, position, language));
            // And asking one at a time still goes through the same path.
            expect(contextAt(source, position, language)).toEqual(batch[index]);
          });
        },
      ),
      // 500 was not enough: the dollar-quote overwrite this test found needed about 1300 cases to
      // surface. 20000 costs two seconds, which is worth it for the module that decides escaping.
      { numRuns: 20000 },
    );
  });

  it('answers in the caller order, whatever order the positions arrive in', () => {
    const source = 'a = "one"' + NL + '# {{X}}' + NL + 'b = "{{Y}}"' + NL;
    const positions = [source.indexOf('{{Y}}'), source.indexOf('{{X}}'), source.indexOf('{{Y}}')];
    const batch = contextsAt(source, positions, 'powershell');
    expect(batch[0]).toEqual({ quote: '"' });
    expect(batch[1].blocked).toBeTruthy();
    expect(batch[2]).toEqual(batch[0]);
  });
});

/** The half of the rewrite that does apply to every language, old and new: asking for many
 * positions in one pass must give the same answers as asking for each on its own. */
describe('contextsAt · batching is invisible, in every language', () => {
  const all: LanguageId[] = ['powershell', 'javascript', 'typescript', 'python', 'json', 'xml', 'yaml', 'shell', 'dotenv', 'hcl', 'sql', 'csharp', 'go', 'java', 'plaintext'];
  const pieces = ['"', SQ, '`', BS, '@"', '$"', '"""', '#', '//', '/*', '*/', '--', 'x = ', NL, '  ', '${', '}', 'a', ';'];

  it('agrees with one call per position', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...pieces), { minLength: 1, maxLength: 40 }).map((parts) => parts.join('')),
        fc.constantFrom(...all),
        fc.array(fc.nat(300), { minLength: 1, maxLength: 12 }),
        (source, language, raw) => {
          const positions = raw.map((n) => n % (source.length + 1));
          const batch = contextsAt(source, positions, language);
          positions.forEach((position, index) => {
            expect(batch[index]).toEqual(contextAt(source, position, language));
          });
        },
      ),
      { numRuns: 5000 },
    );
  });
});
