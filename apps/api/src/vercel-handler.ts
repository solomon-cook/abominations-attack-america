import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaRoomStore } from "./prisma-store.js";
import { prisma } from "../lib/prisma.js";
import { ApiMetrics } from "./metrics.js";

const origins = new Set((process.env.ALLOWED_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
const metrics = new ApiMetrics();
const store = prisma ? new PrismaRoomStore(prisma) : undefined;

function respond(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown) {
  const origin = String(req.headers.origin ?? "");
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
    "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-room-token",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", vary: "Origin",
  };
  if (origins.has(origin)) headers["access-control-allow-origin"] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65_536) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  }
  return raw ? JSON.parse(raw) as Record<string, any> : {};
}

const roomToken = (req: IncomingMessage, url: URL, input: Record<string, any> = {}) =>
  String(req.headers["x-room-token"] ?? url.searchParams.get("token") ?? input.token ?? "");

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!store || !prisma) return respond(req, res, 503, { ok: false, error: "Preview persistence is not configured." });
  if (req.method === "OPTIONS") return respond(req, res, 204, {});
  if (req.headers.origin && !origins.has(String(req.headers.origin))) return respond(req, res, 403, { error: "Origin is not allowed." });
  metrics.request();
  const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
  const queryPath = (req as IncomingMessage & { query?: { path?: string | string[] } }).query?.path;
  const routePath = (Array.isArray(queryPath) ? queryPath.join("/") : queryPath) ?? url.pathname.replace(/^\/api\/?/, "");
  const parts = routePath.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && parts[0] === "health") {
      try { return respond(req, res, 200, { ok: true, ...(await store.health()), realtimeFanout: { mode: "http-polling", ready: true } }); }
      catch { return respond(req, res, 503, { ok: false, persistence: "prisma", realtimeFanout: { mode: "http-polling", ready: true } }); }
    }
    if (req.method === "GET" && parts[0] === "metrics") return respond(req, res, 200, metrics.snapshot());
    if (req.method === "GET" && parts[0] === "rooms" && parts[1] === "public") return respond(req, res, 200, await store.listPublicRooms());
    if (req.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await readBody(req);
      return respond(req, res, 201, await store.createRoom(Number(input.maxPlayers ?? 4), String(input.displayName ?? "Player 1"), input.privacy === "public" ? "public" : "private"));
    }
    if (parts[0] !== "rooms" || !parts[1]) return respond(req, res, 404, { error: "Not found" });
    const code = parts[1];
    if (req.method === "POST" && parts[2] === "join") return respond(req, res, 200, await store.joinRoom(code, String((await readBody(req)).displayName ?? "Player")));
    if (req.method === "POST" && parts[2] === "spectate") return respond(req, res, 200, await store.spectateRoom(code, String((await readBody(req)).displayName ?? "Spectator")));
    if (req.method === "POST" && parts[2] === "disconnect") { const input = await readBody(req); return respond(req, res, 200, await store.disconnect(code, roomToken(req, url, input), String(input.connectionId ?? "legacy"))); }
    if (req.method === "POST" && parts[2] === "reconnect") { const input = await readBody(req); metrics.reconnect(); return respond(req, res, 200, await store.reconnect(code, roomToken(req, url, input), String(input.connectionId ?? "legacy"))); }
    if (req.method === "POST" && parts[2] === "rotate-session") return respond(req, res, 200, await store.rotateSession(code, roomToken(req, url, await readBody(req))));
    if (req.method === "POST" && parts[2] === "setup") { const input = await readBody(req); return respond(req, res, 200, await store.setupAction(code, roomToken(req, url, input), input.action, Number(input.expectedRevision))); }
    if (req.method === "POST" && parts[2] === "ready") { const input = await readBody(req); return respond(req, res, 200, await store.setReady(code, roomToken(req, url, input), Boolean(input.ready))); }
    if (req.method === "GET" && parts[2] === "state") return respond(req, res, 200, await store.getRoom(code, roomToken(req, url), Number(url.searchParams.get("afterVersion") ?? 0)));
    if (req.method === "POST" && parts[2] === "actions") {
      const input = await readBody(req);
      const envelope = input.envelope ?? { actionId: String(input.actionId ?? randomUUID()), actorId: String(input.actorId ?? ""), expectedRevision: Number(input.expectedRevision), protocolVersion: Number(input.protocolVersion ?? 1), command: input.command };
      metrics.commandAccepted();
      return respond(req, res, 200, await store.submitAction(code, roomToken(req, url, input), envelope));
    }
    return respond(req, res, 404, { error: "Not found" });
  } catch (error) {
    metrics.requestFailure();
    const status = Number((error as { status?: number }).status ?? 400);
    return respond(req, res, status, { error: error instanceof Error ? error.message : "Request failed" });
  }
}
