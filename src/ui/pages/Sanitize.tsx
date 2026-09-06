import { useMemo, useState } from 'react';
import type { Binding, BlocklistEntry, ScannerRule } from '../../types/models';
import { applyBlocklist } from '../../domain/blocklist';
import { buildValueIndex, findLeaks } from '../../domain/render/leak';
import { placeholderRegex } from '../../domain/render';
import { scan, type Finding } from '../../domain/scanner';
import { t } from '../text';

const severityLabel: Record<Finding['severity'], string> = {
  critical: t.severity.critical,
  high: t.severity.high,
  medium: t.severity.medium,
  low: t.severity.low,
};

/** What the page does to a text, as a pure function so it can be tested without the page. */
export function sanitize(text: string, bindings: Binding[], blocklist: BlocklistEntry[]) {
  const scope = { scope: 'global' as const, scopeRef: null };
  // Blocklisted terms first: a term that is already a binding gets that binding's AI value, one
  // that is not gets the replacement the entry names, or the category's plain default.
  const listed = applyBlocklist(text, blocklist, bindings, scope);
  const aiFor = new Map<string, string>();
  for (const match of listed.matches) {
    aiFor.set(match.name, bindings.find((b) => b.name === match.name)?.aiReplacement ?? match.entry.replacement ?? 'EXAMPLE_VALUE');
  }
  let out = listed.text.replace(placeholderRegex(), (whole, name: string) => aiFor.get(name) ?? whole);
  // Then every private value the vault knows, longest first so a value containing another is
  // replaced whole. Placeholders left over are ones the text carried in from a project.
  let replaced = listed.replacements;
  const byName = new Map(bindings.map((b) => [b.name, b.aiReplacement]));
  // The plain values: swapping an encoded form for a plain stand-in would corrupt the text it
  // sits in. The encoded forms are still reported below, as what is left over.
  const known = [...buildValueIndex(bindings).plain].sort((a, b) => b.value.length - a.value.length);
  for (const entry of known) {
    const parts = out.split(entry.value);
    if (parts.length > 1) {
      replaced += parts.length - 1;
      out = parts.join(byName.get(entry.name) ?? entry.name);
    }
  }
  return { text: out, replaced, remaining: findLeaks(out, buildValueIndex(bindings)).length };
}

/** Report of a value that the vault does not know, on the page rather than in a project: nothing
 * here is saved. Binding one creates a global binding, because a value met in an error message is
 * not about any one project. */
export function SanitizePage({
  bindings,
  blocklist,
  rules,
  notify,
  onBind,
}: {
  bindings: Binding[];
  blocklist: BlocklistEntry[];
  rules: ScannerRule[];
  notify: (text: string, tone?: 'info' | 'ok' | 'warn' | 'error') => void;
  onBind: (finding: Finding, value: string) => void;
}) {
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const result = useMemo(() => sanitize(text, bindings, blocklist), [text, bindings, blocklist]);
  const findings = useMemo(
    () => (result.text.trim() ? scan(result.text, rules, { language: 'plaintext' }).filter((f) => !hidden.has(f.fingerprint)) : []),
    [result.text, rules, hidden],
  );

  async function copy() {
    if (!result.text.trim()) {
      notify(t.sanitize.empty, 'warn');
      return;
    }
    // The exact-value check runs on the text that goes out, the same way auditForCopy does for a
    // project. A known value still standing here means a binding without an AI value, or a value
    // inside a longer one; either way it does not leave.
    if (result.remaining) {
      notify(t.sanitize.blocked(result.remaining), 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(result.text);
      notify(t.sanitize.copied, 'ok');
    } catch {
      notify(t.refusal.clipboardDenied, 'warn');
    }
  }

  return (
    <section className="sanitize-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t.sanitize.eyebrow}</span>
          <h1>{t.sanitize.title}</h1>
          <p>{t.sanitize.lead}</p>
        </div>
        <div className="heading-actions">
          <button disabled={!text} onClick={() => setText('')}>
            {t.sanitize.clear}
          </button>
          <button className="primary" disabled={!result.text.trim()} onClick={() => void copy()}>
            <span aria-hidden="true">🛡</span> {t.sanitize.copy}
          </button>
        </div>
      </div>
      <div className="sanitize-grid">
        <label>
          {t.sanitize.input}
          <textarea aria-label={t.sanitize.input} placeholder={t.sanitize.inputHint} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </label>
        <label>
          {t.sanitize.output}
          <textarea aria-label={t.sanitize.output} readOnly value={result.text} spellCheck={false} />
          <small role="status">{text ? (result.replaced ? t.sanitize.replaced(result.replaced) : t.sanitize.nothingReplaced) : ''}</small>
        </label>
      </div>
      {findings.length > 0 && (
        <div className="sanitize-findings findings-panel">
          <div className="panel-title">
            <h2>{t.sanitize.findings}</h2>
            <span className="count">{findings.length}</span>
          </div>
          <p className="muted">{t.sanitize.findingsLead}</p>
          {findings.map((finding) => (
            <div className={`finding severity-${finding.severity}`} key={`${finding.start}:${finding.ruleId}`}>
              <div className="finding-top">
                <b>{finding.ruleName}</b>
                <small>
                  rad {finding.line} · {severityLabel[finding.severity]}
                </small>
              </div>
              <span className="finding-category">{t.category[finding.category]}</span>
              <code className="finding-excerpt">{finding.maskedExcerpt}</code>
              <p>{finding.explanation}</p>
              <div className="finding-actions">
                <button className="text-button" onClick={() => onBind(finding, result.text.slice(finding.start, finding.end))}>
                  {t.sanitize.bindNow}
                </button>
                <button className="text-button" onClick={() => setHidden((previous) => new Set(previous).add(finding.fingerprint))}>
                  {t.sanitize.hide}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
