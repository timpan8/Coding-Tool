import { describe, expect, it } from 'vitest';
import type { ScannerRule } from '../../types/models';
import { builtInRules, compileRules, entropy, fingerprint, maskExcerpt, mergeRules, scan } from './index';

const found = (text: string) => scan(text, builtInRules);
const ruleIds = (text: string) => found(text).map((f) => f.ruleId);

describe('built-in rules', () => {
  it('catches the report reproduction that the app used to call clean', () => {
    const ids = ruleIds('$username = "example.user"\n$password = "Hunter2!"\n$conn = "Server=sql01.corp.local;Pwd=Hunter2!"\n');
    expect(ids).toContain('secret-assignment');
    expect(ids).toContain('internal-host');
  });

  it.each([
    ['AKIAIOSFODNN7EXAMPLE', 'aws-key'],
    ['ghp_1234567890abcdefghijklmnopqrstuvwxyz', 'github-token'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'pem'],
    ['https://admin:hunter2@example.test/db', 'basic-auth-url'],
    ['host = "10.4.12.9"', 'private-ip'],
    ['\\\\fileserver\\payroll\\2026', 'unc-path'],
    ['contact = "anna.andersson@company.se"', 'email'],
    ['id = "19850505-1234"', 'personnummer'],
    ['tenantId = "9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730"', 'guid'],
  ])('flags %s', (text, expected) => {
    expect(ruleIds(text)).toContain(expected);
  });

  // The AI value has to keep the shape, or code that parses the value stops working in the copy the
  // AI is asked to reason about.
  it('offers an AI value of the same shape as the value it replaces', () => {
    const shaped = (text: string, id: string) => found(text).find((f) => f.ruleId === id)?.suggestedAiReplacement ?? '';
    expect(shaped('tenantId = "9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730"', 'guid'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Not the nil GUID: that reads as an unset value rather than as a stand-in.
    expect(shaped('tenantId = "9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730"', 'guid')).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(shaped('host = "10.4.12.9"', 'private-ip')).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(shaped('contact = "anna@company.se"', 'email')).toContain('@');
  });

  it('does not flag ordinary prose or an already sanitised example', () => {
    expect(found('# Skriver ut en rapport till skärmen och avslutar sedan programmet.')).toEqual([]);
    expect(found('$user = "example.user"')).toEqual([]);
  });

  it('leaves a value alone once a placeholder covers it', () => {
    expect(found('$password = "{{ADMIN_PASSWORD}}"')).toEqual([]);
  });

  // The entropy rule is the fallback for values nothing can name. A GUID reported as "random string"
  // gets <SECRET> for an AI value rather than a GUID, and a JWT used to be called one too.
  it('lets a rule that names the value win over the entropy fallback', () => {
    expect(ruleIds('tenantId = "9f2b1c04-7a3e-4d18-b6f5-2c8e91a4d730"')).toEqual(['guid']);
    // Bare, so the assignment rule stays out of it: between two rules that both name the value,
    // severity still decides, and "assigned to something called token" is the graver reading.
    expect(ruleIds('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toContain('jwt');
  });

  it('reports one finding per span, keeping the most severe rule', () => {
    // A long random password matches both the assignment rule and the entropy rule.
    const findings = found('$password = "Xk9mQ2vB7nR4tZ8w"');
    const spans = new Set(findings.map((f) => `${f.start}:${f.end}`));
    expect(spans.size).toBe(findings.length);
    expect(findings[0].severity).toBe('critical');
  });
});

describe('entropy', () => {
  it('separates generated strings from words and paths', () => {
    expect(entropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1);
    expect(entropy('kD8fJ2mQ9xL4vB7n')).toBeGreaterThan(3.5);
  });
  it('does not flag a long ordinary identifier', () => {
    expect(ruleIds('const applicationConfiguration = 1;')).not.toContain('builtin:entropy');
  });
});

describe('findings never carry the value', () => {
  it('masks the excerpt', () => {
    expect(maskExcerpt('SuperSecret123!')).toBe('Su•••••••••••3!');
    expect(maskExcerpt('ab')).toBe('••');
  });
  it('keeps the raw value out of every field', () => {
    const secret = 'Hunter2SuperSecret';
    for (const finding of found(`$password = "${secret}"`)) {
      expect(JSON.stringify(finding)).not.toContain(secret);
    }
  });
  it('fingerprints the same value to the same id and different values apart', () => {
    expect(fingerprint('r', 'value')).toBe(fingerprint('r', 'VALUE '));
    expect(fingerprint('r', 'a')).not.toBe(fingerprint('r', 'b'));
    expect(fingerprint('r', 'secret')).not.toContain('secret');
  });
});

describe('user-supplied expressions', () => {
  const custom = (pattern: string): ScannerRule => ({
    id: 'custom', name: 'Egen', pattern, flags: 'g', severity: 'low', category: 'configuration',
    explanation: '', enabled: true, builtIn: false,
  });

  it('treats a user pattern as a literal term, not an expression', () => {
    // Nothing a user types can compile to something that backtracks.
    expect(scan('a.c and abc', compileRules([custom('a.c')])).map((f) => f.start)).toEqual([0]);
    expect(scan('COMPANY.local', compileRules([custom('company.local')]))).toHaveLength(1);
  });

  it('completes immediately on input that would hang a backtracking expression', () => {
    // `(a|a)+b` as an expression took 138 seconds over 40 characters before user regexes were
    // dropped. As a literal term it is simply not found.
    const compiled = compileRules([custom('(a|a)+b')]);
    const started = performance.now();
    expect(scan('a'.repeat(4000), compiled)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('marks an empty or oversized term instead of matching everything', () => {
    expect(compileRules([custom('   ')])[0].invalid).toBeTruthy();
    expect(compileRules([custom('x'.repeat(300))])[0].invalid).toBeTruthy();
  });

  it('does not let a stored record claim built-in status to smuggle in an expression', () => {
    const impostor: ScannerRule = { ...custom('(a+)+$'), builtIn: true };
    const compiled = compileRules([impostor]);
    // Compiled as a literal, so it finds the text `(a+)+$` and nothing else.
    expect(scan('aaaa', compiled)).toEqual([]);
    expect(scan('literally (a+)+$ here', compiled)).toHaveLength(1);
  });

  it('caps the number of matches from one rule', () => {
    const text = 'a '.repeat(500);
    expect(scan(text, compileRules([custom('a')]), { maxMatchesPerRule: 10 })).toHaveLength(10);
  });

  it('does not loop forever on a zero-length match', () => {
    expect(() => scan('abc', compileRules([{ ...custom('x*'), id: 'builtin:entropy' }]))).not.toThrow();
  });

  it('skips a rule the user disabled', () => {
    expect(compileRules([{ ...custom('a'), enabled: false }])).toEqual([]);
  });
});

describe('mergeRules', () => {
  it('keeps a built-in disabled once the user disables it, and adds new built-ins', () => {
    const stored = [{ ...builtInRules[0], enabled: false }];
    const merged = mergeRules(stored);
    expect(merged.find((r) => r.id === builtInRules[0].id)?.enabled).toBe(false);
    expect(merged.length).toBe(builtInRules.length);
  });
  it('keeps the user own rules alongside the built-ins', () => {
    const own: ScannerRule = { id: 'mine', name: 'Min', pattern: 'x', flags: 'g', severity: 'low', category: 'configuration', explanation: '', enabled: true, builtIn: false };
    expect(mergeRules([own]).map((r) => r.id)).toContain('mine');
  });
});

describe('limits', () => {
  it('refuses input larger than the cap rather than blocking the page', () => {
    expect(scan('x'.repeat(600 * 1024), builtInRules)).toEqual([]);
  });
});
