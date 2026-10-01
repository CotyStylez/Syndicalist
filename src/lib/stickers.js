// Local-first sticker library for the Live P2P chat overlay.
//
// Stickers are fully user/host-owned: their artwork (an emoji, an inline
// SVG string, or a raster image as a data: URL) lives only in this
// browser's IndexedDB (see lib/storage.js, KEYS.STICKER_PACKS) — nothing is
// uploaded to any server. A host picks one pack as "active" for a live
// session; only lightweight references (ids + the sats price a host set)
// travel over the WebRTC data channel, so a viewer renders whatever
// matching artwork they already have locally, or a neutral placeholder if
// they don't — the app never needs a central sticker CDN.
//
// A sticker optionally carries `sats`, the amount a tap on it requests via
// a NIP-57 zap to the host's Lightning address (see lib/zap.js). Stickers
// with no `sats` (or `sats: 0`) are purely cosmetic reactions.

import { getItem, setItem, KEYS } from './storage.js';

export const STICKER_KINDS = ['emoji', 'svg', 'image'];

function uuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `stk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A small built-in pack so the tray isn't empty on first run. */
export function defaultPack() {
  return {
    id: 'default',
    name: 'Starter pack',
    stickers: [
      { id: 'wave', kind: 'emoji', data: '👋', label: 'Wave', sats: 0 },
      { id: 'fire', kind: 'emoji', data: '🔥', label: 'Fire', sats: 100 },
      { id: 'heart', kind: 'emoji', data: '💜', label: 'Heart', sats: 500 },
      { id: 'rocket', kind: 'emoji', data: '🚀', label: 'Rocket', sats: 1000 },
      { id: 'gem', kind: 'emoji', data: '💎', label: 'Gem', sats: 5000 },
    ],
  };
}

function validateKind(kind) {
  if (!STICKER_KINDS.includes(kind)) {
    throw new Error(`Unknown sticker kind "${kind}". Expected one of: ${STICKER_KINDS.join(', ')}.`);
  }
}

/** Loads every locally-stored pack, seeding the built-in starter pack the
 * first time the app runs so the tray is never empty. */
export async function loadPacks() {
  const stored = await getItem(KEYS.STICKER_PACKS);
  if (Array.isArray(stored) && stored.length) return stored;
  const seeded = [defaultPack()];
  await setItem(KEYS.STICKER_PACKS, seeded);
  return seeded;
}

export async function savePacks(packs) {
  await setItem(KEYS.STICKER_PACKS, packs);
  return packs;
}

export function createPack(name) {
  return { id: uuid(), name: name || 'New pack', stickers: [] };
}

/** Adds a sticker to a pack (returns a new packs array; does not persist —
 * callers persist via savePacks once they're happy with the edit). */
export function addStickerToPack(packs, packId, { kind, data, label, sats = 0 }) {
  validateKind(kind);
  if (!data) throw new Error('Sticker artwork/content is required.');
  const sticker = { id: uuid(), kind, data, label: label || 'Sticker', sats: Math.max(0, Number(sats) || 0) };
  return packs.map((pack) => (pack.id === packId ? { ...pack, stickers: [...pack.stickers, sticker] } : pack));
}

export function removeStickerFromPack(packs, packId, stickerId) {
  return packs.map((pack) =>
    pack.id === packId ? { ...pack, stickers: pack.stickers.filter((s) => s.id !== stickerId) } : pack,
  );
}

export function findSticker(packs, packId, stickerId) {
  const pack = packs.find((p) => p.id === packId);
  return pack?.stickers.find((s) => s.id === stickerId) || null;
}

/** Reads an uploaded image file and returns a data: URL, for storing a
 * raster sticker entirely locally (no external hosting). */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}
