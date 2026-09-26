import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, legalChopperLiftDestinations, projectState, type HexKey } from "../packages/game-engine/src/index.js";
import { sheetCardActions } from "../apps/web/src/components/SheetCards.js";
import { ChopperLiftChoiceControls } from "../apps/web/src/components/ChopperLiftChoiceControls.js";

const game = createGame(2, 23);
game.currentPlayer = 0;
game.phase = "move";
game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };
game.players[0]!.researchCardIds = ["Chopper Lift"];
game.stompedLocations.push(game.monsters[0]!.location as HexKey);
for (const unit of game.units) if (unit.location === game.monsters[0]!.location) unit.location = "record-tile";
const actions = sheetCardActions(game, "Chopper Lift");
assert.equal(actions.length, 1);
assert.equal(actions[0]!.label, "Roll for Chopper Lift");
assert.deepEqual(actions[0]!.command, { type: "use-research", cardId: "Chopper Lift" });
const rolled = applyCommand(game, actions[0]!.command);
const roll = rolled.state.pendingChopperLift?.roll;
assert.ok(roll);
const legalDestinations = legalChopperLiftDestinations(rolled.state, "monster-1", roll);
assert.ok(legalDestinations.length > 0);
const markup = renderToStaticMarkup(React.createElement(ChopperLiftChoiceControls, {
  game: projectState(rolled.state, "player", 0),
  canChoose: true,
  runCommand: () => undefined,
  getLocationName: (key) => key,
}));
assert.match(markup, new RegExp(`Chopper Lift rolled ${roll}`));
assert.match(markup, /Chopper Lift monster/);
assert.match(markup, /Chopper Lift destination/);
for (const destination of legalDestinations) assert.ok(markup.includes(`value="${destination}"`), `missing legal destination ${destination}`);
assert.match(markup, /Move monster · lose 1 Infamy/);
assert.doesNotMatch(markup, /disabled=""/);
console.log("Chopper Lift rolls before target selection and renders only backend-legal destinations to the active player projection.");
