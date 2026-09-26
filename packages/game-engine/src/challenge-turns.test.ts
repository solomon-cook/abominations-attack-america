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

test("Berserk and Son of a Monster can be used during either participant's Challenge battle", () => {
  const selected = duel();
  selected.players[0]!.mutationCardIds = ["Berserk"];
  selected.players[1]!.mutationCardIds = ["Son of a Monster"];
  const attackerUse = applyCommand(selected, { type: "use-mutation", cardId: "Berserk" });
  assert.equal(attackerUse.state.challenge?.turn?.remainingAttacks, (selected.challenge?.turn?.remainingAttacks ?? 0) + 5);
  assert.ok(attackerUse.state.decks.mutation.discard.includes("Berserk"));

  const defenderUse = applyCommand(attackerUse.state, { type: "use-mutation", cardId: "Son of a Monster" });
  assert.equal(defenderUse.state.challenge?.turn?.bonusAttacksByMonster?.["monster-2"], 2);
  assert.ok(defenderUse.state.decks.mutation.discard.includes("Son of a Monster"));
  assert.ok((defenderUse.eventPayload.healthRoll as number) >= 1);
  assert.equal(defenderUse.state.monsters[1]!.health, 20 + (defenderUse.eventPayload.healthRoll as number));

  const passed = structuredClone(defenderUse.state);
  passed.challenge!.turn = { ...passed.challenge!.turn!, remainingAttacks: 0 };
  const next = applyCommand(passed, { type: "resolve-challenge", endTurn: true });
  assert.equal(next.state.challenge?.turn?.attackerId, "monster-2");
  assert.equal(next.state.challenge?.turn?.remainingAttacks, 1 + 2);
  assert.equal(next.state.currentPlayer, 1);

  const capped = duel();
  capped.players[1]!.mutationCardIds = ["Son of a Monster"];
  capped.monsters[1]!.health = capped.monsters[1]!.maxHealth;
  const cappedHeal = applyCommand(capped, { type: "use-mutation", cardId: "Son of a Monster" });
  assert.equal(cappedHeal.state.monsters[1]!.health, capped.monsters[1]!.maxHealth);
  assert.ok((cappedHeal.eventPayload.healthRoll as number) >= 1);

  const outsider = structuredClone(selected);
  outsider.players[0]!.mutationCardIds = [];
  outsider.players[2]!.mutationCardIds = ["Berserk"];
  assert.throws(() => applyCommand(outsider, { type: "use-mutation", cardId: "Berserk" }), /participating in an active Challenge battle/);
});

test("War Spikes replaces Challenge hit damage with four before the natural-six smash bonus", () => {
  let ordinaryHit: { damage: number; smash: boolean } | undefined;
  let smashHit: { damage: number; smash: boolean } | undefined;
  for (let seed = 0; seed < 128 && (!ordinaryHit || !smashHit); seed += 1) {
    const selected = duel(2);
    selected.players[0]!.mutationCardIds = ["War Spikes"];
    selected.rng.seed = seed;
    const result = applyCommand(selected, { type: "resolve-challenge" });
    const attack = (result.eventPayload.attacks as Array<{ damage: number; hit: boolean; smash: boolean }>).find((entry) => entry.hit);
    if (attack?.smash) smashHit = attack;
    else if (attack) ordinaryHit = attack;
  }
  assert.equal(ordinaryHit?.damage, 4);
  assert.equal(ordinaryHit?.smash, false);
  assert.equal(smashHit?.damage, 5);
  assert.equal(smashHit?.smash, true);
});

test("Atomic Breath adds one Challenge attack in round one of every duel only", () => {
  const game = createGame(2, 0);
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.players[0]!.mutationCardIds = ["Atomic Breath"];
  game.monsters.forEach((monster) => { monster.health = 40; monster.attacks = 1; monster.defense = 99; monster.damage = 1; });
  game.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  const selected = applyCommand(game, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
  assert.equal(selected.challenge?.turn?.round, 1);
  assert.equal(selected.challenge?.turn?.remainingAttacks, 2);

  let state = selected;
  while (state.challenge?.turn?.remainingAttacks) state = applyCommand(state, { type: "resolve-challenge" }).state;
  state = applyCommand(state, { type: "resolve-challenge", endTurn: true }).state;
  while (state.challenge?.turn?.remainingAttacks) state = applyCommand(state, { type: "resolve-challenge" }).state;
  state = applyCommand(state, { type: "resolve-challenge", endTurn: true }).state;
  assert.equal(state.challenge?.turn?.attackerId, "monster-1");
  assert.equal(state.challenge?.turn?.round, 2);
  assert.equal(state.challenge?.turn?.remainingAttacks, 1);
  assert.equal(state.players[0]!.mutationCardIds.includes("Atomic Breath"), true);
});

test("Whip Tentacles immediately grants a Challenge attack after a natural six, even on a miss", () => {
  let first: ReturnType<typeof applyCommand> | undefined;
  let second: ReturnType<typeof applyCommand> | undefined;
  for (let seed = 0; seed < 256 && !first; seed += 1) {
    const selected = duel(2);
    selected.players[0]!.mutationCardIds = ["Whip Tentacles"];
    selected.monsters[0]!.defense = 99;
    selected.monsters[1]!.defense = 99;
    selected.rng.seed = seed;
    const opening = applyCommand(selected, { type: "resolve-challenge" });
    if (opening.eventPayload.rolls?.[0] !== 6) continue;
    const followup = applyCommand(opening.state, { type: "resolve-challenge" });
    if (followup.eventPayload.rolls?.[0] !== 6) {
      first = opening;
      second = followup;
    }
  }
  assert.ok(first && second, "a deterministic duel sequence should roll six then a non-six");
  assert.equal(first.eventType, "challenge.attack.rolled");
  const attack = (first.eventPayload.attacks as Array<{ roll: number; hit: boolean; smash: boolean; modifiers: string[] }>)[0]!;
  assert.equal(attack.roll, 6);
  assert.equal(attack.hit, false, "high Defense makes this six miss, but does not cancel the extra attack");
  assert.equal(attack.smash, false);
  assert.ok(attack.modifiers.includes("Whip Tentacles: extra attack after 6"));
  assert.equal(first.state.challenge?.turn?.remainingAttacks, 1);
  assert.equal(second.state.challenge?.turn?.remainingAttacks, 0, "the immediate bonus attack consumes the one granted attack");
  assert.equal(second.state.currentPlayer, 0);
  const passed = applyCommand(second.state, { type: "resolve-challenge", endTurn: true });
  assert.equal(passed.state.challenge?.turn?.attackerId, "monster-2");
  assert.equal(passed.state.challenge?.turn?.remainingAttacks, 1, "the card grants nothing to the opposing monster");
  assert.deepEqual(passed.state.players[0]!.mutationCardIds, ["Whip Tentacles"]);
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
