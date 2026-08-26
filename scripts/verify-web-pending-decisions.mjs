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
  "challenge-giant",
  "challenge-giant-resolution",
  "game-over",
].includes(type));

const sources = `${web}\n${phaseActions}\n${challengeActions}`;
const progress = await readFile(new URL("../apps/web/src/components/TurnProgress.tsx", import.meta.url), "utf8");
const actionCoverageMarkers = {
  "monster-movement": /legalDestinations|choosePath|disappear-monster|pass-move/,
  "battle-resolution": /pendingBattle[\s\S]*resolve-fight/,
  "attack-target": /pendingAttackTarget[\s\S]*targetUnitId/,
  retreat: /pendingRetreat[\s\S]*destinations[\s\S]*type: "retreat"/,
  "encounter-resolution": /encounter-resolution[\s\S]*Resolve encounter/,
  "encounter-choice": /encounter-choice[\s\S]*resolve-encounter/,
  "trophy-choice": /trophy-choice[\s\S]*trophyUnitId/,
  deployment: /activeGame\.phase === "deploy"[\s\S]*?runCommand\(\{ type: "deploy"/,
  "challenge-opponent": /challenge-opponent[\s\S]*challenge-opponent/,
  "challenge-resolution": /challenge-resolution[\s\S]*resolve-challenge/,
  "challenge-giant": /challenge-giant[\s\S]*challenge-giant/,
  "challenge-giant-resolution": /challenge-giant-resolution[\s\S]*resolve-challenge/,
  "game-over": /phase === "game-over"[\s\S]*Victory|Victory[\s\S]*terminal/,
};
const missing = uniqueTypes.filter((type) => !(actionCoverageMarkers[type]?.test(sources) ?? false));
if (missing.length > 0) {
  throw new Error(`Web pending-decision action coverage missing: ${missing.join(", ")}`);
}
const missingProgressLabels = [
  "monster-movement", "battle-resolution", "attack-target", "retreat", "encounter-resolution", "encounter-choice", "trophy-choice", "deployment", "challenge-opponent", "challenge-resolution", "challenge-giant", "challenge-giant-resolution", "game-over",
].filter((type) => !progress.includes(`type === "${type}"`));
if (missingProgressLabels.length > 0) throw new Error(`Turn progress labels missing: ${missingProgressLabels.join(", ")}`);

console.log(`Verified explicit UI action coverage for ${uniqueTypes.length} authoritative pending-decision types and progress labels; interactive, assistive-technology, and source-rules review remain separate.`);
