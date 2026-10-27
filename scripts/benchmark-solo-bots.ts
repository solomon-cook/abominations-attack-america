import {
  applyCommand,
  applyCompletedSetup,
  boardForState,
  chooseBotCommand,
  chooseBotSetupAction,
  createMvpRoomGame,
  type GameState,
} from "../packages/game-engine/src/index.js";
import { AUDITED_BOARD } from "../packages/game-engine/src/audited-board.js";

const seeds = (process.env.BOT_BENCH_SEEDS ?? "17,29,41,53")
  .split(",")
  .map((value) => Number(value.trim()));
const onlyPair = process.env.BOT_BENCH_ONLY_PAIR
  ?.split(":")
  .map((value) => value.trim())
  .sort()
  .join(":");
const maxCommands = 1_000;

function completeBotSetup(game: GameState): GameState {
  let setup = game.setupState;
  for (let step = 0; setup && setup.phase !== "complete" && step < 100; step += 1) {
    const actor = setup.phase === "monster-selection"
      ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
      : setup.phase === "branch-selection"
        ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
        : setup.phase === "unused-branch-placement"
          ? setup.definition.playerCount - 1
          : setup.phase === "lair-selection"
            ? setup.seats.find((seat) => !seat.lair)?.playerIndex
            : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
    if (actor === undefined) throw new Error(`No setup actor at ${setup?.phase ?? "missing setup"}.`);
    setup = chooseBotSetupAction({ ...game, setupState: setup }, setup, actor);
  }
  if (!setup || setup.phase !== "complete") throw new Error("Bot setup did not complete within 100 choices.");
  return applyCompletedSetup({ ...game, setupState: setup });
}

type Profile = "casual" | "tactical" | "challenging";

function simulate(seed: number, playerZeroProfile: Profile, playerOneProfile: Profile) {
  const initial = completeBotSetup(createMvpRoomGame(2, seed));
  const board = boardForState(initial);
  if (board.id !== AUDITED_BOARD.id || board.contentHash !== AUDITED_BOARD.contentHash || Object.keys(board.hexes).length !== 336) {
    throw new Error(`Seed ${seed} used ${board.id} with ${Object.keys(board.hexes).length} cells instead of the audited 336-cell board.`);
  }

  let state = initial;
  let commands = 0;
  let stuck: string | undefined;
  const recentCommands: Array<Readonly<{ phase: GameState["phase"]; currentPlayer: number; pendingDecision: GameState["pendingDecision"]; command: unknown }>> = [];
  while (state.phase !== "game-over" && commands < maxCommands) {
    const decision = state.pendingDecision;
    const actor = decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
    const difficulty = actor === 0 ? playerZeroProfile : playerOneProfile;
    const command = chooseBotCommand(state, new Set([actor]), difficulty);
    if (!command) {
      stuck = `No bot command at ${state.phase} for player ${actor}.`;
      break;
    }
    let next: GameState;
    recentCommands.push({ phase: state.phase, currentPlayer: state.currentPlayer, pendingDecision: state.pendingDecision, command });
    if (recentCommands.length > 12) recentCommands.shift();
    try {
      next = applyCommand(state, command).state;
    } catch (error) {
      console.error(JSON.stringify({
        benchmarkFailure: true,
        seed,
        profiles: [playerZeroProfile, playerOneProfile],
        commands,
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        actor,
        command,
        pendingDecision: state.pendingDecision,
        pendingBattles: state.pendingBattles,
        monsters: state.monsters.map(({ id, name, location, health }) => ({ id, name, location, health })),
        recentCommands,
      }, null, 2));
      throw error;
    }
    if (next === state) {
      stuck = `Command ${command.type} did not advance ${state.phase} for player ${actor}.`;
      break;
    }
    state = next;
    commands += 1;
  }

  return {
    seed,
    profiles: [playerZeroProfile, playerOneProfile],
    boardId: board.id,
    commands,
    rounds: state.round,
    winnerPlayer: state.winnerPlayer ?? null,
    winnerProfile: state.winnerPlayer === undefined ? null : state.winnerPlayer === 0 ? playerZeroProfile : playerOneProfile,
    victoryType: state.victoryType ?? null,
    completed: state.phase === "game-over",
    stuck: stuck ?? null,
  };
}

if (seeds.length === 0 || seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) {
  throw new Error("BOT_BENCH_SEEDS must contain one or more non-negative integer seeds.");
}

const profilePairs: Array<[Profile, Profile]> = [
  ["casual", "tactical"],
  ["tactical", "casual"],
  ["casual", "challenging"],
  ["challenging", "casual"],
  ["tactical", "challenging"],
  ["challenging", "tactical"],
].filter(([first, second]) => !onlyPair || [first, second].sort().join(":") === onlyPair);
if (profilePairs.length === 0) throw new Error("BOT_BENCH_ONLY_PAIR must name two of casual, tactical, and challenging.");
const matches: ReturnType<typeof simulate>[] = [];
for (const seed of seeds) {
  for (const [playerZero, playerOne] of profilePairs) {
    const startedAt = Date.now();
    const match = simulate(seed, playerZero, playerOne);
    matches.push(match);
    console.error(`[solo-bot-benchmark] seed=${seed} ${playerZero} vs ${playerOne} completed=${match.completed} commands=${match.commands} elapsedMs=${Date.now() - startedAt}`);
  }
}
const completedMatches = matches.filter((match) => match.completed);
const pairwise = Object.fromEntries(
  (["casual:tactical", "casual:challenging", "tactical:challenging"] as const).map((pair) => {
    const [first, second] = pair.split(":") as [Profile, Profile];
    const relevant = completedMatches.filter((match) => match.profiles.includes(first) && match.profiles.includes(second));
    return [pair, {
      matchesCompleted: relevant.length,
      firstProfileWins: relevant.filter((match) => match.winnerProfile === first).length,
      secondProfileWins: relevant.filter((match) => match.winnerProfile === second).length,
      unfinished: seeds.length * profilePairs.filter(([left, right]) => [left, right].sort().join(":") === pair).length - relevant.length,
    }];
  }),
);

console.log(JSON.stringify({
  benchmark: "audited-board-solo-profile-round-robin",
  seeds,
  seatSwapped: true,
  profiles: ["casual", "tactical", "challenging"],
  maxCommandsPerMatch: maxCommands,
  matchesCompleted: completedMatches.length,
  pairwise,
  matches,
}, null, 2));
