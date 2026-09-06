import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearClipboard } from './clipboard';

function stub(clipboard: unknown) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
}
afterEach(() => vi.restoreAllMocks());

describe('clearClipboard', () => {
  it('overwrites what it put there', async () => {
    const writeText = vi.fn(async () => {});
    stub({ readText: async () => 'secret', writeText });
    expect(await clearClipboard('secret')).toBe('cleared');
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('leaves alone something the user copied since', async () => {
    const writeText = vi.fn(async () => {});
    stub({ readText: async () => 'a shopping list', writeText });
    expect(await clearClipboard('secret')).toBe('replaced-by-other');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('still clears when reading is not permitted', async () => {
    // The countdown is visible and cancellable throughout, so the user has had their chance to
    // keep whatever they copied; leaving a password behind is the worse failure.
    const writeText = vi.fn(async () => {});
    stub({
      readText: async () => {
        throw new Error('denied');
      },
      writeText,
    });
    expect(await clearClipboard('secret')).toBe('cleared');
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('reports failure rather than throwing when writing is refused too', async () => {
    stub({
      readText: async () => 'secret',
      writeText: async () => {
        throw new Error('denied');
      },
    });
    expect(await clearClipboard('secret')).toBe('failed');
  });
});
