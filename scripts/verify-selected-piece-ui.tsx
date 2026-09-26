import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame } from "../packages/game-engine/src/index.js";
import { SelectedPieceTray } from "../apps/web/src/components/SelectedPieceTray.js";

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

console.log("PASS: selected monster and unit details stay in one contextual tray; ordinary unit stats do not repeat monster Health or Infamy.");
