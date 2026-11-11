import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { GameCommandEnvelope } from "@abominations/game-engine";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { PrismaRoomStore } from "./prisma-store.js";
import { withinRate, type RateBucket } from "./rate-limit.js";
import { ApiMetrics } from "./metrics.js";
import { createDurableErrorAggregateWriter, createErrorReporterSink, ErrorReporter } from "./error-reporting.js";
import { resolveDatabaseConnections, validateRuntimeConfig } from "./runtime-config.js";
import { AccountService, accountSessionCookie, clearAccountSessionCookie, sessionFromCookie } from "./accounts.js";
import { prisma } from "../lib/prisma.js";
import { RoomChangeListener } from "./room-change-listener.js";

const port = Number(process.env.PORT ?? 8787);
const { databaseUrl, roomNotificationsUrl } = resolveDatabaseConnections();
const runtimeConfig = validateRuntimeConfig();
const allowedOrigin = runtimeConfig.allowedOrigin === "*" ? "http://localhost:5173" : runtimeConfig.allowedOrigin;
const allowDevelopmentFixture = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEVELOPMENT_FIXTURE === "true";
const usePrisma = Boolean(databaseUrl) && process.env.PERSISTENCE !== "memory" && (!allowDevelopmentFixture || process.env.PERSISTENCE === "prisma");
const testRoomSeed = () => {
  if (process.env.NODE_ENV !== "test" || !["memory", "prisma"].includes(process.env.PERSISTENCE ?? "") || process.env.TEST_ROOM_SEED === undefined) return undefined;
  const seed = Number(process.env.TEST_ROOM_SEED);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error("TEST_ROOM_SEED must be an unsigned 32-bit integer in test-only memory or Prisma mode.");
  return seed;
};
const sockets = new Map<string, Map<WebSocket, string>>();
let roomNotificationsReady = !usePrisma;
const RATE_WINDOW_MS = 60_000;
const configuredDevelopmentLimit = (name: string, fallback: number) => {
  if (process.env.NODE_ENV === "production") return fallback;
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= fallback ? value : fallback;
};
const RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_API_RATE_LIMIT", 120);
const WEBSOCKET_RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_WS_RATE_LIMIT", 30);
const WEBSOCKET_COMMAND_RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_WS_COMMAND_RATE_LIMIT", 120);
const MAX_JSON_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS_TIMEOUT_MS = 20_000;
const mutationRate = new Map<string, RateBucket>();
const socketRate = new Map<string, RateBucket>();
const socketCommandRate = new Map<string, RateBucket>();
const metrics = new ApiMetrics();
const errorAggregationClient = prisma;
const persistDurableErrorAggregate = errorAggregationClient ? createDurableErrorAggregateWriter({
  increment: async ({ category, bucketDate }) => {
    const bucketStart = new Date(`${bucketDate}T00:00:00.000Z`);
    await errorAggregationClient.errorReportAggregate.upsert({
      where: { bucketDate_category: { bucketDate: bucketStart, category } },
      create: { bucketDate: bucketStart, category, count: 1 },
      update: { count: { increment: 1 } },
    });
  },
  pruneBefore: async (bucketDate) => {
    const retentionCutoff = new Date(`${bucketDate}T00:00:00.000Z`);
    await errorAggregationClient.errorReportAggregate.deleteMany({ where: { bucketDate: { lt: retentionCutoff } } });
  },
}) : undefined;
const errorReporter = new ErrorReporter(createErrorReporterSink({
  endpoint: runtimeConfig.errorAlertUrl,
  log: (line) => operationalLog({ event: "error.reporter", detail: line }),
  persistAggregate: persistDurableErrorAggregate,
}));
const store: RoomStore = usePrisma
  ? new PrismaRoomStore(undefined, allowDevelopmentFixture, (issue) => {
      metrics.errorReport("divergence");
      errorReporter.report({
        category: "divergence",
        path: "/rooms/snapshot-events",
        roomCode: issue.roomCode,
        message: `Snapshot revision ${issue.snapshotVersion}; latest event ${issue.latestEventVersion ?? "missing"}; ${issue.missingVersionCount} missing event version(s).`,
      });
    }, testRoomSeed())
  : new MemoryRoomStore(allowDevelopmentFixture, testRoomSeed());
const accountService = prisma && usePrisma ? new AccountService(prisma) : undefined;

const json = (response: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,x-room-token",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    vary: "Origin",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
};
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const safeAccountErrors = new Set([
  "Enter a valid email address.",
  "Password must be between 12 and 128 characters.",
  "An account with that email already exists.",
  "Could not create an account. Try again.",
  "Email or password is incorrect.",
  "Verify your email before signing in.",
  "This account link is invalid.",
  "This account link is expired or has already been used.",
  "That username is already in use.",
  "Username must be 3–24 letters, numbers, hyphens, or underscores.",
  "Account not found.",
  "Player not found.",
  "That player cannot be invited.",
  "That invitation is no longer available.",
  "Friend not found.",
  "That player cannot be saved.",
  "That invitation link is unavailable.",
  "Revoke an active friend link before creating another.",
  "Verify your email before linking a game seat.",
  "Only a player seat can be linked to an account.",
  "This seat is already linked to another account.",
  "Only an active match seat can be linked to an account.",
  "You do not have a player seat in this match.",
]);
const body = async (request: IncomingMessage) => {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (Buffer.byteLength(value, "utf8") > MAX_JSON_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  }
  return value ? JSON.parse(value) : {};
};
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
  await Promise.all([...group.entries()].map(async ([socket, participantId]) => {
    if (socket.readyState !== socket.OPEN) return;
    try {
      const room = await store.getRoomForParticipant(roomCode, participantId);
      socket.send(JSON.stringify({ type: "room.updated", room }));
    } catch (error) {
      metrics.errorReport("divergence");
      errorReporter.report({ category: "divergence", path: "/ws", roomCode: roomCode.toUpperCase(), message: error instanceof Error ? `WebSocket projection divergence: ${error.message}` : "WebSocket projection divergence" });
      group.delete(socket);
      socket.close(1008, "Room access is no longer valid");
    }
  }));
  if (group.size === 0) sockets.delete(roomCode);
};

const roomChangeListener = usePrisma && roomNotificationsUrl ? new RoomChangeListener(
  roomNotificationsUrl,
  (roomCode) => broadcast(roomCode),
  (error) => {
    metrics.errorReport("persistence");
    errorReporter.report({ category: "persistence", path: "/worker/room-notifications", message: error instanceof Error ? error.message : "PostgreSQL room notification failed." });
  },
  (ready) => {
    roomNotificationsReady = ready;
    operationalLog({ event: ready ? "room-notifications.ready" : "room-notifications.unavailable" });
    if (!ready && usePrisma) {
      for (const group of sockets.values()) for (const socket of group.keys()) socket.close(1012, "Realtime fanout is reconnecting");
    }
  },
) : undefined;
if (roomChangeListener) await roomChangeListener.start();

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
        const healthy = !usePrisma || roomNotificationsReady;
        return json(response, healthy ? 200 : 503, { ok: healthy, ...(await store.health()), realtimeFanout: { mode: usePrisma ? "postgres-notify" : "process-local", ready: roomNotificationsReady } });
      } catch (error) {
        metrics.requestFailure();
        metrics.serverError();
        metrics.errorReport("persistence");
        const reported = errorReporter.report({ category: "persistence", method: request.method, path: url.pathname, message: error instanceof Error ? error.message : "Persistence health check failed" });
        return json(response, 503, { ok: false, error: "Persistence health check failed", detail: reported.message });
      }
    }
    if (request.method === "GET" && parts[0] === "metrics") return json(response, 200, metrics.snapshot());
    if (parts[0] === "accounts") {
      if (!accountService) throw new HttpError(503, "Accounts require database persistence.");
      const input = request.method === "GET" ? {} : await body(request);
      const currentUser = async () => {
        const user = await accountService.authenticate(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
        if (!user) throw new HttpError(401, "Sign in to use this account feature.");
        return user;
      };
      if (request.method === "POST" && parts[1] === "register") return json(response, 201, await accountService.register(String(input.email ?? ""), String(input.password ?? "")));
      if (request.method === "POST" && parts[1] === "login") {
        const result = await accountService.login(String(input.email ?? ""), String(input.password ?? ""));
        return json(response, 200, { account: result.account, message: result.message }, { "set-cookie": accountSessionCookie(result.sessionToken!) });
      }
      if (request.method === "POST" && parts[1] === "logout") {
        await accountService.logout(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
        return json(response, 200, { message: "Signed out." }, { "set-cookie": clearAccountSessionCookie() });
      }
      if (request.method === "POST" && parts[1] === "verify-email") {
        const result = await accountService.verifyEmail(String(input.token ?? ""));
        return json(response, 200, { account: result.account, message: result.message }, { "set-cookie": accountSessionCookie(result.sessionToken!) });
      }
      if (request.method === "POST" && parts[1] === "resend-verification") return json(response, 200, await accountService.resendVerification(String(input.email ?? "")));
      if (request.method === "POST" && parts[1] === "password-reset" && parts.length === 2) return json(response, 200, await accountService.requestPasswordReset(String(input.email ?? "")));
      if (request.method === "POST" && parts[1] === "password-reset" && parts[2] === "complete" && parts.length === 3) return json(response, 200, await accountService.completePasswordReset(String(input.token ?? ""), String(input.password ?? "")));
      if (request.method === "GET" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser();
        return json(response, 200, { account: { id: user.id, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) } });
      }
      if (request.method === "PATCH" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser();
        return json(response, 200, { account: await accountService.updateUsername(user.id, String(input.username ?? "")) });
      }
      if (request.method === "DELETE" && parts.length === 2 && parts[1] === "me") {
        const user = await currentUser();
        await accountService.deleteAccount(user);
        return json(response, 200, { message: "Account deleted." }, { "set-cookie": clearAccountSessionCookie() });
      }
      if (request.method === "GET" && parts[1] === "me" && parts[2] === "games") {
        const user = await currentUser();
        return json(response, 200, await accountService.listGames(user.id));
      }
      if (request.method === "GET" && parts[1] === "me" && parts[2] === "stats") {
        const user = await currentUser();
        return json(response, 200, await accountService.getStats(user.id));
      }
      if (request.method === "GET" && parts[1] === "me" && parts[2] === "privacy") {
        const user = await currentUser();
        return json(response, 200, await accountService.getPrivacySettings(user.id));
      }
      if (request.method === "PATCH" && parts[1] === "me" && parts[2] === "privacy") {
        const user = await currentUser();
        if (typeof input.publicStatsEnabled !== "boolean") throw new HttpError(400, "publicStatsEnabled must be true or false.");
        return json(response, 200, await accountService.updatePrivacySettings(user.id, input.publicStatsEnabled));
      }
      if (request.method === "GET" && parts[1] === "me" && parts[2] === "social") {
        const user = await currentUser();
        return json(response, 200, await accountService.socialSummary(user.id));
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "friend-invite-links" && parts.length === 3) {
        const user = await currentUser();
        return json(response, 201, await accountService.createFriendInviteLink(user.id));
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "friend-invite-links" && parts[3] === "accept") {
        const user = await currentUser();
        await accountService.acceptFriendInviteLink(user.id, String(input.token ?? ""));
        return json(response, 200, { message: "Friend invitation accepted." });
      }
      if (request.method === "DELETE" && parts[1] === "me" && parts[2] === "friend-invite-links" && parts[3]) {
        const user = await currentUser();
        await accountService.revokeFriendInviteLink(user.id, decodeURIComponent(parts[3]));
        return json(response, 200, { message: "Friend invitation link revoked." });
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "friends" && parts[3] === "invitations" && parts.length === 4) {
        const user = await currentUser();
        await accountService.sendFriendInvitation(user.id, String(input.username ?? ""));
        return json(response, 200, { message: "Friend invitation sent if the player is available." });
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "friends" && parts[3] === "invitations" && parts[4]) {
        const user = await currentUser();
        const action = parts[5];
        if (action === "accept") await accountService.acceptFriendInvitation(user.id, decodeURIComponent(parts[4]));
        else if (action === "decline") await accountService.declineFriendInvitation(user.id, decodeURIComponent(parts[4]));
        else if (action === "revoke") await accountService.revokeFriendInvitation(user.id, decodeURIComponent(parts[4]));
        else throw new HttpError(404, "Not found");
        const resultMessage = action === "accept" ? "Invitation accepted." : action === "decline" ? "Invitation declined." : "Invitation revoked.";
        return json(response, 200, { message: resultMessage });
      }
      if (request.method === "DELETE" && parts[1] === "me" && parts[2] === "friends" && parts[3]) {
        const user = await currentUser();
        await accountService.removeFriend(user.id, decodeURIComponent(parts[3]));
        return json(response, 200, { message: "Friend removed." });
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "saved-opponents" && parts[3]) {
        const user = await currentUser();
        await accountService.saveOpponent(user.id, decodeURIComponent(parts[3]));
        return json(response, 200, { message: "Opponent saved." });
      }
      if (request.method === "DELETE" && parts[1] === "me" && parts[2] === "saved-opponents" && parts[3]) {
        const user = await currentUser();
        await accountService.removeSavedOpponent(user.id, decodeURIComponent(parts[3]));
        return json(response, 200, { message: "Saved opponent removed." });
      }
      if (request.method === "PATCH" && parts[1] === "me" && parts[2] === "presence") {
        const user = await currentUser();
        if (typeof input.enabled !== "boolean") throw new HttpError(400, "Presence setting must be true or false.");
        await accountService.setPresence(user.id, input.enabled);
        return json(response, 200, { message: input.enabled ? "Presence is visible to friends while active." : "Presence is hidden." });
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "presence" && parts[3] === "heartbeat") {
        const user = await currentUser();
        await accountService.refreshPresence(user.id);
        return json(response, 200, { message: "Presence refreshed." });
      }
      if (request.method === "POST" && parts[1] === "me" && parts[2] === "games" && parts[4] === "resume") {
        const user = await currentUser();
        if (!(store instanceof PrismaRoomStore)) throw new HttpError(503, "Match recovery requires database persistence.");
        return json(response, 200, await store.resumeParticipant(parts[3]!, user));
      }
      return json(response, 404, { error: "Not found" });
    }
    if (request.method === "GET" && parts[0] === "players" && parts[1]) {
      if (!accountService) throw new HttpError(503, "Player profiles require database persistence.");
      try {
        return json(response, 200, await accountService.publicProfile(decodeURIComponent(parts[1])));
      } catch (error) {
        if (error instanceof Error && error.message === "Player not found.") throw new HttpError(404, error.message);
        throw error;
      }
    }
    if (request.method === "GET" && parts[0] === "leaderboard") {
      const category = url.searchParams.get("category") ?? "wins";
      const valid = ["wins", "win-rate", "stomped-tiles", "damage-taken", "health-gained", "luck"];
      if (!valid.includes(category)) throw new HttpError(400, "Unknown leaderboard category.");
      if (!accountService) return json(response, 200, []);
      return json(response, 200, await accountService.leaderboard(category as any));
    }
    if (request.method === "GET" && parts[0] === "rooms" && parts[1] === "public") return json(response, 200, await store.listPublicRooms());
    if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await body(request); return json(response, 201, await store.createRoom(Number(input.maxPlayers ?? 4), String(input.displayName ?? "Player 1"), input.privacy === "public" ? "public" : "private"));
    }
    if (parts[0] !== "rooms" || !parts[1]) return json(response, 404, { error: "Not found" });
    const code = parts[1];
    if (request.method === "POST" && parts[2] === "claim") {
      if (!accountService || !(store instanceof PrismaRoomStore)) throw new HttpError(503, "Account linking requires database persistence.");
      const user = await accountService.authenticate(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
      if (!user) throw new HttpError(401, "Sign in to link this seat.");
      return json(response, 200, await store.claimParticipant(code, tokenFrom(request, url), user));
    }
    if (request.method === "POST" && parts[2] === "ws-ticket") return json(response, 200, { ticket: await store.createSocketTicket(code, tokenFrom(request, url)) });
    if (request.method === "POST" && parts[2] === "viewer-link") return json(response, 200, await store.createViewerInvite(code, tokenFrom(request, url)));
    if (request.method === "POST" && parts[2] === "join") return json(response, 200, await store.joinRoom(code, String((await body(request)).displayName ?? "Player")));
    if (request.method === "POST" && parts[2] === "spectate") { const input = await body(request); return json(response, 200, await store.spectateRoom(code, String(input.displayName ?? "Spectator"), typeof input.viewerToken === "string" ? input.viewerToken : undefined)); }
    if (request.method === "POST" && parts[2] === "start") { const result = await store.startMatch(code, tokenFrom(request, url)); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "POST" && parts[2] === "disconnect") { const input = await body(request); return json(response, 200, await store.disconnect(code, tokenFrom(request, url, input), String(input.connectionId ?? "legacy"))); }
    if (request.method === "POST" && parts[2] === "reconnect") { const input = await body(request); const result = await store.reconnect(code, tokenFrom(request, url, input), String(input.connectionId ?? "legacy")); metrics.reconnect(); return json(response, 200, result); }
    if (request.method === "POST" && parts[2] === "rotate-session") { const input = await body(request); return json(response, 200, await store.rotateSession(code, tokenFrom(request, url, input))); }
    if (request.method === "POST" && parts[2] === "setup") { const input = await body(request); const result = await store.setupAction(code, tokenFrom(request, url, input), input.action, Number(input.expectedRevision)); operationalLog({ event: "setup.accepted", roomCode: code.toUpperCase(), actionType: input.action?.type, revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "POST" && parts[2] === "ready") { const input = await body(request); const result = await store.setReady(code, tokenFrom(request, url, input), Boolean(input.ready)); operationalLog({ event: "ready.accepted", roomCode: code.toUpperCase(), revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "GET" && parts[2] === "replay") {
      if (parts[3] === "export") {
        const result = await store.getPublicReplayExport(code);
        const status = !result.replayable && result.reason === "not-found" ? 404 : !result.replayable && result.reason === "not-completed" ? 409 : 200;
        return json(response, status, result);
      }
      const fromVersion = Number(url.searchParams.get("fromVersion") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 8);
      const result = await store.getPublicReplay(code, fromVersion, limit);
      const status = !result.replayable && result.reason === "not-found" ? 404 : !result.replayable && result.reason === "not-completed" ? 409 : 200;
      return json(response, status, result);
    }
    if (request.method === "GET" && parts[2] === "state") return json(response, 200, await store.getRoom(code, tokenFrom(request, url), Number(url.searchParams.get("afterVersion") ?? 0)));
    if (request.method === "POST" && parts[2] === "actions") {
      const input = await body(request); const envelope = (input.envelope ?? { actionId: String(input.actionId ?? randomUUID()), actorId: String(input.actorId ?? ""), expectedRevision: Number(input.expectedRevision), protocolVersion: Number(input.protocolVersion ?? 1), command: input.command }) as GameCommandEnvelope; const result = await store.submitAction(code, tokenFrom(request, url, input), envelope); metrics.commandAccepted(); metrics.latency(Date.now() - requestStartedAt); if (result.status === "completed") metrics.roomCompleted(); if (result.status === "abandoned") metrics.roomAbandoned(); operationalLog({ event: "command.accepted", roomCode: code.toUpperCase(), actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) { metrics.requestFailure(); if (!(error instanceof HttpError) || error.status >= 500) metrics.serverError(); metrics.latency(Date.now() - requestStartedAt); const errorCategory = parts[2] === "actions" ? "command" : "http"; metrics.errorReport(errorCategory); if (parts[2] === "actions") metrics.commandFailed(); const privateRoute = parts[0] === "accounts" || parts[0] === "players" || parts[2] === "claim"; const rawMessage = error instanceof Error ? error.message : "Request failed"; const safeMessage = error instanceof HttpError ? error.message : privateRoute ? (safeAccountErrors.has(rawMessage) ? rawMessage : "Account request failed.") : rawMessage; const reported = errorReporter.report({ category: errorCategory, method: request.method, path: url.pathname, roomCode: parts[1]?.toUpperCase(), message: privateRoute ? "Account request failed." : safeMessage }); operationalLog({ event: "request.failed", method: request.method, path: url.pathname, error: reported.message }); return json(response, error instanceof HttpError ? error.status : 400, { error: safeMessage }); }
}

const server = createServer(handler);
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = REQUEST_TIMEOUT_MS;
server.on("error", (error) => {
  metrics.errorReport("deployment");
  errorReporter.report({ category: "deployment", path: "/listen", message: error instanceof Error ? `API listen failure: ${error.message}` : "API listen failure" });
  operationalLog({ event: "deployment.failure", message: error instanceof Error ? error.message : "API listen failure" });
  process.exitCode = 1;
});
const wsServer = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_JSON_BODY_BYTES });
wsServer.on("connection", async (socket, request) => {
  if (!withinRate(socketRate, requestAddress(request), Date.now(), RATE_WINDOW_MS, WEBSOCKET_RATE_LIMIT)) {
    metrics.websocketFailure();
    socket.close(1013, "Too many connection attempts");
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); const code = String(url.searchParams.get("code") ?? "").toUpperCase(); const ticket = String(url.searchParams.get("ticket") ?? "");
  try {
    const principal = await store.consumeSocketTicket(code, ticket);
    const connectionId = randomUUID();
    const room = await store.connectParticipant(code, principal.participantId, connectionId, principal.sessionHash);
    const group = sockets.get(code) ?? new Map<WebSocket, string>();
    metrics.websocketConnection();
    group.set(socket, principal.participantId);
    sockets.set(code, group);
    const healthSocket = socket as WebSocket & { isAlive?: boolean };
    healthSocket.isAlive = true;
    socket.on("pong", () => { healthSocket.isAlive = true; });
    socket.send(JSON.stringify({ type: "room.updated", room }));
    await broadcast(code);
    socket.on("message", (data, isBinary) => {
      const send = (message: unknown) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };
      const rejectProtocol = (error: string) => send({ type: "protocol.error", error });
      if (isBinary) {
        rejectProtocol("Only JSON text messages are supported.");
        return;
      }
      const address = requestAddress(request);
      if (!withinRate(socketCommandRate, address, Date.now(), RATE_WINDOW_MS, WEBSOCKET_COMMAND_RATE_LIMIT)) {
        rejectProtocol("Too many commands. Try again shortly.");
        return;
      }
      let message: unknown;
      try { message = JSON.parse(data.toString()); }
      catch {
        rejectProtocol("Message must be valid JSON.");
        return;
      }
      if (!isCommandSubmitMessage(message)) {
        rejectProtocol("Unsupported WebSocket message.");
        return;
      }
      const { envelope } = message;
      const startedAt = Date.now();
      void store.submitActionForParticipant(code, principal.participantId, connectionId, principal.sessionHash, envelope)
        .then(async (updatedRoom) => {
          metrics.commandAccepted();
          metrics.latency(Date.now() - startedAt);
          if (updatedRoom.status === "completed") metrics.roomCompleted();
          if (updatedRoom.status === "abandoned") metrics.roomAbandoned();
          operationalLog({ event: "command.accepted", transport: "websocket", roomCode: code, actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, revision: updatedRoom.version });
          send({ type: "command.accepted", actionId: envelope.actionId, room: updatedRoom });
          await broadcast(code);
        })
        .catch((error) => {
          metrics.commandFailed();
          metrics.errorReport("command");
          const message = error instanceof Error ? error.message : "Command failed.";
          errorReporter.report({ category: "command", method: "WS", path: "/ws", roomCode: code, message });
          operationalLog({ event: "command.failed", transport: "websocket", roomCode: code, actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, error: message });
          send({ type: "command.rejected", actionId: envelope.actionId, error: message });
        });
    });
    socket.on("close", () => {
      group.delete(socket);
      if (group.size === 0) sockets.delete(code);
      void store.disconnectParticipant(code, principal.participantId, connectionId)
        .then(() => broadcast(code))
        .catch(() => undefined);
    });
  }
  catch (error) { metrics.websocketFailure(); metrics.errorReport("websocket"); errorReporter.report({ category: "websocket", path: "/ws", roomCode: code, message: "WebSocket ticket rejected." }); socket.close(1008, "Invalid or expired WebSocket ticket"); }
});
const websocketHeartbeat = setInterval(() => {
  for (const group of sockets.values()) for (const socket of group.keys()) {
    const healthSocket = socket as WebSocket & { isAlive?: boolean };
    if (healthSocket.isAlive === false) { socket.terminate(); continue; }
    healthSocket.isAlive = false;
    socket.ping();
  }
}, 30_000);
websocketHeartbeat.unref();
const botWorker = setInterval(() => {
  void store.processBotTakeovers().then(async (roomCodes) => {
    for (const roomCode of roomCodes) await broadcast(roomCode);
  }).catch((error) => {
    errorReporter.report({ category: "persistence", path: "/worker/bot-takeover", message: error instanceof Error ? error.message : "Bot worker failed." });
  });
}, 5_000);
botWorker.unref();
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  operationalLog({ event: "deployment.shutdown", signal });
  clearInterval(websocketHeartbeat);
  clearInterval(botWorker);
  await roomChangeListener?.close();
  for (const group of sockets.values()) for (const socket of group.keys()) socket.terminate();
  sockets.clear();
  await new Promise<void>((resolve) => wsServer.close(() => resolve()));
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
  await store.close();
  process.exit(0);
};
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
server.listen(port, () => console.log(`API listening on http://localhost:${port}`));

function isCommandSubmitMessage(value: unknown): value is { type: "command.submit"; envelope: GameCommandEnvelope } {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.type !== "command.submit" || !message.envelope || typeof message.envelope !== "object") return false;
  const envelope = message.envelope as Record<string, unknown>;
  if (typeof envelope.actionId !== "string" || envelope.actionId.length < 1 || envelope.actionId.length > 128) return false;
  if (typeof envelope.actorId !== "string" || envelope.actorId.length < 1 || envelope.actorId.length > 128) return false;
  if (!Number.isSafeInteger(envelope.expectedRevision) || Number(envelope.expectedRevision) < 0) return false;
  if (!Number.isSafeInteger(envelope.protocolVersion)) return false;
  if (!envelope.command || typeof envelope.command !== "object") return false;
  return typeof (envelope.command as Record<string, unknown>).type === "string";
}
