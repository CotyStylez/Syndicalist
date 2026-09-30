import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptWithPassphrase, decryptWithPassphrase, bytesToBase64, base64ToBytes } from '../src/lib/crypto.js';

test('encryptWithPassphrase/decryptWithPassphrase roundtrips a value', async () => {
  const original = { hello: 'world', n: 42, list: [1, 2, 3] };
  const envelope = await encryptWithPassphrase(original, 'correct horse battery staple');
  assert.equal(envelope.v, 1);
  assert.ok(envelope.salt);
  assert.ok(envelope.iv);
  assert.ok(envelope.ciphertext);

  const decrypted = await decryptWithPassphrase(envelope, 'correct horse battery staple');
  assert.deepEqual(decrypted, original);
});

test('decryptWithPassphrase throws on wrong passphrase', async () => {
  const envelope = await encryptWithPassphrase({ secret: 'value' }, 'right-passphrase');
  await assert.rejects(() => decryptWithPassphrase(envelope, 'wrong-passphrase'));
});

test('encryptWithPassphrase produces different ciphertext each time (random salt/iv)', async () => {
  const a = await encryptWithPassphrase('same value', 'passphrase');
  const b = await encryptWithPassphrase('same value', 'passphrase');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('bytesToBase64/base64ToBytes roundtrip', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
  const encoded = bytesToBase64(bytes);
  const decoded = base64ToBytes(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});
