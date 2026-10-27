import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CARD_DEFINITIONS } from "../packages/game-engine/src/cards.js";

async function main() {
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};
const coverage: Record<string, string> = {
  "Fins and Gills": "verify:fins-and-gills-ui",
  Rampage: "verify:rampage-ui",
  "Radiation Field": "verify:radiation-field-ui",
  "Atomic Recovery": "verify:atomic-recovery-ui",
  Berserk: "verify:mutation-ui",
  "War Spikes": "verify:war-spikes-ui",
  "Atomic Breath": "verify:atomic-breath-ui",
  "Iron Stomach": "verify:iron-stomach-ui",
  "Whip Tentacles": "verify:whip-tentacles-ui",
  "High-Octane Blood": "verify:high-octane-blood-ui",
  "Son of a Monster": "verify:mutation-ui",
  "Winged Horror": "verify:winged-horror-ui",
  "Kinda Friendly": "verify:kinda-friendly-ui",
  "Laser Beam Eyes": "verify:laser-beam-eyes-ui",
  "Armored Scales": "verify:armored-scales-ui",
  "It's a Robot!": "verify:its-a-robot-ui",
  "Mecha-Monster": "verify:military-deployment-ui",
  Cutbacks: "verify:cutbacks-ui",
  "Laser Fence": "verify:laser-fence-ui",
  "Guard Commander": "verify:military-deployment-ui",
  "Defense Satellites": "verify:defense-satellites-ui",
  "Stabilizer Ray": "verify:stabilizer-ray-ui",
  "Fusion Cells": "verify:fusion-cells-ui",
  "X-Fighters": "verify:military-deployment-ui",
  "Molecular Cannon": "verify:molecular-cannon-ui",
  "2nd Generation": "verify:military-deployment-ui",
  "Blonde Lure": "verify:blonde-lure-ui",
  "Anti-Mutagen": "verify:anti-mutagen-ui",
  Antimatter: "verify:antimatter-ui",
  "Scientific Analysis": "verify:scientific-analysis-ui",
  "Chopper Lift": "verify:chopper-lift-ui",
  "Captain Colossal": "verify:military-deployment-ui",
};

const catalogued = new Set(CARD_DEFINITIONS.map((card) => card.id));
const mapped = new Set(Object.keys(coverage));
const missing = [...catalogued].filter((cardId) => !mapped.has(cardId));
const stale = [...mapped].filter((cardId) => !catalogued.has(cardId));
assert.deepEqual(missing, [], `cards without a focused UI verifier: ${missing.join(", ")}`);
assert.deepEqual(stale, [], `UI coverage references unknown cards: ${stale.join(", ")}`);

const aggregate = packageJson.scripts["verify:ui"];
assert.ok(aggregate, "the focused UI verifier aggregate must exist");
for (const [cardId, verifier] of Object.entries(coverage)) {
  const command = packageJson.scripts[verifier];
  assert.ok(command, `${cardId} references missing script ${verifier}`);
  assert.ok(aggregate.includes(`npm run ${verifier}`), `${cardId} verifier ${verifier} is absent from verify:ui`);
  const scriptPath = command.match(/scripts\/[^\s]+\.(?:tsx|ts|mjs)$/)?.[0];
  assert.ok(scriptPath, `${verifier} must name its focused script file`);
  await access(resolve(new URL("..", import.meta.url).pathname, scriptPath));
}

console.log(`Verified focused UI coverage for all ${catalogued.size} catalogue cards; every mapped check exists in the standard verify:ui aggregate.`);
}

void main();
