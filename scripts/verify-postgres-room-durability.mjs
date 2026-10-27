import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/generated/prisma/client.ts";
import { PrismaRoomStore } from "../apps/api/src/prisma-store.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));
const tsxCli = require.resolve("tsx/cli");
const WebSocket = require("ws");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL to a disposable PostgreSQL database with project migrations applied.");

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
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
const concurrencyPort = await reservePort();
const concurrencyBaseUrl = `http://127.0.0.1:${concurrencyPort}`;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
let child;
let output = "";
let concurrencyChild;
let concurrencyOutput = "";

function startApi() {
  output = "";
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
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited before health became ready:\n${output.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      const health = await response.json();
      if (response.ok && health.realtimeFanout?.ready) return;
    } catch { /* API has not bound yet. */ }
    await wait(100);
  }
  throw new Error(`API did not become healthy:\n${output.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
}

async function stopApi() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

function startConcurrencyApi() {
  concurrencyOutput = "";
  concurrencyChild = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "development",
      PERSISTENCE: "prisma",
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      PORT: String(concurrencyPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  concurrencyChild.stdout.on("data", (chunk) => { concurrencyOutput += chunk.toString(); });
  concurrencyChild.stderr.on("data", (chunk) => { concurrencyOutput += chunk.toString(); });
}

async function waitForConcurrencyHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (concurrencyChild.exitCode !== null) throw new Error(`Second API process exited before health became ready:\n${concurrencyOutput.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
    try {
      const response = await fetch(`${concurrencyBaseUrl}/health`);
      const health = await response.json();
      if (response.ok && health.realtimeFanout?.mode === "postgres-notify" && health.realtimeFanout.ready) return;
    } catch { /* API has not bound yet. */ }
    await wait(100);
  }
  throw new Error(`Second API process did not become healthy:\n${concurrencyOutput.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
}

function waitForRoomVersion(socket, version, timeoutMs = 5_000) {
  return new Promise((resolveUpdate, rejectUpdate) => {
    const timer = setTimeout(() => finish(new Error(`No remote WebSocket room update reached revision ${version}.`)), timeoutMs);
    const onMessage = (data, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === "room.updated" && message.room?.version >= version) finish(undefined, message.room);
    };
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      error ? rejectUpdate(error) : resolveUpdate(value);
    };
    socket.on("message", onMessage);
  });
}

async function connectRemoteRoomSocket(roomCode, accessToken, expectedVersion) {
  const { ticket } = await jsonRequest(`/rooms/${roomCode}/ws-ticket`, {
    method: "POST",
    headers: { "x-room-token": accessToken },
  }, concurrencyBaseUrl);
  const socket = new WebSocket(`ws://127.0.0.1:${concurrencyPort}/ws?code=${encodeURIComponent(roomCode)}&ticket=${encodeURIComponent(ticket)}`);
  await new Promise((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error("Remote API WebSocket did not open.")), 5_000);
    socket.once("open", () => { clearTimeout(timeout); resolveOpen(); });
    socket.once("error", (error) => { clearTimeout(timeout); rejectOpen(error); });
  });
  const initialRoom = await waitForRoomVersion(socket, expectedVersion);
  return { socket, initialRoom };
}

async function stopConcurrencyApi() {
  if (!concurrencyChild || concurrencyChild.exitCode !== null) return;
  concurrencyChild.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => concurrencyChild.once("exit", resolveExit)),
    wait(5_000).then(() => { if (concurrencyChild.exitCode === null) concurrencyChild.kill("SIGKILL"); }),
  ]);
}

async function jsonRequest(path, options = {}, targetBaseUrl = baseUrl) {
  const response = await fetch(`${targetBaseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${body.error ?? "request failed"}`);
  return body;
}

function nextSetupAction(setup, playerCount) {
  if (setup.phase === "monster-selection") {
    const seat = setup.seats.find((candidate) => !candidate.monsterId);
    const monsterId = setup.definition.monsterIds.find((candidate) => !setup.seats.some((assigned) => assigned.monsterId === candidate));
    assert.ok(seat && monsterId, "setup has an available monster and seat");
    return { playerIndex: seat.playerIndex, action: { type: "choose-monster", monsterId } };
  }
  if (setup.phase === "branch-selection") {
    const seat = [...setup.seats].reverse().find((candidate) => !candidate.branch);
    const branch = setup.definition.eligibleBranches.find((candidate) => !setup.seats.some((assigned) => assigned.branch === candidate));
    assert.ok(seat && branch, "setup has an available branch and seat");
    return { playerIndex: seat.playerIndex, action: { type: "choose-branch", branch } };
  }
  if (setup.phase === "unused-branch-placement") {
    const catalogue = setup.definition.unusedBranchPlacements;
    assert.ok(catalogue, "setup has the audited unused-branch placement catalogue");
    const unusedBranches = setup.definition.eligibleBranches.filter((branch) => !setup.seats.some((seat) => seat.branch === branch));
    const placements = unusedBranches.flatMap((branch) => (catalogue.unitIdsByBranch[branch] ?? []).map((unitId, index) => ({
      unitId,
      destination: catalogue.basesByBranch[branch]?.[index],
    })));
    assert.ok(placements.every((placement) => placement.destination), "every unused branch unit has an audited base");
    return { playerIndex: playerCount - 1, action: { type: "place-unused-branches", placements } };
  }
  if (setup.phase === "lair-selection") {
    const seat = setup.seats.find((candidate) => !candidate.lair);
    const lair = setup.definition.lairsByMonster[seat?.monsterId ?? ""]?.find((candidate) => !setup.seats.some((assigned) => assigned.lair === candidate));
    assert.ok(seat && lair, "setup has an available audited lair");
    return { playerIndex: seat.playerIndex, action: { type: "choose-lair", lair } };
  }
  if (setup.phase === "starting-choice") {
    const seat = setup.seats.find((candidate) => !candidate.startingChoice);
    assert.ok(seat, "setup has an available starting choice");
    return { playerIndex: seat.playerIndex, action: { type: "choose-starting-choice", startingChoice: { kind: "research" } } };
  }
  throw new Error(`No legal setup action is defined for ${setup.phase}.`);
}

async function postSetupAction(room, players, action) {
  const player = players[action.playerIndex];
  assert.ok(player, `setup actor ${action.playerIndex} is seated`);
  return jsonRequest(`/rooms/${room.code}/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": player.token },
    body: JSON.stringify({ expectedRevision: room.version, action: action.action }),
  });
}

async function submitCommand(room, player, envelope, targetBaseUrl = baseUrl) {
  return jsonRequest(`/rooms/${room.code}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": player.token },
    body: JSON.stringify({ envelope }),
  }, targetBaseUrl);
}

try {
  startApi();
  await waitForHealth();
  startConcurrencyApi();
  await waitForConcurrencyHealth();
  const created = await jsonRequest("/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPlayers: 2, displayName: "Postgres durability check" }),
  });
  const players = [{ token: created.token, participantId: created.participantId }];
  let room = created.room;

  const joined = await jsonRequest(`/rooms/${room.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Second durability seat" }),
  });
  players.push({ token: joined.token, participantId: joined.participantId });
  room = joined.room;

  const remoteSocketResult = await connectRemoteRoomSocket(room.code, players[1].token, room.version);
  const remoteSocket = remoteSocketResult.socket;
  assert.equal(remoteSocketResult.initialRoom.version, room.version, "second API process delivers the initial viewer-specific room snapshot");
  const firstSetupAction = nextSetupAction(room.state.setupState, 2);
  const remoteSetupUpdate = waitForRoomVersion(remoteSocket, room.version + 1);
  room = await postSetupAction(room, players, firstSetupAction);
  const notifiedSetupRoom = await remoteSetupUpdate;
  assert.equal(notifiedSetupRoom.version, room.version, "second API process receives the committed setup revision through PostgreSQL notification fanout");
  const remoteHttpProjection = await jsonRequest(`/rooms/${room.code}/state?token=${encodeURIComponent(players[1].token)}`);
  assert.equal(JSON.stringify(notifiedSetupRoom), JSON.stringify(remoteHttpProjection), "cross-process WebSocket projection matches that seat's authoritative HTTP projection");

  for (let step = 1; step < 100 && room.state.setupState?.phase !== "complete"; step += 1) {
    const setup = room.state.setupState;
    assert.ok(setup, "created room exposes authoritative setup state");
    room = await postSetupAction(room, players, nextSetupAction(setup, 2));
  }
  assert.equal(room.state.setupState?.phase, "complete", "two seats can finish audited-board setup through Prisma");

  for (const player of players) {
    room = await jsonRequest(`/rooms/${room.code}/ready`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": player.token },
      body: JSON.stringify({ ready: true }),
    });
  }
  assert.equal(room.status, "active");
  const remoteSocketClosed = new Promise((resolveClose) => remoteSocket.once("close", resolveClose));
  remoteSocket.close();
  await remoteSocketClosed;

  for (let index = 0; room.state.pendingDecision?.type === "giant-placement" && index < 4; index += 1) {
    const decision = room.state.pendingDecision;
    const player = players[decision.playerIndex];
    assert.ok(player && decision.destinations.length, "immediate giant Research choice has an owner and legal base");
    const envelope = {
      actionId: `durability-giant-${randomUUID()}`,
      actorId: player.participantId,
      expectedRevision: room.version,
      protocolVersion: 1,
      command: { type: "place-giant", destination: decision.destinations[0] },
    };
    room = await submitCommand(room, player, envelope);
  }
  assert.equal(room.state.phase, "move", "the persisted room is ready for its first accepted gameplay command");
  assert.equal(room.state.boardId, "human-audited-north-america");

  const playerIndex = room.state.pendingDecision?.playerIndex ?? room.state.currentPlayer;
  const player = players[playerIndex];
  assert.ok(player, `the first gameplay action belongs to seated player ${playerIndex}`);
  const envelope = {
    actionId: `durability-pass-move-${randomUUID()}`,
    actorId: player.participantId,
    expectedRevision: room.version,
    protocolVersion: 1,
    command: { type: "pass-move" },
  };
  const concurrentResults = await Promise.all([
    submitCommand(room, player, envelope),
    submitCommand(room, player, envelope, concurrencyBaseUrl),
  ]);
  await stopConcurrencyApi();
  const [accepted, concurrentRetry] = concurrentResults;
  assert.equal(accepted.version, room.version + 1, "simultaneous cross-process action commits exactly one new revision");
  assert.equal(concurrentRetry.version, accepted.version, "the competing API process returns the winning revision");
  assert.equal(JSON.stringify(concurrentRetry.state), JSON.stringify(accepted.state), "both API processes return the same committed state");
  const acceptedVersion = accepted.version;
  const acceptedState = JSON.stringify(accepted.state);
  const roomCode = room.code;
  const roomRecord = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
  assert.ok(roomRecord, "accepted room exists in PostgreSQL");
  const privateRandomSeed = roomRecord.state?.rng?.secretSeed;
  assert.match(privateRandomSeed ?? "", /^[\da-f]{64}$/, "new production room has a persisted 256-bit private random seed");
  assert.deepEqual(accepted.state.rng, { seed: 0, cursor: 0 }, "public API projection hides its random seed and cursor");
  assert.equal(JSON.stringify(accepted.state).includes(privateRandomSeed), false, "public state does not serialize the persisted private key");
  const receiptBeforeRestart = await prisma.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: roomRecord.id, actionId: envelope.actionId } } });
  assert.equal(receiptBeforeRestart?.version, acceptedVersion, "accepted action has a durable idempotency receipt");
  await stopApi();

  startApi();
  await waitForHealth();
  const recovered = await jsonRequest(`/rooms/${roomCode}/state?token=${encodeURIComponent(player.token)}`);
  assert.equal(recovered.version, acceptedVersion, "room revision survives process restart");
  assert.equal(JSON.stringify(recovered.state), acceptedState, "authoritative room state survives process restart");
  assert.equal(JSON.stringify(recovered.state).includes("secretSeed"), false, "recovered public projection keeps the private key hidden");
  const recoveredRecord = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
  assert.equal(recoveredRecord?.state?.rng?.secretSeed, privateRandomSeed, "the private random stream survives API restart unchanged");

  const duplicate = await submitCommand(recovered, player, envelope);
  assert.equal(duplicate.version, acceptedVersion, "retry with the same action ID after restart is idempotent");
  assert.equal(JSON.stringify(duplicate.state), acceptedState, "duplicate retry does not apply the command twice");
  const receiptAfterRetry = await prisma.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: roomRecord.id, actionId: envelope.actionId } } });
  assert.equal(receiptAfterRetry?.version, acceptedVersion, "retry preserves the single durable receipt");
  const eventCountAtRevision = await prisma.gameEvent.count({ where: { roomId: roomRecord.id, version: acceptedVersion } });
  assert.equal(eventCountAtRevision, 1, "retry creates no duplicate event");

  const roomStore = new PrismaRoomStore(prisma);
  const historySession = await roomStore.createRoom(2, "PostgreSQL event-window check");
  const historyRoom = await prisma.gameRoom.findUnique({ where: { code: historySession.room.code } });
  assert.ok(historyRoom, "event-window fixture exists in PostgreSQL");
  await prisma.gameEvent.createMany({ data: Array.from({ length: 300 }, (_, index) => ({
    roomId: historyRoom.id,
    version: index + 1,
    actorId: historySession.participantId,
    type: "persistence.history.fixture",
    payload: { index: index + 1 },
  })) });
  await prisma.gameRoom.update({ where: { id: historyRoom.id }, data: { version: 300 } });

  const newestWindow = await roomStore.getRoom(historySession.room.code, historySession.token);
  assert.equal(newestWindow.events.length, 256, "Prisma/PostgreSQL room reads retain the configured 256-event response window");
  assert.equal(newestWindow.events[0]?.version, 45, "the retained PostgreSQL event window starts at the oldest of the newest 256 revisions");
  assert.equal(newestWindow.events.at(-1)?.version, 300, "the retained PostgreSQL event window ends at the current revision");
  assert.deepEqual(newestWindow.events.map((event) => event.version), Array.from({ length: 256 }, (_, index) => index + 45), "the PostgreSQL response window remains chronological and gap-free");
  const afterVersion = await roomStore.getRoom(historySession.room.code, historySession.token, 100);
  assert.deepEqual(afterVersion.events.map((event) => event.version), Array.from({ length: 200 }, (_, index) => index + 101), "afterVersion reads return only the later events within the retained window");
  assert.equal(JSON.stringify(newestWindow.state).includes("secretSeed"), false, "the PostgreSQL-backed projection does not expose the private seed");

  console.log("Two API processes verified transactional PostgreSQL WebSocket fanout, concurrent duplicate-command idempotency, restart/retry, real event-window ordering, retention, and projection boundaries.");
} finally {
  await stopConcurrencyApi();
  await stopApi();
  await prisma.$disconnect();
}
