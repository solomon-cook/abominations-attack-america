import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { ChallengeDuelPanel } = require("../apps/web/src/components/ChallengeDuelPanel.tsx") as typeof import("../apps/web/src/components/ChallengeDuelPanel.js");

const game = createGame(2, 0);
game.players[1]!.mutationCardIds = ["It's a Robot!"];
game.phase = "challenge";
game.currentPlayer = 0;
game.monsters[0]!.health = 1;
game.monsters[1]!.health = 2;
game.monsters[1]!.location = "disappeared";
game.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
game.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
let duel = applyCommand(game, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
let result: ReturnType<typeof applyCommand> | undefined;
for (let seed = 0; seed < 128 && !result; seed += 1) {
  const candidate = structuredClone(duel);
  candidate.rng.seed = seed;
  const rolled = applyCommand(candidate, { type: "resolve-challenge" });
  const attack = (rolled.eventPayload.attacks as Array<{ hit: boolean; retaliationDamage?: number }>)[0]!;
  if (!attack.hit && attack.retaliationDamage === 1) result = rolled;
}
assert.ok(result, "the actual Challenge resolution should contain a lethal electrocution miss");
const event = result.state.eventLog.at(-1)!;
const attacks = (result.eventPayload.duelAttacks as Array<{ attackerId: string; targetId: string; roll: number; hit: boolean; smash: boolean; damage: number; retaliationDamage?: number }>);
const html = renderToStaticMarkup(React.createElement(ChallengeDuelPanel, {
  eventId: event.id,
  winnerName: String(result.eventPayload.winnerName),
  defeatedName: String(result.eventPayload.defeatedName),
  winnerHealth: Number(result.eventPayload.winnerHealth),
  loserWeighIn: Number(result.eventPayload.loserWeighIn),
  rolls: result.eventPayload.rolls as number[],
  attacks,
  victoryType: String(result.eventPayload.victoryType ?? "monster-challenge"),
}));
assert.match(html, /Miss · 1 electrocution damage/);
assert.match(html, /Health timeline/);
console.log("Challenge result playback identifies It's a Robot!'s electrocution when its retaliation defeats the attacker.");
