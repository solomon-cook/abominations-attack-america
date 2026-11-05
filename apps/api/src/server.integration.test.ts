import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { WebSocket } from "ws";
import { BRANCH_DEPLOYMENT_DEFINITIONS, boardForState, hasStompableEncounterFeature, legalMonsterPaths, legalOwnedDeploymentDestinations, type GameCommand, type GameState, type SetupAction } from "@abominations/game-engine";
import type { RoomView } from "@abominations/shared";
import { chooseBotSetupActionWithRecord } from "../../../packages/game-engine/src/bots.js";
import { unusedBranchPlacementPlayer } from "../../../packages/game-engine/src/setup.js";

type RoomPayload = Pick<RoomView, "code" | "version" | "state" | "status" | "participants"> & { events: Array<{ version: number }> };
type PlayerSession = { participantId: string; token: string };

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await wait(25);
  }
  throw new Error("API server did not become healthy in time.");
}

async function startMatch(baseUrl: string, code: string, token: string): Promise<void> {
  const response = await fetch(`${baseUrl}/rooms/${code}/start`, { method: "POST", headers: { "x-room-token": token } });
  const result = await response.json() as { error?: string };
  assert.equal(response.ok, true, result.error ?? `Could not start room ${code}.`);
}

async function createWebSocketTicket(baseUrl: string, code: string, token: string): Promise<string> {
  const response = await fetch(`${baseUrl}/rooms/${code}/ws-ticket`, {
    method: "POST",
    headers: { "x-room-token": token },
  });
  const result = await response.json() as { ticket?: string; error?: string };
  assert.equal(response.ok, true, result.error ?? `WebSocket ticket failed with HTTP ${response.status}`);
  assert.ok(result.ticket);
  return result.ticket;
}

function nextSetupAction(setup: NonNullable<GameState["setupState"]>, playerCount: 3 | 4): { playerIndex: number; action: SetupAction } {
  if (setup.phase === "monster-selection") {
    const seat = setup.seats.find((candidate) => !candidate.monsterId)!;
    const monsterId = setup.definition.monsterIds.find((candidate) => !setup.seats.some((assigned) => assigned.monsterId === candidate));
    if (!monsterId) throw new Error("No unselected monster remains during setup.");
    return { playerIndex: seat.playerIndex, action: { type: "choose-monster", monsterId } };
  }
  if (setup.phase === "branch-selection") {
    const seat = [...setup.seats].reverse().find((candidate) => !candidate.branch)!;
    const branch = setup.definition.eligibleBranches.find((candidate) => !setup.seats.some((assigned) => assigned.branch === candidate));
    if (!branch) throw new Error("No unselected branch remains during setup.");
    return { playerIndex: seat.playerIndex, action: { type: "choose-branch", branch } };
  }
  if (setup.phase === "unused-branch-placement") {
    const catalogue = setup.definition.unusedBranchPlacements;
    if (!catalogue) throw new Error("Unused-branch setup is missing its audited placement catalogue.");
    const unusedBranches = setup.definition.eligibleBranches.filter((branch) => !setup.seats.some((seat) => seat.branch === branch));
    const placements = unusedBranches.flatMap((branch) => (catalogue.unitIdsByBranch[branch] ?? []).map((unitId, index) => ({
      unitId,
      destination: catalogue.basesByBranch[branch]?.[index]!,
    })));
    return { playerIndex: playerCount - 1, action: { type: "place-unused-branches", placements } };
  }
  if (setup.phase === "lair-selection") {
    const seat = setup.seats.find((candidate) => !candidate.lair)!;
    const lair = setup.definition.lairsByMonster[seat.monsterId!]?.find((candidate) => !setup.seats.some((assigned) => assigned.lair === candidate));
    if (!lair) throw new Error(`No unused audited lair remains for ${seat.monsterId}.`);
    return { playerIndex: seat.playerIndex, action: { type: "choose-lair", lair } };
  }
  if (setup.phase === "starting-choice") {
    const seat = setup.seats.find((candidate) => !candidate.startingChoice)!;
    return { playerIndex: seat.playerIndex, action: { type: "choose-starting-choice", startingChoice: { kind: "research" } } };
  }
  throw new Error(`No setup action can be selected during ${setup.phase}.`);
}

function nextSeededSetupAction(game: GameState, setup: NonNullable<GameState["setupState"]>): { playerIndex: number; action: SetupAction } {
  const playerIndex = setup.phase === "monster-selection"
    ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
    : setup.phase === "branch-selection"
      ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
      : setup.phase === "unused-branch-placement"
        ? unusedBranchPlacementPlayer(setup)
        : setup.phase === "lair-selection"
          ? setup.seats.find((seat) => !seat.lair)?.playerIndex
          : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
  assert.notEqual(playerIndex, undefined, `setup actor for ${setup.phase}`);
  if (setup.phase === "starting-choice") {
    return { playerIndex: playerIndex!, action: { type: "choose-starting-choice", startingChoice: { kind: "research" } } };
  }
  const result = chooseBotSetupActionWithRecord(game, setup, playerIndex!);
  assert.ok(result.action, `bot setup action for ${setup.phase}`);
  return { playerIndex: playerIndex!, action: result.action };
}

function nextWebSocketMessage(socket: WebSocket): Promise<RoomPayload> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      const message = JSON.parse(data.toString()) as { type: string; room: RoomPayload };
      resolve(message.room);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { socket.off("message", onMessage); socket.off("error", onError); };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function stop(process: ChildProcess): Promise<void> {
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

test("production API startup fails closed without durable database configuration", async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ALLOWED_ORIGIN: "https://play.example.test",
    PORT: String(24000 + (process.pid % 1000)),
    DATABASE_URL: "",
    PRISMA_DATABASE_URL: "",
    POSTGRES_URL: "",
  };
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const result = await new Promise<{ code: number | null }>((resolve) => child.once("exit", (code) => resolve({ code })));
  assert.notEqual(result.code, 0);
  assert.match(stderr, /production API requires DATABASE_URL/i);
});

test("API WebSocket and polling share revisioned room updates", async () => {
  const port = 19000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createResponse.json() as { room?: RoomPayload; token?: string; participantId?: string; error?: string };
    assert.equal(createResponse.ok, true, created.error ?? `Room creation failed with HTTP ${createResponse.status}`);
    assert.ok(created.room && created.token && created.participantId);
    const joinedResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Player 2" }) });
    assert.equal(joinedResponse.ok, true);
    await startMatch(baseUrl, created.room.code, created.token);
    const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket)}`);
    const initialSocketPromise = nextWebSocketMessage(socket);
    await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
    const initialSocketRoom = await initialSocketPromise;
    const initialHttpRoom = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(initialSocketRoom.version, initialHttpRoom.version);
    assert.equal(initialSocketRoom.state.setupState?.phase, initialHttpRoom.state.setupState?.phase);

    const updatePromise = nextWebSocketMessage(socket);
    const setupResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initialHttpRoom.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
    });
    assert.equal(setupResponse.ok, true);
    const updatedSocketRoom = await updatePromise;
    const polledRoom = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}&afterVersion=${initialHttpRoom.version}`).then((response) => response.json()) as RoomPayload;
    assert.equal(updatedSocketRoom.version, polledRoom.version);
    assert.equal(updatedSocketRoom.version, initialHttpRoom.version + 1);
    assert.deepEqual(updatedSocketRoom.state.setupState, polledRoom.state.setupState);
    assert.equal(polledRoom.events[0]?.version, updatedSocketRoom.version);
    socket.close();
  } finally {
    await stop(child);
  }
});

test("API completes audited-board setup and readiness for three- and four-player rooms", async () => {
  const port = 21200 + (process.pid % 700);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), PERSISTENCE: "memory", ALLOW_DEVELOPMENT_FIXTURE: "false", DEVELOPMENT_API_RATE_LIMIT: "1000" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    let commonBoardHash: string | undefined;
    for (const playerCount of [3, 4] as const) {
      const createdResponse = await fetch(`${baseUrl}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPlayers: playerCount, displayName: "Player 1", privacy: "public" }),
      });
      const created = await createdResponse.json() as { room: RoomPayload; participantId: string; token: string; error?: string };
      assert.equal(createdResponse.ok, true, created.error ?? `Could not create ${playerCount}-player room.`);
      const players: PlayerSession[] = [{ participantId: created.participantId, token: created.token }];
      let room = created.room;
      const liveReplayResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay`);
      assert.equal(liveReplayResponse.status, 409, "public replay access is available only after completion");
      assert.equal((await fetch(`${baseUrl}/rooms/${room.code}/replay/export`)).status, 409, "public export is available only after completion");

      for (let playerIndex = 1; playerIndex < playerCount; playerIndex += 1) {
        const joinedResponse = await fetch(`${baseUrl}/rooms/${room.code}/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: `Player ${playerIndex + 1}` }),
        });
        const joined = await joinedResponse.json() as { room: RoomPayload; participantId: string; token: string; error?: string };
        assert.equal(joinedResponse.ok, true, joined.error ?? `Could not join ${playerCount}-player room.`);
        players.push({ participantId: joined.participantId, token: joined.token });
        room = joined.room;
      }

      await startMatch(baseUrl, room.code, players[0]!.token);

      for (let step = 0; step < 100 && room.state.setupState?.phase !== "complete"; step += 1) {
        const setup = room.state.setupState;
        assert.ok(setup, "new audited-board rooms begin with setup");
        const { playerIndex, action } = nextSetupAction(setup, playerCount);
        const response = await fetch(`${baseUrl}/rooms/${room.code}/setup`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-room-token": players[playerIndex]!.token },
          body: JSON.stringify({ expectedRevision: room.version, action }),
        });
        const updated = await response.json() as RoomPayload & { error?: string };
        assert.equal(response.ok, true, updated.error ?? `Setup action ${action.type} failed in a ${playerCount}-player room.`);
        room = updated;
      }
      assert.equal(room.state.setupState?.phase, "complete");

      for (const player of players) {
        const readyResponse = await fetch(`${baseUrl}/rooms/${room.code}/ready`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-room-token": player.token },
          body: JSON.stringify({ ready: true }),
        });
        const readyRoom = await readyResponse.json() as RoomPayload & { error?: string };
        assert.equal(readyResponse.ok, true, readyRoom.error ?? `A seat could not ready the ${playerCount}-player room.`);
        room = readyRoom;
      }

      assert.equal(room.status, "active");
      assert.equal(room.state.setupApplied, true);
      assert.equal(room.state.phase, "move");
      assert.equal(room.state.boardId, "human-audited-north-america");
      assert.equal(room.state.setupAssignments?.length, playerCount);
      assert.equal(room.participants.filter((participant) => participant.role === "player").length, playerCount);
      assert.equal(room.state.boardContentHash.length > 0, true);
      if (commonBoardHash) assert.equal(room.state.boardContentHash, commonBoardHash);
      commonBoardHash = room.state.boardContentHash;

      const initialMarkers = room.state.stompMarkers;
      let actionIndex = 0;
      const submit = async (command: GameCommand) => {
        const playerIndex = room.state.pendingDecision?.playerIndex ?? room.state.currentPlayer;
        const player = players[playerIndex];
        assert.ok(player, `pending action belongs to seated player ${playerIndex}`);
        const response = await fetch(`${baseUrl}/rooms/${room.code}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-room-token": player.token },
          body: JSON.stringify({ envelope: {
            actionId: `route-${playerCount}-${actionIndex++}`,
            actorId: player.participantId,
            expectedRevision: room.version,
            protocolVersion: 1,
            command,
          } }),
        });
        const updated = await response.json() as RoomPayload & { error?: string };
        assert.equal(response.ok, true, updated.error ?? `API rejected ${command.type} during the ${playerCount}-player route.`);
        room = updated;
      };

      for (let turn = 0; turn < 250 && room.status === "active"; turn += 1) {
        const state = room.state;
        if (state.pendingDecision?.type === "giant-placement") {
          const destination = state.pendingDecision.destinations[0];
          if (!destination) throw new Error(`No legal base is available for ${state.pendingDecision.cardId}.`);
          await submit({ type: "place-giant", destination });
        } else if (state.phase === "move") {
          const monster = state.monsters[state.currentPlayer]!;
          const board = boardForState(state);
          const targets = Object.values(board.hexes)
            .filter((hex) => hasStompableEncounterFeature(hex.features) && !state.stompedLocations.includes(hex.key))
            .map((hex) => hex.key);
          if (targets.includes(monster.location as typeof targets[number])) {
            await submit({ type: "pass-move" });
          } else {
            const path = legalMonsterPaths(state, monster.id)
              .filter((candidate) => targets.includes(candidate.at(-1)!))
              .sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!))[0];
            await submit(path ? { type: "move", path } : { type: "pass-move" });
          }
        } else if (state.phase === "fight") {
          const decision = state.pendingDecision;
          if (decision?.type === "attack-target") {
            await submit({ type: "resolve-fight", battleId: decision.battleId, targetUnitId: decision.targetIds[0]! });
          } else if (decision?.type === "retreat" && state.pendingRetreat) {
            const destinations = Object.fromEntries(state.pendingRetreat.unitIds.map((unitId) => [unitId, state.pendingRetreat!.options[unitId]?.[0] ?? "disappeared"]));
            await submit({ type: "retreat", destinations });
          } else {
            await submit({ type: "resolve-fight" });
          }
        } else if (state.phase === "encounter") {
          const decision = state.pendingDecision;
          if (decision?.type === "encounter-choice") {
            await submit({ type: "resolve-encounter", choice: decision.choices[0] ?? "health" });
          } else if (decision?.type === "trophy-choice") {
            await submit({ type: "resolve-encounter", trophyUnitId: state.pendingTrophyChoice?.unitIds[0] });
          } else {
            await submit({ type: "advance" });
          }
        } else if (state.phase === "deploy") {
          await submit({ type: "pass-deploy" });
        } else if (state.phase === "challenge") {
          const decision = state.pendingDecision;
          if (decision?.type === "challenge-opponent") {
            await submit({ type: "challenge-opponent", opponentMonsterId: decision.opponentIds[0]! });
          } else if (decision?.type === "challenge-giant") {
            await submit({ type: "challenge-giant", giantUnitId: decision.giantUnitIds[0]! });
          } else if (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution") {
            await submit(state.challenge?.turn?.remainingAttacks
              ? { type: "resolve-challenge" }
              : { type: "resolve-challenge", endTurn: true });
          } else {
            throw new Error(`Unexpected Challenge decision in the API route: ${JSON.stringify(decision)}.`);
          }
        } else {
          throw new Error(`Unexpected active room phase in the API route: ${state.phase}.`);
        }
      }

      assert.equal(room.status, "completed", `${playerCount}-player API route should persist the terminal room status`);
      assert.equal(room.state.victoryType, "monster-challenge");
      assert.notEqual(room.state.winnerPlayer, undefined);
      assert.equal(room.state.stompMarkers, 0);
      assert.equal(initialMarkers, playerCount === 3 ? 17 : 20);
      assert.ok(actionIndex > initialMarkers, "the API route includes setup phases beyond Stomp depletion");
      const firstReplayStartedAt = performance.now();
      const replayResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay?fromVersion=${room.version}&limit=1`);
      assert.equal(replayResponse.status, 200);
      const replayText = await replayResponse.text();
      const firstReplayMilliseconds = performance.now() - firstReplayStartedAt;
      const replay = JSON.parse(replayText) as { replayable: boolean; base?: { version: number; state: RoomPayload["state"] }; frames?: Array<{ version: number; state: RoomPayload["state"] }> };
      assert.equal(replay.replayable, true);
      assert.equal(replay.base?.version, room.version);
      assert.equal(replay.base?.state.victoryType, "monster-challenge");
      assert.deepEqual(replay.base?.state.decks.mutation.order, []);
      assert.deepEqual(replay.base?.state.decks.research.order, []);
      assert.equal(JSON.stringify(replay).includes("secretSeed"), false);
      assert.deepEqual(replay.frames, []);
      if (playerCount === 3) {
        const exportStartedAt = performance.now();
        const exportResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay/export`);
        assert.equal(exportResponse.status, 200);
        const exportText = await exportResponse.text();
        const exportMilliseconds = performance.now() - exportStartedAt;
        const exported = JSON.parse(exportText) as { replayable: boolean; terminalVersion?: number; frames?: Array<{ version: number; state: RoomPayload["state"] }> };
        assert.equal(exported.replayable, true);
        assert.equal(exported.terminalVersion, room.version);
        assert.equal(exported.frames?.length, room.version + 1);
        assert.equal(JSON.stringify(exported).includes("secretSeed"), false);
        assert.equal(JSON.stringify(exported).includes("replayCommand"), false);
        assert.ok(exported.frames?.every((frame) => frame.state.eventLog.length === 0
          && frame.state.decks.mutation.order.length === 0 && frame.state.decks.research.order.length === 0
          && frame.state.players.every((player) => player.mutationCardIds.length === 0 && player.researchCardIds.length === 0)
          && !Object.hasOwn(frame.state.rng, "secretSeed")));

        let fromVersion = 0;
        let pagedBytes = 0;
        let pageCount = 0;
        const pagedVersions = [0];
        const pagingStartedAt = performance.now();
        while (true) {
          const pageResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay?fromVersion=${fromVersion}&limit=12`);
          assert.equal(pageResponse.status, 200);
          const pageText = await pageResponse.text();
          assert.ok(Buffer.byteLength(pageText) <= 700_000, "each replay page must stay within the 700 KB response budget");
          pagedBytes += Buffer.byteLength(pageText);
          pageCount += 1;
          const page = JSON.parse(pageText) as { replayable: boolean; base?: { version: number }; frames?: Array<{ version: number }>; nextFromVersion?: number };
          assert.equal(page.replayable, true);
          assert.equal(page.base?.version, fromVersion);
          for (const frame of page.frames ?? []) pagedVersions.push(frame.version);
          if (page.nextFromVersion === undefined) break;
          assert.ok(page.nextFromVersion > fromVersion, "paged history must advance monotonically");
          fromVersion = page.nextFromVersion;
        }
        assert.deepEqual(pagedVersions, Array.from({ length: room.version + 1 }, (_, version) => version), "paged replay must cover the complete version history without gaps or duplicates");
        if (process.env.REPLAY_BENCHMARK === "1") {
          console.log(JSON.stringify({ replayBenchmark: true, playerCount, terminalVersion: room.version, firstReplayBytes: Buffer.byteLength(replayText), firstReplayMilliseconds: Number(firstReplayMilliseconds.toFixed(2)), exportBytes: Buffer.byteLength(exportText), cachedExportMilliseconds: Number(exportMilliseconds.toFixed(2)), pageCount, pagedBytes, cachedFullPagingMilliseconds: Number((performance.now() - pagingStartedAt).toFixed(2)), completeVersionCoverage: pagedVersions.length }));
        }
      }
    }
  } finally {
    await stop(child);
  }
});

for (const [playerCount, seed] of [[2, 13], [3, 204], [4, 2]] as const) {
test(`${playerCount}-player API room can reach America Saved through legal room actions`, async () => {
  const port = 22000 + playerCount + (process.pid % 700);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      PERSISTENCE: process.env.API_VICTORY_ROUTE_PERSISTENCE ?? "memory",
      TEST_ROOM_SEED: String(seed),
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      DEVELOPMENT_API_RATE_LIMIT: "1000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createdResponse = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: playerCount, displayName: "Player 1", privacy: "public" }),
    });
    const created = await createdResponse.json() as { room: RoomPayload; participantId: string; token: string; error?: string };
    assert.equal(createdResponse.ok, true, created.error ?? `Could not create a ${playerCount}-player API room.`);
    const players: PlayerSession[] = [{ participantId: created.participantId, token: created.token }];
    let room = created.room;

    for (let playerIndex = 1; playerIndex < playerCount; playerIndex += 1) {
      const joinedResponse = await fetch(`${baseUrl}/rooms/${room.code}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: `Player ${playerIndex + 1}` }),
      });
      const joined = await joinedResponse.json() as { room: RoomPayload; participantId: string; token: string; error?: string };
      assert.equal(joinedResponse.ok, true, joined.error ?? `Could not join seat ${playerIndex + 1}.`);
      players.push({ participantId: joined.participantId, token: joined.token });
      room = joined.room;
    }

    await startMatch(baseUrl, room.code, players[0]!.token);

    for (let step = 0; step < 100 && room.state.setupState?.phase !== "complete"; step += 1) {
      const setup = room.state.setupState;
      assert.ok(setup, "new audited-board rooms begin with setup");
      const { playerIndex, action } = nextSeededSetupAction(room.state, setup);
      const response = await fetch(`${baseUrl}/rooms/${room.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": players[playerIndex]!.token },
        body: JSON.stringify({ expectedRevision: room.version, action }),
      });
      const updated = await response.json() as RoomPayload & { error?: string };
      assert.equal(response.ok, true, updated.error ?? `Setup action ${action.type} failed.`);
      room = updated;
    }
    assert.equal(room.state.setupState?.phase, "complete");

    for (const player of players) {
      const readyResponse = await fetch(`${baseUrl}/rooms/${room.code}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": player.token },
        body: JSON.stringify({ ready: true }),
      });
      const readyRoom = await readyResponse.json() as RoomPayload & { error?: string };
      assert.equal(readyResponse.ok, true, readyRoom.error ?? "A player could not ready the room.");
      room = readyRoom;
    }
    assert.equal(room.status, "active");
    assert.equal(room.state.boardId, "human-audited-north-america");

    let actionIndex = 0;
    const initialMarkers = room.state.stompMarkers;
    const phases = new Set<GameState["phase"]>();
    const submit = async (command: GameCommand) => {
      const playerIndex = room.state.pendingDecision?.playerIndex ?? room.state.currentPlayer;
      const player = players[playerIndex];
      assert.ok(player, `the pending action belongs to seated player ${playerIndex}`);
      const response = await fetch(`${baseUrl}/rooms/${room.code}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": player.token },
        body: JSON.stringify({ envelope: {
          actionId: `america-saved-${actionIndex++}`,
          actorId: player.participantId,
          expectedRevision: room.version,
          protocolVersion: 1,
          command,
        } }),
      });
      const updated = await response.json() as RoomPayload & { error?: string };
      assert.equal(response.ok, true, updated.error ?? `API rejected ${command.type}.`);
      room = updated;
    };

    for (let turn = 0; turn < 250 && room.status === "active"; turn += 1) {
      const actorIndex = room.state.pendingDecision?.playerIndex ?? room.state.currentPlayer;
      const refreshedResponse = await fetch(`${baseUrl}/rooms/${room.code}/state?token=${encodeURIComponent(players[actorIndex]!.token)}`);
      const refreshed = await refreshedResponse.json() as RoomPayload & { error?: string };
      assert.equal(refreshedResponse.ok, true, refreshed.error ?? "Could not refresh the room for its active player.");
      room = refreshed;
      let state = room.state;
      phases.add(state.phase);
      if (state.pendingDecision?.type === "giant-placement") {
        const destination = state.pendingDecision.destinations.at(-1);
        assert.ok(destination, `the ${state.pendingDecision.cardId} placement must have a legal base`);
        await submit({ type: "place-giant", destination });
      } else if (state.phase === "move") {
        if (playerCount === 2 && state.stompMarkers === 2 && state.currentPlayer === 0
          && state.players[0]!.researchCardIds.includes("Defense Satellites")) {
          await submit({ type: "use-research", cardId: "Defense Satellites" });
          state = room.state;
        }
        const monster = state.monsters[state.currentPlayer]!;
        const pending = Object.values(boardForState(state).hexes).filter((hex) =>
          hasStompableEncounterFeature(hex.features) && !state.stompedLocations.includes(hex.key),
        );
        const nonHealing = pending.filter((hex) =>
          hex.features.some((feature) => feature.kind === "infamy-site" || feature.kind === "military-base")
          && !hex.features.some((feature) => feature.kind === "city"),
        );
        const targets = (nonHealing.length > 0 ? nonHealing : pending).map((hex) => hex.key);
        const path = targets.includes(monster.location as typeof targets[number])
          ? undefined
          : legalMonsterPaths(state, monster.id)
            .filter((candidate) => targets.includes(candidate.at(-1)!))
            .sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!))[0];
        await submit(path ? { type: "move", path } : { type: "pass-move" });
      } else if (state.phase === "fight") {
        const decision = state.pendingDecision;
        if (decision?.type === "attack-target") {
          await submit({ type: "resolve-fight", battleId: decision.battleId, targetUnitId: decision.targetIds[0]! });
        } else if (decision?.type === "retreat" && state.pendingRetreat) {
          const destinations = Object.fromEntries(decision.unitIds.map((unitId) => [unitId, state.pendingRetreat!.options[unitId]?.[0] ?? "disappeared"]));
          await submit({ type: "retreat", destinations });
        } else {
          await submit({ type: "resolve-fight" });
        }
      } else if (state.phase === "encounter") {
        const decision = state.pendingDecision;
        if (decision?.type === "encounter-choice") {
          await submit({ type: "resolve-encounter", choice: decision.choices.includes("infamy") ? "infamy" : decision.choices[0] ?? "health" });
        } else if (decision?.type === "trophy-choice") {
          await submit({ type: "resolve-encounter", trophyUnitId: state.pendingTrophyChoice?.unitIds[0] });
        } else {
          await submit({ type: "advance" });
        }
      } else if (state.phase === "deploy") {
        const branch = state.setupAssignments?.[state.currentPlayer]?.branch;
        const destinations = legalOwnedDeploymentDestinations(state);
        const unit = branch ? state.units.find((candidate) => candidate.branch === branch
          && candidate.location === "record-tile" && !state.removedUnitIds.includes(candidate.id)) : undefined;
        const allowance = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === branch)?.ownOrGuardUnits ?? 0;
        await submit(playerCount > 2 && destinations.length > 0 && unit && state.deploymentsThisTurn < allowance
          ? { type: "deploy", unitId: unit.id, destination: destinations[0]! }
          : { type: "pass-deploy" });
      } else if (state.phase === "challenge") {
        const decision = state.pendingDecision;
        if (decision?.type === "challenge-opponent") {
          await submit({ type: "challenge-opponent", opponentMonsterId: (playerCount === 3 ? decision.opponentIds.at(-1) : decision.opponentIds[0])! });
        } else if (decision?.type === "challenge-giant") {
          await submit({ type: "challenge-giant", giantUnitId: decision.giantUnitIds[0]! });
        } else if (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution") {
          await submit(state.challenge?.turn?.remainingAttacks
            ? { type: "resolve-challenge" }
            : { type: "resolve-challenge", endTurn: true });
        } else {
          throw new Error(`Unexpected Challenge decision: ${JSON.stringify(decision)}.`);
        }
      } else {
        throw new Error(`Unexpected active room phase: ${state.phase}.`);
      }
    }

    assert.equal(room.status, "completed", `the ${playerCount}-player API room reaches terminal status`);
    assert.equal(room.state.victoryType, "america-saved", `${playerCount}-player legal route should end in America Saved`);
    assert.notEqual(room.state.winnerPlayer, undefined);
    assert.equal(room.state.stompMarkers, 0);
    assert.equal(initialMarkers, playerCount === 2 ? 14 : playerCount === 3 ? 17 : 20);
    for (const phase of ["move", "fight", "encounter", "deploy", "challenge"] as const) {
      assert.ok(phases.has(phase), `the API route visits ${phase}`);
    }
    if (process.env.REPLAY_BENCHMARK_OUTPUT) {
      const firstStartedAt = performance.now();
      const firstResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay?fromVersion=${room.version}&limit=1`);
      assert.equal(firstResponse.status, 200);
      const firstText = await firstResponse.text();
      const firstPayload = JSON.parse(firstText) as { replayable: boolean; reason?: string };
      if (!firstPayload.replayable) {
        await writeFile(process.env.REPLAY_BENCHMARK_OUTPUT, `${JSON.stringify({ failedAt: "replay-page", response: firstPayload, roomVersion: room.version })}\n`, { encoding: "utf8" });
      }
      assert.equal(firstPayload.replayable, true, `PostgreSQL-backed replay reconstruction failed: ${firstText}`);
      const firstMilliseconds = performance.now() - firstStartedAt;

      const exportStartedAt = performance.now();
      const exportResponse = await fetch(`${baseUrl}/rooms/${room.code}/replay/export`);
      assert.equal(exportResponse.status, 200);
      const exportText = await exportResponse.text();
      assert.equal((JSON.parse(exportText) as { replayable: boolean; reason?: string }).replayable, true, `PostgreSQL-backed replay export failed: ${exportText}`);
      const exportMilliseconds = performance.now() - exportStartedAt;

      let fromVersion = 0;
      let pageCount = 0;
      let pagedBytes = 0;
      const pageStartedAt = performance.now();
      while (true) {
        const response = await fetch(`${baseUrl}/rooms/${room.code}/replay?fromVersion=${fromVersion}&limit=12`);
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.equal((JSON.parse(text) as { replayable: boolean; reason?: string }).replayable, true, `PostgreSQL-backed replay page failed: ${text}`);
        pageCount += 1;
        pagedBytes += Buffer.byteLength(text);
        const page = JSON.parse(text) as { nextFromVersion?: number };
        if (page.nextFromVersion === undefined) break;
        fromVersion = page.nextFromVersion;
      }
      await writeFile(process.env.REPLAY_BENCHMARK_OUTPUT, `${JSON.stringify({
        replayBenchmark: true,
        playerCount,
        terminalVersion: room.version,
        firstReplayBytes: Buffer.byteLength(firstText),
        firstReplayMilliseconds: Number(firstMilliseconds.toFixed(2)),
        exportBytes: Buffer.byteLength(exportText),
        cachedExportMilliseconds: Number(exportMilliseconds.toFixed(2)),
        pageCount,
        pagedBytes,
        cachedFullPagingMilliseconds: Number((performance.now() - pageStartedAt).toFixed(2)),
      })}\n`, { encoding: "utf8" });
    }
  } finally {
    await stop(child);
  }
});
}

test("API responses expose the documented security and CORS headers", async () => {
  const port = 19500 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true", ALLOWED_ORIGIN: "https://example.test" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("access-control-allow-origin"), "https://example.test");
    const preflight = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET,POST,PATCH,DELETE,OPTIONS");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type,x-room-token");
  } finally {
    await stop(child);
  }
});

test("metrics expose redacted error counters without private room data", async () => {
  const port = 19800 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const initial = await fetch(`${baseUrl}/metrics`).then((response) => response.json()) as Record<string, unknown>;
    for (const key of ["errorReports", "divergenceReports", "deploymentFailures"]) {
      assert.equal(typeof initial[key], "number", `missing numeric ${key}`);
      assert.equal(initial[key], 0);
    }

    const malformed = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const observed = await fetch(`${baseUrl}/metrics`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(observed.errorReports, 1);
    assert.equal(observed.divergenceReports, 0);
    assert.equal(observed.deploymentFailures, 0);
    assert.equal(Object.hasOwn(observed, "token"), false);
    assert.equal(Object.hasOwn(observed, "state"), false);
  } finally {
    await stop(child);
  }
});

test("public room discovery is available without a room token and omits private room data", async () => {
  const port = 19600 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const publicRoomResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 3, privacy: "public" }) });
    const privateRoomResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2, privacy: "private" }) });
    assert.equal(publicRoomResponse.ok, true);
    assert.equal(privateRoomResponse.ok, true);
    const discoveryResponse = await fetch(`${baseUrl}/rooms/public`);
    assert.equal(discoveryResponse.status, 200);
    const rooms = await discoveryResponse.json() as Array<Record<string, unknown>>;
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0]?.maxPlayers, 3);
    assert.equal(Object.hasOwn(rooms[0]!, "state"), false);
    assert.equal(Object.hasOwn(rooms[0]!, "token"), false);
    const privateRoom = await privateRoomResponse.json() as { room: { code: string } };
    const privateReplay = await fetch(`${baseUrl}/rooms/${privateRoom.room.code}/replay`);
    assert.equal(privateReplay.status, 404);
    const privateExport = await fetch(`${baseUrl}/rooms/${privateRoom.room.code}/replay/export`);
    assert.equal(privateExport.status, 404);
  } finally {
    await stop(child);
  }
});

test("API rejects oversized JSON bodies before mutating a room", async () => {
  const port = 19700 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2, padding: "x".repeat(70_000) }),
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /too large/i);
  } finally {
    await stop(child);
  }
});

test("bounded concurrent rooms fan out WebSocket and polling updates without cross-room state", async () => {
  const port = 20000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const sessions = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const response = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2, privacy: "public" }) });
      const created = await response.json() as { room: RoomPayload; token: string; participantId: string };
      assert.equal(response.ok, true);
      const joinedResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: `Player ${index + 1}` }) });
      assert.equal(joinedResponse.ok, true);
      await startMatch(baseUrl, created.room.code, created.token);
      const spectatorResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/spectate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: `Spectator ${index}` }) });
      const spectator = await spectatorResponse.json() as { token: string };
      assert.equal(spectatorResponse.ok, true);
      const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket)}`);
      sockets.push(socket);
      const initialSocketPromise = nextWebSocketMessage(socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
      const initialSocketRoom = await initialSocketPromise;
      const [polledHost, polledSpectator] = await Promise.all([
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(spectator.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(initialSocketRoom.code, created.room.code);
      assert.equal(polledHost.code, created.room.code);
      assert.equal(polledSpectator.code, created.room.code);
      assert.deepEqual(polledSpectator.state.setupState, polledHost.state.setupState);
      return { ...created, socket, version: polledHost.version };
    }));

    const updated = await Promise.all(sessions.map(async (session) => {
      const updatePromise = nextWebSocketMessage(session.socket);
      const response = await fetch(`${baseUrl}/rooms/${session.room.code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token },
        body: JSON.stringify({ expectedRevision: session.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
      });
      assert.equal(response.ok, true);
      const [socketRoom, polledRoom] = await Promise.all([
        updatePromise,
        fetch(`${baseUrl}/rooms/${session.room.code}/state?token=${encodeURIComponent(session.token)}&afterVersion=${session.version}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(socketRoom.code, session.room.code);
      assert.equal(socketRoom.version, session.version + 1);
      assert.equal(polledRoom.version, socketRoom.version);
      assert.deepEqual(polledRoom.state.setupState, socketRoom.state.setupState);
      return socketRoom;
    }));
    assert.equal(new Set(updated.map((room) => room.code)).size, sessions.length);
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});

test("same-room command contention commits one revision and rejects the rest", async () => {
  const port = 20500 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForHealth(baseUrl);
    const createdResponse = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPlayers: 2 }) });
    const created = await createdResponse.json() as { room: RoomPayload; token: string; participantId: string };
    assert.equal(createdResponse.ok, true);
    const joinedResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Player 2" }) });
    assert.equal(joinedResponse.ok, true);
    await startMatch(baseUrl, created.room.code, created.token);
    const initial = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    const results = await Promise.all(["contended-a", "contended-b", "contended-c", "contended-d"].map((actionId) => fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initial.version, action: { type: "choose-monster", monsterId: "monster-1" }, actionId }),
    })));
    assert.equal(results.filter((response) => response.ok).length, 1);
    assert.equal(results.filter((response) => response.status === 400).length, 3);
    const settled = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((response) => response.json()) as RoomPayload;
    assert.equal(settled.version, initial.version + 1);
    assert.deepEqual(settled.events.map((event) => event.version), [settled.version]);
  } finally {
    await stop(child);
  }
});

test("bounded reconnect storm restores the same room revision without duplicate actions", async () => {
  const port = 21000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), ALLOW_DEVELOPMENT_FIXTURE: "true" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxPlayers: 2 }),
    });
    const created = await response.json() as { room: RoomPayload; token: string; participantId: string };
    assert.equal(response.ok, true);
    const joinedResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Player 2" }) });
    assert.equal(joinedResponse.ok, true);
    await startMatch(baseUrl, created.room.code, created.token);

    const initial = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as RoomPayload;
    const setupResponse = await fetch(`${baseUrl}/rooms/${created.room.code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": created.token },
      body: JSON.stringify({ expectedRevision: initial.version, action: { type: "choose-monster", monsterId: "monster-1" } }),
    });
    assert.equal(setupResponse.ok, true);
    const settled = await fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as RoomPayload;

    const restored = await Promise.all(Array.from({ length: 12 }, async () => {
      const ticket = await createWebSocketTicket(baseUrl, created.room.code, created.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${created.room.code}&ticket=${encodeURIComponent(ticket)}`);
      sockets.push(socket);
      const socketRoomPromise = nextWebSocketMessage(socket);
      await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
      const [socketRoom, polledRoom] = await Promise.all([
        socketRoomPromise,
        fetch(`${baseUrl}/rooms/${created.room.code}/state?token=${encodeURIComponent(created.token)}`).then((result) => result.json()) as Promise<RoomPayload>,
      ]);
      assert.equal(socketRoom.version, settled.version);
      assert.equal(polledRoom.version, settled.version);
      assert.deepEqual(socketRoom.state.setupState, polledRoom.state.setupState);
      socket.close();
      return socketRoom.version;
    }));
    assert.deepEqual(new Set(restored), new Set([settled.version]));
  } finally {
    for (const socket of sockets) socket.terminate();
    await stop(child);
  }
});
