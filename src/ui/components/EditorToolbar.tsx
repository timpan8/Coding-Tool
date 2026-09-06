import { t } from '../text';

export type Mode = 'template' | 'local' | 'ai';

const label: Record<Mode, string> = { template: t.toolbar.template, local: t.toolbar.local, ai: t.toolbar.ai };

/** Report K-a. The view tabs used to share a 1.4 kB line inside App.tsx with the copy buttons.
 *
 * The copy buttons have since moved to their own row (`Exits`), so this is the view switch and the
 * two actions that belong beside it: bringing code back from an AI, and copying a selection. */
export function EditorToolbar({
  mode, onMode, canIngest, onIngest, canCopySelection, onCopySelection,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  canIngest: boolean;
  onIngest: () => void;
  canCopySelection: boolean;
  onCopySelection: () => void;
}) {
  return <div className="editor-toolbar">
    <div className="view-tabs" role="tablist" aria-label={t.toolbar.views}>
      {(['template', 'local', 'ai'] as Mode[]).map(m =>
        <button key={m} id={`vy-${m}`} role="tab" aria-selected={mode === m} aria-controls="kodvy"
          className={mode === m ? 'active' : ''} onClick={() => onMode(m)}>{label[m]}</button>)}
    </div>
    <div className="toolbar-actions">
      {canCopySelection && <button className="copy-selection" onClick={onCopySelection}>{t.toolbar.copySelection}</button>}
      <button disabled={!canIngest} onClick={onIngest}>{t.toolbar.ingest}</button>
    </div>
  </div>;
}
