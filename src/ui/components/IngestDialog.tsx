import { useMemo, useState } from 'react';
import type { Binding } from '../../types/models';
import { ingest, type IngestDecision } from '../../domain/roundtrip';
import { Modal } from './Modal';

const tierLabel: Record<IngestDecision['tier'], string> = {
  1: 'Platshållare kvar',
  2: 'Återställd',
  3: 'Liknar — granska själv',
};

/** Code goes out with placeholders and comes back changed. Without this the values have to be put
 * back by hand, which is where they get lost. */
export function IngestDialog({
  bindings,
  apply,
  close,
}: {
  bindings: Binding[];
  apply: (template: string) => void;
  close: () => void;
}) {
  const [incoming, setIncoming] = useState('');
  const result = useMemo(() => (incoming.trim() ? ingest(incoming, bindings) : null), [incoming, bindings]);
  const applied = result?.decisions.filter((d) => d.accepted).length ?? 0;
  const suggestions = result?.decisions.filter((d) => d.tier === 3) ?? [];
  const unknown = result?.decisions.filter((d) => d.tier === 1 && !d.accepted) ?? [];

  return (
    <Modal title="Klistra in kod från AI" close={close}>
      <label>
        <span>Klistra in svaret här</span>
        <textarea
          autoFocus
          aria-label="Kod från AI"
          rows={8}
          value={incoming}
          spellCheck={false}
          onChange={(e) => setIncoming(e.target.value)}
          placeholder="Koden som AI:n gav tillbaka"
        />
      </label>

      {result && (
        <>
          <p>
            <b>{applied}</b> platshållare på plats, <b>{suggestions.length}</b> att granska
            {unknown.length > 0 && `, ${unknown.length} utan binding`}.
          </p>
          {result.decisions.length > 0 && (
            <ul className="ingest-decisions">
              {result.decisions.slice(0, 12).map((decision, index) => (
                <li key={index} className={decision.accepted ? 'accepted' : 'suggested'}>
                  <b>{decision.bindingName}</b> · {tierLabel[decision.tier]}
                  <small>{decision.reason}</small>
                </li>
              ))}
              {result.decisions.length > 12 && <li>och {result.decisions.length - 12} till</li>}
            </ul>
          )}
          {suggestions.length > 0 && (
            <p className="inline-warning">
              Det som bara liknar ett AI-värde lämnas orört. En automatisk gissning här skulle skriva om din kod kring
              ett värde som aldrig var ditt.
            </p>
          )}
        </>
      )}

      <p className="notice">Den öppna filens mall ersätts. Spara en version först om du vill kunna gå tillbaka.</p>
      <div className="dialog-actions">
        <button onClick={close}>Avbryt</button>
        <button className="primary" disabled={!result} onClick={() => result && apply(result.template)}>
          Ersätt mallen
        </button>
      </div>
    </Modal>
  );
}
