import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

export function createIdentity() {
  return identityFromSecret(generateSecretKey());
}

export function importIdentity(value) {
  const input = value.trim();
  let secretKey;

  if (/^[0-9a-f]{64}$/i.test(input)) {
    secretKey = Uint8Array.from(input.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
  } else {
    const decoded = nip19.decode(input);
    if (decoded.type !== 'nsec') {
      throw new Error('Enter a valid nsec or 64-character hex private key.');
    }
    secretKey = decoded.data;
  }

  return identityFromSecret(secretKey);
}

function identityFromSecret(secretKey) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new Error('The private key must be exactly 32 bytes.');
  }

  const publicKey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    npub: nip19.npubEncode(publicKey),
    nsec: nip19.nsecEncode(secretKey),
  };
}
