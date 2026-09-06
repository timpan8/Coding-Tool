import { useState } from 'react';
import { Modal } from './Modal';

const steps = [
  {
    title: 'Mall — den du redigerar',
    body: (
      <>
        <p>
          Klistra in din kod som den ser ut. Markera ett känsligt värde och tryck <kbd>Ctrl+B</kbd> för
          att byta ut det mot en platshållare i formen <code>{'{{NAMN}}'}</code>.
        </p>
        <p>Det riktiga värdet läggs i valvet på den här datorn. Mallen behåller bara namnet.</p>
      </>
    ),
  },
  {
    title: 'Local — koden med riktiga värden',
    body: (
      <>
        <p>
          Samma kod med dina värden insatta, färdig att köra. Den här vyn är till för din egen dator,
          aldrig för en AI-chatt.
        </p>
        <p>Värdena är maskerade tills du väljer att visa dem, och kopiering kräver en extra bekräftelse.</p>
      </>
    ),
  },
  {
    title: 'AI — koden utan dina värden',
    body: (
      <>
        <p>
          Samma kod med ofarliga exempelvärden. Den här är den du klistrar in i en AI-chatt, och den
          kontrolleras mot valvet innan den får kopieras.
        </p>
        <p className="notice">
          Ingenting lämnar den här datorn. Appen har ingen nätverksåtkomst alls — allt sparas lokalt i
          webbläsaren, och en export är din enda backup.
        </p>
      </>
    ),
  },
];

/** Report U13. The three projections are the whole idea of the tool, and they were explained only
 * by three banner lines above the editor. Shown once, and reachable again from the settings — never
 * a wall in front of someone who has already understood it. */
export function Intro({ close }: { close: () => void }) {
  const [step, setStep] = useState(0);
  const current = steps[step]!;
  const last = step === steps.length - 1;

  return (
    <Modal title="Så fungerar AI Code Vault" close={close}>
      <div className="intro">
        <div className="intro-dots" aria-hidden="true">
          {steps.map((s, index) => (
            <span key={s.title} className={index === step ? 'current' : index < step ? 'done' : ''} />
          ))}
        </div>
        <p className="intro-step">
          Steg {step + 1} av {steps.length}
        </p>
        <h3>{current.title}</h3>
        {current.body}
      </div>
      <div className="dialog-actions">
        <button onClick={close}>{last ? 'Stäng' : 'Hoppa över'}</button>
        {step > 0 && <button onClick={() => setStep(step - 1)}>Tillbaka</button>}
        <button className="primary" autoFocus onClick={() => (last ? close() : setStep(step + 1))}>
          {last ? 'Sätt igång' : 'Nästa'}
        </button>
      </div>
    </Modal>
  );
}
