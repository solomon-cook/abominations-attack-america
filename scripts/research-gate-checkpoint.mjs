import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { closeSync, fsyncSync, openSync, readFileSync, truncateSync, unlinkSync, writeSync } from "node:fs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function line(record) {
  return `${JSON.stringify(record)}\n`;
}

function writeFully(fd, value) {
  const bytes = Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, null);
  fsyncSync(fd);
}

export function createCheckpoint(path, header) {
  const payload = { type: "header", schemaVersion: 1, header };
  const record = { ...payload, recordSha256: sha256(JSON.stringify(payload)) };
  const fd = openSync(path, "wx", 0o600);
  try { writeFully(fd, line(record)); } finally { closeSync(fd); }
  return record;
}

export function appendCheckpointPair(path, pair) {
  const payload = { type: "pair", pairIndex: pair.pairIndex, pair };
  const record = { ...payload, recordSha256: sha256(JSON.stringify(payload)) };
  const fd = openSync(path, "a", 0o600);
  try { writeFully(fd, line(record)); } finally { closeSync(fd); }
  return record;
}

export function readCheckpoint(path, { repairTrailingPartialLine = false } = {}) {
  const bytes = readFileSync(path);
  const lastNewline = bytes.lastIndexOf(0x0a);
  const validByteLength = lastNewline + 1;
  const discardedByteLength = bytes.length - validByteLength;
  if (discardedByteLength && !repairTrailingPartialLine) {
    throw new Error(`Checkpoint has ${discardedByteLength} trailing bytes without a complete JSONL record.`);
  }
  if (!validByteLength) throw new Error("Checkpoint is empty or has no complete header record.");
  const records = bytes.subarray(0, validByteLength).toString("utf8").trimEnd().split("\n").map((entry, index) => {
    let parsed;
    try { parsed = JSON.parse(entry); } catch (error) {
      throw new Error(`Checkpoint line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { recordSha256, ...payload } = parsed;
    assert.equal(recordSha256, sha256(JSON.stringify(payload)), `checkpoint line ${index + 1} checksum must match`);
    return parsed;
  });
  assert.equal(records[0]?.type, "header", "first checkpoint record must be the header");
  assert.equal(records[0]?.schemaVersion, 1, "unsupported checkpoint schema version");
  const pairs = [];
  for (const [offset, record] of records.slice(1).entries()) {
    assert.equal(record.type, "pair", `checkpoint line ${offset + 2} must contain a pair record`);
    assert.equal(record.pairIndex, pairs.length, "checkpoint pair records must be a contiguous prefix starting at zero");
    assert.equal(record.pair?.pairIndex, record.pairIndex, "checkpoint row index must match its embedded pair");
    pairs.push(record.pair);
  }
  return {
    header: records[0].header,
    pairs,
    validByteLength,
    discardedByteLength,
  };
}

export function repairCheckpointTail(path, validByteLength) {
  truncateSync(path, validByteLength);
}

export function assertCheckpointCompatible(header, expected) {
  assert.equal(header.campaignIdentitySha256, expected.campaignIdentitySha256, "checkpoint must match exact source hashes, preregistration, seeds, caps, and target pair count");
  assert.equal(header.targetPairCount, expected.config.pairCount, "checkpoint target pair count must match the preregistered configuration");
  assert.deepEqual(header.config, expected.config, "checkpoint run configuration must match");
  assert.deepEqual(header.preregistration, expected.preregistration, "checkpoint protocol must match");
}

export function validateConfirmatoryRegistration(registration, { protocol, dirtyGameEnginePaths }) {
  assert.match(registration.status ?? "", /^PRE-RUN REGISTERED CONFIRMATORY(?:$|\s|—)/, "confirmatory runs require an explicitly confirmatory pre-run registration");
  assert.equal(registration.stage, "confirmatory", "pre-run registration stage must be confirmatory");
  assert.ok(Number.isFinite(Date.parse(registration.registeredAt ?? "")), "pre-run registration must retain a valid registeredAt timestamp");
  assert.ok(Date.parse(registration.registeredAt) <= Date.parse(protocol.runMetadata.startedAt), "pre-run registration timestamp must be at or before runner start");
  assert.deepEqual(registration.protocol, protocol.preregistration, "full registered protocol must exactly match every generated preregistration field");
  assert.deepEqual(registration.configuration, protocol.config, "full registered configuration and randomized assignment schedule must match the generated protocol");
  assert.equal(registration.source?.gitHead, protocol.runMetadata.gitHead, "registration source revision must match the run");
  assert.equal(registration.source?.harnessSha256, protocol.runMetadata.sourceSha256["scripts/verify-bot-research-gates-paired.tsx"], "registered harness hash must match the run");
  assert.equal(registration.source?.checkpointHarnessSha256, protocol.runMetadata.sourceSha256["scripts/research-gate-checkpoint.mjs"], "registered checkpoint helper hash must match the run");
  const engineBotsHash = protocol.runMetadata.sourceSha256["packages/game-engine/src/bots.ts"];
  assert.equal(registration.source?.botsTsSha256, engineBotsHash, "registered bot source hash must match the run");
  assert.deepEqual(dirtyGameEnginePaths, [], "confirmatory runs require clean packages/game-engine/src working-tree sources so recorded hashes resolve to the registered commit");
}

export function acquireCheckpointLock(checkpointPath) {
  const lockPath = `${checkpointPath}.lock`;
  const ownerToken = randomUUID();
  const metadata = { ownerToken, pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), checkpointPath };
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing = "unreadable lock metadata";
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      existing = `pid ${lock.pid ?? "unknown"} on ${lock.host ?? "unknown host"}, started ${lock.startedAt ?? "unknown time"}`;
    } catch { /* Keep the stale-lock recovery instructions useful for damaged lock files too. */ }
    throw new Error(`Checkpoint is locked (${existing}). If the owner process was terminated abruptly, verify that no runner is active on the recorded host, then remove ${lockPath} and resume. The runner never clears stale locks automatically.`);
  }
  try {
    writeFully(fd, `${JSON.stringify(metadata)}\n`);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* Best effort cleanup of this process's newly created lock. */ }
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    metadata,
    release() {
      if (released) return;
      released = true;
      closeSync(fd);
      try {
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        if (current.ownerToken === ownerToken) unlinkSync(lockPath);
      } catch { /* Do not remove a lock whose ownership cannot be verified. */ }
    },
  };
}

const RESEARCH_GATES = [
  "researchDeckAvailable",
  "deploymentNotStarted",
  "researchHandBelowTwo",
  "researchFirstPolicy",
  "activeMilitaryScreen",
  "objectiveThreatAbsent",
  "blockerOpportunityAbsent",
];

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function emptyResearchDrawDiagnostics() {
  return {
    deployWindows: 0,
    legalDrawOptions: 0,
    legalDeploymentChoices: 0,
    deploymentChoiceHistogram: {},
    optionalGateEvaluations: 0,
    actualGatePassCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])),
    actualGateFailCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])),
    effectiveEligibleOpportunities: 0,
    optionalDrawSelections: 0,
    noDeploymentChoiceDrawSelections: 0,
    acceptedDraws: 0,
    rejectedDraws: 0,
    selectorPathsSkipped: {},
    deployWindowsWithoutTrace: 0,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function tCritical975(df) {
  const z = 1.959963984540054;
  return z
    + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

export function summarizeResearchGatePairs(pairs) {
  const complete = pairs.filter((pair) => pair.pairedStatus === "complete-pair");
  const differences = complete.map((pair) => pair.scoreDifferenceTreatmentMinusControl);
  const mean = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null;
  const variance = differences.length > 1 ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (differences.length - 1) : null;
  const standardError = variance === null ? null : Math.sqrt(variance / differences.length);
  const confidenceInterval = mean === null || differences.length < 2
    ? null
    : [mean - tCritical975(differences.length - 1) * standardError, mean + tCritical975(differences.length - 1) * standardError];
  const outcomes = (arm) => Object.fromEntries(["win", "draw", "loss", "incomplete", "invalid"].map((result) => [result, pairs.filter((pair) => pair[arm].outcome === result).length]));
  let worstCaseLower = 0;
  let worstCaseUpper = 0;
  for (const pair of pairs) {
    const treatmentScore = pair.treatment.score;
    const controlScore = pair.control.score;
    worstCaseLower += (treatmentScore ?? 0) - (controlScore ?? 1);
    worstCaseUpper += (treatmentScore ?? 1) - (controlScore ?? 0);
  }
  const focalCounts = (key) => pairs.reduce((counts, pair) => { increment(counts, pair[key]); return counts; }, {});
  const lairSlotsByMonster = pairs.reduce((counts, pair) => {
    counts[pair.focalMonster] ??= {};
    increment(counts[pair.focalMonster], String(pair.focalLairSlot));
    return counts;
  }, {});
  const meanScore = (arm) => {
    const scores = pairs.flatMap((pair) => pair[arm].score === null ? [] : [pair[arm].score]);
    return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  };
  const matchExecutionDiagnostics = Object.fromEntries(["control", "treatment"].map((arm) => [arm, {
    invalidMatches: pairs.filter((pair) => pair[arm].invalidActionEvidence !== null || pair[arm].outcome === "invalid").length,
    cappedMatches: pairs.filter((pair) => pair[arm].termination === "round-cap" || pair[arm].termination === "action-safety-cap").length,
  }]));
  const allSeatCounts = (key) => pairs.flatMap((pair) => pair.setupAssignments).reduce((counts, seat) => { increment(counts, seat[key]); return counts; }, {});
  return {
    pairCount: pairs.length,
    pairDispositionCounts: Object.fromEntries(["complete-pair", "incomplete-pair", "invalid-pair"].map((status) => [status, pairs.filter((pair) => pair.pairedStatus === status).length])),
    outcomesByArm: { control: outcomes("control"), treatment: outcomes("treatment") },
    matchExecutionDiagnostics,
    terminalMeanScoreByArm: { control: meanScore("control"), treatment: meanScore("treatment") },
    pairedScore: {
      estimand: "Mean focal score (urgency-gates-bypassed minus control); win=1, draw=0.5, loss=0.",
      completeValidTerminalPairs: differences.length,
      meanDifference: mean,
      sampleVarianceOfPairedDifferences: variance,
      standardError,
      approximatePairedT95ConfidenceInterval: confidenceInterval,
      discordantPairs: differences.filter((value) => value !== 0).length,
      favoringTreatment: differences.filter((value) => value > 0).length,
      favoringControl: differences.filter((value) => value < 0).length,
      worstCaseMeanDifferenceBoundsAcrossEveryRandomizedPair: pairs.length ? [worstCaseLower / pairs.length, worstCaseUpper / pairs.length] : null,
    },
    setupComposition: {
      playerCounts: Object.fromEntries([3, 4].map((count) => [String(count), pairs.filter((pair) => pair.playerCount === count).length])),
      focalSeats: Object.fromEntries([...new Set(pairs.map((pair) => pair.focalSeat))].sort().map((seat) => [String(seat), pairs.filter((pair) => pair.focalSeat === seat).length])),
      focalMonsters: focalCounts("focalMonster"),
      focalBranches: focalCounts("focalBranch"),
      focalLairs: focalCounts("focalLair"),
      focalLairSlots: pairs.reduce((counts, pair) => { increment(counts, String(pair.focalLairSlot)); return counts; }, {}),
      focalLairSlotsByMonster: lairSlotsByMonster,
      allSeatMonsters: allSeatCounts("monster"),
      allSeatBranches: allSeatCounts("branch"),
      allSeatLairs: allSeatCounts("lair"),
    },
    executionDiagnostics: {
      controlActions: pairs.reduce((sum, pair) => sum + pair.control.actions, 0),
      treatmentActions: pairs.reduce((sum, pair) => sum + pair.treatment.actions, 0),
      pairsWithCommandDivergence: pairs.filter((pair) => pair.firstCommandDivergenceAction !== null).length,
      pairsWithRngCursorDivergence: pairs.filter((pair) => pair.firstRngCursorDivergenceAction !== null).length,
      medianFirstCommandDivergenceAction: median(pairs.flatMap((pair) => pair.firstCommandDivergenceAction === null ? [] : [pair.firstCommandDivergenceAction])),
      medianFirstRngCursorDivergenceAction: median(pairs.flatMap((pair) => pair.firstRngCursorDivergenceAction === null ? [] : [pair.firstRngCursorDivergenceAction])),
    },
    researchDrawDiagnosticsByArm: Object.fromEntries(["control", "treatment"].map((arm) => {
      const focal = pairs.map((pair) => pair[arm].seats[pair.focalSeat].researchDraw);
      const totalStats = emptyResearchDrawDiagnostics();
      for (const stats of focal) {
        totalStats.deployWindows += stats.deployWindows;
        totalStats.legalDrawOptions += stats.legalDrawOptions;
        totalStats.legalDeploymentChoices += stats.legalDeploymentChoices;
        for (const [count, windows] of Object.entries(stats.deploymentChoiceHistogram)) increment(totalStats.deploymentChoiceHistogram, count, windows);
        totalStats.optionalGateEvaluations += stats.optionalGateEvaluations;
        totalStats.effectiveEligibleOpportunities += stats.effectiveEligibleOpportunities;
        totalStats.optionalDrawSelections += stats.optionalDrawSelections;
        totalStats.noDeploymentChoiceDrawSelections += stats.noDeploymentChoiceDrawSelections;
        totalStats.acceptedDraws += stats.acceptedDraws;
        totalStats.rejectedDraws += stats.rejectedDraws;
        totalStats.deployWindowsWithoutTrace += stats.deployWindowsWithoutTrace;
        for (const gate of RESEARCH_GATES) {
          totalStats.actualGatePassCounts[gate] += stats.actualGatePassCounts[gate];
          totalStats.actualGateFailCounts[gate] += stats.actualGateFailCounts[gate];
        }
        for (const [selectorPath, count] of Object.entries(stats.selectorPathsSkipped)) increment(totalStats.selectorPathsSkipped, selectorPath, count);
      }
      return [arm, { focalSeatMatches: focal.length, ...totalStats }];
    })),
  };
}
