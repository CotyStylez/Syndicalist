# sydacalist

A small proof of concept for a decentralized, privacy-first social experience using Nostr and WebRTC. This is an experiment, not a production-ready service or a security tool.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access and clipboard access require a secure context; `localhost` is treated as secure by modern browsers. To check the production bundle:

```sh
npm test
npm run build
npm run preview
```

## What is included

- **Nostr identity:** Generate a key in the browser or import an `nsec`/64-character hex private key. The public key is shown as `npub`. The secret is held only in JavaScript memory for the current tab; it is not saved to browser storage. Use **Reveal export key** only when you explicitly need to export it. Reloading or closing the tab clears the in-memory key.
- **Nostr notes:** Connect to secure `wss://` relays, receive recent public kind-1 notes, and publish signed kind-1 notes. Relay connections reconnect with backoff after transient drops. Nostr notes and public keys are public protocol data; relays can observe your IP address, connection times, subscriptions, and posts.
- **WebRTC peer connection:** Create an offer, exchange the JSON manually, create an answer, and apply it on the offerer. The data channel supports live text messages. Camera and microphone sharing is optional and permission-based; prepare the camera before generating signaling data. Signaling is never sent by this app to a server.

## Architecture

This is a static Vite app with no application backend, database, analytics, or advertising code. `src/identity.js` handles Nostr key generation/import with `nostr-tools`; `src/main.js` owns the browser UI, relay WebSockets, signed events, and manual WebRTC signaling. All user-provided relay content is rendered as text rather than HTML.

The peer connection uses WebRTC's encrypted DTLS transport and a public Google STUN service to help peers discover a route. STUN is third-party infrastructure and can observe requests; some networks require a TURN relay, which is not provided. Signaling data may contain network candidates and should only be shared with a trusted peer over a channel you trust.

## Privacy and limitations

This project does not provide anonymity, metadata protection, end-to-end encrypted Nostr direct messages, key recovery, persistent encrypted storage, moderation, or decentralized signaling. Public relays are independently operated and may log or filter traffic. WebRTC can expose network information to the peer and STUN service; direct connections are not guaranteed, and video/data may not connect behind restrictive NATs without TURN. Do not use this prototype for sensitive communications or rely on it for personal safety.

Use a secure browser context and a device you trust. Protect exported private keys as credentials; anyone who obtains one can control that Nostr identity. Future work could explore safer key custody, encrypted messaging, distributed media storage, and privacy-preserving relay discovery.

## License

MIT. See [LICENSE](LICENSE).
