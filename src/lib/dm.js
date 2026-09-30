// Encrypted direct messaging over Nostr, implemented with NIP-17 ("Private
// Direct Messages") on top of NIP-44 (encryption) and NIP-59 (gift wrap).
//
// Unlike a plain encrypted note, a NIP-17 message hides *both* the content
// and the metadata (real sender, real recipient, real timestamp) from
// relays and outside observers: the actual message ("rumor") is sealed with
// the sender's real key, then wrapped again under a random, throwaway key
// before being published. Only someone holding the recipient's private key
// can unwrap it back down to the plaintext rumor.
//
// This module is a thin wrapper around nostr-tools' nip17 helpers, mirroring
// how lib/relays.js wraps SimplePool — no cryptography is implemented here
// directly, we only shape inputs/outputs for the rest of the app.

import { wrapManyEvents, unwrapEvent } from 'nostr-tools/nip17';
import { kinds } from 'nostr-tools';
import { secretKeyFromHex } from './identity.js';

export const PRIVATE_DM_KIND = kinds.PrivateDirectMessage; // 14 — the unwrapped rumor's kind
export const GIFT_WRAP_KIND = kinds.GiftWrap; // 1059 — what actually gets published to relays

/**
 * Builds the gift-wrapped event(s) for a direct message and returns them
 * ready to publish, along with the plaintext rumor for local storage.
 *
 * Two wraps are produced: one addressed to the recipient (so they can read
 * it), and one addressed back to the sender's own pubkey (a "self-copy" so
 * the same message can be recovered from relays on another device). Both
 * wrap the exact same rumor, so their content matches once unwrapped.
 */
export function wrapDirectMessage({ content, recipientPubkeyHex, senderSecretKeyHex, conversationTitle, replyTo }) {
  if (!content || !content.trim()) throw new Error('Message content is required.');
  if (!recipientPubkeyHex) throw new Error('A recipient public key is required.');

  const senderSecretKey = secretKeyFromHex(senderSecretKeyHex);
  const recipients = [{ publicKey: recipientPubkeyHex }];
  const [selfWrap, recipientWrap] = wrapManyEvents(senderSecretKey, recipients, content, conversationTitle, replyTo);

  return { wraps: [selfWrap, recipientWrap] };
}

/**
 * Unwraps a gift-wrap event (kind 1059) received from a relay, returning
 * the plaintext rumor `{ id, pubkey, content, created_at, tags, kind }`.
 * `rumor.pubkey` is the real sender — it is cryptographically verified via
 * the signed "seal" layer, not just taken at face value. Throws if the
 * event cannot be unwrapped with this key, or isn't a direct message.
 */
export function unwrapDirectMessage({ giftWrapEvent, recipientSecretKeyHex }) {
  const recipientSecretKey = secretKeyFromHex(recipientSecretKeyHex);
  const rumor = unwrapEvent(giftWrapEvent, recipientSecretKey);
  if (rumor.kind !== PRIVATE_DM_KIND) {
    throw new Error(`Unexpected rumor kind ${rumor.kind}, expected ${PRIVATE_DM_KIND}.`);
  }
  return rumor;
}
