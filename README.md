# sydacalist

A lean, privacy-first, **MySpace-inspired** social platform prototype for creators and high-risk users. No corporate data centers, no central login database, no ads, no tracking. Your identity lives in your browser as a cryptographic keypair, your data lives on your device first, and social features run over the open [Nostr](https://nostr.com/) protocol plus browser-to-browser [WebRTC](https://webrtc.org/).

> ⚠️ **Prototype status.** This is a first, honest pass at the product boundaries below — not a production-hardened app. See [Known limitations & future work](#known-limitations--future-work).

## What this is

Sydacalist is a single-page, browser-only app (no backend server) that lets you:

- Generate or import a **Nostr keypair** as your identity — no email, no password, no central account database.
- Post, like, repost, and comment on a **decentralized social feed** carried over public Nostr relays.
- **Follow people** by npub/hex, view a locally cached name for them, and switch the feed between **Global** and **Following-only** modes.
- Customize a **MySpace-style personal profile page** — theme colors, banner/avatar placeholders, and freeform widgets — and optionally publish it publicly.
- Send **end-to-end encrypted direct messages** (NIP-17 gift-wrapped DMs) that hide both content and metadata from relays.
- Keep **private notes** encrypted at rest as personal, single-user scratch space.
- Try a **peer-to-peer WebRTC demo** (data-channel chat + optional camera preview) with no signaling server required — exchange the connection setup via manual copy/paste, or deliver it as an encrypted direct message.
- Send **TikTok-style stickers** during a Live P2P session from a fully local, customizable **sticker library** (🎉 Stickers tab), and tip a host in real Bitcoin Lightning sats via **NIP-57 "zaps"** — no platform cut, no payment processor, no backend.
- Add plain external **"pay me however you like" links** (Cash App, Venmo, PayPal.me, anything) to your profile, for casual tipping outside the app entirely.

## How to run it

Requirements: Node.js 20+.

```bash
npm install
npm run dev       # start the local dev server (Vite)
```

Then open the printed `http://localhost:5173` URL in your browser.

Other useful commands:

```bash
npm run build      # produce a static production bundle in dist/
npm run preview    # preview the production build locally
npm test           # run the unit tests (Node's built-in test runner)
```

The production build in `dist/` is a fully static site — it can be hosted from any static file host (or opened locally) with no server-side code required.

## Architecture at a glance

```
src/
  lib/
    crypto.js     WebCrypto helpers (PBKDF2 + AES-GCM) for encrypting local data
    identity.js   Generate/import Nostr keypairs (nostr-tools), npub/nsec encoding
    storage.js    IndexedDB wrapper — the local-first persistence layer
    vault.js      Encrypted-at-rest storage built on crypto.js + storage.js
    relays.js     Nostr relay connections, publishing, and feed subscriptions
    dm.js         NIP-17 gift-wrapped direct-message encrypt/decrypt helpers
    webrtc.js     Manual-signaling WebRTC peer connection helper
    stickers.js   Local-first, user-customizable sticker/tip-pack library
    zap.js        NIP-57 "zap" (Lightning tip) invoice requests + receipt parsing
  state.js        Central in-memory app state + actions (no UI code)
  ui/             One render function per tab (Identity, Feed, People, Profile,
                  Messages, Private Notes, Live P2P, Stickers, Settings), plus
                  the app shell in ui/app.js
  utils/          Tiny DOM-building and formatting helpers (no framework)
test/             Unit tests for the pure-logic modules (crypto, identity,
                  storage, vault, DMs, WebRTC signaling)
```

There is no UI framework — views are built with a tiny `h()`/`mount()` DOM helper (`src/utils/dom.js`) and re-rendered imperatively. This keeps the dependency footprint minimal (`nostr-tools` is the only runtime dependency) while remaining easy to read end-to-end.

## Privacy & security model

**Public (safe to share, visible to anyone on the relays you use):**
- Your `npub` (public key).
- Notes, likes, reposts, and comments you publish.
- Your follow list, if you publish one.
- Profile metadata (display name, bio, styling, Lightning address) — only if you click "Save & publish to Nostr".
- Zap receipts (NIP-57) — a tip you send or receive is, by design, a public, verifiable payment proof on the relays, not private data.

**Private, encrypted at rest in this browser:**
- Your `nsec` (private key) — sealed with AES-GCM using a key derived from your unlock passphrase via PBKDF2 (210,000 iterations, SHA-256). See `src/lib/crypto.js` and `src/lib/vault.js`.
- Your private notes — encrypted the same way, decrypted only in memory while unlocked.

**Local-only, never transmitted anywhere:**
- Draft posts, your relay list, and UI preferences — stored in IndexedDB (`src/lib/storage.js`).
- The cached feed of recently seen posts, so the app has something to show offline.
- Your sticker packs/artwork (emoji, SVG, or image stickers you create) — local by default; only lightweight sticker data is shared peer-to-peer during a live session with whoever you're directly connected to, never uploaded anywhere.

**What Sydacalist deliberately does *not* do:**
- No central account database — there is nothing to breach or subpoena on our end, because there is no "our end".
- No analytics, telemetry, or third-party tracking scripts.
- No ads or algorithmic ad ranking.
- Your passphrase is never stored or transmitted — if you lose it, the encrypted vault cannot be recovered. Back up your `nsec` somewhere safe (e.g. written down offline) if you want a way back in.

A "Panic wipe" button (Settings tab) permanently deletes all local app data from the browser in one click.

## Local-first storage

All app state — identity vault, profile, relay list, drafts, preferences, follow list, cached profile names, and cached feed — lives in **IndexedDB** in your browser (see `src/lib/storage.js`). The app reads this on startup and works fully offline once loaded (aside from live relay/P2P connectivity, which naturally needs a network). There is no central backend database; the browser *is* the database.

## Nostr-powered social features

- Connect to a configurable list of public Nostr relays over WebSockets (Settings tab). Reasonable defaults are pre-filled, and connection status (connecting/connected/disconnected) is shown per relay.
- Publish signed text notes (kind 1), likes/reactions (kind 7), reposts (kind 6), comments (kind 1 replies), and a follow list (kind 3) — see `src/lib/relays.js`.
- Subscribe to a basic feed of recent notes/reactions/reposts from your configured relays.
- Relay disconnects are handled gracefully: the UI shows per-relay status and the app keeps working with whatever relays remain reachable.
- **Follows & discovery (People tab):** look someone up by npub or hex pubkey to fetch their published profile metadata (kind 0) and follow them; your follow list is stored locally and, once your identity is unlocked, republished as a Nostr contact list (kind 3) whenever it changes, so it's portable to other Nostr clients too. You can also follow/unfollow directly from an author's name in the Feed tab.
- **Feed modes:** toggle the Feed tab between 🌐 Global (everyone on your configured relays) and 👥 Following (only people you follow) — this is the `feedMode` preference, persisted locally.

## Customizable profile

The Profile tab is the MySpace-inspired centerpiece: pick a theme color, accent/background color, layout (classic/grid/minimal), banner and avatar emoji placeholders, and freeform widgets (e.g. "Now Playing", "Top Friends"). Changes are saved locally by default; "Save & publish to Nostr" additionally broadcasts your display name, bio, styling, and Lightning address (if set) as public Nostr profile metadata (kind 0). You can also add any number of plain **external pay links** (Cash App `$cashtag`, Venmo handle, PayPal.me, etc.) — these are just clickable buttons; the app never integrates with those services' APIs, never sees whether they were paid, and never touches that money.

## Tipping & stickers (no platform cut, no data center)

Real-money tip integrations like Cash App or Venmo don't offer a public API for third-party apps to plug into, and a backend-free app has no way to custody or convert currency responsibly anyway. Instead, Sydacalist supports two non-custodial ways to tip a creator, both staying true to "no central server":

1. **Plain pay links (casual, zero integration).** Add a Cash App/Venmo/PayPal.me/anything link to your profile (see above). A viewer clicks it and pays you however they like — the app is not involved beyond displaying the link.
2. **Tip stickers via NIP-57 "zaps" (real-time, verifiable, in-app).** In the 🎉 Stickers tab, build a local sticker library — emoji, pasted SVG markup, or uploaded images, each stored only in your browser — and optionally assign a sats price to any sticker to make it a tip sticker. During a Live P2P session (📡 Live P2P tab):
   - The host shares their `npub`; a viewer enters it once in the "💸 Tip the host" card.
   - Tapping a sticker sends it instantly over the WebRTC data channel (an animated "burst," TikTok-style) to the other peer, and — if it has a sats price — requests a Lightning invoice directly from the host's own Lightning address (`lud16`, set in their Profile) via the host's own wallet/LNURL provider.
   - If the viewer has a WebLN-compatible wallet extension (e.g. Alby) installed, the invoice is paid automatically; otherwise the invoice is shown as text for payment from any Lightning wallet (phone app, QR, etc.).
   - Once paid, the **zap receipt** — a public, verifiable payment-proof event — arrives over the same Nostr relays the app already uses, and shows up as a confirmed "⚡ X sats received" line, distinct from the (unconfirmed) sticker burst animation itself.

No part of this flow runs through a server this app operates: the sticker art lives in your browser, the invoice comes from the host's own Lightning address, the payment moves wallet-to-wallet over the Lightning Network, and the only "database" involved is the same public, decentralized relay network already used for posts and DMs.

## Encryption

- **Identity:** your `nsec` is never stored in plaintext. It's sealed into an encrypted envelope (AES-GCM + PBKDF2) under your unlock passphrase before it ever touches IndexedDB.
- **Private notes:** encrypted the same way as identity, and clearly separated in the UI from public posts. Purely single-user scratch space (not sent anywhere).
- **Direct messages (implemented via NIP-17):** the 💬 Messages tab sends real end-to-end encrypted DMs using Nostr's NIP-17 (sealed & gift-wrapped direct messages, built on NIP-44 encryption and NIP-59 gift-wrapping, via `nostr-tools`). Both the message content **and** metadata (real sender, timestamps) are hidden inside a "rumor" that's sealed and then wrapped in a throwaway-keyed "gift wrap" event — relays and outside observers only ever see an anonymous wrapper, not who is messaging whom. Decrypted DM history is additionally encrypted at rest locally using the same passphrase-protected vault as your identity key and private notes — lock your identity (or lose the passphrase) and local DM history becomes inaccessible again until unlock.

## WebRTC / live features

The "Live P2P" tab demonstrates a direct browser-to-browser connection:

1. One person picks **Initiator**, clicks **Create offer**, and either copies the resulting text blob to the other person (chat, email, anything) or clicks **📨 Send this offer via Messages** to deliver it as an encrypted NIP-17 direct message if they know the other person's npub/hex.
2. The other person picks **Responder** and pastes the offer (or, if it arrived via Messages, opens it from their 💬 Messages tab with one click, which jumps here with the offer pre-filled), then clicks **Create answer** and sends the resulting blob back the same way (copy/paste or via Messages).
3. The initiator pastes (or receives via Messages) that answer and clicks **Apply answer** to complete the handshake.
4. Once connected, both sides can chat over the WebRTC data channel. An optional "Enable camera & mic" button attaches local video/audio and previews the remote stream if the other peer also enables theirs.

This uses only a public STUN server for NAT traversal and requires no custom signaling or media server. Signaling itself (the offer/answer exchange) can now ride the same encrypted, decentralized DM transport as the Messages tab instead of requiring manual copy/paste — though copy/paste remains available and is the most reliable fallback. (Note: some networks — especially symmetric NATs or heavily firewalled corporate/CI networks — will prevent a direct connection from establishing even once signaling succeeds; a future version could add a TURN relay option.)

## Known limitations & future work

This is intentionally a first pass. Notable gaps, by design:

- **No TURN relay** — WebRTC connections can fail on restrictive networks even after successful signaling. A future version could offer an optional TURN server.
- **Nostr-based signaling is one-shot, not automatic** — sending a WebRTC offer/answer via Messages still requires a manual button click on each side; there's no fully automated call-setup flow (e.g. incoming-call notifications) yet.
- **DM delivery caveats** — NIP-17 gift-wrap (kind 1059) events are not yet universally supported/retained by all public relays, so delivery isn't guaranteed on every relay; there are no delivery or read receipts; DM history only syncs to a second device/browser if that device's relays still have the original gift-wrap events (relays may not retain them indefinitely); and this first pass supports 1:1 conversations only (no group DMs).
- **No media/IPFS storage** — image/video attachments and distributed media storage (IPFS/Hypercore) are out of scope for this iteration.
- **Simple feed ranking** — within Global or Following mode, the feed is reverse-chronological; there's no client-side interest ranking, muting, or spam filtering yet.
- **No mobile app** — this is a browser-only prototype.
- **No moderation tooling** — beyond what relays themselves provide.
- **Zaps require a Lightning wallet on both sides** — a host needs a Lightning address (`lud16`) and a viewer needs some Lightning wallet (a WebLN browser extension for one-click payment, or any phone wallet for manual payment). This is real friction compared to "everyone already has Cash App," accepted deliberately to avoid any backend/payment-processor dependency.
- **Shared sticker packs during a live session aren't verified/moderated** — a host's pack is only as trustworthy as the host; there's no sticker marketplace, approval flow, or abuse reporting yet.
- **Tip stickers vs. confirmed zaps are visually distinct but not auto-reconciled** — the sticker "burst" animation fires immediately on tap (so it feels responsive), while the ⚡ confirmed-sats line only appears once a zap receipt arrives; the UI doesn't yet automatically match a specific sticker tap to its corresponding receipt.

## Tech stack

- [Vite](https://vitejs.dev/) for the dev server and static production build.
- [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) for Nostr keys, event signing, and relay pooling — the only runtime dependency.
- Vanilla JavaScript (no UI framework), the Web Crypto API, IndexedDB, WebSockets, and WebRTC — all native browser APIs.

