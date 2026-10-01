import { h, mount } from '../utils/dom.js';
import { createPack, addStickerToPack, removeStickerFromPack, readFileAsDataUrl } from '../lib/stickers.js';

// A local-first sticker/tip-pack manager. Everything here — pack names,
// emoji/SVG/image artwork, and the sats price a host assigns to a sticker —
// lives only in this browser (IndexedDB via lib/storage.js). Nothing is
// uploaded anywhere; packs are only shared peer-to-peer during a live
// session (see webrtcView.js), and only with whoever is directly connected.

let newPackName = '';
let draftKind = 'emoji';
let draftData = '';
let draftLabel = '';
let draftSats = 0;
let draftPackId = null;
let status = null;

export function renderStickersView(content, app) {
  draw(content, app);
}

function draw(content, app) {
  const packs = app.state.stickerPacks || [];
  if (!draftPackId && packs.length) draftPackId = packs[0].id;

  const intro = h('section', { class: 'card' }, [
    h('h2', {}, '🎨 Sticker & tip packs'),
    h('p', { class: 'muted' }, [
      'Stickers you create here are stored only in this browser. During a Live P2P session you pick one pack to show your viewers — ',
      'assign a sats amount to a sticker to make it a tip sticker (see the Live P2P tab for how tipping works without any central server).',
    ]),
  ]);

  const packCreator = h('section', { class: 'card' }, [
    h('h3', {}, 'Create a pack'),
    h('div', { class: 'button-row' }, [
      h('input', { type: 'text', placeholder: 'Pack name', value: newPackName, onInput: (e) => (newPackName = e.target.value) }),
      h(
        'button',
        {
          onClick: async () => {
            if (!newPackName.trim()) return;
            const updated = [...packs, createPack(newPackName.trim())];
            newPackName = '';
            await app.saveStickerPacks(updated);
            draw(content, app);
          },
        },
        '+ Add pack',
      ),
    ]),
  ]);

  const packSections = packs.map((pack) =>
    h('section', { class: 'card' }, [
      h('h3', {}, pack.name),
      h(
        'div',
        { class: 'sticker-tray' },
        pack.stickers.map((sticker) =>
          h('div', { class: 'sticker-btn', title: sticker.label }, [
            renderStickerArt(sticker),
            sticker.sats ? h('span', { class: 'sticker-price' }, `${sticker.sats} sats`) : null,
            h(
              'button',
              {
                class: 'link-btn',
                onClick: async () => {
                  const updated = removeStickerFromPack(packs, pack.id, sticker.id);
                  await app.saveStickerPacks(updated);
                  draw(content, app);
                },
              },
              'remove',
            ),
          ]),
        ),
      ),
      draftPackId === pack.id ? renderStickerEditor(content, app, packs, pack) : null,
      draftPackId !== pack.id
        ? h(
            'button',
            {
              onClick: () => {
                draftPackId = pack.id;
                draw(content, app);
              },
            },
            '+ Add sticker to this pack',
          )
        : null,
    ]),
  );

  mount(content, intro, packCreator, ...packSections);
}

function renderStickerArt(sticker) {
  if (sticker.kind === 'emoji') return h('span', {}, sticker.data);
  if (sticker.kind === 'svg') return h('span', { html: sticker.data });
  return h('img', { src: sticker.data, alt: sticker.label });
}

function renderStickerEditor(content, app, packs, pack) {
  return h('div', { class: 'widget-editor' }, [
    h('div', { class: 'widget-edit-row' }, [
      h(
        'select',
        { onChange: (e) => (draftKind = e.target.value) },
        ['emoji', 'svg', 'image'].map((opt) => h('option', { value: opt, selected: draftKind === opt ? '' : undefined }, opt)),
      ),
      h('input', { type: 'text', placeholder: 'Label', value: draftLabel, onInput: (e) => (draftLabel = e.target.value) }),
      h('input', {
        type: 'number',
        min: 0,
        placeholder: 'Sats (0 = not a tip)',
        value: draftSats,
        onInput: (e) => (draftSats = Number(e.target.value) || 0),
      }),
    ]),
    draftKind === 'emoji'
      ? h('input', { type: 'text', placeholder: 'Paste an emoji', value: draftData, maxlength: 8, onInput: (e) => (draftData = e.target.value) })
      : null,
    draftKind === 'svg'
      ? h('textarea', { rows: 3, placeholder: '<svg>...</svg>', value: draftData, onInput: (e) => (draftData = e.target.value) })
      : null,
    draftKind === 'image'
      ? h('input', {
          type: 'file',
          accept: 'image/*',
          onChange: async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            draftData = await readFileAsDataUrl(file);
          },
        })
      : null,
    status ? h('p', { class: 'muted small' }, status) : null,
    h('div', { class: 'button-row' }, [
      h(
        'button',
        {
          class: 'primary',
          onClick: async () => {
            try {
              const updated = addStickerToPack(packs, pack.id, {
                kind: draftKind,
                data: draftData,
                label: draftLabel,
                sats: draftSats,
              });
              draftData = '';
              draftLabel = '';
              draftSats = 0;
              status = null;
              await app.saveStickerPacks(updated);
              draw(content, app);
            } catch (err) {
              status = err.message;
              draw(content, app);
            }
          },
        },
        'Save sticker',
      ),
      h(
        'button',
        {
          onClick: () => {
            draftPackId = null;
            draw(content, app);
          },
        },
        'Done',
      ),
    ]),
  ]);
}
