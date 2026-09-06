import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { exampleFor, isExampleValue, shapeOf, sharedAiValue, takenAiValues, uniqueExample } from './examples';
import { binding } from '../../test/fixtures/factories';

describe('shapeOf', () => {
  it.each([
    ['anna.andersson@company.se', 'identity', 'email'],
    ['CORP\\svc_adsync', 'identity', 'netbios-user'],
    ['10.4.12.9', 'infrastructure', 'ip'],
    ['9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730', 'configuration', 'guid'],
    ['\\\\fs01\\payroll\\2026', 'environment', 'unc'],
    ['C:\\Scripts\\AdSync', 'environment', 'windows-path'],
    ['/home/tim/scripts', 'environment', 'unix-path'],
    ['sql01.corp.local', 'infrastructure', 'fqdn'],
    ['SQL01', 'infrastructure', 'host'],
    ['Hunter2!', 'secret', 'plain'],
    ['svc_adsync', 'identity', 'plain'],
  ] as const)('reads %s as %s', (value, category, shape) => {
    expect(shapeOf(value, category)).toBe(shape);
  });
});

describe('exampleFor', () => {
  it('keeps the plain defaults for the first of a series and numbers the rest', () => {
    expect(exampleFor('identity', 'svc_adsync', 1)).toBe('example.user');
    expect(exampleFor('identity', 'svc_adsync', 2)).toBe('example.user2');
    expect(exampleFor('secret', 'Hunter2!', 1)).toBe('<PASSWORD>');
    expect(exampleFor('secret', 'Hunter2!', 3)).toBe('<PASSWORD_3>');
  });

  it('answers in the shape of the value', () => {
    expect(exampleFor('identity', 'anna@company.se', 2)).toBe('anna.exempel2@example.com');
    expect(exampleFor('infrastructure', '10.4.12.9', 1)).toBe('192.0.2.10');
    expect(exampleFor('configuration', '9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730', 7)).toMatch(/^11111111-2222-4333-8444-000000000007$/);
    expect(exampleFor('environment', '\\\\fs01\\share', 1)).toBe('\\\\SRV-EXAMPLE01\\share');
    expect(exampleFor('infrastructure', 'SQL01', 3)).toBe('SRV-EXAMPLE03');
  });

  it('never produces a value that could be real', () => {
    const categories = ['secret', 'identity', 'infrastructure', 'environment', 'configuration', 'testdata'] as const;
    fc.assert(fc.property(fc.constantFrom(...categories), fc.string({ minLength: 1, maxLength: 40 }), fc.integer({ min: 1, max: 500 }), (category, value, n) => {
      const example = exampleFor(category, value, n);
      expect(example.length).toBeGreaterThan(3);
      // The value's own text never leaks into the stand-in.
      if (value.trim().length >= 4) expect(example.toLowerCase()).not.toContain(value.trim().toLowerCase());
      expect(example).toMatch(/example|exempel|192\.0\.2\.|198\.51\.100\.|11111111-2222|<[A-Z_]+(?:_\d+)?>/i);
      // And the scanner recognises every one of them as a stand-in, so it never reports its own.
      expect(isExampleValue(example)).toBe(true);
    }));
  });
});

describe('isExampleValue', () => {
  it('knows the stand-ins and nothing else', () => {
    for (const value of ['example.user', 'anna.exempel2@example.com', '<PASSWORD_2>', '192.0.2.10', '11111111-2222-4333-8444-000000000003', 'C:\\Temp\\Example2', 'server.example.test', 'SRV-EXAMPLE01', '/opt/example/project01']) {
      expect(isExampleValue(value), value).toBe(true);
    }
    // AWS's documented sample key ends in EXAMPLE and must still read as a key.
    for (const value of ['svc_adsync', 'Hunter2!', 'sql01.corp.local', '10.4.12.9', 'anna@company.se', 'C:\\Scripts\\AdSync', 'exemplar.se', 'AKIAIOSFODNN7EXAMPLE']) {
      expect(isExampleValue(value), value).toBe(false);
    }
  });
});

describe('uniqueExample', () => {
  it('keeps a free suggestion, numbers a taken placeholder, and falls back to the shape', () => {
    const taken = new Set(['<password>', '<password_2>', 'server.example.test']);
    expect(uniqueExample('<SECRET>', 'secret', 'x', taken)).toBe('<SECRET>');
    expect(uniqueExample('<PASSWORD>', 'secret', 'x', taken)).toBe('<PASSWORD_3>');
    expect(uniqueExample('server.example.test', 'infrastructure', 'sql01.corp.local', taken)).toBe('server2.example.test');
    expect(uniqueExample(undefined, 'identity', 'anna@company.se', new Set())).toBe('anna.exempel@example.com');
  });

  it('follows the value\'s shape over a suggestion of another shape', () => {
    expect(uniqueExample('SRV-EXAMPLE01', 'infrastructure', 'dc01.corp.local', new Set())).toBe('server.example.test');
    expect(uniqueExample('SRV-EXAMPLE01', 'infrastructure', 'DC01', new Set())).toBe('SRV-EXAMPLE01');
    expect(uniqueExample('10.0.0.1', 'infrastructure', '10.4.12.9', new Set())).toBe('10.0.0.1');
  });

  it('never returns a value already in use, whatever is taken', () => {
    const categories = ['secret', 'identity', 'infrastructure', 'environment', 'configuration', 'testdata'] as const;
    fc.assert(fc.property(
      fc.constantFrom(...categories),
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.array(fc.integer({ min: 1, max: 30 }), { maxLength: 40 }),
      fc.option(fc.constantFrom('<PASSWORD>', '<SECRET>', 'example.user', '10.0.0.1'), { nil: undefined }),
      (category, value, taken, preferred) => {
        const used = new Set(taken.map((n) => exampleFor(category, value, n).toLowerCase()));
        if (preferred) used.add(preferred.toLowerCase());
        const example = uniqueExample(preferred, category, value, used);
        expect(used.has(example.toLowerCase())).toBe(false);
      },
    ));
  });

  it('reads the taken set from bindings without regard to case', () => {
    const taken = takenAiValues([binding({ aiReplacement: 'Example.User' }), binding({ id: 'b', aiReplacement: '' })]);
    expect(taken.has('example.user')).toBe(true);
    expect(taken.size).toBe(1);
  });
});

describe('sharedAiValue', () => {
  it('names the other binding that uses the same AI value', () => {
    const a = binding({ id: 'a', name: 'A', aiReplacement: '<PASSWORD>' });
    const b = binding({ id: 'b', name: 'B', aiReplacement: '<password>' });
    expect(sharedAiValue(a, [a, b])).toBe('B');
    expect(sharedAiValue(binding({ id: 'c', aiReplacement: '<OTHER>' }), [a, b])).toBeUndefined();
  });
});
