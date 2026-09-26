import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, legalMonsterPaths, projectState } from "../packages/game-engine/src/index.js";
import { AUDITED_BOARD } from "../packages/game-engine/src/audited-board.js";
import { MovementChecklist } from "../apps/web/src/components/MovementChecklist.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { HexGrid } = require("../apps/web/src/components/HexGrid.tsx") as typeof import("../apps/web/src/components/HexGrid.js");

const game = createGame(2);
game.boardId = AUDITED_BOARD.id;
game.boardVersion = AUDITED_BOARD.version;
game.boardContentHash = AUDITED_BOARD.contentHash;
game.phase = "move";
const edge = AUDITED_BOARD.edges.find((candidate) => candidate.enabled && candidate.barrier === "sea"
  && AUDITED_BOARD.hexes[candidate.from]?.waterClass === "seacoast" && AUDITED_BOARD.hexes[candidate.to]?.waterClass === "sea");
assert.ok(edge);
game.monsters[0]!.location = edge.from;
game.monsters[1]!.location = "record-tile";
game.units.forEach((unit) => { unit.location = "record-tile"; });
game.players[0]!.mutationCardIds = ["Winged Horror"];
const path = legalMonsterPaths(game, game.monsters[0]!.id);
assert.ok(path.some((candidate) => candidate.join(">") === `${edge.from}>${edge.to}`));

const renderBoard = (state: typeof game) => {
  const destinations = new Set(legalMonsterPaths(state, state.monsters[0]!.id).map((candidate) => candidate.at(-1)!));
  return renderToStaticMarkup(React.createElement(HexGrid, {
    retreatDestinations: new Set(), onRetreat: () => undefined,
    deploymentDestinations: new Set(), onDeploy: () => undefined,
    onSelectMonster: () => undefined, game: projectState(state, "player", 0), activePlayerId: "monster-1", canAct: true,
    legalDestinations: destinations, legalUnitDestinations: new Set(), selectableUnitIds: new Set(), selectedUnitId: null,
    selectedPath: [], hoveredPath: [], selectedUnitPath: [], acceptedPath: [], onSelectUnit: () => undefined,
    onFocusHex: () => undefined, onSelectStack: () => undefined, onChoosePath: () => undefined,
    onChooseUnitPath: () => undefined, onPreviewPath: () => undefined, onClearPreview: () => undefined,
  }));
};
const gridHtml = renderBoard(game);
const targetHex = gridHtml.match(new RegExp(`<button[^>]*data-hex-key="${edge.to}"[^>]*>`))?.[0];
assert.match(targetHex ?? "", /class="hex-tile [^"]*legal[^"]*"/);
assert.match(targetHex ?? "", /legal destination/);

const checklistHtml = renderToStaticMarkup(React.createElement(MovementChecklist, {
  game: projectState(game, "player", 0), canAct: true, selectedUnitId: null,
  movableUnitIds: new Set<string>(), monsterCanMove: path.length > 0,
  onSelect: () => undefined, onEnd: () => undefined,
}));
const monsterControl = checklistHtml.match(/<button[^>]*>[\s\S]*?<strong>[^<]*<\/strong>[\s\S]*?<\/button>/)?.[0];
assert.ok(monsterControl?.includes("disabled") === false);

game.players[0]!.mutationCardIds = [];
const groundedHtml = renderBoard(game);
const groundedTarget = groundedHtml.match(new RegExp(`<button[^>]*data-hex-key="${edge.to}"[^>]*>`))?.[0];
assert.match(groundedTarget ?? "", /unreachable/);
console.log("Winged Horror's Move control is enabled and the sea destination is highlighted; removing it makes that destination unreachable.");
