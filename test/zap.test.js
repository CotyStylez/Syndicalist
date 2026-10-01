import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey, kinds } from 'nostr-tools';
import { makeZapReceipt } from 'nostr-tools/nip57';
import { requestZapInvoice, resolveZapEndpoint, parseZapReceipt, ZAP_RECEIPT_KIND } from '../src/lib/zap.js';

test('resolveZapEndpoint rejects when there is no profile event', async () => {
  await assert.rejects(() => resolveZapEndpoint(null), /hasn't published a profile/);
});

test('resolveZapEndpoint rejects a profile without a usable lud16/lud06', async () => {
  const sk = generateSecretKey();
  const profileEvent = finalizeEvent({ kind: kinds.Metadata, content: JSON.stringify({ name: 'Ada' }), tags: [], created_at: 0 }, sk);
  await assert.rejects(() => resolveZapEndpoint(profileEvent), /Lightning address/);
});

test('requestZapInvoice rejects a non-positive sats amount', async () => {
  await assert.rejects(
    () => requestZapInvoice({ profileEvent: {}, recipientPubkeyHex: 'abc', amountSats: 0, relays: [], senderSecretKeyHex: 'aa'.repeat(32) }),
    /positive number of sats/,
  );
});

test('parseZapReceipt returns null for non-zap-receipt events', () => {
  assert.equal(parseZapReceipt(null), null);
  assert.equal(parseZapReceipt({ kind: kinds.ShortTextNote, tags: [] }), null);
});

test('parseZapReceipt returns null when the bolt11 tag is missing', () => {
  assert.equal(parseZapReceipt({ kind: ZAP_RECEIPT_KIND, tags: [] }), null);
});

test('parseZapReceipt extracts sats and the zapper pubkey from a well-formed receipt', () => {
  const zapperSecretKey = generateSecretKey();
  const zapperPubkey = getPublicKey(zapperSecretKey);
  const recipientSecretKey = generateSecretKey();
  const recipientPubkey = getPublicKey(recipientSecretKey);

  const zapRequest = finalizeEvent(
    {
      kind: kinds.ZapRequest,
      content: '',
      tags: [
        ['p', recipientPubkey],
        ['relays', 'wss://relay.example'],
        ['amount', '1000000'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    },
    zapperSecretKey,
  );

  // A 1000-sat bolt11-like invoice string recognized by
  // getSatoshisAmountFromBolt11 (lnbc<amount><unit>...).
  const bolt11 = 'lnbc1u1pexampleinvoicestring';

  const template = makeZapReceipt({
    zapRequest: JSON.stringify(zapRequest),
    bolt11,
    paidAt: new Date(),
  });
  const receiptEvent = finalizeEvent(template, recipientSecretKey);

  const parsed = parseZapReceipt(receiptEvent);
  assert.ok(parsed);
  assert.equal(parsed.zapperPubkey, zapperPubkey);
  assert.equal(typeof parsed.sats, 'number');
});
