import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll } from '../src/lib/storage.js';
import {
  loadPacks,
  savePacks,
  createPack,
  addStickerToPack,
  removeStickerFromPack,
  findSticker,
  defaultPack,
} from '../src/lib/stickers.js';

test('loadPacks seeds the built-in starter pack on first run', async () => {
  await clearAll();
  const packs = await loadPacks();
  assert.equal(packs.length, 1);
  assert.equal(packs[0].id, defaultPack().id);
  assert.ok(packs[0].stickers.length > 0);
});

test('loadPacks returns previously saved packs without reseeding', async () => {
  await clearAll();
  const custom = [createPack('Mine')];
  await savePacks(custom);
  const loaded = await loadPacks();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Mine');
});

test('addStickerToPack appends a sticker with a non-negative sats price', () => {
  const packs = [createPack('Mine')];
  const updated = addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '🔥', label: 'Fire', sats: 100 });
  assert.equal(updated[0].stickers.length, 1);
  assert.equal(updated[0].stickers[0].sats, 100);
  assert.equal(updated[0].stickers[0].kind, 'emoji');
});

test('addStickerToPack rejects unknown sticker kinds', () => {
  const packs = [createPack('Mine')];
  assert.throws(() => addStickerToPack(packs, packs[0].id, { kind: 'video', data: 'x' }), /Unknown sticker kind/);
});

test('addStickerToPack rejects missing artwork/content', () => {
  const packs = [createPack('Mine')];
  assert.throws(() => addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '' }), /artwork/);
});

test('addStickerToPack clamps negative sats to zero', () => {
  const packs = [createPack('Mine')];
  const updated = addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '👍', sats: -50 });
  assert.equal(updated[0].stickers[0].sats, 0);
});

test('removeStickerFromPack removes only the targeted sticker', () => {
  let packs = [createPack('Mine')];
  packs = addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '🔥', label: 'Fire' });
  packs = addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '💜', label: 'Heart' });
  const [toKeep, toRemove] = packs[0].stickers;
  const updated = removeStickerFromPack(packs, packs[0].id, toRemove.id);
  assert.equal(updated[0].stickers.length, 1);
  assert.equal(updated[0].stickers[0].id, toKeep.id);
});

test('findSticker locates a sticker by pack and sticker id', () => {
  let packs = [createPack('Mine')];
  packs = addStickerToPack(packs, packs[0].id, { kind: 'emoji', data: '🔥', label: 'Fire' });
  const sticker = packs[0].stickers[0];
  assert.deepEqual(findSticker(packs, packs[0].id, sticker.id), sticker);
  assert.equal(findSticker(packs, packs[0].id, 'missing'), null);
});
