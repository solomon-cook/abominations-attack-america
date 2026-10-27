import { readFile } from "node:fs/promises";

const [engine, web, phaseActions, challengeActions, challengeArena, toxicorControls, stabilizerControls, chopperLiftControls, attentionBanner] = await Promise.all([
  readFile(new URL("../packages/game-engine/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/PhaseActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/ChallengeActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/ChallengeArena.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/ToxicorMutationControls.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/StabilizerRayControls.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/ChopperLiftChoiceControls.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/components/AttentionBanner.tsx", import.meta.url), "utf8"),
]);

const pendingDecisionDefinition = engine.match(/export type PendingDecision =([\s\S]*?);\n/);
if (!pendingDecisionDefinition) throw new Error("Cannot locate the authoritative PendingDecision union.");
const uniqueTypes = [...new Set([...pendingDecisionDefinition[1].matchAll(/type:\s*"([a-z-]+)"/g)].map((match) => match[1]))];

const sources = `${web}\n${phaseActions}\n${challengeActions}\n${challengeArena}\n${toxicorControls}\n${stabilizerControls}\n${chopperLiftControls}`;
const progress = await readFile(new URL("../apps/web/src/components/TurnProgress.tsx", import.meta.url), "utf8");
const actionCoverageMarkers = {
  "monster-movement": /legalDestinations|choosePath|disappear-monster|pass-move/,
  "battle-resolution": /pendingBattle[\s\S]*resolve-fight/,
  "attack-target": /pendingAttackTarget[\s\S]*targetUnitId/,
  retreat: /pendingRetreat[\s\S]*destinations[\s\S]*type: "retreat"/,
  "encounter-resolution": /encounter-resolution[\s\S]*Resolve encounter/,
  "encounter-choice": /encounter-choice[\s\S]*resolve-encounter/,
  "mutation-choice": /mutation-choice[\s\S]*choose-mutation-card/,
  "stabilizer-ray-choice": /stabilizer-ray-choice[\s\S]*choose-stabilizer-ray-mutation/,
  "chopper-lift-choice": /ChopperLiftChoiceControls[\s\S]*resolve-chopper-lift/,
  "trophy-choice": /trophy-choice[\s\S]*trophyUnitId/,
  deployment: /onDeploy[\s\S]*?runCommand\(\{ type: deploymentPiece.kind/,
  "giant-placement": /pendingDecision\?\.type === "giant-placement"[\s\S]*type: "place-giant"/,
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
const missingProgressLabels = uniqueTypes.filter((type) => !progress.includes(`type === "${type}"`));
if (missingProgressLabels.length > 0) throw new Error(`Turn progress labels missing: ${missingProgressLabels.join(", ")}`);
if (!web.includes("activeGame.pendingDecision?.playerIndex ?? activeGame.currentPlayer")) {
  throw new Error("Web action ownership must follow the authoritative pending decision player.");
}
if (!attentionBanner.includes("Waiting for Player ${pending.playerIndex + 1}")) {
  throw new Error("Waiting status must name the authoritative pending decision player.");
}

console.log(`Verified explicit UI action coverage for all ${uniqueTypes.length} authoritative pending-decision types, progress labels, and decision-owner status; interactive, assistive-technology, and source-rules review remain separate.`);
