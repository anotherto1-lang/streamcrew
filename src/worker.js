import { RoomDO } from "./room-do.js";
import { RegistryDO } from "./registry-do.js";

export { RoomDO, RegistryDO };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms") {
      const id = env.REGISTRY.idFromName("global");
      const stub = env.REGISTRY.get(id);
      const res = await stub.fetch("https://registry/list");
      return new Response(res.body, {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const room = sanitizeRoom(url.searchParams.get("room"));
      if (!room) {
        return new Response("Sala inválida", { status: 400 });
      }
      const id = env.ROOMS.idFromName(room);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set("x-room", room);
      return stub.fetch(new Request(request.url, { headers }));
    }

    return env.ASSETS.fetch(request);
  },
};

function sanitizeRoom(raw) {
  if (!raw) return null;
  const name = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 48);
  return name || null;
}
