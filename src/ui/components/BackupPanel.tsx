import { useState } from 'react';
import type { ImportResolution, ImportResult } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { parseSnapshot, planImport, toSnapshot, type ImportPlan, type Snapshot, type SnapshotKind } from '../../domain/snapshot';
import type { ConfirmRequest, ConfirmResult } from './ConfirmDialog';
import { download } from '../download';

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
  const [result, setResult] = useState<ImportResult | null>(null);

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
      notify(kind === 'full' ? 'Hela valvet exporterat.' : 'Privata värden exporterade.');
    } catch {
      notify('Exporten misslyckades. Inget har ändrats.');
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
      setProblems(['Filen kunde inte läsas.']);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      const resolutions = Object.fromEntries(
        pending.plan.entities.filter((e) => e.action === 'conflict').map((e) => [e.id, resolution]),
      );
      setResult(await storage.importAll(pending.snapshot.payload, 'merge', resolutions));
      setPending(null);
      notify('Importen är klar.');
    } catch (error) {
      setProblems([error instanceof Error ? error.message : 'Importen misslyckades. Valvet är oförändrat.']);
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
          <p>Allt på den här datorn raderas för alltid:</p>
          <ul>
            <li>{workspace.projects.length} projekt med all versionshistorik</li>
            <li>{workspace.bindings.length} bindings, med sina privata värden</li>
          </ul>
          <p>Det finns ingen ångra. Exportera en backup först om du kan behöva något av det igen.</p>
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await storage.clearAll();
      notify('Valvet är rensat.');
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
        <b>Båda filerna innehåller dina riktiga värden i klartext.</b> Skillnaden är att den privata utelämnar
        projektkoden, inte att den är ofarlig. Förvara dem som du förvarar lösenorden de innehåller.
      </p>

      <h2>Återställ</h2>
      <label className="file-picker">
        Välj en exporterad fil
        <input type="file" accept=".json,.acv.json,application/json" disabled={busy} onChange={(e) => void choose(e)} />
      </label>

      {problems.length > 0 && (
        <div className="import-problems" role="alert">
          <strong>Filen kunde inte användas</strong>
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
          <p>Valvet har bytts ut under den öppna sessionen. Ladda om innan du arbetar vidare.</p>
          <button className="primary" onClick={() => location.reload()}>
            Ladda om appen
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
          <strong>Så här skulle importen se ut</strong>
          <p>
            {pending.plan.summary.added} nya, {pending.plan.summary.conflicts} krockar,{' '}
            {pending.plan.summary.identical} redan identiska.
          </p>
          {pending.plan.blockers.length > 0 ? (
            <div className="import-problems" role="alert">
              <strong>Importen är blockerad</strong>
              <ul>
                {pending.plan.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {pending.plan.summary.conflicts > 0 && (
                <label>
                  Vid krock
                  <select value={resolution} onChange={(e) => setResolution(e.target.value as ImportResolution)}>
                    <option value="duplicate">Behåll båda — importera som kopia</option>
                    <option value="keep">Behåll det som finns i valvet</option>
                    <option value="replace">Ta filens version</option>
                  </select>
                </label>
              )}
              <div className="dialog-actions">
                <button onClick={() => setPending(null)}>Avbryt</button>
                <button className="primary" disabled={busy} onClick={() => void apply()}>
                  Slå ihop med valvet
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
