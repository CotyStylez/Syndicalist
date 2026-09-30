import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getItem, setItem, removeItem, getAllKeys, clearAll } from '../src/lib/storage.js';

test('setItem/getItem roundtrips a value', async () => {
  await setItem('profile', { displayName: 'Ada' });
  const value = await getItem('profile');
  assert.deepEqual(value, { displayName: 'Ada' });
});

test('getItem returns undefined for missing keys', async () => {
  const value = await getItem('does-not-exist');
  assert.equal(value, undefined);
});

test('removeItem deletes a stored value', async () => {
  await setItem('temp', 'value');
  await removeItem('temp');
  const value = await getItem('temp');
  assert.equal(value, undefined);
});

test('getAllKeys lists every stored key', async () => {
  await clearAll();
  await setItem('a', 1);
  await setItem('b', 2);
  const keys = (await getAllKeys()).sort();
  assert.deepEqual(keys, ['a', 'b']);
});

test('clearAll wipes every stored value', async () => {
  await setItem('a', 1);
  await clearAll();
  assert.deepEqual(await getAllKeys(), []);
});
