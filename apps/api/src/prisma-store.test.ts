import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMvpRoomGame, createRoomGame, legalChopperLiftDestinations } from "@abominations/game-engine";
import { PrismaRoomStore } from "./prisma-store.js";
import { persistentAdapter } from "./test-adapter.js";

test("durable receipt makes the same action idempotent across store instances", async () => {
  const { adapter, room, receipts } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const envelope = { actionId: "restart-safe", actorId: "player-1", expectedRevision: 0, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };
  const first = await firstStore.submitAction(room.code, "token", envelope);
  const second = await secondStore.submitAction(room.code, "token", envelope);
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(receipts.size, 1);
  assert.equal(second.events.length, 1);
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
  adapter.participant.findFirst = async ({ where }: any = {}) => where?.tokenHash === guestHash ? guest : originalFindFirst({ where });
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
  adapter.participant.findFirst = async ({ where }: any = {}) => where?.tokenHash === guestHash ? guest : originalFindFirst({ where });
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
  adapter.participant.findFirst = async ({ where }: any = {}) => where?.tokenHash === guestHash ? guest : originalFindFirst({ where });
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
  room.state.players[0].researchCardIds = ["Guard Commander"];
  room.state.players[1].mutationCardIds = ["Rampage"];
  const store = new PrismaRoomStore(adapter);
  const playerView = await store.getRoom(room.code, "token");
  assert.deepEqual(playerView.state.players[0].researchCardIds, ["Guard Commander"]);
  assert.deepEqual(playerView.state.players[1].mutationCardIds, []);
  assert.deepEqual(playerView.state.decks.research.order, []);
  assert.deepEqual(playerView.state.decks.mutation.discard, []);
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

test("Prisma setup actions persist the shared state and reject stale revisions", async () => {
  const { adapter, room } = persistentAdapter();
  room.state = createRoomGame(2);
  const store = new PrismaRoomStore(adapter);
  const first = await store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, 0);
  assert.equal(first.version, 1);
  assert.equal((first.state.setupState as any).seats[0].monsterId, "monster-1");
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
