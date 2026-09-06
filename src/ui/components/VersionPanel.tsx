import { useState } from 'react';
import type { Version } from '../../types/models';
import { t } from '../text';

const when = (iso: string) => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

/** Rough measure of how much changed, so two saves on the same day are told apart by something
 * other than their timestamp. */
export function changedLines(before: Record<string, string>, after: Record<string, string>): number {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = 0;
  for (const id of ids) {
    const a = (before[id] ?? '').split('\n');
    const b = (after[id] ?? '').split('\n');
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) if (a[i] !== b[i]) changed++;
    changed += Math.abs(a.length - b.length);
  }
  return changed;
}

export function VersionPanel({
  versions,
  baseVersionId,
  disabled,
  onPreview,
  onCompare,
  onRestore,
  onDelete,
}: {
  versions: Version[];
  baseVersionId: string | null;
  disabled?: boolean;
  onPreview: (version: Version) => void;
  onCompare: (version: Version) => void;
  onRestore: (version: Version, asNew: boolean) => void;
  onDelete: (version: Version) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="version-history">
      <div className="panel-title">
        <h2>{t.versionPanel.title}</h2>
        <span className="count">{versions.length}</span>
      </div>
      {versions.map((version, index) => {
        const previous = versions[index + 1];
        const delta = previous ? changedLines(previous.templates, version.templates) : null;
        return (
          <div className={`version-item ${version.id === baseVersionId ? 'current' : ''}`} key={version.id}>
            <button
              disabled={disabled}
              onClick={() => setOpen(open === version.id ? null : version.id)}
              aria-expanded={open === version.id}
            >
              <b>v{version.number}</b>
              <span>
                {version.label || 'Utan etikett'}
                <small>
                  {when(version.createdAt)}
                  {delta !== null && ` · ${delta} ändrade rader`}
                  {version.id === baseVersionId && t.versionPanel.draftBasedOnThis}
                </small>
              </span>
            </button>
            {open === version.id && (
              <div className="version-actions">
                <button className="text-button" disabled={disabled} onClick={() => onPreview(version)}>
                  Visa
                </button>
                {previous && (
                  <button className="text-button" disabled={disabled} onClick={() => onCompare(version)}>
                    Jämför med v{previous.number}
                  </button>
                )}
                <button className="text-button" disabled={disabled} onClick={() => onRestore(version, false)}>
                  Återställ
                </button>
                <button className="text-button" disabled={disabled} onClick={() => onRestore(version, true)}>
                  Återställ som ny version
                </button>
                <button className="text-button danger-text" disabled={disabled} onClick={() => onDelete(version)}>
                  Radera
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!versions.length && (
        <p>{t.versionPanel.empty}</p>
      )}
    </div>
  );
}
