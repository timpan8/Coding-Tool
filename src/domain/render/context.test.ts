import { describe, expect, it } from 'vitest';
import { contextAt, escapeValue } from './escape';
import type { LanguageId } from '../../types/models';

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
