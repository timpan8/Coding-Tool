import type { Coverage } from '../../domain/render/coverage';
import type { Finding } from '../../domain/scanner';
import { Modal } from './Modal';

function AiCopyReview({ coverage, issues, replaced, findings }: { coverage: Coverage; issues: number; replaced: number; findings: Finding[] }) {
  const { bound, literals, unbound } = coverage;
  const serious = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const headline = issues
    ? 'Granskning krävs'
    : serious.length
      ? `${serious.length} misstänkta värden hittades`
      : bound === 0
      ? literals === 0
        ? 'Ingenting att skydda hittades i koden'
        : 'Inga värden är skyddade'
      : 'Inga kända problem hittades';
  return (
    <>
      <p className={issues || serious.length || bound === 0 ? 'danger-text' : ''}><b>{headline}</b></p>
      <p>
        <b>{bound} av {literals}</b> strängvärden är kopplade till bindings. {replaced} förekomster ersätts vid kopiering.
      </p>
      {bound === 0 && literals > 0 && (
        <p>Inget värde är kopplat till en binding, så allt nedan skickas som det står.</p>
      )}
      {findings.length > 0 && (
        <ul className="unbound-values">
          {findings.slice(0, 8).map((finding, index) => (
            <li key={index}>
              rad {finding.line} · {finding.ruleName} · <code>{finding.maskedExcerpt}</code>
            </li>
          ))}
          {findings.length > 8 && <li>och {findings.length - 8} till</li>}
        </ul>
      )}
      {unbound.length > 0 && (
        <ul className="unbound-values">
          {unbound.slice(0, 6).map((literal, index) => (
            <li key={index}><code>{literal.text.length > 60 ? literal.text.slice(0, 60) + '…' : literal.text}</code></li>
          ))}
          {unbound.length > 6 && <li>och {unbound.length - 6} till</li>}
        </ul>
      )}
      <p className="notice">
        Kontrollen omfattar saknade bindings, stödd escaping, exakta kända privata värden och {findings.length > 0 ? 'de misstänkta värden som listas ovan' : 'en genomsökning efter misstänkta värden'}. Mönstren fångar det som liknar
        hemligheter — inte allt som är känsligt i just din miljö. Läs igenom koden själv innan du delar den.
      </p>
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

  return <Modal title={mode === 'local' ? '⚠ Kopiera riktiga värden' : 'AI-export · granska före kopiering'} close={close}>
    {mode === 'local' ? <>
      <p>Den lokala koden innehåller secrets. Kopiera den endast till din lokala kodmiljö, aldrig till en AI-chatt.</p>
      <p className="notice">Urklippshistorik och molnsynk kan lagra eller överföra innehållet. Appen kontrollerar inte dessa funktioner.</p>
    </> : <AiCopyReview coverage={coverage} issues={issues} replaced={replaced} findings={findings} />}

    {mode === 'ai' && Boolean(seriousFindings) && <label className="check inline-warning">
      <input type="checkbox" checked={reviewed} onChange={e => onReviewed(e.target.checked)} />
      Jag har tittat på de {seriousFindings} misstänkta värdena och vill ändå kopiera.
    </label>}

    <div className="dialog-actions">
      <button onClick={close}>Avbryt</button>
      {/* A file is as easy to hand to an AI as the clipboard is, so it waits on the same review. */}
      <button disabled={held} onClick={onDownload}>Ladda ned som fil</button>
      <button className={mode === 'local' ? 'danger' : clean ? 'primary' : ''} disabled={held} onClick={onCopy}>
        {mode === 'local' ? 'Kopiera LOCAL med secrets' : clean ? 'Jag har granskat · kopiera för AI' : 'Kopiera oskyddad kod ändå'}
      </button>
    </div>
  </Modal>;
}
