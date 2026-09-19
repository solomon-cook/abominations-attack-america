import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createGame, type BattleAttack, type GameState } from "./index.js";
import { attackResultLabel, healthAtAttack, healthLost, readBattleAttacks } from "../../../apps/web/src/components/combat-presentation.js";

function battleState(seed = 0, multiple = false) {
  const state = createGame(2, seed);
  const monster = state.monsters[0];
  monster.health = 40;
  const units = multiple ? [state.units[0], state.units[2]] : [state.units[0]];
  for (const unit of units) unit.location = monster.location;
  state.phase = "fight";
  state.pendingBattles = [{ id: "presentation", monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: units.map(unit => unit.id) }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "presentation" };
  return state;
}

function resolve(state: GameState) {
  return applyCommand(state, { type: "resolve-fight", battleId: "presentation" });
}

test("a normal unit is destroyed by a hit, not shown as losing monster damage in Health", () => {
  const state = battleState();
  state.units[0].defense = 1;
  const result = applyCommand(state, { type: "resolve-fight" });
  const attacks = readBattleAttacks(result.eventPayload.attacks);
  assert.equal(result.eventPayload.battleId, "presentation", "default-selected battle must retain its identity");
  assert.equal(attacks.length, 1, "destroyed unit cannot return fire");
  assert.equal(attacks[0].targetDefense, 1);
  assert.equal(attacks[0].combatRound, 1);
  assert.equal(attacks[0].targetHealthBefore, undefined);
  assert.equal(attackResultLabel(attacks[0]), "Destroyed");
  assert.ok(attacks[0].damage >= 3);
});

test("two rounds preserve order, defense and exact Health changes", () => {
  const state = battleState();
  state.units[0].defense = 99; // Keep the unit alive through both rounds.
  state.monsters[0].defense = 1;
  const attacks = readBattleAttacks(resolve(state).eventPayload.attacks);
  assert.deepEqual(attacks.map(attack => attack.combatRound), [1, 1, 1, 1, 2, 2, 2, 2]);
  const military = attacks.filter(attack => attack.attackerId === state.units[0].id);
  assert.equal(military.length, 2);
  assert.equal(military[0].targetHealthBefore, 40);
  assert.equal(military[0].targetHealthAfter, military[1].targetHealthBefore);
  for (const attack of attacks) {
    assert.equal(attack.hit, attack.roll + attack.rollModifier! >= attack.targetDefense!);
    if (attack.targetId === state.monsters[0].id) assert.equal(healthLost(attack), attack.damage);
  }
  assert.equal(healthAtAttack(state.monsters[0].id, attacks, 0, 0), 40, "future damage must not appear early");
  assert.equal(healthAtAttack(state.monsters[0].id, attacks, 3, 0), military[0].targetHealthAfter);
});

test("opening missile fire and natural-six smash carry authoritative context", () => {
  let foundSmash = false;
  for (let seed = 0; seed < 32; seed++) {
    const state = battleState(seed);
    const launcher = state.units.find(unit => unit.unitTypeId === "army-missile-launcher")!;
    launcher.location = state.monsters[0].location;
    launcher.defense = 99;
    state.pendingBattles[0].militaryUnitIds = [launcher.id];
    state.monsters[0].defense = 1;
    const attacks = readBattleAttacks(resolve(state).eventPayload.attacks);
    assert.equal(attacks[0].attackerId, launcher.id);
    assert.ok(attacks[0].modifiers.includes("extra first-round attack before monster"));
    assert.equal(attacks[0].combatRound, 1);
    const smash = attacks.find(attack => attack.smash && attack.attackerId === launcher.id);
    if (smash) {
      assert.equal(smash.roll, 6);
      assert.equal(smash.damage, launcher.damage + 1);
      foundSmash = true;
      break;
    }
  }
  assert.ok(foundSmash);
});

test("giant Health loss is capped and defeat is distinct from ordinary unit destruction", () => {
  const state = battleState();
  const giant = { ...state.units[0], id: "giant-preview", unitTypeId: "mecha-monster", health: 1, defense: 1 };
  state.units.push(giant);
  state.pendingBattles[0].militaryUnitIds = [giant.id];
  const attack = readBattleAttacks(resolve(state).eventPayload.attacks)[0];
  assert.equal(attack.targetHealthBefore, 1);
  assert.equal(attack.targetHealthAfter, 0);
  assert.equal(healthLost(attack), 1);
  assert.equal(attackResultLabel(attack), "Defeated");
  assert.ok(attack.damage > 1);
});

test("multi-target continuations retain cumulative attack identity and round snapshots", () => {
  const state = battleState(0, true);
  state.units[0].defense = 99;
  state.units[2].defense = 99;
  state.monsters[0].defense = 1;
  let result = resolve(state);
  let previous: BattleAttack[] = [];
  for (let guard = 0; result.state.pendingDecision?.type === "attack-target" && guard < 12; guard++) {
    const decision = result.state.pendingDecision;
    result = applyCommand(result.state, { type: "resolve-fight", battleId: decision.battleId, targetUnitId: decision.targetIds[0] });
    const attacks = readBattleAttacks(result.eventPayload.attacks);
    assert.deepEqual(attacks.slice(0, previous.length), previous);
    for (const attack of attacks) {
      assert.ok(attack.combatRound === 1 || attack.combatRound === 2);
      assert.equal(attack.hit, attack.roll + attack.rollModifier! >= attack.targetDefense!);
    }
    previous = attacks;
  }
  assert.equal(result.eventType, "fight.resolved");
  assert.ok(previous.some(attack => attack.combatRound === 2));
});

test("legacy logs remain readable without inventing missing Health or Defense", () => {
  assert.deepEqual(readBattleAttacks([null, {}, { roll: 9 }]), []);
  const legacy = { attackerId: "monster", targetId: "unit", controllerPlayer: 0, roll: 3, hit: false, smash: false, damage: 0, destroyed: false, modifiers: [] };
  assert.equal(readBattleAttacks([legacy]).length, 1);
  assert.equal(healthLost(legacy), undefined);
  assert.equal(attackResultLabel(legacy), "Miss");
  assert.equal(healthAtAttack("monster", [legacy], 0, 9), 9);
});
