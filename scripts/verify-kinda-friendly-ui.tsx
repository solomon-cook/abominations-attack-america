import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, legalMonsterPaths, projectState } from "../packages/game-engine/src/index.js";
import { MovementChecklist } from "../apps/web/src/components/MovementChecklist.js";
import { locationIdToHexKey } from "../packages/game-engine/src/board.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { HexGrid: HexGridWithCss } = require("../apps/web/src/components/HexGrid.tsx") as typeof import("../apps/web/src/components/HexGrid.js");

const game = createGame(2);
game.phase = "move";
game.players[0]!.mutationCardIds = ["Kinda Friendly"];
game.monsters[1]!.location = "record-tile";
game.units.forEach((unit) => { unit.location = "record-tile"; });
const denver = locationIdToHexKey("denver")!;
const chicago = locationIdToHexKey("chicago")!;
game.units.push({ id: "national-guard-ui", branch: "National Guard", unitTypeId: "national-guard-tank", move: 3, movement: "land-only", attacks: 1, damage: 1, health: 1, defense: 4, location: denver });
const route = [locationIdToHexKey("los-angeles")!, denver, chicago];
const paths = legalMonsterPaths(game, "monster-1");
assert.ok(paths.some((path) => path.join(">") === route.join(">")));

const renderGrid = (state: typeof game) => {
  const destinations = new Set(legalMonsterPaths(state, "monster-1").map((path) => path.at(-1)!));
  return renderToStaticMarkup(React.createElement(HexGridWithCss, {
    retreatDestinations: new Set(), onRetreat: () => undefined,
    deploymentDestinations: new Set(), onDeploy: () => undefined,
    onSelectMonster: () => undefined, game: projectState(state, "player", 0), activePlayerId: "monster-1", canAct: true,
    legalDestinations: destinations, legalUnitDestinations: new Set(), selectableUnitIds: new Set(), selectedUnitId: null,
    selectedPath: [], hoveredPath: [], selectedUnitPath: [], acceptedPath: [], onSelectUnit: () => undefined,
    onFocusHex: () => undefined, onSelectStack: () => undefined, onChoosePath: () => undefined,
    onChooseUnitPath: () => undefined, onPreviewPath: () => undefined, onClearPreview: () => undefined,
  }));
};
const gridHtml = renderGrid(game);
const destinationTile = gridHtml.match(new RegExp(`<button[^>]*data-hex-key="${chicago}"[^>]*>`))?.[0];
assert.match(destinationTile ?? "", /class="hex-tile [^"]*legal[^"]*"/);

const controls = renderToStaticMarkup(React.createElement(MovementChecklist, {
  game: projectState(game, "player", 0), canAct: true, selectedUnitId: null,
  movableUnitIds: new Set<string>(), monsterCanMove: paths.length > 0,
  onSelect: () => undefined, onEnd: () => undefined,
}));
const monsterControl = controls.match(/<button[^>]*>[\s\S]*?<strong>[^<]*<\/strong>[\s\S]*?<\/button>/)?.[0];
assert.ok(monsterControl && !monsterControl.includes("disabled"));

game.players[0]!.mutationCardIds = [];
const normalTile = renderGrid(game).match(new RegExp(`<button[^>]*data-hex-key="${chicago}"[^>]*>`))?.[0];
assert.match(normalTile ?? "", /unreachable/);
console.log("Kinda Friendly keeps the monster move selectable through a Guard-only space and highlights the destination; without the card it is unreachable.");
