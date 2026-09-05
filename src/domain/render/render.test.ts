import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { binding } from '../../test/fixtures/factories';
import { render } from './index';
import { contextAt, escapeValue } from './escape';
import { resolveBinding, resolveValue, validateBinding } from '../bindings';
import type { LanguageId } from '../../types/models';
const opts = { mode: 'local' as const, language: 'powershell' as const, projectId: 'project', versionId: 'version', profileId: null };
describe('binding resolution and validation', () => {
  it('separates scope resolution from profile fallback', () => {
    const global = binding({ scope: 'global', scopeRef: null }), project = binding(), version = binding({ scope: 'version', scopeRef: 'version' });
    expect(resolveBinding('ADMIN_PASSWORD', [global, project, version], 'project', 'version')).toBe(version);
    expect(resolveBinding('ADMIN_PASSWORD', [global, project], 'project', 'version')).toBe(project);
    expect(resolveBinding('ADMIN_PASSWORD', [global, project], 'other', null)).toBe(global);
    expect(resolveValue(project, 'work')).toBe('OtherSecret987!');
    expect(resolveValue(project, 'unknown')).toBe('SuperSecret123!');
    expect(resolveValue(binding({ values: {} }), null)).toBeUndefined();
  });
  it('rejects equal or containing AI values across every profile', () => {
    for (const value of ['SuperSecret123!', 'beforeOtherSecret987!after']) expect(validateBinding(binding({ aiReplacement: value }), [])).not.toHaveLength(0);
    expect(validateBinding(binding(), [])).toEqual([]);
    expect(validateBinding(binding({ name: 'x' }), [])).not.toHaveLength(0);
  });
  it('rejects duplicate names in same scope only', () => {
    const b = binding();
    expect(validateBinding(binding(), [b])).not.toHaveLength(0);
    expect(validateBinding(binding({ scope: 'global', scopeRef: null }), [b])).toEqual([]);
  });
});
describe('render safety', () => {
  it('keeps unresolved placeholders visible and blocks copying through issues', () => {
    const result = render('$u = "{{MISSING}}"', [], opts);
    expect(result.text).toContain('{{MISSING}}'); expect(result.issues[0].kind).toBe('missing');
    expect(render('"{{ADMIN_PASSWORD}}"', [binding({ values: {} })], opts).text).toBe('"{{ADMIN_PASSWORD}}"');
  });
  it('never substitutes recursively and remains deterministic', () => {
    const b = binding({ values: { __default__: '{{OTHER_BINDING}}' } });
    const first = render('"{{ADMIN_PASSWORD}}"', [b], opts);
    expect(first.text).toBe('"{{OTHER_BINDING}}"');
    expect(render('"{{ADMIN_PASSWORD}}"', [b], opts)).toEqual(first);
  });
  it('masks secrets in display but preserves underlying rendering', () => {
    expect(render('"{{ADMIN_PASSWORD}}"', [binding()], { ...opts, maskSecrets: true }).text).toBe('"••••••••"');
    expect(render('"{{ADMIN_PASSWORD}}"', [binding()], opts).text).toBe('"SuperSecret123!"');
  });
  it('AI text and issue reports do not contain private profile values', () => {
    const b = binding();
    const result = render('$p = "{{ADMIN_PASSWORD}}"', [b], { ...opts, mode: 'ai' });
    for (const value of Object.values(b.values)) expect(JSON.stringify(result)).not.toContain(value);
    expect(result.issues).toEqual([]);
  });
  it('blocks known values elsewhere in AI code, even from unrelated scope or profile', () => {
    const result = render('# OtherSecret987!\n$p="{{ADMIN_PASSWORD}}"', [binding()], { ...opts, mode: 'ai' });
    expect(result.issues.some(i => i.kind === 'leak')).toBe(true);
    expect(JSON.stringify(result.issues)).not.toContain('OtherSecret987!');
  });
  it('property: AI substitution cannot expose random private profile values', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 33, max: 126 }), { minLength: 8, maxLength: 40 }), fc.integer({ min: 1, max: 20 }), (codes, repetitions) => {
      const secret = 'PRIVATE-' + String.fromCharCode(...codes);
      const b = binding({ values: { __default__: secret, profile: secret + '-profile' } });
      const template = Array.from({ length: repetitions }, (_, i) => `$p${i} = "{{ADMIN_PASSWORD}}"`).join('\n');
      const result = render(template, [b], { ...opts, mode: 'ai' });
      expect(result.text).not.toContain(secret); expect(result.issues).toEqual([]);
    }), { numRuns: 150 });
  });
});
describe('escaping', () => {
  const nasty = ['P@ss"w0rd', '$env:USERNAME', 'a`b', 'C:\\path\\', "'; DROP", '\n', '😀', '${process}', '\u0000'];
  it('round-trips JSON strings through JSON.parse', () => {
    for (const value of nasty) {
      const result = render('{"password":"{{ADMIN_PASSWORD}}"}', [binding({ values: { __default__: value } })], { ...opts, language: 'json' });
      expect(result.issues).toEqual([]); expect(JSON.parse(result.text).password).toBe(value);
    }
  });
  it('PowerShell double quotes produce one closed, non-interpolating string', () => {
    for (const value of nasty) {
      const output = escapeValue(value, 'powershell', { quote: '"' }).text;
      let decoded = '';
      for (let i = 0; i < output.length; i++) {
        if (output[i] === '`') { const escaped = output[++i]; decoded += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === '0' ? '\u0000' : escaped; }
        else { expect(['"', '$']).not.toContain(output[i]); decoded += output[i]; }
      }
      expect(decoded).toBe(value);
    }
  });
  it('escapes PowerShell, JS/TS, Python, Bash, YAML and XML', () => {
    expect(escapeValue("O'Brien", 'powershell', { quote: "'" }).text).toBe("O''Brien");
    for (const language of ['javascript', 'typescript', 'python'] as LanguageId[]) {
      expect(escapeValue('a"\\\n', language, { quote: '"' }).text).toBe('a\\"\\\\\\n');
      expect(escapeValue("'; DROP", language, { quote: "'" }).text).toBe("\\'; DROP");
    }
    expect(escapeValue('`${x}', 'typescript', { quote: '`' }).text).toBe('\\`\\${x}');
    expect(escapeValue("O'Brien", 'shell', { quote: "'" }).text).toBe("O'\\''Brien");
    expect(escapeValue('$x`"\\', 'shell', { quote: '"' }).text).toBe('\\$x\\`\\"\\\\');
    expect(escapeValue(' a: #b ', 'yaml', { quote: '' }).text).toBe('" a: #b "');
    expect(escapeValue('&<>"', 'xml', { quote: '' }).text).toBe('&amp;&lt;&gt;&quot;');
    for (const value of nasty) expect(escapeValue(value, 'plaintext', { quote: '' }).text).toBe(value);
  });
  it('blocks unsupported contexts instead of silently corrupting code', () => {
    const fixtures: [LanguageId, string][] = [['powershell', '$x = @"\n{{ADMIN_PASSWORD}}\n"@'], ['python', 'x = r"{{ADMIN_PASSWORD}}"'], ['python', 'x = f"{{ADMIN_PASSWORD}}"'], ['python', 'x = """{{ADMIN_PASSWORD}}"""'], ['json', '{"x": {{ADMIN_PASSWORD}}}']];
    for (const [language, source] of fixtures) { const result = render(source, [binding()], { ...opts, language }); expect(result.issues.length).toBeGreaterThan(0); expect(result.text).toContain('{{ADMIN_PASSWORD}}'); }
  });
  it('tracks escaped quotes and ignores quote characters in comments', () => {
    const source = '# "comment\n$p = "a`" {{ADMIN_PASSWORD}}"';
    expect(contextAt(source, source.indexOf('{{'), 'powershell').quote).toBe('"');
    const js = '/* " */ const x = \'{{ADMIN_PASSWORD}}\'';
    expect(contextAt(js, js.indexOf('{{'), 'javascript').quote).toBe("'");
  });
});
