import {
  DEFAULT_RELAYS,
  SETTINGS_KEY,
  isVisibleEvent,
  normalizeSettings,
  parseSettings,
  serializeSettings,
} from "./lib/settings.js";
import { RelayPool } from "./lib/relayPool.js";

const elements = {
  identityButton: document.querySelector("#identity-button"),
  identityLabel: document.querySelector("#identity-label"),
  postForm: document.querySelector("#post-form"),
  postContent: document.querySelector("#post-content"),
  characterCount: document.querySelector("#character-count"),
  publishStatus: document.querySelector("#publish-status"),
  feed: document.querySelector("#feed"),
  feedStatus: document.querySelector("#feed-status"),
  refreshButton: document.querySelector("#refresh-button"),
  settingsForm: document.querySelector("#settings-form"),
  relayList: document.querySelector("#relay-list"),
  mutedWords: document.querySelector("#muted-words"),
  blockedAuthors: document.querySelector("#blocked-authors"),
  settingsStatus: document.querySelector("#settings-status"),
  exportButton: document.querySelector("#export-button"),
  importFile: document.querySelector("#import-file"),
};

let signerPubkey = null;
let pool = null;
let settings = loadSettings();
const events = new Map();

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return normalizeSettings(JSON.parse(saved));
  } catch (error) {
    console.warn("Could not load saved settings:", error);
  }
  return normalizeSettings({
    relays: DEFAULT_RELAYS,
    mutedWords: [],
    blockedAuthors: [],
  });
}

function showStatus(element, message, kind = "") {
  element.textContent = message;
  if (kind) element.dataset.kind = kind;
  else delete element.dataset.kind;
}

function renderSettings() {
  elements.relayList.value = settings.relays.join("\n");
  elements.mutedWords.value = settings.mutedWords.join("\n");
  elements.blockedAuthors.value = settings.blockedAuthors.join("\n");
}

function shorten(value) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function renderFeed() {
  elements.feed.replaceChildren();
  const visible = [...events.values()]
    .filter((event) => isVisibleEvent(event, settings))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 80);

  if (!visible.length) {
    elements.feedStatus.textContent = "No posts to show yet. Connect to relays or try changing your local filters.";
    return;
  }
  elements.feedStatus.textContent = `${visible.length} public ${visible.length === 1 ? "post" : "posts"} · newest first`;

  for (const event of visible) {
    const item = document.createElement("li");
    item.className = "post";
    const meta = document.createElement("div");
    meta.className = "post-meta";
    const author = document.createElement("span");
    author.className = "post-author";
    author.textContent = shorten(event.pubkey);
    const date = document.createElement("time");
    const timestamp = Number(event.created_at) * 1000;
    const dateValue = new Date(timestamp);
    const validDate = Number.isFinite(dateValue.valueOf());
    date.dateTime = validDate ? dateValue.toISOString() : "";
    date.textContent = validDate ? dateValue.toLocaleString() : "Unknown time";
    meta.append(author, date);

    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = event.content;
    const id = document.createElement("code");
    id.className = "post-id";
    id.textContent = `event ${event.id}`;
    item.append(meta, content, id);
    elements.feed.append(item);
  }
}

async function startFeed() {
  pool?.close();
  pool = new RelayPool((event) => {
    if (!events.has(event.id)) events.set(event.id, event);
    renderFeed();
  }, (message) => {
    elements.feedStatus.textContent = message;
  });
  events.clear();
  renderFeed();
  const connected = await pool.connect(settings.relays);
  if (!connected) {
    showStatus(elements.feedStatus, "Could not connect to the selected relays. Refresh or choose other relays.", "error");
  } else {
    showStatus(elements.feedStatus, `Connected to ${connected} ${connected === 1 ? "relay" : "relays"}; waiting for public posts.`);
  }
}

async function connectSigner() {
  if (!window.nostr?.getPublicKey) {
    showStatus(elements.publishStatus, "No NIP-07 signer found. Install a trusted browser signer; Static never asks for your private key.", "error");
    return;
  }
  try {
    signerPubkey = await window.nostr.getPublicKey();
    if (!/^[0-9a-f]{64}$/i.test(signerPubkey)) throw new Error("Signer returned an invalid public key.");
    elements.identityLabel.textContent = `Connected · ${shorten(signerPubkey)}`;
    elements.identityButton.textContent = "Signer connected";
    showStatus(elements.publishStatus, "Signer connected. Your private key remains with the signer.", "success");
  } catch (error) {
    showStatus(elements.publishStatus, error.message || "Could not connect to the signer.", "error");
  }
}

function validSignedEvent(event, content) {
  return event
    && event.kind === 1
    && event.content === content
    && typeof event.id === "string"
    && /^[0-9a-f]{64}$/i.test(event.id)
    && typeof event.sig === "string"
    && /^[0-9a-f]{128}$/i.test(event.sig);
}

async function publishPost(formEvent) {
  formEvent.preventDefault();
  const content = elements.postContent.value.trim();
  if (!content) return;
  if (!signerPubkey || !window.nostr?.signEvent) {
    showStatus(elements.publishStatus, "Connect a NIP-07 signer before publishing.", "error");
    return;
  }

  const submit = elements.postForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  showStatus(elements.publishStatus, "Requesting a public-post signature…");
  try {
    const event = await window.nostr.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    });
    if (
      !validSignedEvent(event, content)
      || event.pubkey?.toLowerCase() !== signerPubkey.toLowerCase()
    ) {
      throw new Error("Signer returned an unexpected event. Nothing was published.");
    }
    const acknowledgements = await pool.publish(event);
    if (acknowledgements.length) {
      elements.postContent.value = "";
      updateCharacterCount();
      showStatus(
        elements.publishStatus,
        `Accepted by ${acknowledgements.length} ${acknowledgements.length === 1 ? "relay" : "relays"}. This public post may be copied and cannot be recalled.`,
        "success",
      );
    }
  } catch (error) {
    showStatus(elements.publishStatus, error.message || "Could not publish the post.", "error");
  } finally {
    submit.disabled = false;
  }
}

function updateCharacterCount() {
  elements.characterCount.textContent = `${elements.postContent.value.length} / 2000`;
}

function saveSettings(formEvent) {
  formEvent.preventDefault();
  try {
    settings = normalizeSettings({
      relays: elements.relayList.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      mutedWords: elements.mutedWords.value,
      blockedAuthors: elements.blockedAuthors.value,
    });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    renderSettings();
    renderFeed();
    showStatus(elements.settingsStatus, "Saved on this device. Reconnecting to selected relays…", "success");
    void startFeed();
  } catch (error) {
    showStatus(elements.settingsStatus, error.message, "error");
  }
}

function exportSettings() {
  const blob = new Blob([serializeSettings(settings)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "static-settings.json";
  link.click();
  URL.revokeObjectURL(url);
  showStatus(elements.settingsStatus, "Settings exported. The file contains relay choices and local filters, not posts or keys.", "success");
}

async function importSettings() {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    if (file.size > 100_000) throw new Error("Settings file is too large.");
    const imported = parseSettings(await file.text());
    settings = imported;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    renderSettings();
    renderFeed();
    showStatus(elements.settingsStatus, "Settings imported. Reconnecting to selected relays…", "success");
    void startFeed();
  } catch (error) {
    showStatus(elements.settingsStatus, error.message, "error");
  } finally {
    elements.importFile.value = "";
  }
}

elements.identityButton.addEventListener("click", connectSigner);
elements.postForm.addEventListener("submit", publishPost);
elements.postContent.addEventListener("input", updateCharacterCount);
elements.settingsForm.addEventListener("submit", saveSettings);
elements.refreshButton.addEventListener("click", () => void startFeed());
elements.exportButton.addEventListener("click", exportSettings);
elements.importFile.addEventListener("change", importSettings);

renderSettings();
void startFeed();
