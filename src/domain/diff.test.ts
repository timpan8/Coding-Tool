import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { changedLineCount, diffStats, diffTemplates, formatStats } from './diff';

describe('diffStats', () => {
  it('counts added and removed lines, not lines that merely moved down', () => {
    expect(diffStats('a\nb\nc', 'a\nb changed\nc\nd')).toEqual({ added: 2, removed: 1 });
    // An insertion at the top used to count every line below it as changed.
    expect(diffStats('a\nb\nc', 'new\na\nb\nc')).toEqual({ added: 1, removed: 0 });
    expect(diffStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
    expect(diffStats('', 'a\nb')).toEqual({ added: 2, removed: 0 });
    expect(diffStats('a', '')).toEqual({ added: 0, removed: 1 });
  });

  it('formats and summarises the way a diff reads', () => {
    expect(formatStats({ added: 12, removed: 3 })).toBe('+12 −3');
    expect(changedLineCount({ added: 1, removed: 1 })).toBe(1);
    expect(changedLineCount({ added: 4, removed: 0 })).toBe(4);
  });

  it('is symmetric and never counts more than the lines that exist', () => {
    const lines = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 30 }).map((l) => l.join('\n'));
    fc.assert(fc.property(lines, lines, (before, after) => {
      const forward = diffStats(before, after);
      const backward = diffStats(after, before);
      expect(forward.added).toBe(backward.removed);
      expect(forward.removed).toBe(backward.added);
      expect(forward.added).toBeLessThanOrEqual(after.split('\n').length);
      expect(forward.removed).toBeLessThanOrEqual(before.split('\n').length);
    }));
  });

  it('sums over the files a version holds', () => {
    expect(diffTemplates({ a: 'x\ny', b: 'gone' }, { a: 'x\ny\nz', c: 'new' })).toEqual({ added: 2, removed: 1 });
  });
});
