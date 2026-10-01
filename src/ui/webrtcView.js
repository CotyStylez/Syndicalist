import { h, mount } from '../utils/dom.js';
import { PeerSession, encodeSignalMessage } from '../lib/webrtc.js';
import { pubkeyFromInput } from '../lib/relays.js';
import { duplicateTemplate, updateTemplate } from '../lib/templates.js';

// This view manages a live WebRTC peer connection. Its state (the peer
// connection, local media stream, signaling text) is kept at module scope
// so that unrelated app re-renders don't tear down an in-progress call —
// only re-mounting this tab replaces the visible DOM, not the connection.
let session = null;
let localStream = null;
let role = null; // 'initiator' | 'responder'
let offerText = '';
let answerText = '';
let pastedOffer = '';
let pastedAnswer = '';
let chatLog = [];
let chatDraft = '';
let connectionState = 'new';
let dmRecipientValue = '';
let dmSendBusy = false;
let dmSendStatus = null;
let activePackId = null;
let hostNpubInput = '';
let tipBusy = false;
let tipStatus = null;
let pendingInvoice = null; // { invoice, sats, label, paid }
let stickerBursts = []; // transient { id, art } entries, auto-removed after the CSS animation
let zapListenerBound = null; // the `app` instance we've already subscribed, to avoid double-subscribing
let activeTemplateId = null;
let timerRemaining = null; // seconds left, or null when no timer is running
let timerHandle = null;
let editingTemplateId = null; // template currently open in the inline customize form

const STICKER_MSG_PREFIX = 'sydacalist-sticker:v1:';

function encodeStickerMessage(sticker) {
  return STICKER_MSG_PREFIX + JSON.stringify({ kind: sticker.kind, data: sticker.data, label: sticker.label, sats: sticker.sats || 0 });
}

function decodeStickerMessage(text) {
  if (typeof text !== 'string' || !text.startsWith(STICKER_MSG_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(STICKER_MSG_PREFIX.length));
  } catch {
    return null;
  }
}

export function renderWebrtcView(content, app) {
  if (app.state.identity && !app.state.relayHub) app.connectRelays();
  const pending = app.consumePendingWebrtcSignal?.();
  if (pending) {
    role = pending.kind === 'offer' ? 'responder' : 'initiator';
    if (pending.kind === 'offer') pastedOffer = pending.blob;
    else pastedAnswer = pending.blob;
  }
  // Zap receipts arrive asynchronously over relays, well after the invoice
  // was requested — subscribe once (module scope persists across
  // re-renders/tab switches) so a confirmed tip updates this view even if
  // the user has since looked away and come back.
  if (zapListenerBound !== app) {
    zapListenerBound = app;
    app.subscribeFeedUpdates(() => draw(content, app));
  }
  draw(content, app);
}

function ensureSession(content, app) {
  if (session) return session;
  session = new PeerSession({
    onMessage: (msg) => {
      const sticker = decodeStickerMessage(msg);
      if (sticker) {
        chatLog = [
          ...chatLog,
          {
            from: 'them-sticker',
            text: sticker.sats
              ? `sent a tip sticker worth ${sticker.sats} sats`
              : 'sent a sticker',
            sticker,
          },
        ];
        spawnBurst(sticker);
      } else {
        chatLog = [...chatLog, { from: 'them', text: msg }];
      }
      draw(content, app);
    },
    onChannelOpen: () => {
      chatLog = [...chatLog, { from: 'system', text: 'Data channel open — you are connected peer-to-peer.' }];
      draw(content, app);
    },
    onChannelClose: () => {
      chatLog = [...chatLog, { from: 'system', text: 'Data channel closed.' }];
      draw(content, app);
    },
    onRemoteStream: (stream) => {
      const video = content.querySelector('#remote-video');
      if (video) video.srcObject = stream;
    },
    onIceStateChange: (iceState) => {
      connectionState = iceState;
      draw(content, app);
    },
  });
  return session;
}

/** Shows a brief floating sticker animation (TikTok-style burst) that
 * removes itself once the CSS animation finishes. Purely cosmetic — the
 * actual tip confirmation (if any) comes separately via a zap receipt. */
function spawnBurst(sticker) {
  const id = Math.random().toString(36).slice(2);
  stickerBursts = [...stickerBursts, { id, sticker }];
  setTimeout(() => {
    stickerBursts = stickerBursts.filter((b) => b.id !== id);
  }, 1800);
}

function renderStickerArt(sticker) {
  if (sticker.kind === 'emoji') return h('span', {}, sticker.data);
  if (sticker.kind === 'svg') return h('span', { html: sticker.data });
  return h('img', { src: sticker.data, alt: sticker.label });
}

/** Renders the "Session format" picker: a dropdown of local templates
 * (built-in + any the host has duplicated/customized), the labeled-slot
 * layout preview, an optional topic banner, and an optional countdown
 * timer. This is purely a cosmetic/structural layer on top of the existing
 * 1:1 WebRTC transport above — picking "Debate panel" does not add a media
 * server or auto-discover more than one peer; it only relabels and
 * restyles this same two-video view (see README's Live templates section
 * for the honest limitation on true multi-party panels). */
function renderTemplateSection(content, app) {
  const templates = app.state.liveTemplates || [];
  if (!activeTemplateId && templates.length) activeTemplateId = templates[0].id;
  const template = templates.find((t) => t.id === activeTemplateId) || templates[0] || null;
  if (!template) return null;

  const isEditing = editingTemplateId === template.id;

  const slotRow = h(
    'div',
    { class: 'template-slots', style: `border-color: ${template.accentColor}` },
    (template.roles || []).map((roleLabel) => h('span', { class: 'template-slot', style: `background:${template.accentColor}` }, roleLabel)),
  );

  const topicBanner = template.showTopicBanner
    ? h('input', {
        type: 'text',
        placeholder: 'Topic / headline for this session (e.g. "Resolved: …")',
        value: template.topic || '',
        onInput: async (e) => {
          const updated = updateTemplate(templates, template.id, { topic: e.target.value });
          await app.saveLiveTemplates(updated);
          draw(content, app);
        },
      })
    : null;

  const timerRow = template.timerMinutes
    ? h('div', { class: 'button-row' }, [
        h('span', { class: 'muted small' }, timerRemaining != null ? `⏱ ${Math.max(0, Math.ceil(timerRemaining / 60))}m ${timerRemaining % 60}s left` : `⏱ ${template.timerMinutes}m timer`),
        h('button', { onClick: () => startTimer(content, app, template.timerMinutes) }, 'Start'),
        h('button', { onClick: () => stopTimer(content, app) }, 'Reset'),
      ])
    : null;

  const editForm = isEditing
    ? h('div', { class: 'button-row' }, [
        h('input', {
          type: 'text',
          placeholder: 'Template name',
          value: template.name,
          onInput: async (e) => {
            const updated = updateTemplate(templates, template.id, { name: e.target.value });
            await app.saveLiveTemplates(updated);
            draw(content, app);
          },
        }),
        h('input', {
          type: 'text',
          placeholder: 'Roles, comma-separated (e.g. Pro, Con, Moderator)',
          value: (template.roles || []).join(', '),
          onInput: async (e) => {
            const roles = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
            const updated = updateTemplate(templates, template.id, { roles });
            await app.saveLiveTemplates(updated);
            draw(content, app);
          },
        }),
        h('input', {
          type: 'color',
          value: template.accentColor,
          onInput: async (e) => {
            const updated = updateTemplate(templates, template.id, { accentColor: e.target.value });
            await app.saveLiveTemplates(updated);
            draw(content, app);
          },
        }),
        h('button', { onClick: () => { editingTemplateId = null; draw(content, app); } }, 'Done'),
      ])
    : null;

  return h('section', { class: 'card' }, [
    h('h3', {}, '🎭 Session format'),
    h('p', { class: 'muted small' }, 'Pick a layout preset — purely cosmetic labels/colors on top of the same 1:1 connection above. "Panel" formats with more than two roles still need the extra participants connected manually; there is no auto-discovery or media server.'),
    h('div', { class: 'button-row' }, [
      h(
        'select',
        {
          onChange: (e) => {
            activeTemplateId = e.target.value;
            editingTemplateId = null;
            stopTimer(content, app);
            draw(content, app);
          },
        },
        templates.map((t) => h('option', { value: t.id, selected: t.id === template.id ? '' : undefined }, t.name + (t.builtIn ? '' : ' ✎'))),
      ),
      h(
        'button',
        {
          onClick: async () => {
            const copy = duplicateTemplate(template);
            const updated = [...templates, copy];
            await app.saveLiveTemplates(updated);
            activeTemplateId = copy.id;
            editingTemplateId = copy.id;
            draw(content, app);
          },
        },
        'Duplicate & customize',
      ),
      !template.builtIn
        ? h('button', { onClick: () => { editingTemplateId = isEditing ? null : template.id; draw(content, app); } }, isEditing ? 'Close editor' : '✎ Edit')
        : null,
    ]),
    slotRow,
    topicBanner,
    timerRow,
    editForm,
  ]);
}

function startTimer(content, app, minutes) {
  stopTimer(content, app);
  timerRemaining = minutes * 60;
  timerHandle = setInterval(() => {
    timerRemaining = Math.max(0, timerRemaining - 1);
    if (timerRemaining === 0) stopTimer(content, app, true);
    draw(content, app);
  }, 1000);
  draw(content, app);
}

function stopTimer(content, app, keepZero) {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  if (!keepZero) timerRemaining = null;
  draw(content, app);
}

function draw(content, app) {
  const intro = h('section', { class: 'card' }, [
    h('h2', {}, 'Live peer-to-peer demo'),
    h('p', { class: 'muted' }, [
      'This connects two browsers directly with WebRTC — no media server, no signaling server. ',
      'One person is the ',
      h('strong', {}, 'Initiator'),
      ' (creates an offer), the other is the ',
      h('strong', {}, 'Responder'),
      ' (creates an answer). Copy/paste the text blobs between you (chat, email, anything) to complete the handshake — ',
      'or, if you know each other\'s npub, use the "Send via Messages" button to deliver it as an encrypted direct message instead.',
    ]),
    h('p', { class: 'muted small' }, `Connection state: ${connectionState}`),
  ]);

  const roleChooser = h('section', { class: 'card' }, [
    h('div', { class: 'button-row' }, [
      h(
        'button',
        {
          class: role === 'initiator' ? 'primary' : '',
          onClick: () => {
            resetSession();
            role = 'initiator';
            draw(content, app);
          },
        },
        "I'm the initiator",
      ),
      h(
        'button',
        {
          class: role === 'responder' ? 'primary' : '',
          onClick: () => {
            resetSession();
            role = 'responder';
            draw(content, app);
          },
        },
        "I'm the responder",
      ),
      h(
        'button',
        {
          onClick: async () => {
            try {
              localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              const video = content.querySelector('#local-video');
              if (video) video.srcObject = localStream;
              ensureSession(content, app).attachLocalStream(localStream);
              draw(content, app);
            } catch (err) {
              app.setError('Camera/mic access failed: ' + err.message);
            }
          },
        },
        '🎥 Enable camera & mic (optional)',
      ),
    ]),
  ]);

  const videoRow = h('section', { class: 'card video-row' }, [
    h('div', {}, [h('label', {}, 'Local'), h('video', { id: 'local-video', autoplay: '', muted: '', playsinline: '' })]),
    h('div', {}, [h('label', {}, 'Remote'), h('video', { id: 'remote-video', autoplay: '', playsinline: '' })]),
  ]);

  let signalingSection = null;
  if (role === 'initiator') {
    signalingSection = h('section', { class: 'card' }, [
      h('h3', {}, '1. Create an offer'),
      h(
        'button',
        {
          class: 'primary',
          onClick: async () => {
            try {
              const s = ensureSession(content, app);
              offerText = await s.createOffer();
              draw(content, app);
            } catch (err) {
              app.setError('Failed to create offer: ' + err.message);
            }
          },
        },
        'Create offer',
      ),
      offerText ? h('textarea', { rows: 4, readonly: '', value: offerText }) : null,
      offerText ? renderSendViaDm(content, app, 'offer', offerText) : null,
      dmSendStatus ? h('p', { class: 'muted small' }, dmSendStatus) : null,
      h('h3', {}, '2. Paste their answer'),
      h('textarea', {
        rows: 4,
        placeholder: 'Paste the answer blob here',
        value: pastedAnswer,
        onInput: (e) => (pastedAnswer = e.target.value),
      }),
      h(
        'button',
        {
          onClick: async () => {
            try {
              await session.applyAnswer(pastedAnswer);
              app.setError(null);
            } catch (err) {
              app.setError('Failed to apply answer: ' + err.message);
            }
          },
        },
        'Apply answer',
      ),
    ]);
  } else if (role === 'responder') {
    signalingSection = h('section', { class: 'card' }, [
      h('h3', {}, '1. Paste their offer'),
      h('textarea', {
        rows: 4,
        placeholder: 'Paste the offer blob here',
        value: pastedOffer,
        onInput: (e) => (pastedOffer = e.target.value),
      }),
      h(
        'button',
        {
          class: 'primary',
          onClick: async () => {
            try {
              const s = ensureSession(content, app);
              answerText = await s.createAnswer(pastedOffer);
              draw(content, app);
            } catch (err) {
              app.setError('Failed to create answer: ' + err.message);
            }
          },
        },
        'Create answer',
      ),
      h('h3', {}, '2. Send this answer back'),
      answerText ? h('textarea', { rows: 4, readonly: '', value: answerText }) : null,
      answerText ? renderSendViaDm(content, app, 'answer', answerText) : null,
      dmSendStatus ? h('p', { class: 'muted small' }, dmSendStatus) : null,
    ]);
  }

  const packs = app.state.stickerPacks || [];
  if (!activePackId && packs.length) activePackId = packs[0].id;
  const activePack = packs.find((p) => p.id === activePackId) || packs[0] || null;

  const tipCard = h('section', { class: 'card' }, [
    h('h3', {}, '💸 Tip the host'),
    h('p', { class: 'muted small' }, [
      "Enter the host's npub once, then tap a sticker with a sats price to request a Lightning invoice (NIP-57 zap) addressed directly to them — ",
      'no platform cut, no account with this app. A ⚡ confirmation only appears once their relay(s) publish the public zap receipt.',
    ]),
    h('input', {
      type: 'text',
      placeholder: "Host's npub (only needed for tip stickers)",
      value: hostNpubInput,
      onInput: (e) => (hostNpubInput = e.target.value),
    }),
    packs.length > 1
      ? h(
          'select',
          { onChange: (e) => { activePackId = e.target.value; draw(content, app); } },
          packs.map((p) => h('option', { value: p.id, selected: activePackId === p.id ? '' : undefined }, p.name)),
        )
      : null,
    h(
      'div',
      { class: 'sticker-tray' },
      (activePack?.stickers || []).map((sticker) =>
        h(
          'button',
          {
            class: 'sticker-btn',
            title: sticker.label,
            onClick: () => sendSticker(content, app, sticker),
          },
          [renderStickerArt(sticker), sticker.sats ? h('span', { class: 'sticker-price' }, `${sticker.sats} sats`) : null],
        ),
      ),
    ),
    !packs.length ? h('p', { class: 'muted small' }, 'No sticker packs yet — create one in the 🎉 Stickers tab.') : null,
    tipBusy ? h('p', { class: 'muted small' }, 'Requesting invoice…') : null,
    tipStatus ? h('p', { class: 'muted small' }, tipStatus) : null,
    pendingInvoice && !pendingInvoice.paid
      ? h('div', { class: 'zap-invoice-box' }, [
          h('p', {}, `⚡ Invoice for ${pendingInvoice.sats} sats (${pendingInvoice.label}) — pay with any Lightning wallet:`),
          h('textarea', { rows: 3, readonly: '', value: pendingInvoice.invoice }),
        ])
      : null,
    renderZapReceipts(app),
  ]);

  const chatSection = h('section', { class: 'card' }, [
    h('h3', {}, 'Live chat'),
    h(
      'div',
      { class: 'chat-log' },
      chatLog.map((entry) =>
        entry.sticker
          ? h('div', { class: 'chat-line chat-sticker-line' }, [renderStickerArt(entry.sticker), ` ${entry.text}`])
          : h('div', { class: `chat-line chat-${entry.from}` }, entry.text),
      ),
    ),
    h('div', { class: 'sticker-burst-layer' }, stickerBursts.map((b) => h('span', { class: 'sticker-burst' }, [renderStickerArt(b.sticker)]))),
    h('div', { class: 'button-row' }, [
      h('input', { type: 'text', placeholder: 'Say hello…', value: chatDraft, onInput: (e) => (chatDraft = e.target.value) }),
      h(
        'button',
        {
          onClick: () => {
            if (!chatDraft.trim() || !session) return;
            const sent = session.send(chatDraft.trim());
            if (sent) {
              chatLog = [...chatLog, { from: 'me', text: chatDraft.trim() }];
              chatDraft = '';
              draw(content, app);
            } else {
              app.setError('Data channel is not open yet.');
            }
          },
        },
        'Send',
      ),
    ]),
  ]);

  const templateSection = renderTemplateSection(content, app);

  mount(content, intro, templateSection, roleChooser, videoRow, role ? signalingSection : null, tipCard, chatSection);

  const localVideo = content.querySelector('#local-video');
  if (localVideo && localStream) localVideo.srcObject = localStream;
}

function renderZapReceipts(app) {
  const receipts = app.state.zapReceipts || [];
  if (!receipts.length) return null;
  return h('div', { class: 'chat-log' }, [
    h('strong', {}, 'Recent confirmed zaps to you:'),
    ...receipts
      .slice(0, 10)
      .map((r) => h('div', { class: 'chat-line chat-zap-line' }, `⚡ ${r.sats} sats received`)),
  ]);
}

/** Sends a sticker over the data channel (so the other peer can render and
 * react to it immediately), bursts it locally, and — for stickers with a
 * sats price — requests a NIP-57 zap invoice addressed to the host so the
 * "tip" isn't just a hopeful animation but a real payment request. */
async function sendSticker(content, app, sticker) {
  if (!session) {
    app.setError('Connect to a peer first.');
    return;
  }
  const sent = session.send(encodeStickerMessage(sticker));
  chatLog = [
    ...chatLog,
    { from: 'me-sticker', text: sticker.sats ? `you sent a tip sticker worth ${sticker.sats} sats` : 'you sent a sticker', sticker },
  ];
  spawnBurst(sticker);
  draw(content, app);
  if (!sent) {
    app.setError('Data channel is not open yet — the sticker was shown locally only.');
  }

  if (!sticker.sats) return;
  tipStatus = null;
  pendingInvoice = null;
  if (!hostNpubInput.trim()) {
    tipStatus = "Enter the host's npub above to send a real tip for this sticker.";
    draw(content, app);
    return;
  }
  tipBusy = true;
  draw(content, app);
  try {
    const hostPubkeyHex = pubkeyFromInput(hostNpubInput);
    const { invoice, paid } = await app.sendZapTip({
      hostPubkeyHex,
      amountSats: sticker.sats,
      comment: sticker.label,
    });
    pendingInvoice = { invoice, sats: sticker.sats, label: sticker.label, paid };
    tipStatus = paid
      ? '✅ Paid automatically via your Lightning wallet extension.'
      : '⚡ Invoice ready — pay it with any Lightning wallet (scan/copy above).';
  } catch (err) {
    tipStatus = `Could not request a tip invoice: ${err.message}`;
  } finally {
    tipBusy = false;
    draw(content, app);
  }
}

function resetSession() {
  session?.close();
  session = null;
  offerText = '';
  answerText = '';
  pastedOffer = '';
  pastedAnswer = '';
  chatLog = [];
  connectionState = 'new';
  dmSendStatus = null;
}

/** A small "send this blob as an encrypted DM" row, shown under the offer
 * or answer textarea, so two people don't have to copy/paste it by hand —
 * it rides the same NIP-17 encrypted transport as the Messages tab. */
function renderSendViaDm(content, app, kind, blob) {
  return h('div', { class: 'button-row inline-comment' }, [
    h('input', {
      type: 'text',
      placeholder: "Recipient's npub/hex (optional — or copy/paste instead)",
      value: dmRecipientValue,
      onInput: (e) => (dmRecipientValue = e.target.value),
    }),
    h(
      'button',
      {
        disabled: dmSendBusy,
        onClick: async () => {
          dmSendStatus = null;
          if (!dmRecipientValue.trim()) {
            dmSendStatus = 'Enter a recipient npub/hex first.';
            draw(content, app);
            return;
          }
          dmSendBusy = true;
          draw(content, app);
          try {
            await app.sendDirectMessage(dmRecipientValue, encodeSignalMessage(kind, blob));
            dmSendStatus = `✅ Sent — they can open it from their 💬 Messages tab.`;
          } catch (err) {
            dmSendStatus = `Failed to send: ${err.message}`;
          } finally {
            dmSendBusy = false;
            draw(content, app);
          }
        },
      },
      dmSendBusy ? 'Sending…' : `📨 Send this ${kind} via Messages`,
    ),
  ]);
}
