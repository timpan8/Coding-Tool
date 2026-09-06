import { useState } from 'react';
import type { ScannerRule } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { compileRules, scan } from '../../domain/scanner';
import { t } from '../text';

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const severityLabel = t.severity;

export function RulesPanel({
  storage,
  rules,
  onChange,
  notify,
}: {
  storage: StorageProvider;
  rules: ScannerRule[];
  onChange: () => void;
  notify: (message: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [sample, setSample] = useState('');
  const sorted = [...rules].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const compiled = compileRules(rules);
  const broken = compiled.filter((r) => r.invalid);

  async function toggle(rule: ScannerRule, enabled: boolean) {
    await storage.saveScannerRule({ ...rule, enabled });
    onChange();
  }

  async function addTerm() {
    const trimmed = term.trim();
    if (!trimmed) return;
    await storage.saveScannerRule({
      id: crypto.randomUUID(),
      name: `Eget sökord: ${trimmed}`,
      pattern: trimmed,
      flags: 'gi',
      severity: 'medium',
      category: 'configuration',
      explanation: t.rules.ownTerm,
      enabled: true,
      builtIn: false,
    });
    setTerm('');
    onChange();
    notify(t.rules.termAdded);
  }

  return (
    <section className="rules-panel">
      <h2>Granskningsregler</h2>
      <p>
        Reglerna föreslår värden som ser känsliga ut. De blockerar aldrig kopiering — de pekar bara ut vad som kan vara
        värt en binding.
      </p>

      {broken.length > 0 && (
        <div className="import-problems" role="alert">
          <strong>{broken.length} regler kan inte användas</strong>
          <ul>
            {broken.map((rule) => (
              <li key={rule.id}>
                {rule.name}: {rule.invalid}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rule-list">
        {sorted.map((rule) => (
          <label className="rule-row" key={rule.id}>
            <input type="checkbox" checked={rule.enabled} onChange={(e) => void toggle(rule, e.target.checked)} />
            <span className="rule-name">
              {rule.name}
              <small>
                {severityLabel[rule.severity]} · {rule.category}
                {!rule.builtIn && ' · eget'}
              </small>
            </span>
            {!rule.builtIn && (
              <button
                className="text-button"
                aria-label={`Ta bort ${rule.name}`}
                onClick={async (e) => {
                  e.preventDefault();
                  await storage.deleteScannerRule(rule.id);
                  onChange();
                }}
              >
                ×
              </button>
            )}
          </label>
        ))}
      </div>

      <label>
        Eget sökord
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="t.ex. mittforetag.se"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addTerm();
            }
          }}
        />
        {/* Deliberately not a regular expression: see the comment in domain/scanner/rules.ts. */}
        <small>{t.rules.literalNote}</small>
      </label>
      <button disabled={!term.trim()} onClick={() => void addTerm()}>
        Lägg till sökord
      </button>

      <label className="wide">
        Prova reglerna mot egen text
        <textarea rows={3} value={sample} onChange={(e) => setSample(e.target.value)} spellCheck={false} />
      </label>
      {sample.trim() && (
        <p className="import-result" role="status">
          {scan(sample, compiled).length === 0
            ? 'Ingen regel matchar den texten.'
            : scan(sample, compiled)
                .map((f) => `${f.ruleName} (rad ${f.line})`)
                .join(' · ')}
        </p>
      )}
    </section>
  );
}
