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
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupState,
} from "../packages/game-engine/src/index.js";
import { chooseBotCommand, chooseBotSetupAction, type BotTactic } from "../packages/game-engine/src/bots.js";

const DEFAULT_PAIR_COUNT = 30;
const DEFAULT_SEED_START = 6200;
const DEFAULT_ORDER_SEED = 20260928;
const DEFAULT_MAX_ROUNDS = 12;
const ACTION_SAFETY_CAP = 2_000;
const MULTIPLIERS = [0.9, 1.15] as const;
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
const orderSeed = readIntegerArg("order-seed", DEFAULT_ORDER_SEED);
const maxRounds = readIntegerArg("max-rounds", DEFAULT_MAX_ROUNDS);
assert.ok(pairCount > 0 && pairCount <= 500, "pair-count must be between 1 and 500");
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
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function completeRotatedSetup(playerCount: 3 | 4, seed: number, rotation: number): GameState {
  const game = createMvpRoomGame(playerCount, seed, `route-multiplier-${playerCount}-${seed}`);
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
      setup = chooseLair(setup, seat.playerIndex, options[(rotation + seat.playerIndex) % options.length]!);
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

type Outcome = "win" | "draw" | "loss" | "incomplete" | "invalid";
type MatchTermination = "terminal" | "round-cap" | "action-safety-cap" | "invalid-action";
type Multiplier = typeof MULTIPLIERS[number];

interface SeatDiagnostics {
  commands: Record<string, number>;
  turnsPassed: number;
  objectiveStomps: number;
  objectiveKinds: Record<string, number>;
  finalHealth: number;
  finalInfamy: number;
  actions: number;
}

interface MatchEvidence {
  multiplier: Multiplier;
  armOrder: number;
  fixedTacticsBySeat: BotTactic[];
  focalSeat: number;
  focalMonster: string;
  focalBranch: string;
  focalLair: string;
  outcome: Outcome;
  score: number | null;
  termination: MatchTermination;
  winner: null | { playerIndex: number; monster: string; branch: string | null; victoryType: GameState["victoryType"] };
  roundsCompleted: number;
  finalRound: number;
  actions: number;
  initialRng: GameState["rng"];
  finalRng: GameState["rng"];
  invalidActionEvidence: null | { actionNumber: number; actor: number; command: GameCommand | undefined; phase: string; error: string };
  seats: Array<{ playerIndex: number; monster: string; branch: string | null; lair: string | null; tactic: BotTactic; diagnostics: SeatDiagnostics }>;
  actionTrace: Array<{ actor: number; commandType: string; commandSha256: string; rngCursorBefore: number; rngCursorAfter: number }>;
}

interface PairEvidence {
  pairIndex: number;
  playerCount: 3 | 4;
  seed: number;
  setupRotation: number;
  focalSeat: number;
  randomizedArmOrder: Multiplier[];
  initialStateSha256: string;
  initialRng: GameState["rng"];
  setupAssignments: Array<{ playerIndex: number; monster: string; branch: string; lair: string }>;
  fixedTacticsBySeat: BotTactic[];
  low: MatchEvidence;
  high: MatchEvidence;
  firstCommandDivergenceAction: number | null;
  firstRngCursorDivergenceAction: number | null;
  alignedActionsCompared: number;
  scoreDifferenceLowMinusHigh: number | null;
  pairedStatus: "complete-pair" | "incomplete-pair" | "invalid-pair";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptySeatDiagnostics(): SeatDiagnostics {
  return { commands: {}, turnsPassed: 0, objectiveStomps: 0, objectiveKinds: {}, finalHealth: 0, finalInfamy: 0, actions: 0 };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function matchOutcome(state: GameState, focalSeat: number, invalid: boolean): Outcome {
  if (invalid) return "invalid";
  if (state.phase !== "game-over") return "incomplete";
  if (state.winnerPlayer === undefined || state.winnerPlayer === null) return "draw";
  return state.winnerPlayer === focalSeat ? "win" : "loss";
}

function playMatch(
  initialState: GameState,
  focalSeat: number,
  fixedTacticsBySeat: BotTactic[],
  multiplier: Multiplier,
  armOrder: number,
  maximumRounds: number,
): MatchEvidence {
  let state = structuredClone(initialState);
  const initialRound = state.round;
  const initialRng = { ...state.rng };
  const botPlayers = new Set(state.players.map((_, index) => index));
  const tacticOverrides = new Map<number, BotTactic>(fixedTacticsBySeat.map((tactic, index) => [index, tactic]));
  const routeMultiplierOverrides = new Map<number, number>([[focalSeat, multiplier]]);
  const diagnostics = state.players.map(() => emptySeatDiagnostics());
  const actionTrace: MatchEvidence["actionTrace"] = [];
  let actions = 0;
  let invalidActionEvidence: MatchEvidence["invalidActionEvidence"] = null;

  while (state.phase !== "game-over" && state.round <= maximumRounds && actions < ACTION_SAFETY_CAP) {
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision
      ? state.pendingDecision.playerIndex
      : state.currentPlayer;
    actions += 1;
    const command = chooseBotCommand(state, botPlayers, tacticOverrides, undefined, routeMultiplierOverrides);
    if (!command) {
      invalidActionEvidence = { actionNumber: actions, actor, command, phase: state.phase, error: "Bot returned no command for an active decision." };
      break;
    }
    const before = state.rng.cursor;
    let next: GameState;
    try {
      next = applyCommand(state, command).state;
    } catch (error) {
      invalidActionEvidence = {
        actionNumber: actions,
        actor,
        command,
        phase: state.phase,
        error: error instanceof Error ? error.message : String(error),
      };
      break;
    }
    actionTrace.push({
      actor,
      commandType: command.type,
      commandSha256: digest(JSON.stringify(command)),
      rngCursorBefore: before,
      rngCursorAfter: next.rng.cursor,
    });
    const actorDiagnostics = diagnostics[actor]!;
    actorDiagnostics.actions += 1;
    increment(actorDiagnostics.commands, command.type);
    const latestEvent = next.eventLog.at(-1);
    if (latestEvent?.action === "turn.passed") actorDiagnostics.turnsPassed += 1;
    if (latestEvent?.action === "encounter.resolved") {
      const detail = latestEvent.detail as { playerIndex?: number; location?: string; stomped?: boolean };
      if (detail.playerIndex !== undefined && detail.stomped && detail.location) {
        const scoringSeat = diagnostics[detail.playerIndex];
        if (scoringSeat) {
          scoringSeat.objectiveStomps += 1;
          const hex = boardForState(next).hexes[detail.location as HexKey];
          for (const feature of hex?.features ?? []) increment(scoringSeat.objectiveKinds, feature.kind);
        }
      }
    }
    state = next;
  }

  for (const [playerIndex, seatDiagnostics] of diagnostics.entries()) {
    seatDiagnostics.finalHealth = state.monsters[playerIndex]?.health ?? 0;
    seatDiagnostics.finalInfamy = state.monsters[playerIndex]?.infamy ?? 0;
  }
  const termination: MatchTermination = invalidActionEvidence
    ? "invalid-action"
    : state.phase === "game-over"
      ? "terminal"
      : actions >= ACTION_SAFETY_CAP
        ? "action-safety-cap"
        : "round-cap";
  const winnerIndex = state.winnerPlayer;
  const outcome = matchOutcome(state, focalSeat, Boolean(invalidActionEvidence));
  return {
    multiplier,
    armOrder,
    fixedTacticsBySeat,
    focalSeat,
    focalMonster: state.monsters[focalSeat]?.name ?? "unknown",
    focalBranch: state.setupAssignments?.[focalSeat]?.branch ?? "unknown",
    focalLair: initialState.setupAssignments?.[focalSeat]?.lair ?? "unknown",
    outcome,
    score: outcome === "win" ? 1 : outcome === "draw" ? 0.5 : outcome === "loss" ? 0 : null,
    termination,
    winner: winnerIndex === undefined || winnerIndex === null ? null : {
      playerIndex: winnerIndex,
      monster: state.monsters[winnerIndex]?.name ?? "unknown",
      branch: state.setupAssignments?.[winnerIndex]?.branch ?? null,
      victoryType: state.victoryType,
    },
    roundsCompleted: Math.min(maximumRounds, Math.max(0, state.round - initialRound)),
    finalRound: state.round,
    actions,
    initialRng,
    finalRng: { ...state.rng },
    invalidActionEvidence,
    seats: state.players.map((_, playerIndex) => ({
      playerIndex,
      monster: state.monsters[playerIndex]?.name ?? "unknown",
      branch: state.setupAssignments?.[playerIndex]?.branch ?? null,
      lair: initialState.setupAssignments?.[playerIndex]?.lair ?? null,
      tactic: fixedTacticsBySeat[playerIndex]!,
      diagnostics: diagnostics[playerIndex]!,
    })),
    actionTrace,
  };
}

function randomizeArmOrders(count: number, seed: number): Multiplier[][] {
  const random = seededRandom(seed);
  const firstArms: Multiplier[] = Array.from({ length: Math.floor(count / 2) }, () => [0.9, 1.15] as const).flat();
  if (count % 2) firstArms.push(random() < 0.5 ? 0.9 : 1.15);
  const randomized = shuffled(firstArms, random);
  return randomized.map((first) => [first, first === 0.9 ? 1.15 : 0.9]);
}

function pairedDivergence(low: MatchEvidence, high: MatchEvidence) {
  const alignedActionsCompared = Math.min(low.actionTrace.length, high.actionTrace.length);
  let firstCommandDivergenceAction: number | null = null;
  let firstRngCursorDivergenceAction: number | null = null;
  for (let index = 0; index < alignedActionsCompared; index += 1) {
    const lowAction = low.actionTrace[index]!;
    const highAction = high.actionTrace[index]!;
    if (firstCommandDivergenceAction === null
      && (lowAction.actor !== highAction.actor || lowAction.commandType !== highAction.commandType || lowAction.commandSha256 !== highAction.commandSha256)) {
      firstCommandDivergenceAction = index + 1;
    }
    if (firstRngCursorDivergenceAction === null && lowAction.rngCursorAfter !== highAction.rngCursorAfter) {
      firstRngCursorDivergenceAction = index + 1;
    }
  }
  return { alignedActionsCompared, firstCommandDivergenceAction, firstRngCursorDivergenceAction };
}

function bootstrapMeanInterval(values: number[], seed: number, replicates = 20_000): [number, number] | null {
  if (!values.length) return null;
  if (values.length === 1) return [values[0]!, values[0]!];
  const random = seededRandom(seed);
  const means = new Array<number>(replicates);
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(random() * values.length)]!;
    means[replicate] = total / values.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor((replicates - 1) * 0.025)]!, means[Math.floor((replicates - 1) * 0.975)]!];
}

function tCritical975(degreesFreedom: number): number {
  const z = 1.959963984540054;
  const df = degreesFreedom;
  return z
    + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

function pairedSummary(pairs: PairEvidence[]) {
  const terminal = pairs.map((pair) => pair.scoreDifferenceLowMinusHigh).filter((value): value is number => value !== null);
  const complete = pairs.filter((pair) => pair.pairedStatus === "complete-pair");
  const diffs = complete.map((pair) => pair.scoreDifferenceLowMinusHigh!).filter((value) => value !== null);
  const mean = diffs.length ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length : null;
  const variance = diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - mean!) ** 2, 0) / (diffs.length - 1) : null;
  const standardError = variance === null ? null : Math.sqrt(variance / diffs.length);
  const critical = diffs.length > 1 ? tCritical975(diffs.length - 1) : null;
  const completePairTInterval = mean === null ? null : standardError === null ? [mean, mean] : [mean - critical! * standardError, mean + critical! * standardError];

  let worstCaseLower = 0;
  let worstCaseUpper = 0;
  for (const pair of pairs) {
    const lowScore = pair.low.score;
    const highScore = pair.high.score;
    if (lowScore !== null && highScore !== null) {
      worstCaseLower += lowScore - highScore;
      worstCaseUpper += lowScore - highScore;
    } else {
      const lowMin = lowScore ?? 0;
      const lowMax = lowScore ?? 1;
      const highMin = highScore ?? 0;
      const highMax = highScore ?? 1;
      worstCaseLower += lowMin - highMax;
      worstCaseUpper += lowMax - highMin;
    }
  }
  const divide = pairs.length || 1;
  const outcomesByMultiplier = Object.fromEntries(MULTIPLIERS.map((multiplier) => {
    const matches = pairs.flatMap((pair) => [pair.low, pair.high]).filter((match) => match.multiplier === multiplier);
    const outcomes = Object.fromEntries(((["win", "draw", "loss", "incomplete", "invalid"] as const).map((outcome) => [
      outcome,
      matches.filter((match) => match.outcome === outcome).length,
    ])));
    const scored = matches.flatMap((match) => match.score === null ? [] : [match.score]);
    return [String(multiplier), {
      matches: matches.length,
      outcomes,
      terminalMeanScore: scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null,
      terminalScoredMatches: scored.length,
      invalidActions: matches.filter((match) => match.invalidActionEvidence !== null).length,
      roundCapped: matches.filter((match) => match.termination === "round-cap").length,
      actionSafetyCapped: matches.filter((match) => match.termination === "action-safety-cap").length,
      meanActions: matches.length ? matches.reduce((sum, match) => sum + match.actions, 0) / matches.length : null,
      meanRounds: matches.length ? matches.reduce((sum, match) => sum + match.roundsCompleted, 0) / matches.length : null,
      focalObjectiveStomps: matches.reduce((sum, match) => sum + (match.seats[match.focalSeat]?.diagnostics.objectiveStomps ?? 0), 0),
      meanFocalFinalHealth: matches.length ? matches.reduce((sum, match) => sum + (match.seats[match.focalSeat]?.diagnostics.finalHealth ?? 0), 0) / matches.length : null,
      meanFocalFinalInfamy: matches.length ? matches.reduce((sum, match) => sum + (match.seats[match.focalSeat]?.diagnostics.finalInfamy ?? 0), 0) / matches.length : null,
      focalCommands: matches.reduce((sum, match) => {
        for (const [command, count] of Object.entries(match.seats[match.focalSeat]?.diagnostics.commands ?? {})) sum[command] = (sum[command] ?? 0) + count;
        return sum;
      }, {} as Record<string, number>),
    }];
  }));
  const discordant = diffs.filter((value) => value !== 0);
  return {
    outcomeByMultiplier: outcomesByMultiplier,
    pairDispositionCounts: Object.fromEntries(["complete-pair", "incomplete-pair", "invalid-pair"].map((status) => [status, pairs.filter((pair) => pair.pairedStatus === status).length])),
    pairedScore: {
      estimand: "mean(focal match score at multiplier 0.9 minus focal match score at multiplier 1.15), among pairs with two valid terminal outcomes",
      completeTerminalPairs: diffs.length,
      meanDifference: mean,
      standardError: standardError,
      approximatePairedT95ConfidenceInterval: completePairTInterval,
      deterministicBootstrapPercentile95ConfidenceInterval: bootstrapMeanInterval(diffs, orderSeed ^ 0x6d2b79f5),
      discordantCompletePairs: discordant.length,
      favoringLowMultiplier: discordant.filter((value) => value > 0).length,
      favoringHighMultiplier: discordant.filter((value) => value < 0).length,
      worstCaseMeanDifferenceBoundsAcrossAllRandomizedPairs: [worstCaseLower / divide, worstCaseUpper / divide],
      incompletePairsAreCensoredAndExcludedFromCompletePairEstimate: true,
    },
    setupComposition: {
      focalPlayerCounts: Object.fromEntries([...new Set(pairs.map((pair) => pair.playerCount))].map((count) => [String(count), pairs.filter((pair) => pair.playerCount === count).length])),
      focalSeatCounts: Object.fromEntries([...new Set(pairs.map((pair) => pair.focalSeat))].sort().map((seat) => [String(seat), pairs.filter((pair) => pair.focalSeat === seat).length])),
      focalMonsters: pairs.reduce((counts, pair) => { increment(counts, pair.low.focalMonster); return counts; }, {} as Record<string, number>),
      focalBranches: pairs.reduce((counts, pair) => { increment(counts, pair.low.focalBranch); return counts; }, {} as Record<string, number>),
      allSeatMonsters: pairs.flatMap((pair) => pair.setupAssignments).reduce((counts, seat) => { increment(counts, seat.monster); return counts; }, {} as Record<string, number>),
      allSeatBranches: pairs.flatMap((pair) => pair.setupAssignments).reduce((counts, seat) => { increment(counts, seat.branch); return counts; }, {} as Record<string, number>),
    },
    rngAndActionDivergence: {
      pairsWithCommandDivergence: pairs.filter((pair) => pair.firstCommandDivergenceAction !== null).length,
      pairsWithRngCursorDivergence: pairs.filter((pair) => pair.firstRngCursorDivergenceAction !== null).length,
      medianFirstCommandDivergenceAction: median(pairs.flatMap((pair) => pair.firstCommandDivergenceAction === null ? [] : [pair.firstCommandDivergenceAction])),
      medianFirstRngCursorDivergenceAction: median(pairs.flatMap((pair) => pair.firstRngCursorDivergenceAction === null ? [] : [pair.firstRngCursorDivergenceAction])),
    },
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 ? values[midpoint]! : (values[midpoint - 1]! + values[midpoint]!) / 2;
}

function run(): void {
  const armOrders = randomizeArmOrders(pairCount, orderSeed);
  assert.equal(armOrders.length, pairCount, "one randomized execution order is required for every paired setup");
  const lowFirstCount = armOrders.filter((order) => order[0] === 0.9).length;
  const highFirstCount = armOrders.filter((order) => order[0] === 1.15).length;
  assert.ok(Math.abs(lowFirstCount - highFirstCount) <= 1, "paired arm execution order must be balanced");
  const pairs: PairEvidence[] = [];
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const [playerCount, focalSeat] = ROTATION_PLAN[pairIndex % ROTATION_PLAN.length]!;
    const seed = seedStart + pairIndex;
    const initialState = completeRotatedSetup(playerCount, seed, pairIndex);
    const initialStateSha256 = digest(JSON.stringify(initialState));
    const fixedTacticsBySeat = initialState.players.map((): BotTactic => "force-first");
    const setupAssignments = initialState.setupAssignments!.map((seat) => ({
      playerIndex: seat.playerIndex,
      monster: initialState.monsters[seat.playerIndex]?.name ?? "unknown",
      branch: seat.branch,
      lair: seat.lair,
    }));
    const [firstMultiplier, secondMultiplier] = armOrders[pairIndex]!;
    const byMultiplier = new Map<Multiplier, MatchEvidence>();
    for (const [armOrder, multiplier] of [firstMultiplier, secondMultiplier].entries()) {
      const evidence = playMatch(initialState, focalSeat, fixedTacticsBySeat, multiplier, armOrder + 1, maxRounds);
      byMultiplier.set(multiplier, evidence);
    }
    const low = byMultiplier.get(0.9)!;
    const high = byMultiplier.get(1.15)!;
    assert.deepEqual(low.initialRng, high.initialRng, "paired treatments must begin at identical RNG state");
    assert.deepEqual(low.fixedTacticsBySeat, high.fixedTacticsBySeat, "paired treatments must pin every seat's tactic identically");
    const divergence = pairedDivergence(low, high);
    const pairedStatus: PairEvidence["pairedStatus"] = low.invalidActionEvidence || high.invalidActionEvidence
      ? "invalid-pair"
      : low.outcome === "incomplete" || high.outcome === "incomplete"
        ? "incomplete-pair"
        : "complete-pair";
    pairs.push({
      pairIndex,
      playerCount,
      seed,
      setupRotation: pairIndex,
      focalSeat,
      randomizedArmOrder: [...armOrders[pairIndex]!],
      initialStateSha256,
      initialRng: { ...initialState.rng },
      setupAssignments,
      fixedTacticsBySeat,
      low,
      high,
      ...divergence,
      scoreDifferenceLowMinusHigh: low.score !== null && high.score !== null ? low.score - high.score : null,
      pairedStatus,
    });
  }

  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const botsPath = resolve(process.cwd(), "packages/game-engine/src/bots.ts");
  const harnessSource = readFileSync(new URL(import.meta.url), "utf8");
  const botsSource = readFileSync(botsPath, "utf8");
  const evidence = {
    schemaVersion: 1,
    runMetadata: {
      generatedAt: new Date().toISOString(),
      gitHead: head,
      worktreeDirty: dirtyPaths.length > 0,
      dirtyPathCount: dirtyPaths.length,
      sourceSha256: { botSelector: digest(botsSource), harness: digest(harnessSource) },
    },
    preregistration: {
      primaryOutcome: "Focal match score: win=1, draw=0.5, loss=0; compare within-pair difference 0.9 minus 1.15.",
      intervention: "Only the focal seat's route-block multiplier changes: 0.9 versus 1.15. Every seat is pinned to force-first in both arms; non-focal seats retain the force-first default route multiplier of 1.15.",
      assignments: "Clone the same completed legal setup for both arms; use the same engine seed and initial RNG cursor. Rotate player count, focal seat, seeded distinct monster/branch composition and legal lairs. Randomize execution order within pairs using a separate seeded Fisher-Yates order list, balanced as evenly as possible.",
      capHandling: "Retain every match and pair. Incomplete/capped pairs are censored from the complete-pair mean; report worst-case mean-score bounds over all randomized pairs. Invalid pairs are kept and reported as implementation failures.",
      analysis: "Report complete-pair mean score difference, paired t interval, deterministic paired bootstrap percentile interval, discordant-pair direction, arm outcome counts, and execution/score diagnostics. No policy change is justified by this single study alone.",
      rngDivergence: "Compare command identity and post-action RNG cursor by aligned action index. Record first command divergence, first cursor divergence, aligned action count, initial/final RNG states per arm. A shared cursor does not imply identical causal random outcomes after different states/actions.",
    },
    config: {
      pairCount,
      seedStart,
      orderSeed,
      maximumRoundsPerMatch: maxRounds,
      actionSafetyCapPerMatch: ACTION_SAFETY_CAP,
      multipliers: MULTIPLIERS,
      fixedTacticForAllSeats: "force-first",
      playerCounts: [3, 4],
      focalSeatPlan: ROTATION_PLAN,
      armOrderBalance: { lowMultiplierFirst: armOrders.filter((order) => order[0] === 0.9).length, highMultiplierFirst: armOrders.filter((order) => order[0] === 1.15).length },
      setupRotation: "Seeded distinct monster and branch permutations are rotated by pair index; legal lairs rotate through each monster's unclaimed options; focal seat/player-count plan cycles through all seats.",
    },
    summary: pairedSummary(pairs),
    pairs,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.summary.outcomeByMultiplier["0.9"].invalidActions > 0 || evidence.summary.outcomeByMultiplier["1.15"].invalidActions > 0 || evidence.summary.outcomeByMultiplier["0.9"].actionSafetyCapped > 0 || evidence.summary.outcomeByMultiplier["1.15"].actionSafetyCapped > 0) {
    process.exitCode = 1;
  }
}

run();
