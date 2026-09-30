// Nostr identity management: generating and importing keypairs client-side.
//
// The private key (nsec) never leaves the browser and is never sent to any
// server. It is only kept in memory and, if the user unlocks encrypted
// storage, persisted locally as an encrypted envelope (see vault.js).

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

export function generateIdentity() {
  const secretKey = generateSecretKey(); // Uint8Array
  return keypairFromSecretKey(secretKey);
}

/**
 * Accepts a private key in either bech32 "nsec1..." form or raw 64-char hex,
 * validates it, and returns the same shape as generateIdentity().
 */
export function importIdentity(privateKeyInput) {
  const trimmed = (privateKeyInput || '').trim();
  if (!trimmed) {
    throw new Error('Private key is required.');
  }

  let secretKey;
  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error('That does not look like an nsec private key.');
    }
    secretKey = decoded.data;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    secretKey = hexToBytes(trimmed);
  } else {
    throw new Error('Enter a valid nsec1... key or a 64-character hex private key.');
  }

  return keypairFromSecretKey(secretKey);
}

function keypairFromSecretKey(secretKey) {
  const publicKey = getPublicKey(secretKey);
  return {
    secretKeyHex: bytesToHex(secretKey),
    publicKeyHex: publicKey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(publicKey),
  };
}

export function secretKeyFromHex(hex) {
  return hexToBytes(hex);
}

export function shortenKey(key, prefix = 8, suffix = 6) {
  if (!key || key.length <= prefix + suffix + 1) return key;
  return `${key.slice(0, prefix)}…${key.slice(-suffix)}`;
}
