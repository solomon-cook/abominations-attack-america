import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";
import { SheetCards } from "../apps/web/src/components/SheetCards.js";

const state = createGame(2);
state.currentPlayer = 0;
state.phase = "move";
state.players[0]!.researchCardIds = ["Cutbacks"];
state.players[1]!.researchCardIds = ["Guard Commander"];

const projected = projectState(state, "player", 0);
assert.deepEqual(projected.players[1]!.researchCardIds, []);
const html = renderToStaticMarkup(React.createElement(SheetCards, {
  game: projected,
  playerIndex: 0,
  kind: "research",
  canAct: true,
  runCommand: () => undefined,
}));

assert.match(html, /Remove Player 2&#x27;s Guard Commander from play/);
assert.match(html, /Cutbacks Military Research card/);
console.log("Cutbacks renders the opponent's face-up Research target and play control from a redacted player projection.");
