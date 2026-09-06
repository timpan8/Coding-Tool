import { describe, expect, it } from 'vitest';
import { coverage, stringLiterals } from './coverage';

describe('stringLiterals', () => {
  it('finds quoted values and ignores comments', () => {
    const source = '# "not counted"\n$a = "one"\n$b = \'two\'\n';
    expect(stringLiterals(source, 'powershell').map((l) => l.text)).toEqual(['one', 'two']);
  });
  it('does not let an escaped quote end a string', () => {
    expect(stringLiterals('const a = "x\\"y";', 'javascript').map((l) => l.text)).toEqual(['x\\"y']);
  });
  it('reads only double quotes in JSON, where there is no comment syntax', () => {
    expect(stringLiterals('{"k":"v","#":"w"}', 'json').map((l) => l.text)).toEqual(['k', 'v', '#', 'w']);
  });
  it('returns nothing for a language with no string syntax to speak of', () => {
    expect(stringLiterals('anything at all', 'plaintext')).toEqual([]);
  });
});

describe('coverage', () => {
  it('reports nothing protected when no placeholder is present', () => {
    expect(coverage('$p = "Hunter2!"\n$u = "corp"\n', 'powershell')).toMatchObject({ literals: 2, bound: 0 });
  });
  it('counts a literal as protected only when a placeholder covers all of it', () => {
    const result = coverage('$p = "{{PASSWORD}}"\n$u = "corp"\n', 'powershell');
    expect(result).toMatchObject({ literals: 2, bound: 1 });
    expect(result.unbound.map((l) => l.text)).toEqual(['corp']);
  });
  it('does not count a partly replaced value as protected', () => {
    // The selection missed the trailing character, so half the secret is still in the template.
    expect(coverage('$p = "{{PASSWORD}}!"\n', 'powershell')).toMatchObject({ literals: 1, bound: 0 });
  });
  it('ignores empty strings, which hold no value to protect', () => {
    expect(coverage('$a = ""\n$b = "x"\n', 'powershell')).toMatchObject({ literals: 1, bound: 0 });
  });
});
