import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState, type BattleAttack } from "../packages/game-engine/src/index.js";
import { SelectedPieceTray } from "../apps/web/src/components/SelectedPieceTray.js";

const game = createGame(2);
game.phase = "fight";
game.players[0]!.mutationCardIds = ["War Spikes"];
const projected = projectState(game, "player", 0);
const tray = renderToStaticMarkup(React.createElement(SelectedPieceTray, {
  game: projected,
  selectedUnitId: null,
  selectedUnitPath: [],
  onClear: () => undefined,
  canLaunchSubmarine: false,
  choosingSubmarineTarget: false,
  onLaunchSubmarine: () => undefined,
}));
assert.match(tray, /Damage<\/dt><dd>4<\/dd>/);

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");
const hit: BattleAttack = {
  attackerId: "monster-1", targetId: "unit-1", controllerPlayer: 0, roll: 4, modifiers: ["War Spikes: 4 damage"],
  hit: true, smash: false, damage: 4, destroyed: false, combatRound: 1, targetDefense: 4, rollModifier: 0,
};
const smash: BattleAttack = { ...hit, roll: 6, smash: true, damage: 5 };
const hitHtml = renderToStaticMarkup(React.createElement(AttackRoll, { attack: hit, attackerName: "Tomanagi", targetName: "Mecha-Monster", settled: true }));
const smashHtml = renderToStaticMarkup(React.createElement(AttackRoll, { attack: smash, attackerName: "Tomanagi", targetName: "Mecha-Monster", settled: true }));
assert.match(hitHtml, /4 damage to Mecha-Monster/);
assert.match(smashHtml, /5 total damage to Mecha-Monster/);
assert.match(hitHtml, /War Spikes: 4 damage/);
console.log("War Spikes displays effective Damage 4 and the battle result shows 4, or 5 on a natural-six smash.");
