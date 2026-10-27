import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, legalLaserFenceTargets, projectState, type GameState } from "../packages/game-engine/src/index.js";
import { LaserFenceControls } from "../apps/web/src/components/LaserFenceControls.js";

const phaseActionsSource = readFileSync(new URL("../apps/web/src/components/PhaseActions.tsx", import.meta.url), "utf8");
assert.match(phaseActionsSource, /if \(activeGame\.phase === "deploy"\)[\s\S]*?\{laserFenceControls\}/);

for (const phase of ["move", "fight", "encounter", "deploy"] as const) {
  const game = createGame(2);
  const monster = game.monsters[0]!;
  game.currentPlayer = 0;
  game.players[1]!.researchCardIds = ["Laser Fence"];
  monster.infamy = 2;
  game.laserFenceWindowMonsterIds = [monster.id];
  if (phase === "move") {
    game.phase = "move";
    game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: monster.id };
  } else if (phase === "fight") {
    const unit = game.units.find((candidate) => candidate.ownerPlayer === 0)!;
    unit.location = monster.location;
    game.phase = "fight";
    game.pendingBattles = [{ id: "laser-ui-battle", monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
    game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "laser-ui-battle" };
  } else {
    game.phase = phase;
    game.pendingDecision = phase === "encounter"
      ? { type: "encounter-resolution", playerIndex: 0, location: monster.location as `${number},${number}` }
      : { type: "deployment", playerIndex: 0 };
  }
  const targets = legalLaserFenceTargets(game);
  assert.equal(targets.length, 1);
  const html = renderToStaticMarkup(React.createElement(LaserFenceControls, {
    game: projectState(game, "player", 1) as GameState,
    cardOwnerIndex: 1,
    canUse: true,
    runCommand: () => undefined,
    getLocationName: (key) => key,
  }));
  assert.match(html, /Laser Fence/);
  assert.match(html, /Pay 2 Infamy/);
  assert.match(html, /Retreat to/);
  assert.doesNotMatch(html, /disabled=""/);
}

const noWindow = createGame(2);
noWindow.players[1]!.researchCardIds = ["Laser Fence"];
assert.equal(legalLaserFenceTargets(noWindow).length, 0);
console.log("Laser Fence choices render enabled for the off-turn cardholder after movement, at battle start, before Encounter resolution, and after a deployment-phase Chopper Lift; PhaseActions includes the controls in Deploy.");
