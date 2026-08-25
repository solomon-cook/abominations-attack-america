import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { GameCommand } from "@abominations/game-engine";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { PrismaRoomStore } from "./prisma-store.js";

const port = Number(process.env.PORT ?? 8787);
const store: RoomStore = process.env.DATABASE_URL ? new PrismaRoomStore() : new MemoryRoomStore();
const sockets = new Map<string, Set<WebSocket>>();

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-room-token", "access-control-allow-methods": "GET,POST,OPTIONS" });
  response.end(JSON.stringify(body));
};
const body = async (request: IncomingMessage) => { let value = ""; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {}; };
const tokenFrom = (request: IncomingMessage, url: URL, input?: Record<string, unknown>) => String(request.headers["x-room-token"] ?? url.searchParams.get("token") ?? input?.token ?? "");
const broadcast = (roomCode: string, message: unknown) => { for (const socket of sockets.get(roomCode) ?? []) if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); };

async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method === "OPTIONS") return json(response, 204, {});
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (request.method === "GET" && parts[0] === "health") return json(response, 200, { ok: true, persistence: process.env.DATABASE_URL ? "prisma" : "memory" });
    if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await body(request); return json(response, 201, await store.createRoom(Math.min(4, Math.max(2, Number(input.maxPlayers ?? 4)))));
    }
    if (parts[0] !== "rooms" || !parts[1]) return json(response, 404, { error: "Not found" });
    const code = parts[1];
    if (request.method === "POST" && parts[2] === "join") return json(response, 200, await store.joinRoom(code, String((await body(request)).displayName ?? "Player")));
    if (request.method === "POST" && parts[2] === "spectate") return json(response, 200, await store.spectateRoom(code, String((await body(request)).displayName ?? "Spectator")));
    if (request.method === "GET" && parts[2] === "state") return json(response, 200, await store.getRoom(code, tokenFrom(request, url), Number(url.searchParams.get("afterVersion") ?? 0)));
    if (request.method === "POST" && parts[2] === "actions") {
      const input = await body(request); const result = await store.submitAction(code, tokenFrom(request, url, input), String(input.actionId ?? randomUUID()), input.command as GameCommand); broadcast(code.toUpperCase(), { type: "room.updated", room: result }); return json(response, 200, result);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : "Request failed" }); }
}

const server = createServer(handler);
const wsServer = new WebSocketServer({ server, path: "/ws" });
wsServer.on("connection", async (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); const code = String(url.searchParams.get("code") ?? "").toUpperCase(); const token = String(url.searchParams.get("token") ?? "");
  try { const room = await store.getRoom(code, token); const group = sockets.get(code) ?? new Set<WebSocket>(); group.add(socket); sockets.set(code, group); socket.send(JSON.stringify({ type: "room.updated", room })); socket.on("close", () => group.delete(socket)); }
  catch { socket.close(1008, "Invalid room token"); }
});
server.listen(port, () => console.log(`API listening on http://localhost:${port}`));
