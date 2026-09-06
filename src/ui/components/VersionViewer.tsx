import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { LanguageId, ProjectFile, Version } from '../../types/models';
import { Editor } from '../editor/Editor';
import { Modal } from './Modal';
import { changedLineCount, diffStats, formatStats } from '../../domain/diff';
import type { ResolvedTheme } from '../theme';
import { t } from '../text';

const DiffEditor = lazy(() => import('../editor/DiffEditor').then(m => ({ default: m.DiffEditor })));

/** Two panes are worth having at roughly 60 characters each. The dialog is min(1100px, 92vw), so
 * below this the inline view shows the same changes in the width that actually exists. */
const WIDE = '(min-width: 1000px)';

function useWide() {
  const [wide, setWide] = useState(() => (typeof matchMedia === 'function' ? matchMedia(WIDE).matches : true));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(WIDE);
    const handler = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return wide;
}

/** The files a version actually holds.
 *
 * `version.files` is the list as it stood when the version was saved, but it is absent on records
 * written before that field existed. The ids are still the keys of `templates`, so those are the
 * fallback; names are borrowed from the project where an id still matches, which degrades a rename
 * to the current name rather than to a raw uuid. */
export function versionFiles(version: Version, current: ProjectFile[]): ProjectFile[] {
  if (version.files?.length) return version.files;
  return Object.keys(version.templates).map((id, index) =>
    current.find(f => f.id === id) ?? { id, name: `Fil ${index + 1}`, language: 'plaintext' as LanguageId, order: index });
}

/** Read-only view of one saved version, either on its own or against the version before it.
 *
 * Report U-diff. Previously this was inline in App.tsx and looked the file up by
 * `session.activeFileId` alone, falling back to an empty string. Opening a version saved before the
 * file you happen to have open therefore showed two blank panes over the words "så här såg
 * versionen ut" — the history lied about what it held. It also rendered a two-pane diff for a plain
 * preview, so the same text appeared twice with nothing between the panes to compare. */
export function VersionViewer({
  version, compareTo, activeFileId, currentFiles, language, theme, close, restore,
}: {
  version: Version;
  /** The version to compare against, or null for a plain read-only preview. */
  compareTo: Version | null;
  activeFileId: string;
  currentFiles: ProjectFile[];
  language: LanguageId;
  theme: ResolvedTheme;
  close: () => void;
  restore: () => void;
}) {
  const wide = useWide();
  const files = useMemo(() => versionFiles(version, currentFiles), [version, currentFiles]);
  // The workspace's file when the version has it, so opening a version keeps the reader where they
  // were; otherwise a file the version actually contains, named in the notice below.
  const [fileId, setFileId] = useState(() => (files.some(f => f.id === activeFileId) ? activeFileId : (files[0]?.id ?? activeFileId)));
  const file = files.find(f => f.id === fileId);
  const modified = version.templates[fileId] ?? '';
  const original = compareTo ? (compareTo.templates[fileId] ?? '') : modified;
  const stats = compareTo ? diffStats(original, modified) : null;
  const delta = stats ? changedLineCount(stats) : 0;

  // A six-line diff in a fixed 480px box left two thirds of it blank. Monaco lays out to its
  // container, so the container is what has to know how tall the content is. Word wrap means
  // counting rows rather than lines: an unwrapped count left the narrow view clipped mid-line.
  // The per-row figure is the width one pane gets at each layout, in 13px monospace; a wrong guess
  // only costs a scrollbar, and CSS caps the result against the viewport.
  const perRow = wide ? 62 : 34;
  const rows = (text: string) => text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perRow)), 0);
  const height = `${Math.min(520, Math.max(200, Math.max(rows(original), rows(modified)) * 21 + 34))}px`;

  const substituted = !files.some(f => f.id === activeFileId);
  const activeName = currentFiles.find(f => f.id === activeFileId)?.name;
  const missingBefore = Boolean(compareTo) && !(fileId in (compareTo?.templates ?? {}));

  const title = compareTo ? `v${compareTo.number} → v${version.number}` : `v${version.number}${version.label ? ` · ${version.label}` : ''}`;

  return (
    <Modal title={title} close={close}>
      <div className="version-toolbar">
        {files.length > 1 ? (
          <label className="version-file-pick">
            {t.version.pickFile}
            <select value={fileId} onChange={e => setFileId(e.target.value)}>
              {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        ) : (
          <span className="version-file-name">{file?.name ?? ''}</span>
        )}
        <span className="version-delta">
          {stats ? (delta ? `${formatStats(stats)} · ${t.version.changedLines(delta)}` : t.version.identical) : t.version.readOnlyView(version.number)}
        </span>
      </div>

      {compareTo && wide && (
        <div className="version-panes" aria-hidden="true">
          <span>{t.version.paneBefore(compareTo.number)}</span>
          <span>{t.version.paneAfter(version.number)}</span>
        </div>
      )}

      <div className="version-view" style={{ '--version-view-height': height } as CSSProperties}>
        {compareTo ? (
          <Suspense fallback={<p className="muted">{t.version.loadingDiff}</p>}>
            <DiffEditor language={language} theme={theme} sideBySide={wide} original={original} modified={modified} />
          </Suspense>
        ) : (
          // A preview has nothing to compare against. Rendering it in the diff widget put the same
          // text in both panes, which reads as "no changes found" rather than as a single version.
          // `active` is what makes CodeEditor call layout(): created inside a dialog that was
          // display:none until showModal(), Monaco measures zero and stays blank without it.
          <Editor key={`version-${version.id}-${fileId}`} documentKey={`version-${version.id}-${fileId}`} active
            value={modified} language={language} theme={theme} readOnly wordWrap />
        )}
      </div>

      {substituted && activeName && (
        <p className="notice" role="status">
          {t.version.fileNotInVersion(activeName, version.number)} {file ? t.version.showingFile(file.name) : ''}
        </p>
      )}
      {missingBefore && compareTo && <p className="notice">{t.version.fileMissingBefore(compareTo.number)}</p>}
      {!modified.trim() && !substituted && <p className="notice">{t.version.emptyInVersion}</p>}
      <p className="muted version-scope">
        {t.version.readOnlyNote}
        {files.length > 1 ? ` · ${t.version.ofFiles(files.length)}` : ''}
      </p>

      <div className="dialog-actions">
        <button onClick={close}>{t.dialog.close}</button>
        <button className="primary" onClick={restore}>{t.version.restoreNumbered(version.number)}</button>
      </div>
    </Modal>
  );
}
