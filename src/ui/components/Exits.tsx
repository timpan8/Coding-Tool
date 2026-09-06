import type { RenderIssue } from '../../domain/render';
import { t } from '../text';

/** What the second press of Copy RIKTIGT is about to do, said before it does it. */
export interface LocalChecklist {
  /** Placeholders whose binding resolves to a value, out of the distinct placeholders in the file. */
  resolved: number;
  total: number;
  missing: string[];
  /** Placeholders in a quoting context the language cannot escape safely. */
  blocked: number;
  /** Private values that will be written in the clear. */
  secrets: number;
  profile?: string;
}

/** The two ways out of the workspace, made impossible to confuse.
 *
 * Copy for AI is the primary action of the whole app and looks it: green, first, with the shortcut.
 * Copy RIKTIGT is amber and never copies on the first press. The first press arms it for a few
 * seconds and shows the checklist of what is about to leave; the second press copies. That is the
 * second, explicit choice invariant 9 asks for, without a dialog in the way of the common case.
 *
 * A disabled button is never bare: it names how many problems block it and points at the panel
 * that lists them (Report U1). */
export function Exits({
  hasText,
  aiIssues,
  localIssues,
  seriousFindings,
  blockedCount,
  armed,
  checklist,
  onCopyAi,
  onDownloadAi,
  onCopyLocal,
  onDetails,
}: {
  hasText: boolean;
  aiIssues: RenderIssue[];
  localIssues: RenderIssue[];
  seriousFindings: number;
  blockedCount: number;
  armed: boolean;
  checklist: LocalChecklist;
  onCopyAi: () => void;
  onDownloadAi: () => void;
  onCopyLocal: () => void;
  onDetails: () => void;
}) {
  const aiBlocked = aiIssues.length;
  const localBlocked = localIssues.length;
  return (
    <div className="exits copy-actions">
      <button
        className="exit-ai primary"
        disabled={!hasText || aiBlocked > 0}
        aria-describedby={aiBlocked ? 'copy-blocked' : undefined}
        title={aiBlocked ? t.toolbar.blockedBy(aiBlocked, 'AI') : 'Ctrl+Enter'}
        onClick={onCopyAi}
      >
        <span aria-hidden="true">🛡</span> {t.exits.copyAi}
        {aiBlocked > 0 ? (
          <small>{t.exits.problems(aiBlocked)}</small>
        ) : seriousFindings > 0 ? (
          <small>{t.exits.findings(seriousFindings)}</small>
        ) : null}
      </button>
      <button className="text-button exit-download" disabled={!hasText || aiBlocked > 0} onClick={onDownloadAi}>
        {t.exits.downloadAi}
      </button>
      <button
        className={`exit-real ${armed ? 'armed' : ''}`}
        disabled={!hasText || localBlocked > 0}
        aria-describedby={localBlocked ? 'copy-blocked' : undefined}
        title={localBlocked ? t.toolbar.blockedBy(localBlocked, 'Local') : 'Ctrl+Shift+Enter'}
        onClick={onCopyLocal}
      >
        <span aria-hidden="true">🔒</span> {armed ? t.exits.copyLocalArmed : t.exits.copyLocal}
      </button>
      {blockedCount > 0 && (
        <span id="copy-blocked" className="copy-blocked">
          {t.toolbar.blockedCount(blockedCount)}
        </span>
      )}
      {armed && (
        <div className="exit-checklist" role="status">
          <ul>
            <li className={checklist.missing.length ? 'bad' : 'ok'}>{t.exits.checkResolved(checklist.resolved, checklist.total)}</li>
            {checklist.missing.length > 0 && <li className="bad">{t.exits.checkMissing(checklist.missing)}</li>}
            {checklist.blocked > 0 && <li className="bad">{t.exits.checkBlocked(checklist.blocked)}</li>}
            <li className="warn">{t.exits.checkSecrets(checklist.secrets)}</li>
            <li>{checklist.profile ? t.exits.checkProfile(checklist.profile) : t.exits.checkDefaultProfile}</li>
            <li>{t.exits.checkClipboard}</li>
          </ul>
          <p>
            {t.exits.armedHint}{' '}
            <button className="text-button" onClick={onDetails}>
              {t.exits.details}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
