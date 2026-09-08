import { describe, expect, it } from 'vitest';
import { binding } from '../../test/fixtures/factories';
import { buildValueIndex, findLeaks } from './leak';
import { base64Utf16le, base64Utf8 } from './encoding';

describe('value index', () => {
  it('collects every value from every binding, skipping empty ones', () => {
    const index = buildValueIndex([binding(), binding({ name: 'B', values: { __default__: '', other: 'x' } })]);
    expect(index.plain.map((v) => v.value).sort()).toEqual(['OtherSecret987!', 'SuperSecret123!', 'x']);
  });

  it('spans the whole vault, not just one project', () => {
    const mine = binding({ scopeRef: 'project-a' });
    const theirs = binding({ name: 'THEIRS', scopeRef: 'project-b', values: { __default__: 'from-elsewhere' } });
    const hits = findLeaks('# from-elsewhere', buildValueIndex([mine, theirs]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bindingName: 'THEIRS', ownerScopeRef: 'project-b' });
  });
});

describe('findLeaks', () => {
  it('reports where the value is, not merely that it exists', () => {
    const hits = findLeaks('line one\n$p = "SuperSecret123!"', buildValueIndex([binding()]));
    expect(hits[0].start).toBe(15);
    expect(hits[0].end).toBe(15 + 'SuperSecret123!'.length);
  });

  it('finds nothing in clean output', () => {
    expect(findLeaks('$p = "<PASSWORD>"', buildValueIndex([binding()]))).toEqual([]);
  });

  it('orders hits by position so the panel reads top to bottom', () => {
    const b = binding({ values: { a: 'zzz', b: 'aaa' } });
    expect(findLeaks('aaa then zzz', buildValueIndex([b])).map((h) => h.start)).toEqual([0, 9]);
  });
});

// PR 5. The gate stays exact — every string it looks for is derived from a value it knows — but a
// value does not stop being itself because it was encoded on the way out.
describe('encoded and retired values', () => {
  it('finds a value that was base64-encoded, and says how', () => {
    const b = binding();
    const encoded = base64Utf8('SuperSecret123!');
    const hits = findLeaks(`$c = "${encoded}"`, buildValueIndex([b]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bindingName: 'ADMIN_PASSWORD', encoding: 'base64' });
  });

  it('finds a value inside a longer base64 payload', () => {
    const command = base64Utf16le('Invoke-Thing -Password "SuperSecret123!" -Verbose');
    const hits = findLeaks(`powershell -EncodedCommand ${command}`, buildValueIndex([binding()]));
    expect(hits).toHaveLength(1);
    expect(hits[0].encoding).toBe('inside-base64');
  });

  it('finds a URL-escaped and a backtick-escaped value', () => {
    const b = binding({ values: { __default__: 'p@ss word' } });
    expect(findLeaks('curl "https://x/?p=p%40ss%20word"', buildValueIndex([b]))[0].encoding).toBe('url');
    const quoted = binding({ values: { __default__: 'say "hi"' } });
    expect(findLeaks('$x = "say `"hi`""', buildValueIndex([quoted]))[0].encoding).toBe('backtick');
  });

  it('watches a value the binding used to have, and marks it as retired', () => {
    const b = binding({ values: { __default__: 'NewSecret456!' }, retired: ['SuperSecret123!'] });
    const hits = findLeaks('$old = "SuperSecret123!"', buildValueIndex([b]));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ retired: true, encoding: 'exact' });
    expect(findLeaks('$new = "NewSecret456!"', buildValueIndex([b]))[0].retired).toBe(false);
  });

  it('reports one hit per binding for a run, not one per decoding', () => {
    const b = binding();
    const hits = findLeaks(`x = "${base64Utf8('SuperSecret123!')}"`, buildValueIndex([b]));
    expect(hits).toHaveLength(1);
  });

  it('leaves a very short value without variants, so it cannot match half the file', () => {
    const b = binding({ values: { __default__: 'ab' } });
    expect(buildValueIndex([b]).values.map(v => v.value)).toEqual(['ab']);
  });
});
