// The "vault" is the encrypted-at-rest layer for sensitive local state:
// the user's Nostr private key and any private notes / DM placeholders.
//
// Unlocking requires the user's passphrase. The passphrase itself is never
// persisted anywhere — only the resulting AES-GCM envelope is written to
// IndexedDB. Losing the passphrase means losing access to anything stored
// in the vault, which is why the UI must clearly warn users to back up
// their nsec separately (e.g. written down offline).

import { encryptWithPassphrase, decryptWithPassphrase } from './crypto.js';
import { getItem, setItem, removeItem } from './storage.js';

/** Encrypts `value` with `passphrase` and stores it under `storageKey`. */
export async function sealAndStore(storageKey, value, passphrase) {
  const envelope = await encryptWithPassphrase(value, passphrase);
  await setItem(storageKey, envelope);
  return envelope;
}

/**
 * Loads and decrypts the value stored under `storageKey`.
 * Returns `undefined` if nothing is stored. Throws if the passphrase is wrong.
 */
export async function unseal(storageKey, passphrase) {
  const envelope = await getItem(storageKey);
  if (!envelope) return undefined;
  return decryptWithPassphrase(envelope, passphrase);
}

/** True if an encrypted envelope currently exists under `storageKey`. */
export async function hasSealed(storageKey) {
  const envelope = await getItem(storageKey);
  return Boolean(envelope);
}

/** Permanently deletes the encrypted envelope at `storageKey`. */
export async function forget(storageKey) {
  await removeItem(storageKey);
}
