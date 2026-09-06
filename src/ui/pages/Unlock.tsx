import { useState } from 'react';
import { looksLikeRecoveryKey, WrongPasswordError, type VaultSecret } from '../../storage/crypto';
import { SecretInput } from '../components/SecretInput';
import { t } from '../text';

/** The whole app when the vault is encrypted and no key is held.
 *
 * Nothing has been read at this point: not the projects, not the bindings, not the settings that
 * are behind the key. The theme is, which is why this page can be painted in the right colours.
 * Failure says only that the secret was wrong — never how close it was, never which field. */
export function Unlock({ unlock }: { unlock: (secret: VaultSecret) => Promise<void> }) {
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true); setError('');
    try { await unlock(mode === 'password' ? { password: secret } : { recoveryKey: secret }); }
    catch (problem) { setError(problem instanceof WrongPasswordError ? t.vault.wrongSecret : t.vault.unlockFailed); }
    finally { setBusy(false); }
  }

  return <div className="unlock-page">
    <form className="unlock-card" onSubmit={e => void submit(e)}>
      <span className="eyebrow">{t.vault.lockedEyebrow}</span>
      <h1>{t.vault.lockedTitle}</h1>
      <p>{mode === 'password' ? t.vault.lockedLead : t.vault.recoveryLead}</p>
      <SecretInput label={mode === 'password' ? t.vault.password : t.vault.recoveryKey} value={secret} onChange={setSecret} autoFocus />
      {mode === 'recovery' && secret && !looksLikeRecoveryKey(secret) && <p className="notice">{t.vault.recoveryShape}</p>}
      {error && <p className="danger-text" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="text-button" onClick={() => { setMode(mode === 'password' ? 'recovery' : 'password'); setSecret(''); setError(''); }}>
          {mode === 'password' ? t.vault.useRecovery : t.vault.usePassword}
        </button>
        <button type="submit" className="primary" disabled={busy || !secret}>{busy ? t.vault.unlocking : t.vault.unlock}</button>
      </div>
      <p className="muted">{t.vault.lockedFootnote}</p>
    </form>
  </div>;
}
