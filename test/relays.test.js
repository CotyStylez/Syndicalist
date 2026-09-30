import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npubFor, pubkeyFromInput } from '../src/lib/relays.js';
import { generateIdentity } from '../src/lib/identity.js';

test('pubkeyFromInput accepts hex pubkeys and lowercases them', () => {
  const { publicKeyHex } = generateIdentity();
  assert.equal(pubkeyFromInput(publicKeyHex.toUpperCase()), publicKeyHex.toLowerCase());
});

test('pubkeyFromInput accepts npub1 strings and decodes to hex', () => {
  const { publicKeyHex, npub } = generateIdentity();
  assert.equal(pubkeyFromInput(npub), publicKeyHex);
});

test('pubkeyFromInput trims surrounding whitespace', () => {
  const { publicKeyHex, npub } = generateIdentity();
  assert.equal(pubkeyFromInput(`  ${npub}  `), publicKeyHex);
});

test('pubkeyFromInput rejects empty and invalid input', () => {
  assert.throws(() => pubkeyFromInput(''));
  assert.throws(() => pubkeyFromInput('   '));
  assert.throws(() => pubkeyFromInput('not-a-key'));
  assert.throws(() => pubkeyFromInput('npub1invalid'));
});

test('npubFor/pubkeyFromInput roundtrip', () => {
  const { publicKeyHex } = generateIdentity();
  assert.equal(pubkeyFromInput(npubFor(publicKeyHex)), publicKeyHex);
});
