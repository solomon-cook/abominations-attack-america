import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, projectState, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { RevealedCardsPanel } = require("../apps/web/src/components/RevealedCardsPanel.tsx") as typeof import("../apps/web/src/components/RevealedCardsPanel.js");
const { PhaseActions } = require("../apps/web/src/components/PhaseActions.tsx") as typeof import("../apps/web/src/components/PhaseActions.js");

function battleState(): GameState {
  const game = createGame(2, 0);
  game.players[0]!.researchCardIds = ["Defense Satellites"];
  game.phase = "fight";
  const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
  unit.location = game.monsters[0]!.location;
  const battleId = "defense-satellites-ui";
  game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  return game;
}

const game = battleState();
game.monsters.forEach((monster) => { monster.health = 30; });
const projected = projectState(game, "player", 0);
const hand = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
  game: projected,
  playerIndex: 0,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(hand, /Play Defense Satellites/);
assert.doesNotMatch(hand, /<button[^>]*disabled=""[^>]*>Play Defense Satellites/);
const battle = projected.pendingBattles[0]!;
const phaseActions = (value: GameState) => renderToStaticMarkup(React.createElement(PhaseActions, {
  activeGame: value,
  onOpenMilitarySheet: () => undefined,
  canAct: true,
  runCommand: () => undefined,
  getLocationName: (key: string) => key,
  pendingAttackPrompt: "Choose a target",
  pendingBattle: value.pendingBattles[0],
  pendingBattleDecision: value.pendingDecision?.type === "battle-resolution" ? value.pendingDecision : undefined,
  canSpendInfamyOnPendingBattle: false,
  retreatChoices: {},
  setRetreatChoices: () => undefined,
}));
assert.match(phaseActions(projected), /Use Defense Satellites · roll for each monster/);
assert.doesNotMatch(phaseActions(projected), /<button[^>]*disabled=""[^>]*>Use Defense Satellites/);
const resolved = applyCommand(game, { type: "use-research", cardId: "Defense Satellites" });
const resultHand = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
  game: projectState(resolved.state, "player", 0),
  playerIndex: 0,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(resultHand, /Defense Satellites resolved/);
for (const monsterId of resolved.eventPayload.damagedMonsterIds as string[]) {
  const monster = game.monsters.find((candidate) => candidate.id === monsterId)!;
  assert.match(resultHand, new RegExp(`${monster.name} · [1-6] damage`));
}

const rolling = structuredClone(game);
rolling.pendingAttackTarget = { battleId: battle.id, attackerId: "monster-1", targetIds: [game.pendingBattles[0]!.militaryUnitIds[0]!], round: 1, attackNumber: 1, attackTotal: 1, spendInfamy: 0 };
rolling.pendingDecision = { type: "attack-target", playerIndex: 0, battleId: battle.id, attackerId: "monster-1", targetIds: rolling.pendingAttackTarget.targetIds, round: 1, attackNumber: 1, attackTotal: 1 };
const duringAttack = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
  game: projectState(rolling, "player", 0),
  playerIndex: 0,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(duringAttack, /Play Defense Satellites/);
assert.match(duringAttack, /<button[^>]*disabled=""[^>]*>Play Defense Satellites/);
console.log("Defense Satellites is playable from the hand and Fight controls before a battle roll, reports each monster's damage, and is disabled once target resolution is underway.");
