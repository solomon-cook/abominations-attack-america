import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { applySetupAction, createMvpRoomGame, createRoomGame, legalChopperLiftDestinations, legalMonsterPaths, locationIdToHexKey } from "@abominations/game-engine";
import type { JsonValue } from "@abominations/shared";
import { PrismaRoomStore } from "./prisma-store.js";
import { MAX_RETAINED_ROOM_EVENTS } from "./store.js";
import { persistentAdapter } from "./test-adapter.js";

const accessHash = (value: string) => createHash("sha256").update(value).digest("hex");

function addSecondPlayer(participants: any[]) {
  const player = { ...participants[0], id: "player-2", displayName: "Player 2", playerIndex: 1, tokenHash: accessHash("token-2"), ready: false };
  participants.push(player);
  return player;
}

async function completePrismaSetup(store: PrismaRoomStore, room: any) {
  let revision = room.version;
  const actions = [
    [0, { type: "choose-monster", monsterId: "monster-1" }],
    [1, { type: "choose-monster", monsterId: "monster-2" }],
    [1, { type: "choose-branch", branch: "Navy" }],
    [0, { type: "choose-branch", branch: "Army" }],
    [0, { type: "choose-lair", lair: "los-angeles" }],
    [1, { type: "choose-lair", lair: "chicago" }],
    [0, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [1, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ] as const;
  for (const [playerIndex, action] of actions) {
    revision = (await store.setupAction(room.code, playerIndex === 0 ? "token" : "token-2", action as any, revision)).version;
  }
  return revision;
}

function unmaterializedCompletedSetup(state: ReturnType<typeof createRoomGame>) {
  let setup = state.setupState!;
  const actions = [
    [0, { type: "choose-monster", monsterId: "monster-1" }],
    [1, { type: "choose-monster", monsterId: "monster-2" }],
    [1, { type: "choose-branch", branch: "Navy" }],
    [0, { type: "choose-branch", branch: "Army" }],
    [0, { type: "choose-lair", lair: "los-angeles" }],
    [1, { type: "choose-lair", lair: "chicago" }],
    [0, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [1, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ] as const;
  for (const [playerIndex, action] of actions) setup = applySetupAction(setup, playerIndex, action as any);
  return { ...state, setupState: setup, setupAssignments: setup.seats };
}

function expireRoomBeforeSnapshotWrite(adapter: any, room: any) {
  const originalUpdateMany = adapter.gameRoom.updateMany;
  let injected = false;
  adapter.gameRoom.updateMany = async (args: any) => {
    const snapshotGuard = args.where?.lastActivityAt && !(args.where.lastActivityAt instanceof Date) && args.data?.lastActivityAt instanceof Date;
    if (!injected && snapshotGuard) {
      injected = true;
      room.status = "EXPIRED";
    }
    return originalUpdateMany(args);
  };
  return () => injected;
}

function ageRoomBeforeSnapshotWrite(adapter: any, room: any) {
  const originalUpdateMany = adapter.gameRoom.updateMany;
  let injected = false;
  adapter.gameRoom.updateMany = async (args: any) => {
    const snapshotGuard = args.where?.lastActivityAt && !(args.where.lastActivityAt instanceof Date) && args.data?.lastActivityAt instanceof Date;
    if (!injected && snapshotGuard) {
      injected = true;
      room.lastActivityAt = new Date(0);
    }
    return originalUpdateMany(args);
  };
  return () => injected;
}

function failTransactionAt(adapter: any, transactionNumber: number, message: string) {
  const originalTransaction = adapter.$transaction;
  let transactionCalls = 0;
  adapter.$transaction = async (callback: (tx: any) => Promise<unknown>) => {
    transactionCalls += 1;
    if (transactionCalls === transactionNumber) throw new Error(message);
    return originalTransaction(callback);
  };
  return () => transactionCalls;
}

function roomCreationAdapter(failParticipantCreate = false) {
  const rooms: any[] = [];
  const participants: any[] = [];
  const operations: Array<{ transactionId: number; model: "gameRoom" | "participant" }> = [];
  let transactionCount = 0;
  const adapter: any = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const transactionId = ++transactionCount;
      const stagedRooms: any[] = [];
      const stagedParticipants: any[] = [];
      const tx = {
        gameRoom: {
          create: async ({ data }: { data: any }) => {
            operations.push({ transactionId, model: "gameRoom" });
            const room = { id: `room-${transactionId}`, status: "WAITING", version: 0, lastActivityAt: new Date(), ...data };
            stagedRooms.push(room);
            return room;
          },
        },
        participant: {
          create: async ({ data }: { data: any }) => {
            operations.push({ transactionId, model: "participant" });
            if (failParticipantCreate) throw new Error("Injected initial participant write failure.");
            const participant = { id: `participant-${transactionId}`, ...data };
            stagedParticipants.push(participant);
            return participant;
          },
        },
      };
      const result = await callback(tx);
      // This fixture commits staged rows only when the transaction callback succeeds.
      rooms.push(...stagedRooms);
      participants.push(...stagedParticipants);
      return result;
    },
    gameRoom: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const room = rooms.find((candidate) => candidate.id === where.id);
        if (!room) return null;
        return { ...room, participants: participants.filter((participant) => participant.roomId === room.id), events: [] };
      },
    },
  };
  return { adapter, rooms, participants, operations, transactionCount: () => transactionCount };
}

function expireSessionBeforeGuard(adapter: any, participant: any) {
  const originalUpdateMany = adapter.participant.updateMany;
  let injected = false;
  adapter.participant.updateMany = async (args: any) => {
    if (!injected && args.where?.sessionExpiresAt?.gt) {
      injected = true;
      participant.sessionExpiresAt = new Date(0);
    }
    return originalUpdateMany(args);
  };
  return () => injected;
}

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

test("Prisma-backed room reads migrate schema-1 snapshots before projection", async () => {
  const { adapter, room } = persistentAdapter();
  const legacy = room.state as any;
  legacy.schemaVersion = 1;
  legacy.monsters[0].location = "los-angeles";
  legacy.players[0].mutationCardIds = ["War Spikes"];
  legacy.players[1].researchCardIds = ["Laser Fence"];
  delete legacy.eventLog;

  const view = await new PrismaRoomStore(adapter).getRoom(room.code, "token");
  assert.equal(view.state.schemaVersion, 2);
  assert.deepEqual(view.state.eventLog, []);
  assert.equal(view.state.monsters[0]!.location, locationIdToHexKey("los-angeles"));
  assert.deepEqual(view.state.players[0]!.mutationCardIds, ["War Spikes"]);
  assert.deepEqual(view.state.players[1]!.researchCardIds, []);
  assert.deepEqual(view.state.players[1]!.visibleResearchCardIds, ["Laser Fence"]);
  assert.equal(legacy.schemaVersion, 1, "the view migrates a clone without silently rewriting persisted data");
  assert.equal(legacy.eventLog, undefined);
});

test("Prisma-backed rooms authorize an off-turn defending monster Mutation owner", async () => {
  const { adapter, room, participants } = persistentAdapter();
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
  const guest = addSecondPlayer(participants);
  guest.tokenHash = guestHash;
  guest.sessionExpiresAt = new Date(Date.now() + 60_000);
  const store = new PrismaRoomStore(adapter);
  const envelope = { actionId: "prisma-off-turn-berserk", actorId: guest.id, expectedRevision: room.version, protocolVersion: 1 as const, command: { type: "use-mutation" as const, cardId: "Berserk" as const, battleId } };
  await assert.rejects(() => store.submitAction(room.code, "token", { ...envelope, actorId: "player-1", actionId: "prisma-wrong-owner" }), /It is not your turn/);
  const after = await store.submitAction(room.code, guestToken, envelope);
  assert.equal(after.state.pendingBattles[0]!.bonusMonsterAttacks, 5);
  assert.deepEqual(after.state.players[1]!.mutationCardIds, []);
});

test("Prisma room projection preserves legacy JSON roots and unknown event names", async () => {
  const { adapter, room, events } = persistentAdapter();
  const payloads: JsonValue[] = [
    null,
    false,
    17,
    "legacy scalar",
    [{ label: "visible", cardId: "private-card", nested: [{ mutationCardId: "private-mutation", detail: "preserved" }] }],
  ];
  events.push(...payloads.map((payload, index) => ({
    id: `legacy-json-${index}`,
    roomId: room.id,
    version: index + 1,
    actorId: "legacy-actor",
    type: `legacy.unknown.${index}`,
    payload,
    createdAt: new Date(),
  })));

  const view = await new PrismaRoomStore(adapter).getRoom(room.code, "token");

  assert.deepEqual(view.events.map((event) => event.type), payloads.map((_payload, index) => `legacy.unknown.${index}`).reverse());
  assert.deepEqual(view.events.map((event) => event.payload), [
    [{ label: "visible", nested: [{ detail: "preserved" }] }],
    "legacy scalar",
    17,
    false,
    null,
  ]);
});

test("Prisma room projections distinguish an exact event cap from a truncated cursor range", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.version = MAX_RETAINED_ROOM_EVENTS + 1;
  events.push(...Array.from({ length: MAX_RETAINED_ROOM_EVENTS + 1 }, (_, index) => ({
    id: `retained-${index + 1}`,
    roomId: room.id,
    version: index + 1,
    actorId: "player-1",
    type: "turn.passed",
    payload: {},
    createdAt: new Date(),
  })));
  const store = new PrismaRoomStore(adapter);

  const exactlyAtLimit = await store.getRoom(room.code, "token", 1);
  assert.equal(exactlyAtLimit.events.length, MAX_RETAINED_ROOM_EVENTS);
  assert.equal(exactlyAtLimit.eventsTruncated, false, "256 events after the cursor fit without a gap");
  assert.equal(exactlyAtLimit.events[0]?.version, MAX_RETAINED_ROOM_EVENTS + 1);
  assert.equal(exactlyAtLimit.events.at(-1)?.version, 2);

  const olderCursor = await store.getRoom(room.code, "token", 0);
  assert.equal(olderCursor.events.length, MAX_RETAINED_ROOM_EVENTS, "the public event list remains capped at 256");
  assert.equal(olderCursor.eventsTruncated, true, "a 257-event cursor range reports its omitted oldest event");
  assert.equal(olderCursor.events[0]?.version, MAX_RETAINED_ROOM_EVENTS + 1);
  assert.equal(olderCursor.events.at(-1)?.version, 2);
});

test("concurrent account resume uses compare-and-set so only the winning session token is returned", async () => {
  const { adapter, room, participant } = persistentAdapter();
  participant.userId = "account-1";
  const store = new PrismaRoomStore(adapter);

  const results = await Promise.allSettled([
    store.resumeParticipant(room.id, { id: "account-1", username: "player-one" }),
    store.resumeParticipant(room.id, { id: "account-1", username: "player-one" }),
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.resumeParticipant>>> => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1, "only one concurrent request may rotate the participant token observed before the transaction");
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0]!.reason), /resumed from another session/);
  const winner = fulfilled[0]!.value;
  assert.equal(participant.tokenHash, createHash("sha256").update(winner.token).digest("hex"));
  assert.equal(participant.displayName, "player-one");
  assert.equal(participant.connectedAt, null);
});

test("Prisma-backed Toxicor Mutation choices belong to the monster owner and survive refresh", async () => {
  const { adapter, room, participants } = persistentAdapter();
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
  const guest = addSecondPlayer(participants);
  guest.tokenHash = guestHash;
  guest.sessionExpiresAt = new Date(Date.now() + 60_000);
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
  const { adapter, room, participants } = persistentAdapter();
  room.state.currentPlayer = 0;
  room.state.phase = "move";
  room.state.players[1]!.researchCardIds = ["Laser Fence"];
  room.state.monsters[0]!.infamy = 3;
  room.state.laserFenceWindowMonsterIds = [room.state.monsters[0]!.id];
  room.state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: room.state.monsters[0]!.id };
  const guestToken = "guest-token";
  const guestHash = createHash("sha256").update(guestToken).digest("hex");
  const guest = addSecondPlayer(participants);
  guest.tokenHash = guestHash;
  guest.sessionExpiresAt = new Date(Date.now() + 60_000);
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

test("MVP Prisma room creation pins the current board candidate", async () => {
  const { adapter } = persistentAdapter();
  const state = createMvpRoomGame(2);
  assert.equal(state.boardId, "human-audited-north-america");
  assert.equal(state.setupState?.phase, "monster-selection");
  assert.doesNotThrow(() => new PrismaRoomStore(adapter));
});

test("Prisma room and creator seat are created in one transaction", async () => {
  const fixture = roomCreationAdapter();

  const result = await new PrismaRoomStore(fixture.adapter).createRoom(2, "Room Host", "public");

  assert.equal(fixture.transactionCount(), 1);
  assert.deepEqual(fixture.operations, [
    { transactionId: 1, model: "gameRoom" },
    { transactionId: 1, model: "participant" },
  ]);
  assert.equal(fixture.rooms.length, 1);
  assert.equal(fixture.participants.length, 1);
  assert.deepEqual(fixture.rooms[0]?.playerStats, [
    { stompedTiles: 0, damageTaken: 0, healthGained: 0, luckTotal: 0, luckRolls: 0 },
    { stompedTiles: 0, damageTaken: 0, healthGained: 0, luckTotal: 0, luckRolls: 0 },
  ]);
  assert.equal(fixture.participants[0]?.roomId, fixture.rooms[0]?.id);
  assert.equal(result.room.code, fixture.rooms[0]?.code);
  assert.equal(result.room.participants[0]?.displayName, "Room Host");
});

test("Prisma room creation rolls back the staged room when creator-seat creation fails", async () => {
  const fixture = roomCreationAdapter(true);

  await assert.rejects(() => new PrismaRoomStore(fixture.adapter).createRoom(2, "Room Host"), /Injected initial participant write failure/);

  assert.equal(fixture.transactionCount(), 1);
  assert.deepEqual(fixture.operations, [
    { transactionId: 1, model: "gameRoom" },
    { transactionId: 1, model: "participant" },
  ]);
  assert.deepEqual(fixture.rooms, [], "staged room rows are discarded when the transaction callback fails");
  assert.deepEqual(fixture.participants, []);
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

test("Prisma socket leases stop consuming, connecting, projecting, and acting after session expiry", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);

  const expiredBeforeConsume = await store.createSocketTicket(room.code, "token");
  participant.sessionExpiresAt = new Date(Date.now() - 1);
  await assert.rejects(() => store.consumeSocketTicket(room.code, expiredBeforeConsume.ticket), /Session token has expired/);

  participant.sessionExpiresAt = new Date(Date.now() + 60_000);
  const expiredBeforeConnect = await store.createSocketTicket(room.code, "token", expiredBeforeConsume.connectionId);
  const pending = await store.consumeSocketTicket(room.code, expiredBeforeConnect.ticket);
  participant.sessionExpiresAt = new Date(Date.now() - 1);
  await assert.rejects(() => store.connectParticipant(room.code, participant.id, pending.connectionId, pending.sessionHash), /expired/);

  participant.sessionExpiresAt = new Date(Date.now() + 60_000);
  const openTicket = await store.createSocketTicket(room.code, "token", expiredBeforeConnect.connectionId);
  const openPrincipal = await store.consumeSocketTicket(room.code, openTicket.ticket);
  await store.connectParticipant(room.code, participant.id, openPrincipal.connectionId, openPrincipal.sessionHash);
  participant.sessionExpiresAt = new Date(Date.now() - 1);
  assert.equal(await store.getRoomForConnection(room.code, participant.id, openPrincipal.connectionId, openPrincipal.sessionHash), undefined);
  await assert.rejects(() => store.submitActionForParticipant(room.code, participant.id, openPrincipal.connectionId, openPrincipal.sessionHash, {
    actionId: "expired-session-socket-action", actorId: participant.id, expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" },
  }), /Session token has expired/);
});

test("Prisma preserves idle active rooms while a player seat is linked, but expires unlinked active rooms", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  room.status = "ACTIVE";
  room.lastActivityAt = new Date(0);
  (participant as any).userId = "account-1";
  assert.equal((await store.getRoom(room.code, "token")).status, "active");
  assert.equal(room.status, "ACTIVE");

  const unlinked = persistentAdapter();
  unlinked.room.status = "ACTIVE";
  unlinked.room.lastActivityAt = new Date(0);
  await assert.rejects(() => new PrismaRoomStore(unlinked.adapter).getRoom(unlinked.room.code, "token"), /room has expired/);
  assert.equal(unlinked.room.status, "EXPIRED");
});

test("Prisma guards an active linked room write using the linked-seat idle-expiry exemption", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "ACTIVE";
  room.lastActivityAt = new Date(0);
  participant.userId = "account-1";

  const result = await new PrismaRoomStore(adapter).rotateSession(room.code, "token");

  assert.equal(room.status, "ACTIVE");
  assert.equal(participant.tokenHash, accessHash(result.token));
  assert.equal(room.lastActivityAt.getTime(), 0, "session rotation guards liveness without refreshing room activity");
});

test("Prisma socket actions cannot revive a room after its idle timeout", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const ticket = await store.createSocketTicket(room.code, "token");
  const principal = await store.consumeSocketTicket(room.code, ticket.ticket);
  await store.connectParticipant(room.code, participant.id, principal.connectionId, principal.sessionHash);
  room.lastActivityAt = new Date(0);
  const originalVersion = room.version;
  const originalState = room.state;

  await assert.rejects(() => store.submitActionForParticipant(room.code, participant.id, principal.connectionId, principal.sessionHash, {
    actionId: "idle-expired-socket-action", actorId: participant.id, expectedRevision: room.version, protocolVersion: 1, command: { type: "pass-move" },
  }), /room has expired/);
  assert.equal(room.status, "EXPIRED");
  assert.equal(room.version, originalVersion);
  assert.equal(room.state, originalState);
});

test("Prisma idle expiry rechecks after a concurrent activity refresh wins the stale CAS", async () => {
  const { adapter, room } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  room.status = "ACTIVE";
  room.lastActivityAt = new Date(0);
  const staleRead = { ...room, lastActivityAt: new Date(room.lastActivityAt) };
  const originalUpdateMany = adapter.gameRoom.updateMany;
  let refreshedConcurrently = false;
  adapter.gameRoom.updateMany = async (args: any) => {
    if (!refreshedConcurrently && args.data?.status === "EXPIRED") {
      refreshedConcurrently = true;
      room.lastActivityAt = new Date();
    }
    return originalUpdateMany(args);
  };

  await (store as any).assertRoomNotExpired(staleRead);
  assert.equal(refreshedConcurrently, true);
  assert.equal(room.status, "ACTIVE");
  assert.ok(Date.now() - room.lastActivityAt.getTime() < 1_000);
});

test("Prisma expired rooms cannot be rejoined, spectated, or resumed", async () => {
  const { adapter, room } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  room.lastActivityAt = new Date(0);

  await assert.rejects(() => store.joinRoom(room.code, "Late Player"), /room has expired/);
  assert.equal(room.status, "EXPIRED");
  await assert.rejects(() => store.spectateRoom(room.code, "Late Spectator"), /room has expired/);
  await assert.rejects(() => store.reconnect(room.code, "token"), /room has expired/);

  // An EXPIRED status remains terminal even if the activity timestamp changes.
  room.lastActivityAt = new Date();
  await assert.rejects(() => store.getRoom(room.code, "token"), /room has expired/);
  assert.equal(room.status, "EXPIRED");
});

test("Prisma room entry does not create a player seat after idle expiry wins the room snapshot CAS", async () => {
  const { adapter, room, participants } = persistentAdapter();
  room.status = "WAITING";
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  await assert.rejects(() => new PrismaRoomStore(adapter).joinRoom(room.code, "Late Player"), /room has expired/);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participants.length, 1, "the stale join must not append a participant");
});

test("Prisma spectator entry does not create a seat after idle expiry wins the room snapshot CAS", async () => {
  const { adapter, room, participants } = persistentAdapter();
  room.status = "WAITING";
  room.privacy = "PUBLIC";
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  await assert.rejects(() => new PrismaRoomStore(adapter).spectateRoom(room.code, "Late Spectator"), /room has expired/);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participants.length, 1, "the stale spectate request must not append a participant");
});

test("Prisma readiness does not change after idle expiry wins the room snapshot CAS", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "WAITING";
  participant.ready = false;
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  await assert.rejects(() => new PrismaRoomStore(adapter).setReady(room.code, "token", true), /room has expired/);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participant.ready, false);
});

test("Prisma setup does not advance after idle expiry wins the room snapshot CAS", async () => {
  const { adapter, room, events } = persistentAdapter();
  room.status = "WAITING";
  room.state = createRoomGame(2);
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  await assert.rejects(() => new PrismaRoomStore(adapter).setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, room.version), /room has expired/);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(room.version, 0);
  assert.equal(room.state.setupState?.seats[0]?.monsterId, undefined);
  assert.equal(events.length, 0);
});

test("Prisma room entry rechecks idle age if the room crosses its timeout before the snapshot write", async () => {
  const { adapter, room, participants } = persistentAdapter();
  room.status = "WAITING";
  const injected = ageRoomBeforeSnapshotWrite(adapter, room);

  await assert.rejects(() => new PrismaRoomStore(adapter).joinRoom(room.code, "Late Player"), /room has expired/);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participants.length, 1, "the timestamp-expired join must not append a participant");
});

test("Prisma background bot takeover does not take over a participant after expiry wins the room snapshot", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "ACTIVE";
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  const changedRooms = await new PrismaRoomStore(adapter).processBotTakeovers();

  assert.equal(injected(), true);
  assert.deepEqual(changedRooms, []);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participant.botControlled, false);
  assert.equal(participant.botAssisted, false);
});

test("Prisma bot setup does not commit after expiry wins the guarded setup snapshot", async () => {
  const { adapter, room, participant, events } = persistentAdapter();
  room.status = "WAITING";
  room.state = createRoomGame(2);
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  participant.botControlled = true;
  const previousState = room.state;
  const injected = expireRoomBeforeSnapshotWrite(adapter, room);

  await (new PrismaRoomStore(adapter) as any).runBotActions(room.code);

  assert.equal(injected(), true);
  assert.equal(room.status, "EXPIRED");
  assert.equal(room.version, 0);
  assert.equal(room.state, previousState);
  assert.equal(events.length, 0);
});

test("Prisma bot setup quietly stops when bot control changes before its setup lease commits", async () => {
  const { adapter, room, participant, events } = persistentAdapter();
  room.status = "WAITING";
  room.state = createRoomGame(2);
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  participant.botControlled = true;
  const originalUpdateMany = adapter.participant.updateMany;
  let injected = false;
  adapter.participant.updateMany = async (args: any) => {
    if (!injected && args.where?.botControlled === true && args.where?.connectedAt === null && args.where?.disconnectedAt instanceof Date) {
      injected = true;
      return { count: 0 };
    }
    return originalUpdateMany(args);
  };

  await (new PrismaRoomStore(adapter) as any).runBotActions(room.code);

  assert.equal(injected, true);
  assert.equal(room.version, 0);
  assert.equal(events.length, 0);
  assert.equal(room.state.setupState?.phase, "monster-selection");
});

test("Prisma bot command quietly stops when bot control changes before its command lease commits", async () => {
  const { adapter, room, participant, participants, events } = persistentAdapter();
  room.status = "ACTIVE";
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  participant.botControlled = true;
  const guest = addSecondPlayer(participants);
  guest.connectedAt = new Date();
  guest.disconnectedAt = null;
  guest.botControlled = false;
  room.state.currentPlayer = 0;
  room.state.phase = "move";
  room.state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: room.state.monsters[0]!.id };
  const originalUpdateMany = adapter.participant.updateMany;
  let injected = false;
  adapter.participant.updateMany = async (args: any) => {
    if (!injected && args.where?.botControlled === true && args.where?.connectedAt === null && args.where?.disconnectedAt === undefined && Object.keys(args.where).length === 4) {
      injected = true;
      return { count: 0 };
    }
    return originalUpdateMany(args);
  };

  await (new PrismaRoomStore(adapter) as any).runBotActions(room.code);

  assert.equal(injected, true);
  assert.equal(room.version, 0);
  assert.equal(events.length, 0);
});

test("Prisma bot setup propagates an unexpected persistence transaction failure", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "WAITING";
  room.state = createRoomGame(2);
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  participant.botControlled = true;
  const transactionCalls = failTransactionAt(adapter, 1, "Injected bot setup persistence failure.");

  await assert.rejects(() => new PrismaRoomStore(adapter).processBotTakeovers(), /Injected bot setup persistence failure/);

  assert.equal(transactionCalls(), 1, "the scheduled takeover must reach the bot setup transaction");
});

test("Prisma bot command propagates an unexpected persistence transaction failure", async () => {
  const { adapter, room, participant, participants } = persistentAdapter();
  room.status = "ACTIVE";
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 5 * 60_000);
  participant.botControlled = true;
  const guest = addSecondPlayer(participants);
  guest.connectedAt = new Date();
  guest.disconnectedAt = null;
  guest.botControlled = false;
  // An active move decision gives player zero a deterministic legal bot command.
  room.state.currentPlayer = 0;
  room.state.phase = "move";
  room.state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: room.state.monsters[0]!.id };
  const transactionCalls = failTransactionAt(adapter, 2, "Injected bot command persistence failure.");

  await assert.rejects(() => new PrismaRoomStore(adapter).processBotTakeovers(), /Injected bot command persistence failure/);

  assert.equal(transactionCalls(), 2, "the first transaction refreshes presence and the second commits the bot command");
});

test("Prisma credential and socket lease writes stop when an expiry snapshot wins", async () => {
  const operations: Array<{
    name: string;
    prepare: (store: PrismaRoomStore, fixture: ReturnType<typeof persistentAdapter>) => Promise<() => Promise<unknown>>;
    assertUnchanged: (fixture: ReturnType<typeof persistentAdapter>, before: any) => void;
  }> = [
    {
      name: "HTTP disconnect",
      prepare: async (store, fixture) => () => store.disconnect(fixture.room.code, "token"),
      assertUnchanged: ({ participant }, before) => { assert.equal(participant.connectedAt, before.connectedAt); assert.equal(participant.disconnectedAt, before.disconnectedAt); },
    },
    {
      name: "reconnect",
      prepare: async (store, fixture) => () => store.reconnect(fixture.room.code, "token", "legacy", "new-connection"),
      assertUnchanged: ({ participant }, before) => { assert.equal(participant.connectionId, before.connectionId); assert.equal(participant.connectedAt, before.connectedAt); },
    },
    {
      name: "session rotation",
      prepare: async (store, fixture) => () => store.rotateSession(fixture.room.code, "token"),
      assertUnchanged: ({ participant, socketTickets }, before) => { assert.equal(participant.tokenHash, before.tokenHash); assert.equal(socketTickets.size, 0); },
    },
    {
      name: "account claim",
      prepare: async (store, fixture) => () => store.claimParticipant(fixture.room.code, "token", { id: "account-1", username: "linked", emailVerifiedAt: new Date() }),
      assertUnchanged: ({ participant }, before) => { assert.equal(participant.tokenHash, before.tokenHash); assert.equal(participant.userId, before.userId); },
    },
    {
      name: "account resume",
      prepare: async (store, fixture) => { fixture.participant.userId = "account-1"; return () => store.resumeParticipant(fixture.room.id, { id: "account-1", username: "linked" }); },
      assertUnchanged: ({ participant }, before) => { assert.equal(participant.tokenHash, before.tokenHash); assert.equal(participant.displayName, before.displayName); },
    },
    {
      name: "ticket creation",
      prepare: async (store, fixture) => () => store.createSocketTicket(fixture.room.code, "token"),
      assertUnchanged: ({ participant, socketTickets }, before) => { assert.equal(participant.connectionId, before.connectionId); assert.equal(socketTickets.size, 0); },
    },
    {
      name: "ticket consumption",
      prepare: async (store, fixture) => {
        const issued = await store.createSocketTicket(fixture.room.code, "token");
        const ticket = [...fixture.socketTickets.values()][0];
        return () => store.consumeSocketTicket(fixture.room.code, issued.ticket).then(() => ticket);
      },
      assertUnchanged: ({ socketTickets }, before) => { assert.equal([...socketTickets.values()][0]?.consumedAt, before.consumedAt); },
    },
    {
      name: "socket connection",
      prepare: async (store, fixture) => {
        const issued = await store.createSocketTicket(fixture.room.code, "token");
        const principal = await store.consumeSocketTicket(fixture.room.code, issued.ticket);
        return () => store.connectParticipant(fixture.room.code, fixture.participant.id, principal.connectionId, principal.sessionHash);
      },
      assertUnchanged: ({ participant }, before) => { assert.equal(participant.connectedAt, before.connectedAt); assert.equal(participant.botControlled, before.botControlled); },
    },
  ];

  for (const operation of operations) {
    const fixture = persistentAdapter();
    const store = new PrismaRoomStore(fixture.adapter);
    const invoke = await operation.prepare(store, fixture);
    const before = { ...fixture.participant, consumedAt: [...fixture.socketTickets.values()][0]?.consumedAt };
    const injected = expireRoomBeforeSnapshotWrite(fixture.adapter, fixture.room);

    await assert.rejects(invoke, /room has expired/, operation.name);

    assert.equal(injected(), true, `${operation.name} must use a guarded room snapshot`);
    assert.equal(fixture.room.status, "EXPIRED");
    operation.assertUnchanged(fixture, before);
  }
});

test("Prisma session-bound writes recheck the session deadline inside their transaction", async () => {
  const operations: Array<{
    name: string;
    prepare: (store: PrismaRoomStore, fixture: ReturnType<typeof persistentAdapter>) => Promise<() => Promise<unknown>>;
  }> = [
    { name: "HTTP disconnect", prepare: async (store, fixture) => () => store.disconnect(fixture.room.code, "token") },
    { name: "reconnect", prepare: async (store, fixture) => () => store.reconnect(fixture.room.code, "token", "legacy", "next-lease") },
    { name: "same-lease reconnect retry", prepare: async (store, fixture) => { fixture.participant.connectionId = "existing-lease"; return () => store.reconnect(fixture.room.code, "token", "existing-lease", "existing-lease"); } },
    { name: "session rotation", prepare: async (store, fixture) => () => store.rotateSession(fixture.room.code, "token") },
    { name: "account claim", prepare: async (store, fixture) => () => store.claimParticipant(fixture.room.code, "token", { id: "account-1", username: "linked", emailVerifiedAt: new Date() }) },
    { name: "readiness", prepare: async (store, fixture) => { fixture.room.status = "WAITING"; return () => store.setReady(fixture.room.code, "token", true); } },
    { name: "setup", prepare: async (store, fixture) => { fixture.room.status = "WAITING"; fixture.room.state = createRoomGame(2); return () => store.setupAction(fixture.room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, fixture.room.version); } },
    { name: "HTTP command", prepare: async (store, fixture) => () => store.submitAction(fixture.room.code, "token", { actionId: "session-expiry-boundary", actorId: fixture.participant.id, expectedRevision: fixture.room.version, protocolVersion: 1, command: { type: "pass-move" } }) },
    { name: "ticket issuance", prepare: async (store, fixture) => () => store.createSocketTicket(fixture.room.code, "token") },
    { name: "ticket consumption", prepare: async (store, fixture) => { const ticket = await store.createSocketTicket(fixture.room.code, "token"); return () => store.consumeSocketTicket(fixture.room.code, ticket.ticket); } },
    { name: "socket activation", prepare: async (store, fixture) => { const ticket = await store.createSocketTicket(fixture.room.code, "token"); const principal = await store.consumeSocketTicket(fixture.room.code, ticket.ticket); return () => store.connectParticipant(fixture.room.code, principal.participantId, principal.connectionId, principal.sessionHash); } },
  ];

  for (const operation of operations) {
    const fixture = persistentAdapter();
    const store = new PrismaRoomStore(fixture.adapter);
    const invoke = await operation.prepare(store, fixture);
    const injected = expireSessionBeforeGuard(fixture.adapter, fixture.participant);

    await assert.rejects(invoke, /Session token has expired\./, operation.name);

    assert.equal(injected(), true, `${operation.name} must compare the session deadline in its transaction`);
    assert.equal(fixture.participant.sessionExpiresAt.getTime(), 0);
  }
});

test("Prisma idempotent reconnect rejects a room expired during lifecycle refresh", async () => {
  const { adapter, room, participant } = persistentAdapter();
  participant.connectionId = "existing-lease";
  const store = new PrismaRoomStore(adapter);
  (store as any).refreshStatus = async () => { room.status = "EXPIRED"; };

  await assert.rejects(() => store.reconnect(room.code, "token", "existing-lease", "existing-lease"), /room has expired/);
  assert.equal(room.status, "EXPIRED");
});

test("Prisma reconnect and credential projections reject expiry during view loading", async () => {
  const operations: Array<{
    name: string;
    prepare: (store: PrismaRoomStore, fixture: ReturnType<typeof persistentAdapter>) => Promise<() => Promise<unknown>>;
  }> = [
    { name: "reconnect", prepare: async (store, fixture) => () => store.reconnect(fixture.room.code, "token", "legacy", "next-lease") },
    { name: "same-lease reconnect", prepare: async (store, fixture) => { fixture.participant.connectionId = "existing-lease"; return () => store.reconnect(fixture.room.code, "token", "existing-lease", "existing-lease"); } },
    { name: "session rotation", prepare: async (store, fixture) => () => store.rotateSession(fixture.room.code, "token") },
    { name: "account resume", prepare: async (store, fixture) => { fixture.participant.userId = "account-1"; return () => store.resumeParticipant(fixture.room.id, { id: "account-1", username: "linked" }); } },
  ];

  for (const operation of operations) {
    const fixture = persistentAdapter();
    const store = new PrismaRoomStore(fixture.adapter);
    const invoke = await operation.prepare(store, fixture);
    const originalView = (store as any).view.bind(store);
    let injected = false;
    (store as any).view = async (...args: any[]) => {
      const projection = await originalView(...args);
      injected = true;
      fixture.room.status = "EXPIRED";
      return projection;
    };

    await assert.rejects(invoke, /room has expired/, operation.name);
    assert.equal(injected, true, `${operation.name} must load a projection before its final expiry check`);
    assert.equal(fixture.room.status, "EXPIRED");
  }
});

test("Prisma account claim advances activity so a stale unlinked expiry snapshot cannot win", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "ACTIVE";
  const staleActivityAt = new Date(room.lastActivityAt);
  const staleExpiryWhere = {
    id: room.id,
    status: room.status,
    lastActivityAt: staleActivityAt,
    participants: { none: { userId: { not: null }, role: "PLAYER" } },
  };

  await new PrismaRoomStore(adapter).claimParticipant(room.code, "token", { id: "account-1", username: "linked", emailVerifiedAt: new Date() });

  assert.equal(participant.userId, "account-1");
  assert.ok(room.lastActivityAt.getTime() > staleActivityAt.getTime());
  const staleExpiry = await adapter.gameRoom.updateMany({ where: staleExpiryWhere, data: { status: "EXPIRED" } });
  assert.equal(staleExpiry.count, 0, "claim's room touch invalidates the pre-link idle-expiry snapshot");
  assert.equal(room.status, "ACTIVE");
});

test("Prisma account claim locks UserAccount before the participant row", async () => {
  for (const alreadyLinked of [false, true]) {
    const { adapter, participant } = persistentAdapter();
    if (alreadyLinked) participant.userId = "account-1";
    const operations: string[] = [];
    const transaction = adapter.$transaction;
    adapter.$transaction = (callback: (tx: any) => Promise<unknown>) => transaction(async (tx: any) => {
      tx.$queryRaw = async (parts: TemplateStringsArray, ...values: unknown[]) => {
        operations.push("lock-account");
        assert.match(parts.join("?"), /SELECT "id" FROM "UserAccount" WHERE "id" = \? FOR KEY SHARE/);
        assert.deepEqual(values, ["account-1"], "account ID must be passed as a bound value");
        return [{ id: "account-1" }];
      };
      const updateMany = tx.participant.updateMany;
      tx.participant.updateMany = async (args: unknown) => {
        operations.push("lock-participant");
        return updateMany(args);
      };
      return callback(tx);
    });

    await new PrismaRoomStore(adapter).claimParticipant("ABC123", "token", {
      id: "account-1", username: "linked", emailVerifiedAt: new Date(),
    });
    assert.deepEqual(operations.slice(0, 2), ["lock-account", "lock-participant"],
      `account row must be locked before the participant for alreadyLinked=${alreadyLinked}`);
  }
});

test("expired rooms reject WebSocket ticket consumption before consuming the ticket", async () => {
  const { adapter, room, socketTickets } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const issued = await store.createSocketTicket(room.code, "token");
  const ticket = [...socketTickets.values()][0]!;
  room.lastActivityAt = new Date(0);

  await assert.rejects(() => store.consumeSocketTicket(room.code, issued.ticket), /room has expired/);

  assert.equal(room.status, "EXPIRED");
  assert.equal(ticket.consumedAt, null);
});

test("Prisma read projections reject or suppress a room expired while the view was loading", async () => {
  const regular = persistentAdapter();
  const regularStore = new PrismaRoomStore(regular.adapter);
  const regularView = (regularStore as any).view.bind(regularStore);
  (regularStore as any).view = async (...args: any[]) => {
    const projection = await regularView(...args);
    regular.room.status = "EXPIRED";
    return projection;
  };
  await assert.rejects(() => regularStore.getRoom(regular.room.code, "token"), /room has expired/);

  const socket = persistentAdapter();
  const socketStore = new PrismaRoomStore(socket.adapter);
  const issued = await socketStore.createSocketTicket(socket.room.code, "token");
  const principal = await socketStore.consumeSocketTicket(socket.room.code, issued.ticket);
  await socketStore.connectParticipant(socket.room.code, principal.participantId, principal.connectionId, principal.sessionHash);
  const socketView = (socketStore as any).view.bind(socketStore);
  (socketStore as any).view = async (...args: any[]) => {
    const projection = await socketView(...args);
    socket.room.status = "EXPIRED";
    return projection;
  };
  assert.equal(await socketStore.getRoomForConnection(socket.room.code, principal.participantId, principal.connectionId, principal.sessionHash), undefined);
});

test("Prisma stale disconnect retries reject expiry during the projection", async () => {
  const { adapter, room, participant } = persistentAdapter();
  participant.connectionId = "current-lease";
  const store = new PrismaRoomStore(adapter);
  const originalView = (store as any).view.bind(store);
  (store as any).view = async (...args: any[]) => {
    const projection = await originalView(...args);
    room.status = "EXPIRED";
    return projection;
  };

  await assert.rejects(() => store.disconnect(room.code, "token", "stale-lease"), /room has expired/);
  assert.equal(room.status, "EXPIRED");
  assert.equal(participant.connectionId, "current-lease", "a stale disconnect remains non-mutating");
});

test("room activity writes advance beyond the snapshot so same-millisecond stale writes fail", async () => {
  const { adapter, room, participant } = persistentAdapter();
  room.status = "WAITING";
  participant.ready = false;
  room.lastActivityAt = new Date(Date.now() + 60_000);

  const originalUpdateMany = adapter.gameRoom.updateMany;
  let snapshotWrite: any;
  adapter.gameRoom.updateMany = async (args: any) => {
    if (args.where?.lastActivityAt && !(args.where.lastActivityAt instanceof Date) && args.data?.lastActivityAt instanceof Date) snapshotWrite = args;
    return originalUpdateMany(args);
  };

  await new PrismaRoomStore(adapter).setReady(room.code, "token", true);

  assert.ok(snapshotWrite, "readiness update should issue the guarded activity write");
  const expectedActivityAt = snapshotWrite.where.lastActivityAt.equals as Date;
  const writtenActivityAt = snapshotWrite.data.lastActivityAt as Date;
  assert.ok(writtenActivityAt.getTime() > expectedActivityAt.getTime(), "the new timestamp must invalidate every request holding the old snapshot");

  const staleReplay = await originalUpdateMany({ where: snapshotWrite.where, data: { lastActivityAt: new Date(writtenActivityAt.getTime() + 1) } });
  assert.equal(staleReplay.count, 0, "an identical stale snapshot must not match after the first write");
});

test("room snapshot adapter applies Prisma DateTime equals and strict gt filters", async () => {
  const { adapter, room } = persistentAdapter();
  room.lastActivityAt = new Date(10_000);

  const accepted = await adapter.gameRoom.updateMany({
    where: { lastActivityAt: { equals: new Date(10_000), gt: new Date(9_999) } },
    data: { lastActivityAt: new Date(10_001) },
  });
  const rejectedAtBoundary = await adapter.gameRoom.updateMany({
    where: { lastActivityAt: { equals: new Date(10_001), gt: new Date(10_001) } },
    data: { lastActivityAt: new Date(10_002) },
  });

  assert.equal(accepted.count, 1);
  assert.equal(rejectedAtBoundary.count, 0, "Prisma gt is strict, so a value equal to the boundary must not match");
});

test("Prisma account resume rejects expired rooms before rotating the room token", async () => {
  for (const expiry of ["status", "idle"] as const) {
    const { adapter, room, participant } = persistentAdapter();
    const store = new PrismaRoomStore(adapter);
    participant.userId = "account-1";
    const oldTokenHash = participant.tokenHash;
    const oldSessionExpiry = participant.sessionExpiresAt;
    if (expiry === "status") {
      room.status = "EXPIRED";
      room.lastActivityAt = new Date();
    } else {
      room.status = "ABANDONED";
      room.lastActivityAt = new Date(0);
    }

    await assert.rejects(() => store.resumeParticipant(room.id, { id: "account-1", username: "player-one" }), /room has expired/);
    assert.equal(participant.tokenHash, oldTokenHash);
    assert.equal(participant.sessionExpiresAt, oldSessionExpiry);
    assert.equal(participant.connectedAt !== null, true);
  }
});

test("Prisma marks an active room abandoned after the final player disconnects and permits recovery", async () => {
  const { adapter, room, participant, participants } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const other = { ...participant, id: "player-2", playerIndex: 1, tokenHash: "other-token-hash", connectedAt: new Date(), disconnectedAt: null, ready: true };
  participants.push(other);
  participant.ready = true;
  room.status = "ACTIVE";

  const oneGone = await store.disconnect(room.code, "token");
  assert.equal(oneGone.status, "active");
  (other as any).connectedAt = null;
  const abandoned = await store.disconnect(room.code, "token");
  assert.equal(abandoned.status, "abandoned");

  const partialRecovery = await store.reconnect(room.code, "token");
  assert.equal(partialRecovery.status, "abandoned");
  other.connectedAt = new Date();
  const recovered = await store.reconnect(room.code, "token", "legacy");
  assert.equal(recovered.status, "active");
});

test("account deletion refreshes room lifecycle before its status projection is broadcast", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  room.status = "ACTIVE";
  const version = room.version;
  participant.connectedAt = null;
  participant.connectionId = null;
  participant.botControlled = true;
  participant.botAssisted = true;

  await store.refreshRoomLifecycle(room.code);

  assert.equal(room.status, "ABANDONED");
  assert.equal(room.version, version, "presence-derived status refresh must not create a gameplay revision");
});

test("Prisma reconnect leases ignore stale tab disconnects", async () => {
  const { adapter, room } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const first = await firstStore.reconnect(room.code, "token", "tab-a");
  assert.equal(first.participants[0]?.connected, true);
  await assert.rejects(() => secondStore.reconnect(room.code, "token", "tab-b"), /connection was replaced/);
  const replacementTicket = await secondStore.createSocketTicket(room.code, "token", "tab-a");
  const replacementPrincipal = await secondStore.consumeSocketTicket(room.code, replacementTicket.ticket);
  await secondStore.connectParticipant(room.code, "player-1", replacementPrincipal.connectionId, replacementPrincipal.sessionHash);
  const staleClose = await firstStore.disconnect(room.code, "token", "tab-a");
  assert.equal(staleClose.participants[0]?.connected, true);
  const currentClose = await secondStore.disconnect(room.code, "token", replacementPrincipal.connectionId);
  assert.equal(currentClose.participants[0]?.connected, false);
});

test("Prisma Leave cancels a pending reconnect lease whether it commits before or after Leave", async () => {
  const pendingLease = "pending-lease";
  const oldLease = "old-lease";

  const disconnectFirstFixture = persistentAdapter();
  const disconnectFirstStore = new PrismaRoomStore(disconnectFirstFixture.adapter);
  await disconnectFirstStore.reconnect(disconnectFirstFixture.room.code, "token", "legacy", oldLease);
  const disconnectFirst = await disconnectFirstStore.disconnect(disconnectFirstFixture.room.code, "token", oldLease, pendingLease);
  assert.equal(disconnectFirst.participants[0]?.connected, false);
  await assert.rejects(() => disconnectFirstStore.reconnect(disconnectFirstFixture.room.code, "token", oldLease, pendingLease), /connection was replaced/);
  await assert.rejects(() => disconnectFirstStore.reconnect(disconnectFirstFixture.room.code, "token", "legacy", "fresh-lease"), /connection was replaced/);

  const reconnectFirstFixture = persistentAdapter();
  const reconnectFirstStore = new PrismaRoomStore(reconnectFirstFixture.adapter);
  await reconnectFirstStore.reconnect(reconnectFirstFixture.room.code, "token", "legacy", oldLease);
  await reconnectFirstStore.reconnect(reconnectFirstFixture.room.code, "token", oldLease, pendingLease);
  const reconnectFirst = await reconnectFirstStore.disconnect(reconnectFirstFixture.room.code, "token", oldLease, pendingLease);
  assert.equal(reconnectFirst.participants[0]?.connected, false);
  await assert.rejects(() => reconnectFirstStore.reconnect(reconnectFirstFixture.room.code, "token", oldLease, pendingLease), /connection was replaced/);
  await assert.rejects(() => reconnectFirstStore.reconnect(reconnectFirstFixture.room.code, "token", "legacy", "fresh-lease"), /connection was replaced/);
});

test("account resume clears a cancelled Leave lease and can establish a fresh socket", async () => {
  const { adapter, room, participant } = persistentAdapter();
  participant.userId = "user-1";
  const store = new PrismaRoomStore(adapter);
  const oldLease = "old-lease";
  await store.reconnect(room.code, "token", "legacy", oldLease);
  const left = await store.disconnect(room.code, "token", oldLease, "pending-lease");
  assert.equal(left.participants[0]?.connected, false);

  const resumed = await store.resumeParticipant(room.id, { id: "user-1", username: "Returning Player" });
  assert.notEqual(resumed.token, "token");
  const ticket = await store.createSocketTicket(room.code, resumed.token, null, "fresh-account-lease");
  assert.equal(ticket.connectionId, "fresh-account-lease");
});

test("Prisma lifecycle refresh retries a stale presence snapshot after reconnect completes", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  room.status = "ACTIVE";
  participant.connectionId = "lease-old";
  participant.connectedAt = null;
  participant.disconnectedAt = new Date(Date.now() - 10_000);
  participant.ready = true;

  let signalRoomRead!: () => void;
  const roomReadGate = new Promise<void>((resolve) => { signalRoomRead = resolve; });
  let blockFirstStatusRead = true;
  let resumeFirstStatusRead!: () => void;
  const firstStatusReadPaused = new Promise<void>((resolve) => { resumeFirstStatusRead = resolve; });
  const originalFindUnique = adapter.gameRoom.findUnique;
  adapter.gameRoom.findUnique = async (args: any) => {
    if (blockFirstStatusRead && args.select?.status) {
      blockFirstStatusRead = false;
      signalRoomRead();
      await firstStatusReadPaused;
    }
    return originalFindUnique(args);
  };

  const staleDisconnectedRow = { ...participant, connectedAt: null, connectionId: "lease-old" };
  const originalFindMany = adapter.participant.findMany;
  let injectStaleSnapshot = false;
  adapter.participant.findMany = async (args: any) => {
    const rows = await originalFindMany(args);
    if (injectStaleSnapshot && args.where?.role === "PLAYER") {
      injectStaleSnapshot = false;
      return [staleDisconnectedRow];
    }
    return rows;
  };

  const staleLockResults: number[] = [];
  let observeLifecycleLocks = false;
  const originalUpdateMany = adapter.participant.updateMany;
  adapter.participant.updateMany = async (args: any) => {
    const result = await originalUpdateMany(args);
    if (observeLifecycleLocks && args.where?.id === participant.id && args.where?.role === "PLAYER" && Object.hasOwn(args.where, "connectedAt")) staleLockResults.push(result.count);
    return result;
  };

  const staleRefresh = (store as any).refreshStatus(room.id, room.maxPlayers, room.state);
  await roomReadGate;
  await store.reconnect(room.code, "token", "lease-old", "lease-new");
  assert.ok(participant.connectedAt);
  injectStaleSnapshot = true;
  observeLifecycleLocks = true;
  resumeFirstStatusRead();
  await staleRefresh;

  assert.deepEqual(staleLockResults, [0, 1]);
  assert.equal(room.status, "ACTIVE");
  assert.equal(participant.connectionId, "lease-new");
});

test("Prisma WebSocket projections revalidate the session lease after loading private state", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const sessionHash = createHash("sha256").update("token").digest("hex");
  const ticket = await store.createSocketTicket(room.code, "token");
  const principal = await store.consumeSocketTicket(room.code, ticket.ticket);
  await store.connectParticipant(room.code, "player-1", principal.connectionId, sessionHash);
  assert.equal(principal.connectionId, ticket.connectionId);
  assert.ok(await store.getRoomForConnection(room.code, "player-1", principal.connectionId, sessionHash));

  const originalView = (store as any).view.bind(store);
  (store as any).view = async (...args: any[]) => {
    const view = await originalView(...args);
    (participant as any).connectionId = "lease-b";
    return view;
  };
  assert.equal(await store.getRoomForConnection(room.code, "player-1", principal.connectionId, sessionHash), undefined);
  (store as any).view = originalView;

  (participant as any).connectionId = "lease-b";
  participant.tokenHash = createHash("sha256").update("replacement-token").digest("hex");
  (participant as any).connectedAt = null;
  assert.equal(await store.getRoomForConnection(room.code, "player-1", "lease-b", sessionHash), undefined);
});

test("Prisma socket tickets bind the issued lease and reject a delayed older handshake", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const older = await store.createSocketTicket(room.code, "token");
  const olderPrincipal = await store.consumeSocketTicket(room.code, older.ticket);
  const current = await store.createSocketTicket(room.code, "token", older.connectionId);
  assert.equal((participant as any).connectionId, current.connectionId);
  assert.equal((participant as any).connectedAt, null);
  await assert.rejects(() => store.createSocketTicket(room.code, "token", older.connectionId), /connection was replaced/);
  await assert.rejects(() => store.connectParticipant(room.code, "player-1", olderPrincipal.connectionId, olderPrincipal.sessionHash), /replaced/);
  const principal = await store.consumeSocketTicket(room.code, current.ticket);
  assert.equal(principal.connectionId, current.connectionId);
  assert.equal(principal.participantId, "player-1");
  await store.connectParticipant(room.code, principal.participantId, principal.connectionId, principal.sessionHash);
  assert.ok(await store.getRoomForConnection(room.code, principal.participantId, principal.connectionId, principal.sessionHash));
  await store.disconnectParticipant(room.code, principal.participantId, olderPrincipal.connectionId);
  assert.ok(await store.getRoomForConnection(room.code, principal.participantId, principal.connectionId, principal.sessionHash));
});

test("Prisma ticket and reconnect retries reuse their requested lease without letting an older tab reclaim it", async () => {
  const { adapter, room, participant } = persistentAdapter();
  const store = new PrismaRoomStore(adapter);
  const ticketLease = "11111111-1111-4111-8111-111111111111";
  const reconnectLease = "33333333-3333-4333-8333-333333333333";
  const staleLease = "22222222-2222-4222-8222-222222222222";
  const first = await store.createSocketTicket(room.code, "token", null, ticketLease);
  const recovered = await store.createSocketTicket(room.code, "token", null, ticketLease);
  assert.equal(recovered.connectionId, first.connectionId);
  const principal = await store.consumeSocketTicket(room.code, recovered.ticket);
  await store.connectParticipant(room.code, participant.id, principal.connectionId, principal.sessionHash);
  await assert.rejects(() => store.createSocketTicket(room.code, "token", null, staleLease), /connection was replaced/);
  await assert.rejects(() => store.connectParticipant(room.code, participant.id, principal.connectionId, principal.sessionHash), /replaced/);

  const reconnected = await store.reconnect(room.code, "token", principal.connectionId, reconnectLease);
  const retry = await store.reconnect(room.code, "token", principal.connectionId, reconnectLease);
  assert.equal(retry.participants.find((candidate) => candidate.id === participant.id)?.connected, true);
  assert.equal(reconnected.participants.find((candidate) => candidate.id === participant.id)?.connected, true);
  await assert.rejects(() => store.reconnect(room.code, "token", principal.connectionId, staleLease), /connection was replaced/);
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
  const { adapter, room } = persistentAdapter();
  room.state = createRoomGame(2);
  const store = new PrismaRoomStore(adapter);
  const first = await store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, 0);
  assert.equal(first.version, 1);
  assert.equal((first.state.setupState as any).seats[0].monsterId, "monster-1");
  await assert.rejects(() => store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-2" }, 0), /Expected revision/);
});

test("Prisma materializes setup in the final setup revision before room activation", async () => {
  const { adapter, room, participants, events } = persistentAdapter();
  const second = addSecondPlayer(participants);
  room.status = "WAITING";
  room.state = createRoomGame(2);
  const store = new PrismaRoomStore(adapter);
  const setupRevision = await completePrismaSetup(store, room);

  assert.equal(room.state.setupApplied, true);
  assert.equal(room.version, setupRevision);
  assert.equal(events.at(-1)?.type, "setup.updated");
  assert.equal(events.at(-1)?.version, setupRevision);

  let signalActivation!: () => void;
  let releaseActivation!: () => void;
  const activationStarted = new Promise<void>((resolve) => { signalActivation = resolve; });
  const activationGate = new Promise<void>((resolve) => { releaseActivation = resolve; });
  const originalUpdateMany = adapter.gameRoom.updateMany;
  adapter.gameRoom.updateMany = async (args: any) => {
    if (args.where?.status === "WAITING" && args.data?.status === "ACTIVE") {
      signalActivation();
      await activationGate;
    }
    return originalUpdateMany(args);
  };

  await store.setReady(room.code, "token", true);
  const activation = store.setReady(room.code, "token-2", true);
  await activationStarted;
  await assert.rejects(() => store.submitAction(room.code, "token", {
    actionId: "before-activation",
    actorId: "player-1",
    expectedRevision: setupRevision,
    protocolVersion: 1,
    command: { type: "move", path: ["los-angeles", "san-francisco"] },
  }), /not ready for gameplay/);
  assert.equal(room.status, "WAITING");
  releaseActivation();
  const active = await activation;
  assert.equal(active.status, "active");
  assert.equal(room.state.setupApplied, true);
  assert.equal(room.version, setupRevision, "activation does not write a stale setup snapshot or reuse a gameplay revision");

  const path = legalMonsterPaths(room.state, room.state.monsters[0]!.id).find((candidate) => candidate.length > 1)!;
  const moved = await store.submitAction(room.code, "token", {
    actionId: "after-activation",
    actorId: "player-1",
    expectedRevision: setupRevision,
    protocolVersion: 1,
    command: { type: "move", path },
  });
  assert.equal(moved.version, setupRevision + 1);
  assert.equal(events.at(-1)?.version, setupRevision + 1);
});

test("Prisma atomically materializes legacy waiting setup as it activates", async () => {
  const { adapter, room, participants, events } = persistentAdapter();
  const second = addSecondPlayer(participants);
  room.status = "WAITING";
  room.state = unmaterializedCompletedSetup(createRoomGame(2));
  room.version = 8;
  participants[0]!.ready = true;
  second.ready = true;
  events.push({ id: "legacy-final-setup", roomId: room.id, version: room.version, actorId: second.id, type: "setup.updated", controlSource: "human", payload: { phase: "complete" }, createdAt: new Date() });

  let signalActivation!: () => void;
  let releaseActivation!: () => void;
  const activationStarted = new Promise<void>((resolve) => { signalActivation = resolve; });
  const activationGate = new Promise<void>((resolve) => { releaseActivation = resolve; });
  const originalUpdateMany = adapter.gameRoom.updateMany;
  adapter.gameRoom.updateMany = async (args: any) => {
    if (args.where?.status === "WAITING" && args.data?.status === "ACTIVE") {
      signalActivation();
      await activationGate;
    }
    return originalUpdateMany(args);
  };

  const store = new PrismaRoomStore(adapter);
  const activation = store.setReady(room.code, "token", true);
  await activationStarted;
  assert.equal(room.status, "WAITING");
  assert.equal(room.state.setupApplied, undefined);
  await assert.rejects(() => store.submitAction(room.code, "token", {
    actionId: "legacy-before-activation",
    actorId: "player-1",
    expectedRevision: room.version,
    protocolVersion: 1,
    command: { type: "move", path: ["los-angeles", "san-francisco"] },
  }), /not ready for gameplay/);
  releaseActivation();

  const active = await activation;
  assert.equal(active.status, "active");
  assert.equal(room.state.setupApplied, true);
  assert.equal(room.version, 9);
  assert.equal(events.at(-1)?.version, 9);
  assert.match(String(events.at(-1)?.payload?.action), /legacy-activation-materialization/);
});

test("Prisma repairs an unambiguous active legacy setup before WebSocket projection and commands", async () => {
  const { adapter, room, participant, events } = persistentAdapter();
  room.status = "ACTIVE";
  room.state = unmaterializedCompletedSetup(createRoomGame(2));
  room.version = 8;
  participant.connectionId = "lease-a";
  events.push({ id: "legacy-final-setup", roomId: room.id, version: 8, actorId: participant.id, type: "setup.updated", controlSource: "human", payload: { phase: "complete" }, createdAt: new Date() });

  const store = new PrismaRoomStore(adapter);
  const projection = await store.getRoomForConnection(room.code, participant.id, "lease-a", participant.tokenHash);
  assert.ok(projection);
  assert.equal(projection.version, 9);
  assert.equal(projection.state.setupApplied, true);
  assert.equal(events.at(-1)?.version, 9);

  const path = legalMonsterPaths(room.state, room.state.monsters[0]!.id).find((candidate) => candidate.length > 1)!;
  const moved = await store.submitActionForParticipant(room.code, participant.id, "lease-a", participant.tokenHash, {
    actionId: "socket-action-after-legacy-recovery",
    actorId: participant.id,
    expectedRevision: projection.version,
    protocolVersion: 1,
    command: { type: "move", path },
  });
  assert.equal(moved.version, 10);
  assert.equal(events.at(-1)?.version, 10);
});

test("Prisma leaves ambiguous active legacy setup untouched when later gameplay events exist", async () => {
  const { adapter, room, participant, events } = persistentAdapter();
  room.status = "ACTIVE";
  room.state = unmaterializedCompletedSetup(createRoomGame(2));
  room.version = 9;
  events.push({ id: "legacy-final-setup", roomId: room.id, version: 8, actorId: participant.id, type: "setup.updated", controlSource: "human", payload: { phase: "complete" }, createdAt: new Date() });
  events.push({ id: "accepted-gameplay", roomId: room.id, version: 9, actorId: participant.id, type: "monster.moved", controlSource: "human", payload: {}, createdAt: new Date() });

  await assert.rejects(() => new PrismaRoomStore(adapter).getRoom(room.code, "token"), /gameplay events followed setup/);
  assert.equal(room.state.setupApplied, undefined);
  assert.equal(room.version, 9);
  assert.equal(events.at(-1)?.id, "accepted-gameplay");
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
