import { useState } from 'react';
import type { ImportMode, ImportResolution, ImportResult } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { canDuplicate, parseSnapshot, planImport, toSnapshot, type ImportPlan, type Snapshot, type SnapshotKind } from '../../domain/snapshot';
import type { ConfirmRequest, ConfirmResult } from './ConfirmDialog';
import { download } from '../download';
import { t } from '../text';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function BackupPanel({
  storage,
  notify,
  confirm,
}: {
  storage: StorageProvider;
  notify: (message: string) => void;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ snapshot: Snapshot; plan: ImportPlan } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [resolution, setResolution] = useState<ImportResolution>('duplicate');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [result, setResult] = useState<ImportResult | null>(null);

  const conflicts = pending?.plan.entities.filter((e) => e.action === 'conflict') ?? [];
  // Named so the dialog can say which kinds "keep both" will not apply to, rather than downgrading
  // them to "keep the vault's" without a word — the user chose one thing and got another.
  const keptInstead = [...new Set(conflicts.filter((e) => !canDuplicate(e.kind)).map((e) => e.kind))];
  // A private export carries no projects, versions or drafts. Replacing the vault with one would
  // clear them and put nothing back, so the mode is not offered for that file at all.
  const full = pending?.snapshot.kind === 'full' ? pending.snapshot : null;
  const replacing = mode === 'replace' && full !== null;

  async function exportVault(kind: SnapshotKind) {
    setBusy(true);
    try {
      const workspace = await storage.exportAll();
      const settings = workspace.settings;
      const snapshot = toSnapshot(workspace, kind, {
        version: __APP_VERSION__,
        deviceId: settings.deviceId,
        deviceName: settings.deviceName,
      });
      download(`ai-code-vault-${kind}-${stamp()}.acv.json`, JSON.stringify(snapshot, null, 2));
      notify(kind === 'full' ? 'Hela valvet exporterat.' : t.backup.privateExported);
    } catch {
      notify(t.backup.exportFailed);
    } finally {
      setBusy(false);
    }
  }

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setProblems([]);
    setResult(null);
    setBusy(true);
    try {
      const parsed = parseSnapshot(await chosen.text());
      if (!parsed.ok) {
        setProblems(parsed.problems);
        return;
      }
      const current = await storage.exportAll();
      setPending({ snapshot: parsed.snapshot, plan: planImport(parsed.snapshot, current) });
    } catch {
      setProblems([t.backup.fileUnreadable]);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!pending) return;
    if (full && replacing) {
      const workspace = await storage.exportAll();
      const ok = await confirm({
        title: t.backup.replaceTitle,
        danger: true,
        confirmLabel: t.backup.replaceConfirm,
        typeToConfirm: 'ERSÄTT',
        body: (
          <>
            <p>{t.backup.replaceLead}</p>
            <ul>
              <li>{t.backup.replaceProjects(workspace.projects.length, full.payload.projects.length)}</li>
              <li>{t.backup.replaceBindings(workspace.bindings.length, full.payload.bindings.length)}</li>
            </ul>
            <p>{t.backup.clearNoUndo}</p>
          </>
        ),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      // Resolved per entity rather than per dialog: the kinds an import cannot keep both copies of
      // are written down as the vault's, so the record of what was chosen matches what happened.
      const resolutions = Object.fromEntries(
        conflicts.map((e) => [e.id, resolution === 'duplicate' && !canDuplicate(e.kind) ? 'keep' : resolution]),
      );
      setResult(await storage.importAll(pending.snapshot.payload, replacing ? 'replace' : 'merge', resolutions));
      setPending(null);
      setMode('merge');
      notify(t.backup.importDone);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : t.backup.importFailed]);
    } finally {
      setBusy(false);
    }
  }

  async function clearVault() {
    const workspace = await storage.exportAll();
    const ok = await confirm({
      title: 'Rensa hela valvet?',
      danger: true,
      confirmLabel: 'Rensa valvet',
      typeToConfirm: 'RENSA',
      body: (
        <>
          <p>{t.backup.clearLead}</p>
          <ul>
            <li>{workspace.projects.length} projekt med all versionshistorik</li>
            <li>{workspace.bindings.length} bindings, med sina privata värden</li>
          </ul>
          <p>{t.backup.clearNoUndo}</p>
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await storage.clearAll();
      notify(t.backup.cleared);
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="backup-panel">
      <h2>Backup</h2>
      <p>
        Valvet finns bara i den här webbläsaren. En exporterad fil är den enda vägen tillbaka om webbläsardata rensas,
        profilen byts eller datorn försvinner.
      </p>
      <div className="backup-actions">
        <button className="primary" disabled={busy} onClick={() => void exportVault('full')}>
          Exportera hela valvet
        </button>
        <button disabled={busy} onClick={() => void exportVault('private')}>
          Exportera bara privata värden
        </button>
      </div>
      <p className="notice">
        <b>{t.backup.plaintextWarning}</b> Skillnaden är att den privata utelämnar
        projektkoden, inte att den är ofarlig. Förvara dem som du förvarar lösenorden de innehåller.
      </p>

      <h2>{t.backup.restore}</h2>
      <label className="file-picker">
        Välj en exporterad fil
        <input type="file" accept=".json,.acv.json,application/json" disabled={busy} onChange={(e) => void choose(e)} />
      </label>

      {problems.length > 0 && (
        <div className="import-problems" role="alert">
          <strong>{t.backup.fileRejected}</strong>
          <ul>
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="import-result" role="status">
          <p>
            {result.added} tillagda · {result.replaced} ersatta · {result.duplicated} som kopior · {result.skipped} orörda.
          </p>
          {/* The open session still holds the draft revision the vault had a moment ago. Carrying on
              would write into a project that may no longer exist, so reloading is not optional. */}
          <p>{t.backup.replacedElsewhere}</p>
          <button className="primary" onClick={() => location.reload()}>
            {t.app.reload}
          </button>
        </div>
      )}

      <h2>Rensa</h2>
      <p>
        Tar bort allt som hör till den här appen i den här webbläsaren. Använd det innan du lämnar en delad dator, och
        exportera först om något ska sparas.
      </p>
      <button className="danger" disabled={busy} onClick={() => void clearVault()}>
        Rensa hela valvet
      </button>

      {pending && (
        <div className="import-plan">
          <strong>{t.backup.planTitle}</strong>
          <p>
            {pending.plan.summary.added} nya, {pending.plan.summary.conflicts} krockar,{' '}
            {pending.plan.summary.identical} redan identiska.
          </p>
          {pending.plan.blockers.length > 0 ? (
            <div className="import-problems" role="alert">
              <strong>{t.backup.blocked}</strong>
              <ul>
                {pending.plan.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={replacing}
                  disabled={!full}
                  onChange={(e) => setMode(e.target.checked ? 'replace' : 'merge')}
                />
                {t.backup.replaceMode}
              </label>
              {!full && <p className="notice">{t.backup.replaceUnavailable}</p>}
              {replacing ? (
                <p className="inline-warning" role="status">
                  {t.backup.replaceWarning}
                </p>
              ) : (
                pending.plan.summary.conflicts > 0 && (
                  <>
                    <label>
                      {t.backup.onConflict}
                      <select value={resolution} onChange={(e) => setResolution(e.target.value as ImportResolution)}>
                        <option value="duplicate">{t.backup.keepBoth}</option>
                        <option value="keep">{t.backup.keepVault}</option>
                        <option value="replace">{t.backup.takeFile}</option>
                      </select>
                    </label>
                    {/* "Keep both" cannot be honoured for every kind. It used to fall back to the
                        vault's copy without saying so, which is a different answer than the one
                        the user gave. */}
                    {resolution === 'duplicate' && keptInstead.length > 0 && (
                      <p className="notice">{t.backup.keepBothLimited(keptInstead)}</p>
                    )}
                  </>
                )
              )}
              <div className="dialog-actions">
                <button
                  onClick={() => {
                    setPending(null);
                    setMode('merge');
                  }}
                >
                  {t.dialog.cancel}
                </button>
                <button className="primary" disabled={busy} onClick={() => void apply()}>
                  {replacing ? t.backup.applyReplace : t.backup.applyMerge}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
