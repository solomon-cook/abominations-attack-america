import assert from "node:assert/strict";
import test from "node:test";
import { boardForState, createGame, createMvpRoomGame, deploymentChoices, legalMovementNeighbors, locationIdToHexKey, movementPathAllowed, type HexKey, type MonsterMovement } from "./index.js";
import { botTacticForPlayer, chooseBotCommand, chooseBotSetupAction, routeBlockScores, runBotActionWithExplanation } from "./bots.js";
import { chooseBranch, chooseLair, chooseMonster, createSetup } from "./setup.js";

function referenceRouteBlockScores(state: ReturnType<typeof createGame>, actor: number, branch: "Army" | "Navy" | "Air Force" | "Marines") {
  const scores = new Map<HexKey, number>();
  const board = boardForState(state);
  const forceFirst = botTacticForPlayer(state, actor) === "force-first";
  const goals = Object.values(board.hexes).filter((hex) => !state.stompedLocations.includes(hex.key)
    && hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site" || feature.kind === "military-base"));
  const distanceBetween = (left: string, right: string) => {
    const leftKey = board.hexes[left as HexKey] ? left as HexKey : locationIdToHexKey(left);
    const rightKey = board.hexes[right as HexKey] ? right as HexKey : locationIdToHexKey(right);
    const a = leftKey ? board.hexes[leftKey]?.coord : undefined;
    const b = rightKey ? board.hexes[rightKey]?.coord : undefined;
    if (!a || !b) return 99;
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  };

  for (const [monsterIndex, monster] of state.monsters.entries()) {
    if (monsterIndex === actor) continue;
    const start = monster.location as HexKey;
    if (monster.health <= 0 || !board.hexes[start]) continue;
    for (const goal of goals) {
      if (goal.key === start) continue;
      const queue: HexKey[][] = [[start]];
      const distance = new Map<HexKey, number>([[start, 0]]);
      let shortest = Infinity;
      while (queue.length) {
        const path = queue.shift()!;
        const current = path.at(-1)!;
        const steps = path.length - 1;
        if (current === goal.key) {
          shortest = steps;
          const city = goal.features.some((feature) => feature.kind === "city");
          const ownBase = goal.features.some((feature) => feature.kind === "military-base" && feature.branch === branch);
          const value = (city ? 13 : 0) + (ownBase ? 10 : goal.features.some((feature) => feature.kind === "military-base") ? 7 : 4);
          const defenders = state.units.filter((unit) => unit.ownerPlayer === actor && unit.location !== "record-tile" && unit.location !== "permanently-removed" && distanceBetween(unit.location, goal.key) <= 1).length;
          const coverage = defenders === 0 ? 1 : defenders === 1 ? 0.7 : 0.5;
          const turnsAway = Math.ceil(steps / Math.max(1, monster.move));
          const urgency = turnsAway <= 1 ? 1 : turnsAway === 2 ? 0.75 : 0.5;
          path.slice(1).forEach((key, index) => {
            const toGoal = steps - index - 1;
            const approach = Math.max(0, 4 - toGoal) * 2;
            const pressure = (value * urgency + approach) * coverage * (forceFirst ? 1.15 : 0.9);
            scores.set(key, Math.max(scores.get(key) ?? 0, pressure));
          });
          continue;
        }
        if (steps >= shortest || steps >= 10) continue;
        for (const edge of board.edges) {
          if (!edge.enabled || edge.from !== current || distance.has(edge.to)) continue;
          const nextPath = [...path, edge.to];
          if (!movementPathAllowed(board, nextPath, monster.movement)) continue;
          distance.set(edge.to, steps + 1);
          queue.push(nextPath);
        }
      }
    }
  }
  return scores;
}

const fourSeatSetupDefinition = {
  playerCount: 4 as const,
  monsterIds: ["monster-1", "monster-2", "monster-3", "monster-4", "monster-5", "monster-6"],
  eligibleBranches: ["Army", "Navy", "Air Force", "Marines"] as const,
  lairsByMonster: Object.fromEntries(
    ["monster-1", "monster-2", "monster-3", "monster-4", "monster-5", "monster-6"]
      .map((id) => [id, [`${id}-lair-1`, `${id}-lair-2`, `${id}-lair-3`]]),
  ),
};

function selectMonsters(monsterIds: readonly string[]) {
  let setup = createSetup(fourSeatSetupDefinition);
  for (const [playerIndex, monsterId] of monsterIds.entries()) setup = chooseMonster(setup, playerIndex, monsterId);
  return setup;
}

test("route defense scores ignore the bot's own monster when no rival is active, including nonzero seats", () => {
  const state = createGame(2, 0);
  const actor = 1;
  assert.notEqual(state.currentPlayer, actor, "fixture checks an explicit bot seat other than currentPlayer");
  state.monsters.forEach((monster, index) => {
    if (index !== actor) monster.health = 0;
  });

  const scores = routeBlockScores(state, actor);

  assert.deepEqual([...scores], [], "the bot should not treat its own objective route as a threat to defend");
});

test("route defense still scores a living rival's path toward objectives for a nonzero seat", () => {
  const state = createGame(2, 0);
  const actor = 1;
  const rival = state.monsters.findIndex((_monster, index) => index !== actor);
  state.monsters.forEach((monster, index) => {
    if (index !== rival) monster.health = 0;
  });

  const scores = routeBlockScores(state, actor);

  assert.ok(scores.size > 0, "the bot should retain defensive route scores for a living rival");
});

test("route-score traversal preserves exact scores and tie paths on the transcribed board", () => {
  const state = createMvpRoomGame(4, 0, "route-score-parity");
  for (const [actor, branch] of [[0, "Army"], [1, "Navy"]] as const) {
    const actual = routeBlockScores(state, actor, branch);
    const reference = referenceRouteBlockScores(state, actor, branch);
    assert.deepEqual([...actual], [...reference], `route scores and insertion order should match for seat ${actor}`);
  }
});

test("cached movement neighbors match the canonical movement-path gate", () => {
  const states = [createGame(2, 0), createMvpRoomGame(4, 0, "movement-neighbors-parity")];
  const movementModes: MonsterMovement[] = ["land-only", "land-lake", "land-lake-sea", "fly"];
  for (const state of states) {
    const board = boardForState(state);
    for (const movement of movementModes) {
      for (const edge of board.edges) {
        const expected = movementPathAllowed(board, [edge.from, edge.to], movement);
        const actual = legalMovementNeighbors(board, movement, edge.from).includes(edge.to);
        assert.equal(actual, expected, `${movement} ${edge.from} → ${edge.to} on ${board.id}`);
      }
    }
  }
});

test("monster setup counter-picks all selected rivals independent of their seat order", () => {
  const pickForRivals = (rivals: readonly [string, string]) => {
    let setup = createSetup(fourSeatSetupDefinition);
    setup = chooseMonster(setup, 0, rivals[0]);
    setup = chooseMonster(setup, 1, rivals[1]);
    return chooseBotSetupAction(createGame(4), setup, 2).seats[2]?.monsterId;
  };

  const firstOrder = pickForRivals(["monster-6", "monster-5"]); // Gargantis, Toxicor
  const reversedOrder = pickForRivals(["monster-5", "monster-6"]);

  assert.equal(firstOrder, "monster-4", "Megaclaw is the strongest aggregate counter-pick against these opposing profiles");
  assert.equal(reversedOrder, firstOrder, "swapping which rival sits at seat 0 must not change the choice");
});

test("branch setup scores the whole rival roster instead of seat 0 alone", () => {
  const chooseBranchAgainst = (monstersBySeat: readonly string[]) => {
    const setup = selectMonsters(monstersBySeat);
    return chooseBotSetupAction(createGame(4), setup, 3).seats[3]?.branch;
  };

  const firstOrder = chooseBranchAgainst(["monster-3", "monster-4", "monster-1", "monster-2"]); // Konk, Megaclaw, Zorb, Tomanagi
  const reversedRivals = chooseBranchAgainst(["monster-4", "monster-3", "monster-1", "monster-2"]);

  assert.equal(firstOrder, "Marines", "Marines ranks best across Konk, Megaclaw, and Zorb counter preferences");
  assert.equal(reversedRivals, firstOrder, "the same rival roster should produce the same branch when seats 0 and 1 swap");
});

test("lair setup maximizes separation from every placed rival lair", () => {
  const definition = {
    playerCount: 3 as const,
    monsterIds: ["monster-1", "monster-2", "monster-3"],
    eligibleBranches: ["Army", "Navy", "Air Force"] as const,
    lairsByMonster: {
      "monster-1": ["seattle", "chicago", "new-york"],
      "monster-2": ["miami", "chicago", "new-york"],
      "monster-3": ["denver", "dallas", "los-angeles"],
    },
  };
  let setup = createSetup(definition);
  setup = chooseMonster(setup, 0, "monster-1");
  setup = chooseMonster(setup, 1, "monster-2");
  setup = chooseMonster(setup, 2, "monster-3");
  setup = chooseBranch(setup, 2, "Army");
  setup = chooseBranch(setup, 1, "Navy");
  setup = chooseBranch(setup, 0, "Air Force");
  setup = chooseLair(setup, 0, "seattle");
  setup = chooseLair(setup, 1, "miami");

  const result = chooseBotSetupAction(createGame(3), setup, 2);

  assert.equal(result.seats[2]?.lair, "los-angeles", "Los Angeles is safest against both Seattle and Miami on the development board");
});

test("Research draw explanations distinguish unavailable deployments from the research-first plan", () => {
  const noDeploymentChoices = createGame(2, 0);
  noDeploymentChoices.currentPlayer = 1;
  noDeploymentChoices.phase = "deploy";
  noDeploymentChoices.pendingDecision = { type: "deployment", playerIndex: 1 };
  noDeploymentChoices.stompedLocations = Object.keys(boardForState(noDeploymentChoices).hexes) as HexKey[];

  const unavailableResult = runBotActionWithExplanation(noDeploymentChoices);
  assert.equal(unavailableResult.command?.type, "draw-research");
  assert.match(unavailableResult.explanation, /no legal military deployments were available/);

  const researchFirst = createGame(2, 0);
  researchFirst.currentPlayer = 1;
  researchFirst.phase = "deploy";
  researchFirst.pendingDecision = { type: "deployment", playerIndex: 1 };
  researchFirst.monsters.forEach((monster, index) => {
    if (index !== 1) monster.health = 0;
  });
  const actorUnit = researchFirst.units.find((unit) => unit.ownerPlayer === 1)!;
  if (actorUnit.location === "record-tile") {
    actorUnit.location = Object.keys(boardForState(researchFirst).hexes)[0] as HexKey;
  }
  assert.ok(deploymentChoices(researchFirst).length > 0, "the tactical draw fixture must have legal deployment choices");

  for (let seed = 0; seed < 100; seed += 1) {
    researchFirst.rng.seed = seed;
    researchFirst.matchId = `bot-narration-${seed}`;
    if (botTacticForPlayer(researchFirst, 1) === "research-first") break;
  }
  assert.equal(botTacticForPlayer(researchFirst, 1), "research-first");
  const researchFirstResult = runBotActionWithExplanation(researchFirst);
  assert.equal(researchFirstResult.command?.type, "draw-research");
  assert.match(researchFirstResult.explanation, /research-first plan/);
});

test("per-player tactic overrides isolate policy comparisons and preserve inferred defaults", () => {
  const state = createGame(2, 23, "bot-tactic-override-parity");
  state.currentPlayer = 1;
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 1 };
  state.monsters.forEach((monster, index) => {
    if (index !== 1) monster.health = 0;
  });
  assert.ok(deploymentChoices(state).length > 0, "the fixture should have legal deployment choices");
  assert.ok(state.units.some((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile"), "the research-first policy needs an existing screen");

  const bots = new Set([1]);
  const inferredTactic = botTacticForPlayer(state, 1);
  const defaultCommand = chooseBotCommand(state, bots);
  const explicitSameTacticCommand = chooseBotCommand(state, bots, new Map([[1, inferredTactic]]));
  assert.equal(botTacticForPlayer(state, 1), inferredTactic, "no override must retain the match-stable tactic");
  assert.deepEqual(explicitSameTacticCommand, defaultCommand, "explicitly pinning the inferred policy must preserve the default command");

  const forceFirst = chooseBotCommand(state, bots, new Map([[1, "force-first"]]));
  const researchFirst = chooseBotCommand(state, bots, new Map([[1, "research-first"]]));
  assert.notEqual(forceFirst?.type, "draw-research", "force-first should use a legal deployment before optional Research");
  assert.equal(researchFirst?.type, "draw-research", "research-first should draw once a screen is in play and no objective route is urgent");
});
