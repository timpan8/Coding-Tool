import type { RenderIssue } from '../../domain/render';
import { t } from '../text';

export type Mode = 'template' | 'local' | 'ai';

const label: Record<Mode, string> = { template: t.toolbar.template, local: t.toolbar.local, ai: t.toolbar.ai };

/** Report K-a. The view tabs and the copy buttons were one 1.4 kB line inside App.tsx.
 *
 * A disabled copy button is never bare: it names the projection whose problems block it, and points
 * at the panel that lists them. Report U1 — a button that is off for a reason nobody can see reads
 * as a broken button. */
export function EditorToolbar({
  mode, onMode, canIngest, onIngest, hasText, localIssues, aiIssues, blockedCount, canCopySelection, onCopy, onCopySelection,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  canIngest: boolean;
  onIngest: () => void;
  hasText: boolean;
  localIssues: RenderIssue[];
  aiIssues: RenderIssue[];
  blockedCount: number;
  canCopySelection: boolean;
  onCopy: (which: 'local' | 'ai') => void;
  onCopySelection: () => void;
}) {
  const blocked = (issues: RenderIssue[], view: string) => ({
    disabled: !hasText || issues.length > 0,
    'aria-describedby': issues.length ? 'copy-blocked' : undefined,
    title: issues.length ? t.toolbar.blockedBy(issues.length, view) : undefined,
  });

  return <div className="editor-toolbar">
    <div className="view-tabs" role="tablist" aria-label={t.toolbar.views}>
      {(['template', 'local', 'ai'] as Mode[]).map(m =>
        <button key={m} id={`vy-${m}`} role="tab" aria-selected={mode === m} aria-controls="kodvy"
          className={mode === m ? 'active' : ''} onClick={() => onMode(m)}>{label[m]}</button>)}
    </div>
    <div className="copy-actions">
      <button disabled={!canIngest} onClick={onIngest}>{t.toolbar.ingest}</button>
      {blockedCount > 0 && <span id="copy-blocked" className="copy-blocked">
        {t.toolbar.blockedCount(blockedCount)}
      </span>}
      <button {...blocked(localIssues, 'Local')} onClick={() => onCopy('local')}>{t.toolbar.copyLocal}</button>
      {canCopySelection && <button className="copy-selection" onClick={onCopySelection}>{t.toolbar.copySelection}</button>}
      <button className="ai-copy" {...blocked(aiIssues, 'AI')} onClick={() => onCopy('ai')}>{t.toolbar.copyAi}</button>
    </div>
  </div>;
}
