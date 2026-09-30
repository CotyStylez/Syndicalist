import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal, encodeSignalMessage, decodeSignalMessage } from '../src/lib/webrtc.js';

test('encodeSignal/decodeSignal roundtrips an SDP-like description', () => {
  const description = { type: 'offer', sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n...' };
  const encoded = encodeSignal(description);
  assert.equal(typeof encoded, 'string');
  // Must be safe to copy/paste as plain text (base64 alphabet only).
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);

  const decoded = decodeSignal(encoded);
  assert.deepEqual(decoded, description);
});

test('decodeSignal trims surrounding whitespace from pasted text', () => {
  const description = { type: 'answer', sdp: 'v=0\r\n...' };
  const encoded = encodeSignal(description);
  const decoded = decodeSignal(`  ${encoded}\n`);
  assert.deepEqual(decoded, description);
});

test('encodeSignalMessage/decodeSignalMessage roundtrips an offer blob for DM delivery', () => {
  const blob = encodeSignal({ type: 'offer', sdp: 'v=0\r\n...' });
  const envelope = encodeSignalMessage('offer', blob);
  assert.equal(typeof envelope, 'string');

  const decoded = decodeSignalMessage(envelope);
  assert.deepEqual(decoded, { kind: 'offer', blob });
});

test('encodeSignalMessage/decodeSignalMessage roundtrips an answer blob', () => {
  const blob = encodeSignal({ type: 'answer', sdp: 'v=0\r\n...' });
  const envelope = encodeSignalMessage('answer', blob);
  assert.deepEqual(decodeSignalMessage(envelope), { kind: 'answer', blob });
});

test('decodeSignalMessage returns null for an ordinary chat message', () => {
  assert.equal(decodeSignalMessage('Hey, how are you?'), null);
  assert.equal(decodeSignalMessage(''), null);
  assert.equal(decodeSignalMessage(undefined), null);
});

test('decodeSignalMessage rejects a malformed envelope with our prefix but broken JSON', () => {
  assert.equal(decodeSignalMessage('sydacalist-webrtc-signal:v1:{not json'), null);
});

test('decodeSignalMessage rejects an envelope with an unrecognized kind', () => {
  const fake = 'sydacalist-webrtc-signal:v1:' + JSON.stringify({ kind: 'bogus', blob: 'abc' });
  assert.equal(decodeSignalMessage(fake), null);
});
