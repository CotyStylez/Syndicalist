import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentity, importIdentity, shortenKey } from '../src/lib/identity.js';

test('generateIdentity returns a valid keypair with matching encodings', () => {
  const identity = generateIdentity();
  assert.match(identity.secretKeyHex, /^[0-9a-f]{64}$/);
  assert.match(identity.publicKeyHex, /^[0-9a-f]{64}$/);
  assert.match(identity.nsec, /^nsec1/);
  assert.match(identity.npub, /^npub1/);
});

test('importIdentity accepts hex private keys and matches generateIdentity output', () => {
  const generated = generateIdentity();
  const imported = importIdentity(generated.secretKeyHex);
  assert.equal(imported.publicKeyHex, generated.publicKeyHex);
  assert.equal(imported.npub, generated.npub);
});

test('importIdentity accepts nsec1 private keys', () => {
  const generated = generateIdentity();
  const imported = importIdentity(generated.nsec);
  assert.equal(imported.publicKeyHex, generated.publicKeyHex);
});

test('importIdentity rejects garbage input', () => {
  assert.throws(() => importIdentity('not-a-key'));
  assert.throws(() => importIdentity(''));
});

test('shortenKey shortens long strings and leaves short ones alone', () => {
  const long = 'npub1abcdefghijklmnopqrstuvwxyz0123456789';
  const shortened = shortenKey(long);
  assert.ok(shortened.length < long.length);
  assert.ok(shortened.includes('…'));
  assert.equal(shortenKey('short'), 'short');
});
