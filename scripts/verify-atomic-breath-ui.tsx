import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, projectState, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { FightResolutionPanel, AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");
const { ChallengeArena } = require("../apps/web/src/components/ChallengeArena.tsx") as typeof import("../apps/web/src/components/ChallengeArena.js");

function fightMarkup(game: GameState, event = game.eventLog.at(-1)) {
  const pendingBattle = game.pendingBattles[0];
  const pendingAttackTarget = game.pendingDecision?.type === "attack-target" ? game.pendingDecision : undefined;
  return renderToStaticMarkup(React.createElement(FightResolutionPanel, {
    open: true,
    onClose: () => undefined,
    controls: null,
    event,
    game: projectState(game, "player", 0),
    canAct: true,
    pendingBattle,
    pendingAttackTarget,
    onChooseTarget: () => undefined,
  }));
}

const militaryBattle = createGame(2, 0);
militaryBattle.players[0]!.mutationCardIds = ["Atomic Breath"];
militaryBattle.monsters[0]!.attacks = 1;
militaryBattle.monsters[0]!.defense = 99;
militaryBattle.monsters[0]!.health = 40;
militaryBattle.units[0]!.location = militaryBattle.monsters[0]!.location;
militaryBattle.units[0]!.defense = 99;
militaryBattle.units[1]!.location = militaryBattle.monsters[0]!.location;
militaryBattle.units[1]!.defense = 99;
militaryBattle.phase = "fight";
militaryBattle.pendingBattles = [{ id: "atomic-breath-ui", monsterId: "monster-1", location: militaryBattle.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [militaryBattle.units[0]!.id, militaryBattle.units[1]!.id] }];
militaryBattle.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "atomic-breath-ui" };
let militaryResult = applyCommand(militaryBattle, { type: "resolve-fight" });
let targetIndex = 0;
while (militaryResult.state.pendingDecision?.type === "attack-target") {
  const targets = [militaryBattle.units[0]!.id, militaryBattle.units[1]!.id];
  militaryResult = applyCommand(militaryResult.state, { type: "resolve-fight", battleId: "atomic-breath-ui", targetUnitId: targets[targetIndex++ % targets.length] });
}
const firstRound = militaryResult.state;
const firstRoundAttacks = militaryResult.eventPayload.attacks as Array<{ attackerId: string; combatRound: number; modifiers: string[] }>;
assert.equal(firstRoundAttacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length, 2);
assert.equal(firstRoundAttacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 2).length, 1);
assert.equal(firstRoundAttacks.filter((attack) => attack.modifiers.includes("Atomic Breath: extra first-round attack")).length, 1);
assert.match(fightMarkup(firstRound), /Attack sequence ·/);
const extraAttack = firstRoundAttacks.find((attack) => attack.modifiers.includes("Atomic Breath: extra first-round attack"));
assert.ok(extraAttack, "the engine marks the one additional attack");
const extraAttackMarkup = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack: extraAttack,
  attackerName: "Zorb",
  targetName: "army tank",
  settled: true,
}));
assert.match(extraAttackMarkup, /Atomic Breath: extra first-round attack/);

const challenge = createGame(2, 0);
challenge.currentPlayer = 0;
challenge.phase = "challenge";
challenge.players[0]!.mutationCardIds = ["Atomic Breath"];
challenge.monsters.forEach((monster) => { monster.health = 40; monster.attacks = 1; monster.defense = 99; monster.damage = 1; });
challenge.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, startAtEndOfTurn: false, weighInHealth: {}, defeatedMonsterIds: [] };
challenge.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
const selected = applyCommand(challenge, { type: "challenge-opponent", opponentMonsterId: "monster-2" }).state;
const renderChallenge = (game: GameState) => renderToStaticMarkup(React.createElement(ChallengeArena, {
  game: projectState(game, "player", 0),
  canAct: true,
  canUseMutation: false,
  playerIndex: 0,
  runCommand: () => undefined,
  onClose: () => undefined,
}));
assert.match(renderChallenge(selected), /2 attacks remaining/);
const challengeRoundTwo = structuredClone(selected);
challengeRoundTwo.challenge!.turn = { ...challengeRoundTwo.challenge!.turn!, round: 2, remainingAttacks: 1 };
assert.match(renderChallenge(challengeRoundTwo), /1 attack remaining/);
console.log("Atomic Breath's actual Fight playback labels one extra first-round attack; Challenge shows two first-round attacks and one in round two.");
