import { describe, expect, it } from 'vitest';
import { changePassword, createVault, decryptRecord, encryptRecord, formatRecoveryKey, isEncryptedSnapshot, looksLikeRecoveryKey, normalizeRecoveryKey, openSnapshot, revealRecoveryKey, sealSnapshot, unlockVault, WrongPasswordError } from './crypto';

// PBKDF2 at the production count is what makes a guess expensive; it is not what these tests are
// about, so they run the derivation at a count that keeps the suite fast.
const fast = { iterations: 1000 };

describe('vault crypto', () => {
  it('opens with the password and with the recovery key, and with nothing else', async () => {
    const { header, dek, recoveryKey } = await createVault('correct horse', fast);
    const sealed = await encryptRecord(dek, '{"values":{"":"Hunter2"}}', 'bindings:b1');
    expect(sealed).not.toContain('Hunter2');
    expect(await decryptRecord(await unlockVault(header, { password: 'correct horse' }), sealed, 'bindings:b1')).toContain('Hunter2');
    expect(await decryptRecord(await unlockVault(header, { recoveryKey: formatRecoveryKey(recoveryKey) }), sealed, 'bindings:b1')).toContain('Hunter2');
    await expect(unlockVault(header, { password: 'correct hors' })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(unlockVault(header, { recoveryKey: recoveryKey.replace(/./, c => c === 'a' ? 'b' : 'a') })).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('binds a row to its table and id', async () => {
    const { dek } = await createVault('pw', fast);
    const sealed = await encryptRecord(dek, 'row', 'bindings:b1');
    await expect(decryptRecord(dek, sealed, 'bindings:b2')).rejects.toThrow();
    await expect(decryptRecord(dek, sealed, 'projects:b1')).rejects.toThrow();
  });

  it('changes the password without touching the data or the recovery key', async () => {
    const { header, dek, recoveryKey } = await createVault('old', fast);
    const sealed = await encryptRecord(dek, 'row', 'projects:p');
    const changed = await changePassword(header, { password: 'old' }, 'new');
    await expect(unlockVault(changed, { password: 'old' })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await decryptRecord(await unlockVault(changed, { password: 'new' }), sealed, 'projects:p')).toBe('row');
    expect(await decryptRecord(await unlockVault(changed, { recoveryKey }), sealed, 'projects:p')).toBe('row');
    // A forgotten password is replaced through the recovery key.
    const rescued = await changePassword(changed, { recoveryKey }, 'third');
    expect(await decryptRecord(await unlockVault(rescued, { password: 'third' }), sealed, 'projects:p')).toBe('row');
    await expect(changePassword(changed, { password: 'wrong' }, 'x')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('shows the recovery key again to whoever holds the key', async () => {
    const { header, dek, recoveryKey } = await createVault('pw', fast);
    expect(await revealRecoveryKey(header, dek)).toBe(recoveryKey);
    expect(formatRecoveryKey(recoveryKey)).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    expect(normalizeRecoveryKey(formatRecoveryKey(recoveryKey))).toBe(recoveryKey);
    expect(looksLikeRecoveryKey(formatRecoveryKey(recoveryKey))).toBe(true);
    expect(looksLikeRecoveryKey('hunter2')).toBe(false);
  });

  it('seals a snapshot that opens elsewhere with the password or the recovery key', async () => {
    const { header, dek, recoveryKey } = await createVault('pw', fast);
    const json = JSON.stringify({ bindings: [{ values: { '': 'Hunter2' } }] });
    const file = await sealSnapshot(header, dek, json);
    expect(isEncryptedSnapshot(file)).toBe(true);
    expect(JSON.stringify(file)).not.toContain('Hunter2');
    expect(file).not.toHaveProperty('recoveryKeyEnc');
    expect(await openSnapshot(file, { password: 'pw' })).toBe(json);
    expect(await openSnapshot(file, { recoveryKey })).toBe(json);
    await expect(openSnapshot(file, { password: 'nope' })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(openSnapshot({ ...file, version: 2 as 1 }, { password: 'pw' })).rejects.toThrow(/nyare version/);
    expect(isEncryptedSnapshot(JSON.parse(json))).toBe(false);
  });
});
