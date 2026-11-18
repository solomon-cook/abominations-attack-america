import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { internal } from "./_generated/api.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MIGRATION_BODY_BYTES = 4 * 1024 * 1024;
const accountCookieName = "aaa_account";
const secureRequest = (request: Request) => new URL(request.url).protocol === "https:";
const sessionCookie = (value: string, secure: boolean) => `${accountCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`;
const clearSessionCookie = (secure: boolean) => `${accountCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
const accountToken = (request: Request) => {
  const cookie = request.headers.get("cookie") ?? "";
  const pair = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${accountCookieName}=`));
  if (!pair) return "";
  try { return decodeURIComponent(pair.slice(accountCookieName.length + 1)); } catch { return ""; }
};
const hashToken = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const localOrigins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const configuredOrigins = () => (process.env.WEB_APP_ORIGINS ?? process.env.ALLOWED_ORIGIN ?? "https://abominations-attack-america.vercel.app")
  .split(",").map((value) => value.trim()).filter(Boolean);

const corsOrigin = (origin: string | null) => {
  if (!origin) return undefined;
  if (localOrigins.has(origin) || configuredOrigins().includes(origin)) return origin;
  const preview = /^https:\/\/abominations-attack-america(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
  return preview ? origin : undefined;
};

function response(request: Request, status: number, value: unknown, headers: Record<string, string> = {}) {
  const origin = corsOrigin(request.headers.get("origin"));
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...(origin ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "content-type,x-room-token",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        vary: "Origin",
      } : {}),
      ...headers,
    },
  });
}

async function readBody(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  return raw ? JSON.parse(raw) as Record<string, any> : {};
}

async function readMigrationBody(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_MIGRATION_BODY_BYTES) throw new Error("Migration request body is too large.");
  return raw ? JSON.parse(raw) as Record<string, any> : {};
}

function constantTimeEqual(left: string, right: string) {
  const width = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < width; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return difference === 0;
}

async function handleMigration(ctx: any, request: Request, parts: string[]) {
  if (request.method !== "POST") return response(request, 405, { error: "Method not allowed." }, { allow: "POST" });
  const productionDeployment = process.env.CONVEX_DEPLOYMENT?.startsWith("prod:") === true;
  if ((process.env.APP_ENV === "production" || productionDeployment) && process.env.APP_ENV !== "migration") {
    return response(request, 404, { error: "Not found." });
  }
  const expected = process.env.CONVEX_MIGRATION_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  if (!expected || !constantTimeEqual(supplied, `Bearer ${expected}`)) return response(request, 404, { error: "Not found." });

  try {
    const body = await readMigrationBody(request);
    if (parts.length !== 3 || parts[0] !== "internal" || parts[1] !== "migration") return response(request, 404, { error: "Not found." });
    if (parts[2] === "begin") return response(request, 200, await ctx.runMutation(internal.migration.begin, {
      runId: String(body.runId ?? ""), expectedCounts: body.expectedCounts,
    }));
    if (parts[2] === "batch") return response(request, 200, await ctx.runMutation(internal.migration.importBatch, {
      runId: String(body.runId ?? ""), table: body.table, batchNumber: Number(body.batchNumber),
      sha256: String(body.sha256 ?? ""), rows: body.rows,
    }));
    if (parts[2] === "finish") return response(request, 200, await ctx.runMutation(internal.migration.finish, {
      runId: String(body.runId ?? ""),
    }));
    return response(request, 404, { error: "Not found." });
  } catch {
    // Migration rows include account credentials and match histories. Never echo
    // request bodies or backend validation details into HTTP responses/logs.
    return response(request, 400, { error: "Migration request rejected." });
  }
}

async function handle(ctx: any, request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !corsOrigin(origin)) return response(request, 403, { error: "Origin is not allowed." });
  if (request.method === "OPTIONS") return response(request, 204, {});
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] === "internal" && parts[1] === "migration") return handleMigration(ctx, request, parts);
  try {
    const body = ["POST", "PATCH", "DELETE"].includes(request.method) ? await readBody(request) : {};
    const token = String(request.headers.get("x-room-token") ?? url.searchParams.get("token") ?? body.token ?? "");
    if (parts[0] === "accounts") {
      if (request.method === "GET" && parts[1] === "me" && parts[2] === "dashboard") {
        return response(request, 200, await ctx.runMutation(internal.accountData.dashboard, { tokenHash: await hashToken(accountToken(request)) }));
      }
      if (request.method === "POST" && parts[1] === "register") {
        const result = await ctx.runAction(internal.accountAuth.register, { ...(body.username !== undefined ? { usernameInput: String(body.username) } : { emailInput: String(body.email ?? "") }), password: String(body.password ?? "") });
        return response(request, 201, { account: result.account, message: result.message }, result.sessionToken ? { "set-cookie": sessionCookie(result.sessionToken, secureRequest(request)) } : {});
      }
      if (request.method === "POST" && parts[1] === "login") {
        const result = await ctx.runAction(internal.accountAuth.login, { usernameInput: String(body.username ?? body.email ?? ""), password: String(body.password ?? "") });
        return response(request, 200, { account: result.account, message: result.message }, { "set-cookie": sessionCookie(result.sessionToken, secureRequest(request)) });
      }
      if (request.method === "POST" && parts[1] === "logout") {
        await ctx.runAction(internal.accountAuth.logout, { value: accountToken(request) });
        return response(request, 200, { message: "Signed out." }, { "set-cookie": clearSessionCookie(secureRequest(request)) });
      }
      if (request.method === "POST" && parts[1] === "verify-email") {
        const result = await ctx.runAction(internal.accountAuth.verifyEmail, { value: String(body.token ?? "") });
        return response(request, 200, { account: result.account, message: result.message }, { "set-cookie": sessionCookie(result.sessionToken, secureRequest(request)) });
      }
      if (request.method === "POST" && parts[1] === "resend-verification") return response(request, 200, await ctx.runAction(internal.accountAuth.resendVerification, { emailInput: String(body.email ?? "") }));
      if (request.method === "POST" && parts[1] === "password-reset" && parts.length === 2) return response(request, 200, await ctx.runAction(internal.accountAuth.requestPasswordReset, { emailInput: String(body.email ?? "") }));
      if (request.method === "POST" && parts[1] === "password-reset" && parts[2] === "complete") return response(request, 200, await ctx.runAction(internal.accountAuth.completePasswordReset, { value: String(body.token ?? ""), password: String(body.password ?? "") }));
      if (parts[1] === "me") {
        const user = await ctx.runAction(internal.accountAuth.authenticate, { value: accountToken(request) });
        if (!user) return response(request, 401, { error: "Sign in to use this account feature." });
        const userId = user.externalId;
        if (request.method === "GET" && parts.length === 2) return response(request, 200, { account: { id: userId, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) } });
        if (request.method === "PATCH" && parts.length === 2) return response(request, 200, { account: await ctx.runMutation(internal.accountData.updateUsername, { userId, usernameInput: String(body.username ?? "") }) });
        if (request.method === "DELETE" && parts.length === 2) {
          await ctx.runMutation(internal.accountData.deleteAccount, { userId });
          return response(request, 200, { message: "Account deleted." }, { "set-cookie": clearSessionCookie(secureRequest(request)) });
        }
        if (request.method === "GET" && parts[2] === "games" && parts.length === 3) return response(request, 200, await ctx.runQuery(internal.accountData.games, { userId }));
        if (request.method === "POST" && parts[2] === "games" && parts[4] === "resume") return response(request, 200, await ctx.runMutation(internal.rooms.resumeAccountGame, { roomId: parts[3]!, userId, username: user.username }));
        if (request.method === "GET" && parts[2] === "stats") return response(request, 200, await ctx.runQuery(internal.accountData.stats, { userId }));
        if (request.method === "GET" && parts[2] === "privacy") return response(request, 200, await ctx.runQuery(internal.accountData.privacy, { userId }));
        if (request.method === "PATCH" && parts[2] === "privacy") {
          if (typeof body.publicStatsEnabled !== "boolean") return response(request, 400, { error: "publicStatsEnabled must be true or false." });
          return response(request, 200, await ctx.runMutation(internal.accountData.updatePrivacy, { userId, publicStatsEnabled: body.publicStatsEnabled }));
        }
        if (request.method === "GET" && parts[2] === "social") return response(request, 200, await ctx.runQuery(internal.accountData.socialSummary, { userId }));
        if (request.method === "POST" && parts[2] === "friend-invite-links" && parts.length === 3) return response(request, 201, await ctx.runMutation(internal.accountData.createFriendLink, { userId }));
        if (request.method === "POST" && parts[2] === "friend-invite-links" && parts[3] === "accept") {
          await ctx.runMutation(internal.accountData.acceptFriendLink, { userId, value: String(body.token ?? "") });
          return response(request, 200, { message: "Friend invitation accepted." });
        }
        if (request.method === "DELETE" && parts[2] === "friend-invite-links" && parts[3]) {
          await ctx.runMutation(internal.accountData.revokeFriendLink, { userId, linkId: parts[3]! });
          return response(request, 200, { message: "Friend invitation link revoked." });
        }
        if (request.method === "POST" && parts[2] === "friends" && parts[3] === "invitations" && parts.length === 4) {
          await ctx.runMutation(internal.accountData.sendFriendInvitation, { userId, usernameInput: String(body.username ?? "") });
          return response(request, 200, { message: "Friend invitation sent if the player is available." });
        }
        if (request.method === "POST" && parts[2] === "friends" && parts[3] === "invitations" && parts[4]) {
          const action = parts[5];
          if (action !== "accept" && action !== "decline" && action !== "revoke") return response(request, 404, { error: "Not found" });
          await ctx.runMutation(internal.accountData.respondFriendInvitation, { userId, invitationId: parts[4]!, action });
          return response(request, 200, { message: action === "accept" ? "Invitation accepted." : action === "decline" ? "Invitation declined." : "Invitation revoked." });
        }
        if (request.method === "DELETE" && parts[2] === "friends" && parts[3]) {
          await ctx.runMutation(internal.accountData.removeFriend, { userId, usernameInput: parts[3]! });
          return response(request, 200, { message: "Friend removed." });
        }
        if (request.method === "POST" && parts[2] === "saved-opponents" && parts[3]) {
          await ctx.runMutation(internal.accountData.saveOpponent, { userId, usernameInput: parts[3]!, remove: false });
          return response(request, 200, { message: "Opponent saved." });
        }
        if (request.method === "DELETE" && parts[2] === "saved-opponents" && parts[3]) {
          await ctx.runMutation(internal.accountData.saveOpponent, { userId, usernameInput: parts[3]!, remove: true });
          return response(request, 200, { message: "Saved opponent removed." });
        }
        if (request.method === "PATCH" && parts[2] === "presence") {
          if (typeof body.enabled !== "boolean") return response(request, 400, { error: "Presence setting must be true or false." });
          await ctx.runMutation(internal.accountData.setPresence, { userId, enabled: body.enabled });
          return response(request, 200, { message: body.enabled ? "Presence is visible to friends while active." : "Presence is hidden." });
        }
        if (request.method === "POST" && parts[2] === "presence" && parts[3] === "heartbeat") {
          await ctx.runMutation(internal.accountData.refreshPresence, { userId });
          return response(request, 200, { message: "Presence refreshed." });
        }
      }
      return response(request, 404, { error: "Not found" });
    }
    if (request.method === "GET" && parts[0] === "players" && parts[1]) return response(request, 200, await ctx.runMutation(internal.accountData.publicProfile, { usernameInput: parts[1]! }));
    if (request.method === "GET" && parts[0] === "leaderboard") return response(request, 200, await ctx.runQuery(internal.accountData.leaderboard, { category: url.searchParams.get("category") ?? "wins" }));
    if (request.method === "GET" && parts[0] === "health") return response(request, 200, { ok: true, persistence: "convex", realtimeFanout: { mode: "reactive-subscription", ready: true } });
    if (request.method === "GET" && parts[0] === "rooms" && parts[1] === "public") return response(request, 200, await ctx.runQuery(api.rooms.publicRooms, {}));
    if (request.method === "POST" && parts[0] === "rooms" && parts.length === 1) {
      const created = await ctx.runMutation(api.rooms.create, { maxPlayers: Number(body.maxPlayers ?? 4), displayName: String(body.displayName ?? "Player 1"), privacy: body.privacy === "public" ? "public" : "private" });
      return response(request, 201, created);
    }
    if (parts[0] === "rooms" && parts[1]) {
      const code = parts[1].toUpperCase();
      if (request.method === "DELETE" && parts.length === 2) return response(request, 200, await ctx.runMutation(api.rooms.deleteRoom, { code, token }));
      if (request.method === "POST" && parts[2] === "claim") {
        const user = await ctx.runAction(internal.accountAuth.authenticate, { value: accountToken(request) });
        if (!user) return response(request, 401, { error: "Sign in to link this seat." });
        return response(request, 200, await ctx.runMutation(internal.rooms.claimAccountSeat, { code, token, userId: user.externalId, username: user.username }));
      }
      if (request.method === "POST" && parts[2] === "join") return response(request, 200, await ctx.runMutation(api.rooms.join, { code, displayName: String(body.displayName ?? "Player") }));
      if (request.method === "POST" && parts[2] === "bots") return response(request, 200, await ctx.runMutation(api.rooms.addBot, { code, token }));
      if (request.method === "POST" && parts[2] === "viewer-link") return response(request, 200, await ctx.runMutation(api.rooms.createViewerInvite, { code, token }));
      if (request.method === "POST" && parts[2] === "start") return response(request, 200, await ctx.runMutation(api.rooms.start, { code, token }));
      if (request.method === "POST" && parts[2] === "spectate") return response(request, 200, await ctx.runMutation(api.rooms.spectate, { code, displayName: String(body.displayName ?? "Spectator"), ...(typeof body.viewerToken === "string" ? { viewerToken: body.viewerToken } : {}) }));
      if (request.method === "POST" && parts[2] === "disconnect") return response(request, 200, await ctx.runMutation(api.rooms.disconnect, { code, token, connectionId: String(body.connectionId ?? "legacy") }));
      if (request.method === "POST" && parts[2] === "reconnect") return response(request, 200, await ctx.runMutation(api.rooms.reconnect, { code, token, connectionId: String(body.connectionId ?? "legacy") }));
      if (request.method === "POST" && parts[2] === "heartbeat") return response(request, 200, await ctx.runMutation(api.rooms.heartbeat, { code, token, connectionId: String(body.connectionId ?? "legacy") }));
      if (request.method === "POST" && parts[2] === "rotate-session") return response(request, 200, await ctx.runMutation(api.rooms.rotateSession, { code, token }));
      if (request.method === "POST" && parts[2] === "ready") return response(request, 200, await ctx.runMutation(api.rooms.ready, { code, token, ready: Boolean(body.ready) }));
      if (request.method === "POST" && parts[2] === "setup") return response(request, 200, await ctx.runMutation(api.rooms.setup, { code, token, expectedRevision: Number(body.expectedRevision), action: body.action }));
      if (request.method === "GET" && parts[2] === "state") {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        return response(request, 200, await ctx.runQuery(api.rooms.read, { code, tokenHash }));
      }
      if (request.method === "POST" && parts[2] === "actions") {
        const envelope = body.envelope ?? {
          actionId: String(body.actionId ?? crypto.randomUUID()), actorId: String(body.actorId ?? ""),
          expectedRevision: Number(body.expectedRevision), protocolVersion: Number(body.protocolVersion ?? 1), command: body.command,
        };
        return response(request, 200, await ctx.runMutation(api.rooms.submit, { code, token, envelope }));
      }
      if (request.method === "GET" && parts[2] === "replay" && parts[3] === "export") {
        const result = await ctx.runAction(api.replays.exportAll, { code });
        const status = !result.replayable && result.reason === "not-found" ? 404 : !result.replayable && result.reason === "not-completed" ? 409 : 200;
        return response(request, status, result);
      }
      if (request.method === "GET" && parts[2] === "replay") {
        const result = await ctx.runAction(api.replays.page, { code, fromVersion: Number(url.searchParams.get("fromVersion") ?? 0), limit: Number(url.searchParams.get("limit") ?? 8) });
        const status = !result.replayable && result.reason === "not-found" ? 404 : !result.replayable && result.reason === "not-completed" ? 409 : 200;
        return response(request, status, result);
      }
    }
    return response(request, 404, { error: "Not found" });
  } catch (error) {
    const category = parts[2] === "actions" ? "command" : "http";
    try { await ctx.runMutation(internal.errorReports.record, { category, at: Date.now() }); } catch { /* Preserve the original API response if telemetry storage is unavailable. */ }
    const message = error instanceof Error ? error.message : "Request failed.";
    const status = message === "Request body is too large." ? 413 : message === "Player not found." ? 404 : 400;
    return response(request, status, { error: message });
  }
}

const http = httpRouter();
for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] as const) {
  http.route({ pathPrefix: "/", method, handler: httpAction((ctx, request) => handle(ctx, request)) });
}

export default http;
