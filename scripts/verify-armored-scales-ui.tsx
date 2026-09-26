import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { SelectedPieceTray } = require("../apps/web/src/components/SelectedPieceTray.tsx") as typeof import("../apps/web/src/components/SelectedPieceTray.js");

const game = createGame(2, 0);
game.players[0]!.mutationCardIds = ["Armored Scales"];
const projected = projectState(game, "player", 0);
const html = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projected,
  selectedUnitId: null,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(html, new RegExp(`<dt>Move</dt><dd>${game.monsters[0]!.move - 1}</dd>`));
assert.match(html, new RegExp(`<dt>Defense</dt><dd>${game.monsters[0]!.defense + 1}</dd>`));
console.log("Armored Scales' selected-monster tray shows the effective -1 Move and +1 Defense.");
