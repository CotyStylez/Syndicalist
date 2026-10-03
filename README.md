# Static

Static is a small, browser-only prototype for community-oriented public publishing. It uses Nostr kind-1 events so compatible clients can read the posts, and lets people choose the relays that deliver their feed. There is no Static server, account database, or ranking algorithm in this prototype.

## Try it

Serve the repository directory over HTTP (for example, `python3 -m http.server 4173`) and open `http://localhost:4173`. A browser extension that implements NIP-07 is required to sign and publish posts. Static never asks for or stores private keys.

Configure secure `wss://` relays in **Make it yours**. The defaults are suggestions, not trusted or endorsed providers. Relays can observe your connection, public key, requested feed, and publication time; they can reject or remove posts. Refresh the page or select other relays if a relay becomes unavailable.

Run the built-in tests with:

```sh
npm test
```

## Prototype boundaries

- **Public only:** kind-1 posts are public, copyable, and cannot be recalled. This is not a private messaging or secure-source tool. Relay operators may retain and correlate metadata. Do not treat it as anonymous.
- **Local control:** relay choices, muted words, and blocked public keys are stored in this browser. Filters only change your own feed; they do not change relay behavior. Export/import carries settings only, never posts or signing keys.
- **Independent but not infrastructure-free:** users can choose relays, and relays can be operated by different communities. This prototype still depends on network-connected relay servers and compatible clients; it does not provide peer-to-peer replication or guarantee availability without hosted infrastructure.
- **Portable, with limits:** events use the open Nostr format and can be read by Nostr-compatible clients. ActivityPub/Mastodon federation, account migration tooling, follows, and community moderation protocols are not implemented. Bridging protocols needs explicit design and privacy review.
- **No central feed ranking:** events are presented newest-first and filtered locally. There is no engagement-ranking or recommendation system.

## Next steps

The prototype is a starting point, not a complete social network. Work with advocates, journalists, and other creators to threat-model public posting and metadata exposure; test relay reliability and moderation practices; develop transparent community governance and portable moderation lists; and investigate ActivityPub interoperability and peer-to-peer delivery before making claims about those capabilities.
