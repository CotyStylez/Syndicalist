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
import { RelayHub, DEFAULT_RELAYS, pubkeyFromInput } from './lib/relays.js';
import { wrapDirectMessage, unwrapDirectMessage } from './lib/dm.js';

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
    follows: [], // pubkeys (hex) the user follows
    profileCache: {}, // pubkeyHex -> { name, about, picture, ..., fetchedAt }
    relayStatus: {},
    privateNotes: [], // decrypted only in memory while unlocked
    dmConversations: {}, // peerPubkeyHex -> [{ id, direction, content, createdAt }], decrypted only while unlocked
    dmSubscriptionActive: false,
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
    const [profile, relays, prefs, draft, vaultExists, follows, profileCache] = await Promise.all([
      getItem(KEYS.PROFILE),
      getItem(KEYS.RELAYS),
      getItem(KEYS.PREFS),
      getItem(KEYS.DRAFTS),
      hasSealed(KEYS.IDENTITY_VAULT),
      getItem(KEYS.FOLLOWS),
      getItem(KEYS.PROFILE_CACHE),
    ]);
    if (profile) state.profile = { ...DEFAULT_PROFILE, ...profile };
    if (relays && relays.length) state.relays = relays;
    if (prefs) state.prefs = { ...DEFAULT_PREFS, ...prefs };
    if (typeof draft === 'string') state.draft = draft;
    if (Array.isArray(follows)) state.follows = follows;
    if (profileCache) state.profileCache = profileCache;
    state.vaultExists = vaultExists;
    state.ready = true;
    notify();
  }

  function computeFeedAuthors() {
    return state.prefs.feedMode === 'following' ? [...state.follows] : undefined;
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
      authors: computeFeedAuthors(),
      onEvent: (event) => {
        addFeedEvent(event);
        onEvent?.(event);
        void ensureProfileCached(event.pubkey);
      },
    });
    if (state.identity) startDmSubscription();
    notify();
    return hub;
  }

  /** Re-subscribes to the feed with the current filter, without dropping
   * the underlying relay websocket connections (used when the follow list
   * or feed mode changes). */
  function refreshFeedSubscription() {
    if (!state.relayHub) return;
    state.feed = [];
    state.relayHub.subscribeFeed({
      authors: computeFeedAuthors(),
      onEvent: (event) => {
        addFeedEvent(event);
        void ensureProfileCached(event.pubkey);
      },
    });
    notifyFeed();
  }

  async function setFeedMode(mode) {
    await savePrefs({ feedMode: mode });
    refreshFeedSubscription();
  }

  function addFeedEvent(event) {
    if (state.feed.some((existing) => existing.id === event.id)) return;
    state.feed = [event, ...state.feed].sort((a, b) => b.created_at - a.created_at).slice(0, 300);
    notifyFeed();
  }

  /** Follows a pubkey (hex or npub/nsec-style input), persists it locally,
   * and best-effort publishes the updated follow list if unlocked. */
  async function followPubkey(input) {
    const pubkeyHex = pubkeyFromInput(input);
    if (state.identity && pubkeyHex === state.identity.publicKeyHex) {
      throw new Error("You can't follow yourself.");
    }
    if (!state.follows.includes(pubkeyHex)) {
      state.follows = [...state.follows, pubkeyHex];
      await setItem(KEYS.FOLLOWS, state.follows);
      if (state.prefs.feedMode === 'following') refreshFeedSubscription();
      notify();
      await publishFollowsIfUnlocked();
    }
    await ensureProfileCached(pubkeyHex, { force: true });
    return pubkeyHex;
  }

  async function unfollowPubkey(pubkeyHex) {
    if (!state.follows.includes(pubkeyHex)) return;
    state.follows = state.follows.filter((pk) => pk !== pubkeyHex);
    await setItem(KEYS.FOLLOWS, state.follows);
    if (state.prefs.feedMode === 'following') refreshFeedSubscription();
    notify();
    await publishFollowsIfUnlocked();
  }

  async function publishFollowsIfUnlocked() {
    if (!state.identity || !state.relayHub) return;
    try {
      await state.relayHub.publishFollowList({
        pubkeys: state.follows,
        secretKeyHex: state.identity.secretKeyHex,
      });
    } catch {
      // Best-effort: the follow list stays accurate locally even if no
      // relay accepted the publish right now.
    }
  }

  /** Looks up and caches a pubkey's published profile metadata (kind 0).
   * Skips the network round-trip if we already have a cached copy, unless
   * `force` is set (e.g. right after the user follows someone new). */
  async function ensureProfileCached(pubkeyHex, { force = false } = {}) {
    if (!pubkeyHex || !state.relayHub) return state.profileCache[pubkeyHex] || null;
    if (!force && state.profileCache[pubkeyHex]) return state.profileCache[pubkeyHex];
    try {
      const metadata = await state.relayHub.fetchProfileMetadata(pubkeyHex);
      if (metadata) {
        state.profileCache = { ...state.profileCache, [pubkeyHex]: { ...metadata, fetchedAt: Date.now() } };
        await setItem(KEYS.PROFILE_CACHE, state.profileCache);
        notifyFeed();
      }
      return metadata;
    } catch {
      return state.profileCache[pubkeyHex] || null;
    }
  }

  /** Appends a message to an in-memory conversation (deduped by rumor id)
   * and re-seals the whole conversation set to encrypted storage. No-op if
   * the identity is locked (there's nothing to encrypt it with). */
  async function _storeDmMessage(peerPubkeyHex, message) {
    const existing = state.dmConversations[peerPubkeyHex] || [];
    if (existing.some((m) => m.id === message.id)) return;
    const updated = [...existing, message].sort((a, b) => a.createdAt - b.createdAt);
    state.dmConversations = { ...state.dmConversations, [peerPubkeyHex]: updated };
    if (state.sessionPassphrase) {
      await sealAndStore(KEYS.DM_CONVERSATIONS, state.dmConversations, state.sessionPassphrase);
    }
    notifyFeed();
  }

  /** Encrypts and publishes a direct message to `recipientInput` (npub or
   * hex), and records it in the local, encrypted conversation history. */
  async function sendDirectMessage(recipientInput, content) {
    if (!state.identity || !state.sessionPassphrase) throw new Error('Unlock your identity first.');
    if (!state.relayHub) throw new Error('Connect to relays first.');
    const recipientPubkeyHex = pubkeyFromInput(recipientInput);
    if (recipientPubkeyHex === state.identity.publicKeyHex) {
      throw new Error("You can't message yourself.");
    }

    const { wraps } = wrapDirectMessage({
      content,
      recipientPubkeyHex,
      senderSecretKeyHex: state.identity.secretKeyHex,
    });
    const [selfWrap] = wraps;
    await state.relayHub.publishDirectMessage({ giftWrapEvents: wraps });

    // Unwrap our own self-copy to get the message's real rumor id/timestamp,
    // so if the relay later echoes this same gift wrap back to us via the
    // DM subscription, it dedupes instead of showing the message twice.
    const rumor = unwrapDirectMessage({ giftWrapEvent: selfWrap, recipientSecretKeyHex: state.identity.secretKeyHex });
    await _storeDmMessage(recipientPubkeyHex, {
      id: rumor.id,
      direction: 'out',
      content: rumor.content,
      createdAt: rumor.created_at,
    });
    void ensureProfileCached(recipientPubkeyHex);
    return recipientPubkeyHex;
  }

  /** Subscribes to incoming gift-wrapped DMs for the current identity.
   * Safe to call repeatedly — each call replaces the previous subscription
   * on the same relay hub. No-op if locked or not yet connected to relays. */
  function startDmSubscription() {
    if (!state.identity || !state.relayHub) return;
    state.relayHub.subscribeDirectMessages({
      pubkeyHex: state.identity.publicKeyHex,
      onEvent: (event) => {
        if (!state.identity) return; // may have locked between subscribe and event arrival
        try {
          const rumor = unwrapDirectMessage({ giftWrapEvent: event, recipientSecretKeyHex: state.identity.secretKeyHex });
          const peerPubkeyHex = rumor.pubkey === state.identity.publicKeyHex ? findRecipientTag(rumor) : rumor.pubkey;
          if (!peerPubkeyHex) return;
          void _storeDmMessage(peerPubkeyHex, {
            id: rumor.id,
            direction: rumor.pubkey === state.identity.publicKeyHex ? 'out' : 'in',
            content: rumor.content,
            createdAt: rumor.created_at,
          });
          void ensureProfileCached(peerPubkeyHex);
        } catch {
          // Not addressed to us, or not decryptable with our key — ignore.
        }
      },
    });
    state.dmSubscriptionActive = true;
  }

  /** For a self-copy rumor (sent by us), the actual peer is the first `p`
   * tag recipient rather than the rumor's own pubkey. */
  function findRecipientTag(rumor) {
    const tag = rumor.tags.find((t) => t[0] === 'p');
    return tag ? tag[1] : null;
  }

  async function generateNewIdentity(passphrase) {
    const identity = generateIdentity();
    await sealAndStore(KEYS.IDENTITY_VAULT, identity, passphrase);
    state.identity = identity;
    state.vaultExists = true;
    state.sessionPassphrase = passphrase;
    if (state.relayHub) startDmSubscription();
    notify();
    return identity;
  }

  async function importAndSealIdentity(privateKeyInput, passphrase) {
    const identity = importIdentity(privateKeyInput);
    await sealAndStore(KEYS.IDENTITY_VAULT, identity, passphrase);
    state.identity = identity;
    state.vaultExists = true;
    state.sessionPassphrase = passphrase;
    if (state.relayHub) startDmSubscription();
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
    const conversations = await unseal(KEYS.DM_CONVERSATIONS, passphrase).catch(() => ({}));
    state.dmConversations = conversations || {};
    if (state.relayHub) startDmSubscription();
    notify();
    return identity;
  }

  function lockIdentity() {
    state.relayHub?.closeDirectMessages();
    state.dmSubscriptionActive = false;
    state.identity = null;
    state.sessionPassphrase = null;
    state.privateNotes = [];
    state.dmConversations = {};
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
    state.follows = [];
    state.profileCache = {};
    state.privateNotes = [];
    state.dmConversations = {};
    state.dmSubscriptionActive = false;
    notify();
  }

  async function forgetIdentityOnly() {
    await forget(KEYS.IDENTITY_VAULT);
    await forget(KEYS.PRIVATE_NOTES);
    await forget(KEYS.DM_CONVERSATIONS);
    state.relayHub?.closeDirectMessages();
    state.identity = null;
    state.sessionPassphrase = null;
    state.vaultExists = false;
    state.privateNotes = [];
    state.dmConversations = {};
    state.dmSubscriptionActive = false;
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
    setFeedMode,
    followPubkey,
    unfollowPubkey,
    ensureProfileCached,
    addPrivateNote,
    deletePrivateNote,
    sendDirectMessage,
    startDmSubscription,
    panicWipe,
    forgetIdentityOnly,
  };
}
