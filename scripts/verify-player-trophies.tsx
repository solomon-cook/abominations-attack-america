import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame } from "../packages/game-engine/src/index.js";
import { PlayerStatusControls } from "../apps/web/src/components/PlayerStatusControls.js";
import { branchDeploymentCounts, branchForPlayer, trophyUnitsForPlayer } from "../apps/web/src/player-visuals.js";

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

const trayBranch = branchForPlayer(game, 1);
const trayPieces = game.units.filter(unit => unit.branch === trayBranch && !game.removedUnitIds.includes(unit.id)).slice(0, 2);
assert.equal(trayPieces.length, 2, "fixture should have two non-removed pieces on the current player's branch");
for (const unit of game.units.filter(unit => unit.branch === trayBranch)) unit.ownerPlayer = 0;
const otherBranchPiece = game.units.find(unit => unit.branch !== trayBranch && !game.removedUnitIds.includes(unit.id));
assert.ok(otherBranchPiece, "fixture has a non-branch unit to catch cross-branch record counts");
otherBranchPiece.ownerPlayer = 1;
otherBranchPiece.location = game.monsters[1]!.location;
const [deployed, reserved] = trayPieces;
deployed!.ownerPlayer = 1;
deployed!.location = game.monsters[1]!.location;
reserved!.ownerPlayer = 1;
reserved!.location = "record-tile";
const renderStatusMarkup = () => renderToStaticMarkup(createElement(PlayerStatusControls, {
  game,
  monster: game.monsters[1]!,
  branch: trayBranch,
  playerIndex: 1,
  canAct: false,
  mobileCommandExpanded: false,
  runCommand: () => undefined,
  onDeploy: () => undefined,
}));
const renderTrayLabel = () => renderStatusMarkup().match(/aria-label="(Open [^"]+ military sheet, [^"]+)"/)?.[1];
const renderCounts = () => [...renderStatusMarkup().matchAll(/(\d+ deployed · \d+ reserve)/g)].map(([, counts]) => counts);
assert.equal(renderTrayLabel(), `Open ${trayBranch} military sheet, 1 deployed, 1 in reserve`);
assert.deepEqual(branchDeploymentCounts(game, 1, trayBranch), { deployed: 1, reserve: 1 }, "branch counters should ignore the player's extra owned unit on another branch");
assert.deepEqual(renderCounts(), ["1 deployed · 1 reserve"], "the tray should render its branch-scoped counts");
deployed!.location = "record-tile"; // Ordinary destruction returns a unit to the reserve.
assert.equal(renderTrayLabel(), `Open ${trayBranch} military sheet, 0 deployed, 2 in reserve`);
assert.deepEqual(branchDeploymentCounts(game, 1, trayBranch), { deployed: 0, reserve: 2 }, "branch counters update when a piece returns to reserve");
assert.deepEqual(renderCounts(), ["0 deployed · 2 reserve"], "tray counts update when a branch piece returns to reserve");
reserved!.location = "permanently-removed";
game.removedUnitIds.push(reserved!.id);
assert.equal(renderTrayLabel(), `Open ${trayBranch} military sheet, 0 deployed, 1 in reserve`);
assert.deepEqual(branchDeploymentCounts(game, 1, trayBranch), { deployed: 0, reserve: 1 }, "branch counters exclude a permanently removed unit");
assert.deepEqual(renderCounts(), ["0 deployed · 1 reserve"], "tray counts exclude a permanently removed unit");

console.log("Player trophy attribution and deployment-tray counts render correctly, including reserve return and permanent removal.");
