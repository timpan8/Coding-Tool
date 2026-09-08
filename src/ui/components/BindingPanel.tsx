import type { Binding } from '../../types/models';
import { resolveValue } from '../../domain/bindings';
import { t } from '../text';

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
  onRotated,
}: {
  rows: BindingRow[];
  onFocus: (binding: Binding) => void;
  onEdit: (binding: Binding) => void;
  onDelete: (binding: Binding) => void;
  onCreate: () => void;
  canCreate: boolean;
  /** Clears the exposure flag. The user's claim that they have changed the value elsewhere; the
   * app cannot check it and says so rather than implying otherwise. */
  onRotated?: (binding: Binding) => void;
}) {
  const orphans = rows.filter((r) => r.occurrences === 0).length;
  return (
    <>
      <div className="panel-actions">
        <button className="text-button" disabled={!canCreate} onClick={onCreate}>
          ＋ Ny
        </button>
      </div>
      <p className="muted">
        Markera ett värde och tryck <kbd>Ctrl+B</kbd> för att koppla det till en platshållare.
      </p>
      {orphans > 0 && (
        <p className="orphan-note">
          {orphans === 1 ? t.bindingPanel.used : `${orphans} bindings används`} inte i den här filen. De ligger kvar
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
                t.bindingPanel.hasValue
              )
            ) : (
              <span className="danger-text">{t.bindingPanel.missingValue}</span>
            )}
          </div>
          <div className="binding-example">AI: {binding.aiReplacement}</div>
          {binding.exposedAt && (
            <div className="binding-exposed" role="status">
              <strong>{t.exposure.flag(binding.exposedAt.slice(0, 10))}</strong>
              <small>{t.exposure.explain}</small>
              {onRotated && (
                <button className="text-button" aria-label={`${t.exposure.rotate} ${binding.name}`} title={t.exposure.rotateHint} onClick={() => onRotated(binding)}>
                  {t.exposure.rotate}
                </button>
              )}
            </div>
          )}
          <div className="binding-actions">
            <small className={occurrences === 0 ? 'danger-text' : ''}>
              {t.bindingPanel.occurrences(occurrences)}
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
          <p>{t.bindingPanel.empty}</p>
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
