import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardForState, createGame, projectState } from "../packages/game-engine/src/index.js";
import { ToxicorMutationControls } from "../apps/web/src/components/ToxicorMutationControls.js";

const game = createGame(2);
game.currentPlayer = 0;
game.phase = "encounter";
const monster = game.monsters[0]!;
monster.name = "Toxicor";
const site = Object.values(boardForState(game).hexes).find((hex) => hex.features.some((feature) => feature.kind === "mutation-site"))!;
monster.location = site.key;
const cardIds = ["Fins and Gills", "Rampage"] as const;
game.pendingMutationChoice = { playerIndex: 0, monsterId: monster.id, cardIds, source: "mutation-site", siteId: site.features.find((feature) => feature.kind === "mutation-site")!.siteId };
game.pendingDecision = { type: "mutation-choice", playerIndex: 0, monsterId: monster.id, cardIds, siteId: game.pendingMutationChoice.siteId };

const render = (state: typeof game, viewer: number) => renderToStaticMarkup(React.createElement(ToxicorMutationControls, {
  game: projectState(state, "player", viewer),
  canAct: viewer === 0,
  runCommand: () => undefined,
}));

const ownerHtml = render(game, 0);
assert.match(ownerHtml, /Toxicor revealed two Mutation cards\. Choose one to keep; the other returns to the deck\./);
assert.match(ownerHtml, /Keep Fins and Gills/);
assert.match(ownerHtml, /Keep Rampage/);
assert.doesNotMatch(ownerHtml, /disabled=""/);
const opponentHtml = render(game, 1);
assert.doesNotMatch(opponentHtml, /Keep Fins and Gills|Keep Rampage/);

const battleGame = structuredClone(game);
battleGame.phase = "fight";
battleGame.pendingMutationChoice = { ...battleGame.pendingMutationChoice!, source: "battle", siteId: undefined };
battleGame.pendingDecision = { type: "mutation-choice", playerIndex: 0, monsterId: monster.id, cardIds };
const battleHtml = render(battleGame, 0);
assert.match(battleHtml, /Keep Fins and Gills/);
assert.match(battleHtml, /Keep Rampage/);
console.log("Toxicor's Mutation-site and in-battle projections render two enabled Keep choices to the owner and hide card names from the opponent.");
