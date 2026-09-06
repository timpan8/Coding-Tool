/** Vault cryptography. WebCrypto only, nothing third-party, nothing leaves the machine.
 *
 *   master password  --PBKDF2-SHA256-->  KEK  --wraps-->  DEK
 *   recovery key     --PBKDF2-SHA256-->  recovery KEK  --wraps-->  the same DEK
 *   DEK: 32 random bytes, imported as a non-extractable AES-GCM key.
 *   Rows: AES-256-GCM, fresh 96-bit IV, AAD = `table:id`, so a row cannot be moved to another key.
 *
 * The recovery key is also kept encrypted under the DEK, so it can be shown again to someone who
 * knows the password. Anyone holding the DEK holds everything already, so that costs nothing.
 *
 * Ported from CodeVault's vault/crypto.ts, minus the fields the root app does not need. */

export const PBKDF2_ITERATIONS = 600_000;
export const VAULT_FORMAT_VERSION = 1;

export interface KdfParams { salt: string; iterations: number; hash: 'SHA-256' }
export interface VaultHeader {
  key: 'header';
  formatVersion: number;
  kdf: KdfParams;
  recoveryKdf: KdfParams;
  wrappedDEK: string;
  wrappedDEKRecovery: string;
  /** The recovery key, encrypted under the DEK, so "show my recovery key" is possible. */
  recoveryKeyEnc: string;
  createdAt: string;
  updatedAt: string;
}
/** Either thing that opens the vault. */
export type VaultSecret = { password: string } | { recoveryKey: string };

export class WrongPasswordError extends Error {
  constructor() { super('Fel lösenord eller återställningsnyckel.'); this.name = 'WrongPasswordError'; }
}
/** Thrown by every read or write of encrypted content while no key is held. */
export class VaultLockedError extends Error {
  constructor() { super('Valvet är låst.'); this.name = 'VaultLockedError'; }
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();

function randomBytes(n: number): Uint8Array { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }
function toBase64(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function fromBase64(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** 32 hex characters. Shown once when the vault is encrypted, grouped in fours for reading. */
export const generateRecoveryKey = () => toHex(randomBytes(16));
export const formatRecoveryKey = (hex: string) => hex.replace(/(.{4})/g, '$1-').replace(/-$/, '').toUpperCase();
/** Whatever the user pasted: groups, case and stray characters are forgiven. */
export const normalizeRecoveryKey = (input: string) => input.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
export const looksLikeRecoveryKey = (input: string) => normalizeRecoveryKey(input).length === 32;

const freshKdf = (iterations: number): KdfParams => ({ salt: toBase64(randomBytes(16)), iterations, hash: 'SHA-256' });

async function deriveKek(secret: string, kdf: KdfParams): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt: fromBase64(kdf.salt) as BufferSource, iterations: kdf.iterations, hash: kdf.hash }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, plaintext as BufferSource));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv, 0); out.set(ct, iv.length);
  return toBase64(out);
}
async function aesGcmDecrypt(key: CryptoKey, payload: string, aad: string): Promise<Uint8Array> {
  const bytes = fromBase64(payload);
  if (bytes.length < 13) throw new Error('Skadat krypterat innehåll.');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) as BufferSource, additionalData: enc.encode(aad) as BufferSource }, key, bytes.subarray(12) as BufferSource));
}
const importDek = (raw: Uint8Array) => subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

async function unwrapRaw(secret: string, kdf: KdfParams, wrapped: string, aad: string): Promise<Uint8Array> {
  const kek = await deriveKek(secret, kdf);
  try { return await aesGcmDecrypt(kek, wrapped, aad); }
  catch { throw new WrongPasswordError(); }
}
type Wrapping = Pick<VaultHeader, 'kdf' | 'recoveryKdf' | 'wrappedDEK' | 'wrappedDEKRecovery'>;
function unwrapWith(wrapping: Wrapping, secret: VaultSecret): Promise<Uint8Array> {
  return 'password' in secret
    ? unwrapRaw(secret.password, wrapping.kdf, wrapping.wrappedDEK, 'dek')
    : unwrapRaw(normalizeRecoveryKey(secret.recoveryKey), wrapping.recoveryKdf, wrapping.wrappedDEKRecovery, 'dek-recovery');
}

export interface CreatedVault { header: VaultHeader; dek: CryptoKey; recoveryKey: string }
/** `iterations` exists for tests, which would otherwise spend most of their time in PBKDF2. */
export async function createVault(password: string, options: { iterations?: number; now?: string } = {}): Promise<CreatedVault> {
  const now = options.now ?? new Date().toISOString(), iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const kdf = freshKdf(iterations), recoveryKdf = freshKdf(iterations);
  const recoveryKey = generateRecoveryKey();
  const rawDek = randomBytes(32);
  const [kek, rkek] = await Promise.all([deriveKek(password, kdf), deriveKek(recoveryKey, recoveryKdf)]);
  const dek = await importDek(rawDek);
  const header: VaultHeader = {
    key: 'header', formatVersion: VAULT_FORMAT_VERSION, kdf, recoveryKdf,
    wrappedDEK: await aesGcmEncrypt(kek, rawDek, 'dek'),
    wrappedDEKRecovery: await aesGcmEncrypt(rkek, rawDek, 'dek-recovery'),
    recoveryKeyEnc: await aesGcmEncrypt(dek, enc.encode(recoveryKey), 'recovery-key'),
    createdAt: now, updatedAt: now,
  };
  rawDek.fill(0);
  return { header, dek, recoveryKey };
}

export async function unlockVault(header: VaultHeader, secret: VaultSecret): Promise<CryptoKey> {
  const raw = await unwrapWith(header, secret);
  const dek = await importDek(raw);
  raw.fill(0);
  return dek;
}

/** Re-wraps the DEK under a new password; the recovery key keeps working. Needs the current
 * password or the recovery key, which is how "I forgot it" is handled at all. */
export async function changePassword(header: VaultHeader, current: VaultSecret, next: string, now = new Date().toISOString()): Promise<VaultHeader> {
  const raw = await unwrapWith(header, current);
  const kdf = freshKdf(header.kdf.iterations);
  const wrappedDEK = await aesGcmEncrypt(await deriveKek(next, kdf), raw, 'dek');
  raw.fill(0);
  return { ...header, kdf, wrappedDEK, updatedAt: now };
}

export const revealRecoveryKey = async (header: VaultHeader, dek: CryptoKey) => dec.decode(await aesGcmDecrypt(dek, header.recoveryKeyEnc, 'recovery-key'));

export const encryptRecord = (dek: CryptoKey, plaintext: string, aad: string) => aesGcmEncrypt(dek, enc.encode(plaintext), aad);
export const decryptRecord = async (dek: CryptoKey, payload: string, aad: string) => dec.decode(await aesGcmDecrypt(dek, payload, aad));

/** An export from an encrypted vault. The file carries the vault's own key wrapping, so it opens
 * with the password or the recovery key the vault had when it was written — on any machine, with
 * nothing else — and the JSON inside is exactly the plaintext snapshot the schema already knows. */
export interface EncryptedSnapshotFile extends Wrapping {
  format: 'ai-code-vault.snapshot.enc';
  version: 1;
  ciphertext: string;
}
export const isEncryptedSnapshot = (raw: unknown): raw is EncryptedSnapshotFile =>
  typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === 'ai-code-vault.snapshot.enc';

export async function sealSnapshot(header: VaultHeader, dek: CryptoKey, json: string): Promise<EncryptedSnapshotFile> {
  const { kdf, recoveryKdf, wrappedDEK, wrappedDEKRecovery } = header;
  return { format: 'ai-code-vault.snapshot.enc', version: 1, kdf, recoveryKdf, wrappedDEK, wrappedDEKRecovery, ciphertext: await encryptRecord(dek, json, 'snapshot') };
}
export async function openSnapshot(file: EncryptedSnapshotFile, secret: VaultSecret): Promise<string> {
  if (file.version !== 1) throw new Error(`Filen är krypterad av en nyare version (format ${file.version}). Uppdatera appen först.`);
  const raw = await unwrapWith(file, secret);
  const dek = await importDek(raw);
  raw.fill(0);
  try { return await decryptRecord(dek, file.ciphertext, 'snapshot'); }
  catch { throw new Error('Filens innehåll gick inte att dekryptera. Den kan vara skadad.'); }
}
