import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { GameDomainError, type GameCommandEnvelope, type SetupAction } from "@abominations/game-engine";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { PrismaRoomStore } from "./prisma-store.js";
import { withinRate, type RateBucket } from "./rate-limit.js";
import { ApiMetrics } from "./metrics.js";
import { createErrorReporterSink, ErrorReporter } from "./error-reporting.js";
import { additionalClientDomainErrors } from "./client-domain-errors.js";
import { validateRuntimeConfig } from "./runtime-config.js";
import { AccountService, accountSessionCookie, clearAccountSessionCookie, sessionFromCookie } from "./accounts.js";
import type { LeaderboardCategory } from "@abominations/shared";
import { prisma } from "../lib/prisma.js";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL ?? process.env.PRISMA_DATABASE_URL ?? process.env.POSTGRES_URL;
const runtimeConfig = validateRuntimeConfig();
const allowedOrigin = runtimeConfig.allowedOrigin === "*" ? "http://localhost:5173" : runtimeConfig.allowedOrigin;
const allowDevelopmentFixture = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEVELOPMENT_FIXTURE === "true";
const usePrisma = Boolean(databaseUrl) && process.env.PERSISTENCE !== "memory" && (!allowDevelopmentFixture || process.env.PERSISTENCE === "prisma");
const store: RoomStore = usePrisma
  ? new PrismaRoomStore(undefined, allowDevelopmentFixture)
  : new MemoryRoomStore(allowDevelopmentFixture);
const accountService = prisma && usePrisma ? new AccountService(prisma) : undefined;
type SocketLease = { participantId: string; connectionId: string; sessionHash: string };
const sockets = new Map<string, Map<WebSocket, SocketLease>>();
const broadcastQueues = new Map<string, Promise<void>>();
const RATE_WINDOW_MS = 60_000;
const configuredDevelopmentLimit = (name: string, fallback: number) => {
  if (!allowDevelopmentFixture) return fallback;
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= fallback ? value : fallback;
};
const RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_API_RATE_LIMIT", 120);
const WEBSOCKET_RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_WS_RATE_LIMIT", 30);
const WEBSOCKET_COMMAND_RATE_LIMIT = configuredDevelopmentLimit("DEVELOPMENT_WS_COMMAND_RATE_LIMIT", 120);
const MAX_JSON_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS_TIMEOUT_MS = 20_000;
const isLeaderboardCategory = (value: string): value is LeaderboardCategory => value === "wins"
  || value === "win-rate"
  || value === "stomped-tiles"
  || value === "damage-taken"
  || value === "health-gained"
  || value === "luck";
const mutationRate = new Map<string, RateBucket>();
const socketRate = new Map<string, RateBucket>();
const socketCommandRate = new Map<string, RateBucket>();
const metrics = new ApiMetrics();
const errorReporter = new ErrorReporter(createErrorReporterSink({
  endpoint: process.env.ERROR_ALERT_URL,
  log: (line) => operationalLog({ event: "error.reporter", detail: line }),
}));

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
function assertSameOriginIfSupplied(request: IncomingMessage) {
  const requestOrigin = request.headers.origin;
  if (requestOrigin !== undefined && requestOrigin !== allowedOrigin) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
}
const safeAccountErrors = new Set([
  "Enter a valid email address.",
  "Password must be between 12 and 128 characters.",
  "An account with that email already exists.",
  "Email or password is incorrect.",
  "Verify your email before signing in.",
  "This account link is invalid.",
  "This account link is expired or has already been used.",
  "This reset link is expired or has already been used.",
  "That username is already in use.",
  "Username must be 3–24 letters, numbers, hyphens, or underscores.",
  "Account not found.",
  "Player not found.",
  "Verify your email before linking a game seat.",
  "Only a player seat can be linked to an account.",
  "This seat is already linked to another account.",
  "Only an active match seat can be linked to an account.",
  "You do not have a player seat in this match.",
  "This seat was resumed from another session. Refresh and try again.",
]);
// The stores and setup engine still expose some expected client/domain failures
// as plain Errors. Keep this compatibility list exact so database/runtime errors
// cannot accidentally inherit the old blanket-400 behavior.
const clientDomainErrors = new Set([
  "Room privacy must be private or public.",
  "Room not found.",
  "This room has expired.",
  "This room is full.",
  "This room is private and does not allow spectator entry.",
  "Invalid room token.",
  "This room connection was replaced. Reconnect with the current lease.",
  "Readiness can only change while a room is waiting.",
  "Only players can change readiness.",
  "Reconnect before changing readiness.",
  "Only seated players can complete setup.",
  "This room has no setup state.",
  "Spectators cannot submit game actions.",
  "This seat is currently being controlled by the room bot. Reconnect to take control.",
  "Command actor does not match the room participant.",
  "This room is completed; no further gameplay actions are legal.",
  "This room is not ready for gameplay.",
  "It is not your turn.",
  "This room connection is already connected.",
  "WebSocket ticket is invalid or expired.",
  "WebSocket ticket was issued for a replaced room session.",
  "Session token has expired.",
  "Room participant not found.",
  "WebSocket ticket was replaced by a newer connection.",
  "This room session was replaced. Sign in again to resume.",
  "This room session was replaced. Sign in again to continue.",
  "The room changed before setup was committed. Refresh and try again.",
  "This room session was replaced. Reconnect before completing setup.",
  "This seat was linked from another session. Refresh the room and try again.",
  "You do not have a player seat in this match.",
  "Bot control changed before this action was committed.",
  "The game changed before this action was committed. Refresh and try again.",
  "Bot setup became stale.",
  "This WebSocket connection has been replaced. Reconnect to continue.",
  "This WebSocket connection was replaced. Reconnect to continue.",
  "This WebSocket connection was replaced or its room session expired. Reconnect to continue.",
  "WebSocket ticket was replaced or its room session was expired or rotated.",
  "WebSocket ticket was issued for an expired or replaced room session.",
  "The selected room session was replaced. Reconnect to continue.",
  "A match needs another player before a concession can produce a winner.",
  "Choose at least one starting troop.",
  "Every player must confirm a starting choice.",
  "Setup is not complete.",
  "Every player needs one distinct monster.",
  "Every player needs one distinct eligible branch.",
  "Every player needs one distinct lair.",
  "Monster selection is not the current setup step.",
  "Monster selection must follow the ordered setup turn.",
  "Branch selection is not the current setup step.",
  "Branch selection must follow reverse seat order.",
  "Lair selection is not the current setup step.",
  "Starting choice is not the current setup step.",
  "Starting choices must follow player order.",
  ...additionalClientDomainErrors,
]);
const clientDomainErrorPatterns = [
  /^Expected revision \d+, current revision is \d+\.$/,
  /^Unknown setup seat \d+\.$/,
  /^Monster .+ must have exactly three distinct configured lairs\.$/,
  /^Monster .+ is not in the configured setup catalogue\.$/,
  /^Monster .+ has already been claimed\.$/,
  /^Branch .+ is not eligible for player selection\.$/,
  /^Branch .+ has already been claimed\.$/,
  /^Lair .+ is not valid for this monster\.$/,
  /^Lair .+ has already been claimed\.$/,
  /^Player \d+ already chose a starting option\.$/,
];
const isKnownClientError = (error: unknown) => {
  if (error instanceof HttpError) return true;
  if (error instanceof GameDomainError) return error.code !== "INTERNAL_INVARIANT";
  if (!(error instanceof Error)) return false;
  return safeAccountErrors.has(error.message)
    || clientDomainErrors.has(error.message)
    || clientDomainErrorPatterns.some((pattern) => pattern.test(error.message));
};
const body = async (request: IncomingMessage) => {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (Buffer.byteLength(value, "utf8") > MAX_JSON_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  }
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
  // Treat JSON null like an omitted optional body; route-specific required fields
  // then produce their established validation response.
  if (parsed === null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Request body must be a JSON object.");
  return parsed as Record<string, unknown>;
};
const isSetupAction = (value: unknown): value is SetupAction => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (action.type === "choose-monster") return typeof action.monsterId === "string";
  if (action.type === "choose-branch") return typeof action.branch === "string";
  if (action.type === "choose-lair") return typeof action.lair === "string";
  if (action.type !== "choose-starting-choice" || action.startingChoice === null || typeof action.startingChoice !== "object" || Array.isArray(action.startingChoice)) return false;
  const choice = action.startingChoice as Record<string, unknown>;
  if (choice.kind === "research") return true;
  if (choice.kind !== "deploy") return false;
  if ("placements" in choice) {
    return Array.isArray(choice.placements) && choice.placements.every((placement) => placement !== null
      && typeof placement === "object" && !Array.isArray(placement)
      && typeof (placement as Record<string, unknown>).unitId === "string"
      && typeof (placement as Record<string, unknown>).destination === "string");
  }
  return typeof choice.unitId === "string" && typeof choice.destination === "string";
};
const isGameCommandEnvelope = (value: unknown): value is GameCommandEnvelope => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (typeof envelope.actionId !== "string" || envelope.actionId.length < 1 || envelope.actionId.length > 128) return false;
  if (typeof envelope.actorId !== "string" || envelope.actorId.length < 1 || envelope.actorId.length > 128) return false;
  if (!Number.isSafeInteger(envelope.expectedRevision) || Number(envelope.expectedRevision) < 0) return false;
  if (!Number.isSafeInteger(envelope.protocolVersion)) return false;
  if (!envelope.command || typeof envelope.command !== "object" || Array.isArray(envelope.command)) return false;
  return typeof (envelope.command as Record<string, unknown>).type === "string";
};
const requestedConnectionIdFrom = (input: Record<string, unknown>) => {
  const requested = input.requestedConnectionId;
  if (requested === undefined) return randomUUID();
  if (typeof requested !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)) {
    throw new HttpError(400, "Requested room connection ID must be a UUID.");
  }
  return requested;
};
const pendingConnectionIdFrom = (input: Record<string, unknown>) => {
  const pending = input.pendingConnectionId;
  if (pending === undefined) return undefined;
  if (typeof pending !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending)) {
    throw new HttpError(400, "Pending room connection ID must be a UUID.");
  }
  return pending;
};
const tokenFrom = (request: IncomingMessage, url: URL, input?: Record<string, unknown>) => String(request.headers["x-room-token"] ?? url.searchParams.get("token") ?? input?.token ?? "");
const operationalLog = (entry: Record<string, unknown>) => console.info(JSON.stringify({ service: "abominations-api", at: new Date().toISOString(), ...entry }));
const requestAddress = (request: IncomingMessage) => request.socket.remoteAddress ?? "unknown";
const rejectRate = (response: ServerResponse) => {
  return json(response, 429, { error: "Too many requests. Try again shortly." }, { "retry-after": "60" });
};
const afterVersionFrom = (url: URL) => {
  const cursors = url.searchParams.getAll("afterVersion");
  if (cursors.length > 1) throw new HttpError(400, "afterVersion may only be supplied once.");
  if (cursors.length === 0) return 0;
  const raw = cursors[0];
  if (!/^\d+$/.test(raw)) throw new HttpError(400, "afterVersion must be a non-negative safe integer.");
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) throw new HttpError(400, "afterVersion must be a non-negative safe integer.");
  return version;
};
const closeParticipantSockets = (roomCode: string, participantId: string, exceptConnectionId?: string) => {
  const code = roomCode.toUpperCase();
  const group = sockets.get(code);
  if (!group) return;
  for (const [socket, lease] of group) {
    if (lease.participantId !== participantId || lease.connectionId === exceptConnectionId) continue;
    group.delete(socket);
    if (socket.readyState === socket.OPEN) socket.close(4001, "Room connection was replaced");
  }
  if (group.size === 0 && sockets.get(code) === group) sockets.delete(code);
};
const broadcast = async (roomCode: string) => {
  const code = roomCode.toUpperCase();
  const previous = broadcastQueues.get(code) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const group = sockets.get(code);
    if (!group) return;
    await Promise.all([...group.entries()].map(async ([socket, lease]) => {
      if (socket.readyState !== socket.OPEN) return;
      try {
        const room = await store.getRoomForConnection(code, lease.participantId, lease.connectionId, lease.sessionHash);
        if (!room) {
          group.delete(socket);
          socket.close(4001, "Room connection was replaced");
          return;
        }
        // A lease may have been replaced locally while the projection was loading.
        if (socket.readyState !== socket.OPEN || sockets.get(code) !== group || group.get(socket) !== lease) return;
        socket.send(JSON.stringify({ type: "room.updated", room }));
      } catch (error) {
        if (sockets.get(code) !== group || group.get(socket) !== lease) return;
        metrics.errorReport("divergence");
        errorReporter.report({ category: "divergence", path: "/ws", roomCode: code, message: error instanceof Error ? `WebSocket projection divergence: ${error.message}` : "WebSocket projection divergence" });
        group.delete(socket);
        socket.close(1008, "Room access is no longer valid");
      }
    }));
    if (group.size === 0 && sockets.get(code) === group) sockets.delete(code);
  });
  broadcastQueues.set(code, current);
  try {
    await current;
  } finally {
    if (broadcastQueues.get(code) === current) broadcastQueues.delete(code);
  }
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
    if (request.method === "GET" && parts[0] === "health" && parts.length === 1) {
      try {
        return json(response, 200, { ok: true, ...(await store.health()) });
      } catch (error) {
        metrics.requestFailure();
        metrics.serverError();
        metrics.errorReport("persistence");
        const reported = errorReporter.report({ category: "persistence", method: request.method, path: url.pathname, message: error instanceof Error ? error.message : "Persistence health check failed" });
        return json(response, 503, { ok: false, error: "Persistence health check failed" });
      }
    }
    if (request.method === "GET" && parts[0] === "metrics" && parts.length === 1) return json(response, 200, metrics.snapshot());
    if (parts[0] === "accounts") {
      const exactAccountPath = (parts.length === 2 && ["register", "login", "logout", "verify-email", "resend-verification", "password-reset", "me"].includes(parts[1]!))
        || (parts.length === 3 && parts[1] === "password-reset" && parts[2] === "complete")
        || (parts.length === 3 && parts[1] === "me" && ["games", "stats"].includes(parts[2]!))
        || (parts.length === 5 && parts[1] === "me" && parts[2] === "games" && parts[4] === "resume");
      if (!exactAccountPath) return json(response, 404, { error: "Not found" });
      if (request.method !== "GET") assertSameOriginIfSupplied(request);
      if (!accountService) throw new HttpError(503, "Accounts require database persistence.");
      const input = request.method === "GET" ? {} : await body(request);
      const currentUser = async () => {
        const user = await accountService.authenticate(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
        if (!user) throw new HttpError(401, "Sign in to use this account feature.");
        return user;
      };
      if (request.method === "POST" && parts.length === 2 && parts[1] === "register") return json(response, 201, await accountService.register(String(input.email ?? ""), String(input.password ?? "")));
      if (request.method === "POST" && parts.length === 2 && parts[1] === "login") {
        const result = await accountService.login(String(input.email ?? ""), String(input.password ?? ""));
        return json(response, 200, { account: result.account, message: result.message }, { "set-cookie": accountSessionCookie(result.sessionToken!) });
      }
      if (request.method === "POST" && parts.length === 2 && parts[1] === "logout") {
        await accountService.logout(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
        return json(response, 200, { message: "Signed out." }, { "set-cookie": clearAccountSessionCookie() });
      }
      if (request.method === "POST" && parts.length === 2 && parts[1] === "verify-email") {
        const result = await accountService.verifyEmail(String(input.token ?? ""));
        return json(response, 200, { account: result.account, message: result.message }, { "set-cookie": accountSessionCookie(result.sessionToken!) });
      }
      if (request.method === "POST" && parts.length === 2 && parts[1] === "resend-verification") return json(response, 200, await accountService.resendVerification(String(input.email ?? "")));
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
      if (request.method === "GET" && parts.length === 3 && parts[1] === "me" && parts[2] === "games") {
        const user = await currentUser();
        return json(response, 200, await accountService.listGames(user.id));
      }
      if (request.method === "GET" && parts.length === 3 && parts[1] === "me" && parts[2] === "stats") {
        const user = await currentUser();
        return json(response, 200, await accountService.getStats(user.id));
      }
      if (request.method === "POST" && parts.length === 5 && parts[1] === "me" && parts[2] === "games" && parts[4] === "resume") {
        const user = await currentUser();
        if (!(store instanceof PrismaRoomStore)) throw new HttpError(503, "Match recovery requires database persistence.");
        const result = await store.resumeParticipant(parts[3]!, user);
        closeParticipantSockets(result.room.code, result.participantId);
        await broadcast(result.room.code);
        return json(response, 200, result);
      }
      return json(response, 404, { error: "Not found" });
    }
    if (request.method === "GET" && parts[0] === "players" && parts[1] && parts.length === 2) {
      if (!accountService) throw new HttpError(503, "Player profiles require database persistence.");
      return json(response, 200, await accountService.publicProfile(decodeURIComponent(parts[1])));
    }
    if (request.method === "GET" && parts[0] === "leaderboard" && parts.length === 1) {
      const category = url.searchParams.get("category") ?? "wins";
      if (!isLeaderboardCategory(category)) throw new HttpError(400, "Unknown leaderboard category.");
      if (!accountService) return json(response, 200, []);
      return json(response, 200, await accountService.leaderboard(category));
    }
    if (request.method === "GET" && parts[0] === "rooms" && parts[1] === "public") {
      if (parts.length !== 2) return json(response, 404, { error: "Not found" });
      return json(response, 200, await store.listPublicRooms());
    }
    if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const input = await body(request);
      const privacy = input.privacy === undefined ? "private" : input.privacy;
      if (privacy !== "private" && privacy !== "public") throw new HttpError(400, "Room privacy must be private or public.");
      return json(response, 201, await store.createRoom(Number(input.maxPlayers ?? 4), String(input.displayName ?? "Player 1"), privacy));
    }
    if (parts[0] !== "rooms" || !parts[1]) return json(response, 404, { error: "Not found" });
    if (parts.length !== 3) return json(response, 404, { error: "Not found" });
    const code = parts[1];
    if (request.method === "POST" && parts[2] === "claim") {
      assertSameOriginIfSupplied(request);
      if (!accountService || !(store instanceof PrismaRoomStore)) throw new HttpError(503, "Account linking requires database persistence.");
      const user = await accountService.authenticate(decodeURIComponent(sessionFromCookie(String(request.headers.cookie ?? ""))));
      if (!user) throw new HttpError(401, "Sign in to link this seat.");
      const result = await store.claimParticipant(code, tokenFrom(request, url), user);
      closeParticipantSockets(code, result.participantId);
      await broadcast(code);
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "ws-ticket") {
      const accessToken = tokenFrom(request, url);
      const input = await body(request);
      const participantId = await store.participantIdForToken(code, accessToken);
      const expectedConnectionId = typeof input.connectionId === "string" ? input.connectionId : null;
      const requestedConnectionId = requestedConnectionIdFrom(input);
      const ticket = await store.createSocketTicket(code, accessToken, expectedConnectionId, requestedConnectionId);
      closeParticipantSockets(code, participantId);
      await broadcast(code.toUpperCase());
      return json(response, 200, ticket);
    }
    if (request.method === "POST" && parts[2] === "join") {
      const result = await store.joinRoom(code, String((await body(request)).displayName ?? "Player"));
      await broadcast(code.toUpperCase());
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "spectate") {
      const result = await store.spectateRoom(code, String((await body(request)).displayName ?? "Spectator"));
      await broadcast(code.toUpperCase());
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "disconnect") {
      const input = await body(request);
      const accessToken = tokenFrom(request, url, input);
      const participantId = await store.participantIdForToken(code, accessToken);
      const result = await store.disconnect(code, accessToken, String(input.connectionId ?? "legacy"), pendingConnectionIdFrom(input));
      if (!result.participants.find((participant) => participant.id === participantId)?.connected) closeParticipantSockets(code, participantId);
      await broadcast(code.toUpperCase());
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "reconnect") {
      const input = await body(request);
      const accessToken = tokenFrom(request, url, input);
      const participantId = await store.participantIdForToken(code, accessToken);
      const nextConnectionId = requestedConnectionIdFrom(input);
      const result = await store.reconnect(code, accessToken, String(input.connectionId ?? "legacy"), nextConnectionId);
      closeParticipantSockets(code, participantId, nextConnectionId);
      metrics.reconnect();
      await broadcast(code.toUpperCase());
      return json(response, 200, { ...result, connectionId: nextConnectionId });
    }
    if (request.method === "POST" && parts[2] === "rotate-session") {
      const input = await body(request);
      const result = await store.rotateSession(code, tokenFrom(request, url, input));
      closeParticipantSockets(code, result.participantId);
      await broadcast(code.toUpperCase());
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "setup") {
      const input = await body(request);
      if (!isSetupAction(input.action)) throw new HttpError(400, "Setup action is invalid.");
      const action = input.action;
      const result = await store.setupAction(code, tokenFrom(request, url, input), action, Number(input.expectedRevision));
      operationalLog({ event: "setup.accepted", roomCode: code.toUpperCase(), actionType: action.type, revision: result.version });
      await broadcast(code.toUpperCase());
      return json(response, 200, result);
    }
    if (request.method === "POST" && parts[2] === "ready") { const input = await body(request); if (typeof input?.ready !== "boolean") throw new HttpError(400, "The ready field must be a boolean."); const result = await store.setReady(code, tokenFrom(request, url, input), input.ready); operationalLog({ event: "ready.accepted", roomCode: code.toUpperCase(), revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result); }
    if (request.method === "GET" && parts[2] === "state") return json(response, 200, await store.getRoom(code, tokenFrom(request, url), afterVersionFrom(url)));
    if (request.method === "POST" && parts[2] === "actions") {
      const input = await body(request);
      const candidate = input.envelope === undefined
        ? { actionId: input.actionId ?? randomUUID(), actorId: input.actorId ?? "", expectedRevision: input.expectedRevision, protocolVersion: input.protocolVersion ?? 1, command: input.command }
        : input.envelope;
      if (!isGameCommandEnvelope(candidate)) throw new HttpError(400, "Command envelope is invalid.");
      const envelope = candidate;
      const result = await store.submitAction(code, tokenFrom(request, url, input), envelope); metrics.commandAccepted(); metrics.latency(Date.now() - requestStartedAt); if (result.status === "completed") metrics.roomCompleted(); if (result.status === "abandoned") metrics.roomAbandoned(); operationalLog({ event: "command.accepted", roomCode: code.toUpperCase(), actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, revision: result.version }); await broadcast(code.toUpperCase()); return json(response, 200, result);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    metrics.requestFailure();
    metrics.latency(Date.now() - requestStartedAt);
    const errorCategory = parts[2] === "actions" ? "command" : "http";
    const privateRoute = parts[0] === "accounts" || parts[0] === "players" || parts[2] === "claim";
    const knownClientError = isKnownClientError(error);
    const status = error instanceof HttpError ? error.status : knownClientError ? 400 : 500;
    if (status >= 500) metrics.serverError();
    metrics.errorReport(errorCategory);
    if (parts[2] === "actions") metrics.commandFailed();
    const rawMessage = error instanceof Error ? error.message : "Request failed";
    const responseMessage = status >= 500
      ? (privateRoute ? "Account request failed." : "Request failed.")
      : error instanceof HttpError
        ? error.message
        : privateRoute
          ? (safeAccountErrors.has(rawMessage) ? rawMessage : "Account request failed.")
          : knownClientError
            ? rawMessage
            : "Request failed.";
    const reportMessage = privateRoute ? "Account request failed." : status >= 500 ? rawMessage : responseMessage;
    const reported = errorReporter.report({ category: errorCategory, method: request.method, path: url.pathname, roomCode: parts[1]?.toUpperCase(), message: reportMessage });
    operationalLog({ event: "request.failed", method: request.method, path: url.pathname, error: reported.message });
    return json(response, status, { error: responseMessage });
  }
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
const wsServer = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_JSON_BODY_BYTES,
  verifyClient: ({ req }, callback) => {
    const origin = req.headers.origin;
    if (origin === undefined || origin === allowedOrigin) callback(true);
    else callback(false, 403, "Request origin is not allowed.");
  },
});
wsServer.on("connection", async (socket, request) => {
  if (!withinRate(socketRate, requestAddress(request), Date.now(), RATE_WINDOW_MS, WEBSOCKET_RATE_LIMIT)) {
    metrics.websocketFailure();
    socket.close(1013, "Too many connection attempts");
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); const code = String(url.searchParams.get("code") ?? "").toUpperCase(); const ticket = String(url.searchParams.get("ticket") ?? "");
  try {
    const principal = await store.consumeSocketTicket(code, ticket);
    const connectionId = principal.connectionId;
    await store.connectParticipant(code, principal.participantId, connectionId, principal.sessionHash);
    const currentRoom = await store.getRoomForConnection(code, principal.participantId, connectionId, principal.sessionHash);
    if (!currentRoom) {
      socket.close(4001, "Room connection was replaced");
      return;
    }
    // A participant has one authoritative live socket. Replacing it also revokes its
    // ability to receive future private projections over the old connection.
    closeParticipantSockets(code, principal.participantId);
    const group = sockets.get(code) ?? new Map<WebSocket, SocketLease>();
    const lease: SocketLease = { participantId: principal.participantId, connectionId, sessionHash: principal.sessionHash };
    metrics.websocketConnection();
    group.set(socket, lease);
    sockets.set(code, group);
    socket.on("close", () => {
      group.delete(socket);
      if (group.size === 0 && sockets.get(code) === group) sockets.delete(code);
      void store.disconnectParticipant(code, principal.participantId, connectionId)
        .then(() => broadcast(code))
        .catch(() => undefined);
    });
    const healthSocket = socket as WebSocket & { isAlive?: boolean };
    healthSocket.isAlive = true;
    socket.on("pong", () => { healthSocket.isAlive = true; });
    const initialRoom = await store.getRoomForConnection(code, principal.participantId, connectionId, principal.sessionHash);
    if (!initialRoom || socket.readyState !== socket.OPEN || sockets.get(code) !== group || group.get(socket) !== lease) {
      group.delete(socket);
      if (socket.readyState === socket.OPEN) socket.close(4001, "Room connection was replaced");
      return;
    }
    socket.send(JSON.stringify({ type: "room.updated", room: initialRoom }));
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
          // The acknowledgement carries no room projection. The subsequent broadcast
          // reloads this socket's lease before sending any private room state.
          send({ type: "command.accepted", actionId: envelope.actionId, version: updatedRoom.version });
          await broadcast(code);
        })
        .catch((error) => {
          metrics.commandFailed();
          metrics.errorReport("command");
          const rawMessage = error instanceof Error ? error.message : "Command failed.";
          const clientMessage = isKnownClientError(error) ? rawMessage : "Command failed. Try again.";
          const reported = errorReporter.report({ category: "command", method: "WS", path: "/ws", roomCode: code, message: rawMessage });
          operationalLog({ event: "command.failed", transport: "websocket", roomCode: code, actionId: envelope.actionId, actorId: envelope.actorId, commandType: envelope.command.type, error: reported.message });
          send({ type: "command.rejected", actionId: envelope.actionId, error: clientMessage });
        });
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
  return message.type === "command.submit" && isGameCommandEnvelope(message.envelope);
}
