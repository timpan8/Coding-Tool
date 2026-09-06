import { describe, expect, it } from 'vitest';
import { contextAt, escapeValue } from './escape';
import type { LanguageId } from '../../types/models';

/** Report F13, the C-family half. Each of these has at least one string form where a backslash is
 * not an escape, and getting that wrong writes the escape sequence into the value. */
const at = (source: string, language: LanguageId) => contextAt(source, source.indexOf('{{'), language);
const escape = (value: string, source: string, language: LanguageId) =>
  escapeValue(value, language, at(source, language));

describe('csharp', () => {
  it('reads the enclosing quote and escapes an ordinary string', () => {
    expect(at('var s = "{{V}}";', 'csharp').quote).toBe('"');
    expect(escape('a"b\\c\nd', 'var s = "{{V}}";', 'csharp').text).toBe('a\\"b\\\\c\\nd');
  });
  it('blocks both comment forms', () => {
    expect(at('// {{V}}', 'csharp').blocked).toBeTruthy();
    expect(at('/* {{V}} */', 'csharp').blocked).toBeTruthy();
  });
  it('doubles the quote in a verbatim string and leaves the backslash alone', () => {
    // @"..." has no backslash escapes at all, which is exactly why it is used for Windows paths.
    const source = 'var p = @"{{V}}";';
    expect(escape('C:\\Temp\\x', source, 'csharp')).toEqual({ text: 'C:\\Temp\\x' });
    expect(escape('say "hi"', source, 'csharp').text).toBe('say ""hi""');
  });
  it('refuses a placeholder inside an interpolated string', () => {
    // C# reads {{ as an escaped {, so the placeholder itself would be swallowed by the language.
    expect(at('var s = $"{{V}}";', 'csharp').blocked).toBeTruthy();
    expect(at('var s = $@"{{V}}";', 'csharp').blocked).toBeTruthy();
    expect(at('var s = @$"{{V}}";', 'csharp').blocked).toBeTruthy();
  });
  it('blocks a raw string literal', () => {
    expect(at('var s = """\n{{V}}\n""";', 'csharp').blocked).toBeTruthy();
  });
  it('refuses a value outside a string', () => {
    expect(escape('x', 'var s = {{V}};', 'csharp').error).toBeTruthy();
  });
});

describe('go', () => {
  it('escapes an interpreted string', () => {
    expect(escape('a"b\\c\nd', 's := "{{V}}"', 'go').text).toBe('a\\"b\\\\c\\nd');
  });
  it('keeps a raw string raw, and refuses what a raw string cannot hold', () => {
    // Everything between backticks is literal, so a value with no backtick goes in as it stands.
    const source = 's := `{{V}}`';
    expect(escape('C:\\Temp "x"', source, 'go')).toEqual({ text: 'C:\\Temp "x"' });
    expect(escape('has ` backtick', source, 'go').error).toBeTruthy();
  });
  it('blocks both comment forms', () => {
    expect(at('// {{V}}', 'go').blocked).toBeTruthy();
    expect(at('/* {{V}} */', 'go').blocked).toBeTruthy();
  });
  it('refuses a value outside a string', () => {
    expect(escape('x', 's := {{V}}', 'go').error).toBeTruthy();
  });
});

describe('java', () => {
  it('escapes an ordinary string', () => {
    expect(escape('a"b\\c\nd', 'String s = "{{V}}";', 'java').text).toBe('a\\"b\\\\c\\nd');
  });
  it('blocks a text block', () => {
    expect(at('String s = """\n{{V}}\n""";', 'java').blocked).toBeTruthy();
  });
  it('blocks both comment forms', () => {
    expect(at('// {{V}}', 'java').blocked).toBeTruthy();
    expect(at('/* {{V}} */', 'java').blocked).toBeTruthy();
  });
  it('refuses a value outside a string', () => {
    expect(escape('x', 'int n = {{V}};', 'java').error).toBeTruthy();
  });
});

describe('the C family agrees on what a single quote is', () => {
  it('does not treat an apostrophe as a string opener', () => {
    // 'x' is a character literal, not a string. Treating it as a quote would leave the lexer
    // inside a string that never closes, and the rest of the file would be read wrongly.
    for (const language of ['csharp', 'go', 'java'] as LanguageId[]) {
      expect(at("char c = 'a';\nString s = \"{{V}}\";", language).quote).toBe('"');
    }
  });
});
