// NIP-57 "Zaps" — Lightning-backed tipping over Nostr.
//
// A zap never touches this app's servers because this app has none: the
// amount is requested directly from the recipient's own Lightning address
// (their `lud16`, resolved to an LNURL-pay endpoint they control), the
// invoice is paid by whichever Lightning wallet the *tipper* already uses
// (a WebLN browser extension, or manually via a copy/paste-able invoice),
// and the only thing that comes back over Nostr relays is a public "zap
// receipt" event proving the payment happened. No custody, no balance, no
// currency conversion — this module only requests invoices and recognizes
// receipts.

import { getZapEndpoint, makeZapRequest, getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { finalizeEvent, kinds } from 'nostr-tools';
import { secretKeyFromHex } from './identity.js';

export const ZAP_REQUEST_KIND = kinds.ZapRequest; // 9734
export const ZAP_RECEIPT_KIND = kinds.Zap; // 9735

/**
 * Resolves a profile's Lightning address/LNURL callback. `profileEvent`
 * must be the raw kind-0 Nostr event (its JSON `content` is expected to
 * contain `lud16` or `lud06`) — see lib/relays.js#fetchProfileMetadata,
 * which keeps the original `_event` around for exactly this purpose.
 */
export async function resolveZapEndpoint(profileEvent) {
  if (!profileEvent) throw new Error("This host hasn't published a profile yet.");
  const endpoint = await getZapEndpoint(profileEvent);
  if (!endpoint) throw new Error("This host hasn't set up a Lightning address (lud16) for zaps yet.");
  return endpoint;
}

/**
 * Builds and requests a Lightning invoice for a zap. Returns the bolt11
 * invoice string (for the tipper's wallet, or a QR/copy box) plus the
 * signed zap request event that was sent alongside it, so the UI can match
 * up the eventual zap receipt.
 */
export async function requestZapInvoice({
  profileEvent,
  recipientPubkeyHex,
  amountSats,
  comment = '',
  relays,
  senderSecretKeyHex,
}) {
  if (!amountSats || amountSats <= 0) throw new Error('Zap amount must be a positive number of sats.');
  const endpoint = await resolveZapEndpoint(profileEvent);

  const secretKey = secretKeyFromHex(senderSecretKeyHex);
  const template = makeZapRequest({
    pubkey: recipientPubkeyHex,
    amount: Math.round(amountSats * 1000), // millisats
    comment,
    relays,
  });
  const zapRequestEvent = finalizeEvent(template, secretKey);

  const url = new URL(endpoint);
  url.searchParams.set('amount', String(Math.round(amountSats * 1000)));
  url.searchParams.set('nostr', JSON.stringify(zapRequestEvent));

  const response = await fetch(url.toString());
  const payload = await response.json();
  if (payload.status === 'ERROR' || !payload.pr) {
    throw new Error(payload.reason || 'The Lightning wallet rejected the invoice request.');
  }
  return { invoice: payload.pr, zapRequestEvent };
}

/** Attempts to pay a bolt11 invoice via a WebLN-compatible browser
 * extension (e.g. Alby), if one is present. Returns `true` on success,
 * `false` if no WebLN provider is available (the UI should then fall back
 * to showing the invoice for manual payment). */
export async function tryPayWithWebLn(invoice) {
  if (typeof window === 'undefined' || !window.webln) return false;
  await window.webln.enable();
  await window.webln.sendPayment(invoice);
  return true;
}

/** Parses a zap receipt event (kind 9735) into a friendly summary, or
 * returns `null` if it isn't a well-formed receipt. */
export function parseZapReceipt(event) {
  if (!event || event.kind !== ZAP_RECEIPT_KIND) return null;
  const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11');
  const descriptionTag = event.tags.find((t) => t[0] === 'description');
  if (!bolt11Tag) return null;
  let sats = 0;
  try {
    sats = getSatoshisAmountFromBolt11(bolt11Tag[1]);
  } catch {
    sats = 0;
  }
  let zapperPubkey = null;
  if (descriptionTag) {
    try {
      zapperPubkey = JSON.parse(descriptionTag[1]).pubkey || null;
    } catch {
      zapperPubkey = null;
    }
  }
  return { id: event.id, sats, zapperPubkey, createdAt: event.created_at };
}
