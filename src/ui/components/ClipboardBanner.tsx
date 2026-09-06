import { t } from '../text';

/** What Copy RIKTIGT left on the system clipboard, and where the clearing stands. */
export interface ClipboardHold {
  /** The text the app put there, so clearing can refuse to destroy something copied since. */
  text: string;
  /** Seconds until the automatic clear; null when auto-clear is off and the banner only reminds. */
  seconds: number | null;
  /** A clear was attempted and failed: the values are still there and the banner says so in red. */
  pending: boolean;
}

/** Report F4, and the honest half of it. The countdown existed; what did not was the state after a
 * failed clear, which used to be a one-line notice and then silence — with a password still on the
 * clipboard. Now the banner stays, turns red, and the app retries when the tab gets focus back.
 *
 * The note about clipboard history is there because it is the one thing a web page cannot fix, and
 * a banner that says "cleared" without it would be claiming more than it can. */
export function ClipboardBanner({ hold, onClear, onKeep }: { hold: ClipboardHold; onClear: () => void; onKeep: () => void }) {
  const text = hold.pending
    ? t.clipboardBanner.pending
    : hold.seconds !== null
      ? t.clipboardBanner.counting(hold.seconds)
      : t.clipboardBanner.held;
  return (
    <div className={`clipboard-countdown clipboard-banner ${hold.pending ? 'error' : 'warn'}`} role="status">
      <span className="clipboard-text">{text}</span>
      <button onClick={onClear}>{hold.pending ? t.clipboardBanner.retry : t.clipboardBanner.clearNow}</button>
      <button onClick={onKeep}>{t.clipboardBanner.keep}</button>
      <small>{t.clipboardBanner.historyNote}</small>
    </div>
  );
}
