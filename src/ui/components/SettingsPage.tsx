import type { ScannerRule, Settings } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { formatBytes, requestPersistence, type StorageState } from '../../storage/persistence';
import { RulesPanel } from './RulesPanel';
import { BackupPanel } from './BackupPanel';
import type { ConfirmRequest, ConfirmResult } from './ConfirmDialog';

/** Report K-a. This lived as one 3.5 kB line inside App.tsx, which is why every settings change made
 * an unreadable diff.
 *
 * It owns no state. The workspace still holds the settings and decides how a write is sequenced —
 * this asks for one through `save` and never touches storage for settings itself. */
export function SettingsPage({
  settings, storage, storageInfo, onStorageInfo, deviceName, onDeviceName,
  rules, onRules, save, notify, confirm, showIntro,
}: {
  settings: Settings | null;
  storage: StorageProvider;
  storageInfo: StorageState | null;
  onStorageInfo: (state: StorageState) => void;
  deviceName: string;
  onDeviceName: (name: string) => void;
  rules: ScannerRule[];
  onRules: () => void;
  save: (patch: Partial<Settings>) => Promise<void>;
  notify: (message: string) => void;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>;
  showIntro: () => void;
}) {
  const persistence = !storageInfo ? 'Läser…'
    : !storageInfo.supported ? 'Stöds inte av webbläsaren'
      : storageInfo.persisted ? 'Ja · valvet vräks inte vid diskbrist'
        : 'Nej · webbläsaren får radera valvet';

  return <article className="document">
    <span className="eyebrow">DEN HÄR INSTALLATIONEN</span>
    <h1>Inställningar</h1>
    <p>Valvet delas inte mellan olika origin eller webbläsarprofiler.</p>

    <dl>
      <dt>Aktuellt origin</dt><dd>{location.origin}</dd>
      <dt>App-sökväg</dt><dd>{location.pathname}</dd>
      <dt>Enhets-ID</dt><dd>{settings?.deviceId}</dd>
      <dt>Lagring</dt><dd>IndexedDB · lokal klartext</dd>
      <dt>Beständig lagring</dt><dd>{persistence}</dd>
      <dt>Utrymme</dt>
      <dd>{storageInfo?.supported ? `${formatBytes(storageInfo.usedBytes)} av ${formatBytes(storageInfo.quotaBytes)}` : 'okänt'}</dd>
    </dl>

    {storageInfo && !storageInfo.persisted && <div className="persistence-warning" role="alert">
      <strong>Valvet kan raderas av webbläsaren</strong>
      <p>Utan beständig lagring får webbläsaren slänga valvet när enheten får ont om utrymme. Det finns ingen backup att återställa från.</p>
      <button onClick={() => void requestPersistence().then(state => {
        onStorageInfo(state);
        notify(state.persisted ? 'Beständig lagring beviljad.' : 'Webbläsaren nekade beständig lagring.');
      })}>Begär beständig lagring</button>
    </div>}

    <label>Enhetsnamn<input value={deviceName} onChange={e => onDeviceName(e.target.value)} /></label>

    <label className="check">
      <input type="checkbox" checked={settings?.includeAiPromptBlock ?? true}
        onChange={e => void save({ includeAiPromptBlock: e.target.checked }).catch(() => {})} />
      Lägg en instruktion överst i AI-kopian
    </label>

    {settings?.includeAiPromptBlock && <label>Instruktionens text
      <textarea aria-label="Instruktion till AI" rows={3} defaultValue={settings.aiPromptText}
        onBlur={e => void save({ aiPromptText: e.target.value }).catch(() => {})} />
      <small>Kopieras som en kommentar före koden, i det språk filen har. Gör det troligare att platshållarna kommer tillbaka orörda.</small>
    </label>}

    <label>Rensa urklipp efter Copy Local
      <select aria-label="Rensa urklipp efter Copy Local" value={settings?.clipboardAutoClearSeconds ?? 0}
        onChange={e => void save({ clipboardAutoClearSeconds: Number(e.target.value) }).catch(() => {})}>
        <option value={0}>Aldrig</option>
        <option value={30}>Efter 30 sekunder</option>
        <option value={60}>Efter 1 minut</option>
        <option value={300}>Efter 5 minuter</option>
      </select>
      <small>Skriver över urklippet när tiden gått. Nedräkningen visas och går att avbryta. Urklippshistorik och molnsynk ligger utanför appens kontroll.</small>
    </label>

    {/* Says "saved" only once the write has actually landed; save() rejects and reports its own
        failure otherwise. */}
    <button className="primary" onClick={() => void save({ deviceName }).then(() => notify('Inställningar sparade lokalt')).catch(() => {})}>Spara inställningar</button>
    <button onClick={showIntro}>Visa introduktionen igen</button>
    <p className="notice">Utkast sparas automatiskt på den här datorn. Automatisk sparning är ingen backup — exportera en fil nedan.</p>

    <RulesPanel storage={storage} rules={rules} notify={notify} onChange={onRules} />
    <BackupPanel storage={storage} notify={notify} confirm={confirm} />
  </article>;
}
