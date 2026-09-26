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
game.players[0]!.mutationCardIds = ["Rampage", "War Spikes"];
game.players[1]!.researchCardIds = ["Anti-Mutagen"];
game.monsters[0]!.health = 10;
game.monsters[0]!.attacks = 0;
const unit = game.units.find((candidate) => candidate.ownerPlayer === 1)!;
unit.location = game.monsters[0]!.location;
unit.attacks = 0;
const battleId = "anti-mutagen-ui";
game.pendingBattles = [{ id: battleId, monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

const resolved = applyCommand(game, { type: "resolve-fight", battleId }).state;
assert.equal(resolved.monsters[0]!.health, 8);
const holderView = projectState(resolved, "player", 1);
const hand = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
  game: holderView,
  playerIndex: 1,
  canAct: false,
  runCommand: () => undefined,
}));
assert.match(hand, /Anti-Mutagen/);
assert.match(hand, /At the start of any battle involving your units, the monster loses 1 Health for each Mutation card it has/);
const health = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projectState(resolved, "player", 1),
  selectedUnitId: null,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(health, /HEALTH <b>8/);
console.log("Anti-Mutagen stays visible as a passive card and the selected monster's real Health display shows its two-Mutation damage.");
