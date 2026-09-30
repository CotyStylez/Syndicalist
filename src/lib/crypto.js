// Encryption helpers built on the Web Crypto API.
//
// These utilities protect data that is stored locally in the browser
// (see src/lib/storage.js). Nothing here ever leaves the device — the
// passphrase, derived keys, and plaintext are only ever handled in memory.

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API is not available in this environment.');
  }
  return c.subtle;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derives an AES-GCM key from a user passphrase and salt using PBKDF2.
 * The passphrase is never stored — only the derived key lives in memory
 * for the duration of an unlocked session.
 */
export async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await subtle().importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a plaintext string (or JSON-serializable value) with a passphrase.
 * Returns a self-contained envelope (salt + iv + ciphertext, all base64)
 * that can be safely written to IndexedDB or exported.
 */
export async function encryptWithPassphrase(value, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    v: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an envelope produced by encryptWithPassphrase. Throws if the
 * passphrase is wrong or the data has been tampered with (AES-GCM auth tag
 * mismatch), which is the expected way to detect a bad unlock passphrase.
 */
export async function decryptWithPassphrase(envelope, passphrase) {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveKey(passphrase, salt);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function randomHex(byteLength) {
  const bytes = randomBytes(byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
