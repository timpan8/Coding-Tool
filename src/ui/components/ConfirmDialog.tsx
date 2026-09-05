import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until the user types this exact word. Reserved for
   * actions with no undo and no backup path, not for merely destructive ones. */
  typeToConfirm?: string;
}

/** Replaces window.confirm, which could not be styled, could be suppressed by the browser, and
 * stacked a second native dialog on top of an already open <dialog>. */
export function ConfirmDialog({
  request,
  resolve,
}: {
  request: ConfirmRequest;
  resolve: (confirmed: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const ready = !request.typeToConfirm || typed.trim() === request.typeToConfirm;

  useEffect(() => {
    if (!request.typeToConfirm) confirmRef.current?.focus();
  }, [request.typeToConfirm]);

  return (
    <Modal title={request.title} close={() => resolve(false)}>
      <div className="confirm-body">{request.body}</div>
      {request.typeToConfirm && (
        <label>
          Skriv <code>{request.typeToConfirm}</code> för att bekräfta
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Skriv ${request.typeToConfirm} för att bekräfta`}
          />
        </label>
      )}
      <div className="dialog-actions">
        <button onClick={() => resolve(false)}>Avbryt</button>
        <button
          ref={confirmRef}
          className={request.danger ? 'danger' : 'primary'}
          disabled={!ready}
          onClick={() => resolve(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Gives back an async confirm() with the same shape as the native one it replaces, plus the
 * element the caller renders. */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{ request: ConfirmRequest; resolve: (value: boolean) => void } | null>(null);
  const ask = (request: ConfirmRequest) =>
    new Promise<boolean>((resolve) => setState({ request, resolve }));
  const element = state ? (
    <ConfirmDialog
      request={state.request}
      resolve={(confirmed) => {
        state.resolve(confirmed);
        setState(null);
      }}
    />
  ) : null;
  return [ask, element];
}
