import { describe, expect, it } from 'vitest';
import { match, shortcuts } from './shortcuts';

const press = (init: Partial<KeyboardEvent> & { key: string }) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

describe('shortcuts', () => {
  it('opens the project list on either binding', () => {
    expect(match(press({ key: 'p', ctrlKey: true }), 'projects')).toBe(true);
    expect(match(press({ key: 'k', ctrlKey: true }), 'projects')).toBe(true);
    expect(match(press({ key: 'p', metaKey: true }), 'projects')).toBe(true);
  });

  it('separates the two copies by shift alone', () => {
    expect(match(press({ key: 'Enter', ctrlKey: true }), 'copyAi')).toBe(true);
    expect(match(press({ key: 'Enter', ctrlKey: true }), 'copyLocal')).toBe(false);
    expect(match(press({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'copyLocal')).toBe(true);
    expect(match(press({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'copyAi')).toBe(false);
  });

  it('no longer uses the combinations the browser takes for itself', () => {
    // Ctrl+Shift+C opens the element inspector; Ctrl+Alt+C was the old local copy.
    expect(match(press({ key: 'c', ctrlKey: true, shiftKey: true }), 'copyAi')).toBe(false);
    expect(match(press({ key: 'c', ctrlKey: true, altKey: true }), 'copyLocal')).toBe(false);
  });

  it('does not fire a plain key as a shortcut when a modifier is expected', () => {
    expect(match(press({ key: 'p' }), 'projects')).toBe(false);
    expect(match(press({ key: 's' }), 'save')).toBe(false);
  });

  it('accepts both help bindings', () => {
    expect(match(press({ key: '/', ctrlKey: true }), 'help')).toBe(true);
    expect(match(press({ key: '?' }), 'help')).toBe(true);
  });

  it('lists every binding it implements, so the dialog cannot drift from the behaviour', () => {
    for (const shortcut of shortcuts) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.label).toBeTruthy();
    }
    expect(shortcuts.map((s) => s.id)).toEqual(['projects', 'copyAi', 'copyLocal', 'save', 'lock', 'help']);
  });
});
