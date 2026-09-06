import { describe, expect, it } from 'vitest';
import { binding } from '../../test/fixtures/factories';
import { buildValueIndex, findLeaks } from './leak';

describe('value index', () => {
  it('collects every value from every binding, skipping empty ones', () => {
    const index = buildValueIndex([binding(), binding({ name: 'B', values: { __default__: '', other: 'x' } })]);
    expect(index.values.map((v) => v.value).sort()).toEqual(['OtherSecret987!', 'SuperSecret123!', 'x']);
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
