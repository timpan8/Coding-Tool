import type { Binding } from '../../types/models';
import { resolveValue } from '../../domain/bindings';

export interface BindingRow {
  binding: Binding;
  occurrences: number;
  hasValue: boolean;
}

export function BindingPanel({
  rows,
  onFocus,
  onEdit,
  onDelete,
  onCreate,
  canCreate,
}: {
  rows: BindingRow[];
  onFocus: (binding: Binding) => void;
  onEdit: (binding: Binding) => void;
  onDelete: (binding: Binding) => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const orphans = rows.filter((r) => r.occurrences === 0).length;
  return (
    <>
      <div className="panel-title">
        <h2>Bindings</h2>
        <span className="count">{rows.length}</span>
        <button className="text-button" disabled={!canCreate} onClick={onCreate}>
          ＋ Ny
        </button>
      </div>
      <p className="muted">
        Markera ett värde och tryck <kbd>Ctrl+B</kbd> för att koppla det till en platshållare.
      </p>
      {orphans > 0 && (
        <p className="orphan-note">
          {orphans === 1 ? 'En binding används' : `${orphans} bindings används`} inte i den här filen. De ligger kvar
          med sina privata värden och kan blockera kopiering om värdet dyker upp i koden.
        </p>
      )}
      {rows.map(({ binding, occurrences, hasValue }) => (
        <div className={`binding-card ${occurrences === 0 ? 'orphan' : ''}`} key={binding.id}>
          <button className="binding-name" onClick={() => onFocus(binding)}>
            {binding.name}
          </button>
          <div className="binding-meta">
            <span>{binding.category}</span>
            <span>{binding.scope}</span>
          </div>
          <div className="binding-value">
            {hasValue ? (
              binding.category === 'secret' ? (
                '••••••••'
              ) : (
                'Privat värde angivet'
              )
            ) : (
              <span className="danger-text">⚠ VÄRDE SAKNAS</span>
            )}
          </div>
          <div className="binding-example">AI: {binding.aiReplacement}</div>
          <div className="binding-actions">
            <small className={occurrences === 0 ? 'danger-text' : ''}>
              {occurrences} {occurrences === 1 ? 'förekomst' : 'förekomster'}
            </small>
            <button className="text-button" aria-label={`Redigera ${binding.name}`} onClick={() => onEdit(binding)}>
              Redigera
            </button>
            <button className="text-button" aria-label={`Radera ${binding.name}`} onClick={() => onDelete(binding)}>
              ×
            </button>
          </div>
        </div>
      ))}
      {!rows.length && (
        <div className="bindings-empty">
          {'{{NAMN}}'}
          <p>Dina privata värden får en egen plats här.</p>
        </div>
      )}
    </>
  );
}

export function toRows(bindings: Binding[], usage: { bindingName: string; occurrences: number }[], profileId: string | null): BindingRow[] {
  return bindings.map((binding) => ({
    binding,
    occurrences: usage.find((u) => u.bindingName === binding.name)?.occurrences ?? 0,
    hasValue: Boolean(resolveValue(binding, profileId)),
  }));
}
