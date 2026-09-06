import type { Coverage } from '../../domain/render/coverage';
import type { Finding } from '../../domain/scanner';
import { Modal } from './Modal';
import { t } from '../text';

function AiCopyReview({ coverage, issues, replaced, findings }: { coverage: Coverage; issues: number; replaced: number; findings: Finding[] }) {
  const { bound, literals, unbound } = coverage;
  const serious = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const headline = issues
    ? t.review.needsReview
    : serious.length
      ? t.review.suspicious(serious.length)
      : bound === 0
      ? literals === 0
        ? t.review.nothingToProtect
        : t.review.nothingProtected
      : t.review.clean;
  return (
    <>
      <p className={issues || serious.length || bound === 0 ? 'danger-text' : ''}><b>{headline}</b></p>
      <p>
        <b>{t.review.boundOf(bound, literals)}</b>{t.review.coverageTail(replaced)}
      </p>
      {bound === 0 && literals > 0 && (
        <p>{t.review.nothingBound}</p>
      )}
      {findings.length > 0 && (
        <ul className="unbound-values">
          {findings.slice(0, 8).map((finding, index) => (
            <li key={index}>
              {t.review.finding(finding.line, finding.ruleName)}<code>{finding.maskedExcerpt}</code>
            </li>
          ))}
          {findings.length > 8 && <li>{t.review.andMore(findings.length - 8)}</li>}
        </ul>
      )}
      {unbound.length > 0 && (
        <ul className="unbound-values">
          {unbound.slice(0, 6).map((literal, index) => (
            <li key={index}><code>{literal.text.length > 60 ? literal.text.slice(0, 60) + '…' : literal.text}</code></li>
          ))}
          {unbound.length > 6 && <li>{t.review.andMore(unbound.length - 6)}</li>}
        </ul>
      )}
      <p className="notice">{t.review.scopeNote(findings.length > 0 ? t.review.scopeListed : t.review.scopeScan)}</p>
    </>
  );
}

/** Report K-a. The dialog was one 1.6 kB line in App.tsx.
 *
 * It is the last thing between a private value and a chat window, so both ways out — the clipboard
 * and the file — sit behind the same review checkbox, and neither knows how to produce the text.
 * The workspace re-audits on the current text and does that. */
export function CopyDialog({
  mode, coverage, issues, replaced, findings, seriousFindings, reviewed, onReviewed, onCopy, onDownload, close,
}: {
  mode: 'local' | 'ai';
  coverage: Coverage;
  issues: number;
  replaced: number;
  findings: Finding[];
  seriousFindings: number;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  onCopy: () => void;
  onDownload: () => void;
  close: () => void;
}) {
  const held = mode === 'ai' && Boolean(seriousFindings) && !reviewed;
  const clean = coverage.bound > 0 && !seriousFindings;

  return <Modal title={mode === 'local' ? t.review.localTitle : t.review.aiTitle} close={close}>
    {mode === 'local' ? <>
      <p>{t.review.localWarning}</p>
      <p className="notice">{t.review.localClipboardNote}</p>
    </> : <AiCopyReview coverage={coverage} issues={issues} replaced={replaced} findings={findings} />}

    {mode === 'ai' && Boolean(seriousFindings) && <label className="check inline-warning">
      <input type="checkbox" checked={reviewed} onChange={e => onReviewed(e.target.checked)} />
      {t.review.acknowledge(seriousFindings)}
    </label>}

    <div className="dialog-actions">
      <button onClick={close}>{t.dialog.cancel}</button>
      {/* A file is as easy to hand to an AI as the clipboard is, so it waits on the same review. */}
      <button disabled={held} onClick={onDownload}>{t.review.download}</button>
      <button className={mode === 'local' ? 'danger' : clean ? 'primary' : ''} disabled={held} onClick={onCopy}>
        {mode === 'local' ? t.review.copyLocalConfirm : clean ? t.review.copyAiReviewed : t.review.copyAnyway}
      </button>
    </div>
  </Modal>;
}
