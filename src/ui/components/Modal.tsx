import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close(); }} aria-label={title}>
    <header className="dialog-head"><h2>{title}</h2><button aria-label="Stäng dialog" onClick={close}>×</button></header>
    {children}
  </dialog>;
}
