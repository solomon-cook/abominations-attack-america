import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, projectState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { RevealedCardsPanel } = require("../apps/web/src/components/RevealedCardsPanel.tsx") as typeof import("../apps/web/src/components/RevealedCardsPanel.js");
const { SelectedPieceTray } = require("../apps/web/src/components/SelectedPieceTray.tsx") as typeof import("../apps/web/src/components/SelectedPieceTray.js");

const game = createGame(2, 0);
game.currentPlayer = 0;
game.phase = "fight";
game.players[0]!.researchCardIds = ["Scientific Analysis"];
game.monsters[0]!.health = 10;
game.monsters[0]!.attacks = 0;
const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
unit.location = game.monsters[0]!.location;
unit.attacks = 0;
const battleId = "scientific-analysis-ui";
game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

const resolved = applyCommand(game, { type: "resolve-fight", battleId }).state;
assert.equal(resolved.monsters[0]!.health, 9);
const ownerView = projectState(resolved, "player", 0);
const hand = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
  game: ownerView,
  playerIndex: 0,
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(hand, /Scientific Analysis/);
assert.match(hand, /At the start of any battle involving your units, the monster loses 1 Health/);
const tray = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: ownerView,
  selectedUnitId: null,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(tray, /HEALTH <b>9/);
console.log("Scientific Analysis is visible as a passive card and its battle-start damage appears on the monster's Health display.");
