import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RELAYS,
  isVisibleEvent,
  normalizeRelayUrl,
  normalizeSettings,
  parseSettings,
  serializeSettings,
} from "../src/lib/settings.js";

test("accepts secure relay URLs and normalizes their trailing slash", () => {
  assert.equal(normalizeRelayUrl(" wss://relay.example/ "), "wss://relay.example");
});

test("rejects insecure, credentialed, and parameterized relay URLs", () => {
  assert.equal(normalizeRelayUrl("ws://relay.example"), null);
  assert.equal(normalizeRelayUrl("******relay.example"), null);
  assert.equal(normalizeRelayUrl("wss://relay.example?token=secret"), null);
  assert.equal(normalizeRelayUrl("not a url"), null);
});

test("normalizes relay settings, muted words, and public keys", () => {
  const normalized = normalizeSettings({
    relays: ["wss://relay.example", "wss://relay.example/"],
    mutedWords: "Spoiler\nspoiler\n",
    blockedAuthors: "A".repeat(64),
  });
  assert.deepEqual(normalized.relays, ["wss://relay.example"]);
  assert.deepEqual(normalized.mutedWords, ["Spoiler", "spoiler"]);
  assert.deepEqual(normalized.blockedAuthors, ["a".repeat(64)]);
  assert.throws(() => normalizeSettings({
    relays: ["wss://relay.example"],
    blockedAuthors: "invalid",
  }), /64-character hexadecimal/);
});

test("rejects empty or excessive relay configurations", () => {
  assert.throws(() => normalizeSettings({ relays: [] }), /at least one/);
  assert.throws(() => normalizeSettings({ relays: Array(11).fill(DEFAULT_RELAYS[0]) }), /no more than 10/);
});

test("settings round-trip and invalid imports fail explicitly", () => {
  const settings = normalizeSettings({
    relays: [DEFAULT_RELAYS[0]],
    mutedWords: ["breaking"],
    blockedAuthors: ["b".repeat(64)],
  });
  assert.deepEqual(parseSettings(serializeSettings(settings)), settings);
  assert.throws(() => parseSettings("{"), /valid JSON/);
  assert.throws(() => parseSettings('{"relays":["http://relay.example"]}'), /wss:\/\/ URL/);
});

test("local filters hide blocked authors and matching words only", () => {
  const author = "c".repeat(64);
  const settings = normalizeSettings({
    relays: [DEFAULT_RELAYS[0]],
    mutedWords: ["spoiler"],
    blockedAuthors: [author],
  });
  assert.equal(isVisibleEvent({ pubkey: author, content: "ordinary post" }, settings), false);
  assert.equal(isVisibleEvent({ pubkey: "d".repeat(64), content: "contains SPOILER" }, settings), false);
  assert.equal(isVisibleEvent({ pubkey: "d".repeat(64), content: "ordinary post" }, settings), true);
});
