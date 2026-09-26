import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame } from "../packages/game-engine/src/index.js";
import { MovementChecklist } from "../apps/web/src/components/MovementChecklist.js";

const game = createGame(2);
game.phase = "move";
const location = game.monsters[0]!.location;
game.units = game.units.slice(0, 3).map((unit, index) => ({ ...unit, id: `queue-unit-${index + 1}`, ownerPlayer: 0, location }));
const [ready, , completed] = game.units;
game.movedPieceIds = [game.monsters[0]!.id, completed!.id];

const html = renderToStaticMarkup(<MovementChecklist
  game={game}
  canAct
  selectedUnitId={ready!.id}
  movableUnitIds={new Set([ready!.id])}
  monsterCanMove={false}
  onSelect={() => undefined}
  onEnd={() => undefined}
/>);

assert.match(html, /Orders/);
assert.match(html, /1 remaining/);
assert.equal((html.match(/class="movement-piece /g) ?? []).length, 4, "monster and all three deployed pieces appear in a larger queue");
assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, "the selected movable portrait is announced as selected");
assert.match(html, /movement-piece[^\"]*completed[^\"]*[^>]*>[\s\S]*?Done/);
assert.match(html, /Held/);
assert.match(html, /End movement →/);
console.log("PASS: portrait queue shows selected, held, and completed pieces, counts only remaining orders, and retains the end-movement action for a larger roster.");
