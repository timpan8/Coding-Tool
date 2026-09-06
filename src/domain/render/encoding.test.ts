import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { base64Runs, base64Utf16le, base64Utf8, decodeBase64Variants, encodedVariants } from './encoding';

describe('encoded variants', () => {
  it('covers the forms a value takes in real code', () => {
    const forms = new Map(encodedVariants('P@ss word/1').map(v => [v.encoding, v.text]));
    expect(forms.get('url')).toBe('P%40ss%20word%2F1');
    expect(forms.get('base64')).toBe(base64Utf8('P@ss word/1'));
    expect(forms.get('base64-utf16')).toBe(base64Utf16le('P@ss word/1'));
    expect(encodedVariants('server.example.test').map(v => v.encoding)).toContain('regex');
    expect(new Map(encodedVariants("O'Brien").map(v => [v.encoding, v.text])).get('doubled-quote')).toBe("O''Brien");
    expect(new Map(encodedVariants('a"b').map(v => [v.encoding, v.text])).get('backtick')).toBe('a`"b');
  });

  it('never claims a value is its own variant', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), value => {
      for (const variant of encodedVariants(value)) expect(variant.text).not.toBe(value);
    }));
  });

  // The point of the whole file: a value that has been base64'd is still that value.
  it('finds a value again inside a base64 run, both encodings', () => {
    const secret = 'Hunter2-Very-Secret!';
    for (const encode of [base64Utf8, base64Utf16le]) {
      const run = encode(`$password = "${secret}"; Write-Host done`);
      const found = base64Runs(`Invoke-Command -EncodedCommand ${run}`);
      expect(found).toHaveLength(1);
      expect(decodeBase64Variants(found[0].run).some(text => text.includes(secret))).toBe(true);
    }
  });

  it('leaves short identifiers alone', () => {
    expect(base64Runs('const id = "abc123";')).toEqual([]);
    expect(base64Runs('x'.repeat(31))).toEqual([]);
    expect(base64Runs('x'.repeat(32))).toHaveLength(1);
  });

  it('decodes a run that starts mid-stream', () => {
    fc.assert(fc.property(fc.string({ minLength: 8, maxLength: 30 }).filter(s => /^[\x20-\x7e]+$/.test(s)), value => {
      const run = base64Utf8(`prefix:${value}:suffix`);
      expect(decodeBase64Variants(run).some(text => text.includes(value))).toBe(true);
    }));
  });
});
