import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommand,
  applyCompletedSetup,
  boardForState,
  createMvpRoomGame,
  hasStompableEncounterFeature,
  legalGiantPlacementDestinations,
  legalMonsterPaths,
  legalOwnedDeploymentDestinations,
  BRANCH_DEPLOYMENT_DEFINITIONS,
  type GameState,
} from "./index.js";
import { chooseBotSetupAction } from "./bots.js";
import { chooseStartingChoice, unusedBranchPlacementPlayer } from "./setup.js";

function createResearchStart(seed: number, playerCount: 2 | 3 | 4 = 2): GameState {
  let game = createMvpRoomGame(playerCount, seed);
  let setup = game.setupState!;

  for (let step = 0; step < 100 && setup.phase !== "complete"; step += 1) {
    const actor = setup.phase === "monster-selection"
      ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
      : setup.phase === "branch-selection"
        ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
        : setup.phase === "unused-branch-placement"
          ? unusedBranchPlacementPlayer(setup)
          : setup.phase === "lair-selection"
            ? setup.seats.find((seat) => !seat.lair)?.playerIndex
            : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
    assert.notEqual(actor, undefined, `setup actor for ${setup.phase}`);
    setup = setup.phase === "starting-choice"
      ? chooseStartingChoice(setup, actor!, { kind: "research" })
      : chooseBotSetupAction(game, setup, actor!);
  }

  assert.equal(setup.phase, "complete");
  game = applyCompletedSetup({ ...game, setupState: setup });
  assert.equal(game.setupApplied, true);
  if (playerCount === 2 && seed === 13) {
    assert.equal(game.pendingDecision?.type, "giant-placement");
    assert.equal(game.pendingDecision?.type === "giant-placement" && game.pendingDecision.playerIndex, 1);
    assert.equal(game.pendingDecision?.type === "giant-placement" && game.pendingDecision.cardId, "Mecha-Monster");
  }
  if (game.pendingDecision?.type === "giant-placement") {
    const destinations = legalGiantPlacementDestinations(game);
    assert.ok(destinations.length > 0);
    game = applyCommand(game, { type: "place-giant", destination: destinations.at(-1)! }).state;
  }
  return game;
}

function finishOrdinaryPhases(state: GameState, phases: Set<GameState["phase"]>, deployUnits = false): GameState {
  for (let step = 0; step < 40; step += 1) {
    if (state.pendingDecision?.type === "giant-placement") {
      state = applyCommand(state, { type: "place-giant", destination: legalGiantPlacementDestinations(state).at(-1)! }).state;
      continue;
    }
    phases.add(state.phase);
    if (state.phase === "game-over" || state.phase === "move" || state.phase === "challenge") return state;
    const decision = state.pendingDecision;

    if (state.phase === "fight") {
      if (decision?.type === "attack-target") {
        state = applyCommand(state, {
          type: "resolve-fight",
          battleId: decision.battleId,
          targetUnitId: decision.targetIds[0],
        }).state;
      } else if (decision?.type === "retreat") {
        const destinations = Object.fromEntries(
          decision.unitIds.map((unitId) => [unitId, state.pendingRetreat!.options[unitId]![0]!]),
        );
        state = applyCommand(state, { type: "retreat", destinations }).state;
      } else {
        state = applyCommand(state, { type: "resolve-fight", battleId: decision?.type === "battle-resolution" ? decision.battleId : undefined }).state;
      }
    } else if (state.phase === "encounter") {
      if (decision?.type === "encounter-choice") {
        const choice = decision.choices.includes("infamy") ? "infamy" : decision.choices[0] ?? "health";
        state = applyCommand(state, { type: "resolve-encounter", choice }).state;
      } else if (decision?.type === "trophy-choice") {
        state = applyCommand(state, { type: "resolve-encounter", trophyUnitId: state.pendingTrophyChoice!.unitIds[0] }).state;
      } else {
        state = applyCommand(state, { type: "advance" }).state;
      }
    } else if (state.phase === "deploy") {
      const branch = state.setupAssignments?.[state.currentPlayer]?.branch;
      const destinations = deployUnits ? legalOwnedDeploymentDestinations(state) : [];
      const unit = branch ? state.units.find((candidate) => candidate.branch === branch
        && candidate.location === "record-tile" && !state.removedUnitIds.includes(candidate.id)) : undefined;
      const allowance = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === branch)?.ownOrGuardUnits ?? 0;
      state = applyCommand(state, deployUnits && destinations.length > 0 && unit && state.deploymentsThisTurn < allowance
        ? { type: "deploy", unitId: unit.id, destination: destinations[0]! }
        : { type: "pass-deploy" }).state;
    } else {
      throw new Error(`Unexpected ordinary phase ${state.phase}.`);
    }
  }
  throw new Error("The ordinary phases did not return to Move or reach Challenge/game over.");
}

function finishChallenge(state: GameState, selectLastOpponent = false): GameState {
  for (let step = 0; step < 1_000 && state.phase === "challenge"; step += 1) {
    const decision = state.pendingDecision;
    if (decision?.type === "challenge-opponent") {
      const opponentMonsterId = selectLastOpponent ? decision.opponentIds.at(-1)! : decision.opponentIds[0]!;
      state = applyCommand(state, { type: "challenge-opponent", opponentMonsterId }).state;
    } else if (decision?.type === "challenge-giant") {
      state = applyCommand(state, { type: "challenge-giant", giantUnitId: decision.giantUnitIds[0]! }).state;
    } else if (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution") {
      state = state.challenge?.turn?.remainingAttacks
        ? applyCommand(state, { type: "resolve-challenge" }).state
        : applyCommand(state, { type: "resolve-challenge", endTurn: true }).state;
    } else {
      throw new Error(`Unexpected Challenge decision ${JSON.stringify(decision)}.`);
    }
  }
  assert.notEqual(state.phase, "challenge", "the Challenge route must reach a terminal result within the loop bound");
  return state;
}

function reachChallengeThroughLegalTurns(state: GameState): GameState {
  const phases = new Set<GameState["phase"]>();
  let turns = 0;

  while (state.phase !== "game-over" && !state.challenge?.active && turns < 250) {
    if (state.pendingDecision?.type === "giant-placement") {
      state = applyCommand(state, { type: "place-giant", destination: legalGiantPlacementDestinations(state).at(-1)! }).state;
      continue;
    }
    if (state.phase === "move") {
      const monster = state.monsters[state.currentPlayer]!;
      const pending = Object.values(boardForState(state).hexes).filter((hex) =>
        hasStompableEncounterFeature(hex.features) && !state.stompedLocations.includes(hex.key),
      );
      const nonHealing = pending.filter((hex) =>
        hex.features.some((feature) => feature.kind === "infamy-site" || feature.kind === "military-base")
        && !hex.features.some((feature) => feature.kind === "city"),
      );
      const targets = (nonHealing.length > 0 ? nonHealing : pending).map((hex) => hex.key);

      if (targets.includes(monster.location as typeof targets[number])) {
        state = applyCommand(state, { type: "pass-move" }).state;
      } else {
        const route = legalMonsterPaths(state, monster.id)
          .filter((path) => targets.includes(path.at(-1)!))
          .sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!))[0];
        state = route
          ? applyCommand(state, { type: "move", path: route }).state
          : applyCommand(state, { type: "pass-move" }).state;
      }
    }

    state = finishOrdinaryPhases(state, phases, true);
    turns += 1;
  }

  phases.add(state.phase);
  assert.ok(turns < 250, "the full match must terminate within the bounded route");
  for (const phase of ["move", "fight", "encounter", "deploy", "challenge"] as const) {
    assert.ok(phases.has(phase), `the full match must visit ${phase}`);
  }
  assert.equal(state.stompMarkers, 0);
  assert.equal(state.challenge?.active, true);
  return state;
}

test("a legal two-player match from setup can reach an America Saved victory", () => {
  let game = createResearchStart(13);
  const initialMarkers = game.stompMarkers;
  const phases = new Set<GameState["phase"]>();
  let satelliteUsed = false;
  let turns = 0;

  while (game.phase !== "game-over" && !game.challenge?.active && turns < 250) {
    if (game.pendingDecision?.type === "giant-placement") {
      game = applyCommand(game, { type: "place-giant", destination: legalGiantPlacementDestinations(game).at(-1)! }).state;
      continue;
    }
    if (game.phase === "move") {
      if (game.stompMarkers === 2 && game.currentPlayer === 0 && game.players[0]!.researchCardIds.includes("Defense Satellites")) {
        game = applyCommand(game, { type: "use-research", cardId: "Defense Satellites" }).state;
        satelliteUsed = true;
      }

      const monster = game.monsters[game.currentPlayer]!;
      const pending = Object.values(boardForState(game).hexes).filter((hex) =>
        hasStompableEncounterFeature(hex.features) && !game.stompedLocations.includes(hex.key),
      );
      const nonHealing = pending.filter((hex) =>
        hex.features.some((feature) => feature.kind === "infamy-site" || feature.kind === "military-base")
        && !hex.features.some((feature) => feature.kind === "city"),
      );
      const targets = (nonHealing.length > 0 ? nonHealing : pending).map((hex) => hex.key);

      if (targets.includes(monster.location as typeof targets[number])) {
        game = applyCommand(game, { type: "pass-move" }).state;
      } else {
        const route = legalMonsterPaths(game, monster.id)
          .filter((path) => targets.includes(path.at(-1)!))
          .sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!))[0];
        game = route
          ? applyCommand(game, { type: "move", path: route }).state
          : applyCommand(game, { type: "pass-move" }).state;
      }
    }

    game = finishOrdinaryPhases(game, phases);
    turns += 1;
  }

  phases.add(game.phase);
  assert.ok(turns < 250, "the full match must terminate within the bounded route");
  for (const phase of ["move", "fight", "encounter", "deploy", "challenge"] as const) {
    assert.ok(phases.has(phase), `the full match must visit ${phase}`);
  }
  assert.equal(initialMarkers, 14);
  assert.equal(satelliteUsed, true, "the route uses the earned Research card through its legal timing window");
  assert.equal(game.stompMarkers, 0);
  assert.equal(game.challenge?.active, true);
  assert.ok(game.units.some((unit) => unit.unitTypeId === "mecha-monster" && unit.ownerPlayer === 1 && unit.health > 0));

  game = finishChallenge(game);
  assert.equal(game.phase, "game-over");
  assert.equal(game.victoryType, "america-saved");
  assert.equal(game.winnerPlayer, 1);
});

test("a legal four-player match from setup can reach an America Saved victory", () => {
  let game = reachChallengeThroughLegalTurns(createResearchStart(2, 4));
  game = finishChallenge(game);
  assert.equal(game.phase, "game-over");
  assert.equal(game.victoryType, "america-saved");
  assert.equal(game.winnerPlayer, 2);
});

test("a legal three-player match from setup can reach an America Saved victory", () => {
  let game = reachChallengeThroughLegalTurns(createResearchStart(204, 3));
  game = finishChallenge(game, true);
  assert.equal(game.phase, "game-over");
  assert.equal(game.victoryType, "america-saved");
  assert.equal(game.winnerPlayer, 2);
});

test("a player can concede a legally completed setup at every supported player count", () => {
  for (const playerCount of [2, 3, 4] as const) {
    const game = createResearchStart(13, playerCount);
    const concedingPlayer = game.currentPlayer;
    const result = applyCommand(game, { type: "concede" }).state;

    assert.equal(result.phase, "game-over", `${playerCount}-player concession reaches a terminal state`);
    assert.equal(result.victoryType, "concession", `${playerCount}-player concession records its victory type`);
    assert.equal(result.winnerPlayer, (concedingPlayer + 1) % playerCount, `${playerCount}-player concession selects the next player as winner`);
  }
});
