import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";
import { sheetCardActions } from "../apps/web/src/components/SheetCards.js";
import { StabilizerRayControls } from "../apps/web/src/components/StabilizerRayControls.js";

const game = createGame(2);
game.currentPlayer = 0;
game.players[0]!.researchCardIds = ["Stabilizer Ray"];
game.players[1]!.mutationCardIds = ["Rampage", "Atomic Breath"];
const monster = game.monsters[1]!;
const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
unit.location = monster.location;
game.phase = "fight";
const battleId = "stabilizer-ray-ui";
game.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

const preBattle = projectState(game, "player", 0);
const cardAction = sheetCardActions(preBattle, "Stabilizer Ray");
assert.deepEqual(cardAction.map(({ label }) => label), ["Arm Stabilizer Ray"]);
assert.equal(cardAction[0]?.command.type, "use-research");
if (cardAction[0]?.command.type === "use-research") assert.equal(cardAction[0].command.mutationCardId, undefined);
const preBattleHtml = renderToStaticMarkup(React.createElement(StabilizerRayControls, {
  game: preBattle,
  battleId,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(preBattleHtml, /Play Stabilizer Ray/);
assert.doesNotMatch(preBattleHtml, /Rampage|Atomic Breath/);

const choice = structuredClone(game);
choice.players[0]!.researchCardIds = [];
choice.pendingBattles[0]!.stabilizerRayPlayerIndex = 0;
choice.pendingStabilizerRayChoice = {
  playerIndex: 0,
  monsterId: monster.id,
  battleId,
  cardIds: ["Rampage", "Atomic Breath"],
  resumePhase: "fight",
  resumeDecision: { type: "retreat", playerIndex: 0, battleId, unitIds: [monster.id] },
};
choice.pendingDecision = { type: "stabilizer-ray-choice", playerIndex: 0, monsterId: monster.id, battleId, cardIds: ["Rampage", "Atomic Breath"] };
const choiceProjection = projectState(choice, "player", 0);
const choiceHtml = renderToStaticMarkup(React.createElement(StabilizerRayControls, {
  game: choiceProjection,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(choiceHtml, /Military damage landed/);
assert.match(choiceHtml, /Discard Rampage/);
assert.match(choiceHtml, /Discard Atomic Breath/);
assert.doesNotMatch(choiceHtml, /disabled=""/);

const unavailable = structuredClone(choice);
unavailable.players[0]!.mutationCardIds = [];
unavailable.pendingStabilizerRayChoice!.cardIds = [];
unavailable.pendingDecision = { ...unavailable.pendingDecision!, type: "stabilizer-ray-choice", cardIds: [] };
const unavailableHtml = renderToStaticMarkup(React.createElement(StabilizerRayControls, {
  game: projectState(unavailable, "player", 0),
  canAct: false,
  runCommand: () => undefined,
}));
assert.match(unavailableHtml, /Military damage landed/);
assert.doesNotMatch(unavailableHtml, /Discard Rampage/);
console.log("Stabilizer Ray renders a pre-battle arm action and a post-damage Mutation choice from player projections.");
