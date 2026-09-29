import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { WebSocket } from "ws";

// Local acceptance harness: apply the checked-in migration SQL to an in-memory
// PGlite database, then exercise the real API process through HTTP and PrismaPg.
// This deliberately does not model Prisma Migrate bookkeeping or PostgreSQL
// MVCC, row-lock, rollback, or competing-transaction behavior.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = join(repoRoot, "apps/api");
const migrationRoot = join(apiRoot, "prisma/migrations");
const evidenceDate = new Date().toISOString().slice(0, 10);
const evidenceRelativePath = `output/api-review/account-api-pglite-${evidenceDate}.json`;
const evidencePath = join(repoRoot, evidenceRelativePath);
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function reservePort() {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolveListen);
  });
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function applyCheckedInMigrations(db) {
  const directories = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(directories.length > 0, "expected checked-in Prisma migration directories");
  for (const directory of directories) {
    const sql = await readFile(join(migrationRoot, directory, "migration.sql"), "utf8");
    await db.exec(sql);
  }
  return directories;
}

async function startApi(databaseUrl, port, allowedOrigin) {
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PERSISTENCE: "prisma",
      NODE_ENV: "development",
      PORT: String(port),
      ALLOWED_ORIGIN: allowedOrigin,
      WEB_APP_URL: allowedOrigin,
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      ACCOUNT_EMAIL_DELIVERY_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.outputText = () => output;
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited during startup (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // The child can take a moment to load the generated Prisma client.
    }
    await wait(50);
  }
  await stopApi(child);
  throw new Error(`API did not become healthy.\n${output}`);
}

async function stopApi(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function call(baseUrl, path, { method = "GET", body, cookie, roomToken, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (roomToken) headers["x-room-token"] = roomToken;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; }
  catch { data = text; }
  return { response, data };
}

function mustSucceed(result, label, expectedStatus = 200) {
  assert.equal(result.response.status, expectedStatus, `${label}: ${JSON.stringify(result.data)}`);
  return result.data;
}

function cookieFrom(result, label) {
  const header = result.response.headers.get("set-cookie");
  assert.ok(header, `${label} must set the account session cookie`);
  assert.match(header, /^aaa_account=[^;]+;/);
  assert.match(header, /; HttpOnly(?:;|$)/i);
  assert.match(header, /; SameSite=Lax(?:;|$)/i);
  return header.split(";", 1)[0];
}

function tokenFromLink(link, key) {
  assert.equal(typeof link, "string", `development response must include ${key} link`);
  const value = new URL(link).searchParams.get(key);
  assert.ok(value, `${key} link must contain an action token`);
  return value;
}

function waitForSocketMessage(socket, predicate, label, timeoutMs = 5_000) {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    const onMessage = (data) => {
      let message;
      try { message = JSON.parse(data.toString()); }
      catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolveMessage(message);
    };
    socket.on("message", onMessage);
  });
}

function waitForSocketClose(socket, timeoutMs = 5_000) {
  return new Promise((resolveClose, reject) => {
    const timeout = setTimeout(() => {
      socket.off("close", onClose);
      reject(new Error("Timed out waiting for the deleted account's WebSocket to close."));
    }, timeoutMs);
    const onClose = (code, reason) => {
      clearTimeout(timeout);
      socket.off("close", onClose);
      resolveClose({ code, reason: reason.toString() });
    };
    socket.on("close", onClose);
  });
}

async function connectRoomSocket(baseUrl, roomCode, roomToken, label) {
  const connectionId = randomUUID();
  const ticket = mustSucceed(await call(baseUrl, `/rooms/${roomCode}/ws-ticket`, {
    method: "POST", roomToken, body: { requestedConnectionId: connectionId },
  }), `${label} socket ticket`);
  const socketUrl = new URL(baseUrl);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.pathname = "/ws";
  socketUrl.search = new URLSearchParams({ code: roomCode, ticket: ticket.ticket }).toString();
  const socket = new WebSocket(socketUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", resolveOpen);
    socket.once("error", rejectOpen);
  });
  const firstUpdate = await waitForSocketMessage(socket, (message) => message.type === "room.updated", `${label} initial room projection`);
  return { socket, firstUpdate };
}

const db = await PGlite.create();
let socketServer;
let api;
try {
  const migrations = await applyCheckedInMigrations(db);
  socketServer = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 16 });
  let listening;
  socketServer.addEventListener("listening", (event) => { listening = event.detail; });
  await socketServer.start();
  assert.ok(listening?.port, "PGlite socket server must report its selected port");

  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${listening.port}/postgres`;
  const apiPort = await reservePort();
  const allowedOrigin = `http://127.0.0.1:${apiPort}`;
  api = await startApi(databaseUrl, apiPort, allowedOrigin);

  const email = `pglite-${process.pid}-${Date.now()}@example.test`;
  const oldPassword = "initial-local-password-2026";
  const newPassword = "recovered-local-password-2026";
  const registration = await call(api.baseUrl, "/accounts/register", {
    method: "POST", origin: allowedOrigin, body: { email, password: oldPassword },
  });
  const registered = mustSucceed(registration, "register", 201);
  const verificationToken = tokenFromLink(registered.developmentLink, "verify-email");

  const verification = await call(api.baseUrl, "/accounts/verify-email", {
    method: "POST", origin: allowedOrigin, body: { token: verificationToken },
  });
  mustSucceed(verification, "verify email");
  let sessionCookie = cookieFrom(verification, "email verification");
  assert.equal(mustSucceed(await call(api.baseUrl, "/accounts/me", { cookie: sessionCookie }), "verified account read").account.emailVerified, true);

  const deniedMutation = await call(api.baseUrl, "/accounts/me", {
    method: "PATCH", origin: "https://attacker.example", cookie: sessionCookie, body: { username: "attacker-name" },
  });
  assert.equal(deniedMutation.response.status, 403, "valid-cookie mutation from an untrusted origin must be rejected");
  const afterDeniedMutation = mustSucceed(await call(api.baseUrl, "/accounts/me", { cookie: sessionCookie }), "account read after rejected CSRF attempt");
  assert.equal(afterDeniedMutation.account.username, registered.account.username, "rejected mutation must not change persisted account data");

  const resetRequest = mustSucceed(await call(api.baseUrl, "/accounts/password-reset", {
    method: "POST", origin: allowedOrigin, body: { email },
  }), "password reset request");
  const resetToken = tokenFromLink(resetRequest.developmentLink, "reset-password");
  mustSucceed(await call(api.baseUrl, "/accounts/password-reset/complete", {
    method: "POST", origin: allowedOrigin, body: { token: resetToken, password: newPassword },
  }), "password reset completion");
  const revokedSession = await call(api.baseUrl, "/accounts/me", { cookie: sessionCookie });
  assert.equal(revokedSession.response.status, 401, "password reset must revoke the pre-reset account session");

  const login = await call(api.baseUrl, "/accounts/login", {
    method: "POST", origin: allowedOrigin, body: { email, password: newPassword },
  });
  mustSucceed(login, "login with recovered password");
  sessionCookie = cookieFrom(login, "recovery login");
  mustSucceed(await call(api.baseUrl, "/accounts/me", { cookie: sessionCookie }), "recovery session read");

  const createdRoom = mustSucceed(await call(api.baseUrl, "/rooms", {
    method: "POST", body: { maxPlayers: 2, displayName: "Recovery Seat", privacy: "private" },
  }), "create room", 201);
  const guestToken = createdRoom.token;
  assert.ok(guestToken && createdRoom.room?.id && createdRoom.room?.code, "room response must include its room and guest token");

  const deniedClaim = await call(api.baseUrl, `/rooms/${createdRoom.room.code}/claim`, {
    method: "POST", origin: "https://attacker.example", cookie: sessionCookie, roomToken: guestToken, body: {},
  });
  assert.equal(deniedClaim.response.status, 403, "untrusted-origin seat claim with a valid account cookie and room token must be rejected");
  mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/state`, { roomToken: guestToken }), "guest token remains valid after rejected cross-origin claim");

  const claim = mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/claim`, {
    method: "POST", origin: allowedOrigin, cookie: sessionCookie, roomToken: guestToken, body: {},
  }), "claim room seat");
  assert.equal(claim.accountLinked, true);
  assert.notEqual(claim.token, guestToken, "claim must rotate the guest room token");

  const games = mustSucceed(await call(api.baseUrl, "/accounts/me/games", { cookie: sessionCookie }), "linked games list");
  assert.ok(games.some((game) => game.roomId === createdRoom.room.id && game.code === createdRoom.room.code), "claimed room must appear in persisted account game list");

  const deniedResume = await call(api.baseUrl, `/accounts/me/games/${createdRoom.room.id}/resume`, {
    method: "POST", origin: "https://attacker.example", cookie: sessionCookie, body: {},
  });
  assert.equal(deniedResume.response.status, 403, "untrusted-origin resume with a valid account cookie must be rejected");
  mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/state`, { roomToken: claim.token }), "claim token remains valid after rejected cross-origin resume");

  const resume = mustSucceed(await call(api.baseUrl, `/accounts/me/games/${createdRoom.room.id}/resume`, {
    method: "POST", origin: allowedOrigin, cookie: sessionCookie, body: {},
  }), "resume linked room");
  assert.notEqual(resume.token, claim.token, "resume must rotate the linked seat token");
  mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/state`, { roomToken: resume.token }), "read room with resumed token");
  const staleToken = await call(api.baseUrl, `/rooms/${createdRoom.room.code}/state`, { roomToken: claim.token });
  assert.equal(staleToken.response.status, 400, "pre-resume token must no longer authorize room reads");

  const pendingReconnectId = "33333333-3333-4333-8333-333333333333";
  const leftDuringReconnect = mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/disconnect`, {
    method: "POST", roomToken: resume.token, body: { pendingConnectionId: pendingReconnectId },
  }), "leave while a reconnect lease is pending");
  assert.equal(leftDuringReconnect.participants.find((participant) => participant.id === resume.participantId)?.connected, false);
  const cancelledReconnect = await call(api.baseUrl, `/rooms/${createdRoom.room.code}/reconnect`, {
    method: "POST", roomToken: resume.token, body: { requestedConnectionId: pendingReconnectId },
  });
  assert.equal(cancelledReconnect.response.status, 400, "Leave prevents the old token from claiming its cancelled reconnect lease");
  const resumedAfterLeave = mustSucceed(await call(api.baseUrl, `/accounts/me/games/${createdRoom.room.id}/resume`, {
    method: "POST", origin: allowedOrigin, cookie: sessionCookie, body: {},
  }), "account resume after Leave");
  assert.notEqual(resumedAfterLeave.token, resume.token);
  const freshTicket = mustSucceed(await call(api.baseUrl, `/rooms/${createdRoom.room.code}/ws-ticket`, {
    method: "POST", roomToken: resumedAfterLeave.token, body: { requestedConnectionId: "44444444-4444-4444-8444-444444444444" },
  }), "create a fresh socket ticket after account resume clears the cancelled lease");
  assert.equal(freshTicket.connectionId, "44444444-4444-4444-8444-444444444444");

  const deletionRoom = mustSucceed(await call(api.baseUrl, "/rooms", {
    method: "POST", body: { maxPlayers: 2, displayName: "Deletion Seat", privacy: "public" },
  }), "create account-deletion room", 201);
  const deletionClaim = mustSucceed(await call(api.baseUrl, `/rooms/${deletionRoom.room.code}/claim`, {
    method: "POST", origin: allowedOrigin, cookie: sessionCookie, roomToken: deletionRoom.token, body: {},
  }), "claim account-deletion room seat");
  const deletionViewer = mustSucceed(await call(api.baseUrl, `/rooms/${deletionRoom.room.code}/spectate`, {
    method: "POST", body: { displayName: "Deletion Room Viewer" },
  }), "join account-deletion room as the surviving viewer");
  const initialMonsterId = deletionRoom.room.state.setupState?.definition.monsterIds[0];
  assert.ok(initialMonsterId, "the room must expose a configured first setup choice");
  const setupEvent = mustSucceed(await call(api.baseUrl, `/rooms/${deletionRoom.room.code}/setup`, {
    method: "POST", roomToken: deletionClaim.token,
    body: { expectedRevision: deletionRoom.room.version, action: { type: "choose-monster", monsterId: initialMonsterId } },
  }), "create one persisted setup event before account deletion");
  assert.equal(setupEvent.version, deletionRoom.room.version + 1);
  const deletedAccountSocket = await connectRoomSocket(api.baseUrl, deletionRoom.room.code, deletionClaim.token, "account-linked player");
  const survivingViewerSocket = await connectRoomSocket(api.baseUrl, deletionRoom.room.code, deletionViewer.token, "surviving room viewer");
  // Seed ACTIVE status to isolate account-deletion presence projection and
  // status refresh. This is not a normally completed/activated gameplay match.
  await db.query('UPDATE "GameRoom" SET status = $1 WHERE id = $2', ["ACTIVE", deletionRoom.room.id]);
  const roomBeforeDeletion = mustSucceed(await call(api.baseUrl, `/rooms/${deletionRoom.room.code}/state`, { roomToken: deletionViewer.token }), "read active room before account deletion");
  assert.equal(roomBeforeDeletion.status, "active");
  const persistedRoomBeforeDeletion = await db.query('SELECT "state", "version" FROM "GameRoom" WHERE "id" = $1', [deletionRoom.room.id]);
  assert.equal(persistedRoomBeforeDeletion.rows.length, 1, "the seeded lifecycle fixture must exist in persisted state before deletion");
  const persistedEventsBeforeDeletion = await db.query('SELECT "id", "version", "actorId", "type", "controlSource", "payload", "createdAt" FROM "GameEvent" WHERE "roomId" = $1 ORDER BY "version" ASC, "id" ASC', [deletionRoom.room.id]);
  assert.ok(persistedEventsBeforeDeletion.rows.length > 0, "persisted room-history comparison requires at least one event");
  const deletedParticipantUpdate = waitForSocketMessage(survivingViewerSocket.socket, (message) => {
    const participant = message.type === "room.updated" && message.room.participants.find((candidate) => candidate.id === deletionClaim.participantId);
    return participant?.connected === false && participant.botControlled === true && participant.botAssisted === true;
  }, "surviving viewer's deleted-seat projection");
  const deletionProjectionMessages = [];
  const recordDeletionProjection = (data) => {
    let message;
    try { message = JSON.parse(data.toString()); }
    catch { return; }
    const participant = message.type === "room.updated" && message.room.participants.find((candidate) => candidate.id === deletionClaim.participantId);
    if (participant?.connected === false && participant.botControlled === true && participant.botAssisted === true) deletionProjectionMessages.push(message);
  };
  survivingViewerSocket.socket.on("message", recordDeletionProjection);
  const deletedSocketClose = waitForSocketClose(deletedAccountSocket.socket);
  const deletion = mustSucceed(await call(api.baseUrl, "/accounts/me", {
    method: "DELETE", origin: allowedOrigin, cookie: sessionCookie,
  }), "delete account with a connected player seat");
  assert.equal(deletion.message, "Account deleted.");
  const [closed, updatedProjection] = await Promise.all([deletedSocketClose, deletedParticipantUpdate]);
  assert.equal(closed.code, 4001, "account deletion must close the old player lease as replaced");
  assert.equal(updatedProjection.room.status, "abandoned", "deletion must refresh active-room presence before broadcasting the final-player abandonment");
  const deletedParticipant = updatedProjection.room.participants.find((participant) => participant.id === deletionClaim.participantId);
  assert.equal(deletedParticipant?.displayName, "Deleted player");
  assert.equal(deletedParticipant?.connected, false);
  assert.equal(deletedParticipant?.botControlled, true);
  assert.equal(deletedParticipant?.botAssisted, true);
  await wait(100);
  survivingViewerSocket.socket.off("message", recordDeletionProjection);
  assert.equal(deletionProjectionMessages.length, 1, "account deletion broadcasts one final seat projection after refreshing room lifecycle status");
  const roomAfterDeletion = mustSucceed(await call(api.baseUrl, `/rooms/${deletionRoom.room.code}/state`, { roomToken: deletionViewer.token }), "read room after account deletion");
  assert.equal(roomAfterDeletion.status, "abandoned", "the last disconnected player moves the room to its derived abandoned status");
  assert.equal(roomAfterDeletion.version, roomBeforeDeletion.version, "account deletion must not alter the gameplay revision");
  assert.deepEqual(roomAfterDeletion.state, roomBeforeDeletion.state, "account deletion must preserve persisted game state");
  assert.deepEqual(roomAfterDeletion.events, roomBeforeDeletion.events, "account deletion must preserve room event history");
  const persistedRoomAfterDeletion = await db.query('SELECT "state", "version" FROM "GameRoom" WHERE "id" = $1', [deletionRoom.room.id]);
  const persistedEventsAfterDeletion = await db.query('SELECT "id", "version", "actorId", "type", "controlSource", "payload", "createdAt" FROM "GameEvent" WHERE "roomId" = $1 ORDER BY "version" ASC, "id" ASC', [deletionRoom.room.id]);
  assert.deepEqual(persistedRoomAfterDeletion.rows, persistedRoomBeforeDeletion.rows, "raw persisted room state and revision must remain unchanged");
  assert.deepEqual(persistedEventsAfterDeletion.rows, persistedEventsBeforeDeletion.rows, "ordered persisted GameEvent rows must remain unchanged");
  deletedAccountSocket.socket.close();
  survivingViewerSocket.socket.close();

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    harness: "node scripts/verify-account-api-pglite.mjs",
    artifact: evidenceRelativePath,
    database: "in-memory PGlite over PostgreSQL wire protocol",
    migrationsApplied: migrations,
    schemaProvisioning: "checked-in migration SQL applied directly; Prisma Migrate bookkeeping is not exercised",
    prismaMigrateDeploy: "not compatible in this harness; Prisma returned a blank Schema engine error",
    actualApiProcess: true,
    verified: ["registration", "email verification", "HttpOnly SameSite account cookie", "valid-cookie origin rejection with unchanged persisted account", "valid-cookie and room-token origin rejection with unchanged guest token on seat claim", "valid-cookie origin rejection with unchanged claimed token on account resume", "password reset", "pre-reset session revocation", "new-password login", "seat claim", "account game-list visibility", "resume token rotation", "old room-token rejection", "HTTP Leave invalidates a pending reconnect lease", "account resume after Leave rotates the token and permits a fresh WebSocket ticket", "account deletion closes the linked player WebSocket, sends one matching disconnected/bot-controlled projection within the observation window to a surviving viewer, and refreshes the seeded ACTIVE status to ABANDONED", "account deletion preserves room game state, revision, and event history"],
    limits: ["the account-deletion lifecycle check directly seeds ACTIVE status on a partially configured room with one setup event; it proves the presence-derived projection/status-refresh path, not a normally activated gameplay match", "the exactly-one projection assertion observes a 100 ms post-message window rather than using a deterministic server-side broadcast barrier", "PGlite socket server multiplexes a single database engine", "does not establish PostgreSQL MVCC, row-lock, rollback, or concurrent CAS behavior, including the UserAccount FOR UPDATE versus Participant.userId foreign-key key-share interleaving", "single-process socket coverage does not establish multi-instance WebSocket close or broadcast fanout", "in-memory database does not establish durable restart or backup behavior"],
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (api?.child) console.error(api.child.outputText());
  process.exitCode = 1;
} finally {
  if (api?.child) await stopApi(api.child);
  if (socketServer) await socketServer.stop();
  await db.close();
}
