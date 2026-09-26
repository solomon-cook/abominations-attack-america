import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BattleAttack } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
async function main() {
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");
const attack: BattleAttack = {
  attackerId: "unit-1",
  targetId: "monster-1",
  controllerPlayer: 0,
  roll: 1,
  modifiers: ["Radiation Field: attacker destroyed on roll 1"],
  hit: false,
  smash: false,
  damage: 0,
  destroyed: false,
  attackerDestroyed: true,
  mutationCardId: "War Spikes",
  combatRound: 1,
  targetDefense: 4,
  rollModifier: 0,
  targetHealthBefore: 11,
  targetHealthAfter: 11,
};

const html = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack,
  attackerName: "Air Force Cruise Missile",
  targetName: "Tomanagi",
  settled: true,
}));
assert.match(html, /Radiation Field destroyed the attacker\./);
assert.match(html, /Mutation drawn: War Spikes/);
assert.match(html, /Radiation Field: attacker destroyed on roll 1/);
console.log("The resolved battle card shows the Radiation Field destruction and preserves the missile's Mutation draw.");
}

void main();
