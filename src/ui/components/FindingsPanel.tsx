import { useEffect, useState } from 'react';
import type { ScanDismissal, ScannerRule } from '../../types/models';
import { scan, type Finding } from '../../domain/scanner';
import { t } from '../text';

const severityLabel: Record<Finding['severity'], string> = {
  critical: t.severity.critical,
  high: t.severity.high,
  medium: t.severity.medium,
  low: t.severity.low,
};

/** Runs the scan off the typing path.
 *
 * A pass over the file for every keystroke would make the editor feel heavy, and the result is
 * advisory: being 400 ms out of date costs nothing, because nothing here gates a copy. The copy
 * dialog re-runs it synchronously on the text actually being copied. */
export function useScanner(text: string, rules: ScannerRule[], dismissed: Set<string>): Finding[] {
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setFindings(scan(text, rules).filter((f) => !dismissed.has(f.fingerprint)));
    };
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 0);
    const timer = setTimeout(() => idle(run), 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, rules, dismissed]);
  return findings;
}

const keyOf = (finding: Finding) => `${finding.start}:${finding.ruleId}`;

export function FindingsPanel({
  findings,
  onBind,
  onBindMany,
  onDismiss,
  onShow,
}: {
  findings: Finding[];
  onBind: (finding: Finding) => void;
  /** Binding one at a time meant a dialog per finding, and a file that comes in with a dozen of them
   * is exactly when that is worst. Names are free before the first is written, so the whole set can
   * be bound in one pass. */
  onBindMany: (findings: Finding[]) => void;
  onDismiss: (finding: Finding) => void;
  onShow: (finding: Finding) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A finding disappears once it is bound or dismissed, so a selection that outlives the list would
  // count things that no longer exist.
  const chosen = findings.filter((f) => picked.has(keyOf(f)));
  const toggle = (finding: Finding, on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(keyOf(finding));
      else next.delete(keyOf(finding));
      return next;
    });

  if (!findings.length) return null;
  return (
    <details className="findings-panel side-section" open>
      <summary>
        <h2>{t.findings.title}</h2>
        <span className="count">{findings.length}</span>
      </summary>
      <p className="muted">
        Förslag, inte fynd. Ingen av dem blockerar kopiering — du avgör vad som är känsligt.
      </p>
      {findings.length > 1 && (
        <div className="findings-bulk">
          <label className="check">
            <input
              type="checkbox"
              aria-label={t.findings.selectAll}
              checked={chosen.length === findings.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(findings.map(keyOf)) : new Set())}
            />
            {t.findings.selectAll}
          </label>
          <button
            className="text-button"
            disabled={!chosen.length}
            onClick={() => {
              onBindMany(chosen);
              setPicked(new Set());
            }}
          >
            {t.findings.bindChosen(chosen.length)}
          </button>
        </div>
      )}
      {findings.map((finding) => (
        <div className={`finding severity-${finding.severity}`} key={keyOf(finding)}>
          <div className="finding-top">
            {findings.length > 1 && (
              <input
                type="checkbox"
                aria-label={t.findings.choose(finding.ruleName, finding.line)}
                checked={picked.has(keyOf(finding))}
                onChange={(e) => toggle(finding, e.target.checked)}
              />
            )}
            <button className="finding-head" onClick={() => onShow(finding)}>
              <b>{finding.ruleName}</b>
              <small>
                rad {finding.line} · {severityLabel[finding.severity]}
              </small>
            </button>
          </div>
          <code className="finding-excerpt">{finding.maskedExcerpt}</code>
          <p>{finding.explanation}</p>
          <div className="finding-actions">
            <button className="text-button" onClick={() => onBind(finding)}>
              Skapa binding
            </button>
            <button className="text-button" onClick={() => onDismiss(finding)}>
              Ofarligt här
            </button>
          </div>
        </div>
      ))}
    </details>
  );
}

/** Loads the dismissals for a project as a lookup the scan can filter against. */
export function useDismissals(load: () => Promise<ScanDismissal[]>, key: string): [Set<string>, () => void] {
  const [set, setSet] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    void load().then((all) => {
      if (alive) setSet(new Set(all.map((d) => d.fingerprint)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key identifies the project; load is recreated each render.
  }, [key, nonce]);
  return [set, () => setNonce((n) => n + 1)];
}
