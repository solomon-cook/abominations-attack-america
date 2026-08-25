import assert from "node:assert/strict";
import test from "node:test";
import { legalMonsterPaths } from "@abominations/game-engine";
import { MemoryRoomStore } from "./store.js";

async function completeDevelopmentSetup(store: MemoryRoomStore, sessions: Array<{ token: string; room: { code: string; version: number } }>) {
  const code = sessions[0].room.code;
  const playerCount = sessions.length as 2 | 3 | 4;
  let revision = sessions[0].room.version;
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) revision = (await store.setupAction(code, sessions[playerIndex].token, { type: "choose-monster", monsterId: `monster-${playerIndex + 1}` }, revision)).version;
  const branches = ["Army", "Navy", "Air Force", "Marines"] as const;
  for (let playerIndex = playerCount - 1; playerIndex >= 0; playerIndex -= 1) revision = (await store.setupAction(code, sessions[playerIndex].token, { type: "choose-branch", branch: branches[playerIndex] }, revision)).version;
  const lairs = ["los-angeles", "chicago", "san-francisco", "denver"];
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) revision = (await store.setupAction(code, sessions[playerIndex].token, { type: "choose-lair", lair: lairs[playerIndex] }, revision)).version;
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) revision = (await store.setupAction(code, sessions[playerIndex].token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }, revision)).version;
}

test("players can create, join, and read a room", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  assert.equal(guest.room.status, "waiting");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  assert.equal(active.status, "active");
  assert.equal(active.state.setupState?.phase, "complete");
  assert.equal(active.state.matchId, `room-${host.room.code}`);
  assert.deepEqual(active.state.players.map((player) => player.id), ["player-1", "player-2"]);
  assert.deepEqual(active.state.setupAssignments?.map((seat) => seat.monsterId), ["monster-1", "monster-2"]);
  await assert.rejects(() => store.setupAction(host.room.code, host.token, { type: "choose-monster", monsterId: "monster-1" }, active.version - 1), /Expected revision/);
  const state = await store.getRoom(host.room.code, host.token);
  assert.equal(state.participants.length, 2);
});

test("memory store health reports its persistence boundary", async () => {
  assert.deepEqual(await new MemoryRoomStore(true).health(), { persistence: "memory" });
});

test("production room creation rejects the sparse development fixture", async () => {
  await assert.rejects(() => new MemoryRoomStore().createRoom(2), /MVP board is not ready/);
});

test("room state uses the requested supported player count and rejects invalid counts", async () => {
  const store = new MemoryRoomStore(true);
  const room = await store.createRoom(4);
  assert.equal(room.room.state.monsters.length, 4);
  assert.equal(room.room.state.stompMarkers, 20);
  await assert.rejects(() => store.createRoom(5), /exactly 2, 3, or 4/);
});

test("rooms activate only after all configured seats join and reject waiting-room actions", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(3);
  const second = await store.joinRoom(host.room.code, "Player 2");
  assert.equal(second.room.status, "waiting");
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { actionId: "early", actorId: host.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } }), /not ready/);
  const third = await store.joinRoom(host.room.code, "Player 3");
  assert.equal(third.room.status, "waiting");
  await completeDevelopmentSetup(store, [host, second, third]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, second.token, true);
  const active = await store.setReady(host.room.code, third.token, true);
  assert.equal(active.status, "active");
  await assert.rejects(() => store.setReady(host.room.code, host.token, false), /only change while a room is waiting/);
});

test("a setup snapshot restores after a refresh with its revision", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  const afterMonster = await store.setupAction(host.room.code, host.token, { type: "choose-monster", monsterId: "monster-1" }, host.room.version);
  const restored = await store.getRoom(host.room.code, host.token);
  assert.equal(restored.version, afterMonster.version);
  assert.equal(restored.state.setupState?.seats[0]?.monsterId, "monster-1");
  assert.equal(restored.state.setupState?.phase, "monster-selection");
  await assert.rejects(() => store.setupAction(host.room.code, guest.token, { type: "choose-monster", monsterId: "monster-2" }, host.room.version), /Expected revision/);
});

test("disconnect and reconnect preserve setup state and recover an abandoned room", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  const disconnectedSetup = await store.disconnect(host.room.code, host.token);
  assert.equal(disconnectedSetup.participants.find((participant) => participant.id === host.participantId)?.connected, false);
  await assert.rejects(() => store.setReady(host.room.code, host.token, true), /Reconnect/);
  const reconnectedSetup = await store.reconnect(host.room.code, host.token);
  assert.equal(reconnectedSetup.participants.find((participant) => participant.id === host.participantId)?.connected, true);
  await store.reconnect(host.room.code, host.token, "tab-a");
  const staleClose = await store.disconnect(host.room.code, host.token, "tab-b");
  assert.equal(staleClose.participants.find((participant) => participant.id === host.participantId)?.connected, true);
  await store.disconnect(host.room.code, host.token, "tab-a");
  await store.reconnect(host.room.code, host.token, "tab-a");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  assert.equal((await store.disconnect(host.room.code, host.token, "tab-a")).status, "active");
  assert.equal((await store.disconnect(host.room.code, guest.token)).status, "abandoned");
  assert.equal((await store.reconnect(host.room.code, guest.token)).status, "abandoned");
  assert.equal((await store.reconnect(host.room.code, host.token)).status, "active");
});

test("idle development rooms expire without changing a completed result", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const rooms = (store as unknown as { rooms: Map<string, { lastActivityAt: number }> }).rooms;
  [...rooms.values()][0]!.lastActivityAt = 0;
  const expired = await store.getRoom(host.room.code, host.token);
  assert.equal(expired.status, "expired");
  await assert.rejects(() => store.setupAction(host.room.code, host.token, { type: "choose-monster", monsterId: "monster-1" }, expired.version), /expired/);
});

test("spectators can read but cannot act", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const spectator = await store.spectateRoom(host.room.code, "Watch-only");
  await assert.rejects(() => store.submitAction(host.room.code, spectator.token, { actionId: "a1", actorId: spectator.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } }), /Spectators/);
});

test("completed terminal results survive player refresh and spectator projection", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  const players = [host, guest];
  await completeDevelopmentSetup(store, players);
  await store.setReady(host.room.code, host.token, true);
  let view = await store.setReady(host.room.code, guest.token, true);
  const storedRooms = (store as unknown as { rooms: Map<string, { state: { stompMarkers: number } }> }).rooms;
  const storedRoom = [...storedRooms.values()][0]!;
  storedRoom.state.stompMarkers = 1;
  view = await store.getRoom(host.room.code, host.token);
  let actionNumber = 0;
  while (view.state.phase !== "game-over") {
    const player = players[view.state.currentPlayer];
    const command = view.state.phase === "move"
      ? (() => {
          const monster = view.state.monsters[view.state.currentPlayer];
          const path = legalMonsterPaths(view.state, monster.id).find((candidate) => !view.state.stompedLocations.includes(candidate.at(-1)!));
          return path ? { type: "move" as const, path } : { type: "pass-move" as const };
        })()
      : view.state.pendingDecision?.type === "retreat" && view.state.pendingRetreat
        ? { type: "retreat" as const, destinations: Object.fromEntries(view.state.pendingRetreat.unitIds.map((unitId) => [unitId, view.state.pendingRetreat!.options[unitId]?.[0] ?? "disappeared"])) }
        : view.state.pendingDecision?.type === "encounter-choice"
          ? { type: "resolve-encounter" as const, choice: "health" as const }
        : view.state.phase === "deploy" ? { type: "pass-deploy" as const } : { type: "advance" as const };
    view = await store.submitAction(host.room.code, player.token, { actionId: `terminal-${actionNumber++}`, actorId: player.participantId, expectedRevision: view.version, protocolVersion: 1, command });
  }
  const refreshedPlayer = await store.getRoom(host.room.code, host.token);
  const spectator = await store.spectateRoom(host.room.code, "Watch-only");
  const spectatorView = await store.getRoom(host.room.code, spectator.token);
  assert.equal(refreshedPlayer.status, "completed");
  assert.equal(refreshedPlayer.state.winnerPlayer, view.state.winnerPlayer);
  assert.equal(refreshedPlayer.state.victoryType, "development-stomp-exhaustion");
  assert.equal(spectatorView.state.winnerPlayer, refreshedPlayer.state.winnerPlayer);
  assert.equal(spectatorView.state.victoryType, refreshedPlayer.state.victoryType);
  assert.deepEqual(spectatorView.state.decks.mutation.order, []);
  assert.deepEqual(spectatorView.state.decks.research.order, []);
});

test("voluntary concession persists a terminal result through refresh and projection", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const completed = await store.submitAction(host.room.code, host.token, {
    actionId: "concede-1",
    actorId: host.participantId,
    expectedRevision: active.version,
    protocolVersion: 1,
    command: { type: "concede" },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.state.phase, "game-over");
  assert.equal(completed.state.winnerPlayer, 1);
  assert.equal(completed.state.victoryType, "concession");
  assert.equal(completed.events[0]?.type, "match.conceded");
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.victoryType, "concession");
  assert.equal(refreshed.state.winnerPlayer, 1);
  await assert.rejects(() => store.submitAction(host.room.code, host.token, {
    actionId: "concede-2",
    actorId: host.participantId,
    expectedRevision: completed.version,
    protocolVersion: 1,
    command: { type: "concede" },
  }), /completed/);
});

test("commands reject forged actors and out-of-turn players", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { actionId: "forged", actorId: guest.participantId, expectedRevision: active.version, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } }), /actor does not match/);
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { actionId: "turn", actorId: guest.participantId, expectedRevision: active.version, protocolVersion: 1, command: { type: "move", path: ["seattle", "denver"] } }), /not your turn/);
});

test("room projections redact authoritative deck order for players and spectators", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  const spectator = await store.spectateRoom(host.room.code, "Watch-only");
  const storedRooms = (store as unknown as { rooms: Map<string, { state: any; events: any[] }> }).rooms;
  const storedRoom = [...storedRooms.values()][0]!;
  storedRoom.state.players[0].researchCardIds = ["Guard Commander"];
  storedRoom.state.players[1].mutationCardIds = ["Rampage"];
  storedRoom.state.eventLog = [{ id: "private", action: "research.drawn", outcome: "drawn", detail: { cardId: "Guard Commander" } }];
  storedRoom.events.push({ id: "private-event", roomId: storedRoom.state.matchId, version: 1, actorId: host.participantId, type: "research.drawn", payload: { cardId: "Guard Commander" }, createdAt: new Date().toISOString() });
  const playerView = await store.getRoom(host.room.code, host.token);
  const guestView = await store.getRoom(host.room.code, guest.token);
  const spectatorView = await store.getRoom(host.room.code, spectator.token);
  assert.deepEqual(playerView.state.decks.mutation.order, []);
  assert.deepEqual(spectatorView.state.decks.research.order, []);
  assert.deepEqual(playerView.state.players[0].researchCardIds, ["Guard Commander"]);
  assert.deepEqual(playerView.state.players[1].mutationCardIds, []);
  assert.deepEqual(guestView.state.players[0].researchCardIds, []);
  assert.deepEqual(guestView.state.players[1].mutationCardIds, ["Rampage"]);
  assert.deepEqual(spectatorView.state.players.map((player) => player.researchCardIds), [[], []]);
  assert.equal(JSON.stringify(playerView.state.eventLog).includes("Guard Commander"), false);
  assert.equal(JSON.stringify(playerView.events).includes("Guard Commander"), false);
});

test("repeated action ids are idempotent", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const envelope = { actionId: "a1", actorId: host.participantId, expectedRevision: active.version, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };
  const first = await store.submitAction(host.room.code, host.token, envelope);
  const second = await store.submitAction(host.room.code, host.token, envelope);
  assert.equal(first.version, second.version);
  assert.equal(guest.room.participants.length, 2);
});

test("room reads provide revisioned event deltas after a known snapshot", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  await store.submitAction(host.room.code, host.token, { actionId: "delta-1", actorId: host.participantId, expectedRevision: active.version, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } });
  const delta = await store.getRoom(host.room.code, host.token, active.version);
  assert.equal(delta.version, active.version + 1);
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0]?.type, "monster.moved");
});

test("refresh restores the exact pending attack-target decision", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const storedRooms = (store as unknown as { rooms: Map<string, { state: any }> }).rooms;
  const storedRoom = [...storedRooms.values()][0]!;
  storedRoom.state.units.filter((unit: any) => unit.location === "denver").forEach((unit: any) => { unit.defense = 99; });
  const moved = await store.submitAction(host.room.code, host.token, {
    actionId: "pending-move",
    actorId: host.participantId,
    expectedRevision: active.version,
    protocolVersion: 1,
    command: { type: "move", path: ["los-angeles", "denver"] },
  });
  const requested = await store.submitAction(host.room.code, host.token, {
    actionId: "pending-target",
    actorId: host.participantId,
    expectedRevision: moved.version,
    protocolVersion: 1,
    command: { type: "resolve-fight", battleId: moved.state.pendingBattles[0].id },
  });
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(requested.state.pendingDecision?.type, "attack-target");
  assert.deepEqual(refreshed.state.pendingDecision, requested.state.pendingDecision);
  assert.deepEqual(refreshed.state.pendingAttackTarget, requested.state.pendingAttackTarget);
  assert.equal(refreshed.version, requested.version);
  const firstTarget = requested.state.pendingAttackTarget!.targetIds[0];
  const afterAttack = await store.submitAction(host.room.code, host.token, {
    actionId: "pending-target-first-attack",
    actorId: host.participantId,
    expectedRevision: requested.version,
    protocolVersion: 1,
    command: { type: "resolve-fight", battleId: requested.state.pendingAttackTarget!.battleId, targetUnitId: firstTarget },
  });
  assert.equal(afterAttack.state.pendingDecision?.type, "attack-target");
  const resumed = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(resumed.state.pendingDecision, afterAttack.state.pendingDecision);
  assert.deepEqual(resumed.state.pendingCombat, afterAttack.state.pendingCombat);
});

test("stale command envelopes are rejected before applying a command", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  const envelope = { actionId: "stale", actorId: host.participantId, expectedRevision: 4, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };
  await assert.rejects(() => store.submitAction(host.room.code, host.token, envelope), /Expected revision 4/);
});

test("deterministic reconnect and retry sequence preserves the same snapshot", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const baseline = JSON.stringify(active.state);
  for (let cycle = 0; cycle < 24; cycle += 1) {
    const connectionId = `fuzz-tab-${cycle % 3}`;
    const reconnected = await store.reconnect(host.room.code, host.token, connectionId);
    assert.equal(JSON.stringify(reconnected.state), baseline);
    assert.equal(reconnected.version, active.version);
    await assert.rejects(() => store.submitAction(host.room.code, host.token, {
      actionId: `stale-retry-${cycle}`,
      actorId: host.participantId,
      expectedRevision: active.version - 1,
      protocolVersion: 1,
      command: { type: "pass-move" },
    }), /Expected revision/);
    await store.disconnect(host.room.code, host.token, connectionId);
  }
  await store.reconnect(host.room.code, host.token, "final-tab");
  const command = { actionId: "reconnect-idempotent", actorId: host.participantId, expectedRevision: active.version, protocolVersion: 1 as const, command: { type: "pass-move" as const } };
  const first = await store.submitAction(host.room.code, host.token, command);
  const retry = await store.submitAction(host.room.code, host.token, command);
  assert.equal(first.version, active.version + 1);
  assert.equal(retry.version, first.version);
  assert.equal(retry.state.phase, first.state.phase);
});

test("bounded concurrent room and spectator operations remain isolated", async () => {
  const store = new MemoryRoomStore(true);
  const sessions = await Promise.all(Array.from({ length: 24 }, (_, index) => store.createRoom(2).then(async (host) => {
    const guest = await store.joinRoom(host.room.code, `Guest ${index}`);
    const spectators = await Promise.all([
      store.spectateRoom(host.room.code, `Spectator ${index}-a`),
      store.spectateRoom(host.room.code, `Spectator ${index}-b`),
    ]);
    return { host, guest, spectators };
  })));
  assert.equal(new Set(sessions.map(({ host }) => host.room.code)).size, 24);
  const reads = await Promise.all(sessions.flatMap(({ host, guest, spectators }) => [
    store.getRoom(host.room.code, host.token),
    store.getRoom(host.room.code, guest.token),
    ...spectators.map((spectator) => store.getRoom(host.room.code, spectator.token)),
    store.reconnect(host.room.code, host.token, "load-test-tab"),
  ]));
  assert.equal(reads.length, 120);
  for (let index = 0; index < sessions.length; index += 1) {
    const expectedCode = sessions[index]!.host.room.code;
    const roomReads = reads.slice(index * 5, index * 5 + 5);
    assert.ok(roomReads.every((view) => view.code === expectedCode));
    assert.ok(roomReads.every((view) => view.state.matchId === `room-${expectedCode}`));
  }
});
