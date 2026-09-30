# sydacalist

A lean, privacy-first, **MySpace-inspired** social platform prototype for creators and high-risk users. No corporate data centers, no central login database, no ads, no tracking. Your identity lives in your browser as a cryptographic keypair, your data lives on your device first, and social features run over the open [Nostr](https://nostr.com/) protocol plus browser-to-browser [WebRTC](https://webrtc.org/).

> ⚠️ **Prototype status.** This is a first, honest pass at the product boundaries below — not a production-hardened app. See [Known limitations & future work](#known-limitations--future-work).

## What this is

Sydacalist is a single-page, browser-only app (no backend server) that lets you:

- Generate or import a **Nostr keypair** as your identity — no email, no password, no central account database.
- Post, like, repost, and comment on a **decentralized social feed** carried over public Nostr relays.
- **Follow people** by npub/hex, view a locally cached name for them, and switch the feed between **Global** and **Following-only** modes.
- Customize a **MySpace-style personal profile page** — theme colors, banner/avatar placeholders, and freeform widgets — and optionally publish it publicly.
- Keep **private notes** encrypted at rest, as a placeholder for future end-to-end encrypted messaging.
- Try a **peer-to-peer WebRTC demo** (data-channel chat + optional camera preview) using manual copy/paste signaling, with no signaling server required.

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
    webrtc.js     Manual-signaling WebRTC peer connection helper
  state.js        Central in-memory app state + actions (no UI code)
  ui/             One render function per tab (Identity, Feed, People, Profile,
                  Private Notes, Live P2P, Settings), plus the app shell in ui/app.js
  utils/          Tiny DOM-building and formatting helpers (no framework)
test/             Unit tests for the pure-logic modules (crypto, identity,
                  storage, vault, WebRTC signaling)
```

There is no UI framework — views are built with a tiny `h()`/`mount()` DOM helper (`src/utils/dom.js`) and re-rendered imperatively. This keeps the dependency footprint minimal (`nostr-tools` is the only runtime dependency) while remaining easy to read end-to-end.

## Privacy & security model

**Public (safe to share, visible to anyone on the relays you use):**
- Your `npub` (public key).
- Notes, likes, reposts, and comments you publish.
- Your follow list, if you publish one.
- Profile metadata (display name, bio, styling) — only if you click "Save & publish to Nostr".

**Private, encrypted at rest in this browser:**
- Your `nsec` (private key) — sealed with AES-GCM using a key derived from your unlock passphrase via PBKDF2 (210,000 iterations, SHA-256). See `src/lib/crypto.js` and `src/lib/vault.js`.
- Your private notes — encrypted the same way, decrypted only in memory while unlocked.

**Local-only, never transmitted anywhere:**
- Draft posts, your relay list, and UI preferences — stored in IndexedDB (`src/lib/storage.js`).
- The cached feed of recently seen posts, so the app has something to show offline.

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

The Profile tab is the MySpace-inspired centerpiece: pick a theme color, accent/background color, layout (classic/grid/minimal), banner and avatar emoji placeholders, and freeform widgets (e.g. "Now Playing", "Top Friends"). Changes are saved locally by default; "Save & publish to Nostr" additionally broadcasts your display name, bio, and styling as public Nostr profile metadata (kind 0).

## Encryption

- **Identity:** your `nsec` is never stored in plaintext. It's sealed into an encrypted envelope (AES-GCM + PBKDF2) under your unlock passphrase before it ever touches IndexedDB.
- **Private notes:** encrypted the same way as identity, and clearly separated in the UI from public posts.
- **DMs (scaffolded, not implemented):** the Private Notes tab exists as an explicit placeholder for private/DM-style content and uses the same encrypted-vault primitives that a real DM feature would need. Wiring up an actual transport (e.g. Nostr NIP-17/NIP-44 sealed DMs, or a WebRTC data channel) is future work — see below.

## WebRTC / live features

The "Live P2P" tab demonstrates a direct browser-to-browser connection:

1. One person picks **Initiator**, clicks **Create offer**, and copies the resulting text blob to the other person (chat, email, anything).
2. The other person picks **Responder**, pastes the offer, clicks **Create answer**, and sends the resulting blob back.
3. The initiator pastes that answer and clicks **Apply answer** to complete the handshake.
4. Once connected, both sides can chat over the WebRTC data channel. An optional "Enable camera & mic" button attaches local video/audio and previews the remote stream if the other peer also enables theirs.

This uses only a public STUN server for NAT traversal and requires no custom signaling or media server. (Note: some networks — especially symmetric NATs or heavily firewalled corporate/CI networks — will prevent a direct connection from establishing; a future version could add a TURN relay option or decentralized signaling over Nostr DMs.)

## Known limitations & future work

This is intentionally a first pass. Notable gaps, by design:

- **No TURN relay** — WebRTC connections can fail on restrictive networks. A future version could offer an optional TURN server or fall back to relaying data over Nostr.
- **No decentralized signaling** — WebRTC signaling is manual copy/paste for now; automating it (e.g. over Nostr DMs) is a natural next step.
- **No E2EE DMs yet** — Private Notes are encrypted at rest but not yet sent to anyone; real DMs need a NIP-17/NIP-44-style transport.
- **No media/IPFS storage** — image/video attachments and distributed media storage (IPFS/Hypercore) are out of scope for this iteration.
- **Simple feed ranking** — within Global or Following mode, the feed is reverse-chronological; there's no client-side interest ranking, muting, or spam filtering yet.
- **No mobile app** — this is a browser-only prototype.
- **No moderation tooling** — beyond what relays themselves provide.

## Tech stack

- [Vite](https://vitejs.dev/) for the dev server and static production build.
- [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) for Nostr keys, event signing, and relay pooling — the only runtime dependency.
- Vanilla JavaScript (no UI framework), the Web Crypto API, IndexedDB, WebSockets, and WebRTC — all native browser APIs.

