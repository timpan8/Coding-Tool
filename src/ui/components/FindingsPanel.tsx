import { useEffect, useRef, useState } from 'react';
import type { LanguageId, ScanDismissal, ScannerRule } from '../../types/models';
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
export function useScanner(text: string, rules: ScannerRule[], dismissed: Set<string>, language?: LanguageId): Finding[] {
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setFindings(scan(text, rules, { language }).filter((f) => !dismissed.has(f.fingerprint)));
    };
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 0);
    const timer = setTimeout(() => idle(run), 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, rules, dismissed, language]);
  return findings;
}

/** The span a paste landed in. The nonce tells one paste from the next even when they land in
 * the same place, so the pre-selection happens once per paste and never again on a later scan. */
export interface PasteRange {
  start: number;
  end: number;
  nonce: number;
}

const keyOf = (finding: Finding) => `${finding.start}:${finding.ruleId}`;

/** Worth ticking in advance: the rule is sure, or the line itself said what the value is. A bare
 * pattern match of low severity is not — an email in a comment is still only a suggestion. */
const preselect = (finding: Finding) =>
  finding.severity === 'critical' || finding.severity === 'high' || (finding.severity === 'medium' && finding.assigned);

const CONTEXT = 40;

/** The line the value sits on, with the value itself masked. The rest of the line is the file's
 * own text, already on screen in the editor; the value is the one thing the panel must not show
 * in the clear (invariant 5 for what the list renders). */
function context(template: string, finding: Finding) {
  const lineStart = template.lastIndexOf('\n', finding.start - 1) + 1;
  const lineEndAt = template.indexOf('\n', finding.end);
  const lineEnd = lineEndAt === -1 ? template.length : lineEndAt;
  let before = template.slice(lineStart, finding.start);
  let after = template.slice(finding.end, lineEnd);
  if (before.length > CONTEXT) before = `…${before.slice(-CONTEXT)}`;
  if (after.length > CONTEXT) after = `${after.slice(0, CONTEXT)}…`;
  return { before, after };
}

export function FindingsPanel({
  findings,
  template,
  pasteRange,
  reuseFor,
  onBind,
  onBindMany,
  onReuse,
  onDismiss,
  onShow,
  onHover,
}: {
  findings: Finding[];
  template: string;
  pasteRange?: PasteRange | null;
  /** The binding that already holds this exact value, if any, so the row can offer it. */
  reuseFor: (finding: Finding) => string | undefined;
  onBind: (finding: Finding) => void;
  /** Binding one at a time meant a dialog per finding, and a file that comes in with a dozen of them
   * is exactly when that is worst. Names are free before the first is written, so the whole set can
   * be bound in one pass. */
  onBindMany: (findings: Finding[]) => void;
  onReuse: (finding: Finding, name: string) => void;
  onDismiss: (finding: Finding) => void;
  /** Jump to the value in the editor and select it. */
  onShow: (finding: Finding) => void;
  /** The row under the pointer or keyboard focus, so the editor can light the span up. */
  onHover: (finding: Finding | null) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const preselected = useRef<number | null>(null);
  const inPaste = (finding: Finding) => Boolean(pasteRange && finding.start < pasteRange.end && pasteRange.start < finding.end);
  const fromPaste = findings.filter(inPaste);
  const elsewhere = findings.filter((f) => !inPaste(f));
  // A finding disappears once it is bound or dismissed, so a selection that outlives the list would
  // count things that no longer exist.
  const chosen = findings.filter((f) => picked.has(keyOf(f)));

  // Pre-selected once per paste, the first time the scan has something for it. Later scans must
  // not touch the set: unticking a row is a decision, and the scan runs on every keystroke.
  useEffect(() => {
    if (!pasteRange || preselected.current === pasteRange.nonce || !fromPaste.length) return;
    preselected.current = pasteRange.nonce;
    setPicked(new Set(fromPaste.filter(preselect).map(keyOf)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromPaste is derived from findings.
  }, [pasteRange, findings]);

  const toggle = (finding: Finding, on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(keyOf(finding));
      else next.delete(keyOf(finding));
      return next;
    });

  if (!findings.length) {
    if (!template.trim()) return null;
    return (
      <details className="findings-panel side-section" open>
        <summary>
          <h2>{t.findings.title}</h2>
          <span className="count">0</span>
        </summary>
        <p className="muted">{t.candidates.none}</p>
      </details>
    );
  }

  const row = (finding: Finding) => {
    const { before, after } = context(template, finding);
    const reuse = reuseFor(finding);
    return (
      <div
        className={`finding severity-${finding.severity}`}
        key={keyOf(finding)}
        onMouseEnter={() => onHover(finding)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(finding)}
        onBlur={() => onHover(null)}
      >
        <div className="finding-top">
          <input
            type="checkbox"
            aria-label={t.findings.choose(finding.ruleName, finding.line)}
            checked={picked.has(keyOf(finding))}
            onChange={(e) => toggle(finding, e.target.checked)}
          />
          <button className="finding-head" aria-label={t.candidates.jump(finding.ruleName, finding.line)} onClick={() => onShow(finding)}>
            <b>{finding.ruleName}</b>
            <small>
              rad {finding.line} · {severityLabel[finding.severity]}
            </small>
          </button>
        </div>
        <span className="finding-category">{t.category[finding.category]}</span>
        <code className="finding-context">
          {before}
          <mark>{finding.maskedExcerpt}</mark>
          {after}
        </code>
        {finding.warnings.map((warning) => (
          <p className="finding-warning" key={warning}>
            ⚠ {warning}
          </p>
        ))}
        <p>{finding.explanation}</p>
        <div className="finding-actions">
          <button className="text-button" onClick={() => onBind(finding)}>
            {t.candidates.create}
          </button>
          {reuse && (
            <button className="text-button" onClick={() => onReuse(finding, reuse)}>
              {t.candidates.useExisting(reuse)}
            </button>
          )}
          <button className="text-button" onClick={() => onDismiss(finding)}>
            {t.candidates.dismiss}
          </button>
        </div>
      </div>
    );
  };

  return (
    <details className="findings-panel side-section" open>
      <summary>
        <h2>{fromPaste.length ? t.candidates.fromPaste(fromPaste.length) : t.findings.title}</h2>
        <span className="count">{findings.length}</span>
      </summary>
      <p className="muted">{t.candidates.lead}</p>
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
      {fromPaste.map(row)}
      {fromPaste.length > 0 && elsewhere.length > 0 && <h3 className="findings-group">{t.candidates.elsewhere}</h3>}
      {elsewhere.map(row)}
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
