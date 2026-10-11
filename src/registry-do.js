const STALE_MS = 45000;

export class RegistryDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loaded = false;
    this.rooms = new Map();
  }

  async load() {
    if (!this.loaded) {
      const stored = await this.state.storage.get("rooms");
      if (stored) this.rooms = stored;
      this.loaded = true;
    }
  }

  async save() {
    await this.state.storage.put("rooms", this.rooms);
  }

  cleanup() {
    const now = Date.now();
    let dirty = false;
    for (const [name, info] of this.rooms) {
      if (now - info.at > STALE_MS) {
        this.rooms.delete(name);
        dirty = true;
      }
    }
    return dirty;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname === "/register") {
      const body = await request.json();
      const room = String(body.room || "").slice(0, 48);
      if (!room) return json({ ok: false }, 400);
      this.cleanup();
      this.rooms.set(room, {
        count: Math.max(0, Math.min(9999, Number(body.count) || 0)),
        priv: !!body.priv,
        at: Date.now(),
      });
      await this.save();
      return json({ ok: true });
    }

    if (url.pathname === "/remove") {
      const room = url.searchParams.get("room");
      if (room && this.rooms.delete(room)) await this.save();
      return json({ ok: true });
    }

    if (url.pathname === "/list") {
      const dirty = this.cleanup();
      if (dirty) await this.save();
      const rooms = [...this.rooms.entries()]
        .map(([name, info]) => ({ name, count: info.count, priv: info.priv }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return json({ rooms });
    }

    return json({ ok: false }, 404);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
