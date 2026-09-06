import { useCallback, useRef, useState, type ReactNode } from 'react';
import { t } from '../text';

export type ToastTone = 'info' | 'ok' | 'warn' | 'error';

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

/** Transient messages, stacked in a corner and gone on their own.
 *
 * They replace the strip under the header: a message that stays until someone closes it reads as a
 * state of the app, and "AI-kod kopierad" is not one. A warning gets twice the time and keeps its
 * close button; a refusal is still not a modal (Report U6). The container is a polite live region,
 * never an alert, so a new toast does not interrupt what a screen reader is in the middle of. */
export function useToasts(): [(text: string, tone?: ToastTone, ms?: number) => void, ReactNode] {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback(
    (text: string, tone: ToastTone = 'info', ms?: number) => {
      const id = next.current++;
      const life = ms ?? (tone === 'info' || tone === 'ok' ? 6000 : 12000);
      // Five at most: a burst of messages must not cover the corner of the screen it lives in.
      setItems((list) => [...list.slice(-4), { id, text, tone }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), life));
    },
    [dismiss],
  );

  const element = items.length ? (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.tone}`}>
          <span>{item.text}</span>
          <button aria-label={t.dialog.closeNotice} onClick={() => dismiss(item.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  ) : null;

  return [notify, element];
}
