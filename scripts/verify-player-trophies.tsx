import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame } from "../packages/game-engine/src/index.js";
import { PlayerStatusControls } from "../apps/web/src/components/PlayerStatusControls.js";
import { branchForPlayer, trophyUnitsForPlayer } from "../apps/web/src/player-visuals.js";

const game = createGame(2);
const [firstTrophy, secondTrophy, destroyedUnit] = game.units;
assert.ok(firstTrophy && secondTrophy && destroyedUnit, "fixture has military units to track");
firstTrophy.location = "permanently-removed";
secondTrophy.location = "permanently-removed";
destroyedUnit.location = "record-tile";
game.removedUnitIds = [firstTrophy.id, secondTrophy.id];
game.eventLog = [
  { id: "1:0", action: "trophy.choice-required", outcome: "required", detail: { playerIndex: 1 } },
  { id: "1:1", action: "trophy.chosen", outcome: "chosen", detail: { unitId: firstTrophy.id, takerPlayerIndex: 1 } },
  // Older saved matches have no taker field on trophy.chosen; the preceding
  // choice-required event identifies the monster whose encounter earned it.
  { id: "2:2", action: "trophy.choice-required", outcome: "required", detail: { playerIndex: 1 } },
  { id: "2:3", action: "trophy.chosen", outcome: "chosen", detail: { unitId: secondTrophy.id } },
  { id: "2:4", action: "unit.destroyed", outcome: "destroyed", detail: { unitId: destroyedUnit.id } },
];

assert.deepEqual(trophyUnitsForPlayer(game, 0), []);
assert.deepEqual(trophyUnitsForPlayer(game, 1).map(({ id }) => id), [firstTrophy.id, secondTrophy.id]);

const html = renderToStaticMarkup(createElement(PlayerStatusControls, {
  game,
  monster: game.monsters[1]!,
  branch: branchForPlayer(game, 1),
  playerIndex: 1,
  canAct: false,
  mobileCommandExpanded: false,
  runCommand: () => undefined,
  onDeploy: () => undefined,
}));
assert.match(html, /class="opponent-trophy-badge"/);
assert.match(html, /×2/);
assert.match(html, /2 trophy units/);

console.log("Player trophy units stay attributed to their captor and render as a compact, labeled medal badge.");
