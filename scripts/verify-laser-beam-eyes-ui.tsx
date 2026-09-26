import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand, createGame, type GameState } from "../packages/game-engine/src/index.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { AttackRoll } = require("../apps/web/src/components/FightResolutionPanel.tsx") as typeof import("../apps/web/src/components/FightResolutionPanel.js");

const game = createGame(2, 0);
game.players[0]!.mutationCardIds = ["Laser Beam Eyes"];
game.monsters[0]!.attacks = 1;
const missile = game.units.find((unit) => unit.unitTypeId === "air-force-cruise-missile")!;
missile.location = game.monsters[0]!.location;
game.phase = "fight";
game.pendingBattles = [{ id: "laser-beam-eyes-ui", monsterId: game.monsters[0]!.id, location: game.monsters[0]!.location as `${number},${number}`, militaryUnitIds: [missile.id] }];
game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "laser-beam-eyes-ui" };

let attack: GameState["eventLog"][number]["detail"]["attacks"] extends Array<infer A> ? A : never;
for (let seed = 0; seed < 128; seed += 1) {
  const candidate = structuredClone(game);
  candidate.rng.seed = seed;
  const result = applyCommand(candidate, { type: "resolve-fight" });
  const found = (result.eventPayload.attacks as Array<typeof attack>).find((entry) => entry.attackerId === game.monsters[0]!.id && entry.roll === 4);
  if (found) { attack = found; break; }
}
assert.ok(attack, "the engine should record a natural 4 for the modifier example");
const html = renderToStaticMarkup(React.createElement(AttackRoll, {
  attack: attack as Parameters<typeof AttackRoll>[0]["attack"],
  attackerName: "Zorb",
  targetName: "Air Force Cruise Missile",
  settled: true,
}));
assert.match(html, /Laser Beam Eyes: \+2 to hit cruise missiles/);
assert.match(html, /4 \+ 2 = 6/);
assert.match(html, /Defense 6/);
assert.match(html, /4\+ to hit/);
console.log("Laser Beam Eyes is visible in fight playback with its +2, modified roll, missile Defense, and updated hit range.");
