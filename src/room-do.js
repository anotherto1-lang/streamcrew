const VALID_KINDS = ["screen", "cam", "mic"];
const MAX_PEOPLE = 10;
const HEARTBEAT_MS = 20000;

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.roomName = null;
    this.roomInitialized = false;
    this.isPrivate = false;
    this.code = "";
    this.chatLog = null;
  }

  async fetch(request) {
    const headerRoom = request.headers.get("x-room");
    if (headerRoom) this.roomName = headerRoom;

    if (this.chatLog === null) {
      this.chatLog = (await this.state.storage.get("chat")) || [];
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  attach(ws) {
    ws.accept();
    const session = {
      id: crypto.randomUUID(),
      ws,
      name: "convidado",
      kinds: [],
      version: 0,
      joined: false,
    };
    this.sessions.set(session.id, session);

    ws.addEventListener("message", (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      this.onMessage(session, msg);
    });

    const cleanup = () => {
      if (!this.sessions.has(session.id)) return;
      this.sessions.delete(session.id);
      if (session.joined) {
        this.broadcast({ type: "peer-left", id: session.id });
        this.syncRegistry();
      }
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  activeCount() {
    let n = 0;
    for (const s of this.sessions.values()) if (s.joined) n++;
    return n;
  }

  onMessage(session, msg) {
    switch (msg.type) {
      case "join": {
        if (session.joined) return;

        if (!this.roomInitialized) {
          const code = String(msg.code || "");
          this.isPrivate = code.length === 6;
          this.code = code;
          this.roomInitialized = true;
        } else if (this.isPrivate && String(msg.code || "") !== this.code) {
          this.send(session, { type: "error", reason: this.code ? "codigo" : "codigo" });
          session.ws.close();
          return;
        }

        if (this.activeCount() >= MAX_PEOPLE) {
          this.send(session, { type: "error", reason: "cheia" });
          session.ws.close();
          return;
        }

        const name = String(msg.name || "").trim().slice(0, 24);
        session.name = name || "convidado";
        session.joined = true;

        this.send(session, {
          type: "welcome",
          id: session.id,
          priv: this.isPrivate,
          max: MAX_PEOPLE,
          history: this.chatLog.slice(-50),
          peers: [...this.sessions.values()]
            .filter((s) => s.joined && s.id !== session.id)
            .map((s) => ({ id: s.id, name: s.name, kinds: s.kinds, version: s.version })),
        });
        this.broadcast(
          {
            type: "peer-joined",
            peer: {
              id: session.id,
              name: session.name,
              kinds: session.kinds,
              version: session.version,
            },
          },
          session.id
        );
        this.syncRegistry();
        break;
      }
      case "rename": {
        if (!session.joined) return;
        const name = String(msg.name || "").trim().slice(0, 24);
        if (!name) return;
        session.name = name;
        this.broadcast({ type: "rename", id: session.id, name });
        break;
      }
      case "chat": {
        if (!session.joined) return;
        const text = String(msg.text || "").trim().slice(0, 500);
        if (!text) return;

        const now = Date.now();
        session.msgTimes ??= [];
        session.msgTimes = session.msgTimes.filter((t) => now - t < 10000);
        if (session.msgTimes.length >= 5) {
          if (!session.warnedAt || now - session.warnedAt > 5000) {
            session.warnedAt = now;
            this.send(session, { type: "flood" });
          }
          return;
        }
        session.msgTimes.push(now);

        const chatMsg = {
          type: "chat",
          id: session.id,
          name: session.name,
          text,
          at: now,
        };
        this.broadcast(chatMsg);
        this.chatLog.push(chatMsg);
        if (this.chatLog.length > 50) this.chatLog.splice(0, this.chatLog.length - 50);
        this.state.storage.put("chat", this.chatLog).catch(() => {});
        break;
      }
      case "publish": {
        if (!session.joined) return;
        const kinds = Array.isArray(msg.kinds)
          ? [...new Set(msg.kinds.filter((k) => VALID_KINDS.includes(k)))]
          : [];
        session.kinds = kinds;
        session.version += 1;
        this.broadcast({
          type: "publish",
          id: session.id,
          name: session.name,
          kinds: session.kinds,
          version: session.version,
        });
        break;
      }
      case "signal": {
        if (!session.joined) return;
        const target = this.sessions.get(msg.to);
        if (!target || !target.joined) return;
        this.send(target, { type: "signal", from: session.id, data: msg.data });
        break;
      }
    }
  }

  async alarm() {
    if (this.activeCount() > 0) {
      await this.syncRegistry();
    } else {
      await this.state.storage.deleteAll();
      this.roomInitialized = false;
      this.isPrivate = false;
      this.code = "";
    }
  }

  async syncRegistry() {
    if (!this.roomName || !this.env.REGISTRY) return;
    try {
      const id = this.env.REGISTRY.idFromName("global");
      const stub = this.env.REGISTRY.get(id);
      const count = this.activeCount();
      if (count === 0) {
        await this.state.storage.deleteAlarm();
        await stub.fetch(`https://registry/remove?room=${encodeURIComponent(this.roomName)}`);
        return;
      }
      await stub.fetch("https://registry/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: this.roomName, count, priv: this.isPrivate }),
      });
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    } catch {}
  }

  send(session, msg) {
    if (session.ws.readyState === 1) {
      session.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg, exceptId) {
    for (const s of this.sessions.values()) {
      if (s.joined && s.id !== exceptId) this.send(s, msg);
    }
  }
}
