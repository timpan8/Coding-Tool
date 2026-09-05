import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editorColors, editorColorTokens, resolveTheme, type ResolvedTheme } from './theme';

/** Monaco holds its own copy of a few colours because it cannot read CSS custom properties.
 * These tests fail when the two copies drift, which is otherwise only visible by looking. */
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function tokens(theme: ResolvedTheme): Record<string, string> {
  const block =
    theme === 'light'
      ? /:root \{([\s\S]*?)\n\}/.exec(css)?.[1]
      : /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)?.[1];
  if (!block) throw new Error(`No token block found for ${theme}`);
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe('theme tokens', () => {
  it('defines every token in both themes', () => {
    const light = Object.keys(tokens('light'));
    const dark = Object.keys(tokens('dark'));
    expect(light.length).toBeGreaterThan(30);
    expect([...light].sort()).toEqual([...dark].sort());
  });

  it('keeps the editor colours equal to the tokens they mirror', () => {
    for (const theme of ['light', 'dark'] as ResolvedTheme[]) {
      const table = tokens(theme);
      for (const [key, token] of Object.entries(editorColorTokens[theme])) {
        const expected = table[token];
        expect(expected, `${theme}: --${token} is not defined`).toBeTruthy();
        // #ffffff and #fff are the same colour; compare expanded.
        const expand = (hex: string) =>
          hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.toLowerCase();
        expect(expand(editorColors[theme][key]), `${theme}: ${key} should equal --${token}`).toBe(expand(expected));
      }
    }
  });

  it('resolves an explicit choice without consulting the system', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});
