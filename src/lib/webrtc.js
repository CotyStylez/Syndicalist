// A minimal browser-only WebRTC peer-to-peer demo.
//
// Signaling (the offer/answer SDP exchange) is done manually via copy/paste
// text blobs instead of a signaling server, so two peers can connect without
// any third-party infrastructure. This keeps the prototype server-less, at
// the cost of convenience — a future version could layer a lightweight
// decentralized signaling channel (e.g. over Nostr DMs) on top of this.

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** Encodes an SDP description into a copy/paste-friendly base64 blob. */
export function encodeSignal(description) {
  return btoa(JSON.stringify(description));
}

/** Decodes a copy/paste blob back into an SDP description. */
export function decodeSignal(text) {
  return JSON.parse(atob(text.trim()));
}

export class PeerSession {
  constructor({ onMessage, onChannelOpen, onChannelClose, onRemoteStream, onIceStateChange } = {}) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.callbacks = { onMessage, onChannelOpen, onChannelClose, onRemoteStream, onIceStateChange };

    this.pc.oniceconnectionstatechange = () => {
      this.callbacks.onIceStateChange?.(this.pc.iceConnectionState);
    };
    this.pc.ontrack = (event) => {
      this.callbacks.onRemoteStream?.(event.streams[0]);
    };
    this.pc.ondatachannel = (event) => {
      this._bindChannel(event.channel);
    };
  }

  _bindChannel(channel) {
    this.channel = channel;
    channel.onopen = () => this.callbacks.onChannelOpen?.();
    channel.onclose = () => this.callbacks.onChannelClose?.();
    channel.onmessage = (event) => this.callbacks.onMessage?.(event.data);
  }

  /** Adds local camera/mic tracks (optional) before creating an offer. */
  attachLocalStream(stream) {
    for (const track of stream.getTracks()) this.pc.addTrack(track, stream);
  }

  /** Initiator side: creates a data channel + offer, returns a signal blob. */
  async createOffer() {
    this._bindChannel(this.pc.createDataChannel('sydacalist'));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.pc);
    return encodeSignal(this.pc.localDescription);
  }

  /** Responder side: consumes an offer blob, returns an answer blob. */
  async createAnswer(offerSignalText) {
    const offer = decodeSignal(offerSignalText);
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.pc);
    return encodeSignal(this.pc.localDescription);
  }

  /** Initiator side: applies the responder's answer blob to complete the handshake. */
  async applyAnswer(answerSignalText) {
    const answer = decodeSignal(answerSignalText);
    await this.pc.setRemoteDescription(answer);
  }

  send(message) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(message);
      return true;
    }
    return false;
  }

  close() {
    this.channel?.close();
    this.pc.close();
  }
}
