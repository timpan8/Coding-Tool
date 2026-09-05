export type ClearOutcome = 'cleared' | 'replaced-by-other' | 'failed';

/** Copy Local puts real secrets on the system clipboard, where they sit until something else is
 * copied. Clearing after a delay narrows that window.
 *
 * It cannot narrow it to nothing: clipboard history and cloud-synced clipboards are outside the
 * page's reach, and Security.tsx says so. This is a mitigation, not a guarantee. */
export async function clearClipboard(expected: string): Promise<ClearOutcome> {
  try {
    // Prefer to overwrite only what we put there; something copied since is not ours to destroy.
    // Reading is often not permitted, in which case we clear anyway — the countdown is visible the
    // whole time and can be cancelled, so the user has had the chance to keep what they copied.
    try {
      if ((await navigator.clipboard.readText()) !== expected) return 'replaced-by-other';
    } catch {
      /* Reading not permitted; fall through to clearing. */
    }
    await navigator.clipboard.writeText('');
    return 'cleared';
  } catch {
    return 'failed';
  }
}
