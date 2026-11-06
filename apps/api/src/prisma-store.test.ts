import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { applyCommandEnvelope, applyCompletedSetup, applySetupAction, createMvpRoomGame, createRoomGame, legalChopperLiftDestinations } from "@abominations/game-engine";
import { PrismaRoomStore } from "./prisma-store.js";
import { MAX_RETAINED_ROOM_EVENTS } from "./store.js";
import { persistentAdapter } from "./test-adapter.js";

function completedDevelopmentSetupGame() {
  const game = createRoomGame(2);
  let setup = game.setupState!;
  setup = applySetupAction(setup, 0, { type: "choose-monster", monsterId: "monster-1" });
  setup = applySetupAction(setup, 1, { type: "choose-monster", monsterId: "monster-2" });
  setup = applySetupAction(setup, 1, { type: "choose-branch", branch: "Navy" });
  setup = applySetupAction(setup, 0, { type: "choose-branch", branch: "Army" });
  setup = applySetupAction(setup, 0, { type: "choose-lair", lair: "los-angeles" });
  setup = applySetupAction(setup, 1, { type: "choose-lair", lair: "chicago" });
  setup = applySetupAction(setup, 0, { type: "choose-starting-choice", startingChoice: { kind: "research" } });
  setup = applySetupAction(setup, 1, { type: "choose-starting-choice", startingChoice: { kind: "research" } });
  game.setupState = setup;
  game.setupAssignments = setup.seats;
  return game;
}

test("Prisma room start commits the prepared snapshot and its matching event atomically", async () => {
  const { adapter, room, participant, events } = persistentAdapter();
  room.status = "WAITING";
  room.state = completedDevelopmentSetupGame();
  participant.ready = false;
  room.participants.push({
    id: "player-2", displayName: "Player 2", role: "PLAYER", playerIndex: 1, userId: null,
    tokenHash: "unused-guest-token-hash", sessionExpiresAt: new Date(Date.now() + 60_000),
    connectedAt: new Date(), disconnectedAt: null, connectionId: null, botControlled: false, botAssisted: false, ready: true,
  });

  const store = new PrismaRoomStore(adapter);
  await store.startMatch(room.code, "token");
  const started = await store.setReady(room.code, "token", true);

  assert.equal(started.status, "active");
  assert.equal(started.state.setupApplied, true);
  assert.equal(started.version, 1);
  assert.deepEqual(started.events.map(({ version, type }) => ({ version, type })), [{ version: 1, type: "match.started" }]);
  assert.deepEqual(events[0]?.replayCommand, { kind: "start" });
  assert.equal("replayCommand" in started.events[0]!, false);
  assert.deepEqual((await new PrismaRoomStore(adapter).getRoom(room.code, "token", 0)).events, started.events);
});

test("durable receipt makes the same action idempotent across store instances", async () => {
  const { adapter, room, receipts, events } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const envelope = { actionId: "restart-safe", actorId: "player-1", expectedRevision: 0, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };
  const first = await firstStore.submitAction(room.code, "token", envelope);
  const second = await secondStore.submitAction(room.code, "token", envelope);
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(receipts.size, 1);
  assert.equal(second.events.length, 1);
  assert.deepEqual(events[0]?.replayCommand, { kind: "command", playerIndex: 0, command: envelope.command });
  assert.equal("replayCommand" in second.events[0]!, false);
});

test("Prisma room creation stores a private initial replay snapshot", async () => {
  const { adapter, room } = persistentAdapter();
  const created = await new PrismaRoomStore(adapter, true).createRoom(2, "Replay owner", "public");

  assert.ok((room as any).initialReplayState);
  assert.notEqual((room as any).initialReplayState, room.state);
  assert.deepEqual((room as any).initialReplayState, room.state);
  assert.equal("initialReplayState" in created.room, false);
});

test("Prisma room creation failures log only the failed step and safe error metadata", async () => {
  const { adapter } = persistentAdapter();
  adapter.gameRoom.create = async () => {
    throw Object.assign(new Error("Query read timeout for secret-connection-details"), { code: "P6004" });
  };
  const records: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { records.push(values.map(String).join(" ")); };
  try {
    await assert.rejects(new PrismaRoomStore(adapter, true).createRoom(2), /Query read timeout/);
  } finally {
    console.error = originalError;
  }
  assert.equal(records.length, 1);
  assert.match(records[0]!, /gameRoom\.create/);
  assert.match(records[0]!, /P6004/);
  assert.doesNotMatch(records[0]!, /secret-connection-details|Query read timeout/);
});

test("Prisma public replay reconstructs a completed match with a spectator-safe projection", async () => {
  const { adapter, room, events } = persistentAdapter();
  const initial = completedDevelopmentSetupGame();
  (room as any).initialReplayState = structuredClone(initial);
  const started = applyCompletedSetup(initial);
  const terminal = applyCommandEnvelope(started, { actionId: "terminal", actorId: "player-1", expectedRevision: 1, protocolVersion: 1, command: { type: "concede" } }, 1);
  room.state = terminal.state;
  room.status = "COMPLETED";
  room.version = 2;
  events.push(
    { roomId: room.id, version: 1, type: "match.started", replayCommand: { kind: "start" } },
    { roomId: room.id, version: 2, type: terminal.eventType, replayCommand: { kind: "command", playerIndex: 0, command: { type: "concede" } } },
  );

  const page = await new PrismaRoomStore(adapter).getPublicReplay(room.code, 0, 8);
  assert.equal(page.replayable, true);
  if (!page.replayable) return;
  assert.equal(page.base.version, 0);
  assert.deepEqual(page.frames.map((frame) => frame.version), [1, 2]);
  assert.equal(page.frames.at(-1)?.state.victoryType, "concession");
  assert.deepEqual(page.frames[0]?.state.rng, { seed: 0, cursor: 0 });
  assert.deepEqual(page.frames[0]?.state.decks.research.order, []);
  assert.equal(page.frames[0]?.state.matchId, "public-replay");
  assert.deepEqual(page.frames[0]?.state.eventLog, []);
  const exported = await new PrismaRoomStore(adapter).getPublicReplayExport(room.code);
  assert.equal(exported.replayable, true);
  if (!exported.replayable) return;
  assert.equal(exported.frames.length, 3);
  assert.equal(JSON.stringify(exported).includes("secretSeed"), false);
  assert.equal(JSON.stringify(exported).includes("replayCommand"), false);
  assert.ok(exported.frames.every((frame) => frame.state.eventLog.length === 0
    && frame.state.decks.mutation.order.length === 0 && frame.state.decks.research.order.length === 0
    && frame.state.players.every((player) => player.mutationCardIds.length === 0 && player.researchCardIds.length === 0)
    && !Object.hasOwn(frame.state.rng, "secretSeed")));
  room.privacy = "PRIVATE";
  assert.deepEqual(await new PrismaRoomStore(adapter).getPublicReplay(room.code, 0, 8), { replayable: false, reason: "not-found" });
  assert.deepEqual(await new PrismaRoomStore(adapter).getPublicReplayExport(room.code), { replayable: false, reason: "not-found" });
});

test("Prisma public replay identifies completed legacy rows without replay sources", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.status = "COMPLETED";
  room.version = 1;
  events.push({ roomId: room.id, version: 1, type: "match.conceded", replayCommand: null });
  assert.deepEqual(await new PrismaRoomStore(adapter).getPublicReplay(room.code, 0, 8), { replayable: false, reason: "history-incomplete" });
});

test("concurrent Prisma retries of the same action return its single committed result", async () => {
  const { adapter, room, receipts, events } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const envelope = { actionId: "concurrent-retry", actorId: "player-1", expectedRevision: 0, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };

  const [first, second] = await Promise.all([
    firstStore.submitAction(room.code, "token", envelope),
    secondStore.submitAction(room.code, "token", envelope),
  ]);

  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(receipts.size, 1);
  assert.equal(events.length, 1);
});

test("Prisma room event deltas stay chronological after selecting the newest retained rows", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.stompMarkers = 2;
  const store = new PrismaRoomStore(adapter);
  const moved = await store.submitAction(room.code, "token", {
    actionId: "ordered-event-move",
    actorId: "player-1",
    expectedRevision: 0,
    protocolVersion: 1,
    command: { type: "move", path: ["los-angeles", "san-francisco"] },
  });
  const encountered = await store.submitAction(room.code, "token", {
    actionId: "ordered-event-encounter",
    actorId: "player-1",
    expectedRevision: moved.version,
    protocolVersion: 1,
    command: { type: "resolve-encounter", choice: "health" },
  });

  assert.deepEqual(encountered.events.map((event) => event.version), [1, 2]);
  assert.deepEqual((await store.getRoom(room.code, "token", 1)).events.map((event) => event.version), [2]);
});

test("Prisma room snapshots retain the newest bounded event suffix in chronological order", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.version = 300;
  for (let version = 1; version <= room.version; version += 1) {
    events.push({ id: `event-${version}`, roomId: room.id, version, actorId: "player-1", type: `event.${version}`, controlSource: "human", payload: {}, createdAt: new Date(version) });
  }

  const view = await new PrismaRoomStore(adapter).getRoom(room.code, "token");
  const versions = view.events.map((event) => event.version);
  assert.equal(versions.length, MAX_RETAINED_ROOM_EVENTS);
  assert.equal(versions[0], 300 - MAX_RETAINED_ROOM_EVENTS + 1);
  assert.equal(versions.at(-1), 300);
  assert.deepEqual(versions, [...versions].sort((left, right) => left - right));
});

test("Prisma room reads report snapshot-event revision gaps once and still return the snapshot", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.version = 4;
  for (const version of [1, 2, 4]) {
    events.push({ id: `event-${version}`, roomId: room.id, version, actorId: "player-1", type: `event.${version}`, controlSource: "human", payload: {}, createdAt: new Date(version) });
  }
  const issues: Array<{ roomCode: string; snapshotVersion: number; latestEventVersion: number | null; missingVersionCount: number }> = [];
  const store = new PrismaRoomStore(adapter, false, (issue) => issues.push(issue));

  const snapshot = await store.getRoom(room.code, "token");
  const delta = await store.getRoom(room.code, "token", 2);

  assert.equal(snapshot.version, 4);
  assert.deepEqual(snapshot.events.map((event) => event.version), [1, 2, 4]);
  assert.deepEqual(delta.events.map((event) => event.version), [4]);
  assert.deepEqual(issues, [{ roomCode: room.code, snapshotVersion: 4, latestEventVersion: 4, missingVersionCount: 1 }]);
});

test("a new version-zero Prisma room without match events is not reported as divergent", async () => {
  const { adapter, room } = persistentAdapter();
  const issues: unknown[] = [];
  const store = new PrismaRoomStore(adapter, false, (issue) => issues.push(issue));

  const snapshot = await store.getRoom(room.code, "token");

  assert.equal(snapshot.version, 0);
  assert.deepEqual(snapshot.events, []);
  assert.deepEqual(issues, []);
});

test("Prisma-backed rooms authorize an off-turn defending monster Mutation owner", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "fight";
  room.state.players[1]!.mutationCardIds = ["Berserk"];
  const monster = room.state.monsters[1]!;
  const unit = room.state.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = monster.location;
  const battleId = "prisma-off-turn-mutation";
  room.state.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  room.state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const guestToken = "guest-token";
  const guestHash = createHash("sha256").update(guestToken).digest("hex");
  const guest = { id: "player-2", role: "PLAYER", playerIndex: 1, sessionExpiresAt: new Date(Date.now() + 60_000) };
  const originalFindFirst = adapter.participant.findFirst;
  adapter.participant.findFirst = async ({ where, include }: any = {}) => where?.tokenHash === guestHash ? { ...guest, ...(include?.room ? { room: { ...room, participants: room.participants, events: [] } } : {}) } : originalFindFirst({ where, include });
  const store = new PrismaRoomStore(adapter);
  const envelope = { actionId: "prisma-off-turn-berserk", actorId: guest.id, expectedRevision: room.version, protocolVersion: 1 as const, command: { type: "use-mutation" as const, cardId: "Berserk" as const, battleId } };
  await assert.rejects(() => store.submitAction(room.code, "token", { ...envelope, actorId: "player-1", actionId: "prisma-wrong-owner" }), /It is not your turn/);
  const after = await store.submitAction(room.code, guestToken, envelope);
  assert.equal(after.state.pendingBattles[0]!.bonusMonsterAttacks, 5);
  assert.deepEqual(after.state.players[1]!.mutationCardIds, []);
});

test("Prisma-backed Toxicor Mutation choices belong to the monster owner and survive refresh", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "fight";
  room.state.monsters[1]!.name = "Toxicor";
  const battleUnit = room.state.units[0]!;
  battleUnit.location = room.state.monsters[1]!.location;
  room.state.pendingBattles = [{ id: "prisma-toxicor-choice", monsterId: room.state.monsters[1]!.id, location: room.state.monsters[1]!.location as `${number},${number}`, militaryUnitIds: [battleUnit.id] }];
  room.state.pendingMutationChoice = { playerIndex: 1, monsterId: room.state.monsters[1]!.id, cardIds: ["War Spikes", "Atomic Breath"], source: "battle" };
  room.state.pendingDecision = { type: "mutation-choice", playerIndex: 1, monsterId: room.state.monsters[1]!.id, cardIds: ["War Spikes", "Atomic Breath"] };
  room.state.decks.mutation = { order: ["War Spikes", "Atomic Breath"], drawIndex: 2, discard: [], exhausted: true };
  const guestToken = "guest-token";
  const guestHash = createHash("sha256").update(guestToken).digest("hex");
  const guest = { id: "player-2", role: "PLAYER", playerIndex: 1, sessionExpiresAt: new Date(Date.now() + 60_000) };
  const originalFindFirst = adapter.participant.findFirst;
  adapter.participant.findFirst = async ({ where, include }: any = {}) => where?.tokenHash === guestHash ? { ...guest, ...(include?.room ? { room: { ...room, participants: room.participants, events: [] } } : {}) } : originalFindFirst({ where, include });
  const store = new PrismaRoomStore(adapter);
  const before = await store.getRoom(room.code, guestToken);
  assert.deepEqual(before.state.pendingDecision?.type === "mutation-choice" ? before.state.pendingDecision.cardIds : [], ["War Spikes", "Atomic Breath"]);
  await assert.rejects(() => store.submitAction(room.code, "token", {
    actionId: "prisma-wrong-toxicor-owner",
    actorId: "player-1",
    expectedRevision: before.version,
    protocolVersion: 1,
    command: { type: "choose-mutation-card", cardId: "War Spikes" },
  }), /It is not your turn/);
  const chosen = await store.submitAction(room.code, guestToken, {
    actionId: "prisma-toxicor-owner-choice",
    actorId: guest.id,
    expectedRevision: before.version,
    protocolVersion: 1,
    command: { type: "choose-mutation-card", cardId: "War Spikes" },
  });
  assert.deepEqual(chosen.state.players[1]!.mutationCardIds, ["War Spikes"]);
  assert.equal(chosen.state.pendingDecision?.type, "battle-resolution");
  assert.deepEqual((await store.getRoom(room.code, guestToken)).state.players[1]!.mutationCardIds, ["War Spikes"]);
  assert.equal(room.state.decks.mutation.order.includes("Atomic Breath"), true);
});

test("Prisma-backed rooms authorize the off-turn Laser Fence cardholder", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "move";
  room.state.players[1]!.researchCardIds = ["Laser Fence"];
  room.state.monsters[0]!.infamy = 3;
  room.state.laserFenceWindowMonsterIds = [room.state.monsters[0]!.id];
  room.state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: room.state.monsters[0]!.id };
  const guestToken = "guest-token";
  const guestHash = createHash("sha256").update(guestToken).digest("hex");
  const guest = { id: "player-2", role: "PLAYER", playerIndex: 1, sessionExpiresAt: new Date(Date.now() + 60_000) };
  const originalFindFirst = adapter.participant.findFirst;
  adapter.participant.findFirst = async ({ where, include }: any = {}) => where?.tokenHash === guestHash ? { ...guest, ...(include?.room ? { room: { ...room, participants: room.participants, events: [] } } : {}) } : originalFindFirst({ where, include });
  const store = new PrismaRoomStore(adapter);
  const envelope = { actionId: "prisma-off-turn-laser-fence", actorId: guest.id, expectedRevision: room.version, protocolVersion: 1 as const, command: { type: "use-research" as const, cardId: "Laser Fence" as const, targetMonsterId: "monster-1", choice: "infamy" as const } };
  await assert.rejects(() => store.submitAction(room.code, "token", { ...envelope, actorId: "player-1", actionId: "prisma-wrong-laser-fence-owner" }), /It is not your turn/);
  const after = await store.submitAction(room.code, guestToken, envelope);
  assert.equal(after.state.monsters[0]!.infamy, 1);
  assert.deepEqual(after.state.players[1]!.researchCardIds, []);
  assert.deepEqual(room.state.decks.research.discard, ["Laser Fence"]);
  assert.equal((await store.getRoom(room.code, guestToken)).version, after.version);
});

test("Prisma-backed Chopper Lift keeps its rolled choice durable and owned by the active player", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "move";
  room.state.players[0]!.researchCardIds = ["Chopper Lift"];
  room.state.monsters[0]!.infamy = 2;
  room.state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: room.state.monsters[0]!.id };
  const store = new PrismaRoomStore(adapter);
  const before = await store.getRoom(room.code, "token");
  const rollEnvelope = { actionId: "prisma-chopper-roll", actorId: "player-1", expectedRevision: before.version, protocolVersion: 1 as const, command: { type: "use-research" as const, cardId: "Chopper Lift" as const } };
  const rolled = await store.submitAction(room.code, "token", rollEnvelope);
  const roll = rolled.state.pendingChopperLift?.roll;
  assert.ok(roll);
  assert.equal((await store.getRoom(room.code, "token")).state.pendingChopperLift?.roll, roll);
  const destination = legalChopperLiftDestinations(rolled.state, "monster-1", roll)[0];
  assert.ok(destination);
  const choiceEnvelope = { actionId: "prisma-chopper-choice", actorId: "player-1", expectedRevision: rolled.version, protocolVersion: 1 as const, command: { type: "resolve-chopper-lift" as const, targetMonsterId: "monster-1", destination } };
  const completed = await store.submitAction(room.code, "token", choiceEnvelope);
  assert.equal(completed.state.monsters[0]!.location, destination);
  assert.equal(completed.state.monsters[0]!.infamy, 1);
  assert.equal(completed.state.pendingChopperLift, undefined);
  assert.equal(room.state.decks.research.discard.includes("Chopper Lift"), true);
});

test("Prisma-backed Stabilizer Ray preserves and resolves its post-damage Mutation choice", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "fight";
  room.state.players[0]!.researchCardIds = ["Stabilizer Ray"];
  room.state.players[1]!.mutationCardIds = ["Rampage"];
  const monster = room.state.monsters[1]!;
  monster.defense = 1;
  const unit = room.state.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = monster.location;
  unit.defense = 99;
  const battleId = "prisma-stabilizer-ray";
  room.state.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  room.state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const store = new PrismaRoomStore(adapter);
  const submit = async (actionId: string, expectedRevision: number, command: any) => store.submitAction(room.code, "token", { actionId, actorId: "player-1", expectedRevision, protocolVersion: 1, command });
  const before = await store.getRoom(room.code, "token");
  const armed = await submit("prisma-stabilizer-ray-arm", before.version, { type: "use-research", cardId: "Stabilizer Ray", battleId });
  assert.equal(armed.state.pendingBattles[0]!.stabilizerRayPlayerIndex, 0);
  const fought = await submit("prisma-stabilizer-ray-fight", armed.version, { type: "resolve-fight", battleId });
  assert.equal(fought.state.pendingDecision?.type, "stabilizer-ray-choice");
  assert.deepEqual(fought.state.pendingStabilizerRayChoice?.cardIds, ["Rampage"]);
  const refreshedChoice = await store.getRoom(room.code, "token");
  assert.equal(refreshedChoice.state.pendingDecision?.type, "stabilizer-ray-choice");
  const chosen = await submit("prisma-stabilizer-ray-choice", refreshedChoice.version, { type: "choose-stabilizer-ray-mutation", cardId: "Rampage" });
  assert.equal(chosen.state.pendingStabilizerRayChoice, undefined);
  assert.equal(chosen.state.pendingDecision?.type, "retreat");
  assert.deepEqual(room.state.players[1]!.mutationCardIds, []);
  assert.equal(room.state.decks.mutation.discard.includes("Rampage"), true);
});

test("MVP Prisma room creation pins the human-audited board", async () => {
  const { adapter } = persistentAdapter();
  const state = createMvpRoomGame(2);
  assert.equal(state.boardId, "human-audited-north-america");
  assert.equal(state.setupState?.phase, "monster-selection");
  assert.doesNotThrow(() => new PrismaRoomStore(adapter));
});

test("Prisma store health proves the database adapter is reachable", async () => {
  const { adapter } = persistentAdapter();
  assert.deepEqual(await new PrismaRoomStore(adapter).health(), { persistence: "prisma" });
});

test("Prisma room polling reads an authorized room in one client query", async () => {
  const { adapter, room } = persistentAdapter();
  let participantReads = 0;
  let roomReads = 0;
  const findParticipant = adapter.participant.findFirst;
  const findRoom = adapter.gameRoom.findUnique;
  adapter.participant.findFirst = async (input: any) => { participantReads += 1; return findParticipant(input); };
  adapter.gameRoom.findUnique = async (input: any) => { roomReads += 1; return findRoom(input); };

  const view = await new PrismaRoomStore(adapter).getRoom(room.code, "token");

  assert.equal(view.code, room.code);
  assert.equal(participantReads, 1);
  assert.equal(roomReads, 0);
});

test("Prisma session rotation preserves the participant and revokes the old token", async () => {
  const { adapter, room } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const rotated = await store.rotateSession(room.code, "token");
  assert.equal(rotated.participantId, "player-1");
  assert.notEqual(rotated.token, "token");
  await assert.rejects(() => store.getRoom(room.code, "token"), /Invalid room token/);
  assert.equal((await store.getRoom(room.code, rotated.token)).participants[0]?.id, "player-1");
});

test("Prisma rejects expired sessions", async () => {
  const { adapter, room } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  (adapter as any).participant.findFirst = async () => ({ id: "player-1", role: "PLAYER", playerIndex: 0, sessionExpiresAt: new Date(Date.now() - 1) });
  await assert.rejects(() => store.getRoom(room.code, "token"), /Session token has expired/);
});

test("Prisma reconnect leases ignore stale tab disconnects", async () => {
  const { adapter, room } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const first = await firstStore.reconnect(room.code, "token", "tab-a");
  assert.equal(first.participants[0]?.connected, true);
  await secondStore.reconnect(room.code, "token", "tab-b");
  const staleClose = await firstStore.disconnect(room.code, "token", "tab-a");
  assert.equal(staleClose.participants[0]?.connected, true);
  const currentClose = await secondStore.disconnect(room.code, "token", "tab-b");
  assert.equal(currentClose.participants[0]?.connected, false);
});

test("Prisma projections redact another player's hand and deck order", async () => {
  const { adapter, room } = persistentAdapter();
  room.state.rng.secretSeed = "aa".repeat(32);
  room.state.players[0].researchCardIds = ["Guard Commander"];
  room.state.players[1].mutationCardIds = ["Rampage"];
  const store = new PrismaRoomStore(adapter);
  const playerView = await store.getRoom(room.code, "token");
  assert.deepEqual(playerView.state.players[0].researchCardIds, ["Guard Commander"]);
  assert.deepEqual(playerView.state.players[1].mutationCardIds, []);
  assert.deepEqual(playerView.state.decks.research.order, []);
  assert.deepEqual(playerView.state.decks.mutation.discard, []);
  assert.deepEqual(playerView.state.rng, { seed: 0, cursor: 0 });
  assert.equal(JSON.stringify(playerView).includes("secretSeed"), false);
  assert.equal(room.state.rng.secretSeed, "aa".repeat(32), "projection redaction does not mutate the persisted private key");
});

test("terminal command persists completed room status and winner result atomically", async () => {
  const { adapter, room, results } = persistentAdapter();
  room.state.stompMarkers = 1;
  const store = new PrismaRoomStore(adapter);
  const command = async (actionId: string, expectedRevision: number, command: any) => store.submitAction(room.code, "token", { actionId, actorId: "player-1", expectedRevision, protocolVersion: 1, command });
  await command("finish-move", 0, { type: "move", path: ["los-angeles", "san-francisco"] });
  const result = await command("finish-encounter", 1, { type: "resolve-encounter", choice: "health" });
  assert.equal(room.status, "COMPLETED");
  assert.equal(result.status, "completed");
  assert.equal((results.get(room.id) as any).winnerId, "player-1");
  assert.deepEqual((results.get(room.id) as any).summary, {
    winnerPlayer: 0,
    victoryType: "development-stomp-exhaustion",
    rulesetVersion: "prototype-0.1",
    durationRounds: 1,
    terminalEvent: { type: "encounter.resolved", version: 2 },
    finalStandings: room.state.monsters.map((monster: any, playerIndex: number) => ({
      playerIndex,
      playerId: room.state.players[playerIndex].id,
      monsterId: monster.id,
      monsterName: monster.name,
      health: monster.health,
      infamy: monster.infamy,
      location: monster.location,
      winner: playerIndex === 0,
    })),
  });
});

test("terminal transaction writes one public stat row for each linked account seat, including bot-assisted play", async () => {
  const { adapter, room, participant, matchStats } = persistentAdapter();
  room.state.stompMarkers = 1;
  room.state.setupAssignments = [
    { playerIndex: 0, branch: "Navy" },
    { playerIndex: 1, branch: "Army" },
  ] as any;
  (participant as any).userId = "account-1";
  (participant as any).user = { username: "public-player" };
  participant.botAssisted = true;
  const store = new PrismaRoomStore(adapter);
  const command = async (actionId: string, expectedRevision: number, commandValue: any) => store.submitAction(room.code, "token", { actionId, actorId: "player-1", expectedRevision, protocolVersion: 1, command: commandValue });
  await command("finish-linked-move", 0, { type: "move", path: ["los-angeles", "san-francisco"] });
  await command("finish-linked-encounter", 1, { type: "resolve-encounter", choice: "health" });
  const rows = [...matchStats.values()] as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.username, "public-player");
  assert.equal(rows[0]?.outcome, "win");
  assert.equal(rows[0]?.branch, "Navy");
  assert.equal(rows[0]?.botAssisted, true);
});

test("Prisma setup actions persist the shared state and reject stale revisions", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.state = createRoomGame(2);
  (room as any).matchStarted = true;
  const store = new PrismaRoomStore(adapter);
  const first = await store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, 0);
  assert.equal(first.version, 1);
  assert.equal((first.state.setupState as any).seats[0].monsterId, "monster-1");
  assert.deepEqual(events[0]?.replayCommand, { kind: "setup", playerIndex: 0, action: { type: "choose-monster", monsterId: "monster-1" } });
  assert.equal("replayCommand" in first.events[0]!, false);
  await assert.rejects(() => store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-2" }, 0), /Expected revision/);
});

test("Prisma maps a concurrent player-seat uniqueness collision to a full-room response", async () => {
  const { adapter, room } = persistentAdapter();
  (adapter as any).participant.count = async () => 1;
  (adapter as any).participant.create = async () => {
    const error = new Error("unique seat");
    (error as Error & { code?: string }).code = "P2002";
    throw error;
  };
  await assert.rejects(() => new PrismaRoomStore(adapter).joinRoom(room.code, "Racer"), /room is full/);
});
