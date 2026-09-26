import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { BlondeLureActions } = require("../apps/web/src/components/BlondeLureActions.tsx") as typeof import("../apps/web/src/components/BlondeLureActions.js");

const game = createGame(2, 0);
game.currentPlayer = 0;
game.players[0]!.researchCardIds = ["Blonde Lure"];
const html = renderToStaticMarkup(React.createElement(BlondeLureActions, {
  game: projectState(game, "player", 0),
  canAct: true,
  runCommand: () => undefined,
  getLocationName: (key: string) => key,
}));
assert.match(html, /Choose Blonde Lure target/);
assert.match(html, /Lure .* to /);
assert.doesNotMatch(html, /<button disabled=""/);

const unavailable = renderToStaticMarkup(React.createElement(BlondeLureActions, {
  game: projectState(game, "player", 0),
  canAct: false,
  runCommand: () => undefined,
  getLocationName: (key: string) => key,
}));
assert.match(unavailable, /<button[^>]*disabled=""/);
console.log("Blonde Lure renders target/destination controls during an active turn and disables them when the player cannot act.");
