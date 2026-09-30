// Nostr relay connectivity: publishing signed events and subscribing to a
// basic social feed over WebSockets. Relays are just message routers here —
// no relay is trusted with the private key, and any public relay list can be
// swapped out by the user (see Settings).

import { SimplePool, finalizeEvent, kinds, nip19 } from 'nostr-tools';
import { secretKeyFromHex } from './identity.js';
import { GIFT_WRAP_KIND } from './dm.js';

export const NOTE_KIND = kinds.ShortTextNote; // 1
export const REPOST_KIND = kinds.Repost; // 6
export const REACTION_KIND = kinds.Reaction; // 7
export const CONTACTS_KIND = kinds.Contacts; // 3
export const METADATA_KIND = kinds.Metadata; // 0

export class RelayHub {
  constructor(relayUrls = [], { onStatusChange } = {}) {
    this.pool = new SimplePool();
    this.relayUrls = [...relayUrls];
    this.status = new Map(this.relayUrls.map((url) => [url, 'connecting']));
    this.onStatusChange = onStatusChange;
    this.feedSub = null;
    this.dmSub = null;
  }

  setRelays(relayUrls) {
    this.relayUrls = [...relayUrls];
    for (const url of this.relayUrls) {
      if (!this.status.has(url)) this.status.set(url, 'connecting');
    }
  }

  getStatusSnapshot() {
    return Object.fromEntries(this.status);
  }

  _setStatus(url, status) {
    this.status.set(url, status);
    this.onStatusChange?.(url, status);
  }

  /** Attempts to open connections to every configured relay. */
  async ensureConnections() {
    await Promise.all(
      this.relayUrls.map(async (url) => {
        try {
          this._setStatus(url, 'connecting');
          const relay = await this.pool.ensureRelay(url);
          this._setStatus(url, 'connected');
          relay.onclose = () => this._setStatus(url, 'disconnected');
        } catch (err) {
          this._setStatus(url, 'error');
        }
      }),
    );
  }

  /** Subscribes to a basic feed (text notes, reposts, reactions, replies). */
  subscribeFeed({ onEvent, onEose, authors, sinceSecondsAgo = 60 * 60 * 24 * 7, limit = 100 }) {
    this.feedSub?.close();
    const filter = {
      kinds: [NOTE_KIND, REPOST_KIND, REACTION_KIND],
      since: Math.floor(Date.now() / 1000) - sinceSecondsAgo,
      limit,
    };
    if (authors && authors.length) filter.authors = authors;

    this.feedSub = this.pool.subscribeMany(this.relayUrls, [filter], {
      onevent: onEvent,
      oneose: onEose,
    });
    return this.feedSub;
  }

  closeFeed() {
    this.feedSub?.close();
    this.feedSub = null;
  }

  /**
   * Subscribes to incoming NIP-17 gift-wrapped direct messages addressed to
   * `pubkeyHex` (i.e. events tagged `#p: [pubkeyHex]`). The caller is
   * responsible for unwrapping each event — the relay/pool layer only ever
   * sees the opaque gift wrap, never the plaintext message.
   */
  subscribeDirectMessages({ pubkeyHex, onEvent, sinceSecondsAgo = 60 * 60 * 24 * 30 }) {
    this.dmSub?.close();
    const filter = {
      kinds: [GIFT_WRAP_KIND],
      '#p': [pubkeyHex],
      since: Math.floor(Date.now() / 1000) - sinceSecondsAgo,
    };
    this.dmSub = this.pool.subscribeMany(this.relayUrls, [filter], { onevent: onEvent });
    return this.dmSub;
  }

  closeDirectMessages() {
    this.dmSub?.close();
    this.dmSub = null;
  }

  /** Publishes one or more already-signed gift-wrap events (see lib/dm.js). */
  async publishDirectMessage({ giftWrapEvents }) {
    const results = giftWrapEvents.flatMap((event) => this.pool.publish(this.relayUrls, event));
    await Promise.allSettled(results);
    return giftWrapEvents;
  }

  /** Publishes a signed text note and returns the finalized event. */
  async publishNote({ content, secretKeyHex, replyTo, mentions = [] }) {
    const tags = [];
    if (replyTo) tags.push(['e', replyTo, '', 'reply']);
    for (const pubkey of mentions) tags.push(['p', pubkey]);
    return this._signAndPublish({ kind: NOTE_KIND, content, tags, secretKeyHex });
  }

  /** Publishes a like/reaction ("+") to an existing event. */
  async publishReaction({ targetEvent, secretKeyHex, content = '+' }) {
    return this._signAndPublish({
      kind: REACTION_KIND,
      content,
      tags: [
        ['e', targetEvent.id],
        ['p', targetEvent.pubkey],
      ],
      secretKeyHex,
    });
  }

  /** Publishes a repost (kind 6) referencing an existing event. */
  async publishRepost({ targetEvent, secretKeyHex }) {
    return this._signAndPublish({
      kind: REPOST_KIND,
      content: JSON.stringify(targetEvent),
      tags: [
        ['e', targetEvent.id],
        ['p', targetEvent.pubkey],
      ],
      secretKeyHex,
    });
  }

  /** Publishes a comment/reply as a regular text note tagged to the parent. */
  async publishComment({ content, targetEvent, secretKeyHex }) {
    return this._signAndPublish({
      kind: NOTE_KIND,
      content,
      tags: [
        ['e', targetEvent.id, '', 'reply'],
        ['p', targetEvent.pubkey],
      ],
      secretKeyHex,
    });
  }

  /** Publishes a follow list (kind 3) of public keys. */
  async publishFollowList({ pubkeys, secretKeyHex }) {
    return this._signAndPublish({
      kind: CONTACTS_KIND,
      content: '',
      tags: pubkeys.map((pk) => ['p', pk]),
      secretKeyHex,
    });
  }

  /** Publishes public profile metadata (kind 0) — name, bio, styling, etc. */
  async publishProfileMetadata({ metadata, secretKeyHex }) {
    return this._signAndPublish({
      kind: METADATA_KIND,
      content: JSON.stringify(metadata),
      tags: [],
      secretKeyHex,
    });
  }

  /**
   * One-shot lookup of a pubkey's most recent published profile metadata
   * (kind 0). Returns the parsed JSON content, or `null` if nothing is
   * found on the currently connected relays.
   */
  async fetchProfileMetadata(pubkeyHex) {
    const event = await this.pool.get(this.relayUrls, { kinds: [METADATA_KIND], authors: [pubkeyHex] });
    if (!event) return null;
    try {
      return { ...JSON.parse(event.content), _event: event };
    } catch {
      return null;
    }
  }

  /**
   * One-shot lookup of a pubkey's most recent published follow list
   * (kind 3). Returns an array of followed pubkeys (possibly empty).
   */
  async fetchFollowList(pubkeyHex) {
    const event = await this.pool.get(this.relayUrls, { kinds: [CONTACTS_KIND], authors: [pubkeyHex] });
    if (!event) return [];
    return event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]);
  }

  async _signAndPublish({ kind, content, tags, secretKeyHex }) {
    const secretKey = secretKeyFromHex(secretKeyHex);
    const event = finalizeEvent(
      { kind, content, tags, created_at: Math.floor(Date.now() / 1000) },
      secretKey,
    );
    const results = this.pool.publish(this.relayUrls, event);
    await Promise.allSettled(results);
    return event;
  }

  destroy() {
    this.closeFeed();
    this.closeDirectMessages();
    this.pool.close(this.relayUrls);
  }
}

export function npubFor(pubkeyHex) {
  return nip19.npubEncode(pubkeyHex);
}

/**
 * Accepts either an npub1... string or a 64-char hex pubkey and returns the
 * hex form, or throws if the input is not a recognizable public key.
 */
export function pubkeyFromInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) throw new Error('Enter an npub or hex public key.');
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') throw new Error('That does not look like an npub public key.');
    return decoded.data;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  throw new Error('Enter a valid npub1... key or a 64-character hex public key.');
}

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];
