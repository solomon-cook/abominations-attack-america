import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createGame, migrateGameState, projectState } from "./index.js";

function duel(players = 3) {
  const game = createGame(players, 0);
  game.phase = "challenge";
  game.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: [] };
  game.monsters.forEach(monster => { monster.health = 20; monster.attacks = 1; monster.defense = 1; monster.damage = 2; monster.infamy = 2; });
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  return applyCommand(game, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
}

test("Challenge rolls once, offers repeat Infamy attacks, and passes without rolling", () => {
  const selected = duel();
  assert.throws(() => applyCommand(selected, { type: "resolve-challenge", endTurn: true }), /remaining attacks/);
  assert.throws(() => applyCommand(selected, { type: "resolve-challenge", spendInfamy: true }), /cannot spend/);
  const first = applyCommand(selected, { type: "resolve-challenge" });
  assert.equal(first.eventType, "challenge.attack.rolled");
  assert.equal(first.state.rng.cursor, selected.rng.cursor + 1);
  assert.equal(first.state.monsters[0].health, 20);
  assert.equal(first.state.currentPlayer, 0);
  assert.equal(first.state.challenge?.turn?.remainingAttacks, 0);
  assert.throws(() => applyCommand(first.state, { type: "resolve-challenge" }), /Spend 1 Infamy/);
  const extra = applyCommand(first.state, { type: "resolve-challenge", spendInfamy: true });
  const secondExtra = applyCommand(extra.state, { type: "resolve-challenge", spendInfamy: true });
  assert.equal(secondExtra.state.monsters[0].infamy, 0);
  assert.equal(secondExtra.state.rng.cursor, selected.rng.cursor + 3);
  assert.equal(secondExtra.state.challenge?.turn?.remainingAttacks, 0);
  assert.throws(() => applyCommand(secondExtra.state, { type: "resolve-challenge", spendInfamy: true }), /cannot spend/);
  const passed = applyCommand(secondExtra.state, { type: "resolve-challenge", endTurn: true });
  assert.equal(passed.state.rng.cursor, secondExtra.state.rng.cursor);
  assert.equal(passed.state.currentPlayer, 1);
  assert.equal(passed.state.pendingDecision?.playerIndex, 1);
  assert.equal(passed.state.challenge?.turn?.round, 1);
  const response = applyCommand(passed.state, { type: "resolve-challenge" });
  assert.equal(response.state.monsters[0].health < 20, true);
  const roundTwo = applyCommand(response.state, { type: "resolve-challenge", endTurn: true });
  assert.equal(roundTwo.state.challenge?.turn?.round, 2);
  assert.equal(roundTwo.state.currentPlayer, 0);
  assert.equal(selected.monsters[1].health, 20, "Input state must remain immutable");
});

test("Challenge survives persistence between rolls and preserves the next decision owner", () => {
  const first = applyCommand(duel(), { type: "resolve-challenge" }).state;
  const reloaded = migrateGameState(JSON.parse(JSON.stringify(first)));
  assert.equal(JSON.stringify(applyCommand(reloaded, { type: "resolve-challenge", spendInfamy: true })), JSON.stringify(applyCommand(first, { type: "resolve-challenge", spendInfamy: true })));
  const passed = applyCommand(first, { type: "resolve-challenge", endTurn: true }).state;
  assert.equal(passed.pendingDecision?.playerIndex, 1);
});

test("a knockout restores weigh-in Health once and requires selecting the next monster", () => {
  const selected = duel();
  selected.monsters[0].health = 39;
  selected.monsters[0].damage = 99;
  const result = applyCommand(selected, { type: "resolve-challenge" });
  assert.equal(result.eventType, "challenge.resolved");
  assert.equal(result.state.monsters[0].health, 40);
  assert.equal(result.state.monsters[1].location, "defeated");
  assert.equal(result.state.challenge?.turn, undefined);
  assert.equal(result.state.pendingDecision?.type, "challenge-opponent");
  assert.equal(result.eventPayload.loserWeighIn, 20);
  assert.deepEqual(result.eventPayload.healthBeforeAttack, { "monster-1": 39, "monster-2": 20 });
  assert.throws(() => applyCommand(result.state, { type: "resolve-challenge" }), /pending decision/);
  const next = applyCommand(result.state, { type: "challenge-opponent", opponentMonsterId: "monster-3" }).state;
  assert.equal(next.challenge?.turn?.attacks.length, 0);
  assert.equal(next.challenge?.weighInHealth["monster-1"], 40);
});

test("Challenge mutation attacks stay in the owning player's turn and remain visible online", () => {
  const game = duel();
  game.challenge = { ...game.challenge!, opponentMonsterId: undefined, turn: undefined };
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  game.players[1].mutationCardIds = ["High-Octane Blood", "Atomic Breath", "War Spikes"];
  const selected = applyCommand(game, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
  assert.equal(selected.currentPlayer, 1);
  assert.equal(selected.challenge?.turn?.remainingAttacks, 2);
  const first = applyCommand(selected, { type: "resolve-challenge" });
  assert.equal(first.state.challenge?.turn?.remainingAttacks, 1);
  assert.equal((first.eventPayload.attacks as { damage: number }[])[0].damage >= 4, true);
  assert.throws(() => applyCommand(first.state, { type: "resolve-challenge", endTurn: true }), /remaining attacks/);
  const view = projectState(selected, "player", 0);
  assert.deepEqual(view.players[1].visibleMutationCardIds, game.players[1].mutationCardIds);
  assert.deepEqual(view.players[1].researchCardIds, []);
});
