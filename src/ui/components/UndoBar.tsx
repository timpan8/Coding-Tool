import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface UndoOffer {
  /** What was done, in the past tense: the bar reads "Projektet är raderat." */
  label: string;
  /** Puts it back. Runs at most once, and only if the user asks within the window. */
  restore: () => Promise<void>;
}

const WINDOW = 10;

/** Report U17. A delete is only reversible while the records still exist somewhere, so the caller
 * captures them first and hands over the way back — the bar never guesses how to undo anything.
 *
 * The window is a courtesy, not a guarantee: the delete has already happened when the bar appears,
 * so this never replaces a confirmation for something that cannot be put back. */
export function useUndo(report: (message: string) => void): [(offer: UndoOffer) => void, ReactNode] {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [left, setLeft] = useState(WINDOW);
  const running = useRef(false);

  // One timer decides when the offer lapses; the other only counts down on screen. Deriving the
  // expiry from the displayed number instead meant clearing state from inside the effect that
  // rendered it, one cascading render per second.
  useEffect(() => {
    if (!offer) return;
    const lapse = setTimeout(() => setOffer(null), WINDOW * 1000);
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => {
      clearTimeout(lapse);
      clearInterval(tick);
    };
  }, [offer]);

  function open(next: UndoOffer) {
    running.current = false;
    setLeft(WINDOW);
    setOffer(next);
  }

  async function undo() {
    if (!offer || running.current) return;
    running.current = true;
    const { restore } = offer;
    setOffer(null);
    try { await restore(); report('Ångrat.'); }
    catch { report('Det gick inte att ångra. Ingenting ändrades tillbaka.'); }
  }

  const element = offer ? (
    <div className="undo-bar" role="status">
      <span>{offer.label}</span>
      <button className="primary" onClick={() => void undo()}>
        Ångra
      </button>
      <span className="undo-count" aria-hidden="true">
        {left} s
      </span>
      <button aria-label="Stäng ångra-remsan" onClick={() => setOffer(null)}>
        ×
      </button>
    </div>
  ) : null;

  return [open, element];
}
