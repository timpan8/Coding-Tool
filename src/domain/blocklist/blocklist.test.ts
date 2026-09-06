import { describe, expect, it } from 'vitest';
import type { Binding, BlocklistEntry } from '../../types/models';
import { binding } from '../../test/fixtures/factories';
import { applyBlocklist, nameForTerm } from './index';

const scope = { scope: 'project' as const, scopeRef: 'project' };
const entry = (term: string, overrides: Partial<BlocklistEntry> = {}): BlocklistEntry =>
  ({ id: `block-${term}`, term, replacement: '', enabled: true, createdAt: '2026-09-05T12:00:00.000Z', ...overrides });
const apply = (text: string, entries: BlocklistEntry[], bindings: Binding[] = []) =>
  applyBlocklist(text, entries, bindings, scope);

describe('applyBlocklist', () => {
  it('replaces a term with a placeholder and says how many times', () => {
    const result = apply('curl https://mittforetag.se/a && curl https://mittforetag.se/b', [entry('mittforetag.se')]);
    expect(result.text).toBe('curl https://{{MITTFORETAG_SE}}/a && curl https://{{MITTFORETAG_SE}}/b');
    expect(result.replacements).toBe(2);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ name: 'MITTFORETAG_SE', existing: false, count: 2 });
  });

  it('stops at a word boundary rather than inside a longer word', () => {
    expect(apply('anna firar annandag', [entry('anna')]).text).toBe('{{ANNA}} firar annandag');
  });

  // Without one the second entry would find its term inside the first one's placeholder.
  it('steps over placeholders that are already there', () => {
    expect(apply('$a = "{{ANNA}}"', [entry('anna')]).replacements).toBe(0);
    expect(apply('$a = "{{ANNA}}" och anna', [entry('anna')]).text).toBe('$a = "{{ANNA}}" och {{ANNA}}');
  });

  it('lets the longer term win where two of them overlap', () => {
    const result = apply('sql01.mittforetag.se', [entry('mittforetag.se'), entry('sql01.mittforetag.se')]);
    expect(result.text).toBe('{{SQL01_MITTFORETAG_SE}}');
    expect(result.replacements).toBe(1);
  });

  // Local has to give back the file that was pasted. Folding two casings into one binding would
  // hand back a value the user never wrote.
  it('keeps two casings of one term apart', () => {
    const result = apply('anna och Anna', [entry('anna')]);
    expect(result.text).toBe('{{ANNA}} och {{ANNA_2}}');
    expect(result.matches.map(m => m.matched)).toEqual(['anna', 'Anna']);
  });

  it('reuses the binding that already holds the value instead of making a second one', () => {
    const existing = binding({ name: 'FORETAGSDOMAN', ...scope, values: { __default__: 'mittforetag.se' } });
    const result = apply('https://mittforetag.se', [entry('mittforetag.se')], [existing]);
    expect(result.text).toBe('https://{{FORETAGSDOMAN}}');
    expect(result.matches[0]).toMatchObject({ name: 'FORETAGSDOMAN', existing: true });
  });

  // A placeholder pointing at a binding scoped to another project resolves to nothing here.
  it('does not borrow a name from a binding another project owns', () => {
    const elsewhere = binding({ name: 'ANNAT_PROJEKT', scope: 'project', scopeRef: 'ett-annat', values: { __default__: 'mittforetag.se' } });
    expect(apply('https://mittforetag.se', [entry('mittforetag.se')], [elsewhere]).matches[0]).toMatchObject({ existing: false });
  });

  it('counts a name up rather than colliding with one already in the scope', () => {
    const taken = binding({ name: 'MITTFORETAG_SE', ...scope, values: { __default__: 'nagot-annat' } });
    expect(apply('https://mittforetag.se', [entry('mittforetag.se')], [taken]).matches[0].name).toBe('MITTFORETAG_SE_2');
  });

  it('leaves a disabled or empty entry alone', () => {
    expect(apply('anna', [entry('anna', { enabled: false })]).replacements).toBe(0);
    expect(apply('anna', [entry('   ')]).replacements).toBe(0);
  });

  // The term is a literal, never an expression: domain/scanner/rules.ts says why.
  it('treats a term with regex punctuation as text', () => {
    expect(apply('a.b och axb', [entry('a.b')]).text).toBe('{{A_B}} och axb');
  });

  it('does not modify the bindings it was given', () => {
    const bindings = [binding({ name: 'MITTFORETAG_SE', ...scope })];
    apply('https://mittforetag.se', [entry('mittforetag.se')], bindings);
    expect(bindings).toHaveLength(1);
  });
});

describe('nameForTerm', () => {
  it('makes a name the binding rules accept', () => {
    const rule = /^[A-Z][A-Z0-9_]{1,63}$/;
    for (const term of ['mittforetag.se', 'Anna Andersson', '10.0.0.5', 'a', 'x'.repeat(120), '  spaced  ']) {
      expect(nameForTerm(term)).toMatch(rule);
    }
  });
  it('starts a name that would begin with a digit with a letter instead', () => {
    expect(nameForTerm('10.0.0.5')).toBe('TERM_10_0_0_5');
  });
});
