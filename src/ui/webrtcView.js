import { h, mount } from '../utils/dom.js';
import { PeerSession } from '../lib/webrtc.js';

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

export function renderWebrtcView(content, app) {
  draw(content, app);
}

function ensureSession(content, app) {
  if (session) return session;
  session = new PeerSession({
    onMessage: (msg) => {
      chatLog = [...chatLog, { from: 'them', text: msg }];
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

function draw(content, app) {
  const intro = h('section', { class: 'card' }, [
    h('h2', {}, 'Live peer-to-peer demo'),
    h('p', { class: 'muted' }, [
      'This connects two browsers directly with WebRTC — no media server, no signaling server. ',
      'One person is the ',
      h('strong', {}, 'Initiator'),
      ' (creates an offer), the other is the ',
      h('strong', {}, 'Responder'),
      ' (creates an answer). Copy/paste the text blobs between you (chat, email, anything) to complete the handshake.',
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
      h('h3', {}, '2. Paste their answer'),
      h('textarea', { rows: 4, placeholder: 'Paste the answer blob here', onInput: (e) => (pastedAnswer = e.target.value) }),
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
      h('textarea', { rows: 4, placeholder: 'Paste the offer blob here', onInput: (e) => (pastedOffer = e.target.value) }),
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
    ]);
  }

  const chatSection = h('section', { class: 'card' }, [
    h('h3', {}, 'Data channel chat'),
    h(
      'div',
      { class: 'chat-log' },
      chatLog.map((entry) => h('div', { class: `chat-line chat-${entry.from}` }, entry.text)),
    ),
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

  mount(content, intro, roleChooser, videoRow, role ? signalingSection : null, chatSection);

  const localVideo = content.querySelector('#local-video');
  if (localVideo && localStream) localVideo.srcObject = localStream;
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
}
