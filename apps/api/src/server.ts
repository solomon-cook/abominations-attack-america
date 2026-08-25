import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { GameCommandEnvelope } from "@abominations/game-engine";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { PrismaRoomStore } from "./prisma-store.js";
import { withinRate, type RateBucket } from "./rate-limit.js";
import { ApiMetrics } from "./metrics.js";
import { ErrorReporter } from "./error-reporting.js";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL;
const allowDevelopmentFixture = process.env.ALLOW_DEVELOPMENT_FIXTURE === "true";
const store: RoomStore = allowDevelopmentFixture ? new MemoryRoomStore(true) : databaseUrl ? new PrismaRoomStore() : new MemoryRoomStore(false);
const sockets = new Map<string, Map<WebSocket, string>>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const mutationRate = new Map<string, RateBucket>();
const socketRate = new Map<string, RateBucket>();
const metrics = new ApiMetrics();
const errorReporter = new ErrorReporter((report) => operationalLog({ event: report.alert ? "alert.error-threshold" : "error.reported", ...report }));

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": process.env.ALLOWED_ORIGIN ?? "*",
    "access-control-allow-headers": "content-type,x-room-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(body));
};
const body = async (request: IncomingMessage) => { let value = ""; for await (const chunk of request) value += chunk; return value ? JSON.parse(value) : {}; };
const tokenFrom = (request: IncomingMessage, url: URL, input?: Record<string, unknown>) => String(request.headers["x-room-token"] ?? url.searchParams.get("token") ?? input?.token ?? "");
const operationalLog = (entry: Record<string, unknown>) => console.info(JSON.stringify({ service: "abominations-api", at: new Date().toISOString(), ...entry }));
const requestAddress = (request: IncomingMessage) => request.socket.remoteAddress ?? "unknown";
const rejectRate = (response: ServerResponse) => {
  response.writeHead(429, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "60", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify({ error: "Too many requests. Try again shortly." }));
};
const broadcast = async (roomCode: string) => {
  const group = sockets.get(roomCode);
  if (!group) return;
  await Promise.all([...group.entries()].map(async ([socket, accessToken]) => {
    if (socket.readyState !== socket.OPEN) return;
    try {
      const room = await store.getRoom(roomCode, accessToken);
      socket.send(JSON.stringify({ type: "room.updated", room }));
    } catch {
      group.delete(socket);
      socket.close(1008, "Room access is no longer valid");
    }
  }));
  if (group.size === 0) sockets.delete(roomCode);
};

async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method === "OPTIONS") return json(response, 204, {});
  metrics.request();
  const requestStartedAt = Date.now();
  const address = requestAddress(request);
  if (!withinRate(mutationRate, address, Date.now(), RATE_WINDOW_MS, RATE_LIMIT)) {
    metrics.requestFailure();
    return rejectRate(response);
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (request.method === "GET" && parts[0] === "health") {
      try {
        return json(response, 200, { ok: true, ...(await store.health()) });
      } catch (error) {
        metrics.requestFailure();
        metrics.serverError();
        const reported = errorReporter.report({ category: "persistence", method: request.method, path: url.pathname, message: error instanceof Error ? error.message : "Persistence health check failed" });
        return json(response, 503, { ok: false, error: "Persistence health check failed", detail: reported.message });
      }
    }
    if (request.method === "GET" && parts[0] === "metrics") return json(response, 200, metrics.snapshot());
    if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await body(request); return json(response, 201, await store.createRoom(Number(input.maxPlayers ?? 4)));
    }
    if (parts[0] !== "rooms" || !parts[1]) return json(response, 404, { error: "Not found" });
    const code = parts[1];
    if (request.method === "POST" && parts[2] === "join") return json(response, 200, await store.joinRoom(code, String((await body(request)).displayName ?? "Player")));
    if (request.method === "POST" && parts[2] === "spectate") return json(response, 200, await store.spectateRoom(code, String((await body(request)).displayName ?? "Spectator")));
    if (request.method === "POST" && parts[2] === "disconnect") { const input = await body(request); return json(response, 200, await store.disconnect(code, tokenFrom(request, url, input), String(input.connectionId ?? "legacy"))); }
    if (request.method === "POST" && parts[2] === "reconnect") { const input = await body(request); const result = await store.reconnect(code, tokenFrom(request, url, input), String(input.connectionId ?? "legacy")); metrics.reconnect(); return json(response, 200, result); }
    if (request.method === "POST" && parts[2] === "rotate-session") { const input = await body(request); return json(response, 200, await store.rotateSession(code, tokenFrom(request, url, input))); }
    if (request.method === "POST" && parts[2] === "setup") { const input = await body(request); const result = await store.setupAction(code, tokenFrom(request, url, input), input.action, Number(input.expectedRevision)); operationalLog({ event: "setup.accepted", roomCode: code.toUpperCase(), actionType: input.action?.type, revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "POST" && parts[2] === "ready") { const input = await body(request); const result = await store.setReady(code, tokenFrom(request, url, input), Boolean(input.ready)); operationalLog({ event: "ready.accepted", roomCode: code.toUpperCase(), revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "GET" && parts[2] === "state") return json(response, 200, await store.getRoom(code, tokenFrom(request, url), Number(url.searchParams.get("afterVersion") ?? 0)));
    if (request.method === "POST" && parts[2] === "actions") {
      const input = await body(request); const envelope = (input.envelope ?? { actionId: String(input.actionId ?? randomUUID()), actorId: String(input.actorId ?? ""), expectedRevision: Number(input.expectedRevision), protocolVersion: Number(input.protocolVersion ?? 1), command: input.command }) as GameCommandEnvelope; const result = await store.submitAction(code, tokenFrom(request, url, input), envelope); metrics.commandAccepted(); metrics.latency(Date.now() - requestStartedAt); if (result.status === "completed") metrics.roomCompleted(); if (result.status === "abandoned") metrics.roomAbandoned(); operationalLog({ event: "command.accepted", roomCode: code.toUpperCase(), actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) { metrics.requestFailure(); metrics.serverError(); metrics.latency(Date.now() - requestStartedAt); if (parts[2] === "actions") metrics.commandFailed(); const reported = errorReporter.report({ category: parts[2] === "actions" ? "command" : "http", method: request.method, path: url.pathname, roomCode: parts[1]?.toUpperCase(), message: error instanceof Error ? error.message : "Request failed" }); operationalLog({ event: "request.failed", method: request.method, path: url.pathname, error: reported.message }); return json(response, 400, { error: reported.message }); }
}

const server = createServer(handler);
const wsServer = new WebSocketServer({ server, path: "/ws" });
wsServer.on("connection", async (socket, request) => {
  if (!withinRate(socketRate, requestAddress(request), Date.now(), RATE_WINDOW_MS, 30)) {
    metrics.websocketFailure();
    socket.close(1013, "Too many connection attempts");
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); const code = String(url.searchParams.get("code") ?? "").toUpperCase(); const token = String(url.searchParams.get("token") ?? "");
  try {
    const room = await store.getRoom(code, token);
    const group = sockets.get(code) ?? new Map<WebSocket, string>();
    metrics.websocketConnection();
    group.set(socket, token);
    sockets.set(code, group);
    socket.send(JSON.stringify({ type: "room.updated", room }));
    socket.on("close", () => {
      group.delete(socket);
      if (group.size === 0) sockets.delete(code);
    });
  }
  catch (error) { metrics.websocketFailure(); errorReporter.report({ category: "websocket", path: "/ws", roomCode: code, message: error instanceof Error ? error.message : "WebSocket room access failed" }); socket.close(1008, "Invalid room token"); }
});
server.listen(port, () => console.log(`API listening on http://localhost:${port}`));
