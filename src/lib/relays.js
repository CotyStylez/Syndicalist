// Nostr relay connectivity: publishing signed events and subscribing to a
// basic social feed over WebSockets. Relays are just message routers here —
// no relay is trusted with the private key, and any public relay list can be
// swapped out by the user (see Settings).

import { SimplePool, finalizeEvent, kinds, nip19 } from 'nostr-tools';
import { secretKeyFromHex } from './identity.js';

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
    this.pool.close(this.relayUrls);
  }
}

export function npubFor(pubkeyHex) {
  return nip19.npubEncode(pubkeyHex);
}

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];
