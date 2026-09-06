import { describe, expect, it } from 'vitest';
import { contextAt, escapeValue } from './escape';
import type { LanguageId } from '../../types/models';

/** Report F13, the config half. These are the files a deployment secret is written into, and two of
 * the three have no escaping to speak of — which is a reason to refuse, not to guess. */
const at = (source: string, language: LanguageId) => contextAt(source, source.indexOf('{{'), language);
const escape = (value: string, source: string, language: LanguageId) =>
  escapeValue(value, language, at(source, language));

describe('toml', () => {
  it('escapes a basic string', () => {
    expect(escape('a"b\\c\nd', 'k = "{{V}}"', 'toml').text).toBe('a\\"b\\\\c\\nd');
  });
  it('leaves a literal string literal, and refuses what one cannot hold', () => {
    // '…' has no escape sequences at all, so it cannot contain an apostrophe or a newline.
    expect(escape('C:\\Temp\\x', "k = '{{V}}'", 'toml')).toEqual({ text: 'C:\\Temp\\x' });
    expect(escape("it's", "k = '{{V}}'", 'toml').error).toBeTruthy();
    expect(escape('two\nlines', "k = '{{V}}'", 'toml').error).toBeTruthy();
  });
  it('blocks both multi-line forms', () => {
    expect(at('k = """\n{{V}}\n"""', 'toml').blocked).toBeTruthy();
    expect(at("k = '''\n{{V}}\n'''", 'toml').blocked).toBeTruthy();
  });
  it('blocks a comment', () => {
    expect(at('# {{V}}', 'toml').blocked).toBeTruthy();
    expect(at('k = 1 # {{V}}', 'toml').blocked).toBeTruthy();
  });
  it('allows only a number outside a string', () => {
    expect(escape('42', 'k = {{V}}', 'toml')).toEqual({ text: '42' });
    expect(escape('hunter2', 'k = {{V}}', 'toml').error).toBeTruthy();
  });
});

describe('ini', () => {
  it('blocks a comment in both forms', () => {
    expect(at('; {{V}}', 'ini').blocked).toBeTruthy();
    expect(at('# {{V}}', 'ini').blocked).toBeTruthy();
  });
  it('allows a simple value and refuses everything a parser might disagree about', () => {
    // INI has no standard, so quotes may be stripped or kept and there is no escape at all.
    expect(escape('hunter2', 'password={{V}}', 'ini')).toEqual({ text: 'hunter2' });
    for (const value of ['has"quote', "has'quote", 'two\nlines', 'trailing ', 'has;semicolon', 'has#hash'])
      expect(escape(value, 'password={{V}}', 'ini').error).toBeTruthy();
  });
  it('treats a quote as an ordinary character rather than a string', () => {
    // Quoting is a convention in INI, not syntax; a quote must not open a string that never closes.
    expect(at('a="x"\npassword={{V}}', 'ini').quote).toBe('');
  });
});

describe('dockerfile', () => {
  it('escapes a quoted ENV value', () => {
    expect(escape('a"b\\c', 'ENV KEY="{{V}}"', 'dockerfile').text).toBe('a\\"b\\\\c');
  });
  it('refuses a dollar, which the builder expands in a value whatever the quotes', () => {
    expect(escape('p$ss', 'ENV KEY="{{V}}"', 'dockerfile').error).toBeTruthy();
    expect(escape('p$ss', "ENV KEY='{{V}}'", 'dockerfile').error).toBeTruthy();
  });
  it('blocks a comment, which is a comment only at the start of a line', () => {
    expect(at('# {{V}}', 'dockerfile').blocked).toBeTruthy();
    // A hash inside a value is an ordinary character, not the start of a comment.
    expect(at('ENV A="x#y"\nENV KEY="{{V}}"', 'dockerfile').quote).toBe('"');
  });
  it('blocks a placeholder on a RUN line, which the shell parses after the builder', () => {
    expect(at('RUN echo "{{V}}"', 'dockerfile').blocked).toBeTruthy();
    expect(at('CMD ["sh", "-c", "{{V}}"]', 'dockerfile').blocked).toBeTruthy();
    expect(at('ENTRYPOINT {{V}}', 'dockerfile').blocked).toBeTruthy();
  });
  it('refuses an unquoted value that would not survive the line', () => {
    expect(escape('plain', 'ENV KEY={{V}}', 'dockerfile')).toEqual({ text: 'plain' });
    for (const value of ['has space', 'has"quote', 'two\nlines', 'has\\backslash'])
      expect(escape(value, 'ENV KEY={{V}}', 'dockerfile').error).toBeTruthy();
  });
});
