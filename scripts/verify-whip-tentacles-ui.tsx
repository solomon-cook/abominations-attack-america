import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, projectState, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { ChallengeArena } = require("../apps/web/src/components/ChallengeArena.tsx") as typeof import("../apps/web/src/components/ChallengeArena.js");
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");

let result: ReturnType<typeof applyCommand> | undefined;
for (let seed = 0; seed < 256 && !result; seed += 1) {
  const game = createGame(2, seed);
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.players[0]!.mutationCardIds = ["Whip Tentacles"];
  game.monsters.forEach((monster) => { monster.health = 20; monster.attacks = 1; monster.defense = 99; monster.damage = 1; });
  game.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
  game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  const selected = applyCommand(game, { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  if (selected.state.rng.cursor !== game.rng.cursor) throw new Error("Selecting the opponent must not roll.");
  selected.state.rng.seed = seed;
  const rolled = applyCommand(selected.state, { type: "resolve-challenge" });
  const attack = (rolled.eventPayload.attacks as Array<{ roll: number }>)[0];
  if (attack?.roll === 6) result = rolled;
}
assert.ok(result, "a deterministic seed should produce a natural six");
const game = result.state as GameState;
const html = renderToStaticMarkup(React.createElement(ChallengeArena, {
  game: projectState(game, "player", 0),
  canAct: true,
  canUseMutation: false,
  playerIndex: 0,
  runCommand: () => undefined,
  onClose: () => undefined,
}));
assert.match(html, /1 attack remaining/);
assert.match(html, /Roll attack against/);
const attack = (result.eventPayload.attacks as Array<{ attackerId: string; targetId: string; roll: number; hit: boolean; smash: boolean; damage: number; targetDefense: number; combatRound: number; destroyed: boolean; targetHealthBefore: number; targetHealthAfter: number; modifiers: string[] }>)[0]!;
const rollHtml = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack,
  attackerName: "Zorb",
  targetName: "Tomanagi",
  settled: true,
}));
assert.match(rollHtml, /Whip Tentacles: extra attack after 6/);
console.log("ChallengeArena displays the six-triggered Whip Tentacles bonus and an enabled follow-up attack.");
