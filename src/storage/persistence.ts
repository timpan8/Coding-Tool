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
