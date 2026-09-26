import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, legalMonsterPaths, projectState } from "../packages/game-engine/src/index.js";
import { MovementChecklist } from "../apps/web/src/components/MovementChecklist.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { ChallengeArena } = require("../apps/web/src/components/ChallengeArena.tsx") as typeof import("../apps/web/src/components/ChallengeArena.js");

const movement = createGame(2);
movement.phase = "move";
movement.players[0]!.mutationCardIds = ["High-Octane Blood"];
movement.monsters[1]!.location = "record-tile";
movement.units.forEach((unit) => { unit.location = "record-tile"; });
const paths = legalMonsterPaths(movement, movement.monsters[0]!.id);
const baseMovement = structuredClone(movement);
baseMovement.players[0]!.mutationCardIds = [];
const basePaths = legalMonsterPaths(baseMovement, baseMovement.monsters[0]!.id);
const maximumDistance = Math.max(...paths.map((path) => path.length - 1));
assert.equal(maximumDistance, Math.max(...basePaths.map((path) => path.length - 1)) + 1);
const movementHtml = renderToStaticMarkup(React.createElement(MovementChecklist, {
  game: projectState(movement, "player", 0),
  canAct: true,
  selectedUnitId: null,
  movableUnitIds: new Set<string>(),
  monsterCanMove: paths.length > 0,
  onSelect: () => undefined,
  onEnd: () => undefined,
}));
const monsterControl = movementHtml.match(/<button[^>]*>[\s\S]*?<strong>[^<]*<\/strong>[\s\S]*?<\/button>/)?.[0];
assert.ok(monsterControl?.includes(movement.monsters[0]!.name));
assert.ok(!monsterControl?.includes("disabled"), "the monster can choose movement destinations with its extra Move");

const challenge = createGame(2);
challenge.phase = "challenge";
challenge.currentPlayer = 0;
challenge.players[1]!.mutationCardIds = ["High-Octane Blood"];
challenge.monsters.forEach((monster) => { monster.health = 20; monster.defense = 99; monster.damage = 1; monster.attacks = 1; });
challenge.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
challenge.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
const selected = applyCommand(challenge, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
assert.equal(selected.challenge?.turn?.attackerId, "monster-2");
const challengeHtml = renderToStaticMarkup(React.createElement(ChallengeArena, {
  game: projectState(selected, "player", 1),
  canAct: true,
  canUseMutation: false,
  playerIndex: 1,
  runCommand: () => undefined,
  onClose: () => undefined,
}));
assert.match(challengeHtml, /Round 1 · Tomanagi’s turn/);
assert.match(challengeHtml, /Target this monster · roll/);

const tie = structuredClone(challenge);
tie.players[0]!.mutationCardIds = ["High-Octane Blood"];
const tiedSelection = applyCommand(tie, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
const tiedHtml = renderToStaticMarkup(React.createElement(ChallengeArena, {
  game: projectState(tiedSelection, "player", 0),
  canAct: true,
  canUseMutation: false,
  playerIndex: 0,
  runCommand: () => undefined,
  onClose: () => undefined,
}));
assert.match(tiedHtml, /Round 1 · Zorb’s turn/);
console.log("High-Octane Blood's extra Move stays selectable; the defender attacks first, and the challenger keeps default order when both hold the card.");
