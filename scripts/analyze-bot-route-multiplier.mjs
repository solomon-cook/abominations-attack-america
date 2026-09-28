import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = process.cwd();
const artifactPath = resolve(repositoryRoot, process.argv[2] ?? "output/bot-strategy/route-block-multiplier-paired-2026-09-28.json");
const sidecarPath = resolve(repositoryRoot, process.argv[3] ?? "output/bot-strategy/route-block-multiplier-paired-analysis-2026-09-28.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digestFile = (path) => sha256(readFileSync(resolve(repositoryRoot, path)));
const rawBytes = readFileSync(artifactPath);
const artifact = JSON.parse(rawBytes.toString("utf8"));
const pairs = artifact.pairs;
const expectedMultipliers = [0.9, 1.15];
const practicalEffectThreshold = 0.1;

assert.equal(artifact.schemaVersion, 1);
assert.equal(pairs.length, artifact.config.pairCount);
assert.equal(artifact.config.pairCount, 30, "this analysis is for the preregistered 30-pair run");
assert.deepEqual(artifact.config.multipliers, expectedMultipliers);
assert.equal(artifact.config.fixedTacticForAllSeats, "force-first");
assert.equal(artifact.config.armOrderBalance.lowMultiplierFirst + artifact.config.armOrderBalance.highMultiplierFirst, pairs.length);
assert.ok(Math.abs(artifact.config.armOrderBalance.lowMultiplierFirst - artifact.config.armOrderBalance.highMultiplierFirst) <= 1);
assert.equal(new Set(pairs.map((pair) => pair.seed)).size, pairs.length, "every pair must use a distinct seed");
assert.equal(new Set(pairs.map((pair) => pair.initialStateSha256)).size, pairs.length, "every pair must use a distinct setup state");

for (const pair of pairs) {
  assert.deepEqual(pair.low.initialRng, pair.initialRng, `low arm starts from pair ${pair.pairIndex}'s RNG state`);
  assert.deepEqual(pair.high.initialRng, pair.initialRng, `high arm starts from pair ${pair.pairIndex}'s RNG state`);
  assert.deepEqual(pair.low.fixedTacticsBySeat, pair.fixedTacticsBySeat);
  assert.deepEqual(pair.high.fixedTacticsBySeat, pair.fixedTacticsBySeat);
  assert.ok(pair.fixedTacticsBySeat.every((tactic) => tactic === "force-first"));
  assert.deepEqual(pair.randomizedArmOrder.slice().sort((a, b) => a - b), expectedMultipliers);
  assert.equal(pair.low.multiplier, 0.9);
  assert.equal(pair.high.multiplier, 1.15);
  assert.equal(pair.scoreDifferenceLowMinusHigh, pair.low.score - pair.high.score);
  assert.equal(pair.low.armOrder, pair.randomizedArmOrder.indexOf(0.9) + 1);
  assert.equal(pair.high.armOrder, pair.randomizedArmOrder.indexOf(1.15) + 1);
  const roster = (match) => match.seats.map(({ playerIndex, monster, branch, lair, tactic }) => ({ playerIndex, monster, branch, lair, tactic }));
  assert.deepEqual(roster(pair.low), roster(pair.high), `pair ${pair.pairIndex} keeps the seat roster fixed`);
  assert.ok(pair.low.termination === "terminal" && pair.high.termination === "terminal", `pair ${pair.pairIndex} must have two terminal matches`);
  assert.ok(pair.low.invalidActionEvidence === null && pair.high.invalidActionEvidence === null, `pair ${pair.pairIndex} must not have invalid actions`);
  assert.equal(pair.pairedStatus, "complete-pair");
}

const lowMatches = pairs.map((pair) => pair.low);
const highMatches = pairs.map((pair) => pair.high);
const summarizeArm = (matches) => {
  const outcomes = Object.fromEntries(["win", "draw", "loss", "incomplete", "invalid"].map((outcome) => [
    outcome,
    matches.filter((match) => match.outcome === outcome).length,
  ]));
  const scores = matches.flatMap((match) => match.score === null ? [] : [match.score]);
  return {
    outcomes,
    meanTerminalScore: scores.reduce((sum, score) => sum + score, 0) / (scores.length || 1),
    terminalMatches: scores.length,
    invalidActions: matches.filter((match) => match.invalidActionEvidence !== null).length,
    cappedMatches: matches.filter((match) => match.termination === "round-cap" || match.termination === "action-safety-cap").length,
    meanActions: matches.reduce((sum, match) => sum + match.actions, 0) / matches.length,
    meanRounds: matches.reduce((sum, match) => sum + match.roundsCompleted, 0) / matches.length,
    focalObjectiveStomps: matches.reduce((sum, match) => sum + match.seats[match.focalSeat].diagnostics.objectiveStomps, 0),
    meanFocalFinalHealth: matches.reduce((sum, match) => sum + match.seats[match.focalSeat].diagnostics.finalHealth, 0) / matches.length,
    meanFocalFinalInfamy: matches.reduce((sum, match) => sum + match.seats[match.focalSeat].diagnostics.finalInfamy, 0) / matches.length,
  };
};
const scoreDifferences = pairs.map((pair) => pair.scoreDifferenceLowMinusHigh);
const meanDifference = scoreDifferences.reduce((sum, value) => sum + value, 0) / scoreDifferences.length;
const sampleVariance = scoreDifferences.reduce((sum, value) => sum + (value - meanDifference) ** 2, 0) / (scoreDifferences.length - 1);
const standardError = Math.sqrt(sampleVariance / scoreDifferences.length);
const z = 1.959963984540054;
const degreesFreedom = scoreDifferences.length - 1;
const tCritical = z
  + (z ** 3 + z) / (4 * degreesFreedom)
  + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degreesFreedom ** 2)
  + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * degreesFreedom ** 3);
const pairedTInterval = [meanDifference - tCritical * standardError, meanDifference + tCritical * standardError];
assert.ok(Math.abs(meanDifference - artifact.summary.pairedScore.meanDifference) < 1e-12);
assert.ok(Math.abs(standardError - artifact.summary.pairedScore.standardError) < 1e-12);
assert.ok(pairedTInterval.every((bound, index) => Math.abs(bound - artifact.summary.pairedScore.approximatePairedT95ConfidenceInterval[index]) < 1e-12));

const botsPath = "packages/game-engine/src/bots.ts";
const harnessPath = "scripts/verify-bot-route-multiplier-paired.tsx";
const analyzerPath = "scripts/analyze-bot-route-multiplier.mjs";
assert.equal(digestFile(botsPath), artifact.runMetadata.sourceSha256.botSelector, "selector source hash must match the run artifact");
assert.equal(digestFile(harnessPath), artifact.runMetadata.sourceSha256.harness, "harness source hash must match the run artifact");
const trackedEngineFiles = execFileSync("git", ["ls-files", "-z", "packages/game-engine/src"], { encoding: "utf8" })
  .split("\0").filter(Boolean).sort();
const engineSourceSha256 = Object.fromEntries(trackedEngineFiles.map((path) => [path, digestFile(path)]));
const engineSourceChangesSinceHead = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "packages/game-engine/src"], { encoding: "utf8" })
  .split("\n").filter(Boolean).sort();
const currentDirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean);
const discordant = scoreDifferences.filter((difference) => difference !== 0);
const practicalThresholdAssessment = pairedTInterval[0] <= -practicalEffectThreshold && pairedTInterval[1] >= practicalEffectThreshold
  ? "The approximate paired 95% interval includes effects more negative than -0.10 and more positive than +0.10; this study does not resolve whether the practical-effect threshold is exceeded."
  : "The approximate paired 95% interval does not span both sides of the registered ±0.10 practical-effect threshold; interpret with the observed effect and bootstrap interval. This single study still does not authorize a policy change.";

const sidecar = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rawArtifact: {
    path: artifactPath.replace(`${repositoryRoot}/`, ""),
    sha256: sha256(rawBytes),
    bytes: rawBytes.length,
    runMetadata: artifact.runMetadata,
  },
  preregisteredAnalysis: {
    practicalEffectThreshold: { absoluteMeanScoreDifference: practicalEffectThreshold, registeredIn: "docs/bot-strategy-audit.md, before the full outcome run" },
    appliedDecisionRule: "Assess whether the approximate paired 95% t interval spans both -0.10 and +0.10. This is a descriptive threshold check, not a post hoc claim of equivalence or proof of no effect.",
    assessment: practicalThresholdAssessment,
    policyDecision: "Do not change the route-block policy from this study alone.",
  },
  independentValidation: {
    pairCount: pairs.length,
    completePairs: pairs.filter((pair) => pair.pairedStatus === "complete-pair").length,
    allTerminalAndValid: pairs.every((pair) => pair.low.termination === "terminal" && pair.high.termination === "terminal" && pair.low.invalidActionEvidence === null && pair.high.invalidActionEvidence === null),
    allArmsStartFromIdenticalPairRng: pairs.every((pair) => JSON.stringify(pair.low.initialRng) === JSON.stringify(pair.initialRng) && JSON.stringify(pair.high.initialRng) === JSON.stringify(pair.initialRng)),
    everySeatPinnedForceFirst: pairs.every((pair) => pair.fixedTacticsBySeat.every((tactic) => tactic === "force-first")),
    setupRosterIdenticalWithinPairs: pairs.every((pair) => {
      const roster = (match) => JSON.stringify(match.seats.map(({ playerIndex, monster, branch, lair, tactic }) => ({ playerIndex, monster, branch, lair, tactic })));
      return roster(pair.low) === roster(pair.high);
    }),
    executionOrderBalanced: artifact.config.armOrderBalance,
    uniqueSeeds: new Set(pairs.map((pair) => pair.seed)).size,
    uniqueInitialSetupHashes: new Set(pairs.map((pair) => pair.initialStateSha256)).size,
    pairedScoreRecomputed: { meanDifference, standardError, approximatePairedT95ConfidenceInterval: pairedTInterval },
  },
  analysis: {
    estimand: "Focal match score at multiplier 0.9 minus focal match score at 1.15; win=1, draw=0.5, loss=0.",
    armAt09: summarizeArm(lowMatches),
    armAt115: summarizeArm(highMatches),
    completePairs: pairs.length,
    meanPairedScoreDifference: meanDifference,
    pairedStandardError: standardError,
    approximatePairedT95ConfidenceInterval: pairedTInterval,
    deterministicBootstrapPercentile95ConfidenceInterval: artifact.summary.pairedScore.deterministicBootstrapPercentile95ConfidenceInterval,
    discordantPairCount: discordant.length,
    discordantFavoring09: discordant.filter((difference) => difference > 0).length,
    discordantFavoring115: discordant.filter((difference) => difference < 0).length,
    uncertaintyInterpretation: "The observed paired mean is zero and the interval is wide enough to include materially favorable or unfavorable effects. Equal observed arm totals do not demonstrate equivalence.",
    rngDivergence: artifact.summary.rngAndActionDivergence,
    setupComposition: artifact.summary.setupComposition,
  },
  provenance: {
    note: "The run artifact hashes bots.ts and the harness, and records the Git HEAD plus only a dirty-path count. This sidecar hashes every tracked packages/game-engine/src file as it exists at analysis time; engineSourceChangesSinceHead shows the current changes from HEAD. The game engine files outside the two bot-owned files were not modified between run completion and sidecar capture, but the original dirty-path list itself was not captured by the raw run artifact.",
    exactRunHashedSources: { [botsPath]: digestFile(botsPath), [harnessPath]: digestFile(harnessPath) },
    analysisScript: { path: analyzerPath, sha256: digestFile(analyzerPath) },
    trackedEngineFiles: engineSourceSha256,
    engineSourceChangesSinceHead,
    currentDirtyPaths,
  },
};

writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ path: sidecarPath.replace(`${repositoryRoot}/`, ""), sha256: sha256(readFileSync(sidecarPath)), result: practicalThresholdAssessment, completePairs: pairs.length, meanDifference, pairedTInterval }, null, 2)}\n`);
