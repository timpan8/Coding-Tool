import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrast } from './contrast';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const block =
    theme === 'light'
      ? /:root \{([\s\S]*?)\n\}/.exec(css)?.[1]
      : /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)?.[1];
  return Object.fromEntries([...(block ?? '').matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)].map((m) => [m[1], m[2]]));
}

/** Text-on-surface pairs the interface actually renders. Measured rather than eyeballed, so a
 * later palette change cannot quietly drop below the threshold. */
const textPairs: [string, string, number][] = [
  ['text', 'bg', AA_TEXT],
  ['text', 'surface', AA_TEXT],
  ['text-strong', 'surface', AA_TEXT],
  ['text-muted', 'surface', AA_TEXT],
  ['text-muted', 'bg', AA_TEXT],
  ['text-muted', 'surface-sunken', AA_TEXT],
  ['accent-fg', 'accent', AA_TEXT],
  ['accent-text', 'surface', AA_TEXT],
  ['accent-text', 'accent-surface', AA_TEXT],
  ['danger-text', 'surface', AA_TEXT],
  ['danger-text', 'danger-surface', AA_TEXT],
  ['warn-text', 'warn-surface', AA_TEXT],
  // Body-size text, all of it. axe found these three rendered at 11-14 px, where the large-text
  // allowance does not apply; a ladder built by washing colour out below legibility is not a
  // hierarchy. Weight and size carry it instead.
  ['text-subtle', 'surface', AA_TEXT],
  ['text-subtle', 'bg', AA_TEXT],
  ['text-faint', 'surface', AA_TEXT],
  ['text-faint', 'bg', AA_TEXT],
  ['text-faint', 'surface-raised', AA_TEXT],
];

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  const table = tokens(theme);
  it.each(textPairs)('%s on %s reaches %s:1', (fg, bg, threshold) => {
    expect(table[fg], `--${fg} missing`).toBeTruthy();
    expect(table[bg], `--${bg} missing`).toBeTruthy();
    expect(contrast(table[fg], table[bg])).toBeGreaterThanOrEqual(threshold);
  });
});

describe('contrast', () => {
  it('agrees with the known extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
