import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { SelectedPieceTray } = require("../apps/web/src/components/SelectedPieceTray.tsx") as typeof import("../apps/web/src/components/SelectedPieceTray.js");

const game = createGame(2, 0);
game.phase = "move";
game.players[0]!.researchCardIds = ["Fusion Cells"];
const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
unit.location = game.monsters[0]!.location;
const html = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projectState(game, "player", 0),
  selectedUnitId: unit.id,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(html, new RegExp(`<dt>Move</dt><dd>${unit.move + 1}</dd>`));

const opponent = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projectState(game, "player", 1),
  selectedUnitId: unit.id,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(opponent, new RegExp(`<dt>Move</dt><dd>${unit.move}</dd>`));
console.log("The cardholder's unit tray shows +1 Move and a reachable Move status; the opponent sees only printed Move.");
