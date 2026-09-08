import type { BlocklistEntry, ScannerRule, Settings } from '../../types/models';
import type { StorageProvider, VaultStatus } from '../../storage/StorageProvider';
import { formatBytes, requestPersistence, type StorageState } from '../../storage/persistence';
import { RulesPanel } from './RulesPanel';
import { BlocklistPanel } from './BlocklistPanel';
import { EncryptionPanel } from './EncryptionPanel';
import type { ConfirmRequest, ConfirmResult } from './ConfirmDialog';
import { t } from '../text';

/** Report K-a. This lived as one 3.5 kB line inside App.tsx, which is why every settings change made
 * an unreadable diff.
 *
 * It owns no state. The workspace still holds the settings and decides how a write is sequenced —
 * this asks for one through `save` and never touches storage for settings itself. */
export function SettingsPage({
  settings, storage, storageInfo, onStorageInfo, deviceName, onDeviceName,
  rules, onRules, blocklist, onBlocklist, save, notify, showIntro,
  vault, onVault, confirm, lock,
}: {
  settings: Settings | null;
  storage: StorageProvider;
  /** Whether this vault is encrypted, and how long it waits before locking itself. */
  vault: VaultStatus | null;
  onVault: () => Promise<void>;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>;
  lock: () => void;
  storageInfo: StorageState | null;
  onStorageInfo: (state: StorageState) => void;
  deviceName: string;
  onDeviceName: (name: string) => void;
  rules: ScannerRule[];
  onRules: () => void;
  blocklist: BlocklistEntry[];
  onBlocklist: () => void;
  save: (patch: Partial<Settings>) => Promise<void>;
  notify: (message: string) => void;
  showIntro: () => void;
}) {
  const persistence = !storageInfo ? t.settings.persistenceReading
    : !storageInfo.supported ? t.settings.persistenceUnsupported
      : storageInfo.persisted ? t.settings.persistenceYes
        : t.settings.persistenceNo;

  return <article className="document">
    <span className="eyebrow">{t.settings.eyebrow}</span>
    <h1>{t.settings.title}</h1>
    <p>{t.settings.lead}</p>

    <dl>
      <dt>{t.settings.origin}</dt><dd>{location.origin}</dd>
      <dt>{t.settings.path}</dt><dd>{location.pathname}</dd>
      <dt>{t.settings.deviceId}</dt><dd>{settings?.deviceId}</dd>
      <dt>{t.settings.storage}</dt><dd>{t.settings.storageValue(vault?.encrypted ?? false)}</dd>
      <dt>{t.settings.persistence}</dt><dd>{persistence}</dd>
      <dt>{t.settings.space}</dt>
      <dd>{storageInfo?.supported ? t.settings.spaceUsed(formatBytes(storageInfo.usedBytes), formatBytes(storageInfo.quotaBytes)) : t.settings.spaceUnknown}</dd>
    </dl>

    {storageInfo && !storageInfo.persisted && <div className="persistence-warning" role="alert">
      <strong>{t.settings.atRiskTitle}</strong>
      <p>{t.settings.atRiskBody}</p>
      <button onClick={() => void requestPersistence().then(state => {
        onStorageInfo(state);
        notify(state.persisted ? t.settings.persistenceGranted : t.settings.persistenceDenied);
      })}>{t.settings.requestPersistence}</button>
    </div>}

    <label>{t.settings.deviceName}<input value={deviceName} onChange={e => onDeviceName(e.target.value)} /></label>

    <label className="check">
      <input type="checkbox" checked={settings?.includeAiPromptBlock ?? true}
        onChange={e => void save({ includeAiPromptBlock: e.target.checked }).catch(() => {})} />
      {t.settings.includePrompt}
    </label>

    {settings?.includeAiPromptBlock && <label>{t.settings.promptText}
      <textarea aria-label={t.settings.promptLabel} rows={3} defaultValue={settings.aiPromptText}
        onBlur={e => void save({ aiPromptText: e.target.value }).catch(() => {})} />
      <small>{t.settings.promptHint}</small>
    </label>}

    <label>{t.paths.root}
      {/* Written when the field is left, not per keystroke: changing the root rewrites every
          path binding that follows it, which is not something to do letter by letter. */}
      <input aria-label={t.paths.root} defaultValue={settings?.globalRootPath ?? ''} placeholder="C:\\Temp"
        key={settings?.globalRootPath ?? ''} spellCheck={false}
        onBlur={e => void save({ globalRootPath: e.target.value.trim() }).catch(() => {})} />
      <small>{t.paths.rootHint}</small>
    </label>

    <label className="check">
      <input type="checkbox" checked={settings?.localSentinel !== false}
        onChange={e => void save({ localSentinel: e.target.checked }).catch(() => {})} />
      {t.settings.sentinel}
    </label>
    <p className="notice">{t.settings.sentinelHint}</p>

    <label>{t.settings.clearClipboard}
      <select aria-label={t.settings.clearClipboard} value={settings?.clipboardAutoClearSeconds ?? 0}
        onChange={e => void save({ clipboardAutoClearSeconds: Number(e.target.value) }).catch(() => {})}>
        <option value={0}>{t.settings.clearNever}</option>
        <option value={30}>{t.settings.clear30}</option>
        <option value={60}>{t.settings.clear60}</option>
        <option value={300}>{t.settings.clear300}</option>
      </select>
      <small>{t.settings.clearHint}</small>
    </label>

    {/* Says "saved" only once the write has actually landed; save() rejects and reports its own
        failure otherwise. */}
    <button className="primary" onClick={() => void save({ deviceName }).then(() => notify(t.app.settingsSaved)).catch(() => {})}>{t.settings.save}</button>
    <button onClick={showIntro}>{t.settings.showIntro}</button>
    <p className="notice">{t.settings.backupNote}</p>

    <EncryptionPanel storage={storage} status={vault} onStatus={onVault} notify={notify} confirm={confirm} lock={lock} />
    <RulesPanel storage={storage} rules={rules} notify={notify} onChange={onRules} />
    <BlocklistPanel storage={storage} entries={blocklist} notify={notify} onChange={onBlocklist} />
    {/* Backup has its own page now. The link stays because this is where it used to be. */}
    <h3>{t.settings.backupHeading}</h3>
    <p>{t.settings.backupMoved} <a href="#/backup">{t.settings.backupLink}</a></p>
  </article>;
}
