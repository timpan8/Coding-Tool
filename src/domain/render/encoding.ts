/** The other shapes a private value can take on its way into an AI copy.
 *
 * The exact-value check is the gate (invariant 4), and it stays exact: everything here produces a
 * *known* string derived from a known value, so a hit is still "this exact value is in the output",
 * never a guess. What it adds is that a value does not stop being itself because it was
 * base64-encoded, URL-escaped or run through a here-string.
 *
 * Ported from CodeVault's engine/encoding.ts. */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_MAP = new Map<string, number>();
B64_CHARS.split('').forEach((c, i) => B64_MAP.set(c, i));
B64_MAP.set('-', 62);
B64_MAP.set('_', 63);

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64_CHARS[(triple >> 18) & 63] + B64_CHARS[(triple >> 12) & 63];
    out += b === undefined ? '=' : B64_CHARS[(triple >> 6) & 63];
    out += c === undefined ? '=' : B64_CHARS[triple & 63];
  }
  return out;
}
export const base64Utf8 = (value: string) => bytesToBase64(new TextEncoder().encode(value));
/** PowerShell's own `-EncodedCommand` is UTF-16LE, which is why it gets its own variant. */
export function base64Utf16le(value: string): string {
  const bytes = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); bytes[i * 2] = code & 0xff; bytes[i * 2 + 1] = code >> 8; }
  return bytesToBase64(bytes);
}

/** How a value was found, for a message that can say it without printing the value. */
export type Encoding = 'exact' | 'url' | 'html' | 'json' | 'backtick' | 'doubled-quote' | 'regex' | 'base64' | 'base64-utf16' | 'inside-base64';

export interface Variant { text: string; encoding: Encoding }

/** Every alternative textual form of one value. Empty and identity forms are dropped, so a value
 * with nothing to escape produces no duplicates of itself. */
export function encodedVariants(value: string): Variant[] {
  const seen = new Map<string, Encoding>();
  const add = (text: string, encoding: Encoding) => { if (text && text !== value && !seen.has(text)) seen.set(text, encoding); };
  try { add(encodeURIComponent(value), 'url'); } catch { /* lone surrogate: no URL form */ }
  add(value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!), 'html');
  add(JSON.stringify(value).slice(1, -1), 'json');
  add(value.replace(/[`"$]/g, c => '`' + c), 'backtick');
  add(value.replace(/'/g, "''"), 'doubled-quote');
  add(value.replace(/[\\*+?|{[()^$.#\s]/g, c => '\\' + c), 'regex');
  add(base64Utf8(value), 'base64');
  add(base64Utf16le(value), 'base64-utf16');
  return [...seen].map(([text, encoding]) => ({ text, encoding }));
}

/** Runs long enough to be an encoded payload rather than an identifier that happens to look like
 * one. 32 characters is 24 bytes: shorter than any secret worth hiding this way. */
const B64_RUN = /[A-Za-z0-9+/]{32,}={0,2}|[A-Za-z0-9_-]{32,}/g;
export interface Base64Run { start: number; end: number; run: string }
export function base64Runs(text: string): Base64Run[] {
  return [...text.matchAll(B64_RUN)].map(m => ({ start: m.index, end: m.index + m[0].length, run: m[0] }));
}

function decodeBytes(run: string): Uint8Array {
  const bytes: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of run) {
    if (ch === '=') break;
    const value = B64_MAP.get(ch);
    if (value === undefined) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return Uint8Array.from(bytes);
}

const printable = (s: string) => {
  if (s.length < 4) return false;
  let count = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code < 0x7f) || code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0xa0 && code < 0xfffd)) count++;
  }
  return count / s.length >= 0.85;
};

const utf8 = new TextDecoder('utf-8', { fatal: false });
const utf16le = new TextDecoder('utf-16le', { fatal: false });

/** A base64 run decoded at every character alignment — a value can sit mid-stream — as UTF-8 and
 * UTF-16LE. Only the mostly printable decodings come back; the rest is noise that would match
 * nothing anyway. */
export function decodeBase64Variants(run: string): string[] {
  const out = new Set<string>();
  for (let offset = 0; offset < 4; offset++) {
    const slice = run.slice(offset);
    if (slice.length < 8) continue;
    const bytes = decodeBytes(slice);
    if (!bytes.length) continue;
    for (const decoded of [utf8.decode(bytes), utf16le.decode(bytes), utf16le.decode(bytes.subarray(1))]) {
      const cleaned = decoded.replace(/�/g, '');
      if (printable(cleaned)) out.add(cleaned);
    }
  }
  return [...out];
}
