import { useState } from 'react';
import type { ProjectFile } from '../../types/models';
import { t } from '../text';

export function FileTabs({
  files,
  activeId,
  disabled,
  onSelect,
  onAdd,
  onRename,
  onRemove,
}: {
  files: ProjectFile[];
  activeId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <nav className="file-tabs" aria-label={t.files.tabs}>
      {files.map((file) => (
        <span key={file.id} className={`file-tab ${file.id === activeId ? 'current' : ''}`}>
          {editing === file.id ? (
            <input
              autoFocus
              aria-label={t.files.name}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onRename(file.id, draft);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button
              aria-current={file.id === activeId ? 'true' : undefined}
              disabled={disabled}
              onClick={() => onSelect(file.id)}
              onDoubleClick={() => {
                setDraft(file.name);
                setEditing(file.id);
              }}
              title={t.files.renameHint}
            >
              {file.name}
            </button>
          )}
          {files.length > 1 && (
            <button
              className="file-close"
              aria-label={t.files.remove(file.name)}
              disabled={disabled}
              onClick={() => onRemove(file.id)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <button className="file-add" aria-label={t.files.add} disabled={disabled} onClick={onAdd}>
        ＋
      </button>
    </nav>
  );
}
