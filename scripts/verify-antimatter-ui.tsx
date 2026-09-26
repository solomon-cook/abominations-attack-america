import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState, type BattleAttack, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { PhaseActions } = require("../apps/web/src/components/PhaseActions.tsx") as typeof import("../apps/web/src/components/PhaseActions.js");
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");

function makeBattle(): GameState {
  const game = createGame(2, 4);
  game.players[0]!.researchCardIds = ["Antimatter"];
  game.phase = "fight";
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[0]!.location;
  const battleId = "antimatter-ui";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  return game;
}

function render(game: GameState): string {
  const projected = projectState(game, "player", 0);
  return renderToStaticMarkup(React.createElement(PhaseActions, {
    activeGame: projected,
    onOpenMilitarySheet: () => undefined,
    canAct: true,
    runCommand: () => undefined,
    getLocationName: (key: string) => key,
    pendingAttackPrompt: "Choose a target",
    pendingBattle: projected.pendingBattles[0],
    pendingBattleDecision: projected.pendingDecision?.type === "battle-resolution" ? projected.pendingDecision : undefined,
    canSpendInfamyOnPendingBattle: false,
    retreatChoices: {},
    setRetreatChoices: () => undefined,
  }));
}

const eligible = render(makeBattle());
assert.match(eligible, /Use Antimatter · double first-round damage/);
assert.doesNotMatch(eligible, /<button[^>]*disabled=""[^>]*>Use Antimatter/);

const unrelatedBattle = makeBattle();
unrelatedBattle.units.find((unit) => unit.id === unrelatedBattle.pendingBattles[0]!.militaryUnitIds[0])!.ownerPlayer = 1;
const ineligible = render(unrelatedBattle);
assert.match(ineligible, /<button disabled=""[^>]*>Use Antimatter/);

const roll = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack: {
    combatRound: 1,
    attackerId: "army-unit",
    targetId: "monster-1",
    roll: 5,
    targetDefense: 4,
    rollModifier: 0,
    hit: true,
    smash: false,
    damage: 2,
    destroyed: false,
    modifiers: ["Antimatter: double first-round damage"],
    antimatterMutationRoll: 3,
  } as BattleAttack,
  attackerName: "Army",
  targetName: "Zorb",
  settled: true,
}));
assert.match(roll, /2 damage to Zorb/);
assert.match(roll, /Antimatter mutation check: 3/);
assert.match(roll, /Antimatter: double first-round damage/);

console.log("Antimatter is enabled at the cardholder's battle start, disabled without an owned unit, and its doubled damage and mutation check are visible in the settled roll.");
