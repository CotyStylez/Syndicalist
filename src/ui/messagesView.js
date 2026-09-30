import { h, mount } from '../utils/dom.js';
import { shorten, relativeTime, escapeHtml } from '../utils/format.js';
import { npubFor, pubkeyFromInput } from '../lib/relays.js';
import { decodeSignalMessage } from '../lib/webrtc.js';

// Encrypted DM UI state that needs to survive redraws but not module
// reloads: which conversation is open, and in-progress composer text.
// Mirrors the module-scope pattern used in peopleView.js/webrtcView.js.
let selectedPeer = null;
let newRecipientValue = '';
let messageDraft = '';
let lookupError = null;
let sendBusy = false;
let unsubscribeFeed = null;

export function renderMessagesView(content, app) {
  unsubscribeFeed?.();
  if (!app.state.relayHub) app.connectRelays();
  else if (app.state.identity && !app.state.dmSubscriptionActive) app.startDmSubscription();

  const redraw = () => draw(content, app);
  redraw();
  unsubscribeFeed = app.subscribeFeedUpdates(redraw);
}

function displayNameFor(state, pubkeyHex) {
  return state.profileCache[pubkeyHex]?.name || shorten(npubFor(pubkeyHex));
}

function truncatePreview(text, maxLength = 40) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function previewFor(message) {
  const signal = decodeSignalMessage(message.content);
  if (signal) return `📡 WebRTC ${signal.kind} signal`;
  return truncatePreview(message.content);
}

function conversationPeers(state) {
  const peers = new Set([...Object.keys(state.dmConversations), ...state.follows]);
  return [...peers].sort((a, b) => {
    const lastA = state.dmConversations[a]?.at(-1)?.createdAt || 0;
    const lastB = state.dmConversations[b]?.at(-1)?.createdAt || 0;
    return lastB - lastA;
  });
}

function draw(content, app) {
  const { state } = app;

  const intro = h('section', { class: 'card' }, [
    h('h2', {}, '💬 Messages'),
    h('p', { class: 'muted' }, [
      'Direct messages here are end-to-end encrypted (NIP-17): only you and the recipient can read the content. ',
      'Relays only ever see an anonymized "gift wrap" — not your message, and not who it is addressed to. ',
      'Your local message history is additionally encrypted at rest with your unlock passphrase, same as your identity key.',
    ]),
  ]);

  if (!state.identity) {
    mount(content, intro, h('section', { class: 'card' }, [h('p', {}, 'Unlock your identity in the 🔑 Identity tab to send or view messages.')]));
    return;
  }

  const newConvoCard = h('section', { class: 'card' }, [
    h('h3', {}, 'New conversation'),
    h('div', { class: 'button-row' }, [
      h('input', {
        type: 'text',
        placeholder: 'npub1… or hex pubkey',
        value: newRecipientValue,
        onInput: (e) => (newRecipientValue = e.target.value),
      }),
      h(
        'button',
        {
          onClick: () => {
            lookupError = null;
            try {
              selectedPeer = pubkeyFromInput(newRecipientValue);
              newRecipientValue = '';
            } catch (err) {
              lookupError = err.message;
            }
            draw(content, app);
          },
        },
        'Open',
      ),
    ]),
    lookupError ? h('p', { class: 'error-text' }, lookupError) : null,
  ]);

  const peers = conversationPeers(state);
  const conversationList = h(
    'ul',
    { class: 'follow-list' },
    peers.length === 0
      ? [h('li', {}, h('p', { class: 'muted' }, 'No conversations yet. Follow someone or start a new conversation above.'))]
      : peers.map((peerPubkeyHex) => {
          const messages = state.dmConversations[peerPubkeyHex] || [];
          const last = messages.at(-1);
          return h(
            'li',
            { class: `follow-row conversation-row${selectedPeer === peerPubkeyHex ? ' active' : ''}` },
            [
              h(
                'button',
                {
                  class: 'link-btn author',
                  onClick: () => {
                    selectedPeer = peerPubkeyHex;
                    draw(content, app);
                  },
                },
                displayNameFor(state, peerPubkeyHex),
              ),
              h('span', { class: 'muted small' }, last ? previewFor(last) : 'No messages yet'),
            ],
          );
        }),
  );
  const listCard = h('section', { class: 'card' }, [h('h3', {}, 'Conversations'), conversationList]);

  const detailCard = selectedPeer ? renderConversationDetail(content, app, selectedPeer) : null;

  mount(content, intro, newConvoCard, h('div', { class: 'profile-editor-grid' }, [listCard, detailCard || emptyDetail()]));
}

function emptyDetail() {
  return h('section', { class: 'card' }, [h('p', { class: 'muted' }, 'Select or start a conversation to view messages.')]);
}

function renderConversationDetail(content, app, peerPubkeyHex) {
  const { state } = app;
  const messages = state.dmConversations[peerPubkeyHex] || [];

  const history = h(
    'div',
    { class: 'dm-history' },
    messages.length === 0
      ? [h('p', { class: 'muted' }, 'No messages yet — say hello!')]
      : messages.map((m) => {
          const signal = decodeSignalMessage(m.content);
          if (signal) {
            return h('div', { class: `dm-message dm-${m.direction} dm-signal` }, [
              h('div', { class: 'dm-message-body' }, `📡 WebRTC "${signal.kind}" signal for Live P2P`),
              h('div', { class: 'button-row' }, [
                h(
                  'button',
                  { class: 'link-btn', onClick: () => app.goToWebrtcTabWithSignal(signal.kind, signal.blob) },
                  'Open in Live P2P',
                ),
              ]),
              h('span', { class: 'muted small' }, relativeTime(m.createdAt)),
            ]);
          }
          return h('div', { class: `dm-message dm-${m.direction}` }, [
            h('div', { class: 'dm-message-body', html: escapeHtml(m.content).replaceAll('\n', '<br>') }),
            h('span', { class: 'muted small' }, relativeTime(m.createdAt)),
          ]);
        }),
  );

  const composer = h('div', { class: 'button-row' }, [
    h('textarea', {
      rows: 2,
      placeholder: 'Write an encrypted message…',
      value: messageDraft,
      onInput: (e) => (messageDraft = e.target.value),
    }),
    h(
      'button',
      {
        class: 'primary',
        disabled: sendBusy,
        onClick: async () => {
          const text = messageDraft.trim();
          if (!text) return;
          sendBusy = true;
          draw(content, app);
          try {
            await app.sendDirectMessage(peerPubkeyHex, text);
            messageDraft = '';
          } catch (err) {
            app.setError('Failed to send message: ' + err.message);
          } finally {
            sendBusy = false;
            draw(content, app);
          }
        },
      },
      sendBusy ? 'Sending…' : 'Send',
    ),
  ]);

  return h('section', { class: 'card' }, [
    h('h3', { title: npubFor(peerPubkeyHex) }, displayNameFor(state, peerPubkeyHex)),
    history,
    composer,
  ]);
}
