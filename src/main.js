import { finalizeEvent, verifyEvent } from 'nostr-tools';
import { createIdentity, importIdentity } from './identity.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const relayUrls = new Map();
const seenEvents = new Set();
const feed = $('#feed');
let identity = null;
let peerConnection = null;
let dataChannel = null;
let localStream = null;

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function setIdentity(nextIdentity) {
  identity?.secretKey.fill(0);
  identity = nextIdentity;
  $('#identity-status').textContent = 'Key ready';
  $('#public-key').value = identity.npub;
  $('#export-key').disabled = false;
  $('#publish-note').disabled = relayUrls.size === 0;
  $('#secret-export').hidden = true;
  $('#secret-export').value = '';
  $('#export-key').textContent = 'Reveal export key';
  setMessage($('#identity-message'), 'Key is held in memory only for this tab.');
}

function clearFeed(message) {
  feed.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = message;
  feed.append(empty);
}

function renderEvent(event) {
  if (seenEvents.has(event.id)) return;
  seenEvents.add(event.id);
  if (feed.querySelector('.empty-state')) feed.replaceChildren();

  const article = document.createElement('article');
  article.className = 'note';
  const header = document.createElement('div');
  header.className = 'note-meta';
  const author = document.createElement('span');
  author.className = 'mono';
  author.textContent = `${event.pubkey.slice(0, 8)}…${event.pubkey.slice(-8)}`;
  const date = document.createElement('time');
  date.dateTime = new Date(event.created_at * 1000).toISOString();
  date.textContent = new Date(event.created_at * 1000).toLocaleString();
  const content = document.createElement('p');
  content.textContent = event.content;
  header.append(author, date);
  article.append(header, content);
  feed.prepend(article);

  while (feed.children.length > 50) feed.lastElementChild.remove();
}

function sendSubscription(socket) {
  socket.send(JSON.stringify(['REQ', 'sydacalist-feed', { kinds: [1], limit: 30 }]));
}

function updateRelayStatus() {
  const connected = [...relayUrls.values()].filter((relay) => relay.socket?.readyState === WebSocket.OPEN).length;
  const total = relayUrls.size;
  $('#relay-status').textContent = total === 0
    ? 'Disconnected'
    : connected === total
      ? `${connected} connected`
      : `${connected}/${total} connected`;
  $('#connect-relays').disabled = total > 0;
  $('#disconnect-relays').disabled = total === 0;
  $('#publish-note').disabled = !identity || connected === 0;
}

function closeRelay(relay) {
  clearTimeout(relay.timer);
  relay.reconnect = false;
  const socket = relay.socket;
  relay.socket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
}

function connectRelay(url, retry = false) {
  let relay = relayUrls.get(url);
  if (!relay) {
    relay = { socket: null, timer: null, attempts: 0, reconnect: true };
    relayUrls.set(url, relay);
  }
  relay.reconnect = true;
  clearTimeout(relay.timer);
  try {
    const socket = new WebSocket(url);
    relay.socket = socket;
    socket.addEventListener('open', () => {
      relay.attempts = 0;
      sendSubscription(socket);
      updateRelayStatus();
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message[0] === 'EVENT' && isValidNote(message[2]) && verifyEvent(message[2])) {
          renderEvent(message[2]);
        }
      } catch {
        // Ignore malformed relay messages; relay input is untrusted.
      }
    });
    socket.addEventListener('error', () => {
      updateRelayStatus();
    });
    socket.addEventListener('close', () => {
      if (relay.socket === socket) relay.socket = null;
      updateRelayStatus();
      if (relay.reconnect && relayUrls.has(url)) {
        const delay = Math.min(1000 * 2 ** relay.attempts, 30000);
        relay.attempts += 1;
        relay.timer = setTimeout(() => connectRelay(url, true), delay);
      }
    });
  } catch {
    relay.socket = null;
    updateRelayStatus();
    setMessage($('#note-message'), `Could not connect to ${url}.`, true);
  }
  if (!retry) updateRelayStatus();
}

function isValidNote(event) {
  return event?.kind === 1
    && /^[0-9a-f]{64}$/i.test(event.id)
    && /^[0-9a-f]{64}$/i.test(event.pubkey)
    && /^[0-9a-f]{128}$/i.test(event.sig)
    && Number.isSafeInteger(event.created_at)
    && event.created_at >= 0
    && event.created_at <= 8.64e12
    && Array.isArray(event.tags)
    && typeof event.content === 'string'
    && event.content.length <= 20000;
}

function connectRelays() {
  const values = $('#relay-input').value.split(',').map((value) => value.trim()).filter(Boolean);
  const urls = [...new Set(values)];
  if (urls.length === 0) {
    setMessage($('#note-message'), 'Enter at least one wss:// relay URL.', true);
    return;
  }
  if (urls.some((url) => {
    try {
      return new URL(url).protocol !== 'wss:';
    } catch {
      return true;
    }
  })) {
    setMessage($('#note-message'), 'Only valid secure wss:// relay URLs are supported.', true);
    return;
  }

  clearFeed('Connecting to relays…');
  setMessage($('#note-message'), '');
  for (const [url, relay] of relayUrls) {
    if (!urls.includes(url)) {
      closeRelay(relay);
      relayUrls.delete(url);
    }
  }
  for (const url of urls) {
    if (!relayUrls.get(url)?.socket) connectRelay(url);
  }
  updateRelayStatus();
}

function disconnectRelays() {
  for (const relay of relayUrls.values()) closeRelay(relay);
  relayUrls.clear();
  updateRelayStatus();
  clearFeed('Disconnected. Reconnect to load recent notes.');
}

async function publishNote(event) {
  event.preventDefault();
  const content = $('#note-input').value.trim();
  if (!identity || !content) return;
  const signedEvent = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  }, identity.secretKey);
  const sockets = [...relayUrls.values()]
    .map(({ socket }) => socket)
    .filter((socket) => socket?.readyState === WebSocket.OPEN);
  if (sockets.length === 0) {
    setMessage($('#note-message'), 'No relay is connected. Your note was not sent.', true);
    return;
  }

  let sent = 0;
  for (const socket of sockets) {
    try {
      socket.send(JSON.stringify(['EVENT', signedEvent]));
      sent += 1;
    } catch {
      // A relay can close between the readyState check and send.
    }
  }
  if (sent === 0) {
    setMessage($('#note-message'), 'No relay accepted the connection. Your note was not sent.', true);
    return;
  }
  renderEvent(signedEvent);
  $('#note-input').value = '';
  setMessage($('#note-message'), `Submitted to ${sent} connected relay${sent === 1 ? '' : 's'}.`);
}

function updatePeerStatus() {
  const connected = peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open';
  $('#peer-status').textContent = connected
    ? 'Connected'
    : peerConnection?.connectionState === 'connecting'
      ? 'Connecting…'
      : 'Not connected';
  $('#send-peer-message').disabled = !connected;
}

function addChatMessage(message, outgoing = false) {
  const line = document.createElement('p');
  line.className = outgoing ? 'chat-message outgoing' : 'chat-message';
  line.textContent = `${outgoing ? 'You' : 'Peer'}: ${message}`;
  $('#peer-chat').append(line);
  line.scrollIntoView({ block: 'nearest' });
}

function setupDataChannel(channel) {
  dataChannel = channel;
  channel.addEventListener('open', updatePeerStatus);
  channel.addEventListener('close', updatePeerStatus);
  channel.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') addChatMessage(data);
  });
  updatePeerStatus();
}

function createPeerConnection() {
  peerConnection?.close();
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  dataChannel = null;
  peerConnection.addEventListener('connectionstatechange', updatePeerStatus);
  peerConnection.addEventListener('datachannel', ({ channel }) => setupDataChannel(channel));
  peerConnection.addEventListener('track', ({ streams }) => {
    if (streams[0]) {
      $('#remote-video').srcObject = streams[0];
      $('#remote-video').hidden = false;
    }
  });
  if (localStream) {
    for (const track of localStream.getTracks()) peerConnection.addTrack(track, localStream);
  }
  updatePeerStatus();
  return peerConnection;
}

function waitForIceGathering(connection) {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.removeEventListener('icegatheringstatechange', handleStateChange);
      reject(new Error('ICE gathering timed out. Try again or use a faster network.'));
    }, 15000);
    function handleStateChange() {
      if (connection.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        connection.removeEventListener('icegatheringstatechange', handleStateChange);
        resolve();
      }
    }
    connection.addEventListener('icegatheringstatechange', handleStateChange);
  });
}

async function createOffer() {
  try {
    const connection = createPeerConnection();
    setupDataChannel(connection.createDataChannel('chat'));
    await connection.setLocalDescription(await connection.createOffer());
    await waitForIceGathering(connection);
    $('#signal-output').value = JSON.stringify(connection.localDescription);
    $('#copy-signal').disabled = false;
    setMessage($('#peer-message-status'), 'Offer ready. Send it to your peer, then paste their answer.');
  } catch (error) {
    setMessage($('#peer-message-status'), error.message, true);
  }
}

function parseSignal() {
  const value = $('#signal-input').value.trim();
  if (!value || value.length > 100000) throw new Error('Paste a signaling JSON message under 100 KB.');
  const signal = JSON.parse(value);
  if (!['offer', 'answer'].includes(signal?.type) || typeof signal.sdp !== 'string') {
    throw new Error('Signaling data must be a WebRTC offer or answer.');
  }
  return signal;
}

async function createAnswer() {
  try {
    const offer = parseSignal();
    if (offer.type !== 'offer') throw new Error('Paste an offer to create an answer.');
    const connection = createPeerConnection();
    await connection.setRemoteDescription(offer);
    await connection.setLocalDescription(await connection.createAnswer());
    await waitForIceGathering(connection);
    $('#signal-output').value = JSON.stringify(connection.localDescription);
    $('#copy-signal').disabled = false;
    setMessage($('#peer-message-status'), 'Answer ready. Send it to the person who created the offer.');
  } catch (error) {
    setMessage($('#peer-message-status'), error.message || 'Could not create an answer.', true);
  }
}

async function applyAnswer() {
  try {
    if (!peerConnection || peerConnection.signalingState !== 'have-local-offer') {
      throw new Error('Create an offer before applying an answer.');
    }
    const answer = parseSignal();
    if (answer.type !== 'answer') throw new Error('Paste an answer created from your offer.');
    await peerConnection.setRemoteDescription(answer);
    setMessage($('#peer-message-status'), 'Answer applied. Waiting for the peer connection…');
  } catch (error) {
    setMessage($('#peer-message-status'), error.message || 'Could not apply the answer.', true);
  }
}

async function prepareCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost.');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('#local-video').srcObject = localStream;
    $('#local-video').hidden = false;
    $('#prepare-camera').disabled = true;
    $('#stop-camera').disabled = false;
    setMessage($('#peer-message-status'), 'Camera ready. Create an offer or answer to share it.');
  } catch (error) {
    setMessage($('#peer-message-status'), error.message || 'Could not access the camera.', true);
  }
}

function stopCamera() {
  for (const track of localStream?.getTracks() ?? []) track.stop();
  localStream = null;
  $('#local-video').srcObject = null;
  $('#local-video').hidden = true;
  $('#prepare-camera').disabled = false;
  $('#stop-camera').disabled = true;
  setMessage($('#peer-message-status'), 'Camera and microphone stopped.');
}

$('#generate-key').addEventListener('click', () => {
  try {
    setIdentity(createIdentity());
  } catch {
    setMessage($('#identity-message'), 'Could not generate a key in this browser.', true);
  }
});

$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    setIdentity(importIdentity($('#private-key-input').value));
    $('#private-key-input').value = '';
  } catch {
    setMessage($('#identity-message'), 'Invalid private key. Enter a valid nsec or 64-character hex key.', true);
  }
});

$('#export-key').addEventListener('click', () => {
  if (!identity) return;
  const output = $('#secret-export');
  output.hidden = !output.hidden;
  output.value = output.hidden ? '' : identity.nsec;
  $('#export-key').textContent = output.hidden ? 'Reveal export key' : 'Hide export key';
});

$('#connect-relays').addEventListener('click', connectRelays);
$('#disconnect-relays').addEventListener('click', disconnectRelays);
$('#note-form').addEventListener('submit', publishNote);
$('#create-offer').addEventListener('click', createOffer);
$('#create-answer').addEventListener('click', createAnswer);
$('#apply-answer').addEventListener('click', applyAnswer);
$('#copy-signal').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#signal-output').value);
    setMessage($('#peer-message-status'), 'Signaling data copied.');
  } catch {
    setMessage($('#peer-message-status'), 'Copy failed. Select and copy the signaling text manually.', true);
  }
});
$('#prepare-camera').addEventListener('click', prepareCamera);
$('#stop-camera').addEventListener('click', stopCamera);
$('#peer-message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#peer-message');
  const message = input.value.trim();
  if (!message || dataChannel?.readyState !== 'open') return;
  dataChannel.send(message);
  addChatMessage(message, true);
  input.value = '';
});

window.addEventListener('beforeunload', () => {
  identity?.secretKey.fill(0);
  disconnectRelays();
  stopCamera();
  peerConnection?.close();
});
