import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, requestPersistence, storageState } from './persistence';

function stubStorage(storage: unknown) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage } });
}
afterEach(() => vi.restoreAllMocks());

describe('storageState', () => {
  it('reports unsupported rather than guessing when the API is missing', async () => {
    stubStorage(undefined);
    expect(await storageState()).toEqual({ persisted: false, supported: false });
  });
  it('reports what the browser says', async () => {
    stubStorage({ persisted: async () => true, estimate: async () => ({ usage: 2048, quota: 4096 }) });
    expect(await storageState()).toEqual({ persisted: true, supported: true, usedBytes: 2048, quotaBytes: 4096 });
  });
});

describe('requestPersistence', () => {
  it('asks once and returns the resulting state', async () => {
    let granted = false;
    const persist = vi.fn(async () => (granted = true));
    stubStorage({ persisted: async () => granted, persist, estimate: async () => ({ usage: 1, quota: 2 }) });
    expect(await requestPersistence()).toMatchObject({ persisted: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('does not ask again when permission is already granted', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: async () => true, persist, estimate: async () => ({}) });
    await requestPersistence();
    expect(persist).not.toHaveBeenCalled();
  });
  it('treats a refusal as an answer, not a failure', async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ usage: 0, quota: 10 }),
    });
    expect(await requestPersistence()).toMatchObject({ persisted: false, supported: true });
  });
  it('survives a browser that throws from persist', async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('blocked');
      },
      estimate: async () => ({ usage: 0, quota: 10 }),
    });
    await expect(requestPersistence()).resolves.toMatchObject({ persisted: false });
  });
});

describe('formatBytes', () => {
  it('scales and says when it does not know', () => {
    expect(formatBytes(undefined)).toBe('okänt');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
