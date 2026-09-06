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
  /** An extra choice carried with the confirmation, for cases where the question is not simply
   * whether to proceed but how. */
  option?: { label: string; defaultChecked?: boolean };
}

/** False when cancelled. Truthy otherwise, so `if (!await confirm(...)) return;` still reads
 * correctly at the call sites that do not use the option. */
export type ConfirmResult = false | { optionChecked: boolean };

/** Replaces window.confirm, which could not be styled, could be suppressed by the browser, and
 * stacked a second native dialog on top of an already open <dialog>. */
export function ConfirmDialog({
  request,
  resolve,
}: {
  request: ConfirmRequest;
  resolve: (result: ConfirmResult) => void;
}) {
  const [typed, setTyped] = useState('');
  const [optionChecked, setOptionChecked] = useState(request.option?.defaultChecked ?? false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const ready = !request.typeToConfirm || typed.trim() === request.typeToConfirm;

  useEffect(() => {
    if (!request.typeToConfirm) confirmRef.current?.focus();
  }, [request.typeToConfirm]);

  return (
    <Modal title={request.title} close={() => resolve(false)}>
      <div className="confirm-body">{request.body}</div>
      {request.option && (
        <label className="check">
          <input type="checkbox" checked={optionChecked} onChange={(e) => setOptionChecked(e.target.checked)} />
          {request.option.label}
        </label>
      )}
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
          onClick={() => resolve({ optionChecked })}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Gives back an async confirm() with the same shape as the native one it replaces, plus the
 * element the caller renders. */
export function useConfirm(): [(request: ConfirmRequest) => Promise<ConfirmResult>, ReactNode] {
  const [state, setState] = useState<{ request: ConfirmRequest; resolve: (value: ConfirmResult) => void } | null>(null);
  const ask = (request: ConfirmRequest) =>
    new Promise<ConfirmResult>((resolve) => setState({ request, resolve }));
  const element = state ? (
    <ConfirmDialog
      request={state.request}
      resolve={(result) => {
        state.resolve(result);
        setState(null);
      }}
    />
  ) : null;
  return [ask, element];
}
