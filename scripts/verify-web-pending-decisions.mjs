import { readFile } from "node:fs/promises";

const [engine, web, phaseActions, challengeActions] = await Promise.all([
  readFile(new URL("../packages/game-engine/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/PhaseActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/ChallengeActions.tsx", import.meta.url), "utf8"),
]);

const pendingTypes = [...engine.matchAll(/type:\s*"([a-z-]+)"/g)].map((match) => match[1]);
const uniqueTypes = [...new Set(pendingTypes)].filter((type) => [
  "monster-movement",
  "battle-resolution",
  "attack-target",
  "retreat",
  "encounter-resolution",
  "encounter-choice",
  "trophy-choice",
  "deployment",
  "challenge-opponent",
  "challenge-resolution",
  "game-over",
].includes(type));

const sources = `${web}\n${phaseActions}\n${challengeActions}`;
const coverageMarkers = {
  "monster-movement": /legalDestinations|choosePath|disappear-monster/,
  deployment: /activeGame\.phase === "deploy"[\s\S]*?runCommand\(\{ type: "deploy"/,
};
const missing = uniqueTypes.filter((type) => !(coverageMarkers[type]?.test(sources) ?? sources.includes(`"${type}"`)));
if (missing.length > 0) {
  throw new Error(`Web pending-decision coverage missing: ${missing.join(", ")}`);
}

console.log(`Verified UI source coverage for ${uniqueTypes.length} authoritative pending-decision types; interactive, assistive-technology, and source-rules review remain separate.`);
