import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, legalMonsterPaths, projectState } from "../packages/game-engine/src/index.js";
import { MovementChecklist } from "../apps/web/src/components/MovementChecklist.js";

const game = createGame(2);
game.phase = "move";
game.encounterSuppressed = true;
game.movedPieceIds = [];
game.players[0]!.mutationCardIds = ["Rampage"];
const monster = game.monsters[0]!;
const paths = legalMonsterPaths(game, monster.id);
assert.ok(paths.length > 0, "the returned monster should have legal movement destinations");

const renderChecklist = (state: typeof game, canMove: boolean) => renderToStaticMarkup(React.createElement(MovementChecklist, {
  game: projectState(state, "player", 0),
  canAct: true,
  selectedUnitId: null,
  movableUnitIds: new Set<string>(),
  monsterCanMove: canMove,
  onSelect: () => undefined,
  onEnd: () => undefined,
}));
const html = renderChecklist(game, paths.length > 0);
const monsterButton = html.match(/<button[^>]*>[\s\S]*?<strong>[^<]*<\/strong>[\s\S]*?<\/button>/)?.[0];
assert.ok(monsterButton?.includes(monster.name), "the monster should appear in the movement checklist");
assert.ok(!monsterButton?.includes("disabled"), "Rampage should leave the returning monster's move control enabled");
assert.match(monsterButton ?? "", /<span class="movement-piece-status">Move<\/span>/);

const ordinaryReturn = structuredClone(game);
ordinaryReturn.players[0]!.mutationCardIds = [];
ordinaryReturn.movedPieceIds = [monster.id];
const ordinaryHtml = renderChecklist(ordinaryReturn, false);
const ordinaryMonsterButton = ordinaryHtml.match(/<button[^>]*>[\s\S]*?<strong>[^<]*<\/strong>[\s\S]*?<\/button>/)?.[0];
assert.ok(ordinaryMonsterButton?.includes("disabled"), "a normal returning monster should have no move control");
assert.match(ordinaryMonsterButton ?? "", /<span class="movement-piece-status">Done<\/span>/);
console.log("Rampage enables the returning monster's Move control and ordinary lair returns remain spent.");
