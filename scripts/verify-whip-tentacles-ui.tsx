import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, projectState, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { ChallengeArena } = require("../apps/web/src/components/ChallengeArena.tsx") as typeof import("../apps/web/src/components/ChallengeArena.js");
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");

type UiAttack = { attackerId: string; targetId: string; roll: number; hit: boolean; smash: boolean; damage: number; targetDefense: number; combatRound: number; destroyed: boolean; targetHealthBefore?: number; targetHealthAfter?: number; modifiers: string[] };
let militaryAttack: UiAttack | undefined;
for (let seed = 0; seed < 256 && !militaryAttack; seed += 1) {
  const battle = createGame(2, seed);
  battle.players[0]!.mutationCardIds = ["Whip Tentacles"];
  battle.monsters[0]!.attacks = 1;
  battle.monsters[0]!.defense = 99;
  battle.monsters[0]!.health = 40;
  battle.units[0]!.location = battle.monsters[0]!.location;
  battle.units[0]!.defense = 99;
  battle.units[0]!.attacks = 0;
  battle.phase = "fight";
  battle.pendingBattles = [{ id: "whip-tentacles-ui", monsterId: "monster-1", location: battle.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [battle.units[0]!.id] }];
  battle.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "whip-tentacles-ui" };
  const resolved = applyCommand(battle, { type: "resolve-fight" });
  militaryAttack = (resolved.eventPayload.attacks as UiAttack[])
    .find((attack) => attack.attackerId === "monster-1" && attack.roll === 6 && attack.modifiers.includes("Whip Tentacles: extra attack after 6"));
}
assert.ok(militaryAttack, "a deterministic military attack should expose Whip Tentacles after a six");
const militaryRollHtml = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack: militaryAttack,
  attackerName: "Zorb",
  targetName: "army tank",
  settled: true,
}));
assert.match(militaryRollHtml, /Whip Tentacles: extra attack after 6/);

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
console.log("Military and Challenge roll playback label Whip Tentacles; ChallengeArena enables the six-triggered follow-up attack.");
