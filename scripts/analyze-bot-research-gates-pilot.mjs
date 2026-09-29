import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCheckpoint, summarizeResearchGatePairs } from "./research-gate-checkpoint.mjs";

const defaultArtifact = "output/bot-strategy/research-gate-paired-pilot-2026-09-29.json";
const artifactPath = resolve(process.cwd(), process.argv[2] ?? defaultArtifact);
const sidecarPath = artifactPath.endsWith(".checkpoint.jsonl")
  ? artifactPath.replace(/\.checkpoint\.jsonl$/, "-analysis.json")
  : artifactPath.replace(/\.json$/, "-analysis.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const bytes = readFileSync(artifactPath);
let artifact;
let checkpointCompleteness = null;
if (artifactPath.endsWith(".checkpoint.jsonl")) {
  const checkpoint = readCheckpoint(artifactPath, { repairTrailingPartialLine: true });
  const targetPairCount = checkpoint.header.targetPairCount;
  assert.equal(checkpoint.header.config.pairCount, targetPairCount, "checkpoint target and configuration pair counts must match");
  assert.ok(checkpoint.pairs.length <= targetPairCount, "checkpoint cannot contain more pairs than its preregistered target");
  checkpointCompleteness = {
    complete: checkpoint.pairs.length === targetPairCount,
    targetPairCount,
    completedPairCount: checkpoint.pairs.length,
    discardedTrailingBytes: checkpoint.discardedByteLength,
    status: checkpoint.pairs.length === targetPairCount ? "complete-preregistered-block" : "partial-nonconfirmatory-checkpoint",
  };
  artifact = {
    schemaVersion: 1,
    studyStatus: checkpointCompleteness.complete
      ? checkpoint.header.studyStatus
      : `INCOMPLETE CHECKPOINT — ${checkpoint.header.studyStatus}`,
    artifactCompleteness: checkpointCompleteness.status,
    completedPairCount: checkpoint.pairs.length,
    runMetadata: checkpoint.header.runMetadata,
    preregistration: checkpoint.header.preregistration,
    config: checkpoint.header.config,
    externalPreregistration: checkpoint.header.externalPreregistration,
    summary: summarizeResearchGatePairs(checkpoint.pairs),
    pairs: checkpoint.pairs,
  };
  const identity = {
    gitHead: checkpoint.header.runMetadata.gitHead,
    sourceSha256: checkpoint.header.runMetadata.sourceSha256,
    preregistration: checkpoint.header.preregistration,
    config: checkpoint.header.config,
    studyStatus: checkpoint.header.studyStatus,
    externalPreregistration: checkpoint.header.externalPreregistration,
  };
  assert.equal(checkpoint.header.campaignIdentitySha256, digest(JSON.stringify(identity)), "checkpoint campaign identity must recompute from its retained source, protocol, and configuration");
} else {
  artifact = JSON.parse(bytes.toString("utf8"));
  if (artifact.artifactCompleteness === "partial-checkpoint-export" || artifact.artifactCompleteness === "complete-preregistered-block") {
    const complete = artifact.artifactCompleteness === "complete-preregistered-block";
    checkpointCompleteness = {
      complete,
      targetPairCount: artifact.config.pairCount,
      completedPairCount: artifact.completedPairCount ?? artifact.pairs.length,
      discardedTrailingBytes: 0,
      status: complete ? "complete-preregistered-block" : "partial-nonconfirmatory-checkpoint",
    };
    if (!complete && !artifact.studyStatus.startsWith("INCOMPLETE CHECKPOINT — ")) {
      artifact.studyStatus = `INCOMPLETE CHECKPOINT — ${artifact.studyStatus}`;
    }
  }
}
const sha256 = createHash("sha256").update(bytes).digest("hex");
const analyzerSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
const studyStage = artifact.preregistration.stage ?? (artifact.studyStatus.includes("CONFIRMATORY") ? "confirmatory" : "pilot");
const REQUIRED_BYPASSES = ["objectiveThreatAbsent", "blockerOpportunityAbsent"];
const HARD_GATES = ["researchDeckAvailable", "deploymentNotStarted", "researchHandBelowTwo", "researchFirstPolicy", "activeMilitaryScreen"];
const OUTCOMES = ["win", "draw", "loss", "incomplete", "invalid"];

function seededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return {
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    },
    snapshot() { return state >>> 0; },
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalCdf(value) {
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const density = 0.3989422804014327 * Math.exp(-x * x / 2);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

function tCritical975(df) {
  const z = 1.959963984540054;
  return z
    + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

function estimatedPower(n, variance, delta) {
  if (n < 2 || !(variance > 0)) return null;
  const critical = tCritical975(n - 1);
  const noncentrality = delta * Math.sqrt(n / variance);
  return normalCdf(-critical - noncentrality) + 1 - normalCdf(critical - noncentrality);
}

function estimatePairsForPower(variance, delta, targetPower) {
  if (!(variance > 0)) return null;
  for (let n = 2; n <= 100_000; n += 1) {
    if (estimatedPower(n, variance, delta) >= targetPower) return n;
  }
  return null;
}

assert.ok(/^(PILOT|CONFIRMATORY|INCOMPLETE CHECKPOINT) — /.test(artifact.studyStatus), "study status must retain its preregistered stage");
assert.equal(artifact.preregistration.minimumMeaningfulDifference.absoluteScorePoints, 0.10);
assert.equal(artifact.preregistration.alpha, 0.05);
assert.equal(artifact.preregistration.targetPower, 0.80);
assert.equal(artifact.preregistration.treatment.match(/bypasses only ([^;]+)/)?.[1], "objectiveThreatAbsent and blockerOpportunityAbsent on the optional Research draw path");
assert.deepEqual(artifact.config.researchGateBypasses, REQUIRED_BYPASSES);
if (artifact.externalPreregistration) {
  const externalBytes = readFileSync(resolve(process.cwd(), artifact.externalPreregistration.path));
  assert.equal(digest(externalBytes), artifact.externalPreregistration.sha256, "external pre-run registration bytes must match their recorded checksum");
  assert.deepEqual(JSON.parse(externalBytes.toString("utf8")), artifact.externalPreregistration.registration, "external pre-run registration content must match the retained copy");
}

const pairs = artifact.pairs;
assert.ok(pairs.length <= artifact.config.pairCount, "analyzed pairs must not exceed the preregistered target");
if (!checkpointCompleteness && artifact.artifactCompleteness !== "partial-checkpoint-export") {
  assert.equal(pairs.length, artifact.config.pairCount, "a finalized JSON artifact must include every preregistered pair");
}
assert.equal(artifact.completedPairCount ?? pairs.length, pairs.length, "completed-pair count must match retained rows");
assert.equal(new Set(pairs.map((pair) => pair.seed)).size, pairs.length, "pair seeds must be unique");
assert.equal(new Set(pairs.map((pair) => pair.initialStateSha256)).size, pairs.length, "initial setups must be unique across pairs");
const random = seededRandom(artifact.config.orderSeed);
const orderCandidates = Array.from({ length: Math.floor(artifact.config.pairCount / 2) }, () => "control");
orderCandidates.push(...Array.from({ length: Math.floor(artifact.config.pairCount / 2) }, () => "urgency-gates-bypassed"));
if (artifact.config.pairCount % 2) orderCandidates.push(random.next() < 0.5 ? "control" : "urgency-gates-bypassed");
const expectedFirstArms = shuffled(orderCandidates, random);
let optionalRows = 0;
let bypassedRows = 0;
let acceptedDraws = 0;
let opportunityRows = 0;
for (const pair of pairs) {
  const { initialStateSnapshot } = pair;
  assert.equal(digest(JSON.stringify(initialStateSnapshot)), pair.initialStateSha256, `pair ${pair.pairIndex} initial snapshot hash must match`);
  assert.deepEqual(initialStateSnapshot.rng, pair.initialRng, `pair ${pair.pairIndex} snapshot RNG must match`);
  const setupRows = initialStateSnapshot.setupAssignments.map((seat) => ({
    playerIndex: seat.playerIndex,
    monster: initialStateSnapshot.monsters[seat.playerIndex]?.name ?? "unknown",
    branch: seat.branch,
    lair: seat.lair,
  }));
  assert.deepEqual(setupRows, pair.setupAssignments, `pair ${pair.pairIndex} saved setup must match its snapshot`);
  assert.equal(pair.pairIndex, pairs.indexOf(pair), "pairs must be a contiguous prefix in preregistered order");
  assert.equal(pair.randomizedArmOrder[0], expectedFirstArms[pair.pairIndex], `pair ${pair.pairIndex} execution order must be reproducible from the full block order stream`);
  assert.equal(pair.randomizedArmOrder[1], pair.randomizedArmOrder[0] === "control" ? "urgency-gates-bypassed" : "control");
  assert.deepEqual(pair.control.initialRng, pair.initialRng);
  assert.deepEqual(pair.treatment.initialRng, pair.initialRng);
  assert.deepEqual(pair.control.fixedTacticsBySeat, pair.fixedTacticsBySeat);
  assert.deepEqual(pair.treatment.fixedTacticsBySeat, pair.fixedTacticsBySeat);
  assert.equal(pair.fixedTacticsBySeat[pair.focalSeat], "research-first");
  assert.ok(pair.fixedTacticsBySeat.every((tactic, seat) => seat === pair.focalSeat ? tactic === "research-first" : tactic === "force-first"));
  assert.deepEqual(pair.control.bypassedGateNames, []);
  assert.deepEqual(pair.treatment.bypassedGateNames, REQUIRED_BYPASSES);
  for (const [armName, arm, allowBypass] of [["control", pair.control, false], ["treatment", pair.treatment, true]]) {
    const recomputedOutcome = deriveArmOutcome(arm, pair, armName);
    const scoreByOutcome = { win: 1, draw: 0.5, loss: 0, incomplete: null, invalid: null };
    assert.equal(arm.outcome, recomputedOutcome, `pair ${pair.pairIndex} ${armName} outcome must derive from termination and winner`);
    assert.equal(arm.score, scoreByOutcome[recomputedOutcome], `${armName} score must match its recomputed outcome`);
    const accepted = arm.seats.reduce((sum, seat) => sum + seat.researchDraw.acceptedDraws, 0);
    const selected = arm.seats.reduce((sum, seat) => sum + (seat.commandCounts["draw-research"] ?? 0), 0);
    acceptedDraws += accepted;
    assert.equal(accepted, selected - arm.seats.reduce((sum, seat) => sum + seat.researchDraw.rejectedDraws, 0), `${armName} accepted draw count must reconcile with its command actions`);
    for (const opportunity of arm.researchDrawOpportunityTrace) {
      opportunityRows += 1;
      if (opportunity.selectorPath !== "optional-research-choice") {
        assert.equal(opportunity.effectiveEligible, null);
        continue;
      }
      optionalRows += 1;
      const activeBypass = allowBypass && opportunity.actor === pair.focalSeat;
      const bypasses = activeBypass ? REQUIRED_BYPASSES : [];
      const eligible = [...HARD_GATES, ...REQUIRED_BYPASSES].every((gate) => opportunity.factualGates[gate] || bypasses.includes(gate));
      assert.equal(opportunity.effectiveEligible, eligible, `pair ${pair.pairIndex} ${armName} effective gate eligibility must recompute`);
      assert.deepEqual(opportunity.bypassedGates, activeBypass ? REQUIRED_BYPASSES.filter((gate) => !opportunity.factualGates[gate]) : []);
      if (opportunity.selectedCommandType === "draw-research") {
        assert.ok(opportunity.legalDrawOption, "selected Research draw must retain hard legality");
        assert.ok(HARD_GATES.every((gate) => opportunity.factualGates[gate]), "selected Research draw must pass every retained hard gate");
        assert.ok(eligible, "selected Research draw must pass effective eligibility");
      }
      bypassedRows += opportunity.bypassedGates.length;
    }
  }
  assert.equal(pair.scoreDifferenceTreatmentMinusControl, pair.control.score === null || pair.treatment.score === null ? null : pair.treatment.score - pair.control.score);
}
function capReason(arm) {
  return arm.termination === "round-cap" || arm.termination === "action-safety-cap";
}

function deriveArmOutcome(arm, pair, armName) {
  const label = `pair ${pair.pairIndex} ${armName}`;
  assert.equal(arm.focalSeat, pair.focalSeat, `${label} focal seat must match its pair`);
  assert.ok(Object.hasOwn(arm, "invalidActionEvidence"), `${label} must retain invalid-action evidence, including null`);
  assert.ok(Object.hasOwn(arm, "winner"), `${label} must retain terminal winner evidence, including null`);
  const invalidEvidencePresent = arm.invalidActionEvidence != null;
  const winner = arm.winner;
  if (winner !== null) {
    assert.ok(winner && Number.isInteger(winner.playerIndex), `${label} winner must identify a player index`);
    assert.ok(winner.playerIndex >= 0 && winner.playerIndex < pair.playerCount, `${label} winner must be one of the players in the match`);
  }

  if (arm.termination === "invalid-action") {
    assert.ok(invalidEvidencePresent, `${label} invalid-action termination must include invalid-action evidence`);
    assert.equal(winner, null, `${label} invalid-action termination cannot also claim a winner`);
    return "invalid";
  }
  assert.equal(invalidEvidencePresent, false, `${label} invalid-action evidence requires invalid-action termination`);

  if (arm.termination === "terminal") {
    return winner === null ? "draw" : winner.playerIndex === pair.focalSeat ? "win" : "loss";
  }
  if (capReason(arm)) {
    assert.equal(winner, null, `${label} capped match cannot claim a terminal winner`);
    return "incomplete";
  }
  assert.fail(`${label} has unsupported termination value ${String(arm.termination)}`);
}

function dispositionFromArms(pair) {
  const arms = [pair.control, pair.treatment];
  if (arms.some((arm) => arm.invalidActionEvidence != null || arm.outcome === "invalid")) return "invalid-pair";
  if (arms.some((arm) => capReason(arm) || arm.outcome === "incomplete" || arm.score === null)) return "incomplete-pair";
  assert.ok(arms.every((arm) => ["win", "draw", "loss"].includes(arm.outcome)), `pair ${pair.pairIndex} has an unsupported terminal outcome`);
  assert.ok(arms.every((arm) => Number.isFinite(arm.score) && arm.score >= 0 && arm.score <= 1), `pair ${pair.pairIndex} has an invalid terminal score`);
  return "complete-pair";
}

const computedDispositionCounts = { "complete-pair": 0, "incomplete-pair": 0, "invalid-pair": 0 };
const computedOutcomeCounts = {
  control: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
  treatment: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
};
const matchDiagnostics = {
  control: { invalidMatches: 0, cappedMatches: 0 },
  treatment: { invalidMatches: 0, cappedMatches: 0 },
};
let lowerDifferenceBoundSum = 0;
let upperDifferenceBoundSum = 0;
for (const pair of pairs) {
  const disposition = dispositionFromArms(pair);
  assert.equal(pair.pairedStatus, disposition, `pair ${pair.pairIndex} stored disposition must match arm evidence`);
  computedDispositionCounts[disposition] += 1;
  for (const armName of ["control", "treatment"]) {
    const arm = pair[armName];
    assert.ok(OUTCOMES.includes(arm.outcome), `pair ${pair.pairIndex} ${armName} has unsupported outcome`);
    computedOutcomeCounts[armName][arm.outcome] += 1;
    matchDiagnostics[armName].invalidMatches += Number(arm.invalidActionEvidence != null || arm.outcome === "invalid");
    matchDiagnostics[armName].cappedMatches += Number(capReason(arm));
  }
  const controlScore = pair.control.score;
  const treatmentScore = pair.treatment.score;
  lowerDifferenceBoundSum += (treatmentScore ?? 0) - (controlScore ?? 1);
  upperDifferenceBoundSum += (treatmentScore ?? 1) - (controlScore ?? 0);
}
assert.deepEqual(artifact.summary.pairDispositionCounts, computedDispositionCounts, "summary pair dispositions must recompute from arm evidence");
assert.deepEqual(artifact.summary.outcomesByArm, computedOutcomeCounts, "summary arm outcome counts must recompute from arm evidence");
if (artifact.summary.matchExecutionDiagnostics) {
  assert.deepEqual(artifact.summary.matchExecutionDiagnostics, matchDiagnostics, "summary invalid/cap counts must recompute from arm evidence");
}
const worstCaseBounds = pairs.length
  ? [lowerDifferenceBoundSum / pairs.length, upperDifferenceBoundSum / pairs.length]
  : null;
assert.deepEqual(artifact.summary.pairedScore.worstCaseMeanDifferenceBoundsAcrossEveryRandomizedPair, worstCaseBounds, "worst-case score bounds must recompute from every arm pair");
for (const armName of ["control", "treatment"]) {
  const scores = pairs.flatMap((pair) => pair[armName].score === null ? [] : [pair[armName].score]);
  const computedMean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  assert.equal(artifact.summary.terminalMeanScoreByArm[armName], computedMean, `summary ${armName} terminal mean must recompute from arm evidence`);
}

const completePairs = pairs.filter((pair) => dispositionFromArms(pair) === "complete-pair");
const differences = completePairs.map((pair) => pair.scoreDifferenceTreatmentMinusControl);
const mean = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null;
const variance = differences.length > 1 ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (differences.length - 1) : null;
const standardError = variance === null ? null : Math.sqrt(variance / differences.length);
const confidenceInterval = mean === null || differences.length < 2
  ? null
  : [mean - tCritical975(differences.length - 1) * standardError, mean + tCritical975(differences.length - 1) * standardError];
assert.equal(artifact.summary.pairedScore.completeValidTerminalPairs, differences.length, "complete pair count must recompute from arms");
assert.equal(artifact.summary.pairedScore.meanDifference, mean, "raw mean paired score must recompute");
assert.equal(artifact.summary.pairedScore.sampleVarianceOfPairedDifferences, variance, "raw paired variance must recompute");
if (differences.length < 2) {
  assert.equal(artifact.summary.pairedScore.approximatePairedT95ConfidenceInterval, null, "fewer than two pairs must not claim a t interval");
} else {
  confidenceInterval.forEach((bound, index) => assert.ok(Math.abs(bound - artifact.summary.pairedScore.approximatePairedT95ConfidenceInterval[index]) < 1e-12, "raw paired t interval must recompute"));
}
const targetPairs = estimatePairsForPower(variance, 0.10, 0.80);
const requiredPairEstimate = targetPairs === null ? {
  status: differences.length < 2 ? "not estimable from fewer than two complete pairs" : "pilot sample variance is zero/nonpositive; do not infer confirmatory sample size",
  pairs: null,
} : {
  status: "approximate paired-t planning estimate based on pilot variance; confirmatory sample-size assumption only",
  pairs: targetPairs,
};

const currentSourceDiffs = Object.entries(artifact.runMetadata.sourceSha256).flatMap(([path, runHash]) => {
  try {
    const currentHash = digest(readFileSync(resolve(process.cwd(), path)));
    return currentHash === runHash ? [] : [{ path, runHash, currentHash }];
  } catch {
    return [{ path, runHash, currentHash: null }];
  }
});
const archivedHarnessPath = artifact.runMetadata.harnessSnapshotPath ?? "output/bot-strategy/research-gate-paired-pilot-harness-at-run-2026-09-29.tsx";
const archivedHarnessSha256 = digest(readFileSync(resolve(process.cwd(), archivedHarnessPath)));
const runRecordedHarnessSha256 = artifact.runMetadata.sourceSha256["scripts/verify-bot-research-gates-paired.tsx"];
assert.equal(archivedHarnessSha256, runRecordedHarnessSha256, "archived harness source must match the hash recorded during the run");
const archivedRunSources = Object.entries(artifact.runMetadata.sourceSnapshotPaths ?? {
  "scripts/verify-bot-research-gates-paired.tsx": archivedHarnessPath,
}).map(([sourcePath, snapshotPath]) => {
  const archivedSha256 = digest(readFileSync(resolve(process.cwd(), snapshotPath)));
  assert.equal(archivedSha256, artifact.runMetadata.sourceSha256[sourcePath], `${sourcePath} snapshot must match the hash recorded during the run`);
  return { sourcePath, snapshotPath, archivedSha256, matchesRunMetadata: true };
});
const preregistrationExport = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  status: artifact.externalPreregistration
    ? "EXTERNAL PRE-RUN REGISTRATION VERIFIED — companion archive exported after the run"
    : "POST-RUN ARCHIVE EXPORT — not an independently timestamped preregistration file",
  protocol: artifact.preregistration,
  preRunEvidence: artifact.externalPreregistration
    ? {
      sourcePath: artifact.externalPreregistration.path,
      sourceSha256: artifact.externalPreregistration.sha256,
      checkpointHelperSha256: artifact.runMetadata.sourceSha256["scripts/research-gate-checkpoint.mjs"] ?? null,
      sourceBytesVerifiedAgainstRun: true,
      registeredAt: artifact.externalPreregistration.registration.registeredAt ?? null,
      evidenceLimit: "The source registration is marked PRE-RUN and its exact bytes match the hash retained at run start. The analyzer does not independently establish the trustworthiness of the source timestamp.",
    }
    : {
      sourcePath: archivedHarnessPath,
      sourceSha256RecordedInRun: runRecordedHarnessSha256 ?? null,
      archivedSourceHashVerified: archivedHarnessSha256 === runRecordedHarnessSha256,
      evidenceLimit: "The archived harness contains the exact protocol bytes and matches the source hash retained in the raw run artifact. This companion JSON is emitted after the run; an independently timestamped pre-run JSON copy was not retained.",
    },
  rawArtifact: { path: artifactPath.replace(`${process.cwd()}/`, ""), sha256 },
};
const preregistrationPath = artifactPath.endsWith(".checkpoint.jsonl")
  ? artifactPath.replace(/\.checkpoint\.jsonl$/, "-preregistration-archive.json")
  : artifactPath.replace(/\.json$/, "-preregistration-archive.json");
writeFileSync(preregistrationPath, `${JSON.stringify(preregistrationExport, null, 2)}\n`);

const analysis = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rawArtifact: { path: artifactPath.replace(`${process.cwd()}/`, ""), sha256, bytes: bytes.length, gitHead: artifact.runMetadata.gitHead },
  studyStatus: artifact.studyStatus,
  checkpointCompleteness,
  inferentialUse: checkpointCompleteness?.complete
    ? "The checkpoint contains every preregistered pair; it is analyzable as the full randomized block, subject to the preregistered stage and decision rule."
    : checkpointCompleteness
      ? "Partial checkpoint only: interim descriptive variance and diagnostics; not confirmatory and not a policy decision. Resume the same checkpoint to reach the preregistered pair count."
      : "Use is constrained by the preregistered study stage and decision rule.",
  preregistration: {
    outcome: "Focal terminal score W=1, D=0.5, L=0; treatment minus control.",
    minimumMeaningfulDifference: 0.10,
    alpha: 0.05,
    targetPower: 0.80,
  },
  independentValidation: {
    pairCount: pairs.length,
    uniquePairSeeds: new Set(pairs.map((pair) => pair.seed)).size,
    uniqueSetupHashes: new Set(pairs.map((pair) => pair.initialStateSha256)).size,
    fullSetupSnapshotsHashVerified: true,
    exactControlTreatmentSetupCloneProtocol: "Both arms are run from the same retained initialStateSnapshot; their initial RNG, roster and pinned tactic vectors were independently checked.",
    randomizedArmOrderReproduced: true,
    treatmentGateNamesExact: true,
    opportunityRows: { deployWindows: opportunityRows, optionalGateEvaluations: optionalRows, factualUrgencyGatesBypassed: bypassedRows, acceptedDraws },
    incompleteAndInvalidRetention: {
      retainedPairs: pairs.length,
      pairDispositionCounts: computedDispositionCounts,
      matchesByArm: matchDiagnostics,
      outcomesByArm: computedOutcomeCounts,
      worstCaseMeanDifferenceBoundsAcrossEveryRandomizedPair: worstCaseBounds,
    },
    focalComposition: artifact.summary.setupComposition,
    pairedScoreRecomputed: { completePairs: differences.length, meanDifference: mean, sampleVariance: variance, sampleSD: variance === null ? null : Math.sqrt(variance), standardError, approximatePairedT95ConfidenceInterval: confidenceInterval },
  },
  pilotPowerPlanning: studyStage === "pilot" ? {
    method: "Normal approximation to a two-sided paired t test, using the observed sample variance of complete pilot paired differences and the registered 0.10 mean-score difference. Approximate t critical values are used; this is a planning estimate, not confirmatory inference.",
    estimatedPowerAtPilotNForMmd: variance === null ? null : estimatedPower(differences.length, variance, 0.10),
    estimatedRequiredPairsFor80PercentPower: requiredPairEstimate,
    status: targetPairs === null
      ? "The pilot variance does not yield a usable target-pair estimate; no policy claim or default change."
      : differences.length < targetPairs
        ? "Pilot is undersized for its estimated target; no policy claim or default change."
        : "The pilot reaches the variance-based numerical target, but remains explicitly a pilot and does not authorize a policy change.",
    caveat: "Variance from a small pilot is noisy and may underestimate future variance. Confirm with a separately randomized study of at least the planned pair count, including the same balanced setup blocks and cap policy.",
  } : null,
  confirmatoryDecisionStatus: studyStage === "confirmatory" ? {
    status: checkpointCompleteness && !checkpointCompleteness.complete
      ? "Incomplete checkpoint; interim diagnostics only. Resume the same preregistered block before a confirmatory decision."
      : "Full preregistered block analyzed; inspect the reported confidence interval, retained cap/invalid evidence, and registered decision rule before any policy decision.",
    registeredDecisionRule: artifact.externalPreregistration?.registration.decisionRule ?? artifact.preregistration.decisionRule,
    defaultPolicyChanged: false,
  } : null,
  interpretation: studyStage === "pilot"
    ? "Descriptive gate-bypass pilot only. It estimates the bundled effect of removing both urgency gates for a research-first focal bot against force-first opponents; it cannot identify either gate's separate contribution or validate physical-edition rules."
    : "Gate-bypass confirmatory experiment. It estimates the bundled effect of removing both urgency gates for a research-first focal bot against force-first opponents; it cannot identify either gate's separate contribution or validate physical-edition rules.",
  provenance: {
    sourceHashesAtRun: artifact.runMetadata.sourceSha256,
    currentSourceComparison: { filesCompared: Object.keys(artifact.runMetadata.sourceSha256).length, changedSinceRun: currentSourceDiffs },
    archivedPreRunHarness: { path: archivedHarnessPath, sha256: archivedHarnessSha256, matchesRunMetadata: archivedHarnessSha256 === runRecordedHarnessSha256 },
    archivedRunSources,
    runWindowSourceSnapshot: null,
    runWindowSourceSnapshotNote: "No ambient /tmp snapshot is loaded: provenance is tied to source hashes embedded in the raw run artifact, plus a direct comparison with current files.",
    preregistrationArchivePath: preregistrationPath.replace(`${process.cwd()}/`, ""),
    preregistrationArchiveStatus: preregistrationExport.status,
    analyzerPath: "scripts/analyze-bot-research-gates-pilot.mjs",
    analyzerSha256,
  },
};
writeFileSync(sidecarPath, `${JSON.stringify(analysis, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ sidecarPath, preregistrationPath, artifactSha256: sha256, pairs: pairs.length, completePairs: differences.length, meanDifference: mean, variance, requiredPairEstimate }, null, 2)}\n`);
