import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, type HexKey } from "../packages/game-engine/src/index.js";
import { SelectedPieceTray } from "../apps/web/src/components/SelectedPieceTray.js";
import { PieceStackInspector } from "../apps/web/src/components/PieceStackInspector.js";

const game = createGame(2);
game.phase = "move";
const common = { game, selectedUnitPath: [], canLaunchSubmarine: false, choosingSubmarineTarget: false, onLaunchSubmarine: () => undefined, onClear: () => undefined };
const monster = renderToStaticMarkup(<SelectedPieceTray {...common} selectedUnitId={null} />);
assert.match(monster, /Selected piece details/);
assert.match(monster, /HEALTH/);
assert.match(monster, /INFAMY/);
assert.match(monster, /Special ability/);

const unit = game.units.find(candidate => candidate.ownerPlayer === game.currentPlayer)!;
assert.ok(unit, "the current player should have a military unit record");
const military = renderToStaticMarkup(<SelectedPieceTray {...common} selectedUnitId={unit.id} />);
assert.match(military, /unit-detail-heading/);
assert.match(military, /Move/);
assert.match(military, /Defense/);
assert.match(military, /Damage/);
assert.doesNotMatch(military, /INFAMY|record-health/);
assert.match(military, /Land only/);

const stackedGame = createGame(2);
const stackKey = stackedGame.units[0].location as HexKey;
const [ownMonster, enemyMonster] = stackedGame.monsters;
stackedGame.currentPlayer = 1;
ownMonster.location = stackKey;
enemyMonster.location = stackKey;
const ownUnits = stackedGame.units.filter(candidate => candidate.ownerPlayer === 0).slice(0, 3);
const opponentUnits = stackedGame.units.filter(candidate => candidate.ownerPlayer === 1).slice(0, 3);
for (const unit of [...ownUnits, ...opponentUnits]) unit.location = stackKey;
const ownUnit = ownUnits[0];
const opponentUnit = opponentUnits[0];
stackedGame.movedPieceIds = [ownUnit.id];
const stackMarkup = renderToStaticMarkup(<PieceStackInspector
  game={stackedGame}
  viewerPlayerIndex={0}
  selectedStackKey={stackKey}
  onSelect={() => undefined}
  onClear={() => undefined}
/ >);
assert.match(stackMarkup, /aria-label="Piece stack inspector"/);
assert.match(stackMarkup, /aria-live="polite"/);
assert.match(stackMarkup, /aria-pressed="true"/, "the selected stack should be exposed to assistive technology");
assert.match(stackMarkup, /8 piece\(s\)/, "the stack selector should report all eight co-located pieces");
assert.equal((stackMarkup.match(/<span>(?:Your monster|Opponent monster|Your unit|Opponent unit) · /g) ?? []).length, 8, "the accessible detail region should describe every piece in the stack");
assert.match(stackMarkup, /Your monster · Zorb|Your monster · Tomanagi|Your monster · Gargantis|Your monster · Konk|Your monster · Megaclaw|Your monster · Toxicor/);
assert.match(stackMarkup, /Opponent monster ·/);
assert.match(stackMarkup, /Your unit ·/);
assert.match(stackMarkup, /Army · Player 1 · 1 Health · moved/);
assert.match(stackMarkup, /Opponent unit ·/);
assert.match(stackMarkup, /Navy · Player 2 · 1 Health · available/);

const spectatorStackMarkup = renderToStaticMarkup(<PieceStackInspector
  game={stackedGame}
  selectedStackKey={stackKey}
  onSelect={() => undefined}
  onClear={() => undefined}
/ >);
assert.match(spectatorStackMarkup, /Player 1 monster ·/);
assert.match(spectatorStackMarkup, /Player 2 monster ·/);
assert.match(spectatorStackMarkup, /Player 1 unit ·/);
assert.match(spectatorStackMarkup, /Player 2 unit ·/);

console.log("PASS: mixed stacks expose ownership from the viewing player's perspective (or explicit player numbers for spectators), with branch, Health and movement state through a polite live region.");
