/** Line-level added and removed counts between two texts.
 *
 * An exact line LCS after trimming the common head and tail, so an unchanged line between two
 * edits is never counted as changed and a moved block costs what it costs. The previous measure
 * compared lines by position, which called every line after an insertion changed. Very large
 * inputs fall back to that positional count rather than allocating a table the page cannot afford.
 */
export interface DiffStats {
  added: number;
  removed: number;
}

/** Upper bound on the LCS table before falling back to the positional count. */
const LCS_CELL_LIMIT = 4_000_000;

export function diffStats(before: string, after: string): DiffStats {
  // An empty text is no lines, not one empty line: a new file reads as all additions.
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - head;
  const m = endB - head;
  if (n === 0 || m === 0) return { added: m, removed: n };
  if (n * m > LCS_CELL_LIMIT) {
    let changed = 0;
    for (let i = 0; i < Math.min(n, m); i++) if (a[head + i] !== b[head + i]) changed++;
    return { added: changed + Math.max(0, m - n), removed: changed + Math.max(0, n - m) };
  }
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    const line = a[head + i - 1];
    for (let j = 1; j <= m; j++) {
      table[i * width + j] = line === b[head + j - 1] ? table[(i - 1) * width + (j - 1)] + 1 : Math.max(table[(i - 1) * width + j], table[i * width + (j - 1)]);
    }
  }
  const common = table[n * width + m];
  return { added: m - common, removed: n - common };
}

/** `+12 −3`, the shape everyone who has read a diff already knows. */
export const formatStats = (stats: DiffStats) => `+${stats.added} −${stats.removed}`;

/** One number for "how much changed", for the places that have room for one: a modified line is
 * one line, not one added and one removed. */
export const changedLineCount = (stats: DiffStats) => Math.max(stats.added, stats.removed);

/** Summed over every file a version holds. */
export function diffTemplates(before: Record<string, string>, after: Record<string, string>): DiffStats {
  const total = { added: 0, removed: 0 };
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const stats = diffStats(before[id] ?? '', after[id] ?? '');
    total.added += stats.added;
    total.removed += stats.removed;
  }
  return total;
}
