import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/generated/prisma/client.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));
const tsxCli = require.resolve("tsx/cli");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL to a disposable PostgreSQL database with all project migrations applied.");

const runId = randomUUID();
const emailPrefix = `route-check-${runId}-`;
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a local API port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
let child;
let childOutput = "";
const roomCodes = new Set();

function startApi() {
  childOutput = "";
  child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "development",
      PERSISTENCE: "prisma",
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
}

async function stopApi() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited before health became ready:\n${childOutput.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* API has not bound yet. */ }
    await wait(100);
  }
  throw new Error(`API did not become healthy:\n${childOutput.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
}

async function request(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  let data = {};
  try { data = await response.json(); } catch { /* Preserve status if a route returned no JSON. */ }
  return { response, data };
}

async function createAccount(label) {
  const email = `${emailPrefix}${label}@example.test`;
  const registered = await request("/accounts/register", {
    method: "POST",
    body: { email, password: "RouteCheck-Long-Password-2026!" },
  });
  assert.equal(registered.response.status, 201, "account registration should succeed");
  const verificationToken = new URL(registered.data.developmentLink).searchParams.get("verify-email");
  assert.ok(verificationToken, "development verification link should contain a token");
  const verified = await request("/accounts/verify-email", { method: "POST", body: { token: verificationToken } });
  assert.equal(verified.response.status, 200, "email verification should create a signed-in session");
  return {
    cookie: verified.response.headers.get("set-cookie").split(";")[0],
    username: verified.data.account.username,
    id: verified.data.account.id,
  };
}

function assertStatus(result, status, description) {
  assert.equal(result.response.status, status, `${description}: ${JSON.stringify(result.data)}`);
}

try {
  startApi();
  await waitForHealth();
  assertStatus(await request("/accounts/me/social"), 401, "social routes should reject unauthenticated requests");

  const first = await createAccount("first");
  const second = await createAccount("second");
  const unrelated = await createAccount("unrelated");

  assertStatus(await request(`/accounts/me/privacy`, { cookie: first.cookie }), 200, "privacy defaults should be retrievable");
  let privacy = await request("/accounts/me/privacy", { cookie: first.cookie });
  assert.equal(privacy.data.publicStatsEnabled, true, "existing account public-stats default should remain enabled");
  assertStatus(await request(`/players/${first.username}`), 200, "public profile should be visible by default");
  assertStatus(await request(`/accounts/me/stats`, { cookie: first.cookie }), 200, "owner should be able to read own stats");

  let response = await request("/accounts/me/friends/invitations", {
    method: "POST", cookie: first.cookie, body: { username: second.username },
  });
  assertStatus(response, 200, "friend invitation should be sent");
  const secondSummary = await request("/accounts/me/social", { cookie: second.cookie });
  assertStatus(secondSummary, 200, "recipient should be able to read their social summary");
  const invitation = secondSummary.data.incoming[0];
  assert.ok(invitation?.id, "recipient should see the pending invitation");

  const inviteUrl = `/accounts/me/friends/invitations/${encodeURIComponent(invitation.id)}/accept`;
  const concurrentAccepts = await Promise.all([
    request(inviteUrl, { method: "POST", cookie: second.cookie, body: {} }),
    request(inviteUrl, { method: "POST", cookie: second.cookie, body: {} }),
  ]);
  assert.equal(concurrentAccepts.filter((item) => item.response.status === 200).length, 1, "exactly one concurrent acceptance should succeed");
  assert.equal(concurrentAccepts.filter((item) => item.response.status !== 200).length, 1, "the competing acceptance should be rejected");

  response = await request("/accounts/me/social", { cookie: first.cookie });
  assert.equal(response.data.friends.length, 1, "accepted invitation should create a mutual friendship");
  assert.deepEqual(response.data.savedOpponents, [], "other accounts' saved opponents must not leak");
  assertStatus(await request(`/accounts/me/saved-opponents/${encodeURIComponent(second.username)}`, {
    method: "POST", cookie: first.cookie, body: {},
  }), 200, "saving an opponent should succeed");
  const secondAfterSave = await request("/accounts/me/social", { cookie: second.cookie });
  assert.deepEqual(secondAfterSave.data.savedOpponents, [], "saved opponents must remain private to their owner");

  assertStatus(await request("/accounts/me/presence", { method: "PATCH", cookie: first.cookie, body: { enabled: true } }), 200, "presence opt-in should succeed");
  assertStatus(await request("/accounts/me/presence/heartbeat", { method: "POST", cookie: first.cookie, body: {} }), 200, "presence heartbeat should succeed");
  const friendView = await request("/accounts/me/social", { cookie: second.cookie });
  assert.equal(friendView.data.friends[0]?.online, true, "presence should be visible to an accepted friend");
  assertStatus(await request("/accounts/me/presence", { method: "PATCH", cookie: first.cookie, body: { enabled: false } }), 200, "presence opt-out should succeed");
  const hiddenPresence = await request("/accounts/me/social", { cookie: second.cookie });
  assert.equal(hiddenPresence.data.friends[0]?.online, false, "presence opt-out should immediately hide presence from a friend");

  assertStatus(await request("/accounts/me/privacy", {
    method: "PATCH", cookie: first.cookie, body: { publicStatsEnabled: false },
  }), 200, "privacy opt-out should succeed");
  const errorsBeforeHiddenProfile = await request("/metrics");
  assertStatus(await request(`/players/${first.username}`), 404, "hidden player profile should be indistinguishable from a missing profile");
  const errorsAfterHiddenProfile = await request("/metrics");
  assert.equal(errorsAfterHiddenProfile.data.serverErrors, errorsBeforeHiddenProfile.data.serverErrors, "expected private-profile 404 should not count as a server error");
  assertStatus(await request("/accounts/me/stats", { cookie: first.cookie }), 200, "privacy opt-out should preserve owner access to stats");
  assertStatus(await request(`/players/${unrelated.username}`), 200, "unrelated public profile should remain visible");

  const created = await request("/rooms", {
    method: "POST", body: { maxPlayers: 2, displayName: "Account-route guest host", privacy: "public" },
  });
  assertStatus(created, 201, "guest should be able to create a public room");
  roomCodes.add(created.data.room.code);
  const joined = await request(`/rooms/${created.data.room.code}/join`, { method: "POST", body: { displayName: "Guest joiner" } });
  assertStatus(joined, 200, "guest should be able to join a public room");
  const spectated = await request(`/rooms/${created.data.room.code}/spectate`, { method: "POST", body: { displayName: "Guest spectator" } });
  assertStatus(spectated, 200, "guest should be able to spectate a public room");

  await stopApi();
  await prisma.$connect();
  const historyRoomCode = `HIST${runId.slice(0, 8).toUpperCase()}`;
  const historyRoom = await prisma.gameRoom.create({ data: {
    code: historyRoomCode,
    state: {},
    status: "COMPLETED",
    maxPlayers: 2,
  } });
  roomCodes.add(historyRoomCode);
  const historySeat = await prisma.participant.create({ data: {
    roomId: historyRoom.id,
    displayName: first.username,
    role: "PLAYER",
    playerIndex: 0,
    tokenHash: createHash("sha256").update(`route-check-${runId}`).digest("hex"),
    sessionExpiresAt: new Date(Date.now() + 60_000),
    userId: first.id,
  } });
  await prisma.playerMatchStat.create({ data: {
    roomId: historyRoom.id,
    participantId: historySeat.id,
    userId: first.id,
    playerIndex: 0,
    username: first.username,
    outcome: "win",
    monsterId: "konk",
    monsterName: "Konk",
    branch: "Army",
    rounds: 4,
  } });
  await prisma.$disconnect();
  startApi();
  await waitForHealth();
  assertStatus(await request("/accounts/me", { method: "DELETE", cookie: first.cookie }), 200, "account deletion should succeed");
  await stopApi();
  await prisma.$connect();
  const remainingSocialData = await Promise.all([
    prisma.friendInvitation.count({ where: { OR: [{ senderId: first.id }, { recipientId: first.id }] } }),
    prisma.friendship.count({ where: { OR: [{ userAId: first.id }, { userBId: first.id }] } }),
    prisma.friendInviteLink.count({ where: { senderId: first.id } }),
    prisma.savedOpponent.count({ where: { OR: [{ ownerId: first.id }, { opponentId: first.id }] } }),
  ]);
  assert.deepEqual(remainingSocialData, [0, 0, 0, 0], "account deletion should cascade through social records");
  assert.equal(await prisma.playerMatchStat.count({ where: { userId: first.id } }), 0, "account deletion should cascade through private match statistics");
  const retainedHistorySeat = await prisma.participant.findUnique({ where: { id: historySeat.id } });
  assert.equal(retainedHistorySeat?.userId, null, "account deletion should unlink retained match history");
  assert.equal(retainedHistorySeat?.displayName, "Deleted player", "account deletion should anonymize retained match history");

  console.log("PostgreSQL account-route checks passed: defaults, profile privacy, owner stats, concurrent invitation acceptance, saved-opponent isolation, friend presence opt-in/off, social/stat cascades, anonymized retained match history, and guest public-room access.");
} catch (error) {
  const safeTail = childOutput.split("\n").slice(-30).join("\n").replaceAll(databaseUrl, "[DATABASE_URL]");
  if (safeTail) console.error(`API diagnostic tail:\n${safeTail}`);
  throw error;
} finally {
  await stopApi();
  await prisma.userAccount.deleteMany({ where: { email: { startsWith: emailPrefix } } }).catch(() => undefined);
  if (roomCodes.size) await prisma.gameRoom.deleteMany({ where: { code: { in: [...roomCodes] } } }).catch(() => undefined);
  await prisma.$disconnect();
}
