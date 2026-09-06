import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Binding } from '../../types/models';
import { t } from '../text';

const REVEAL_SECONDS = 60;

/** The card a pill opens: what the placeholder is, what the AI sees, and the real value behind
 * a click that undoes itself.
 *
 * Revealing is a choice with a clock on it. The value is rendered as text — this is the
 * user's own machine and the Local view shows the same — but it cannot be selected, so a reveal
 * never becomes a copy by accident, and it hides again after a minute or when the card closes. */
export function ChipPopover({
  chip, binding, value, line, close, edit, unbind,
}: {
  chip: { name: string; x: number; y: number };
  binding: Binding | undefined;
  /** The private value for the active profile, when there is one. */
  value: string | undefined;
  line: number;
  close: () => void;
  edit: () => void;
  /** Writes the value back into the file where this placeholder stands. */
  unbind: (() => void) | undefined;
}) {
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(REVEAL_SECONDS);
  const card = useRef<HTMLDivElement>(null);
  // The parent hands in a fresh `close` every render; the listeners want the latest one without
  // being torn down and re-attached, and focus must move into the card once, not per render.
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => {
    if (!revealed) return;
    const lapse = setTimeout(() => setRevealed(false), REVEAL_SECONDS * 1000);
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => { clearTimeout(lapse); clearInterval(tick); };
  }, [revealed]);

  // Escape and a click anywhere else close it; the card itself is a small dialog beside the pill.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const outside = (e: MouseEvent) => { if (card.current && !card.current.contains(e.target as Node)) closeRef.current(); };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', outside);
    card.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', outside); };
  }, []);

  // Kept on screen: clamped to the viewport so a pill near the right edge still gets a card.
  const width = 320;
  const style: CSSProperties = {
    left: Math.max(8, Math.min(chip.x, (typeof window === 'undefined' ? width + 8 : window.innerWidth) - width - 8)),
    top: chip.y + 12,
  };

  return (
    <div className="chip-popover" role="dialog" aria-label={chip.name} ref={card} style={style} onContextMenu={(e) => e.preventDefault()}>
      <div className="chip-popover-head">
        <code>{chip.name}</code>
        {binding && <span className="finding-category">{t.category[binding.category]}</span>}
        <small>{t.common.line(line)}</small>
      </div>
      {binding ? (
        <>
          <p className="muted ai-sees">{t.bindingDialog.aiSees}<code>{binding.aiReplacement}</code></p>
          <div className="chip-value">
            {value === undefined ? (
              <span className="danger-text">{t.chip.noValue}</span>
            ) : revealed ? (
              <>
                <span className="chip-revealed" aria-live="off">{value}</span>
                <small>{t.chip.hidesIn(left)}</small>
              </>
            ) : (
              <button className="text-button" onClick={() => { setLeft(REVEAL_SECONDS); setRevealed(true); }}>{t.chip.reveal}</button>
            )}
          </div>
        </>
      ) : (
        <p className="danger-text">{t.editorHover.noBinding}</p>
      )}
      <div className="chip-popover-actions">
        {binding && <button onClick={edit}>{t.chip.edit}</button>}
        {unbind && <button onClick={unbind}>{t.chip.unbind}</button>}
        <button className="text-button" onClick={close}>{t.dialog.close}</button>
      </div>
    </div>
  );
}
