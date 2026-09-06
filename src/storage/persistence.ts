export interface StorageState {
  /** False means the browser may evict the vault when the device runs low on space. */
  persisted: boolean;
  /** Unknown in browsers that do not implement the Storage API. */
  supported: boolean;
  usedBytes?: number;
  quotaBytes?: number;
}

/** Deliberately not part of StorageProvider: this describes the browser's storage, not the vault's
 * contents, and a future provider on a different substrate would have nothing to answer here. */
export async function storageState(): Promise<StorageState> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { persisted: false, supported: false };
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.() ?? Promise.resolve(false),
    navigator.storage.estimate(),
  ]);
  return { persisted, supported: true, usedBytes: estimate.usage, quotaBytes: estimate.quota };
}

/** Asks the browser to stop treating the vault as evictable cache.
 *
 * Chromium decides from its own engagement heuristics and does not prompt; Firefox asks the user.
 * Either way a refusal is normal and not an error, so the caller shows the outcome rather than
 * treating it as a failure. */
export async function requestPersistence(): Promise<StorageState> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return storageState();
  try {
    if (!(await navigator.storage.persisted?.())) await navigator.storage.persist();
  } catch {
    /* Unsupported or blocked; storageState() reports what is actually true. */
  }
  return storageState();
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return 'okänt';
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Everything this app leaves in the browser besides the vault itself: the theme mirrored into
 * localStorage so the first paint is not the wrong colour, the service worker, and the offline
 * shell it caches. `clearAll()` empties the Dexie tables and nothing else, so without this the
 * "removes everything belonging to this app" in the clear dialog was not true.
 *
 * Scoped to this deployment, never the whole origin: the vault's database name carries
 * `location.pathname`, so a second copy of the app under another path is a different vault and its
 * shell is not ours to delete. Best effort by design — a browser that blocks one of these still
 * has to have the other two removed, and the vault is gone either way. */
export async function clearBrowserTraces(): Promise<void> {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('acv:')) localStorage.removeItem(key);
  } catch {
    /* Private mode or blocked site data: there was nothing stored to remove. */
  }
  let scope = '';
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) { scope = registration.scope; await registration.unregister(); }
  } catch {
    /* No service worker, or one this page may not touch. */
  }
  try {
    if (typeof caches === 'undefined') return;
    const prefix = `acv-shell:${scope || new URL(import.meta.env.BASE_URL, location.href).href}:`;
    for (const key of await caches.keys()) if (key.startsWith(prefix)) await caches.delete(key);
  } catch {
    /* CacheStorage is unavailable in some private modes. */
  }
}
