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

export function FindingsPanel({
  findings,
  onBind,
  onDismiss,
  onShow,
}: {
  findings: Finding[];
  onBind: (finding: Finding) => void;
  onDismiss: (finding: Finding) => void;
  onShow: (finding: Finding) => void;
}) {
  if (!findings.length) return null;
  return (
    <div className="findings-panel">
      <div className="panel-title">
        <h3>{t.findings.title}</h3>
        <span className="count">{findings.length}</span>
      </div>
      <p className="muted">
        Förslag, inte fynd. Ingen av dem blockerar kopiering — du avgör vad som är känsligt.
      </p>
      {findings.map((finding) => (
        <div className={`finding severity-${finding.severity}`} key={`${finding.start}:${finding.ruleId}`}>
          <button className="finding-head" onClick={() => onShow(finding)}>
            <b>{finding.ruleName}</b>
            <small>
              rad {finding.line} · {severityLabel[finding.severity]}
            </small>
          </button>
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
    </div>
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
