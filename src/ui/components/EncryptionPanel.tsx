import { useState } from 'react';
import type { StorageProvider, VaultStatus } from '../../storage/StorageProvider';
import { formatRecoveryKey, WrongPasswordError, type VaultSecret } from '../../storage/crypto';
import { Modal } from './Modal';
import { SecretInput } from './SecretInput';
import type { ConfirmRequest, ConfirmResult } from './ConfirmDialog';
import { download } from '../download';
import { t } from '../text';

const MIN_LENGTH = 8;

/** Turning encryption on, off, and everything that follows from having a key.
 *
 * Plaintext is the default and stays the default: encrypting is a decision with a cost, and the
 * cost is that a lost password and a lost recovery key mean a lost vault. The dialog says that
 * before it asks, shows the recovery key once with a way to save it, and will not close until the
 * user says they have it. */
export function EncryptionPanel({
  storage, status, onStatus, notify, confirm, lock,
}: {
  storage: StorageProvider;
  status: VaultStatus | null;
  onStatus: () => Promise<void>;
  notify: (message: string) => void;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>;
  lock: () => void;
}) {
  const [dialog, setDialog] = useState<'enable' | 'change' | 'reveal' | 'disable' | null>(null);
  const [first, setFirst] = useState(''), [second, setSecond] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [issued, setIssued] = useState<string | null>(null), [kept, setKept] = useState(false);

  const encrypted = status?.encrypted ?? false;
  function close() { setDialog(null); setFirst(''); setSecond(''); setError(''); setIssued(null); setKept(false); setUseRecovery(false); }
  const secret = (): VaultSecret => useRecovery ? { recoveryKey: first } : { password: first };

  async function attempt(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (problem) { setError(problem instanceof WrongPasswordError ? t.vault.wrongSecret : problem instanceof Error ? problem.message : t.vault.failed); }
    finally { setBusy(false); }
  }

  const enable = () => void attempt(async () => {
    if (first.length < MIN_LENGTH) { setError(t.vault.tooShort(MIN_LENGTH)); return; }
    if (first !== second) { setError(t.vault.mismatch); return; }
    const { recoveryKey } = await storage.enableEncryption(first);
    setIssued(recoveryKey);
    setFirst(''); setSecond('');
    await onStatus();
  });
  const change = () => void attempt(async () => {
    if (second.length < MIN_LENGTH) { setError(t.vault.tooShort(MIN_LENGTH)); return; }
    await storage.changePassword(secret(), second);
    close();
    notify(t.vault.passwordChanged);
  });
  const reveal = () => void attempt(async () => {
    setIssued(await storage.revealRecoveryKey(first));
    setFirst('');
  });
  const disable = () => void attempt(async () => {
    await storage.disableEncryption(secret());
    close();
    await onStatus();
    notify(t.vault.disabled);
  });

  /** The key is written to a file the user keeps, not to the vault it opens. */
  const saveKey = (key: string) => download(`ai-code-vault-aterstallningsnyckel-${new Date().toISOString().slice(0, 10)}.txt`,
    `${t.vault.keyFileHeading}\n\n${formatRecoveryKey(key)}\n\n${t.vault.keyFileBody}\n`, 'text/plain');

  async function askDisable() {
    const ok = await confirm({ title: t.vault.disableTitle, danger: true, confirmLabel: t.vault.disableConfirm,
      body: <><p>{t.vault.disableLead}</p><p>{t.vault.disableWhere}</p></> });
    if (ok) setDialog('disable');
  }

  return <section className="encryption-panel">
    <h3>{t.vault.heading}</h3>
    <p>{encrypted ? t.vault.stateEncrypted : t.vault.statePlaintext}</p>
    {encrypted ? <>
      <div className="panel-actions">
        <button onClick={() => setDialog('change')}>{t.vault.changePassword}</button>
        <button onClick={() => setDialog('reveal')}>{t.vault.showRecovery}</button>
        <button onClick={lock}>{t.vault.lockNow}</button>
        <button className="danger-text text-button" onClick={() => void askDisable()}>{t.vault.disable}</button>
      </div>
      <label>{t.vault.autoLock}
        <select aria-label={t.vault.autoLock} value={status?.autoLockMinutes ?? 0}
          onChange={e => void storage.getSettings().then(s => storage.saveSettings({ ...s, autoLockMinutes: Number(e.target.value) })).then(onStatus)}>
          <option value={0}>{t.vault.autoLockNever}</option>
          <option value={5}>{t.vault.autoLockMinutes(5)}</option>
          <option value={15}>{t.vault.autoLockMinutes(15)}</option>
          <option value={30}>{t.vault.autoLockMinutes(30)}</option>
          <option value={60}>{t.vault.autoLockMinutes(60)}</option>
        </select>
        <small>{t.vault.autoLockHint}</small>
      </label>
    </> : <button className="primary" onClick={() => setDialog('enable')}>{t.vault.enable}</button>}
    <p className="notice">{t.vault.protectsNote}</p>

    {dialog === 'enable' && <Modal title={issued ? t.vault.recoveryTitle : t.vault.enableTitle} close={issued && !kept ? () => {} : close}>
      {issued ? <>
        <p>{t.vault.recoveryLeadNew}</p>
        <p className="recovery-key"><code>{formatRecoveryKey(issued)}</code></p>
        <div className="panel-actions"><button onClick={() => saveKey(issued)}>{t.vault.downloadKey}</button></div>
        <label className="check"><input type="checkbox" checked={kept} onChange={e => setKept(e.target.checked)} />{t.vault.keptIt}</label>
        <div className="dialog-actions"><button className="primary" disabled={!kept} onClick={() => { close(); notify(t.vault.enabled); }}>{t.dialog.close}</button></div>
      </> : <>
        <p>{t.vault.enableLead}</p>
        <p className="inline-warning">{t.vault.enableWarning}</p>
        <SecretInput label={t.vault.newPassword} value={first} onChange={setFirst} autoFocus hint={t.vault.passwordHint(MIN_LENGTH)} />
        <SecretInput label={t.vault.repeatPassword} value={second} onChange={setSecond} />
        {error && <p className="danger-text" role="alert">{error}</p>}
        <div className="dialog-actions"><button onClick={close}>{t.dialog.cancel}</button>
          <button className="primary" disabled={busy || !first || !second} onClick={enable}>{busy ? t.vault.encrypting : t.vault.enableConfirm}</button></div>
      </>}
    </Modal>}

    {dialog === 'change' && <Modal title={t.vault.changeTitle} close={close}>
      <SecretInput label={useRecovery ? t.vault.recoveryKey : t.vault.currentPassword} value={first} onChange={setFirst} autoFocus />
      <button type="button" className="text-button" onClick={() => { setUseRecovery(!useRecovery); setFirst(''); }}>{useRecovery ? t.vault.usePassword : t.vault.useRecovery}</button>
      <SecretInput label={t.vault.newPassword} value={second} onChange={setSecond} hint={t.vault.passwordHint(MIN_LENGTH)} />
      {error && <p className="danger-text" role="alert">{error}</p>}
      <div className="dialog-actions"><button onClick={close}>{t.dialog.cancel}</button>
        <button className="primary" disabled={busy || !first || !second} onClick={change}>{t.vault.changeConfirm}</button></div>
    </Modal>}

    {dialog === 'reveal' && <Modal title={t.vault.showRecovery} close={close}>
      {issued ? <>
        <p>{t.vault.recoveryLeadAgain}</p>
        <p className="recovery-key"><code>{formatRecoveryKey(issued)}</code></p>
        <div className="dialog-actions"><button onClick={() => saveKey(issued)}>{t.vault.downloadKey}</button>
          <button className="primary" onClick={close}>{t.dialog.close}</button></div>
      </> : <>
        <p>{t.vault.revealLead}</p>
        <SecretInput label={t.vault.password} value={first} onChange={setFirst} autoFocus />
        {error && <p className="danger-text" role="alert">{error}</p>}
        <div className="dialog-actions"><button onClick={close}>{t.dialog.cancel}</button>
          <button className="primary" disabled={busy || !first} onClick={reveal}>{t.vault.showRecovery}</button></div>
      </>}
    </Modal>}

    {dialog === 'disable' && <Modal title={t.vault.disableTitle} close={close}>
      <p>{t.vault.disableLead}</p>
      <SecretInput label={useRecovery ? t.vault.recoveryKey : t.vault.password} value={first} onChange={setFirst} autoFocus />
      <button type="button" className="text-button" onClick={() => { setUseRecovery(!useRecovery); setFirst(''); }}>{useRecovery ? t.vault.usePassword : t.vault.useRecovery}</button>
      {error && <p className="danger-text" role="alert">{error}</p>}
      <div className="dialog-actions"><button onClick={close}>{t.dialog.cancel}</button>
        <button className="danger" disabled={busy || !first} onClick={disable}>{t.vault.disableConfirm}</button></div>
    </Modal>}
  </section>;
}
