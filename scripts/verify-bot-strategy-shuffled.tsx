import assert from "node:assert/strict";
import {
  applyCommand,
  applyCompletedSetup,
  chooseBranch,
  chooseLair,
  chooseMonster,
  createMvpRoomGame,
  deploymentChoices,
  type GameState,
  type SetupState,
} from "../packages/game-engine/src/index.js";
import {
  botTacticForPlayer,
  chooseBotCommand,
  chooseBotSetupAction,
  type BotDeployDecisionDiagnostics,
  type BotResearchDrawGateDiagnostics,
} from "../apps/web/src/solo-bots.js";

/*
 * Independent randomized-setup sample; keep its results separate from the
 * counter-pick batch verifier. Run with tsx and optional --seed-start=N,
 * --seed-count=N, --seed-stride=N, and --max-rounds=N arguments.
 */
const DEFAULT_SEED_START = 31;
const DEFAULT_SEED_COUNT = 2;
const DEFAULT_SEED_STRIDE = 10;
const DEFAULT_MAX_ROUNDS = 12;
const ACTION_SAFETY_CAP = 2_000;
const PLAYER_COUNTS = [3, 4] as const;

function readIntegerArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((arg) => arg.startsWith(prefix));
  if (matches.length > 1) throw new Error(`${name} may be specified only once`);
  const value = matches[0]?.slice(prefix.length);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

const seedStart = readIntegerArg("seed-start", DEFAULT_SEED_START);
const seedCount = readIntegerArg("seed-count", DEFAULT_SEED_COUNT);
const seedStride = readIntegerArg("seed-stride", DEFAULT_SEED_STRIDE);
const maxRounds = readIntegerArg("max-rounds", DEFAULT_MAX_ROUNDS);
assert.ok(seedCount > 0 && seedCount <= 10, "seed-count must be between 1 and 10 per player count");
assert.ok(seedStride >= seedCount, "seed-stride must be at least seed-count so player-count ranges do not overlap");
assert.ok(seedStart + seedStride + seedCount - 1 <= Number.MAX_SAFE_INTEGER, "seed ranges must stay within safe integers");
assert.ok(maxRounds > 0 && maxRounds <= 100, "max-rounds must be between 1 and 100");

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

function completeRandomizedSetup(playerCount: 3 | 4, seed: number): GameState {
  const game = createMvpRoomGame(playerCount, seed, `bot-randomized-audit-${playerCount}-${seed}`);
  const random = seededRandom(seed ^ Math.imul(playerCount, 0x85ebca6b));
  const monsterBySeat = shuffled(game.setupState!.definition.monsterIds, random).slice(0, playerCount);
  const branchBySeat = shuffled(game.setupState!.definition.eligibleBranches, random).slice(0, playerCount);
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
      setup = chooseLair(setup, seat.playerIndex, shuffled(options, random)[0]!);
      continue;
    }

    const seat = setup.seats.find((candidate) => candidate.startingChoice === undefined);
    assert.ok(seat, "starting-choice must have an undecided seat");
    const next = chooseBotSetupAction({ ...game, setupState: setup }, setup, seat.playerIndex);
    assert.notEqual(next, setup, `bot starting-choice did not advance seat ${seat.playerIndex}`);
    setup = next;
  }

  assert.equal(setup.phase, "complete", `${playerCount}-seat setup should complete`);
  assert.equal(new Set(setup.seats.map((seat) => seat.monsterId)).size, playerCount, "monsters must be distinct");
  assert.equal(new Set(setup.seats.map((seat) => seat.branch)).size, playerCount, "branches must be distinct");
  assert.equal(new Set(setup.seats.map((seat) => seat.lair)).size, playerCount, "lairs must be distinct");
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

interface SeatResult {
  seat: number;
  playerIndex: number;
  monster: string;
  branch: string | null;
  lair: string | null;
  tactic: string;
  finalHealth: number;
  finalInfamy: number;
  actions: number;
  turns: number;
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

interface MatchResult {
  playerCount: 3 | 4;
  seed: number;
  termination: "terminal" | "round-cap" | "action-safety-cap" | "invalid-action";
  roundsCompleted: number;
  finalRound: number;
  actions: number;
  turns: number;
  invalidActions: number;
  invalidActionEvidence: InvalidActionEvidence[];
  caps: {
    maximumRounds: number;
    actionSafetyCap: number;
    roundCapReached: boolean;
    actionSafetyCapReached: boolean;
  };
  winner: null | {
    seat: number;
    playerIndex: number;
    monster: string;
    branch: string | null;
    victoryType: GameState["victoryType"];
  };
  seats: SeatResult[];
}

function emptyResearchDrawDiagnostics(): ResearchDrawDiagnostics {
  return {
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
    if (trace.selectedCommandType === "draw-research" && !trace.eligible) throw new Error("Selector selected an ineligible optional Research draw.");
    if (trace.selectedCommandType !== "draw-research" && trace.eligible) throw new Error("Selector declined an eligible optional Research draw.");
    diagnostics.optionalGateEvaluationWindows += 1;
    if (trace.eligible) diagnostics.eligibleOptionalDrawWindows += 1;
    for (const gate of RESEARCH_GATES) increment(trace.gates[gate] ? diagnostics.gatePassCounts : diagnostics.gateFailCounts, gate);
  } else {
    if (trace.gates !== null || trace.eligible !== null) throw new Error("A bypass/fallback path should not claim optional Research gate results.");
    increment(diagnostics.gateSkippedByPath, trace.path);
  }
}

function playMatch(playerCount: 3 | 4, seed: number): MatchResult {
  let state = completeRandomizedSetup(playerCount, seed);
  const initialRound = state.round;
  const bots = new Set(state.players.map((_, index) => index));
  const actionsBySeat = Array.from({ length: playerCount }, () => 0);
  const turnsBySeat = Array.from({ length: playerCount }, () => 0);
  const researchDrawBySeat = Array.from({ length: playerCount }, emptyResearchDrawDiagnostics);
  const invalidActionEvidence: InvalidActionEvidence[] = [];
  let actions = 0;
  let turns = 0;

  while (state.phase !== "game-over" && state.round <= maxRounds && actions < ACTION_SAFETY_CAP) {
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision
      ? state.pendingDecision.playerIndex
      : state.currentPlayer;
    const deployWindow = state.phase === "deploy";
    const deployOptions = deployWindow ? deploymentChoices(state) : [];
    const drawOptionAvailable = deployWindow && legalResearchDrawOption(state);
    if (deployWindow) {
      const deployDiagnostics = researchDrawBySeat[actor]!;
      deployDiagnostics.deployWindows += 1;
      if (drawOptionAvailable) deployDiagnostics.windowsWithLegalResearchDrawOption += 1;
      deployDiagnostics.legalDeploymentChoiceCount += deployOptions.length;
      increment(deployDiagnostics.deploymentChoicesByCount, String(deployOptions.length));
    }
    actions += 1;
    let command: ReturnType<typeof chooseBotCommand>;
    const deployTraces: BotDeployDecisionDiagnostics[] = [];
    try {
      command = chooseBotCommand(state, bots, undefined, (trace) => deployTraces.push(trace));
    } catch (error) {
      actionsBySeat[actor]! += 1;
      if (deployWindow) researchDrawBySeat[actor]!.deployWindowsWithoutSelectorTrace += 1;
      invalidActionEvidence.push({
        actionNumber: actions,
        seat: actor + 1,
        round: state.round,
        phase: state.phase,
        pendingDecision: state.pendingDecision?.type,
        error: `Bot command selection failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      break;
    }
    if (deployTraces.length > 1) throw new Error("One bot command selection emitted multiple Deploy diagnostics.");
    const deployTrace = deployTraces[0];
    if (deployWindow) {
      const deployDiagnostics = researchDrawBySeat[actor]!;
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
      actionsBySeat[actor]! += 1;
      invalidActionEvidence.push({
        actionNumber: actions,
        seat: actor + 1,
        round: state.round,
        phase: state.phase,
        pendingDecision: state.pendingDecision?.type,
        error: "Bot returned no command for an active seat decision.",
      });
      break;
    }

    const commandActor = command.type === "use-research" && command.cardId === "Laser Fence"
      ? state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"))
      : actor;
    const attributedActor = commandActor >= 0 ? commandActor : actor;
    actionsBySeat[attributedActor]! += 1;
    if (command.type === "draw-research" && !deployWindow) throw new Error("Research draw was selected outside a Deploy window.");

    try {
      const applied = applyCommand(state, command);
      state = applied.state;
      if (command.type === "draw-research") {
        if (applied.eventType !== "research.drawn") throw new Error("Accepted Research draw did not emit research.drawn.");
        researchDrawBySeat[attributedActor]!.drawAccepted += 1;
      }
    } catch (error) {
      if (command.type === "draw-research") researchDrawBySeat[attributedActor]!.drawRejected += 1;
      invalidActionEvidence.push({
        actionNumber: actions,
        seat: attributedActor + 1,
        round: state.round,
        phase: state.phase,
        pendingDecision: state.pendingDecision?.type,
        command,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }

    if (state.eventLog.at(-1)?.action === "turn.passed") {
      turns += 1;
      turnsBySeat[actor]! += 1;
    }
  }

  const termination: MatchResult["termination"] = invalidActionEvidence.length > 0
    ? "invalid-action"
    : state.phase === "game-over"
      ? "terminal"
      : actions >= ACTION_SAFETY_CAP
        ? "action-safety-cap"
        : "round-cap";
  const winnerIndex = state.winnerPlayer;
  const winnerSeat = winnerIndex === undefined || winnerIndex === null ? undefined : state.monsters[winnerIndex];
  const assignments = state.setupAssignments ?? [];

  return {
    playerCount,
    seed,
    termination,
    roundsCompleted: Math.min(maxRounds, Math.max(0, state.round - initialRound)),
    finalRound: state.round,
    actions,
    turns,
    invalidActions: invalidActionEvidence.length,
    invalidActionEvidence,
    caps: {
      maximumRounds: maxRounds,
      actionSafetyCap: ACTION_SAFETY_CAP,
      roundCapReached: termination === "round-cap",
      actionSafetyCapReached: termination === "action-safety-cap",
    },
    winner: winnerIndex === undefined || winnerIndex === null
      ? null
      : {
        seat: winnerIndex + 1,
        playerIndex: winnerIndex,
        monster: winnerSeat?.name ?? "unknown",
        branch: assignments[winnerIndex]?.branch ?? null,
        victoryType: state.victoryType ?? null,
      },
    seats: state.players.map((_, playerIndex) => ({
      seat: playerIndex + 1,
      playerIndex,
      monster: state.monsters[playerIndex]?.name ?? "unknown",
      branch: assignments[playerIndex]?.branch ?? null,
      lair: assignments[playerIndex]?.lair ?? null,
      tactic: botTacticForPlayer(state, playerIndex),
      finalHealth: state.monsters[playerIndex]?.health ?? 0,
      finalInfamy: state.monsters[playerIndex]?.infamy ?? 0,
      actions: actionsBySeat[playerIndex]!,
      turns: turnsBySeat[playerIndex]!,
      researchDraw: researchDrawBySeat[playerIndex]!,
    })),
  };
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const label = key(value);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function main(): void {
  const matches: MatchResult[] = [];
  for (const [playerOffset, playerCount] of PLAYER_COUNTS.entries()) {
    const firstSeed = seedStart + playerOffset * seedStride;
    for (let index = 0; index < seedCount; index += 1) {
      matches.push(playMatch(playerCount, firstSeed + index));
    }
  }

  const winners = matches.flatMap((match) => match.winner ? [match.winner] : []);
  const researchDrawDiagnosticsByTactic = Object.fromEntries((['force-first', 'research-first'] as const).map((tactic) => {
    const matchingSeats = matches.flatMap((match) => match.seats.filter((seat) => seat.tactic === tactic));
    const total = emptyResearchDrawDiagnostics();
    for (const seat of matchingSeats) {
      const source = seat.researchDraw;
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
  }));
  const summary = {
    schemaVersion: 2,
    researchDrawDiagnosticsVersion: 1,
    config: {
      playerCounts: PLAYER_COUNTS,
      seedStart,
      seedCountPerPlayerCount: seedCount,
      seedStride,
      maximumRoundsPerMatch: maxRounds,
      actionSafetyCapPerMatch: ACTION_SAFETY_CAP,
      setupStrategy: "seeded shuffled distinct monster/branch assignments and seeded valid lairs; bot-selected starting troops",
      actionStrategy: "existing all-bot action selector",
      researchDrawDiagnostics: "Deploy windows are counted per selector invocation while state.phase is deploy; legal Research draws mirror drawResearchForDeployment/applyCommand guards; legal deployment choices are counted by deploymentChoices; optional gates are emitted only when the selector reaches shouldDrawResearch and are checked against its decision; accepted draws require the research.drawn event.",
      randomGenerator: "32-bit xorshift; setup choices are reproducible from player count and seed",
    },
    batch: {
      matchesRequested: matches.length,
      terminalMatches: matches.filter((match) => match.termination === "terminal").length,
      roundCappedMatches: matches.filter((match) => match.termination === "round-cap").length,
      safetyCappedMatches: matches.filter((match) => match.termination === "action-safety-cap").length,
      invalidMatches: matches.filter((match) => match.invalidActions > 0).length,
      invalidActions: matches.reduce((sum, match) => sum + match.invalidActions, 0),
      winsBySeat: countBy(winners, (winner) => String(winner.seat)),
      winsByMonster: countBy(winners, (winner) => winner.monster),
      winsByBranch: countBy(winners, (winner) => winner.branch ?? "unassigned"),
      researchDrawDiagnosticsByTactic,
    },
    matches,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.batch.invalidActions > 0 || summary.batch.safetyCappedMatches > 0) process.exitCode = 1;
}

main();
