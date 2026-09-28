import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import inspector from "node:inspector";
import {
  applyCommand,
  applyCompletedSetup,
  boardForState,
  createMvpRoomGame,
  deploymentChoices,
  type GameState,
} from "../packages/game-engine/src/index.js";
import {
  botTacticForPlayer,
  chooseBotCommand,
  chooseBotSetupAction,
} from "../apps/web/src/solo-bots.js";

const DEFAULT_SEED_START = 0;
const DEFAULT_SEED_COUNT = 12;
const DEFAULT_MAX_ROUNDS = 12;
const ACTION_SAFETY_CAP = 2_000;
const PROFILE_SAMPLE_INTERVAL_US = 1_000;

type Profile = {
  nodes: Array<{ id: number; callFrame: { functionName: string }; children?: number[] }>;
  samples?: number[];
  timeDeltas?: number[];
};

function readIntegerArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

const seedStart = readIntegerArg("seed-start", DEFAULT_SEED_START);
const seedCount = readIntegerArg("seed-count", DEFAULT_SEED_COUNT);
const maxRounds = readIntegerArg("max-rounds", DEFAULT_MAX_ROUNDS);
assert.ok(seedStart >= 0, "seed-start must be non-negative");
assert.ok(seedCount > 0 && seedCount <= 100, "seed-count must be between 1 and 100");
assert.ok(maxRounds > 0 && maxRounds <= 100, "max-rounds must be between 1 and 100");

function createAllBotMatch(playerCount: 3 | 4, seed: number): GameState {
  const game = createMvpRoomGame(playerCount, seed, `bot-batch-${playerCount}-${seed}`);
  let setup = game.setupState!;
  for (let step = 0; setup.phase !== "complete" && step < playerCount * 4; step += 1) {
    let playerIndex: number;
    if (setup.phase === "monster-selection" || setup.phase === "starting-choice") {
      const field = setup.phase === "monster-selection" ? "monsterId" : "startingChoice";
      const seat = setup.seats.find((candidate) => candidate[field] === undefined);
      assert.ok(seat, `setup has no undecided seat during ${setup.phase}`);
      playerIndex = seat.playerIndex;
    } else if (setup.phase === "branch-selection") {
      const seat = [...setup.seats].reverse().find((candidate) => !candidate.branch);
      assert.ok(seat, "setup has no undecided branch seat");
      playerIndex = seat.playerIndex;
    } else {
      const seat = setup.seats.find((candidate) => !candidate.lair);
      assert.ok(seat, "setup has no undecided lair seat");
      playerIndex = seat.playerIndex;
    }
    const next = chooseBotSetupAction({ ...game, setupState: setup }, setup, playerIndex);
    assert.notEqual(next, setup, `bot setup did not advance ${setup.phase} for seat ${playerIndex}`);
    setup = next;
  }
  assert.equal(setup.phase, "complete", `${playerCount}-seat setup should complete`);
  assert.equal(new Set(setup.seats.map((seat) => seat.monsterId)).size, playerCount, "setup should assign distinct monsters");
  assert.equal(new Set(setup.seats.map((seat) => seat.branch)).size, playerCount, "setup should assign distinct branches");
  assert.equal(new Set(setup.seats.map((seat) => seat.lair)).size, playerCount, "setup should assign distinct lairs");
  return applyCompletedSetup({ ...game, setupState: setup });
}

interface InvalidActionEvidence {
  actionNumber: number;
  seat: number;
  round: number;
  phase: string;
  pendingDecision?: string;
  command?: unknown;
  error: string;
}

interface MatchResult {
  playerCount: 3 | 4;
  seed: number;
  termination: "terminal" | "round-cap" | "action-safety-cap" | "invalid-action";
  roundsCompleted: number;
  finalRound: number;
  actions: number;
  turns: number;
  invalidActions: number;
  routeScoringCalls: number;
  winnerPlayer: number | null;
  victoryType: GameState["victoryType"] | null;
  stompedObjectiveCount: number;
  seats: Array<{
    playerIndex: number;
    monster: string;
    tactic: string;
    finalHealth: number;
    finalInfamy: number;
    branch: string | null;
    actions: number;
    turns: number;
  }>;
  failure?: InvalidActionEvidence;
}

function playMatch(playerCount: 3 | 4, seed: number): MatchResult {
  let state = createAllBotMatch(playerCount, seed);
  const matchStartRound = state.round;
  const bots = new Set(state.players.map((_, index) => index));
  const actionsBySeat = Array.from({ length: playerCount }, () => 0);
  const turnsBySeat = Array.from({ length: playerCount }, () => 0);
  let actions = 0;
  let turns = 0;
  let invalidActions = 0;
  let routeScoringCalls = 0;
  let failure: InvalidActionEvidence | undefined;

  while (state.phase !== "game-over" && state.round <= maxRounds && actions < ACTION_SAFETY_CAP) {
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision
      ? state.pendingDecision.playerIndex
      : state.currentPlayer;
    const command = chooseBotCommand(state, bots);
    if (command && botCommandCallsRouteScoring(state, command)) routeScoringCalls += 1;
    actions += 1;
    actionsBySeat[actor]! += 1;
    if (!command) {
      invalidActions += 1;
      failure = {
        actionNumber: actions,
        seat: actor,
        round: state.round,
        phase: state.phase,
        pendingDecision: state.pendingDecision?.type,
        error: "Bot returned no command for an active seat decision.",
      };
      break;
    }
    try {
      const result = applyCommand(state, command);
      state = result.state;
    } catch (error) {
      invalidActions += 1;
      failure = {
        actionNumber: actions,
        seat: actor,
        round: state.round,
        phase: state.phase,
        pendingDecision: state.pendingDecision?.type,
        command,
        error: error instanceof Error ? error.message : String(error),
      };
      break;
    }
    if (state.eventLog.at(-1)?.action === "turn.passed") {
      turns += 1;
      turnsBySeat[actor]! += 1;
    }
  }

  const termination: MatchResult["termination"] = failure
    ? "invalid-action"
    : state.phase === "game-over"
      ? "terminal"
      : actions >= ACTION_SAFETY_CAP
        ? "action-safety-cap"
        : "round-cap";
  return {
    playerCount,
    seed,
    termination,
    roundsCompleted: Math.min(maxRounds, Math.max(0, state.round - matchStartRound)),
    finalRound: state.round,
    actions,
    turns,
    invalidActions,
    routeScoringCalls,
    winnerPlayer: state.winnerPlayer ?? null,
    victoryType: state.victoryType ?? null,
    stompedObjectiveCount: state.stompedLocations.filter((location) => {
      const features = boardForState(state).hexes[location]?.features ?? [];
      return features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site" || feature.kind === "military-base");
    }).length,
    seats: state.players.map((_, playerIndex) => ({
      playerIndex,
      monster: state.monsters[playerIndex]?.name ?? "unknown",
      tactic: botTacticForPlayer(state, playerIndex),
      finalHealth: state.monsters[playerIndex]?.health ?? 0,
      finalInfamy: state.monsters[playerIndex]?.infamy ?? 0,
      branch: state.setupAssignments?.[playerIndex]?.branch ?? null,
      actions: actionsBySeat[playerIndex]!,
      turns: turnsBySeat[playerIndex]!,
    })),
    ...(failure ? { failure } : {}),
  };
}

function botCommandCallsRouteScoring(state: GameState, command: ReturnType<typeof chooseBotCommand>): boolean {
  if (!command) return false;
  const decision = state.pendingDecision;
  if (decision?.type === "deployment" || state.phase === "deploy") {
    const hasDeploymentOptions = deploymentChoices(state).length > 0;
    return hasDeploymentOptions && ["deploy", "redeploy", "draw-research"].includes(command.type);
  }
  if (decision?.type === "monster-movement") {
    return command.type === "move-unit" || command.type === "launch-submarine-at-monster" || command.type === "pass-move";
  }
  return false;
}

function postInspector<T>(session: inspector.Session, method: string, params: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method as never, params as never, (error, result) => {
      if (error) reject(error);
      else resolve(result as T);
    });
  });
}

function routeProfileMetrics(profile: Profile, decisionCalls: number) {
  const routeNodeIds = new Set(profile.nodes
    .filter((node) => node.callFrame.functionName === "routeBlockScores")
    .map((node) => node.id));
  const parents = new Map<number, number>();
  const visit = (nodeId: number) => {
    const node = profile.nodes.find((candidate) => candidate.id === nodeId);
    for (const child of node?.children ?? []) {
      parents.set(child, nodeId);
      visit(child);
    }
  };
  for (const node of profile.nodes) {
    if (!parents.has(node.id)) visit(node.id);
  }
  let inclusiveSampledMicroseconds = 0;
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    let nodeId: number | undefined = profile.samples![index];
    while (nodeId !== undefined) {
      if (routeNodeIds.has(nodeId)) {
        inclusiveSampledMicroseconds += profile.timeDeltas?.[index] ?? 0;
        break;
      }
      nodeId = parents.get(nodeId);
    }
  }
  return {
    strategyInvocationCalls: decisionCalls,
    sampledInclusiveCpuMs: Number((inclusiveSampledMicroseconds / 1_000).toFixed(3)),
    callCountMethod: "Counted at the existing deployment and monster-movement decision paths that invoke routeBlockScores; selected-command types distinguish paths that return before that call.",
    timingMethod: `V8 CPU profiler inclusive samples attributed to routeBlockScores at ${PROFILE_SAMPLE_INTERVAL_US} microsecond sampling interval; approximate CPU time`,
  };
}

async function main() {
  const session = new inspector.Session();
  session.connect();
  await postInspector(session, "Profiler.enable");
  await postInspector(session, "Profiler.setSamplingInterval", { interval: PROFILE_SAMPLE_INTERVAL_US });
  await postInspector(session, "Profiler.start");

  const startedAt = performance.now();
  const matches: MatchResult[] = [];
  for (const playerCount of [3, 4] as const) {
    for (let seed = seedStart; seed < seedStart + seedCount; seed += 1) {
      matches.push(playMatch(playerCount, seed));
    }
  }
  const simulationWallTimeMs = Number((performance.now() - startedAt).toFixed(2));
  const stopped = await postInspector<{ profile: Profile }>(session, "Profiler.stop");
  session.disconnect();

  const summary = {
    schemaVersion: 1,
    config: {
      playerCounts: [3, 4],
      seedStart,
      seedCountPerPlayerCount: seedCount,
      seeds: Array.from({ length: seedCount }, (_, index) => seedStart + index),
      maximumRoundsPerMatch: maxRounds,
      actionSafetyCapPerMatch: ACTION_SAFETY_CAP,
      setupStrategy: "deterministic existing bot setup selector",
    },
    batch: {
      matchesRequested: matches.length,
      matchesCompleted: matches.filter((match) => match.termination === "terminal").length,
      roundCapped: matches.filter((match) => match.termination === "round-cap").length,
      safetyCapped: matches.filter((match) => match.termination === "action-safety-cap").length,
      invalidMatches: matches.filter((match) => match.invalidActions > 0).length,
      invalidActions: matches.reduce((sum, match) => sum + match.invalidActions, 0),
      simulationWallTimeMs,
    },
    routeScoring: routeProfileMetrics(stopped.profile, matches.reduce((sum, match) => sum + match.routeScoringCalls, 0)),
    matches,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.batch.invalidActions > 0 || summary.batch.safetyCapped > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
