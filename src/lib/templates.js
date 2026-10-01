// Local-first "Live session" format templates.
//
// A template is just a small, structured preset describing how the Live P2P
// view should be labeled and laid out for a given session — e.g. a Debate
// Panel with labeled "Pro"/"Con" sides and a topic banner, vs. a plain Solo
// Broadcast. Templates are cosmetic/structural only: they do not change the
// underlying transport, which stays the existing 1:1 WebRTC data channel
// (see lib/webrtc.js) — no SFU, no media server, no data-center dependency,
// consistent with the rest of this app.
//
// Templates live only in this browser's IndexedDB (see lib/storage.js,
// KEYS.LIVE_TEMPLATES). The built-ins are seeded once; a host can duplicate
// and customize any of them (rename roles/labels, change the accent color,
// add a topic banner, adjust the timer) without touching code.

import { getItem, setItem, KEYS } from './storage.js';

function uuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Built-in starter templates, covering the most common live formats. */
export function builtInTemplates() {
  return [
    {
      id: 'debate-panel',
      name: '🗣️ Debate panel',
      layout: 'split',
      accentColor: '#ff2d75',
      roles: ['Pro', 'Con'],
      showTopicBanner: true,
      topic: '',
      timerMinutes: 5,
      builtIn: true,
    },
    {
      id: 'interview',
      name: '🎙️ 1:1 interview',
      layout: 'host-guest',
      accentColor: '#7b2ff7',
      roles: ['Host', 'Guest'],
      showTopicBanner: false,
      topic: '',
      timerMinutes: 0,
      builtIn: true,
    },
    {
      id: 'solo-broadcast',
      name: '📡 Solo broadcast',
      layout: 'solo',
      accentColor: '#2ecc71',
      roles: ['You'],
      showTopicBanner: false,
      topic: '',
      timerMinutes: 0,
      builtIn: true,
    },
    {
      id: 'roundtable',
      name: '🎧 Round-table / podcast',
      layout: 'roundtable',
      accentColor: '#ffcc4d',
      roles: ['Speaker 1', 'Speaker 2'],
      showTopicBanner: true,
      topic: '',
      timerMinutes: 0,
      builtIn: true,
    },
  ];
}

/** Loads every locally-stored template, seeding the built-ins the first
 * time the app runs so the picker is never empty. */
export async function loadTemplates() {
  const stored = await getItem(KEYS.LIVE_TEMPLATES);
  if (Array.isArray(stored) && stored.length) return stored;
  const seeded = builtInTemplates();
  await setItem(KEYS.LIVE_TEMPLATES, seeded);
  return seeded;
}

export async function saveTemplates(templates) {
  await setItem(KEYS.LIVE_TEMPLATES, templates);
  return templates;
}

/** Duplicates a template (built-in or custom) into an editable copy with a
 * new id, so a host can tweak labels/colors/topic without losing the
 * original preset. */
export function duplicateTemplate(template, name) {
  return {
    ...template,
    id: uuid(),
    name: name || `${template.name} (copy)`,
    builtIn: false,
  };
}

/** Applies an edit to a template. Any edit to a built-in demotes it to a
 * regular (non-built-in) entry, since it's no longer the original preset —
 * this only affects whether it's shown as "built-in" in the UI, not any
 * underlying behavior. */
export function updateTemplate(templates, templateId, patch) {
  return templates.map((t) => (t.id === templateId ? { ...t, ...patch, builtIn: false } : t));
}

export function removeTemplate(templates, templateId) {
  return templates.filter((t) => t.id !== templateId);
}
