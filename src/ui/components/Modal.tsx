import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // showModal() focuses the first focusable element, which is the close button, so Enter used to
    // dismiss the dialog instead of submitting it. Prefer whatever the content asked for.
    const target = dialog?.querySelector<HTMLElement>('[autofocus]') ?? dialog?.querySelector<HTMLElement>('input, select, textarea');
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close(); }} aria-label={title}>
    <header className="dialog-head"><h2>{title}</h2><button aria-label="Stäng dialog" onClick={close}>×</button></header>
    {children}
  </dialog>;
}
