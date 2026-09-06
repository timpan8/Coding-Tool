import { describe, expect, it } from 'vitest';
import { expandToLiteral } from './literal';

const at = (source: string, word: string) => {
  const start = source.indexOf(word);
  return expandToLiteral(source, start, start + word.length, 'powershell');
};

describe('expandToLiteral', () => {
  it('takes the whole value when a word boundary cut it short', () => {
    // The report's case: double-clicking selects Hunter2 and leaves the exclamation mark behind,
    // so half the password stays in the template.
    const result = at('$p = "Hunter2!"', 'Hunter2');
    expect(result.text).toBe('Hunter2!');
    expect(result.widened).toBe(true);
  });

  it('takes the whole host name, not the first label', () => {
    expect(at('$s = "sql01.corp.local"', 'sql01').text).toBe('sql01.corp.local');
  });

  it('leaves a selection that already covers the literal alone', () => {
    const result = at('$p = "Hunter2"', 'Hunter2');
    expect(result).toMatchObject({ text: 'Hunter2', widened: false });
  });

  it('does not widen a selection outside any string', () => {
    const result = at('$total = 42', 'total');
    expect(result).toMatchObject({ text: 'total', widened: false });
  });

  it('does not reach across two literals', () => {
    const source = '$a = "one"; $b = "two"';
    const start = source.indexOf('one');
    const result = expandToLiteral(source, start, source.indexOf('two') + 3, 'powershell');
    expect(result.widened).toBe(false);
  });

  it('keeps the quotes out of the value', () => {
    expect(at('$p = "C:\\Temp\\Out"', 'Temp').text).toBe('C:\\Temp\\Out');
  });
});
