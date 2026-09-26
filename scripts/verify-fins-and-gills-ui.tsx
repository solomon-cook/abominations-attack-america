import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";
import { AUDITED_BOARD } from "../packages/game-engine/src/audited-board.js";
import { SelectedPieceTray } from "../apps/web/src/components/SelectedPieceTray.js";

const game = createGame(2);
game.boardId = AUDITED_BOARD.id;
game.boardVersion = AUDITED_BOARD.version;
game.boardContentHash = AUDITED_BOARD.contentHash;
game.players[0]!.mutationCardIds = ["Fins and Gills"];
const edge = AUDITED_BOARD.edges.find((candidate) => candidate.enabled && candidate.barrier === "sea"
  && AUDITED_BOARD.hexes[candidate.from]?.waterClass === "seacoast" && AUDITED_BOARD.hexes[candidate.to]?.waterClass === "land");
assert.ok(edge);
game.monsters[0]!.location = edge.to;

const html = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projectState(game, "player", 0),
  selectedUnitId: null,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(html, /Defense<\/dt><dd>5<\/dd>/);
console.log("Selected monster tray shows Fins and Gills' effective Defense while the monster occupies a water-barrier space.");
