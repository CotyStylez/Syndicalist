import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealAndStore, unseal, hasSealed, forget } from '../src/lib/vault.js';

test('sealAndStore/unseal roundtrips a value through encrypted storage', async () => {
  await sealAndStore('vault-test', { nsec: 'nsec1exampleexample' }, 'my-passphrase');
  assert.equal(await hasSealed('vault-test'), true);

  const value = await unseal('vault-test', 'my-passphrase');
  assert.deepEqual(value, { nsec: 'nsec1exampleexample' });
});

test('unseal rejects the wrong passphrase', async () => {
  await sealAndStore('vault-test-2', { secret: 42 }, 'right-pass');
  await assert.rejects(() => unseal('vault-test-2', 'wrong-pass'));
});

test('unseal returns undefined when nothing is stored', async () => {
  const value = await unseal('never-stored', 'whatever');
  assert.equal(value, undefined);
});

test('forget removes the sealed envelope', async () => {
  await sealAndStore('vault-test-3', { a: 1 }, 'pass');
  await forget('vault-test-3');
  assert.equal(await hasSealed('vault-test-3'), false);
});
