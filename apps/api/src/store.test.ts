import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_PROTOCOL_VERSION, applyCommand, boardForState, legalChopperLiftDestinations, legalMonsterPaths, locationIdToHexKey, monsterCombatStats } from "@abominations/game-engine";
import { MAX_RETAINED_ROOM_EVENTS, MemoryRoomStore } from "./store.js";
import { AUDITED_BOARD } from "../../../packages/game-engine/src/audited-board.js";

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

test("authenticated room projections retain Fins and Gills' conditional Defense across refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.boardId = AUDITED_BOARD.id;
  game.boardVersion = AUDITED_BOARD.version;
  game.boardContentHash = AUDITED_BOARD.contentHash;
  const edge = AUDITED_BOARD.edges.find((candidate) => candidate.enabled && candidate.barrier === "sea"
    && AUDITED_BOARD.hexes[candidate.from]?.waterClass === "seacoast" && AUDITED_BOARD.hexes[candidate.to]?.waterClass === "land")!;
  game.players[0]!.mutationCardIds = ["Fins and Gills"];
  game.monsters[0]!.location = edge.to;

  const hostView = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(hostView.state.players[0]!.mutationCardIds, ["Fins and Gills"]);
  assert.equal(monsterCombatStats(hostView.state, hostView.state.monsters[0]!).defense, 5);
  const guestView = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(guestView.state.players[0]!.mutationCardIds, []);
  assert.deepEqual(guestView.state.players[0]!.visibleMutationCardIds, ["Fins and Gills"]);
  assert.equal(monsterCombatStats(guestView.state, guestView.state.monsters[0]!).defense, 5);
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(monsterCombatStats(refreshed.state, refreshed.state.monsters[0]!).defense, 5);
});

test("authenticated room projections retain Armored Scales' effective Move and Defense across refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.players[0]!.mutationCardIds = ["Armored Scales"];
  const ownerView = await store.getRoom(host.room.code, host.token);
  const ownerMonster = ownerView.state.monsters[0]!;
  assert.equal(monsterCombatStats(ownerView.state, ownerMonster).move, ownerMonster.move - 1);
  assert.equal(monsterCombatStats(ownerView.state, ownerMonster).defense, ownerMonster.defense + 1);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  const refreshedMonster = refreshed.state.monsters[0]!;
  assert.equal(monsterCombatStats(refreshed.state, refreshedMonster).move, refreshedMonster.move - 1);
  assert.equal(monsterCombatStats(refreshed.state, refreshedMonster).defense, refreshedMonster.defense + 1);
  assert.deepEqual(refreshed.state.players[0]!.visibleMutationCardIds, ["Armored Scales"]);
});

test("authenticated Atomic Recovery updates the monster and turn-start feedback on refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 1;
  game.phase = "deploy";
  game.players[0]!.mutationCardIds = ["Atomic Recovery"];
  game.monsters[0]!.health = 2;
  game.pendingDecision = { type: "deployment", playerIndex: 1 };
  const before = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(before.state.players[0]!.visibleMutationCardIds, ["Atomic Recovery"]);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-atomic-recovery-turn-start",
    actorId: guestParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "pass-deploy" },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { ...command, actorId: hostParticipant.id, actionId: "wrong-seat-atomic-recovery" }), /It is not your turn/);
  const started = await store.submitAction(host.room.code, guest.token, command);
  assert.equal(started.state.currentPlayer, 0);
  assert.equal(started.state.monsters[0]!.health, started.state.monsters[0]!.startingHealth);
  assert.equal(started.state.eventLog.at(-1)?.detail.atomicRecovery, true);
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.monsters[0]!.health, refreshed.state.monsters[0]!.startingHealth);
  assert.deepEqual(refreshed.state.players[0]!.mutationCardIds, ["Atomic Recovery"]);
  assert.equal(refreshed.version, started.version);
});

test("authenticated Iron Stomach choice names the base rewards and preserves the selected Health", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  const base = Object.values(boardForState(game).hexes).find((hex) => hex.features.some((feature) => feature.kind === "military-base"))!;
  game.currentPlayer = 0;
  game.phase = "encounter";
  game.players[0]!.mutationCardIds = ["Iron Stomach"];
  game.monsters[0]!.location = base.key;
  game.monsters[0]!.health = 5;
  game.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: base.key };
  const before = await store.getRoom(host.room.code, host.token);
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = before.participants.find((participant) => participant.playerIndex === 1)!;
  const opened = await store.submitAction(host.room.code, host.token, {
    actionId: "online-iron-stomach-open-choice",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-encounter" },
  });
  assert.equal(opened.state.pendingDecision?.type === "encounter-choice" ? opened.state.pendingDecision.source : undefined, "iron-stomach");
  assert.equal(opened.state.eventLog.at(-1)?.detail.choiceSource, "iron-stomach");
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.pendingDecision?.type === "encounter-choice" ? refreshed.state.pendingDecision.source : undefined, "iron-stomach");
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, {
    actionId: "wrong-seat-iron-stomach-choice",
    actorId: opponent.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-encounter", choice: "health" },
  }), /It is not your turn/);
  const chosen = await store.submitAction(host.room.code, host.token, {
    actionId: "online-iron-stomach-health-choice",
    actorId: owner.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-encounter", choice: "health" },
  });
  assert.equal(chosen.state.monsters[0]!.health, 8);
  assert.equal(chosen.state.monsters[0]!.infamy, 0);
  const afterRefresh = await store.getRoom(host.room.code, host.token);
  assert.equal(afterRefresh.state.monsters[0]!.health, 8);
  assert.deepEqual(afterRefresh.state.players[0]!.mutationCardIds, ["Iron Stomach"]);
});

test("authenticated War Spikes projection and combat damage stay synchronized", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.players[0]!.mutationCardIds = ["War Spikes"];
  game.monsters[0]!.attacks = 1;
  game.monsters[0]!.defense = 99;
  game.monsters[0]!.health = 40;
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[0]!.location;
  unit.defense = 1;
  const battleId = "online-war-spikes-damage";
  game.phase = "fight";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  let matchingSeed: number | undefined;
  for (let seed = 0; seed < 128 && matchingSeed === undefined; seed += 1) {
    const candidate = structuredClone(game);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    if ((result.eventPayload.attacks as Array<{ attackerId: string; damage: number; smash: boolean }>).some((attack) => attack.attackerId === game.monsters[0]!.id && attack.damage === 4 && !attack.smash)) matchingSeed = seed;
  }
  assert.notEqual(matchingSeed, undefined, "a deterministic battle seed should produce an ordinary War Spikes hit");
  game.rng.seed = matchingSeed!;
  const before = await store.getRoom(host.room.code, host.token);
  const guestBefore = await store.getRoom(host.room.code, guest.token);
  assert.equal(monsterCombatStats(before.state, before.state.monsters[0]!).damage, 4);
  assert.equal(monsterCombatStats(guestBefore.state, guestBefore.state.monsters[0]!).damage, 4);
  assert.deepEqual(guestBefore.state.players[0]!.visibleMutationCardIds, ["War Spikes"]);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-war-spikes-resolve",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-seat-war-spikes" }), /It is not your turn/);
  const resolved = await store.submitAction(host.room.code, host.token, command);
  const attack = (resolved.state.eventLog.at(-1)?.detail.attacks as Array<{ attackerId: string; damage: number; smash: boolean }>).find((entry) => entry.attackerId === game.monsters[0]!.id && entry.damage === 4 && !entry.smash);
  assert.ok(attack);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(monsterCombatStats(refreshed.state, refreshed.state.monsters[0]!).damage, 4);
  assert.deepEqual(refreshed.state.players[0]!.visibleMutationCardIds, ["War Spikes"]);
});

test("authenticated Atomic Breath battle controls expose the extra first-round attack", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.players[0]!.mutationCardIds = ["Atomic Breath"];
  game.monsters[0]!.attacks = 1;
  game.monsters[0]!.defense = 99;
  game.monsters[0]!.health = 40;
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[0]!.location;
  unit.defense = 99;
  const secondUnit = game.units.find((candidate) => candidate.id !== unit.id)!;
  secondUnit.location = game.monsters[0]!.location;
  secondUnit.defense = 99;
  const battleId = "online-atomic-breath-rounds";
  game.phase = "fight";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id, secondUnit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  let matchingSeed: number | undefined;
  for (let seed = 0; seed < 128 && matchingSeed === undefined; seed += 1) {
    const candidate = structuredClone(game);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    if (result.state.pendingDecision?.type === "attack-target" && result.state.pendingDecision.attackTotal === 2) matchingSeed = seed;
  }
  assert.notEqual(matchingSeed, undefined, "the first combat round should request its second monster attack");
  game.rng.seed = matchingSeed!;
  const before = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(before.state.players[0]!.mutationCardIds, ["Atomic Breath"]);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-atomic-breath-resolve",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-seat-atomic-breath" }), /It is not your turn/);
  const resolved = await store.submitAction(host.room.code, host.token, command);
  assert.equal(resolved.state.pendingDecision?.type, "attack-target");
  assert.equal(resolved.state.pendingDecision?.type === "attack-target" ? resolved.state.pendingDecision.attackTotal : undefined, 2);
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.pendingDecision?.type === "attack-target" ? refreshed.state.pendingDecision.attackTotal : undefined, 2);
  assert.deepEqual(refreshed.state.players[0]!.mutationCardIds, ["Atomic Breath"]);
  const extraAttack = await store.submitAction(host.room.code, host.token, {
    actionId: "online-atomic-breath-extra-attack",
    actorId: hostParticipant.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId, targetUnitId: unit.id },
  });
  assert.equal(extraAttack.state.pendingDecision?.type, "attack-target");
  assert.equal(extraAttack.state.pendingDecision?.type === "attack-target" ? extraAttack.state.pendingDecision.round : undefined, 1);
  assert.equal(extraAttack.state.pendingDecision?.type === "attack-target" ? extraAttack.state.pendingDecision.attackNumber : undefined, 2);
  const roundTwo = await store.submitAction(host.room.code, host.token, {
    actionId: "online-atomic-breath-round-two",
    actorId: hostParticipant.id,
    expectedRevision: extraAttack.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId, targetUnitId: secondUnit.id },
  });
  assert.equal(roundTwo.state.pendingDecision?.type, "attack-target");
  assert.equal(roundTwo.state.pendingDecision?.type === "attack-target" ? roundTwo.state.pendingDecision.round : undefined, 2);
  assert.equal(roundTwo.state.pendingDecision?.type === "attack-target" ? roundTwo.state.pendingDecision.attackTotal : undefined, 1);
  const afterRefresh = await store.getRoom(host.room.code, host.token);
  assert.equal(afterRefresh.state.pendingDecision?.type === "attack-target" ? afterRefresh.state.pendingDecision.attackTotal : undefined, 1);
  assert.equal(afterRefresh.version, roundTwo.version);
});

test("authenticated Challenge owner spends Whip Tentacles' persisted bonus attack after a six", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const configured = structuredClone(rooms.get(host.room.code)!.state);
  configured.currentPlayer = 0;
  configured.phase = "challenge";
  configured.players[0]!.mutationCardIds = ["Whip Tentacles"];
  configured.monsters.forEach((monster) => { monster.health = 20; monster.defense = 99; monster.damage = 2; monster.attacks = 1; });
  configured.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
  configured.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  let preRoll: import("@abominations/game-engine").GameState | undefined;
  for (let seed = 0; seed < 256 && !preRoll; seed += 1) {
    const candidate = structuredClone(configured);
    candidate.rng.seed = seed;
    const selected = applyCommand(candidate, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
    const first = applyCommand(selected, { type: "resolve-challenge" });
    if ((first.eventPayload.rolls as number[])[0] !== 6) continue;
    const second = applyCommand(first.state, { type: "resolve-challenge" });
    if ((second.eventPayload.rolls as number[])[0] !== 6) preRoll = selected;
  }
  assert.ok(preRoll, "a deterministic Challenge sequence should roll six followed by a non-six");
  rooms.get(host.room.code)!.state = preRoll;
  const before = await store.getRoom(host.room.code, host.token);
  const guestBefore = await store.getRoom(host.room.code, guest.token);
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = guestBefore.participants.find((participant) => participant.playerIndex === 1)!;
  const first = await store.submitAction(host.room.code, host.token, {
    actionId: "online-whip-tentacles-six",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  });
  assert.equal(first.state.challenge?.turn?.remainingAttacks, 1);
  assert.match((first.state.eventLog.at(-1)?.detail.attacks as Array<{ modifiers: string[] }>)[0]!.modifiers.join(" "), /Whip Tentacles: extra attack after 6/);
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.challenge?.turn?.remainingAttacks, 1);
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, {
    actionId: "wrong-seat-whip-bonus",
    actorId: opponent.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  }), /It is not your turn/);
  const bonus = await store.submitAction(host.room.code, host.token, {
    actionId: "online-whip-bonus-attack",
    actorId: owner.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  });
  assert.equal(bonus.state.challenge?.turn?.remainingAttacks, 0);
  assert.equal(bonus.state.challenge?.turn?.attacks.length, 2);
  assert.equal((await store.getRoom(host.room.code, host.token)).state.challenge?.turn?.attacks.length, 2);
});

test("authenticated Monster Challenge resolves It's a Robot! retaliation for the cardholder after refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.players[1]!.mutationCardIds = ["It's a Robot!"];
  game.monsters[0]!.health = 2;
  game.monsters[0]!.defense = 4;
  game.monsters[1]!.health = 2;
  game.monsters[1]!.location = "disappeared";
  game.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: game.monsters[0]!.id,
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    startAtEndOfTurn: false,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: game.monsters[0]!.id, opponentIds: [game.monsters[1]!.id] };
  const selected = applyCommand(game, { type: "challenge-opponent", opponentMonsterId: game.monsters[1]!.id }).state;
  let matchingSeed: number | undefined;
  for (let seed = 0; seed < 128 && matchingSeed === undefined; seed += 1) {
    const candidate = structuredClone(selected);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-challenge" });
    const attacks = result.eventPayload.attacks as Array<{ hit: boolean; retaliationDamage?: number }>;
    if (attacks.some((attack) => !attack.hit && attack.retaliationDamage === 1)) matchingSeed = seed;
  }
  assert.notEqual(matchingSeed, undefined, "a deterministic miss should trigger the card");
  selected.rng.seed = matchingSeed!;
  rooms.get(host.room.code)!.state = selected;

  const before = await store.getRoom(host.room.code, host.token);
  const challenger = before.participants.find((participant) => participant.playerIndex === 0)!;
  const cardholder = before.participants.find((participant) => participant.playerIndex === 1)!;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, {
    actionId: "wrong-seat-robot-challenge-roll",
    actorId: cardholder.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  }), /It is not your turn/);
  const resolved = await store.submitAction(host.room.code, host.token, {
    actionId: "online-robot-challenge-roll",
    actorId: challenger.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  });
  const attack = (resolved.state.eventLog.at(-1)!.detail.attacks as Array<{ hit: boolean; retaliationDamage?: number; modifiers: string[] }>)[0]!;
  assert.equal(attack.hit, false);
  assert.equal(attack.retaliationDamage, 1);
  assert.deepEqual(attack.modifiers, ["It's a Robot!: 1 electrocution damage"]);
  assert.equal(resolved.state.monsters[0]!.health, 1);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.monsters[0]!.health, 1);
  assert.deepEqual(refreshed.state.players[1]!.mutationCardIds, ["It's a Robot!"]);
});

test("authenticated High-Octane Blood owner gets the movement bonus and defends by attacking first", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.players[1]!.mutationCardIds = ["High-Octane Blood"];
  game.units.forEach((unit) => { unit.location = "record-tile"; });
  const baseMovement = structuredClone(game);
  baseMovement.players[1]!.mutationCardIds = [];
  const defenderPaths = legalMonsterPaths(game, game.monsters[1]!.id);
  const baseDefenderPaths = legalMonsterPaths(baseMovement, game.monsters[1]!.id);
  assert.equal(Math.max(...defenderPaths.map((path) => path.length - 1)), Math.max(...baseDefenderPaths.map((path) => path.length - 1)) + 1);
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.monsters.forEach((monster) => { monster.health = 20; monster.defense = 1; monster.damage = 1; monster.attacks = 1; });
  game.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  const before = await store.getRoom(host.room.code, host.token);
  const challenger = before.participants.find((participant) => participant.playerIndex === 0)!;
  const defender = before.participants.find((participant) => participant.playerIndex === 1)!;
  const selected = await store.submitAction(host.room.code, host.token, {
    actionId: "online-high-octane-select-defender",
    actorId: challenger.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "challenge-opponent", opponentMonsterId: "monster-2" },
  });
  assert.equal(selected.state.currentPlayer, 1);
  assert.equal(selected.state.challenge?.turn?.attackerId, "monster-2");
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(refreshed.state.players[1]!.mutationCardIds, ["High-Octane Blood"]);
  const opponentProjection = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(opponentProjection.state.players[1]!.visibleMutationCardIds, ["High-Octane Blood"]);
  await assert.rejects(() => store.submitAction(host.room.code, host.token, {
    actionId: "wrong-seat-high-octane-attack",
    actorId: challenger.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  }), /It is not your turn/);
  const attack = await store.submitAction(host.room.code, guest.token, {
    actionId: "online-high-octane-defender-attack",
    actorId: defender.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-challenge" },
  });
  assert.equal((attack.state.eventLog.at(-1)?.detail.attacks as Array<{ attackerId: string }>)[0]!.attackerId, "monster-2");
  assert.equal((await store.getRoom(host.room.code, host.token)).state.currentPlayer, 1);
});

test("authenticated Winged Horror owner can fly a monster across a sea barrier and keep the effect after refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.boardId = AUDITED_BOARD.id;
  game.boardVersion = AUDITED_BOARD.version;
  game.boardContentHash = AUDITED_BOARD.contentHash;
  const edge = AUDITED_BOARD.edges.find((candidate) => candidate.enabled && candidate.barrier === "sea"
    && AUDITED_BOARD.hexes[candidate.from]?.waterClass === "seacoast" && AUDITED_BOARD.hexes[candidate.to]?.waterClass === "sea")!;
  game.currentPlayer = 0;
  game.phase = "move";
  game.players[0]!.mutationCardIds = ["Winged Horror"];
  game.monsters[0]!.location = edge.from;
  game.monsters[1]!.location = "record-tile";
  game.units.forEach((unit) => { unit.location = "record-tile"; });
  game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };
  const before = await store.getRoom(host.room.code, host.token);
  assert.ok(legalMonsterPaths(before.state, "monster-1").some((path) => path.join(">") === `${edge.from}>${edge.to}`));
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-winged-horror-fly",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "move" as const, path: [edge.from, edge.to] },
  };
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: opponent.id, actionId: "wrong-seat-winged-horror" }), /It is not your turn/);
  const moved = await store.submitAction(host.room.code, host.token, command);
  assert.equal(moved.state.monsters[0]!.location, edge.to);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.monsters[0]!.location, edge.to);
  assert.deepEqual(refreshed.state.players[0]!.visibleMutationCardIds, ["Winged Horror"]);
});

test("authenticated Kinda Friendly owner can move through a Guard-only space", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "move";
  game.players[0]!.mutationCardIds = ["Kinda Friendly"];
  game.monsters[1]!.location = "record-tile";
  game.units.forEach((unit) => { unit.location = "record-tile"; });
  const path = legalMonsterPaths(game, "monster-1").find((candidate) => candidate.length >= 3);
  assert.ok(path, "the monster should have a route with a pass-through space");
  const guardId = "national-guard-online-kinda-friendly";
  const intermediate = path[1]!;
  game.units.push({ id: guardId, branch: "National Guard", unitTypeId: "national-guard-tank", move: 3, movement: "land-only", attacks: 1, damage: 1, health: 1, defense: 4, location: intermediate });
  assert.ok(legalMonsterPaths(game, "monster-1").some((candidate) => candidate.join(">") === path.join(">")));
  const before = await store.getRoom(host.room.code, host.token);
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-kinda-friendly-pass-guard",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "move", path },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: opponent.id, actionId: "wrong-seat-kinda-friendly" }), /It is not your turn/);
  const moved = await store.submitAction(host.room.code, host.token, command);
  assert.equal(moved.state.monsters[0]!.location, path.at(-1));
  assert.equal(moved.state.units.find((unit) => unit.id === guardId)?.location, intermediate);
  assert.deepEqual(moved.state.pendingBattles, []);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.units.find((unit) => unit.id === guardId)?.location, intermediate);
  assert.deepEqual(refreshed.state.players[0]!.visibleMutationCardIds, ["Kinda Friendly"]);
});

test("authenticated Laser Beam Eyes owner hits a cruise missile with the visible +2 after refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "fight";
  game.players[0]!.mutationCardIds = ["Laser Beam Eyes"];
  game.monsters[0]!.attacks = 1;
  const missile = game.units.find((unit) => unit.unitTypeId === "air-force-cruise-missile")!;
  missile.location = game.monsters[0]!.location;
  missile.defense = 6;
  const battleId = "online-laser-beam-eyes";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [missile.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  let seed = 0;
  for (; seed < 128; seed += 1) {
    const candidate = structuredClone(game);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight" });
    const attacks = result.eventPayload.attacks as Array<{ attackerId: string; roll: number }>;
    if (attacks.some((attack) => attack.attackerId === game.monsters[0]!.id && attack.roll === 4)) break;
  }
  assert.ok(seed < 128, "a deterministic natural 4 should be available");
  game.rng.seed = seed;
  const before = await store.getRoom(host.room.code, host.token);
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = before.participants.find((participant) => participant.playerIndex === 1)!;
  const action = {
    actionId: "online-laser-beam-eyes-resolve",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight" as const },
  };
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...action, actorId: opponent.id, actionId: "wrong-seat-laser-beam-eyes" }), /It is not your turn/);
  const resolved = await store.submitAction(host.room.code, host.token, action);
  const attacks = resolved.state.eventLog.at(-1)!.detail.attacks as Array<{ attackerId: string; roll: number; hit: boolean; modifiers: string[] }>;
  const monsterAttack = attacks.find((attack) => attack.attackerId === game.monsters[0]!.id)!;
  assert.equal(monsterAttack.roll, 4);
  assert.equal(monsterAttack.hit, true);
  assert.deepEqual(monsterAttack.modifiers, ["Laser Beam Eyes: +2 to hit cruise missiles"]);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  const refreshedAttacks = refreshed.state.eventLog.at(-1)!.detail.attacks as typeof attacks;
  assert.deepEqual(refreshedAttacks.find((attack) => attack.attackerId === game.monsters[0]!.id)?.modifiers, ["Laser Beam Eyes: +2 to hit cruise missiles"]);
  assert.deepEqual(refreshed.state.players[0]!.visibleMutationCardIds, ["Laser Beam Eyes"]);
});

test("authenticated Rampage owner can move after emerging from a lair", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "move";
  game.encounterSuppressed = true;
  game.players[0]!.mutationCardIds = ["Rampage"];
  game.movedPieceIds = [];
  game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };
  const path = legalMonsterPaths(game, game.monsters[0]!.id)[0];
  assert.ok(path, "the emerging monster should have a legal route");

  const before = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(legalMonsterPaths(before.state, game.monsters[0]!.id)[0], path, "the authenticated player projection should expose the Rampage route");
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const action = {
    actionId: "online-rampage-emergence-move",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "move", path },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...action, actorId: guestParticipant.id, actionId: "wrong-seat-rampage-move" }), /It is not your turn/);
  const moved = await store.submitAction(host.room.code, host.token, action);
  assert.equal(moved.state.monsters[0]!.location, path.at(-1));
  assert.ok(moved.state.movedPieceIds.includes(game.monsters[0]!.id));
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.monsters[0]!.location, path.at(-1));
  assert.equal(refreshed.version, moved.version);
});

test("authenticated Defense Satellites owner can play in the open Fight window and keeps a surviving battle", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "fight";
  game.players[0]!.researchCardIds = ["Defense Satellites"];
  game.monsters.forEach((monster) => { monster.health = 30; });
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[0]!.location;
  const battleId = "online-defense-satellites-open-fight";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  const before = await store.getRoom(host.room.code, host.token);
  const owner = before.participants.find((participant) => participant.playerIndex === 0)!;
  const opponent = before.participants.find((participant) => participant.playerIndex === 1)!;
  const action = {
    actionId: "online-defense-satellites-use",
    actorId: owner.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research" as const, cardId: "Defense Satellites" as const },
  };
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...action, actorId: opponent.id, actionId: "wrong-seat-defense-satellites" }), /It is not your turn/);
  const used = await store.submitAction(host.room.code, host.token, action);
  assert.equal(used.state.pendingBattles[0]?.id, battleId);
  assert.equal(used.state.pendingDecision?.type, "battle-resolution");
  assert.deepEqual(used.state.players[0]!.researchCardIds, []);
  assert.deepEqual(rooms.get(host.room.code)!.state.decks.research.discard, ["Defense Satellites"]);
  const event = used.state.eventLog.at(-1)!;
  assert.equal(event.action, "research.used");
  assert.equal((event.detail.rolls as number[]).length, 2);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.pendingBattles[0]?.id, battleId);
  assert.equal(refreshed.state.eventLog.at(-1)?.detail.researchCardId, "Defense Satellites");
});

test("authenticated battle projection shows Radiation Field destroying a roll-one attacker", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "fight";
  game.monsters[1]!.attacks = 0;
  game.players[1]!.mutationCardIds = ["Radiation Field"];
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[1]!.location;
  unit.defense = 99;
  const battleId = "online-radiation-field-roll-one";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[1]!.id, location: game.monsters[1]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  let matchingSeed: number | undefined;
  for (let seed = 0; seed < 128 && matchingSeed === undefined; seed += 1) {
    const candidate = structuredClone(game);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    if ((result.eventPayload.attacks as Array<{ attackerId: string; roll: number }>).some((attack) => attack.attackerId === unit.id && attack.roll === 1)) matchingSeed = seed;
  }
  assert.notEqual(matchingSeed, undefined, "a deterministic battle seed should produce a roll of one");
  game.rng.seed = matchingSeed!;
  const before = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(before.state.players[1]!.visibleMutationCardIds, ["Radiation Field"]);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-radiation-field-resolve",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-seat-radiation-field" }), /It is not your turn/);
  const resolved = await store.submitAction(host.room.code, host.token, command);
  const attack = (resolved.state.eventLog.at(-1)?.detail.attacks as Array<{ attackerId: string; roll: number; attackerDestroyed?: boolean }>).find((entry) => entry.attackerId === unit.id && entry.roll === 1);
  assert.equal(attack?.attackerDestroyed, true);
  assert.equal(resolved.state.units.find((candidate) => candidate.id === unit.id)?.location, "record-tile");
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(refreshed.state.players[1]!.mutationCardIds, ["Radiation Field"]);
  assert.equal(refreshed.state.units.find((candidate) => candidate.id === unit.id)?.location, "record-tile");
  assert.equal(refreshed.version, resolved.version);
});

test("authenticated Toxicor Mutation-site choice shows two options and keeps the selected card after refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.monsters[0]!.name = "Toxicor";
  game.monsters[0]!.location = Object.values(boardForState(game).hexes).find((hex) => hex.features.some((feature) => feature.kind === "mutation-site"))!.key;
  game.phase = "encounter";
  game.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: game.monsters[0]!.location as `${number},${number}` };
  game.decks.mutation = { order: ["Fins and Gills", "Rampage"], drawIndex: 0, discard: [], exhausted: false };

  const initial = await store.getRoom(host.room.code, host.token);
  const hostParticipant = initial.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = initial.participants.find((participant) => participant.playerIndex === 1)!;
  const opened = await store.submitAction(host.room.code, host.token, {
    actionId: "online-toxicor-open-choice",
    actorId: hostParticipant.id,
    expectedRevision: initial.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-encounter" },
  });
  assert.equal(opened.state.pendingDecision?.type, "mutation-choice");
  if (opened.state.pendingDecision?.type !== "mutation-choice") throw new Error("Toxicor did not open a choice.");
  assert.deepEqual(opened.state.pendingDecision.cardIds, ["Fins and Gills", "Rampage"]);

  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.pendingDecision?.type, "mutation-choice");
  assert.deepEqual(refreshed.state.pendingDecision?.type === "mutation-choice" ? refreshed.state.pendingDecision.cardIds : [], ["Fins and Gills", "Rampage"]);
  const opponentView = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(opponentView.state.pendingDecision?.type === "mutation-choice" ? opponentView.state.pendingDecision.cardIds : [], []);
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, {
    actionId: "wrong-seat-toxicor-choice",
    actorId: guestParticipant.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-mutation-card", cardId: "Rampage" },
  }), /It is not your turn/);

  const chosen = await store.submitAction(host.room.code, host.token, {
    actionId: "online-toxicor-choose-rampage",
    actorId: hostParticipant.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-mutation-card", cardId: "Rampage" },
  });
  assert.deepEqual(chosen.state.players[0]!.mutationCardIds, ["Rampage"]);
  assert.equal(chosen.state.pendingDecision?.type, "deployment");
  const afterRefresh = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(afterRefresh.state.players[0]!.mutationCardIds, ["Rampage"]);
  assert.equal(afterRefresh.state.pendingDecision?.type, "deployment");
  const authoritativeAfterChoice = rooms.get(host.room.code)!.state;
  assert.equal(authoritativeAfterChoice.decks.mutation.drawIndex, 2);
  assert.equal(authoritativeAfterChoice.decks.mutation.order.includes("Fins and Gills"), true);
});

test("authenticated off-turn Toxicor owner chooses a combat Mutation and resumes the saved battle", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const configured = structuredClone(rooms.get(host.room.code)!.state);
  configured.currentPlayer = 0;
  configured.phase = "fight";
  configured.monsters[1]!.name = "Toxicor";
  configured.monsters[1]!.attacks = 1;
  configured.monsters[1]!.defense = 1;
  const unit = configured.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = configured.monsters[1]!.location;
  unit.defense = 99;
  unit.damage = 1;
  const battleId = "authenticated-toxicor-antimatter";
  configured.pendingBattles = [{ id: battleId, monsterId: configured.monsters[1]!.id, location: configured.monsters[1]!.location as `${number},${number}`, militaryUnitIds: [unit.id], antimatterActive: true }];
  configured.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  configured.decks.mutation = { order: ["War Spikes", "Atomic Breath"], drawIndex: 0, discard: [], exhausted: false };
  let paused: import("@abominations/game-engine").GameState | undefined;
  for (let seed = 0; seed < 256 && !paused; seed += 1) {
    const candidate = structuredClone(configured);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    if (result.state.pendingDecision?.type === "mutation-choice") paused = result.state;
  }
  assert.ok(paused, "a deterministic seed should produce a Toxicor Antimatter mutation choice");
  rooms.get(host.room.code)!.state = paused;

  const hostView = await store.getRoom(host.room.code, host.token);
  const guestView = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(hostView.state.pendingDecision?.type === "mutation-choice" ? hostView.state.pendingDecision.cardIds : [], []);
  assert.deepEqual(guestView.state.pendingDecision?.type === "mutation-choice" ? guestView.state.pendingDecision.cardIds : [], ["War Spikes", "Atomic Breath"]);
  const hostParticipant = hostView.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = guestView.participants.find((participant) => participant.playerIndex === 1)!;
  await assert.rejects(() => store.submitAction(host.room.code, host.token, {
    actionId: "wrong-seat-toxicor-battle-choice",
    actorId: hostParticipant.id,
    expectedRevision: guestView.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-mutation-card", cardId: "War Spikes" },
  }), /It is not your turn/);
  const chosen = await store.submitAction(host.room.code, guest.token, {
    actionId: "authenticated-toxicor-battle-choice",
    actorId: guestParticipant.id,
    expectedRevision: guestView.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-mutation-card", cardId: "War Spikes" },
  });
  assert.deepEqual(chosen.state.players[1]!.mutationCardIds, ["War Spikes"]);
  assert.equal(chosen.state.pendingDecision?.type, "attack-target");
  assert.equal(chosen.state.pendingCombat?.round, 2);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.deepEqual(refreshed.state.players[1]!.mutationCardIds, ["War Spikes"]);
  assert.equal(refreshed.state.pendingDecision?.type, "attack-target");
  assert.equal(rooms.get(host.room.code)!.state.decks.mutation.order.includes("Atomic Breath"), true);
});

test("players can create, join, and read a room", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Player 1", "public");
  const guest = await store.joinRoom(host.room.code, "Guest");
  assert.equal(guest.room.status, "waiting");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  assert.equal(active.status, "active");
  assert.equal(active.state.setupState?.phase, "complete");
  assert.equal(active.state.setupApplied, true);
  const hostView = await store.getRoom(host.room.code, host.token);
  assert.equal(hostView.state.players[0]?.researchCardIds.length, 1);
  assert.equal(active.state.players[1]?.researchCardIds.length, 1);
  assert.equal(active.state.matchId, `room-${host.room.code}`);
  assert.deepEqual(active.state.players.map((player) => player.id), ["player-1", "player-2"]);
  assert.deepEqual(active.state.setupAssignments?.map((seat) => seat.monsterId), ["monster-1", "monster-2"]);
  await assert.rejects(() => store.setupAction(host.room.code, host.token, { type: "choose-monster", monsterId: "monster-1" }, active.version - 1), /Expected revision/);
  const state = await store.getRoom(host.room.code, host.token);
  assert.equal(state.participants.length, 2);
});

test("an authenticated active player can play Molecular Cannon through the online room command path", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.players[0]!.researchCardIds = ["Molecular Cannon"];
  const monster = game.monsters[0]!;
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = monster.location;
  game.phase = "fight";
  const battleId = "online-molecular-cannon";
  game.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  const before = await store.getRoom(host.room.code, host.token);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-cannon-card-use",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research", cardId: "Molecular Cannon", battleId, targetMonsterId: monster.id, destination: locationIdToHexKey("seattle")! },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-online-actor" }), /It is not your turn/);
  const after = await store.submitAction(host.room.code, host.token, command);
  assert.equal(after.state.monsters[0]!.location, locationIdToHexKey("seattle"));
  assert.deepEqual(after.state.players[0]!.researchCardIds, []);
  assert.equal(after.state.pendingBattles.length, 0);
  assert.equal(after.events[0]!.type, "research.used");
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.monsters[0]!.location, locationIdToHexKey("seattle"));
  assert.equal(refreshed.version, after.version);
});

test("authenticated Stabilizer Ray use opens a persisted post-damage choice against a projected opponent Mutation", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.players[0]!.researchCardIds = ["Stabilizer Ray"];
  game.players[1]!.mutationCardIds = ["Rampage"];
  const monster = game.monsters[1]!;
  monster.defense = 1;
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = monster.location;
  unit.defense = 99;
  game.phase = "fight";
  const battleId = "online-stabilizer-ray";
  game.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  const projected = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(projected.state.players[1]!.mutationCardIds, []);
  assert.deepEqual(projected.state.players[1]!.visibleMutationCardIds, ["Rampage"]);
  const hostParticipant = projected.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = projected.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-stabilizer-ray-use",
    actorId: hostParticipant.id,
    expectedRevision: projected.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research", cardId: "Stabilizer Ray", battleId },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-online-stabilizer-actor" }), /It is not your turn/);
  const after = await store.submitAction(host.room.code, host.token, command);
  assert.deepEqual(after.state.players[0]!.researchCardIds, []);
  assert.equal(after.state.pendingBattles[0]!.stabilizerRayPlayerIndex, 0);
  assert.equal(after.state.pendingStabilizerRayChoice, undefined);
  const armedRefresh = await store.getRoom(host.room.code, host.token);
  assert.equal(armedRefresh.state.pendingBattles[0]!.stabilizerRayPlayerIndex, 0);
  const fight = await store.submitAction(host.room.code, host.token, {
    actionId: "online-stabilizer-ray-fight",
    actorId: hostParticipant.id,
    expectedRevision: armedRefresh.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-fight", battleId },
  });
  assert.equal(fight.state.pendingDecision?.type, "stabilizer-ray-choice");
  assert.deepEqual(fight.state.pendingStabilizerRayChoice?.cardIds, ["Rampage"]);
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.pendingDecision?.type, "stabilizer-ray-choice");
  assert.deepEqual(refreshed.state.players[1]!.mutationCardIds, []);
  assert.deepEqual(refreshed.state.players[1]!.visibleMutationCardIds, ["Rampage"]);
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, {
    actionId: "wrong-online-stabilizer-ray-choice-actor",
    actorId: guestParticipant.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-stabilizer-ray-mutation", cardId: "Rampage" },
  }), /It is not your turn/);
  const chosen = await store.submitAction(host.room.code, host.token, {
    actionId: "online-stabilizer-ray-choice",
    actorId: hostParticipant.id,
    expectedRevision: refreshed.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "choose-stabilizer-ray-mutation", cardId: "Rampage" },
  });
  assert.deepEqual(chosen.state.players[1]!.mutationCardIds, []);
  assert.ok(rooms.get(host.room.code)!.state.decks.mutation.discard.includes("Rampage"));
  assert.equal(chosen.state.pendingStabilizerRayChoice, undefined);
  assert.equal(chosen.state.pendingDecision?.type, "retreat");
  const chosenRefresh = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(chosenRefresh.state.players[1]!.visibleMutationCardIds, []);
  assert.equal(chosenRefresh.state.pendingDecision?.type, "retreat");
});

test("authenticated Cutbacks use can remove an opponent's public face-up Research card", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "move";
  game.players[0]!.researchCardIds = ["Cutbacks"];
  game.players[1]!.researchCardIds = ["Guard Commander"];

  const before = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(before.state.players[1]!.researchCardIds, []);
  assert.deepEqual(before.state.players[1]!.visibleResearchCardIds, ["Guard Commander"]);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-cutbacks-card-use",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research", cardId: "Cutbacks", researchCardId: "Guard Commander", researchPlayerIndex: 1 },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...command, actorId: guestParticipant.id, actionId: "wrong-cutbacks-actor" }), /It is not your turn/);
  const after = await store.submitAction(host.room.code, host.token, command);
  assert.deepEqual(after.state.players[0]!.researchCardIds, []);
  assert.deepEqual(after.state.players[1]!.visibleResearchCardIds, []);
  assert.deepEqual(after.state.removedResearchCardIds, ["Guard Commander"]);
  assert.equal(after.events[0]!.type, "research.used");
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.deepEqual(refreshed.state.players[1]!.researchCardIds, []);
  assert.deepEqual(refreshed.state.removedResearchCardIds, ["Guard Commander"]);
  assert.equal(refreshed.version, after.version);
});

test("authenticated off-turn monster owners can use battle Mutations in Fight and Challenge", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);

  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.players[1]!.mutationCardIds = ["Berserk"];
  const monster = game.monsters[1]!;
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = monster.location;
  game.phase = "fight";
  const battleId = "online-defending-monster-berserk";
  game.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

  let view = await store.getRoom(host.room.code, guest.token);
  const hostParticipant = view.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = view.participants.find((participant) => participant.playerIndex === 1)!;
  const fightCommand = {
    actionId: "online-defending-monster-berserk",
    actorId: guestParticipant.id,
    expectedRevision: view.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-mutation", cardId: "Berserk", battleId },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { ...fightCommand, actorId: hostParticipant.id, actionId: "wrong-fight-owner" }), /It is not your turn/);
  let after = await store.submitAction(host.room.code, guest.token, fightCommand);
  assert.equal(after.state.pendingBattles[0]!.bonusMonsterAttacks, 5);
  assert.deepEqual(after.state.players[1]!.mutationCardIds, []);
  view = await store.getRoom(host.room.code, guest.token);
  assert.equal(view.version, after.version);
  assert.equal(view.state.pendingBattles[0]!.bonusMonsterAttacks, 5);

  const challengeGame = rooms.get(host.room.code)!.state;
  challengeGame.currentPlayer = 0;
  challengeGame.phase = "challenge";
  challengeGame.players[1]!.mutationCardIds = ["Son of a Monster"];
  challengeGame.challenge = {
    declared: true, active: true, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2",
    declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: [],
    turn: { attackerId: "monster-1", firstAttackerId: "monster-1", round: 1, remainingAttacks: 1, attacks: [] },
  };
  challengeGame.pendingDecision = { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2" };
  view = await store.getRoom(host.room.code, guest.token);
  const challengeCommand = {
    actionId: "online-defending-monster-son",
    actorId: guestParticipant.id,
    expectedRevision: view.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-mutation", cardId: "Son of a Monster" },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { ...challengeCommand, actorId: hostParticipant.id, actionId: "wrong-challenge-owner" }), /It is not your turn/);
  after = await store.submitAction(host.room.code, guest.token, challengeCommand);
  assert.equal(after.state.challenge?.turn?.bonusAttacksByMonster?.["monster-2"], 2);
  assert.ok((after.state.challenge?.turn?.attacks.length ?? 0) === 0);
  assert.deepEqual(after.state.players[1]!.mutationCardIds, []);
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.challenge?.turn?.bonusAttacksByMonster?.["monster-2"], 2);
  assert.equal(refreshed.version, after.version);
});

test("authenticated off-turn Laser Fence holder can resolve a post-move reaction", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "move";
  game.players[1]!.researchCardIds = ["Laser Fence"];
  game.monsters[0]!.infamy = 3;
  game.laserFenceWindowMonsterIds = [game.monsters[0]!.id];
  game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };

  const before = await store.getRoom(host.room.code, host.token);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const command = {
    actionId: "online-off-turn-laser-fence",
    actorId: guestParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research", cardId: "Laser Fence", targetMonsterId: "monster-1", choice: "infamy" },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, host.token, { ...command, actorId: hostParticipant.id, actionId: "online-wrong-laser-fence-owner" }), /It is not your turn/);
  const after = await store.submitAction(host.room.code, guest.token, command);
  assert.equal(after.state.monsters[0]!.infamy, 1);
  assert.deepEqual(after.state.players[1]!.researchCardIds, []);
  assert.deepEqual(rooms.get(host.room.code)!.state.decks.research.discard, ["Laser Fence"]);
  assert.equal(after.events[0]!.type, "research.used");
  const refreshed = await store.getRoom(host.room.code, guest.token);
  assert.equal(refreshed.state.monsters[0]!.infamy, 1);
  assert.equal(refreshed.version, after.version);
});

test("authenticated Chopper Lift preserves its roll and destination choice through room refresh", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  const rooms = (store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms;
  const game = rooms.get(host.room.code)!.state;
  game.currentPlayer = 0;
  game.phase = "move";
  game.players[0]!.researchCardIds = ["Chopper Lift"];
  game.monsters[0]!.infamy = 2;
  game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };
  const before = await store.getRoom(host.room.code, host.token);
  const hostParticipant = before.participants.find((participant) => participant.playerIndex === 0)!;
  const guestParticipant = before.participants.find((participant) => participant.playerIndex === 1)!;
  const rollCommand = {
    actionId: "online-chopper-lift-roll",
    actorId: hostParticipant.id,
    expectedRevision: before.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "use-research", cardId: "Chopper Lift" },
  } as const;
  const rolled = await store.submitAction(host.room.code, host.token, rollCommand);
  const roll = rolled.state.pendingChopperLift?.roll;
  assert.ok(roll);
  assert.equal(rolled.state.pendingDecision?.type, "chopper-lift-choice");
  const restoredChoice = await store.getRoom(host.room.code, host.token);
  assert.equal(restoredChoice.state.pendingChopperLift?.roll, roll);
  const targetMonsterId = game.monsters[0]!.id;
  const destination = legalChopperLiftDestinations(restoredChoice.state, targetMonsterId, roll)[0];
  assert.ok(destination);
  const chooseCommand = {
    actionId: "online-chopper-lift-choice",
    actorId: hostParticipant.id,
    expectedRevision: restoredChoice.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command: { type: "resolve-chopper-lift", targetMonsterId, destination },
  } as const;
  await assert.rejects(() => store.submitAction(host.room.code, guest.token, { ...chooseCommand, actorId: guestParticipant.id, actionId: "online-wrong-chopper-actor" }), /It is not your turn/);
  const completed = await store.submitAction(host.room.code, host.token, chooseCommand);
  assert.equal(completed.state.monsters[0]!.location, destination);
  assert.equal(completed.state.monsters[0]!.infamy, 1);
  assert.equal(completed.state.pendingChopperLift, undefined);
  assert.equal(completed.events[0]!.type, "research.chopper-lift.resolved");
  assert.equal(rooms.get(host.room.code)!.state.decks.research.discard.includes("Chopper Lift"), true);
  assert.equal((await store.getRoom(host.room.code, host.token)).version, completed.version);
});

test("room creation preserves the host display name", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "  Alex  ");
  assert.equal(host.room.participants[0]?.displayName, "Alex");
});

test("private rooms reject spectator entry and public rooms allow it", async () => {
  const store = new MemoryRoomStore(true);
  const privateHost = await store.createRoom(2, "Host", "private");
  assert.equal(privateHost.room.privacy, "private");
  await assert.rejects(() => store.spectateRoom(privateHost.room.code, "Watcher"), /private/);
  const publicHost = await store.createRoom(2, "Host", "public");
  assert.equal(publicHost.room.privacy, "public");
  const spectator = await store.spectateRoom(publicHost.room.code, "Watcher");
  assert.equal(spectator.room.privacy, "public");
});

test("public room discovery returns only redacted open-room summaries", async () => {
  const store = new MemoryRoomStore(true);
  const publicHost = await store.createRoom(3, "Host", "public");
  await store.spectateRoom(publicHost.room.code, "Watcher");
  await store.createRoom(2, "Private host", "private");

  const rooms = await store.listPublicRooms();
  assert.deepEqual(rooms, [{
    code: publicHost.room.code,
    status: "waiting",
    maxPlayers: 3,
    playerCount: 1,
    spectatorCount: 1,
  }]);
  assert.equal(Object.hasOwn(rooms[0]!, "state"), false);
  assert.equal(Object.hasOwn(rooms[0]!, "token"), false);
});

test("public room discovery omits idle rooms after refreshing lifecycle state", async () => {
  const store = new MemoryRoomStore(true);
  await store.createRoom(2, "Host", "public");
  const rooms = (store as unknown as { rooms: Map<string, { lastActivityAt: number }> }).rooms;
  [...rooms.values()][0]!.lastActivityAt = 0;

  assert.deepEqual(await store.listPublicRooms(), []);
  assert.equal([...rooms.values()][0]!.lastActivityAt, 0);
});

test("memory store health reports its persistence boundary", async () => {
  assert.deepEqual(await new MemoryRoomStore(true).health(), { persistence: "memory" });
});

test("MVP room creation uses the full human-audited board", async () => {
  const created = await new MemoryRoomStore().createRoom(2);
  assert.equal(created.room?.state.boardId, "human-audited-north-america");
  assert.equal(created.room?.state.setupState?.phase, "monster-selection");
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
  const host = await store.createRoom(2, "Player 1", "public");
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
  const host = await store.createRoom(2, "Player 1", "public");
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

test("session rotation preserves the participant while revoking the old token", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Player 1", "public");
  const rotated = await store.rotateSession(host.room.code, host.token);
  assert.equal(rotated.participantId, host.participantId);
  assert.notEqual(rotated.token, host.token);
  assert.equal((await store.getRoom(host.room.code, rotated.token)).participants.find((participant) => participant.id === host.participantId)?.role, "player");
  await assert.rejects(() => store.getRoom(host.room.code, host.token), /Invalid room token/);
});

test("expired memory sessions cannot be used and rotation refreshes the expiry", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Player 1", "public");
  const rooms = (store as unknown as { rooms: Map<string, { participants: Array<{ id: string; sessionExpiresAt: number }> }> }).rooms;
  const participant = [...rooms.values()][0]!.participants.find((candidate) => candidate.id === host.participantId)!;
  participant.sessionExpiresAt = Date.now() - 1;
  await assert.rejects(() => store.getRoom(host.room.code, host.token), /Session token has expired/);
  // Leave enough headroom for the async authorization and token rotation
  // path; a one-millisecond lease makes this regression test scheduler-flaky.
  participant.sessionExpiresAt = Date.now() + 60_000;
  const rotated = await store.rotateSession(host.room.code, host.token);
  assert.ok(participant.sessionExpiresAt > Date.now());
  assert.ok(rotated.token);
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
  const host = await store.createRoom(2, "Player 1", "public");
  const spectator = await store.spectateRoom(host.room.code, "Watch-only");
  await assert.rejects(() => store.submitAction(host.room.code, spectator.token, { actionId: "a1", actorId: spectator.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } }), /Spectators/);
});

test("completed terminal results survive player refresh and spectator projection", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Player 1", "public");
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
  const host = await store.createRoom(2, "Player 1", "public");
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
  storedRoom.state.units.filter((unit: any) => unit.location === locationIdToHexKey("denver")).forEach((unit: any) => { unit.defense = 99; });
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
  // Compare the same audience on every reconnect; the active response above
  // is the guest projection and intentionally redacts Player 1's hand.
  const baseline = JSON.stringify((await store.getRoom(host.room.code, host.token)).state);
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

test("memory event history keeps the bounded recovery suffix", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const rooms = (store as unknown as { rooms: Map<string, { events: unknown[] }> }).rooms;
  const storedRoom = [...rooms.values()][0]!;
  storedRoom.events = Array.from({ length: MAX_RETAINED_ROOM_EVENTS }, (_, index) => ({ version: index + 1 }));
  await store.submitAction(host.room.code, host.token, { actionId: "retention-boundary", actorId: host.participantId, expectedRevision: active.version, protocolVersion: 1, command: { type: "pass-move" } });
  assert.equal(storedRoom.events.length, MAX_RETAINED_ROOM_EVENTS);
});

test("bounded concurrent room and spectator operations remain isolated", async () => {
  const store = new MemoryRoomStore(true);
  const sessions = await Promise.all(Array.from({ length: 24 }, (_, index) => store.createRoom(2, "Player 1", "public").then(async (host) => {
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


test("setup rejects illegal starting placements without locking in the choice", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host", "private");
  const guest = await store.joinRoom(host.room.code, "Guest");
  let revision = host.room.version;
  const code = host.room.code;
  for (const [index, session] of [host, guest].entries()) revision = (await store.setupAction(code, session.token, { type: "choose-monster", monsterId: `monster-${index + 1}` }, revision)).version;
  revision = (await store.setupAction(code, guest.token, { type: "choose-branch", branch: "Navy" }, revision)).version;
  revision = (await store.setupAction(code, host.token, { type: "choose-branch", branch: "Army" }, revision)).version;
  revision = (await store.setupAction(code, host.token, { type: "choose-lair", lair: "los-angeles" }, revision)).version;
  revision = (await store.setupAction(code, guest.token, { type: "choose-lair", lair: "chicago" }, revision)).version;
  await assert.rejects(() => store.setupAction(code, host.token, { type: "choose-starting-choice", startingChoice: { kind: "deploy", placements: [{ unitId: "missing-unit", destination: "denver" }] } }, revision), /verified base/);
  const unchanged = await store.getRoom(code, host.token);
  assert.equal(unchanged.version, revision);
  assert.equal(unchanged.state.setupState?.seats[0]?.startingChoice, undefined);
  const corrected = await store.setupAction(code, host.token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }, revision);
  assert.equal(corrected.state.setupState?.seats[0]?.ready, true);
});

test("Challenge roll ownership switches online and reconnect preserves the infamy decision", async () => {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  await completeDevelopmentSetup(store, [host, guest]);
  await store.setReady(host.room.code, host.token, true);
  const active = await store.setReady(host.room.code, guest.token, true);
  const stored = [...(store as unknown as { rooms: Map<string, { state: import("@abominations/game-engine").GameState }> }).rooms.values()][0]!;
  stored.state.phase = "challenge";
  stored.state.monsters.forEach(monster => { monster.health = 30; monster.attacks = 1; monster.infamy = 2; monster.defense = 1; });
  stored.state.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: [] };
  stored.state.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  let revision = active.version;
  const submit = async (session: typeof host, command: import("@abominations/game-engine").GameCommand) => {
    const result = await store.submitAction(host.room.code, session.token, { actionId: `challenge-${revision}`, actorId: session.participantId, expectedRevision: revision, protocolVersion: 1, command });
    revision = result.version;
    return result;
  };
  await submit(host, { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  await submit(host, { type: "resolve-challenge" });
  const refreshed = await store.getRoom(host.room.code, host.token);
  assert.equal(refreshed.state.challenge?.turn?.remainingAttacks, 0);
  assert.equal(refreshed.state.monsters[0].infamy, 2);
  await assert.rejects(submit(guest, { type: "resolve-challenge", spendInfamy: true }), /not your turn/);
  await submit(host, { type: "resolve-challenge", spendInfamy: true });
  await submit(host, { type: "resolve-challenge", endTurn: true });
  await assert.rejects(submit(host, { type: "resolve-challenge" }), /not your turn/);
  const response = await submit(guest, { type: "resolve-challenge" });
  assert.equal(response.state.challenge?.turn?.attacks.length, 3);
  assert.equal(response.state.monsters[0].infamy, 1);
});
