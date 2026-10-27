import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, locationIdToHexKey, projectState, type HexKey } from "../packages/game-engine/src/index.js";
import { SheetCards, sheetCardActions } from "../apps/web/src/components/SheetCards.js";

const game = createGame(2, 0);
game.currentPlayer = 0;
game.phase = "fight";
game.players[0]!.researchCardIds = ["Molecular Cannon"];
game.setupAssignments = [{ playerIndex: 0, monsterId: "monster-1", lair: "denver", ready: true }];
game.setupState = {
  phase: "complete",
  seats: [],
  definition: {
    playerCount: 2,
    monsterIds: ["monster-1", "monster-2"],
    eligibleBranches: ["Army", "Navy"],
    lairsByMonster: { "monster-1": ["denver", "seattle", "los-angeles"], "monster-2": [] },
  },
};
const unit = game.units[0]!;
unit.location = game.monsters[0]!.location;
const battleId = "molecular-cannon-ui";
game.pendingBattles = [{
  id: battleId,
  monsterId: game.monsters[0]!.id,
  location: game.monsters[0]!.location as HexKey,
  militaryUnitIds: [unit.id],
}];
game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };

const projected = projectState(game, "player", 0);
const actions = sheetCardActions(projected, "Molecular Cannon");
assert.equal(actions.length, 3, "the cardholder should be offered each configured lair");
const expectedLairs = ["denver", "seattle", "los-angeles"].map((lair) => locationIdToHexKey(lair));
assert.ok(expectedLairs.every((lair): lair is HexKey => Boolean(lair)));
assert.deepEqual(actions.map(({ command }) => command), expectedLairs.map((destination) => ({
  type: "use-research",
  cardId: "Molecular Cannon",
  battleId,
  targetMonsterId: "monster-1",
  destination: destination!,
})));

const html = renderToStaticMarkup(React.createElement(SheetCards, {
  game: projected,
  playerIndex: 0,
  kind: "research",
  canAct: true,
  runCommand: () => undefined,
}));
assert.match(html, /Molecular Cannon Military Research card/);
assert.match(html, /Start of a battle involving your units/);
assert.match(html, /Choose target or outcome/);
assert.match(html, /Blast Zorb to Denver/);
assert.match(html, /Blast Zorb to Seattle/);
assert.match(html, /Blast Zorb to Los Angeles/);
assert.match(html, /<button type="button" disabled="">Play Molecular Cannon<\/button>/, "a destination must be selected before the command is enabled");

const opponentProjection = projectState(game, "player", 1);
assert.deepEqual(sheetCardActions(opponentProjection, "Molecular Cannon"), [], "the non-owner projection must not expose the card command");
console.log("Molecular Cannon exposes only the active cardholder's legal battle lairs and requires a destination before play.");
