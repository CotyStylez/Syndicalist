import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal } from '../src/lib/webrtc.js';

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
