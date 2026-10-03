export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

export const MAX_RELAYS = 10;
export const MAX_FILTER_ENTRIES = 50;
export const SETTINGS_KEY = "static.settings.v1";

export function normalizeRelayUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "wss:"
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null;

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings must be a JSON object.");
  }

  if (!Array.isArray(input.relays) || input.relays.length === 0) {
    throw new Error("Add at least one secure relay URL.");
  }

  if (input.relays.length > MAX_RELAYS) {
    throw new Error(`Choose no more than ${MAX_RELAYS} relays.`);
  }

  const relays = [...new Set(input.relays.map(normalizeRelayUrl))];
  if (relays.includes(null) || relays.length === 0) {
    throw new Error("Every relay must be a valid wss:// URL without credentials.");
  }

  return {
    relays,
    mutedWords: normalizeLines(input.mutedWords, MAX_FILTER_ENTRIES, "Muted words"),
    blockedAuthors: normalizeLines(input.blockedAuthors, MAX_FILTER_ENTRIES, "Blocked authors")
      .filter((key) => /^[0-9a-f]{64}$/i.test(key))
      .map((key) => key.toLowerCase()),
  };
}

export function normalizeLines(value, limit, label) {
  if (value == null) return [];
  if (!Array.isArray(value) && typeof value !== "string") {
    throw new Error(`${label} must be a list or newline-separated text.`);
  }

  const lines = (Array.isArray(value) ? value : value.split(/\r?\n/))
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (lines.length > limit) throw new Error(`Use no more than ${limit} ${label.toLowerCase()}.`);
  return [...new Set(lines)];
}

export function serializeSettings(settings) {
  return JSON.stringify(normalizeSettings(settings), null, 2);
}

export function parseSettings(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  return normalizeSettings(parsed);
}

export function isVisibleEvent(event, settings) {
  if (!event || !/^[0-9a-f]{64}$/i.test(event.pubkey ?? "")) return false;
  if (settings.blockedAuthors.includes(event.pubkey.toLowerCase())) return false;
  const content = typeof event.content === "string" ? event.content : "";
  const normalizedContent = content.toLocaleLowerCase();
  return !settings.mutedWords.some((word) => normalizedContent.includes(word.toLocaleLowerCase()));
}
