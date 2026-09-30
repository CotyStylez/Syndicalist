// Central application state: in-memory session state plus the local-first
// persistence layer. This module intentionally has no UI code — views read
// from `state` and call these actions, then re-render.
//
// IMPORTANT PRIVACY NOTE: `identity.secretKeyHex` and `sessionPassphrase`
// only ever live in this in-memory object. They are never written to
// storage in plaintext — only encrypted envelopes are persisted (see
// lib/vault.js).

import { generateIdentity, importIdentity } from './lib/identity.js';
import { sealAndStore, unseal, hasSealed, forget } from './lib/vault.js';
import { getItem, setItem, clearAll, KEYS } from './lib/storage.js';
import { RelayHub, DEFAULT_RELAYS } from './lib/relays.js';

const DEFAULT_PROFILE = {
  displayName: '',
  bio: '',
  themeColor: '#ff2d75',
  accentColor: '#1a1a2e',
  bannerEmoji: '🌇',
  avatarEmoji: '🛰️',
  layout: 'classic',
  widgets: [
    { title: 'Now Playing', content: 'Add a song, mood, or status.' },
    { title: 'Top Friends', content: 'Feature people you follow here.' },
  ],
};

const DEFAULT_PREFS = {
  feedMode: 'global',
  autoConnect: true,
};

function emptyIdentity() {
  return null;
}

export function createAppState() {
  const listeners = new Set();
  // Feed/relay-status updates happen far more often than everything else
  // (a new relay event can arrive every second). Routing them through a
  // dedicated, lower-traffic pub-sub keeps background feed activity from
  // forcing a full UI re-render (and losing in-progress form input) on
  // whatever tab the user is currently looking at.
  const feedListeners = new Set();

  const state = {
    ready: false,
    identity: emptyIdentity(), // { secretKeyHex, publicKeyHex, nsec, npub }
    vaultExists: false,
    sessionPassphrase: null, // kept only in memory, used to reseal notes/profile
    profile: { ...DEFAULT_PROFILE },
    relays: [...DEFAULT_RELAYS],
    prefs: { ...DEFAULT_PREFS },
    draft: '',
    feed: [], // deduped nostr events, newest first
    follows: [],
    relayStatus: {},
    privateNotes: [], // decrypted only in memory while unlocked
    relayHub: null,
    error: null,
  };

  function notify() {
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notifyFeed() {
    for (const fn of feedListeners) fn();
  }

  function subscribeFeedUpdates(fn) {
    feedListeners.add(fn);
    return () => feedListeners.delete(fn);
  }

  function setError(message) {
    state.error = message || null;
    notify();
  }

  async function loadPersisted() {
    const [profile, relays, prefs, draft, vaultExists] = await Promise.all([
      getItem(KEYS.PROFILE),
      getItem(KEYS.RELAYS),
      getItem(KEYS.PREFS),
      getItem(KEYS.DRAFTS),
      hasSealed(KEYS.IDENTITY_VAULT),
    ]);
    if (profile) state.profile = { ...DEFAULT_PROFILE, ...profile };
    if (relays && relays.length) state.relays = relays;
    if (prefs) state.prefs = { ...DEFAULT_PREFS, ...prefs };
    if (typeof draft === 'string') state.draft = draft;
    state.vaultExists = vaultExists;
    state.ready = true;
    notify();
  }

  function connectRelays({ onEvent } = {}) {
    state.relayHub?.destroy();
    state.relayStatus = {};
    const hub = new RelayHub(state.relays, {
      onStatusChange: (url, status) => {
        state.relayStatus = { ...state.relayStatus, [url]: status };
        notifyFeed();
      },
    });
    state.relayHub = hub;
    hub.ensureConnections();
    hub.subscribeFeed({
      onEvent: (event) => {
        addFeedEvent(event);
        onEvent?.(event);
      },
    });
    notify();
    return hub;
  }

  function addFeedEvent(event) {
    if (state.feed.some((existing) => existing.id === event.id)) return;
    state.feed = [event, ...state.feed].sort((a, b) => b.created_at - a.created_at).slice(0, 300);
    notifyFeed();
  }

  async function generateNewIdentity(passphrase) {
    const identity = generateIdentity();
    await sealAndStore(KEYS.IDENTITY_VAULT, identity, passphrase);
    state.identity = identity;
    state.vaultExists = true;
    state.sessionPassphrase = passphrase;
    notify();
    return identity;
  }

  async function importAndSealIdentity(privateKeyInput, passphrase) {
    const identity = importIdentity(privateKeyInput);
    await sealAndStore(KEYS.IDENTITY_VAULT, identity, passphrase);
    state.identity = identity;
    state.vaultExists = true;
    state.sessionPassphrase = passphrase;
    notify();
    return identity;
  }

  async function unlockIdentity(passphrase) {
    const identity = await unseal(KEYS.IDENTITY_VAULT, passphrase);
    if (!identity) throw new Error('No identity is stored yet. Generate or import one first.');
    state.identity = identity;
    state.sessionPassphrase = passphrase;
    const notes = await unseal(KEYS.PRIVATE_NOTES, passphrase).catch(() => []);
    state.privateNotes = notes || [];
    notify();
    return identity;
  }

  function lockIdentity() {
    state.identity = null;
    state.sessionPassphrase = null;
    state.privateNotes = [];
    notify();
  }

  async function saveProfile(partialProfile) {
    state.profile = { ...state.profile, ...partialProfile };
    await setItem(KEYS.PROFILE, state.profile);
    notify();
  }

  async function saveDraft(text) {
    state.draft = text;
    await setItem(KEYS.DRAFTS, text);
  }

  async function setRelays(relayUrls) {
    state.relays = relayUrls;
    await setItem(KEYS.RELAYS, relayUrls);
    connectRelays();
  }

  async function savePrefs(partialPrefs) {
    state.prefs = { ...state.prefs, ...partialPrefs };
    await setItem(KEYS.PREFS, state.prefs);
    notify();
  }

  async function addPrivateNote(note) {
    if (!state.sessionPassphrase) throw new Error('Unlock your identity first.');
    state.privateNotes = [{ id: crypto.randomUUID(), createdAt: Date.now(), ...note }, ...state.privateNotes];
    await sealAndStore(KEYS.PRIVATE_NOTES, state.privateNotes, state.sessionPassphrase);
    notify();
  }

  async function deletePrivateNote(id) {
    if (!state.sessionPassphrase) throw new Error('Unlock your identity first.');
    state.privateNotes = state.privateNotes.filter((n) => n.id !== id);
    await sealAndStore(KEYS.PRIVATE_NOTES, state.privateNotes, state.sessionPassphrase);
    notify();
  }

  async function panicWipe() {
    state.relayHub?.destroy();
    await clearAll();
    state.identity = null;
    state.sessionPassphrase = null;
    state.vaultExists = false;
    state.profile = { ...DEFAULT_PROFILE };
    state.relays = [...DEFAULT_RELAYS];
    state.prefs = { ...DEFAULT_PREFS };
    state.draft = '';
    state.feed = [];
    state.privateNotes = [];
    notify();
  }

  async function forgetIdentityOnly() {
    await forget(KEYS.IDENTITY_VAULT);
    await forget(KEYS.PRIVATE_NOTES);
    state.identity = null;
    state.sessionPassphrase = null;
    state.vaultExists = false;
    state.privateNotes = [];
    notify();
  }

  return {
    state,
    subscribe,
    subscribeFeedUpdates,
    setError,
    loadPersisted,
    connectRelays,
    addFeedEvent,
    generateNewIdentity,
    importAndSealIdentity,
    unlockIdentity,
    lockIdentity,
    saveProfile,
    saveDraft,
    setRelays,
    savePrefs,
    addPrivateNote,
    deletePrivateNote,
    panicWipe,
    forgetIdentityOnly,
  };
}
