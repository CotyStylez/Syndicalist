import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapDirectMessage, unwrapDirectMessage, PRIVATE_DM_KIND, GIFT_WRAP_KIND } from '../src/lib/dm.js';
import { generateIdentity } from '../src/lib/identity.js';

test('wrapDirectMessage/unwrapDirectMessage roundtrips a message for the recipient', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();

  const { wraps } = wrapDirectMessage({
    content: 'hey bob, this is private',
    recipientPubkeyHex: bob.publicKeyHex,
    senderSecretKeyHex: alice.secretKeyHex,
  });

  assert.equal(wraps.length, 2);
  for (const wrap of wraps) {
    assert.equal(wrap.kind, GIFT_WRAP_KIND);
  }

  const [selfWrap, recipientWrap] = wraps;

  const rumorForBob = unwrapDirectMessage({ giftWrapEvent: recipientWrap, recipientSecretKeyHex: bob.secretKeyHex });
  assert.equal(rumorForBob.kind, PRIVATE_DM_KIND);
  assert.equal(rumorForBob.content, 'hey bob, this is private');
  assert.equal(rumorForBob.pubkey, alice.publicKeyHex);

  const rumorForAlice = unwrapDirectMessage({ giftWrapEvent: selfWrap, recipientSecretKeyHex: alice.secretKeyHex });
  assert.equal(rumorForAlice.content, 'hey bob, this is private');
  assert.equal(rumorForAlice.pubkey, alice.publicKeyHex);
});

test('gift-wrap events are not attributable to sender or recipient', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();

  const { wraps } = wrapDirectMessage({
    content: 'anonymized transport check',
    recipientPubkeyHex: bob.publicKeyHex,
    senderSecretKeyHex: alice.secretKeyHex,
  });

  for (const wrap of wraps) {
    assert.notEqual(wrap.pubkey, alice.publicKeyHex);
    assert.notEqual(wrap.pubkey, bob.publicKeyHex);
  }
});

test('unwrapDirectMessage throws when unwrapped with the wrong key', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const eve = generateIdentity();

  const { wraps } = wrapDirectMessage({
    content: 'for bob only',
    recipientPubkeyHex: bob.publicKeyHex,
    senderSecretKeyHex: alice.secretKeyHex,
  });
  const [, recipientWrap] = wraps;

  assert.throws(() => unwrapDirectMessage({ giftWrapEvent: recipientWrap, recipientSecretKeyHex: eve.secretKeyHex }));
});

test('wrapDirectMessage supports an optional conversation title and reply reference', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();

  const { wraps } = wrapDirectMessage({
    content: 'follow-up message',
    recipientPubkeyHex: bob.publicKeyHex,
    senderSecretKeyHex: alice.secretKeyHex,
    conversationTitle: 'Project sync',
    replyTo: { eventId: 'deadbeef'.repeat(8) },
  });
  const [, recipientWrap] = wraps;

  const rumor = unwrapDirectMessage({ giftWrapEvent: recipientWrap, recipientSecretKeyHex: bob.secretKeyHex });
  assert.ok(rumor.tags.some((tag) => tag[0] === 'subject' && tag[1] === 'Project sync'));
  assert.ok(rumor.tags.some((tag) => tag[0] === 'e' && tag[1] === 'deadbeef'.repeat(8)));
});

test('wrapDirectMessage rejects empty content or missing recipient', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();

  assert.throws(() =>
    wrapDirectMessage({ content: '   ', recipientPubkeyHex: bob.publicKeyHex, senderSecretKeyHex: alice.secretKeyHex }),
  );
  assert.throws(() =>
    wrapDirectMessage({ content: 'hi', recipientPubkeyHex: '', senderSecretKeyHex: alice.secretKeyHex }),
  );
});
