import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, importIdentity } from './identity.js';

test('generated identity can be imported from either private key encoding', () => {
  const original = createIdentity();

  assert.match(original.npub, /^npub1/);
  assert.match(original.nsec, /^nsec1/);
  assert.equal(importIdentity(original.nsec).publicKey, original.publicKey);
  assert.equal(
    importIdentity(Buffer.from(original.secretKey).toString('hex')).publicKey,
    original.publicKey,
  );
});

test('rejects a public key supplied as a private key', () => {
  const identity = createIdentity();

  assert.throws(() => importIdentity(identity.npub), /nsec or 64-character hex/);
});
