const CONNECT_TIMEOUT_MS = 8000;
const ACK_TIMEOUT_MS = 8000;

export class RelayPool {
  constructor(onEvent, onStatus = () => {}) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.connections = new Map();
    this.subscriptionId = `static-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    this.pendingAcks = new Map();
  }

  async connect(urls) {
    const results = await Promise.all(urls.map((url) => this.connectOne(url)));
    return results.filter(Boolean).length;
  }

  connectOne(url) {
    const existing = this.connections.get(url);
    if (existing?.readyState === WebSocket.OPEN) return Promise.resolve(true);

    this.onStatus(`Connecting to ${url}…`);

    return new Promise((resolve) => {
      let settled = false;
      let socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket?.close();
        this.onStatus(`Could not connect to ${url}.`);
        resolve(false);
      }, CONNECT_TIMEOUT_MS);

      try {
        socket = new WebSocket(url);
        this.connections.set(url, socket);
      } catch {
        clearTimeout(timeout);
        this.onStatus(`Could not connect to ${url}.`);
        resolve(false);
        return;
      }

      socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.addEventListener("message", (message) => this.handleMessage(url, message.data));
        socket.addEventListener("close", () => {
          if (this.connections.get(url) === socket) this.connections.delete(url);
          this.onStatus(`Disconnected from ${url}.`);
        });
        socket.addEventListener("error", () => this.onStatus(`Connection issue with ${url}.`));
        socket.send(JSON.stringify(["REQ", this.subscriptionId, { kinds: [1], limit: 80 }]));
        resolve(true);
      }, { once: true });

      socket.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.onStatus(`Could not connect to ${url}.`);
        resolve(false);
      }, { once: true });
    });
  }

  handleMessage(url, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;

    if (message[0] === "EVENT" && message[1] === this.subscriptionId) {
      const event = message[2];
      if (event?.kind === 1 && typeof event.id === "string" && typeof event.content === "string") {
        this.onEvent(event, url);
      }
      return;
    }

    if (message[0] === "OK" && typeof message[1] === "string") {
      const pending = this.pendingAcks.get(message[1]);
      if (!pending) return;
      pending.acks.push({ relay: url, accepted: message[2] === true, message: message[3] });
      pending.finishIfComplete();
    }
  }

  async publish(event) {
    const sockets = [...this.connections.entries()]
      .filter(([, socket]) => socket.readyState === WebSocket.OPEN);
    if (sockets.length === 0) throw new Error("No relays are connected. Check your relay settings and try again.");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(), ACK_TIMEOUT_MS);
      const pending = {
        expected: sockets.length,
        acks: [],
        finishIfComplete: () => {
          if (pending.acks.length >= pending.expected) finish();
        },
      };
      const finish = () => {
        clearTimeout(timer);
        this.pendingAcks.delete(event.id);
        const accepted = pending.acks.filter((ack) => ack.accepted);
        if (accepted.length) resolve(accepted);
        else if (pending.acks.length) {
          reject(new Error(pending.acks.map((ack) => ack.message || `Rejected by ${ack.relay}`).join("; ")));
        } else reject(new Error("No relay confirmed the post. It may still have been received."));
      };

      this.pendingAcks.set(event.id, pending);
      try {
        for (const [, socket] of sockets) socket.send(JSON.stringify(["EVENT", event]));
      } catch {
        finish();
      }
    });
  }

  close() {
    for (const [url, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(["CLOSE", this.subscriptionId]));
      socket.close();
      this.connections.delete(url);
    }
  }
}
