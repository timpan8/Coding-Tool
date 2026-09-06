// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBrowserTraces, formatBytes, requestPersistence, storageState } from './persistence';

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

/** "Rensa hela valvet" claims to remove everything belonging to this app in this browser. clearAll()
 * empties the Dexie tables and nothing else, so the rest of that claim rests on this function. */
describe('clearBrowserTraces', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  function stubBrowser({ scope = 'https://example.test/vault/', keys = [] as string[] } = {}) {
    const unregister = vi.fn(async () => true), deleted: string[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker: { getRegistration: async () => ({ scope, unregister }) } },
    });
    vi.stubGlobal('caches', { keys: async () => keys, delete: async (key: string) => { deleted.push(key); return true; } });
    return { unregister, deleted };
  }

  it('removes the mirrored theme, the service worker and the shell it cached', async () => {
    localStorage.setItem('acv:theme', 'dark');
    const { unregister, deleted } = stubBrowser({ keys: ['acv-shell:https://example.test/vault/:abc123'] });
    await clearBrowserTraces();
    expect(localStorage.getItem('acv:theme')).toBeNull();
    expect(unregister).toHaveBeenCalled();
    expect(deleted).toEqual(['acv-shell:https://example.test/vault/:abc123']);
  });

  // The database name carries location.pathname, so a second copy of the app under another path is
  // a different vault. Deleting its shell would clear a vault the user did not ask about.
  it('leaves another deployment of the app on the same origin alone', async () => {
    const { deleted } = stubBrowser({ keys: ['acv-shell:https://example.test/vault/:abc123', 'acv-shell:https://example.test/annat/:def456', 'nagot-annat'] });
    await clearBrowserTraces();
    expect(deleted).toEqual(['acv-shell:https://example.test/vault/:abc123']);
  });

  // A browser that blocks one of the three still has to have the other two removed: the vault is
  // gone by then either way, and a half-finished clear must not throw on the way out.
  it('carries on when the browser refuses a part of it', async () => {
    localStorage.setItem('acv:theme', 'dark');
    const deleted: string[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker: { getRegistration: async () => { throw new Error('blockerad'); } } },
    });
    vi.stubGlobal('caches', { keys: async () => ['acv-shell:http://localhost:3000/:abc'], delete: async (key: string) => { deleted.push(key); return true; } });
    await expect(clearBrowserTraces()).resolves.toBeUndefined();
    expect(localStorage.getItem('acv:theme')).toBeNull();
    // Without a registration to name the scope it falls back to this page's own base URL.
    expect(deleted).toEqual(['acv-shell:http://localhost:3000/:abc']);
  });
});
