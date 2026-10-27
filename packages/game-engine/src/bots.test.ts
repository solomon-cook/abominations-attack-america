import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, applyCompletedSetup, applySetupAction, createGame, createMvpRoomGame } from "./index.js";
import { botStrategyHint, botTacticForPlayer, chooseBotCommand, chooseBotSetupAction, chooseBotSetupActionWithRecord } from "./bots.js";

function readyTwoPlayerMatch(seed: number) {
  let game = createMvpRoomGame(2, seed);
  let setup = game.setupState!;
  for (let step = 0; step < 100 && setup.phase !== "complete"; step += 1) {
    const actor = setup.phase === "monster-selection"
      ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
      : setup.phase === "branch-selection"
        ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
        : setup.phase === "unused-branch-placement"
          ? 1
          : setup.phase === "lair-selection"
            ? setup.seats.find((seat) => !seat.lair)?.playerIndex
            : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
    assert.notEqual(actor, undefined);
    setup = chooseBotSetupAction(game, setup, actor!);
  }
  assert.equal(setup.phase, "complete");
  game = applyCompletedSetup({ ...game, setupState: setup });
  return game;
}

test("bot difficulty profiles are deterministic and clearly described", () => {
  const state = createGame(2, 7);
  assert.equal(botTacticForPlayer(state, 1, "casual"), "research-first");
  assert.equal(botTacticForPlayer(state, 1, "challenging"), "force-first");
  assert.equal(botTacticForPlayer(state, 1), botTacticForPlayer(state, 1, "standard"));
  assert.match(botStrategyHint("Konk", "Army", "research-first", "casual"), /^Casual opponent\./);
  assert.match(botStrategyHint("Konk", "Army", "force-first", "challenging"), /^Challenging opponent\./);
});

test("each bot setup transition returns an action that reproduces the same setup state", () => {
  let game = createMvpRoomGame(2, 31);
  let setup = game.setupState!;
  for (let step = 0; step < 20 && setup.phase !== "complete"; step += 1) {
    const actor = setup.phase === "monster-selection"
      ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
      : setup.phase === "branch-selection"
        ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
        : setup.phase === "lair-selection"
          ? setup.seats.find((seat) => !seat.lair)?.playerIndex
          : setup.phase === "starting-choice"
            ? setup.seats.find((seat) => !seat.startingChoice)?.playerIndex
            : setup.definition.playerCount - 1;
    assert.notEqual(actor, undefined);
    const result = chooseBotSetupActionWithRecord(game, setup, actor!);
    assert.ok(result.action, `bot action should be recorded for ${setup.phase}`);
    assert.deepEqual(applySetupAction(setup, actor!, result.action!), result.setup);
    setup = result.setup;
  }
  assert.equal(setup.phase, "complete");
  game = applyCompletedSetup({ ...game, setupState: setup });
  assert.equal(game.phase, "move");
});

test("Casual selects a less optimized legal deployment than Tactical and Challenging", () => {
  const state = readyTwoPlayerMatch(47);
  state.currentPlayer = 1;
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 1 };
  state.deploymentsThisTurn = 0;
  state.decks.research.exhausted = true;
  const casual = chooseBotCommand(state, new Set([1]), "casual");
  const tactical = chooseBotCommand(state, new Set([1]), "standard");
  const challenging = chooseBotCommand(state, new Set([1]), "challenging");
  assert.ok(casual && tactical && challenging, "all profiles should provide a legal action");
  assert.notDeepEqual(casual, tactical, "Casual should leave the highest-scored deployment to Tactical");
  assert.deepEqual(tactical, challenging, "deployment scoring alone should not imply an unmeasured Tactical/Challenging difference");
  assert.notEqual(applyCommand(state, casual).state, state, "Casual's choice should be accepted by the canonical engine");
  assert.notEqual(applyCommand(state, challenging).state, state, "Challenging's choice should be accepted by the canonical engine");
});

test("bot does not use Stabilizer Ray in a battle without its own units", () => {
  const state = createGame(2, 347);
  const battleLocation = state.monsters[1]!.location;
  const enemyUnits = state.units.filter((unit) => unit.ownerPlayer === 0).slice(0, 2);
  for (const unit of enemyUnits) unit.location = battleLocation;
  state.currentPlayer = 1;
  state.phase = "fight";
  state.players[1]!.researchCardIds = ["Stabilizer Ray"];
  state.players[1]!.mutationCardIds = ["Rampage"];
  const battleId = "stabilizer-ray-opposing-units-only";
  state.pendingBattles = [{ id: battleId, monsterId: state.monsters[1]!.id, location: battleLocation as `${number},${number}`, militaryUnitIds: enemyUnits.map((unit) => unit.id) }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 1, battleId };

  assert.deepEqual(chooseBotCommand(state, new Set([1]), "tactical"), { type: "resolve-fight", battleId });
});

test("challenging bots save and spend sourced Challenge mutations more effectively", () => {
  const state = createGame(2, 73);
  const attacker = state.monsters[0]!;
  const opponent = state.monsters[1]!;
  attacker.name = "Konk";
  attacker.health = attacker.maxHealth - 1;
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: attacker.id, opponentMonsterId: opponent.id };
  state.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: attacker.id,
    opponentMonsterId: opponent.id,
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
    turn: { attackerId: attacker.id, firstAttackerId: attacker.id, round: 1, remainingAttacks: attacker.attacks, attacks: [] },
  };
  state.players[0]!.mutationCardIds = ["Son of a Monster", "Berserk"];

  assert.deepEqual(chooseBotCommand(state, new Set([0]), "casual"), { type: "resolve-challenge" }, "Casual should preserve the simpler default attack sequence");
  assert.deepEqual(chooseBotCommand(state, new Set([0]), "challenging"), { type: "use-mutation", cardId: "Son of a Monster" }, "Challenging should take the sourced heal and extra attacks first");
  const healed = applyCommand(state, { type: "use-mutation", cardId: "Son of a Monster" }).state;
  assert.deepEqual(chooseBotCommand(healed, new Set([0]), "challenging"), { type: "use-mutation", cardId: "Berserk" }, "Challenging should use Berserk for its five sourced extra attacks");
});

test("Casual bots choose a less vulnerable Challenge opponent than Tactical and Challenging", () => {
  const state = createGame(3, 89);
  state.monsters[1]!.health = 4;
  state.monsters[2]!.health = 17;
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = {
    type: "challenge-opponent",
    playerIndex: 0,
    challengerMonsterId: state.monsters[0]!.id,
    opponentIds: [state.monsters[1]!.id, state.monsters[2]!.id],
  };

  assert.deepEqual(chooseBotCommand(state, new Set([0]), "casual"), {
    type: "challenge-opponent",
    opponentMonsterId: state.monsters[2]!.id,
  });
  assert.deepEqual(chooseBotCommand(state, new Set([0]), "standard"), {
    type: "challenge-opponent",
    opponentMonsterId: state.monsters[1]!.id,
  });
  assert.deepEqual(chooseBotCommand(state, new Set([0]), "challenging"), {
    type: "challenge-opponent",
    opponentMonsterId: state.monsters[1]!.id,
  });
});

test("bot only arms Antimatter when its own military unit is in the pending battle", () => {
  const state = createGame(2, 0);
  const monster = state.monsters[state.currentPlayer]!;
  const opposingUnits = state.units.filter((unit) => unit.ownerPlayer !== state.currentPlayer).slice(0, 2);
  assert.equal(opposingUnits.length, 2);
  for (const unit of opposingUnits) unit.location = monster.location;
  monster.health = 4;
  state.players[state.currentPlayer]!.researchCardIds = ["Antimatter"];
  const battleId = "opponent-force-only";
  state.phase = "fight";
  state.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location, militaryUnitIds: opposingUnits.map((unit) => unit.id) }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: state.currentPlayer, battleId };

  assert.deepEqual(chooseBotCommand(state, new Set([state.currentPlayer])), { type: "resolve-fight", battleId });
});
