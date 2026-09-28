import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyCommand,
  applyCompletedSetup,
  boardForState,
  chooseBranch,
  chooseLair,
  chooseMonster,
  createMvpRoomGame,
  deploymentChoices,
  type GameState,
  type SetupState,
} from "../packages/game-engine/src/index.js";
import { botTacticForPlayer, chooseBotCommand, chooseBotSetupAction, type BotDeployDecisionDiagnostics, type BotResearchDrawGateDiagnostics, type BotTactic } from "../packages/game-engine/src/bots.js";

const DEFAULT_PAIR_COUNT = 7;
const DEFAULT_SEED_START = 3100;
const DEFAULT_MAX_ROUNDS = 12;
const ACTION_SAFETY_CAP = 2_000;
const TREATMENTS: readonly BotTactic[] = ["force-first", "research-first"];
const ROTATION_PLAN: ReadonlyArray<readonly [3 | 4, number]> = [
  [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [4, 2], [4, 3],
];

function readIntegerArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((arg) => arg.startsWith(prefix));
  if (matches.length > 1) throw new Error(`${name} may be specified only once`);
  const raw = matches[0]?.slice(prefix.length);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

const pairCount = readIntegerArg("pair-count", DEFAULT_PAIR_COUNT);
const seedStart = readIntegerArg("seed-start", DEFAULT_SEED_START);
const maxRounds = readIntegerArg("max-rounds", DEFAULT_MAX_ROUNDS);
assert.ok(pairCount > 0 && pairCount <= 28, "pair-count must be between 1 and 28");
assert.ok(maxRounds > 0 && maxRounds <= 100, "max-rounds must be between 1 and 100");
assert.ok(seedStart + pairCount - 1 <= Number.MAX_SAFE_INTEGER, "seed range must stay within safe integers");

function seededRandom(seed: number): () => number {
  let value = (seed >>> 0) || 0x9e3779b9;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function rotated<T>(values: readonly T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function completeRotatedSetup(playerCount: 3 | 4, seed: number, rotation: number): GameState {
  const game = createMvpRoomGame(playerCount, seed, `bot-policy-pair-${playerCount}-${seed}`);
  const random = seededRandom(seed ^ Math.imul(playerCount, 0x85ebca6b));
  const setupDefinition = game.setupState!.definition;
  const monsterBySeat = rotated(shuffled(setupDefinition.monsterIds, random), rotation).slice(0, playerCount);
  const branchBySeat = rotated(shuffled(setupDefinition.eligibleBranches, random), rotation + 1).slice(0, playerCount);
  let setup: SetupState = game.setupState!;

  for (let step = 0; setup.phase !== "complete" && step < playerCount * 4; step += 1) {
    if (setup.phase === "monster-selection") {
      const seat = setup.seats.find((candidate) => candidate.monsterId === undefined);
      assert.ok(seat, "monster-selection must have an undecided seat");
      setup = chooseMonster(setup, seat.playerIndex, monsterBySeat[seat.playerIndex]!);
      continue;
    }
    if (setup.phase === "branch-selection") {
      const seat = [...setup.seats].reverse().find((candidate) => candidate.branch === undefined);
      assert.ok(seat, "branch-selection must have an undecided seat");
      setup = chooseBranch(setup, seat.playerIndex, branchBySeat[seat.playerIndex]!);
      continue;
    }
    if (setup.phase === "lair-selection") {
      const seat = setup.seats.find((candidate) => candidate.lair === undefined);
      assert.ok(seat, "lair-selection must have an undecided seat");
      const options = setup.definition.lairsByMonster[seat.monsterId!]
        ?.filter((lair) => !setup.seats.some((candidate) => candidate.lair === lair)) ?? [];
      assert.ok(options.length > 0, `monster ${seat.monsterId} must have an available lair`);
      const lairIndex = (rotation + seat.playerIndex) % options.length;
      setup = chooseLair(setup, seat.playerIndex, options[lairIndex]!);
      continue;
    }
    const seat = setup.seats.find((candidate) => candidate.startingChoice === undefined);
    assert.ok(seat, "starting-choice must have an undecided seat");
    const next = chooseBotSetupAction({ ...game, setupState: setup }, setup, seat.playerIndex);
    assert.notEqual(next, setup, `starting-choice should advance for seat ${seat.playerIndex}`);
    setup = next;
  }

  assert.equal(setup.phase, "complete", `${playerCount}-seat setup should complete`);
  assert.equal(new Set(setup.seats.map((seat) => seat.monsterId)).size, playerCount, "monsters must be distinct");
  assert.equal(new Set(setup.seats.map((seat) => seat.branch)).size, playerCount, "branches must be distinct");
  assert.equal(new Set(setup.seats.map((seat) => seat.lair)).size, playerCount, "lairs must be distinct");
  return applyCompletedSetup({ ...game, setupState: setup });
}

type FocalOutcome = "win" | "draw" | "loss" | "incomplete" | "invalid";

interface SeatDiagnostics {
  commandCounts: Record<string, number>;
  turnsPassed: number;
  objectiveStomps: number;
  objectiveKinds: Record<string, number>;
  infamyGainedFromEncounters: number;
  healthGainedFromEncounters: number;
  finalHealth: number;
  finalInfamy: number;
  actions: number;
  researchDraw: ResearchDrawDiagnostics;
}

interface ResearchDrawDiagnostics {
  deployWindows: number;
  windowsWithLegalResearchDrawOption: number;
  legalDeploymentChoiceCount: number;
  deploymentChoicesByCount: Record<string, number>;
  optionalGateEvaluationWindows: number;
  gatePassCounts: Record<keyof BotResearchDrawGateDiagnostics, number>;
  gateFailCounts: Record<keyof BotResearchDrawGateDiagnostics, number>;
  eligibleOptionalDrawWindows: number;
  drawSelected: number;
  optionalDrawSelections: number;
  noDeploymentChoiceDrawSelections: number;
  drawAccepted: number;
  drawRejected: number;
  gateSkippedByPath: Record<string, number>;
  deployWindowsWithoutSelectorTrace: number;
}

type ResearchGateName = keyof BotResearchDrawGateDiagnostics;
const RESEARCH_GATES: readonly ResearchGateName[] = [
  "researchDeckAvailable",
  "deploymentNotStarted",
  "researchHandBelowTwo",
  "researchFirstPolicy",
  "activeMilitaryScreen",
  "objectiveThreatAbsent",
  "blockerOpportunityAbsent",
];

interface MatchEvidence {
  treatment: BotTactic;
  focalPlayerIndex: number;
  focalMonster: string;
  focalBranch: string;
  focalLair: string;
  inferredDefaultTactic: BotTactic;
  outcome: FocalOutcome;
  termination: "terminal" | "round-cap" | "action-safety-cap" | "invalid-action";
  winner: null | { playerIndex: number; monster: string; branch: string | null; victoryType: GameState["victoryType"] };
  roundsCompleted: number;
  finalRound: number;
  actions: number;
  invalidActionEvidence: null | { actionNumber: number; actor: number; phase: string; decision?: string; command?: unknown; error: string };
  seats: Array<{ playerIndex: number; monster: string; branch: string | null; lair: string | null; tactic: BotTactic; diagnostics: SeatDiagnostics }>;
}

interface PairEvidence {
  pairIndex: number;
  playerCount: 3 | 4;
  seed: number;
  setupRotation: number;
  focalPlayerIndex: number;
  initialStateSha256: string;
  setupAssignments: Array<{ playerIndex: number; monster: string; branch: string; lair: string }>;
  defaultTacticsBySeat: BotTactic[];
  forceFirst: MatchEvidence;
  researchFirst: MatchEvidence;
  contrast: "force-first-win/research-first-loss" | "force-first-loss/research-first-win" | "same-terminal-outcome" | "different-terminal-outcome" | "incomplete-or-invalid";
}

function emptySeatDiagnostics(): SeatDiagnostics {
  return {
    commandCounts: {},
    turnsPassed: 0,
    objectiveStomps: 0,
    objectiveKinds: {},
    infamyGainedFromEncounters: 0,
    healthGainedFromEncounters: 0,
    finalHealth: 0,
    finalInfamy: 0,
    actions: 0,
    researchDraw: {
      deployWindows: 0,
      windowsWithLegalResearchDrawOption: 0,
      legalDeploymentChoiceCount: 0,
      deploymentChoicesByCount: {},
      optionalGateEvaluationWindows: 0,
      gatePassCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])) as Record<ResearchGateName, number>,
      gateFailCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])) as Record<ResearchGateName, number>,
      eligibleOptionalDrawWindows: 0,
      drawSelected: 0,
      optionalDrawSelections: 0,
      noDeploymentChoiceDrawSelections: 0,
      drawAccepted: 0,
      drawRejected: 0,
      gateSkippedByPath: {},
      deployWindowsWithoutSelectorTrace: 0,
    },
  };
}

function increment(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

function legalResearchDrawOption(state: GameState): boolean {
  // Mirrors drawResearchForDeployment/applyCommand guards: Deploy phase, the active deployment decision, no prior deployment, and a non-exhausted deck.
  return state.phase === "deploy"
    && state.pendingDecision?.type === "deployment"
    && (!("playerIndex" in state.pendingDecision) || state.pendingDecision.playerIndex === state.currentPlayer)
    && state.deploymentsThisTurn === 0
    && !state.decks.research.exhausted
    && Boolean(state.players[state.currentPlayer]);
}

function accountDeploySelectorTrace(diagnostics: ResearchDrawDiagnostics, trace: BotDeployDecisionDiagnostics, expectedChoices: number, expectedDrawLegal: boolean): void {
  if (trace.playerIndex < 0) throw new Error("Research-draw diagnostic reported an invalid player index.");
  if (trace.deploymentChoiceCount !== null && trace.deploymentChoiceCount !== expectedChoices) {
    throw new Error(`Research-draw diagnostic counted ${trace.deploymentChoiceCount} deployment choices; harness counted ${expectedChoices}.`);
  }
  if (trace.legalResearchDrawAvailable !== expectedDrawLegal) {
    throw new Error("Research-draw diagnostic disagrees with the authoritative draw-command preconditions.");
  }
  if (trace.selectedCommandType === "draw-research" && !expectedDrawLegal) {
    throw new Error("Selector selected a Research draw without a legal Deploy draw option.");
  }
  if (trace.path === "optional-research-choice") {
    if (!trace.gates || trace.eligible === null) throw new Error("Optional Research decision omitted its eligibility gates.");
    const allGatesPass = RESEARCH_GATES.every((gate) => trace.gates![gate]);
    if (trace.eligible !== allGatesPass) throw new Error("Reported Research eligibility disagrees with the reported gates.");
    if (trace.selectedCommandType === "draw-research" && (!trace.eligible || !expectedDrawLegal)) {
      throw new Error("Selector selected an optional Research draw without legal eligibility.");
    }
    if (trace.selectedCommandType !== "draw-research" && trace.eligible) {
      throw new Error("Selector declined an optional Research draw while every eligibility gate passed.");
    }
    diagnostics.optionalGateEvaluationWindows += 1;
    if (trace.eligible) diagnostics.eligibleOptionalDrawWindows += 1;
    for (const gate of RESEARCH_GATES) increment(trace.gates[gate] ? diagnostics.gatePassCounts : diagnostics.gateFailCounts, gate);
  } else {
    if (trace.gates !== null || trace.eligible !== null) throw new Error("A bypass/fallback path should not claim optional Research gate results.");
    increment(diagnostics.gateSkippedByPath, trace.path);
  }
}

function commandActor(state: GameState, command: ReturnType<typeof chooseBotCommand>, fallback: number): number {
  if (command?.type === "use-research" && command.cardId === "Laser Fence") {
    const owner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
    if (owner >= 0) return owner;
  }
  return fallback;
}

function playTreatment(initialState: GameState, focalPlayerIndex: number, treatment: BotTactic, maxRoundsPerMatch: number): MatchEvidence {
  let state = structuredClone(initialState);
  const initialRound = state.round;
  const botPlayers = new Set(state.players.map((_, index) => index));
  const overrides = new Map<number, BotTactic>([[focalPlayerIndex, treatment]]);
  const diagnostics = state.players.map(() => emptySeatDiagnostics());
  let actions = 0;
  let invalidActionEvidence: MatchEvidence["invalidActionEvidence"] = null;

  while (state.phase !== "game-over" && state.round <= maxRoundsPerMatch && actions < ACTION_SAFETY_CAP) {
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision
      ? state.pendingDecision.playerIndex
      : state.currentPlayer;
    const deployWindow = state.phase === "deploy";
    const deployOptions = deployWindow ? deploymentChoices(state) : [];
    const drawOptionAvailable = deployWindow && legalResearchDrawOption(state);
    if (deployWindow) {
      const deployDiagnostics = diagnostics[actor]!.researchDraw;
      deployDiagnostics.deployWindows += 1;
      if (drawOptionAvailable) deployDiagnostics.windowsWithLegalResearchDrawOption += 1;
      deployDiagnostics.legalDeploymentChoiceCount += deployOptions.length;
      increment(deployDiagnostics.deploymentChoicesByCount, String(deployOptions.length));
    }
    actions += 1;
    let command: ReturnType<typeof chooseBotCommand>;
    const deployTraces: BotDeployDecisionDiagnostics[] = [];
    try {
      command = chooseBotCommand(state, botPlayers, overrides, (trace) => deployTraces.push(trace));
    } catch (error) {
      if (deployWindow) diagnostics[actor]!.researchDraw.deployWindowsWithoutSelectorTrace += 1;
      invalidActionEvidence = {
        actionNumber: actions,
        actor,
        phase: state.phase,
        decision: state.pendingDecision?.type,
        error: `Bot command selection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      break;
    }
    if (deployTraces.length > 1) throw new Error("One bot command selection emitted multiple Deploy diagnostics.");
    const deployTrace = deployTraces[0];
    if (deployWindow) {
      const deployDiagnostics = diagnostics[actor]!.researchDraw;
      if (deployTrace) {
        if (deployTrace.playerIndex !== actor) throw new Error("Deploy selector diagnostics were attributed to the wrong player.");
        if (deployTrace.selectedCommandType !== command?.type) throw new Error("Deploy selector diagnostics disagree with the returned command.");
        accountDeploySelectorTrace(deployDiagnostics, deployTrace, deployOptions.length, Boolean(drawOptionAvailable));
        if (command?.type === "draw-research") {
          deployDiagnostics.drawSelected += 1;
          if (deployTrace.path === "optional-research-choice") deployDiagnostics.optionalDrawSelections += 1;
          else if (deployTrace.path === "no-deployment-choices") deployDiagnostics.noDeploymentChoiceDrawSelections += 1;
          else throw new Error("Priority giant placement cannot select a Research draw.");
        }
      } else {
        deployDiagnostics.deployWindowsWithoutSelectorTrace += 1;
        if (command?.type === "draw-research") throw new Error("Selector returned a Research draw without reporting its Deploy decision path.");
      }
    }
    if (!command) {
      invalidActionEvidence = {
        actionNumber: actions,
        actor,
        phase: state.phase,
        decision: state.pendingDecision?.type,
        error: "Bot returned no command for an active decision.",
      };
      break;
    }

    const attributedActor = commandActor(state, command, actor);
    const actorDiagnostics = diagnostics[attributedActor]!;
    actorDiagnostics.actions += 1;
    increment(actorDiagnostics.commandCounts, command.type);
    let next: GameState;
    try {
      const applied = applyCommand(state, command);
      next = applied.state;
      if (command.type === "draw-research") {
        if (applied.eventType !== "research.drawn") throw new Error("Accepted Research draw did not emit research.drawn.");
        actorDiagnostics.researchDraw.drawAccepted += 1;
      }
    } catch (error) {
      if (command.type === "draw-research") actorDiagnostics.researchDraw.drawRejected += 1;
      invalidActionEvidence = {
        actionNumber: actions,
        actor: attributedActor,
        phase: state.phase,
        decision: state.pendingDecision?.type,
        command,
        error: error instanceof Error ? error.message : String(error),
      };
      break;
    }

    const latestEvent = next.eventLog.at(-1);
    if (latestEvent?.action === "turn.passed") diagnostics[actor]!.turnsPassed += 1;
    if (latestEvent?.action === "encounter.resolved") {
      const detail = latestEvent.detail as {
        playerIndex?: number;
        location?: string;
        stomped?: boolean;
        effects?: Array<{ type?: string; amount?: number }>;
      };
      const playerDiagnostics = detail.playerIndex === undefined ? undefined : diagnostics[detail.playerIndex];
      if (playerDiagnostics && detail.stomped && detail.location) {
        playerDiagnostics.objectiveStomps += 1;
        const board = boardForState(next);
        const hex = board.hexes[detail.location as keyof typeof board.hexes];
        for (const feature of hex?.features ?? []) increment(playerDiagnostics.objectiveKinds, feature.kind);
        for (const effect of detail.effects ?? []) {
          if (effect.type === "infamy") playerDiagnostics.infamyGainedFromEncounters += effect.amount ?? 0;
          if (effect.type === "health") playerDiagnostics.healthGainedFromEncounters += effect.amount ?? 0;
        }
      }
    }
    state = next;
  }

  for (const [playerIndex, playerDiagnostics] of diagnostics.entries()) {
    playerDiagnostics.finalHealth = state.monsters[playerIndex]?.health ?? 0;
    playerDiagnostics.finalInfamy = state.monsters[playerIndex]?.infamy ?? 0;
  }
  const termination: MatchEvidence["termination"] = invalidActionEvidence
    ? "invalid-action"
    : state.phase === "game-over"
      ? "terminal"
      : actions >= ACTION_SAFETY_CAP
        ? "action-safety-cap"
        : "round-cap";
  const winnerIndex = state.winnerPlayer;
  return {
    treatment,
    focalPlayerIndex,
    focalMonster: state.monsters[focalPlayerIndex]?.name ?? "unknown",
    focalBranch: state.setupAssignments?.[focalPlayerIndex]?.branch ?? "unknown",
    focalLair: initialState.setupAssignments?.[focalPlayerIndex]?.lair ?? "unknown",
    inferredDefaultTactic: botTacticForPlayer(initialState, focalPlayerIndex),
    outcome: invalidActionEvidence
      ? "invalid"
      : state.phase !== "game-over"
        ? "incomplete"
        : winnerIndex === undefined || winnerIndex === null
          ? "draw"
          : winnerIndex === focalPlayerIndex ? "win" : "loss",
    termination,
    winner: winnerIndex === undefined || winnerIndex === null ? null : {
      playerIndex: winnerIndex,
      monster: state.monsters[winnerIndex]?.name ?? "unknown",
      branch: state.setupAssignments?.[winnerIndex]?.branch ?? null,
      victoryType: state.victoryType,
    },
    roundsCompleted: Math.min(maxRoundsPerMatch, Math.max(0, state.round - initialRound)),
    finalRound: state.round,
    actions,
    invalidActionEvidence,
    seats: state.players.map((_, playerIndex) => ({
      playerIndex,
      monster: state.monsters[playerIndex]?.name ?? "unknown",
      branch: state.setupAssignments?.[playerIndex]?.branch ?? null,
      lair: initialState.setupAssignments?.[playerIndex]?.lair ?? null,
      tactic: botTacticForPlayer(initialState, playerIndex, playerIndex === focalPlayerIndex ? overrides : undefined),
      diagnostics: diagnostics[playerIndex]!,
    })),
  };
}

function outcomeContrast(forceFirst: MatchEvidence, researchFirst: MatchEvidence): PairEvidence["contrast"] {
  if (forceFirst.outcome === "win" && researchFirst.outcome === "loss") return "force-first-win/research-first-loss";
  if (forceFirst.outcome === "loss" && researchFirst.outcome === "win") return "force-first-loss/research-first-win";
  const terminalOutcomes = ["win", "draw", "loss"];
  if (!terminalOutcomes.includes(forceFirst.outcome) || !terminalOutcomes.includes(researchFirst.outcome)) return "incomplete-or-invalid";
  if (forceFirst.outcome === researchFirst.outcome) return "same-terminal-outcome";
  return "different-terminal-outcome";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function run(): void {
  const pairs: PairEvidence[] = [];
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const [playerCount, focalPlayerIndex] = ROTATION_PLAN[pairIndex % ROTATION_PLAN.length]!;
    const seed = seedStart + pairIndex;
    const rotation = pairIndex;
    const initialState = completeRotatedSetup(playerCount, seed, rotation);
    const stateHash = digest(JSON.stringify(initialState));
    const setupAssignments = initialState.setupAssignments!.map((seat) => ({
      playerIndex: seat.playerIndex,
      monster: initialState.monsters[seat.playerIndex]?.name ?? "unknown",
      branch: seat.branch,
      lair: seat.lair,
    }));
    const defaultTacticsBySeat = initialState.players.map((_, playerIndex) => botTacticForPlayer(initialState, playerIndex));
    const forceFirst = playTreatment(initialState, focalPlayerIndex, "force-first", maxRounds);
    const researchFirst = playTreatment(initialState, focalPlayerIndex, "research-first", maxRounds);
    pairs.push({
      pairIndex,
      playerCount,
      seed,
      setupRotation: rotation,
      focalPlayerIndex,
      initialStateSha256: stateHash,
      setupAssignments,
      defaultTacticsBySeat,
      forceFirst,
      researchFirst,
      contrast: outcomeContrast(forceFirst, researchFirst),
    });
  }

  const outcomeCounts = (treatment: BotTactic) => Object.fromEntries(
    (["win", "draw", "loss", "incomplete", "invalid"] as const).map((outcome) => [
      outcome,
      pairs.filter((pair) => pair[treatment === "force-first" ? "forceFirst" : "researchFirst"].outcome === outcome).length,
    ]),
  );
  const researchDrawSummaryByTactic = Object.fromEntries(TREATMENTS.map((tactic) => {
    const matches = pairs.flatMap((pair) => [pair.forceFirst, pair.researchFirst]);
    const matchingSeats = matches.flatMap((match) => match.seats.filter((seat) => seat.tactic === tactic));
    const total = emptySeatDiagnostics().researchDraw;
    for (const seat of matchingSeats) {
      const source = seat.diagnostics.researchDraw;
      total.deployWindows += source.deployWindows;
      total.windowsWithLegalResearchDrawOption += source.windowsWithLegalResearchDrawOption;
      total.legalDeploymentChoiceCount += source.legalDeploymentChoiceCount;
      total.optionalGateEvaluationWindows += source.optionalGateEvaluationWindows;
      total.eligibleOptionalDrawWindows += source.eligibleOptionalDrawWindows;
      total.drawSelected += source.drawSelected;
      total.optionalDrawSelections += source.optionalDrawSelections;
      total.noDeploymentChoiceDrawSelections += source.noDeploymentChoiceDrawSelections;
      total.drawAccepted += source.drawAccepted;
      total.drawRejected += source.drawRejected;
      total.deployWindowsWithoutSelectorTrace += source.deployWindowsWithoutSelectorTrace;
      for (const [count, windows] of Object.entries(source.deploymentChoicesByCount)) increment(total.deploymentChoicesByCount, count, windows);
      for (const [path, windows] of Object.entries(source.gateSkippedByPath)) increment(total.gateSkippedByPath, path, windows);
      for (const gate of RESEARCH_GATES) {
        increment(total.gatePassCounts, gate, source.gatePassCounts[gate]);
        increment(total.gateFailCounts, gate, source.gateFailCounts[gate]);
      }
    }
    return [tactic, { seatMatchSamples: matchingSeats.length, ...total }];
  })) as Record<BotTactic, { seatMatchSamples: number } & ResearchDrawDiagnostics>;
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const botsPath = resolve(process.cwd(), "packages/game-engine/src/bots.ts");
  const harnessSource = readFileSync(new URL(import.meta.url), "utf8");
  const botsSource = readFileSync(botsPath, "utf8");
  const evidence = {
    schemaVersion: 2,
    researchDrawDiagnosticsVersion: 1,
    runMetadata: {
      generatedAt: new Date().toISOString(),
      gitHead: head,
      worktreeDirty: dirtyPaths.length > 0,
      dirtyPathCount: dirtyPaths.length,
      sourceSha256: {
        botSelector: digest(botsSource),
        harness: digest(harnessSource),
      },
    },
    screening: maxRounds < DEFAULT_MAX_ROUNDS,
    interpretation: maxRounds < DEFAULT_MAX_ROUNDS
      ? "Round-capped screening only. Incomplete outcomes are censored; this run cannot estimate policy win quality."
      : "Policy outcome comparison only; interpret any differences with the recorded setup and stochastic-path caveats.",
    config: {
      pairCount,
      seedStart,
      maximumRoundsPerMatch: maxRounds,
      actionSafetyCapPerMatch: ACTION_SAFETY_CAP,
      playerCounts: [3, 4],
      treatmentPolicies: TREATMENTS,
      focalSeatPlan: ROTATION_PLAN,
      comparison: "Each pair clones the same completed legal setup into force-first and research-first treatments. Other seats retain their match-default policy and are the fixed baseline roster for that pair.",
      researchDrawDiagnostics: "Deploy windows are counted per selector invocation while state.phase is deploy; legal Research draws mirror drawResearchForDeployment/applyCommand guards; legal deployment choices are counted by deploymentChoices; optional gates are emitted only when the selector reaches shouldDrawResearch and are checked against its decision; accepted draws require the research.drawn event.",
      randomGenerator: "32-bit xorshift for setup assignment; engine command randomness begins from the same cloned state in both treatments and may diverge after policies take different actions.",
      setupRotation: "The seeded distinct monster and branch permutations are cyclically rotated by pair index; legal lairs rotate through each monster's unclaimed options. Focal seats cover every seat in both 3- and 4-seat games for the default seven-pair sample.",
    },
    summary: {
      forceFirstOutcomes: outcomeCounts("force-first"),
      researchFirstOutcomes: outcomeCounts("research-first"),
      pairedContrasts: Object.fromEntries(["force-first-win/research-first-loss", "force-first-loss/research-first-win", "same-terminal-outcome", "incomplete-or-invalid"].map((contrast) => [contrast, pairs.filter((pair) => pair.contrast === contrast).length])),
      allInvalidActions: pairs.flatMap((pair) => [pair.forceFirst, pair.researchFirst]).reduce((sum, match) => sum + Number(Boolean(match.invalidActionEvidence)), 0),
      safetyCappedMatches: pairs.flatMap((pair) => [pair.forceFirst, pair.researchFirst]).filter((match) => match.termination === "action-safety-cap").length,
      researchDrawDiagnosticsByTactic: researchDrawSummaryByTactic,
    },
    pairs,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.summary.allInvalidActions > 0 || evidence.summary.safetyCappedMatches > 0) process.exitCode = 1;
}

run();
