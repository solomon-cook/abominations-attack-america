import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireCheckpointLock, appendCheckpointPair, assertCheckpointCompatible, createCheckpoint, readCheckpoint, repairCheckpointTail, sha256, summarizeResearchGatePairs } from "./research-gate-checkpoint.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("checkpoint writes durable checksummed pair rows and repairs only an incomplete tail", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "research-gate-checkpoint-"));
  try {
    const path = resolve(directory, "run.checkpoint.jsonl");
    const header = { targetPairCount: 2, campaignIdentitySha256: "fingerprint" };
    createCheckpoint(path, header);
    const pair = { pairIndex: 0, value: "first completed pair" };
    appendCheckpointPair(path, pair);
    appendFileSync(path, "{interrupted write");
    const repairedRead = readCheckpoint(path, { repairTrailingPartialLine: true });
    assert.equal(repairedRead.discardedByteLength, Buffer.byteLength("{interrupted write"));
    repairCheckpointTail(path, repairedRead.validByteLength);
    const restored = readCheckpoint(path);
    assert.deepEqual(restored.header, header);
    assert.deepEqual(restored.pairs, [pair]);
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    const corrupt = JSON.parse(lines[1]);
    corrupt.pair.value = "tampered";
    lines[1] = JSON.stringify(corrupt);
    writeFileSync(path, `${lines.join("\n")}\n`);
    assert.throws(() => readCheckpoint(path), /checksum must match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resume compatibility rejects changes to block size, source identity, or protocol", () => {
  const header = {
    campaignIdentitySha256: "current-source-fingerprint",
    targetPairCount: 240,
    config: { pairCount: 240, seedStart: 7300, orderSeed: 20260930 },
    preregistration: { stage: "confirmatory", alpha: 0.05 },
  };
  const expected = {
    campaignIdentitySha256: header.campaignIdentitySha256,
    config: header.config,
    preregistration: header.preregistration,
  };
  assertCheckpointCompatible(header, expected);
  assert.throws(() => assertCheckpointCompatible(header, { ...expected, campaignIdentitySha256: "different-bots-or-harness" }), /exact source hashes/);
  assert.throws(() => assertCheckpointCompatible(header, { ...expected, config: { ...header.config, pairCount: 241 } }), /target pair count/);
  assert.throws(() => assertCheckpointCompatible(header, { ...expected, preregistration: { ...header.preregistration, alpha: 0.01 } }), /protocol must match/);
});

test("paired harness constructs the full-block protocol without running matches", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "research-gate-plan-"));
  try {
    const checkpointPath = resolve(directory, "must-not-be-created.checkpoint.jsonl");
    const result = spawnSync(process.execPath, [
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig", resolve(root, "apps/web/tsconfig.json"),
      resolve(root, "scripts/verify-bot-research-gates-paired.tsx"),
      "--pair-count=240", "--seed-start=7300", "--order-seed=20260930", "--max-rounds=12", "--study-stage=pilot", "--plan-only",
      `--checkpoint=${checkpointPath}`,
    ], { cwd: root, encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(result.stdout);
    assert.match(plan.status, /^PLAN_ONLY/);
    assert.equal(plan.config.pairCount, 240);
    assert.equal(plan.config.seedStart, 7300);
    assert.equal(plan.config.orderSeed, 20260930);
    assert.equal(plan.config.armOrderCounts.controlFirst + plan.config.armOrderCounts.treatmentFirst, 240);
    assert.equal(existsSync(checkpointPath), false, "plan-only must not create a checkpoint or start a match");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("confirmatory mode verifies a confirmatory preregistration against every generated protocol field", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "research-gate-confirmatory-registration-"));
  const checkpointPath = resolve(directory, "must-not-be-created.checkpoint.jsonl");
  const registrationPath = resolve(directory, "registration.json");
  const args = [
    resolve(root, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", resolve(root, "apps/web/tsconfig.json"),
    resolve(root, "scripts/verify-bot-research-gates-paired.tsx"),
    "--pair-count=240", "--seed-start=9000", "--order-seed=20261001", "--max-rounds=12", "--study-stage=confirmatory", "--plan-only",
    `--checkpoint=${checkpointPath}`,
  ];
  const invoke = (registration) => {
    writeFileSync(registrationPath, `${JSON.stringify(registration, null, 2)}\n`);
    return spawnSync(process.execPath, [...args, `--preregistration=${registrationPath}`], {
      cwd: root, encoding: "utf8", timeout: 20_000,
    });
  };
  try {
    const planProcess = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 20_000 });
    assert.equal(planProcess.status, 0, planProcess.stderr || planProcess.stdout);
    const plan = JSON.parse(planProcess.stdout);
    const registration = {
      status: "PRE-RUN REGISTERED CONFIRMATORY",
      stage: "confirmatory",
      registeredAt: new Date().toISOString(),
      protocol: plan.preregistration,
      configuration: plan.config,
      source: {
        gitHead: plan.gitHead,
        harnessSha256: plan.sourceSha256["scripts/verify-bot-research-gates-paired.tsx"],
        checkpointHarnessSha256: plan.sourceSha256["scripts/research-gate-checkpoint.mjs"],
        botsTsSha256: plan.sourceSha256["packages/game-engine/src/bots.ts"],
      },
    };
    const valid = invoke(registration);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.match(JSON.parse(valid.stdout).status, /^PLAN_ONLY/);

    const pilot = invoke({ ...registration, stage: "pilot", status: "PRE-RUN REGISTERED PILOT" });
    assert.equal(pilot.status, 1);
    assert.match(pilot.stderr, /explicitly confirmatory pre-run registration/);

    const decisionMismatch = invoke({ ...registration, protocol: { ...registration.protocol, decisionRule: `${registration.protocol.decisionRule} Altered.` } });
    assert.equal(decisionMismatch.status, 1);
    assert.match(decisionMismatch.stderr, /full registered protocol must exactly match/);

    for (const field of ["treatment", "incompletePairHandling", "powerPlanning", "rngDivergence"]) {
      const protocolMismatch = invoke({ ...registration, protocol: { ...registration.protocol, [field]: `${registration.protocol[field]} Altered.` } });
      assert.equal(protocolMismatch.status, 1, `${field} mismatch must be rejected`);
      assert.match(protocolMismatch.stderr, /full registered protocol must exactly match/);
    }
    assert.equal(existsSync(checkpointPath), false, "registration checks must finish without creating a checkpoint or starting a match");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkpoint lock rejects a second process and gives safe stale-lock recovery instructions", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "research-gate-lock-"));
  const checkpointPath = resolve(directory, "run.checkpoint.jsonl");
  const owner = acquireCheckpointLock(checkpointPath);
  try {
    const moduleUrl = new URL("./research-gate-checkpoint.mjs", import.meta.url).href;
    const code = `import { acquireCheckpointLock } from ${JSON.stringify(moduleUrl)}; try { acquireCheckpointLock(process.argv[1]); } catch (error) { process.stderr.write(error.message); process.exit(23); }`;
    const contender = spawnSync(process.execPath, ["--input-type=module", "-e", code, checkpointPath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(contender.status, 23);
    assert.match(contender.stderr, /Checkpoint is locked/);
    assert.match(contender.stderr, /verify that no runner is active on the recorded host/);
    assert.match(contender.stderr, /never clears stale locks automatically/);
  } finally {
    owner.release();
  }
  assert.equal(existsSync(`${checkpointPath}.lock`), false);
  const resumedOwner = acquireCheckpointLock(checkpointPath);
  resumedOwner.release();
  assert.equal(existsSync(`${checkpointPath}.lock`), false);
  rmSync(directory, { recursive: true, force: true });
});

test("checkpoint analyzer validates and analyzes a retained pair without running a match", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "research-gate-analyzer-"));
  try {
    const fixturePath = resolve(root, "output/bot-strategy/research-gate-paired-pilot-2026-09-29.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const reconstructedSummary = summarizeResearchGatePairs(fixture.pairs);
    delete reconstructedSummary.matchExecutionDiagnostics;
    assert.deepEqual(reconstructedSummary, fixture.summary, "shared checkpoint summary must match the established full-artifact summary except for newly retained cap/invalid counts");
    const pairs = [fixture.pairs[0]];
    const helperSourcePath = "scripts/research-gate-checkpoint.mjs";
    const helperSource = readFileSync(resolve(root, helperSourcePath));
    const helperSnapshotPath = resolve(directory, "checkpoint-helper-at-run.mjs");
    writeFileSync(helperSnapshotPath, helperSource);
    const runMetadata = {
      ...fixture.runMetadata,
      sourceSha256: { ...fixture.runMetadata.sourceSha256, [helperSourcePath]: sha256(helperSource) },
      sourceSnapshotPaths: {
        "scripts/verify-bot-research-gates-paired.tsx": fixture.runMetadata.harnessSnapshotPath ?? "output/bot-strategy/research-gate-paired-pilot-harness-at-run-2026-09-29.tsx",
        [helperSourcePath]: helperSnapshotPath,
      },
    };
    const preregistration = fixture.preregistration;
    const config = fixture.config;
    const externalPreregistration = null;
    const studyStatus = fixture.studyStatus;
    const identity = {
      gitHead: runMetadata.gitHead,
      sourceSha256: runMetadata.sourceSha256,
      preregistration,
      config,
      studyStatus,
      externalPreregistration,
    };
    const checkpointPath = resolve(directory, "partial.checkpoint.jsonl");
    createCheckpoint(checkpointPath, {
      schemaVersion: 1,
      targetPairCount: config.pairCount,
      campaignIdentitySha256: sha256(JSON.stringify(identity)),
      studyStatus,
      runMetadata,
      preregistration,
      config,
      externalPreregistration,
    });
    appendCheckpointPair(checkpointPath, pairs[0]);
    const analysis = spawnSync(process.execPath, [resolve(root, "scripts/analyze-bot-research-gates-pilot.mjs"), checkpointPath], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(analysis.status, 0, analysis.stderr || analysis.stdout);
    const sidecarPath = checkpointPath.replace(/\.checkpoint\.jsonl$/, "-analysis.json");
    const result = JSON.parse(readFileSync(sidecarPath, "utf8"));
    assert.equal(result.checkpointCompleteness.status, "partial-nonconfirmatory-checkpoint");
    assert.equal(result.checkpointCompleteness.completedPairCount, 1);
    assert.equal(result.checkpointCompleteness.targetPairCount, config.pairCount);
    assert.equal(result.provenance.archivedRunSources.length, 2);
    assert.equal(result.independentValidation.pairedScoreRecomputed.completePairs, Number(pairs[0].pairedStatus === "complete-pair"));
    assert.match(result.studyStatus, /^INCOMPLETE CHECKPOINT — /);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkpoint summary retains incomplete and invalid randomized pairs in cap bounds", () => {
  const emptyDiagnostics = {
    deployWindows: 0, legalDrawOptions: 0, legalDeploymentChoices: 0, deploymentChoiceHistogram: {}, optionalGateEvaluations: 0,
    actualGatePassCounts: {}, actualGateFailCounts: {}, effectiveEligibleOpportunities: 0, optionalDrawSelections: 0,
    noDeploymentChoiceDrawSelections: 0, acceptedDraws: 0, rejectedDraws: 0, selectorPathsSkipped: {}, deployWindowsWithoutTrace: 0,
  };
  const arm = (outcome, score, termination, invalidActionEvidence = null) => ({
    outcome, score, termination, invalidActionEvidence, actions: 1, seats: [{ researchDraw: emptyDiagnostics }],
  });
  const base = { focalSeat: 0, focalMonster: "M", focalBranch: "B", focalLair: "L", focalLairSlot: 0, playerCount: 3,
    setupAssignments: [{ monster: "M", branch: "B", lair: "L" }], firstCommandDivergenceAction: null, firstRngCursorDivergenceAction: null };
  const pairs = [
    { ...base, pairIndex: 0, pairedStatus: "incomplete-pair", scoreDifferenceTreatmentMinusControl: null, control: arm("incomplete", null, "round-cap"), treatment: arm("win", 1, "terminal") },
    { ...base, pairIndex: 1, pairedStatus: "invalid-pair", scoreDifferenceTreatmentMinusControl: null, control: arm("invalid", null, "invalid-action", { error: "fixture" }), treatment: arm("loss", 0, "terminal") },
  ];
  const summary = summarizeResearchGatePairs(pairs);
  assert.deepEqual(summary.pairDispositionCounts, { "complete-pair": 0, "incomplete-pair": 1, "invalid-pair": 1 });
  assert.deepEqual(summary.matchExecutionDiagnostics.control, { invalidMatches: 1, cappedMatches: 1 });
  assert.deepEqual(summary.pairedScore.worstCaseMeanDifferenceBoundsAcrossEveryRandomizedPair, [-0.5, 0.5]);
});
