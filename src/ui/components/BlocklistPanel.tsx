import { useState } from 'react';
import type { BlocklistEntry } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { nameForTerm } from '../../domain/blocklist';
import { t } from '../text';

/** The scanner points at what looks sensitive and leaves the judgement to you. This is the other
 * half: terms where the judgement is already made, so they are replaced the moment they land in the
 * workspace rather than reported for approval one at a time. */
export function BlocklistPanel({
  storage,
  entries,
  onChange,
  notify,
}: {
  storage: StorageProvider;
  entries: BlocklistEntry[];
  onChange: () => void;
  notify: (message: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const trimmed = term.trim();
  const duplicate = entries.some((e) => e.term.toLowerCase() === trimmed.toLowerCase());

  async function add() {
    if (!trimmed || duplicate) return;
    await storage.saveBlocklistEntry({
      id: crypto.randomUUID(),
      term: trimmed,
      replacement: replacement.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    setTerm('');
    setReplacement('');
    onChange();
    notify(t.blocklist.added(trimmed));
  }

  return (
    <section className="blocklist-panel">
      <h2>{t.blocklist.heading}</h2>
      <p>{t.blocklist.lead}</p>

      {entries.length > 0 && (
        <div className="rule-list">
          {entries.map((entry) => (
            <label className="rule-row" key={entry.id}>
              <input
                type="checkbox"
                checked={entry.enabled}
                aria-label={t.blocklist.enabledLabel(entry.term)}
                onChange={async (e) => {
                  await storage.saveBlocklistEntry({ ...entry, enabled: e.target.checked });
                  onChange();
                }}
              />
              <span className="rule-name">
                {entry.term}
                <small>
                  {`{{${nameForTerm(entry.term)}}}`} · {entry.replacement || t.blocklist.defaultReplacement}
                </small>
              </span>
              <button
                className="text-button"
                aria-label={t.blocklist.remove(entry.term)}
                onClick={async (e) => {
                  e.preventDefault();
                  await storage.deleteBlocklistEntry(entry.id);
                  onChange();
                }}
              >
                ×
              </button>
            </label>
          ))}
        </div>
      )}

      <label>
        {t.blocklist.termLabel}
        <input
          value={term}
          aria-label={t.blocklist.termLabel}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="t.ex. mittforetag.se"
          spellCheck={false}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
        {/* Deliberately not a regular expression: see the comment in domain/scanner/rules.ts. */}
        <small>{t.blocklist.termHint}</small>
      </label>
      <label>
        {t.blocklist.replacementLabel}
        <input value={replacement} aria-label={t.blocklist.replacementLabel} onChange={(e) => setReplacement(e.target.value)} spellCheck={false} autoComplete="off" placeholder="example.com" />
        <small>{t.blocklist.replacementHint}</small>
      </label>
      {duplicate && (
        <p className="inline-warning" role="status">
          {t.blocklist.duplicate}
        </p>
      )}
      <button disabled={!trimmed || duplicate} onClick={() => void add()}>
        {t.blocklist.add}
      </button>
    </section>
  );
}
