import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaRoomStore } from "./prisma-store.js";
import { databasePoolDiagnostics, prisma } from "../lib/prisma.js";
import { ApiMetrics } from "./metrics.js";
import { AccountService, accountSessionCookie, clearAccountSessionCookie, sessionFromCookie } from "./accounts.js";
import { classifyApiError } from "./api-errors.js";

const origins = new Set((process.env.ALLOWED_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
const metrics = new ApiMetrics();
const store = prisma ? new PrismaRoomStore(prisma) : undefined;
const accountService = prisma ? new AccountService(prisma) : undefined;

function respond(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown) {
  const origin = String(req.headers.origin ?? "");
  const headers: Record<string, string | string[]> = {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
    "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-room-token",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", vary: "Origin",
  };
  const cookies = (res as ServerResponse & { pendingCookies?: string[] }).pendingCookies;
  if (cookies?.length) headers["set-cookie"] = cookies;
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
  const requestStartedAt = Date.now();
  try {
    if (req.method === "GET" && parts[0] === "health") {
      try { return respond(req, res, 200, { ok: true, ...(await store.health()), realtimeFanout: { mode: "http-polling", ready: true } }); }
      catch (error) {
        const failure = error as { name?: unknown; code?: unknown };
        const classification = classifyApiError(error);
        const safeName = typeof failure?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(failure.name) ? failure.name : "UnknownError";
        const safeCode = typeof failure?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(failure.code) ? failure.code : "unavailable";
        console.error("Prisma health query failed", JSON.stringify({ name: safeName, code: safeCode, ...(classification.category === "database-timeout" ? { timeoutKind: classification.timeoutKind } : {}), pool: databasePoolDiagnostics() }));
        metrics.requestFailure();
        metrics.serverError();
        return respond(req, res, 503, { ok: false, persistence: "prisma", realtimeFanout: { mode: "http-polling", ready: true } });
      }
    }
    if (req.method === "GET" && parts[0] === "metrics") return respond(req, res, 200, metrics.snapshot());
    if (parts[0] === "leaderboard" && req.method === "GET") {
      const category = url.searchParams.get("category") ?? "wins";
      const valid = ["wins", "win-rate", "stomped-tiles", "damage-taken", "health-gained", "luck"];
      if (!valid.includes(category)) return respond(req, res, 400, { error: "Unknown leaderboard category." });
      return respond(req, res, 200, accountService ? await accountService.leaderboard(category as any) : []);
    }
    if (parts[0] === "players" && parts[1] && req.method === "GET") {
      if (!accountService) return respond(req, res, 503, { error: "Player profiles require database persistence." });
      return respond(req, res, 200, await accountService.publicProfile(decodeURIComponent(parts[1])));
    }
    if (parts[0] === "accounts") {
      if (!accountService) return respond(req, res, 503, { error: "Accounts require database persistence." });
      const input = req.method === "GET" ? {} : await readBody(req);
      const currentUser = async () => {
        const user = await accountService.authenticate(decodeURIComponent(sessionFromCookie(String(req.headers.cookie ?? ""))));
        if (!user) throw Object.assign(new Error("Sign in to use this account feature."), { status: 401 });
        return user;
      };
      if (req.method === "POST" && parts[1] === "register") return respond(req, res, 201, await accountService.register(String(input.email ?? ""), String(input.password ?? "")));
      if (req.method === "POST" && parts[1] === "login") {
        const result = await accountService.login(String(input.email ?? ""), String(input.password ?? ""));
        (res as ServerResponse & { pendingCookies?: string[] }).pendingCookies = [accountSessionCookie(result.sessionToken!)];
        return respond(req, res, 200, { account: result.account, message: result.message });
      }
      if (req.method === "POST" && parts[1] === "logout") {
        await accountService.logout(decodeURIComponent(sessionFromCookie(String(req.headers.cookie ?? ""))));
        (res as ServerResponse & { pendingCookies?: string[] }).pendingCookies = [clearAccountSessionCookie()];
        return respond(req, res, 200, { message: "Signed out." });
      }
      if (req.method === "POST" && parts[1] === "verify-email") {
        const result = await accountService.verifyEmail(String(input.token ?? ""));
        (res as ServerResponse & { pendingCookies?: string[] }).pendingCookies = [accountSessionCookie(result.sessionToken!)];
        return respond(req, res, 200, { account: result.account, message: result.message });
      }
      if (req.method === "POST" && parts[1] === "resend-verification") return respond(req, res, 200, await accountService.resendVerification(String(input.email ?? "")));
      if (req.method === "POST" && parts[1] === "password-reset" && parts.length === 2) return respond(req, res, 200, await accountService.requestPasswordReset(String(input.email ?? "")));
      if (req.method === "POST" && parts[1] === "password-reset" && parts[2] === "complete") return respond(req, res, 200, await accountService.completePasswordReset(String(input.token ?? ""), String(input.password ?? "")));
      if (req.method === "GET" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser();
        return respond(req, res, 200, { account: { id: user.id, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) } });
      }
      if (req.method === "PATCH" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser(); return respond(req, res, 200, { account: await accountService.updateUsername(user.id, String(input.username ?? "")) });
      }
      if (req.method === "DELETE" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser(); await accountService.deleteAccount(user);
        (res as ServerResponse & { pendingCookies?: string[] }).pendingCookies = [clearAccountSessionCookie()];
        return respond(req, res, 200, { message: "Account deleted." });
      }
      if (req.method === "GET" && parts[1] === "me" && parts[2] === "games") { const user = await currentUser(); return respond(req, res, 200, await accountService.listGames(user.id)); }
      if (req.method === "GET" && parts[1] === "me" && parts[2] === "stats") { const user = await currentUser(); return respond(req, res, 200, await accountService.getStats(user.id)); }
      if (req.method === "GET" && parts[1] === "me" && parts[2] === "privacy") { const user = await currentUser(); return respond(req, res, 200, await accountService.getPrivacySettings(user.id)); }
      if (req.method === "PATCH" && parts[1] === "me" && parts[2] === "privacy") {
        const user = await currentUser();
        if (typeof input.publicStatsEnabled !== "boolean") return respond(req, res, 400, { error: "publicStatsEnabled must be true or false." });
        return respond(req, res, 200, await accountService.updatePrivacySettings(user.id, input.publicStatsEnabled));
      }
      if (req.method === "GET" && parts[1] === "me" && parts[2] === "social") { const user = await currentUser(); return respond(req, res, 200, await accountService.socialSummary(user.id)); }
      return respond(req, res, 404, { error: "Not found" });
    }
    if (req.method === "GET" && parts[0] === "rooms" && parts[1] === "public") return respond(req, res, 200, await store.listPublicRooms());
    if (req.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await readBody(req);
      return respond(req, res, 201, await store.createRoom(Number(input.maxPlayers ?? 4), String(input.displayName ?? "Player 1"), input.privacy === "public" ? "public" : "private"));
    }
    if (parts[0] !== "rooms" || !parts[1]) return respond(req, res, 404, { error: "Not found" });
    const code = parts[1];
    if (req.method === "POST" && parts[2] === "join") return respond(req, res, 200, await store.joinRoom(code, String((await readBody(req)).displayName ?? "Player")));
    if (req.method === "POST" && parts[2] === "viewer-link") return respond(req, res, 200, await store.createViewerInvite(code, roomToken(req, url)));
    if (req.method === "POST" && parts[2] === "start") return respond(req, res, 200, await store.startMatch(code, roomToken(req, url)));
    if (req.method === "POST" && parts[2] === "spectate") { const input = await readBody(req); return respond(req, res, 200, await store.spectateRoom(code, String(input.displayName ?? "Spectator"), typeof input.viewerToken === "string" ? input.viewerToken : undefined)); }
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
    const failure = classifyApiError(error);
    metrics.latency(Date.now() - requestStartedAt);
    if (failure.status >= 500) metrics.serverError();
    const route = parts[0] === "rooms" ? "rooms" + (parts[2] ? "/:" + parts[2] : "") : parts[0] ?? "unknown";
    console.error("API request failed", JSON.stringify({ method: req.method, route, category: failure.category, name: failure.errorName, code: failure.errorCode, durationMs: Date.now() - requestStartedAt, ...(failure.category === "database-timeout" ? { timeoutKind: failure.timeoutKind, pool: databasePoolDiagnostics() } : {}) }));
    return respond(req, res, failure.status, { error: failure.message });
  }
}
