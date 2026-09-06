import { describe, expect, it } from 'vitest';
import { contextAt, escapeValue } from './escape';
import type { LanguageId } from '../../types/models';

/** Report F13. Every added language needs its own escaping rule and its own tests, or it falls
 * through to the generic rule at the end of escapeValue and is escaped for the wrong syntax.
 *
 * These three are where secrets actually live: .env files, Terraform, and SQL connection setup. */
const at = (source: string, language: LanguageId) => contextAt(source, source.indexOf('{{'), language);
const escape = (value: string, source: string, language: LanguageId) =>
  escapeValue(value, language, at(source, language));

describe('dotenv', () => {
  it('reads the enclosing quote', () => {
    expect(at('A="{{V}}"', 'dotenv').quote).toBe('"');
    expect(at("A='{{V}}'", 'dotenv').quote).toBe("'");
    expect(at('A={{V}}', 'dotenv').quote).toBe('');
  });
  it('blocks a comment', () => {
    expect(at('# {{V}}', 'dotenv').blocked).toBeTruthy();
    expect(at('A=b # {{V}}', 'dotenv').blocked).toBeTruthy();
  });
  it('escapes backslash, quote and newline inside double quotes', () => {
    expect(escape('a"b\\c\nd', 'A="{{V}}"', 'dotenv').text).toBe('a\\"b\\\\c\\nd');
  });
  it('refuses a dollar inside double quotes, where parsers expand variables', () => {
    // Whether ${HOME} expands depends on the parser, so the value is refused rather than guessed at.
    expect(escape('p$ssw0rd', 'A="{{V}}"', 'dotenv').error).toBeTruthy();
    // Single quotes are literal everywhere, so the same value is fine there.
    expect(escape('p$ssw0rd', "A='{{V}}'", 'dotenv')).toEqual({ text: 'p$ssw0rd' });
  });
  it('refuses a value a single-quoted string cannot hold', () => {
    expect(escape("it's", "A='{{V}}'", 'dotenv').error).toBeTruthy();
    expect(escape('two\nlines', "A='{{V}}'", 'dotenv').error).toBeTruthy();
  });
  it('refuses an unquoted value that would not survive the line', () => {
    for (const value of ['has space', 'has#hash', 'two\nlines', 'has"quote'])
      expect(escape(value, 'A={{V}}', 'dotenv').error).toBeTruthy();
    expect(escape('plain-value_1', 'A={{V}}', 'dotenv')).toEqual({ text: 'plain-value_1' });
  });
});

describe('hcl · terraform', () => {
  it('reads the enclosing quote and treats an apostrophe as an ordinary character', () => {
    expect(at('x = "{{V}}"', 'hcl').quote).toBe('"');
    // HCL has no single-quoted strings; an apostrophe must not open one.
    expect(at("# it's here\nx = \"{{V}}\"", 'hcl').quote).toBe('"');
  });
  it('blocks all three comment forms', () => {
    expect(at('# {{V}}', 'hcl').blocked).toBeTruthy();
    expect(at('// {{V}}', 'hcl').blocked).toBeTruthy();
    expect(at('/* {{V}} */', 'hcl').blocked).toBeTruthy();
  });
  it('blocks a heredoc, where nothing is quoted', () => {
    expect(at('x = <<EOT\n{{V}}\nEOT\n', 'hcl').blocked).toBeTruthy();
    expect(at('x = <<-EOT\n{{V}}\nEOT\n', 'hcl').blocked).toBeTruthy();
  });
  it('neutralises interpolation and directive markers', () => {
    // ${...} and %{...} are evaluated by Terraform; doubling the sigil is how HCL writes them
    // literally. Without this a value could be made to read another variable.
    expect(escape('${var.secret}', 'x = "{{V}}"', 'hcl').text).toBe('$${var.secret}');
    expect(escape('%{if true}', 'x = "{{V}}"', 'hcl').text).toBe('%%{if true}');
    expect(escape('costs $5', 'x = "{{V}}"', 'hcl').text).toBe('costs $5');
  });
  it('escapes the usual characters inside a string', () => {
    expect(escape('a"b\\c\nd', 'x = "{{V}}"', 'hcl').text).toBe('a\\"b\\\\c\\nd');
  });
  it('refuses a value outside a string, which would be an expression', () => {
    expect(escape('x', 'x = {{V}}', 'hcl').error).toBeTruthy();
  });
});

describe('sql', () => {
  it('reads the enclosing quote', () => {
    expect(at("SELECT '{{V}}'", 'sql').quote).toBe("'");
    expect(at('SELECT {{V}}', 'sql').quote).toBe('');
  });
  it('blocks both comment forms', () => {
    expect(at('-- {{V}}', 'sql').blocked).toBeTruthy();
    expect(at('/* {{V}} */', 'sql').blocked).toBeTruthy();
  });
  it('doubles the apostrophe, which is the only portable escape', () => {
    expect(escape("O'Brien", "SELECT '{{V}}'", 'sql').text).toBe("O''Brien");
  });
  it('refuses a backslash, because dialects disagree about it', () => {
    // MySQL treats \ as an escape by default; PostgreSQL and the standard do not. Either choice is
    // wrong somewhere, so the value is refused.
    expect(escape('C:\\Temp', "SELECT '{{V}}'", 'sql').error).toBeTruthy();
  });
  it('refuses a double-quoted position, which quotes an identifier and not a value', () => {
    expect(escape('users', 'SELECT * FROM "{{V}}"', 'sql').error).toBeTruthy();
  });
  it('blocks a dollar-quoted string, which has no escapes at all', () => {
    expect(at('SELECT $tag${{V}}$tag$', 'sql').blocked).toBeTruthy();
  });
  it('allows only a number outside a string', () => {
    expect(escape('42', 'LIMIT {{V}}', 'sql')).toEqual({ text: '42' });
    expect(escape('42; DROP TABLE users', 'LIMIT {{V}}', 'sql').error).toBeTruthy();
  });
});
