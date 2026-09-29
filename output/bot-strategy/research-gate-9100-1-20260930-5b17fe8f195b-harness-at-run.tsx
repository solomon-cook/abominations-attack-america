import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { acquireCheckpointLock, appendCheckpointPair, assertCheckpointCompatible, createCheckpoint, readCheckpoint, repairCheckpointTail, sha256, summarizeResearchGatePairs, validateConfirmatoryRegistration } from "./research-gate-checkpoint.mjs";
import {
  applyCommand,
  applyCompletedSetup,
  chooseBranch,
  chooseLair,
  chooseMonster,
  createMvpRoomGame,
  deploymentChoices,
  type GameCommand,
  type GameState,
  type SetupState,
} from "../packages/game-engine/src/index.js";
import {
  chooseBotCommand,
  chooseBotSetupAction,
  type BotDeployDecisionDiagnostics,
  type BotResearchDrawGateBypass,
  type BotResearchDrawGateDiagnostics,
  type BotTactic,
} from "../packages/game-engine/src/bots.js";

const DEFAULT_PAIR_COUNT = 30;
const DEFAULT_SEED_START = 7200;
const DEFAULT_ORDER_SEED = 20260929;
const DEFAULT_MAX_ROUNDS = 12;
const ACTION_SAFETY_CAP = 2_000;
const MAX_PAIR_COUNT = 1_000;
const MMD = 0.10;
const ROTATION_PLAN: ReadonlyArray<readonly [3 | 4, number]> = [
  [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [4, 2], [4, 3],
];
const GATE_BYPASSES: readonly BotResearchDrawGateBypass[] = ["objectiveThreatAbsent", "blockerOpportunityAbsent"];
const RESEARCH_GATES: readonly (keyof BotResearchDrawGateDiagnostics)[] = [
  "researchDeckAvailable",
  "deploymentNotStarted",
  "researchHandBelowTwo",
  "researchFirstPolicy",
  "activeMilitaryScreen",
  "objectiveThreatAbsent",
  "blockerOpportunityAbsent",
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

function readStringArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((arg) => arg.startsWith(prefix));
  if (matches.length > 1) throw new Error(`${name} may be specified only once`);
  const value = matches[0]?.slice(prefix.length);
  if (value === "") throw new Error(`${name} must not be empty`);
  return value ?? fallback;
}

function hasFlag(name: string): boolean {
  const flag = `--${name}`;
  if (process.argv.filter((arg) => arg === flag).length > 1) throw new Error(`${name} may be specified only once`);
  return process.argv.includes(flag);
}

const pairCount = readIntegerArg("pair-count", DEFAULT_PAIR_COUNT);
const seedStart = readIntegerArg("seed-start", DEFAULT_SEED_START);
const orderSeed = readIntegerArg("order-seed", DEFAULT_ORDER_SEED);
const maxRounds = readIntegerArg("max-rounds", DEFAULT_MAX_ROUNDS);
const studyStage = readStringArg("study-stage", "pilot");
assert.ok(studyStage === "pilot" || studyStage === "confirmatory", "study-stage must be pilot or confirmatory");
const resume = hasFlag("resume");
const planOnly = hasFlag("plan-only");
const checkpointPath = resolve(readStringArg("checkpoint", `output/bot-strategy/research-gate-${seedStart}-${pairCount}-${orderSeed}.checkpoint.jsonl`)!);
const outputPathArg = readStringArg("output");
const outputPath = outputPathArg ? resolve(outputPathArg) : undefined;
assert.ok(pairCount > 0 && pairCount <= MAX_PAIR_COUNT, `pair-count must be between 1 and ${MAX_PAIR_COUNT}`);
assert.ok(maxRounds > 0 && maxRounds <= 100, "max-rounds must be between 1 and 100");
assert.ok(seedStart + pairCount - 1 <= Number.MAX_SAFE_INTEGER, "seed range must stay within safe integers");

function seededRandom(seed: number) {
  let state = (seed >>> 0) || 0x9e3779b9;
  let draws = 0;
  return {
    next(): number {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      draws += 1;
      return (state >>> 0) / 0x1_0000_0000;
    },
    snapshot() { return { state: state >>> 0, draws }; },
  };
}

function shuffled<T>(values: readonly T[], random: { next(): number }): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function rotated<T>(values: readonly T[], offset: number): T[] {
  if (!values.length) return [];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function swapInto<T>(values: T[], index: number, requested: T): void {
  const requestedIndex = values.indexOf(requested);
  if (requestedIndex < 0) {
    values[index] = requested;
    return;
  }
  [values[index], values[requestedIndex]] = [values[requestedIndex]!, values[index]!];
}

function completeRotatedSetup(playerCount: 3 | 4, seed: number, pairIndex: number, focalSeat: number) {
  const game = createMvpRoomGame(playerCount, seed, `research-gates-${playerCount}-${seed}`);
  const setupSeed = (seed ^ Math.imul(playerCount, 0x85ebca6b)) >>> 0;
  const random = seededRandom(setupSeed);
  const setupDefinition = game.setupState!.definition;
  const monsterIds = setupDefinition.monsterIds;
  const branches = setupDefinition.eligibleBranches;
  const targetMonster = monsterIds[pairIndex % monsterIds.length]!;
  const targetBranch = branches[pairIndex % branches.length]!;
  const monsterBySeat = rotated(shuffled(monsterIds, random), pairIndex).slice(0, playerCount);
  const branchBySeat = rotated(shuffled(branches, random), pairIndex + 1).slice(0, playerCount);
  swapInto(monsterBySeat, focalSeat, targetMonster);
  swapInto(branchBySeat, focalSeat, targetBranch);

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
      const seat = setup.seats.find((candidate) => candidate.playerIndex === focalSeat && candidate.lair === undefined)
        ?? setup.seats.find((candidate) => candidate.lair === undefined);
      assert.ok(seat, "lair-selection must have an undecided seat");
      const candidates = setup.definition.lairsByMonster[seat.monsterId!]!
        .filter((lair) => !setup.seats.some((candidate) => candidate.lair === lair));
      assert.ok(candidates.length > 0, `monster ${seat.monsterId} must have an available lair`);
      if (seat.playerIndex === focalSeat) {
        const monsterOrdinal = pairIndex % monsterIds.length;
        const lairSlot = (Math.floor(pairIndex / monsterIds.length) + monsterOrdinal) % candidates.length;
        setup = chooseLair(setup, seat.playerIndex, candidates[lairSlot]!);
      } else {
        const offset = (pairIndex + seat.playerIndex) % candidates.length;
        setup = chooseLair(setup, seat.playerIndex, candidates[offset]!);
      }
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
  const state = applyCompletedSetup({ ...game, setupState: setup });
  return { state, setupSeed, setupRandom: random.snapshot() };
}

type Treatment = "control" | "urgency-gates-bypassed";
type Outcome = "win" | "draw" | "loss" | "incomplete" | "invalid";
type Termination = "terminal" | "round-cap" | "action-safety-cap" | "invalid-action";

interface ResearchDrawDiagnostics {
  deployWindows: number;
  legalDrawOptions: number;
  legalDeploymentChoices: number;
  deploymentChoiceHistogram: Record<string, number>;
  optionalGateEvaluations: number;
  actualGatePassCounts: Record<keyof BotResearchDrawGateDiagnostics, number>;
  actualGateFailCounts: Record<keyof BotResearchDrawGateDiagnostics, number>;
  effectiveEligibleOpportunities: number;
  optionalDrawSelections: number;
  noDeploymentChoiceDrawSelections: number;
  acceptedDraws: number;
  rejectedDraws: number;
  selectorPathsSkipped: Record<string, number>;
  deployWindowsWithoutTrace: number;
}

interface SeatEvidence {
  playerIndex: number;
  monster: string;
  branch: string | null;
  lair: string | null;
  tactic: BotTactic;
  actions: number;
  commandCounts: Record<string, number>;
  objectiveStomps: number;
  finalHealth: number;
  finalInfamy: number;
  researchDraw: ResearchDrawDiagnostics;
}

interface MatchEvidence {
  treatment: Treatment;
  executionOrder: number;
  focalSeat: number;
  fixedTacticsBySeat: BotTactic[];
  bypassedGateNames: readonly BotResearchDrawGateBypass[];
  outcome: Outcome;
  score: number | null;
  termination: Termination;
  winner: null | { playerIndex: number; monster: string; branch: string | null; victoryType: GameState["victoryType"] };
  initialRound: number;
  roundsCompleted: number;
  finalRound: number;
  actions: number;
  initialRng: GameState["rng"];
  finalRng: GameState["rng"];
  invalidActionEvidence: null | { actionNumber: number; actor: number; command?: GameCommand; phase: string; error: string };
  seats: SeatEvidence[];
  researchDrawOpportunityTrace: Array<{
    actionNumber: number;
    actor: number;
    legalDrawOption: boolean;
    deploymentChoiceCount: number;
    selectorPath: BotDeployDecisionDiagnostics["path"] | null;
    factualGates: BotResearchDrawGateDiagnostics | null;
    effectiveEligible: boolean | null;
    bypassedGates: readonly BotResearchDrawGateBypass[];
    selectedCommandType: string | null;
    acceptedEventType: string | null;
    drawnCardId: string | null;
    rejected: boolean;
  }>;
  actionTrace: Array<{ actor: number; commandType: string; commandSha256: string; rngCursorBefore: number; rngCursorAfter: number }>;
}

interface PairEvidence {
  pairIndex: number;
  playerCount: 3 | 4;
  seed: number;
  setupSeed: number;
  setupRandomStream: { algorithm: string; finalState: number; draws: number };
  focalSeat: number;
  focalMonster: string;
  focalBranch: string;
  focalLair: string;
  focalLairSlot: number;
  initialStateSha256: string;
  initialStateSnapshot: GameState;
  initialRng: GameState["rng"];
  setupAssignments: Array<{ playerIndex: number; monster: string; branch: string; lair: string }>;
  fixedTacticsBySeat: BotTactic[];
  randomizedArmOrder: Treatment[];
  control: MatchEvidence;
  treatment: MatchEvidence;
  firstCommandDivergenceAction: number | null;
  firstRngCursorDivergenceAction: number | null;
  alignedActionsCompared: number;
  scoreDifferenceTreatmentMinusControl: number | null;
  pairedStatus: "complete-pair" | "incomplete-pair" | "invalid-pair";
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptyResearchDrawDiagnostics(): ResearchDrawDiagnostics {
  return {
    deployWindows: 0,
    legalDrawOptions: 0,
    legalDeploymentChoices: 0,
    deploymentChoiceHistogram: {},
    optionalGateEvaluations: 0,
    actualGatePassCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])) as ResearchDrawDiagnostics["actualGatePassCounts"],
    actualGateFailCounts: Object.fromEntries(RESEARCH_GATES.map((gate) => [gate, 0])) as ResearchDrawDiagnostics["actualGateFailCounts"],
    effectiveEligibleOpportunities: 0,
    optionalDrawSelections: 0,
    noDeploymentChoiceDrawSelections: 0,
    acceptedDraws: 0,
    rejectedDraws: 0,
    selectorPathsSkipped: {},
    deployWindowsWithoutTrace: 0,
  };
}

function emptySeat(state: GameState, playerIndex: number, tactic: BotTactic): SeatEvidence {
  const assignment = state.setupAssignments?.[playerIndex];
  return {
    playerIndex,
    monster: state.monsters[playerIndex]?.name ?? "unknown",
    branch: assignment?.branch ?? null,
    lair: assignment?.lair ?? null,
    tactic,
    actions: 0,
    commandCounts: {},
    objectiveStomps: 0,
    finalHealth: 0,
    finalInfamy: 0,
    researchDraw: emptyResearchDrawDiagnostics(),
  };
}

function inc(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

function isLegalResearchDrawOption(state: GameState): boolean {
  return state.phase === "deploy"
    && state.pendingDecision?.type === "deployment"
    && (!("playerIndex" in state.pendingDecision) || state.pendingDecision.playerIndex === state.currentPlayer)
    && state.deploymentsThisTurn === 0
    && !state.decks.research.exhausted
    && Boolean(state.players[state.currentPlayer]);
}

function assertResearchTrace(
  trace: BotDeployDecisionDiagnostics,
  treatment: Treatment,
  focalSeat: number,
  expectedOptions: number,
  drawIsLegal: boolean,
): void {
  assert.equal(trace.legalResearchDrawAvailable, drawIsLegal, "selector and harness must agree on draw legality");
  if (trace.deploymentChoiceCount !== null) assert.equal(trace.deploymentChoiceCount, expectedOptions);
  if (trace.path !== "optional-research-choice") {
    assert.equal(trace.gates, null, "fallback paths must not claim optional gate facts");
    assert.equal(trace.eligible, null);
    return;
  }
  assert.ok(trace.gates, "optional selector path must report factual gates");
  assert.notEqual(trace.eligible, null);
  const bypass = treatment === "urgency-gates-bypassed" && trace.playerIndex === focalSeat ? new Set(GATE_BYPASSES) : new Set<BotResearchDrawGateBypass>();
  const expectedEffectiveEligibility = RESEARCH_GATES.every((gate) => trace.gates![gate] || bypass.has(gate as BotResearchDrawGateBypass));
  assert.equal(trace.eligible, expectedEffectiveEligibility, "effective eligibility must preserve every hard gate and bypass only preregistered urgency gates");
  const expectedBypassed = GATE_BYPASSES.filter((gate) => !trace.gates![gate]);
  if (bypass.size > 0 && expectedBypassed.length) {
    assert.deepEqual(trace.bypassedGates, expectedBypassed, "trace must name each and only each factual urgency gate bypassed");
  } else {
    assert.equal(trace.bypassedGates?.length ?? 0, 0, "control and non-triggering treatment windows must not report bypasses");
  }
  if (trace.selectedCommandType === "draw-research") {
    assert.ok(drawIsLegal, "a selected draw must still be legally available");
    assert.ok(trace.eligible, "a selected optional draw must pass effective eligibility");
  } else {
    assert.equal(trace.eligible, false, "the selector must not decline an effectively eligible Research draw");
  }
}

function selectedActor(state: GameState, command: GameCommand, fallback: number): number {
  if (command.type === "use-research" && command.cardId === "Laser Fence") {
    const owner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
    if (owner >= 0) return owner;
  }
  return fallback;
}

function outcome(state: GameState, focalSeat: number, invalid: boolean): Outcome {
  if (invalid) return "invalid";
  if (state.phase !== "game-over") return "incomplete";
  if (state.winnerPlayer === undefined || state.winnerPlayer === null) return "draw";
  return state.winnerPlayer === focalSeat ? "win" : "loss";
}

function playMatch(initialState: GameState, focalSeat: number, fixedTactics: BotTactic[], treatment: Treatment, executionOrder: number, maximumRounds: number): MatchEvidence {
  let state = structuredClone(initialState);
  const initialRound = state.round;
  const initialRng = { ...state.rng };
  const botPlayers = new Set(state.players.map((_, index) => index));
  const tacticOverrides = new Map<number, BotTactic>(fixedTactics.map((tactic, seat) => [seat, tactic]));
  const gateOverrides = treatment === "urgency-gates-bypassed"
    ? new Map<number, ReadonlySet<BotResearchDrawGateBypass>>([[focalSeat, new Set(GATE_BYPASSES)]])
    : undefined;
  const seats = state.players.map((_, playerIndex) => emptySeat(state, playerIndex, fixedTactics[playerIndex]!));
  const actionTrace: MatchEvidence["actionTrace"] = [];
  const researchDrawOpportunityTrace: MatchEvidence["researchDrawOpportunityTrace"] = [];
  let actions = 0;
  let invalidActionEvidence: MatchEvidence["invalidActionEvidence"] = null;
  let termination: Termination | null = null;

  while (state.phase !== "game-over" && state.round <= maximumRounds && actions < ACTION_SAFETY_CAP) {
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision ? state.pendingDecision.playerIndex : state.currentPlayer;
    const deployWindow = state.phase === "deploy";
    const choices = deployWindow ? deploymentChoices(state) : [];
    const legalDraw = deployWindow && isLegalResearchDrawOption(state);
    if (deployWindow) {
      const drawStats = seats[actor]!.researchDraw;
      drawStats.deployWindows += 1;
      if (legalDraw) drawStats.legalDrawOptions += 1;
      drawStats.legalDeploymentChoices += choices.length;
      inc(drawStats.deploymentChoiceHistogram, String(choices.length));
    }
    actions += 1;
    let command: GameCommand | undefined;
    const selectorTraces: BotDeployDecisionDiagnostics[] = [];
    try {
      command = chooseBotCommand(state, botPlayers, tacticOverrides, (trace) => selectorTraces.push(trace), undefined, gateOverrides);
    } catch (error) {
      if (deployWindow) seats[actor]!.researchDraw.deployWindowsWithoutTrace += 1;
      invalidActionEvidence = {
        actionNumber: actions,
        actor,
        phase: state.phase,
        error: `Bot selection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      termination = "invalid-action";
      break;
    }
    assert.ok(selectorTraces.length <= 1, "one command selection may emit at most one Deploy trace");
    const trace = selectorTraces[0];
    let opportunityRow: MatchEvidence["researchDrawOpportunityTrace"][number] | undefined;
    if (deployWindow) {
      const drawStats = seats[actor]!.researchDraw;
      if (trace) {
        assert.equal(trace.playerIndex, actor);
        assert.equal(trace.selectedCommandType, command?.type);
        assertResearchTrace(trace, treatment, focalSeat, choices.length, Boolean(legalDraw));
        if (trace.path === "optional-research-choice") {
          drawStats.optionalGateEvaluations += 1;
          if (trace.eligible) drawStats.effectiveEligibleOpportunities += 1;
          for (const gate of RESEARCH_GATES) inc(trace.gates![gate] ? drawStats.actualGatePassCounts : drawStats.actualGateFailCounts, gate);
        } else {
          inc(drawStats.selectorPathsSkipped, trace.path);
        }
        if (command?.type === "draw-research") {
          if (trace.path === "optional-research-choice") drawStats.optionalDrawSelections += 1;
          else if (trace.path === "no-deployment-choices") drawStats.noDeploymentChoiceDrawSelections += 1;
        }
      } else {
        drawStats.deployWindowsWithoutTrace += 1;
      }
      opportunityRow = {
        actionNumber: actions,
        actor,
        legalDrawOption: Boolean(legalDraw),
        deploymentChoiceCount: choices.length,
        selectorPath: trace?.path ?? null,
        factualGates: trace?.gates ?? null,
        effectiveEligible: trace?.eligible ?? null,
        bypassedGates: trace?.bypassedGates ?? [],
        selectedCommandType: command?.type ?? null,
        acceptedEventType: null,
        drawnCardId: null,
        rejected: false,
      };
      researchDrawOpportunityTrace.push(opportunityRow);
    }
    if (!command) {
      invalidActionEvidence = { actionNumber: actions, actor, phase: state.phase, error: "Bot returned no command for an active decision." };
      termination = "invalid-action";
      break;
    }
    const attributedActor = selectedActor(state, command, actor);
    seats[attributedActor]!.actions += 1;
    inc(seats[attributedActor]!.commandCounts, command.type);
    const rngBefore = state.rng.cursor;
    try {
      const applied = applyCommand(state, command);
      if (command.type === "draw-research") {
        if (applied.eventType !== "research.drawn") throw new Error("Accepted Research draw did not emit research.drawn.");
        seats[attributedActor]!.researchDraw.acceptedDraws += 1;
        if (opportunityRow) {
          opportunityRow.acceptedEventType = applied.eventType;
          opportunityRow.drawnCardId = typeof applied.eventPayload.cardId === "string" ? applied.eventPayload.cardId : null;
        }
      }
      state = applied.state;
      actionTrace.push({ actor, commandType: command.type, commandSha256: digest(JSON.stringify(command)), rngCursorBefore: rngBefore, rngCursorAfter: state.rng.cursor });
    } catch (error) {
      if (command.type === "draw-research") {
        seats[attributedActor]!.researchDraw.rejectedDraws += 1;
        if (opportunityRow) opportunityRow.rejected = true;
      }
      invalidActionEvidence = { actionNumber: actions, actor, command, phase: state.phase, error: error instanceof Error ? error.message : String(error) };
      termination = "invalid-action";
      break;
    }
  }

  if (termination === null) {
    termination = state.phase === "game-over" ? "terminal" : actions >= ACTION_SAFETY_CAP ? "action-safety-cap" : "round-cap";
  }
  for (const [playerIndex, monster] of state.monsters.entries()) {
    seats[playerIndex]!.finalHealth = monster.health;
    seats[playerIndex]!.finalInfamy = monster.infamy;
    seats[playerIndex]!.objectiveStomps = state.log.filter((line) => line.includes(`Monster ${monster.name}`) && line.includes("stomped")).length;
  }
  const result = outcome(state, focalSeat, Boolean(invalidActionEvidence));
  return {
    treatment,
    executionOrder,
    focalSeat,
    fixedTacticsBySeat: fixedTactics,
    bypassedGateNames: treatment === "urgency-gates-bypassed" ? GATE_BYPASSES : [],
    outcome: result,
    score: result === "win" ? 1 : result === "draw" ? 0.5 : result === "loss" ? 0 : null,
    termination,
    winner: state.winnerPlayer === undefined || state.winnerPlayer === null
      ? null
      : { playerIndex: state.winnerPlayer, monster: state.monsters[state.winnerPlayer]?.name ?? "unknown", branch: state.setupAssignments?.[state.winnerPlayer]?.branch ?? null, victoryType: state.victoryType },
    initialRound,
    roundsCompleted: state.round - initialRound,
    finalRound: state.round,
    actions,
    initialRng,
    finalRng: { ...state.rng },
    invalidActionEvidence,
    seats,
    researchDrawOpportunityTrace,
    actionTrace,
  };
}

function pairedDivergence(control: MatchEvidence, treatment: MatchEvidence) {
  let firstCommandDivergenceAction: number | null = null;
  let firstRngCursorDivergenceAction: number | null = null;
  const alignedActionsCompared = Math.min(control.actionTrace.length, treatment.actionTrace.length);
  for (let index = 0; index < alignedActionsCompared; index += 1) {
    const controlAction = control.actionTrace[index]!;
    const treatmentAction = treatment.actionTrace[index]!;
    if (firstCommandDivergenceAction === null && (controlAction.actor !== treatmentAction.actor || controlAction.commandSha256 !== treatmentAction.commandSha256)) firstCommandDivergenceAction = index + 1;
    if (firstRngCursorDivergenceAction === null && controlAction.rngCursorAfter !== treatmentAction.rngCursorAfter) firstRngCursorDivergenceAction = index + 1;
  }
  return { firstCommandDivergenceAction, firstRngCursorDivergenceAction, alignedActionsCompared };
}

function shuffledArmOrders(pairCount: number, seed: number) {
  const random = seededRandom(seed);
  const orders: Treatment[] = Array.from({ length: Math.floor(pairCount / 2) }, () => "control");
  orders.push(...Array.from<Treatment, Treatment>({ length: Math.floor(pairCount / 2) }, () => "urgency-gates-bypassed"));
  if (pairCount % 2) orders.push(random.next() < 0.5 ? "control" : "urgency-gates-bypassed");
  const treatmentFirst = shuffled(orders, random);
  return { treatmentFirst, stream: random.snapshot() };
}

function sourceHashes(): Record<string, string> {
  const trackedEngineFiles = execFileSync("git", ["ls-files", "packages/game-engine/src"], { encoding: "utf8" })
    .split("\n").filter(Boolean).sort();
  const paths = [...trackedEngineFiles, "scripts/research-gate-checkpoint.mjs", "scripts/verify-bot-research-gates-paired.tsx"];
  return Object.fromEntries(paths.map((path) => [path, digest(readFileSync(resolve(process.cwd(), path)))]));
}

function buildRunProtocol(armRandom: ReturnType<typeof shuffledArmOrders>, gitHead: string, dirtyPaths: string[], sourceSha256: Record<string, string>) {
  const lowFirstCount = armRandom.treatmentFirst.filter((arm) => arm === "control").length;
  const treatmentFirstCount = pairCount - lowFirstCount;
  assert.ok(Math.abs(lowFirstCount - treatmentFirstCount) <= 1, "execution order must be randomized and balanced within one pair");
  const preregistration = {
    stage: studyStage,
    primaryOutcome: "Focal terminal score: win=1, draw=0.5, loss=0; paired estimand is urgency-gates-bypassed minus control.",
    minimumMeaningfulDifference: { absoluteScorePoints: MMD, direction: "two-sided" },
    alpha: 0.05,
    targetPower: 0.80,
    assignmentProtocol: "For pair index i from 0 through pairCount-1, use engine seed seedStart+i and the configured 3/4-player focal-seat rotation. Cycle focal monster and branch by pair index and cycle focal lair rank across repeated focal-monster slots. The full-block arm-order sequence is the balanced 1:1 shuffle generated by the registered orderSeed and retained in config.armOrderRandomStream.",
    treatment: "Focal seat remains research-first. Opponents remain force-first. Treatment bypasses only objectiveThreatAbsent and blockerOpportunityAbsent on the optional Research draw path; factual gate values are retained. Control supplies no bypass. Route scores, setup actions, all other bot decisions, game rules, and command schema are identical.",
    retainedHardGates: ["researchDeckAvailable", "deploymentNotStarted", "researchHandBelowTwo", "researchFirstPolicy", "activeMilitaryScreen", "legal draw-research command available"],
    pairedSetup: "Within every pair both arms clone byte-identical completed setup state and start from the same engine seed/RNG cursor. Rotate focal seat through 3/4-seat games and cycle focal monster, branch, and available lair rank. Opponent tactics are pinned force-first in both arms.",
    executionOrder: "Randomized with a separate seeded xorshift32 stream from a balanced 1:1 list; arm sequence and order stream state/draw count are retained for the entire preregistered block.",
    incompletePairHandling: "Retain every match and pair. Invalid action pairs are reported as implementation failures and excluded from terminal-score inference. Capped/nonterminal pairs are excluded from complete-pair estimates and included in worst-case [0,1] score-difference bounds; report both counts and bounds.",
    powerPlanning: studyStage === "pilot"
      ? "Estimate paired-difference sample variance for a separately preregistered confirmatory block. This pilot is descriptive and does not authorize a policy change."
      : "The target block and analysis are fixed before execution. Report all randomized pairs, paired score estimate and interval, invalid/cap counts, and worst-case bounds. Do not alter default policy unless the preregistered decision rule passes.",
    decisionRule: studyStage === "pilot"
      ? "No policy change from pilot findings. Treat uncertainty intervals spanning both -0.10 and +0.10 as unresolved, not evidence of equivalence."
      : "No default policy change unless the preregistered confirmatory decision rule supports benefit above +0.10 score points and command validity/termination guardrails pass.",
    rngDivergence: "Record per-action actor/command hash and RNG cursor before/after. Compare aligned action traces and retain first divergence; same cursor after different actions is not common-random-number identity.",
  };
  const config = {
    pairCount,
    seedStart,
    orderSeed,
    maximumRoundsPerMatch: maxRounds,
    actionSafetyCapPerMatch: ACTION_SAFETY_CAP,
    playerCounts: [3, 4],
    rotationPlan: ROTATION_PLAN,
    focalMonsterPlan: "cycle eligible monster IDs by pair index",
    focalBranchPlan: "cycle eligible branches by pair index",
    focalLairPlan: "cycle focal lair rank across repeated focal-monster slots; each configured lair index is exercised for each focal monster",
    focalTactic: "research-first",
    opponentTactic: "force-first",
    studyStage,
    armOrderCounts: { controlFirst: lowFirstCount, treatmentFirst: treatmentFirstCount },
    armOrderRandomStream: { algorithm: "xorshift32", seed: orderSeed, finalState: armRandom.stream.state, draws: armRandom.stream.draws },
    researchGateBypasses: GATE_BYPASSES,
  };
  const studyStatus = studyStage === "pilot"
    ? "PILOT — descriptive and inconclusive; not a default-policy decision"
    : "CONFIRMATORY — preregistered randomized block; inference pending independent analysis";
  const identity = { gitHead, sourceSha256, preregistration, config, studyStatus };
  const campaignIdentitySha256 = sha256(JSON.stringify(identity));
  const snapshotPath = `output/bot-strategy/research-gate-${seedStart}-${pairCount}-${orderSeed}-${campaignIdentitySha256.slice(0, 12)}-harness-at-run.tsx`;
  const runMetadata: { gitHead: string; dirtyPaths: string[]; sourceSha256: Record<string, string>; harnessSnapshotPath: string; startedAt: string; [key: string]: unknown } = {
    gitHead, dirtyPaths, sourceSha256, harnessSnapshotPath: snapshotPath, startedAt: new Date().toISOString(),
  };
  runMetadata.campaignIdentitySha256 = campaignIdentitySha256;
  return { preregistration, config, studyStatus, runMetadata, campaignIdentitySha256, snapshotPath };
}

function registerExternalPreregistration(protocol: ReturnType<typeof buildRunProtocol>): null | Record<string, unknown> {
  const pathArg = readStringArg("preregistration");
  if (studyStage === "confirmatory" && !planOnly) assert.ok(pathArg, "confirmatory runs require --preregistration=<pre-run registration.json>");
  if (studyStage === "pilot") assert.ok(!pathArg, "--preregistration is reserved for confirmatory runs");
  if (!pathArg) return null;
  const path = resolve(pathArg);
  const bytes = readFileSync(path);
  const registration = JSON.parse(bytes.toString("utf8"));
  if (studyStage === "confirmatory") {
    const dirtyGameEnginePaths = execFileSync("git", ["status", "--porcelain", "--", "packages/game-engine/src"], { encoding: "utf8" })
      .split("\n").filter(Boolean);
    validateConfirmatoryRegistration(registration, { protocol, dirtyGameEnginePaths });
  }
  return { path: pathArg, sha256: sha256(bytes), registration };
}

function writeArtifact(path: string | undefined, evidence: unknown): void {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (!path) {
    process.stdout.write(serialized);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, serialized, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

async function run(): Promise<void> {
  const armRandom = shuffledArmOrders(pairCount, orderSeed);
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const protocol = buildRunProtocol(armRandom, gitHead, dirtyPaths, sourceHashes());
  const externalPreregistration = registerExternalPreregistration(protocol);
  protocol.campaignIdentitySha256 = sha256(JSON.stringify({
    gitHead,
    sourceSha256: protocol.runMetadata.sourceSha256,
    preregistration: protocol.preregistration,
    config: protocol.config,
    studyStatus: protocol.studyStatus,
    externalPreregistration,
  }));
  protocol.runMetadata.campaignIdentitySha256 = protocol.campaignIdentitySha256;
  protocol.snapshotPath = `output/bot-strategy/research-gate-${seedStart}-${pairCount}-${orderSeed}-${protocol.campaignIdentitySha256.slice(0, 12)}-harness-at-run.tsx`;
  protocol.runMetadata.harnessSnapshotPath = protocol.snapshotPath;
  if (planOnly) {
    process.stdout.write(`${JSON.stringify({ status: "PLAN_ONLY — no matches or files created", campaignIdentitySha256: protocol.campaignIdentitySha256, gitHead, studyStatus: protocol.studyStatus, preregistration: protocol.preregistration, config: protocol.config, sourceSha256: protocol.runMetadata.sourceSha256 }, null, 2)}\n`);
    return;
  }
  mkdirSync(dirname(checkpointPath), { recursive: true });
  const checkpointLock = acquireCheckpointLock(checkpointPath);
  try {
  const snapshotPath = resolve(protocol.snapshotPath);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const helperSnapshotPath = snapshotPath.replace(/-harness-at-run\.tsx$/, "-checkpoint-at-run.mjs");
  const sourceSnapshotPaths = {
    "scripts/verify-bot-research-gates-paired.tsx": protocol.snapshotPath,
    "scripts/research-gate-checkpoint.mjs": helperSnapshotPath.replace(`${process.cwd()}/`, ""),
  };
  const sourceSnapshotSha256: Record<string, string> = {};
  for (const [sourcePath, destinationPath] of Object.entries(sourceSnapshotPaths)) {
    const absoluteDestination = resolve(destinationPath);
    const sourceBytes = readFileSync(resolve(process.cwd(), sourcePath));
    sourceSnapshotSha256[sourcePath] = sha256(sourceBytes);
    if (existsSync(absoluteDestination)) {
      assert.equal(sha256(readFileSync(absoluteDestination)), sourceSnapshotSha256[sourcePath], `${sourcePath} snapshot must exactly match current source`);
    } else {
      writeFileSync(absoluteDestination, sourceBytes, { flag: "wx", mode: 0o600 });
    }
  }
  protocol.runMetadata.harnessSnapshotSha256 = sourceSnapshotSha256["scripts/verify-bot-research-gates-paired.tsx"];
  protocol.runMetadata.sourceSnapshotPaths = sourceSnapshotPaths;
  protocol.runMetadata.sourceSnapshotSha256 = sourceSnapshotSha256;
  const header = {
    schemaVersion: 1,
    targetPairCount: pairCount,
    campaignIdentitySha256: protocol.campaignIdentitySha256,
    studyStatus: protocol.studyStatus,
    runMetadata: protocol.runMetadata,
    preregistration: protocol.preregistration,
    config: protocol.config,
    externalPreregistration,
  };
  let pairs: PairEvidence[] = [];
  if (resume) {
    assert.ok(existsSync(checkpointPath), `--resume checkpoint does not exist: ${checkpointPath}`);
    const checkpoint = readCheckpoint(checkpointPath, { repairTrailingPartialLine: true });
    if (checkpoint.discardedByteLength) repairCheckpointTail(checkpointPath, checkpoint.validByteLength);
    assertCheckpointCompatible(checkpoint.header, {
      campaignIdentitySha256: protocol.campaignIdentitySha256,
      config: protocol.config,
      preregistration: protocol.preregistration,
    });
    assert.ok(checkpoint.pairs.length <= pairCount, "checkpoint cannot contain more pairs than preregistered");
    pairs = checkpoint.pairs as PairEvidence[];
    protocol.runMetadata = checkpoint.header.runMetadata;
  } else {
    assert.ok(!existsSync(checkpointPath), `checkpoint already exists; pass --resume to continue it: ${checkpointPath}`);
    createCheckpoint(checkpointPath, header);
  }
  let requestedSignal: NodeJS.Signals | null = null;
  const stop = (signal: NodeJS.Signals) => { requestedSignal = signal; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (let pairIndex = pairs.length; pairIndex < pairCount && requestedSignal === null; pairIndex += 1) {
    const [playerCount, focalSeat] = ROTATION_PLAN[pairIndex % ROTATION_PLAN.length]!;
    const seed = seedStart + pairIndex;
    const { state: initialState, setupSeed, setupRandom } = completeRotatedSetup(playerCount, seed, pairIndex, focalSeat);
    const fixedTacticsBySeat = initialState.players.map((_, seat): BotTactic => seat === focalSeat ? "research-first" : "force-first");
    const setupAssignments = initialState.setupAssignments!.map((seat) => ({
      playerIndex: seat.playerIndex,
      monster: initialState.monsters[seat.playerIndex]?.name ?? "unknown",
      branch: seat.branch!,
      lair: seat.lair!,
    }));
    const initialStateSha256 = digest(JSON.stringify(initialState));
    const randomizedArmOrder = armRandom.treatmentFirst[pairIndex] === "control"
      ? ["control", "urgency-gates-bypassed"] as const
      : ["urgency-gates-bypassed", "control"] as const;
    const byTreatment = new Map<Treatment, MatchEvidence>();
    for (const [executionOrder, treatment] of randomizedArmOrder.entries()) {
      byTreatment.set(treatment, playMatch(initialState, focalSeat, fixedTacticsBySeat, treatment, executionOrder + 1, maxRounds));
    }
    const control = byTreatment.get("control")!;
    const treatment = byTreatment.get("urgency-gates-bypassed")!;
    assert.deepEqual(control.initialRng, treatment.initialRng, "both arms must clone the same engine RNG state");
    assert.deepEqual(control.fixedTacticsBySeat, treatment.fixedTacticsBySeat, "focal and opponent tactics must be identical between arms");
    const divergence = pairedDivergence(control, treatment);
    const pairedStatus: PairEvidence["pairedStatus"] = control.invalidActionEvidence || treatment.invalidActionEvidence || control.outcome === "invalid" || treatment.outcome === "invalid"
      ? "invalid-pair"
      : control.score === null || treatment.score === null
        ? "incomplete-pair"
        : "complete-pair";
    const pair: PairEvidence = {
      pairIndex,
      playerCount,
      seed,
      setupSeed,
      setupRandomStream: { algorithm: "xorshift32", finalState: setupRandom.state, draws: setupRandom.draws },
      focalSeat,
      focalMonster: initialState.monsters[focalSeat]?.name ?? "unknown",
      focalBranch: initialState.setupAssignments?.[focalSeat]?.branch ?? "unknown",
      focalLair: initialState.setupAssignments?.[focalSeat]?.lair ?? "unknown",
      focalLairSlot: (Math.floor(pairIndex / initialState.setupState!.definition.monsterIds.length) + pairIndex % initialState.setupState!.definition.monsterIds.length) % 3,
      initialStateSha256,
      initialStateSnapshot: initialState,
      initialRng: { ...initialState.rng },
      setupAssignments,
      fixedTacticsBySeat,
      randomizedArmOrder: [...randomizedArmOrder],
      control,
      treatment,
      ...divergence,
      scoreDifferenceTreatmentMinusControl: control.score !== null && treatment.score !== null ? treatment.score - control.score : null,
      pairedStatus,
    };
    appendCheckpointPair(checkpointPath, pair);
    pairs.push(pair);
    await new Promise<void>((resolveNextPair) => setImmediate(resolveNextPair));
  }
  const evidence = {
    schemaVersion: 1,
    studyStatus: protocol.studyStatus,
    artifactCompleteness: pairs.length === pairCount ? "complete-preregistered-block" : "partial-checkpoint-export",
    completedPairCount: pairs.length,
    generatedAt: new Date().toISOString(),
    runMetadata: { ...protocol.runMetadata, checkpointPath: checkpointPath.replace(`${process.cwd()}/`, "") },
    preregistration: protocol.preregistration,
    config: protocol.config,
    externalPreregistration,
    summary: summarizeResearchGatePairs(pairs),
    pairs,
  };
  writeArtifact(outputPath, evidence);
  if (requestedSignal) process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
  if (evidence.summary.outcomesByArm.control.invalid > 0 || evidence.summary.outcomesByArm.treatment.invalid > 0) process.exitCode = 1;
  } finally {
    checkpointLock.release();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
