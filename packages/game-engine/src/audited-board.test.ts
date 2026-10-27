import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AUDITED_BOARD, AUDITED_CELLS, AUDIT_SOURCE_SHA256, AUDITED_ONE_SIDED_BARRIERS, auditedCellKey as key, auditedCoordinate, auditedRowColumn, AUDITED_EDGE_DIRECTIONS } from "./audited-board.js";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, hexDistance, validateBoardDefinition } from "./board.js";
import { applyCommand, applyCompletedSetup, auditedSetupDefinition, boardForState, createGame, createMvpRoomGame, createProvisionalPlaytestGame, hasStompableEncounterFeature, legalGiantPlacementDestinations, legalMonsterPaths, migrateGameState, monsters, movementPathAllowed, type GameState } from "./index.js";
import { chooseBotSetupAction } from "./bots.js";
import { chooseBranch, chooseLair, chooseMonster, chooseStartingChoice, placeUnusedBranches, validateSetup } from "./setup.js";

test("audited board matches all source cells and survives strict production validation", () => {
  const source = readFileSync(new URL("../../../docs/authoritative-board-human-audit.md", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), AUDIT_SOURCE_SHA256);
  assert.equal(AUDITED_CELLS.length, 336);
  assert.equal(Object.keys(AUDITED_BOARD.hexes).length, 336);
  assert.equal(AUDITED_BOARD.version, 1);
  assert.equal(AUDITED_BOARD.contentHash, "fnv1a:995e83d9", "editorial sign-off updates must preserve the promoted immutable board pin");
  assert.deepEqual(validateBoardDefinition(AUDITED_BOARD, { production: true }), []);
  const counts: Record<string, number> = {};
  for (const cell of AUDITED_CELLS) {
    const hex = AUDITED_BOARD.hexes[key(cell.row, cell.column)];
    assert.deepEqual(hex.audit, { row: cell.row, column: cell.column });
    assert.equal(hex.sourceRefs[0], cell.sourceRef);
    counts[hex.waterClass] = (counts[hex.waterClass] ?? 0) + 1;
  }
  assert.deepEqual(counts, { sea: 81, seacoast: 49, land: 187, lakeshore: 19 });
});

test("all signed-off physical city benefits are mapped and resolve from the audited board", () => {
  const cityCells = AUDITED_CELLS.filter((cell) => /City: [^;]+;\s*\d\s*(?:HP|D)/.test(cell.features));
  assert.equal(cityCells.length, 48);
  const benefitKinds = new Set<string>();

  for (const [index, cell] of cityCells.entries()) {
    const match = cell.features.match(/City: ([^;]+);\s*(\d)\s*(HP|D)/);
    assert.ok(match, `physical city benefit is transcribed at ${cell.row}/${cell.column}`);
    const location = key(cell.row, cell.column);
    const hex = AUDITED_BOARD.hexes[location];
    const city = hex.features.find((feature) => feature.kind === "city");
    assert.ok(city, `${match[1]} has an engine city feature`);
    const expectedBenefit = match[3] === "HP"
      ? { kind: "health" as const, amount: Number(match[2]) as 1 | 2 }
      : { kind: "health-roll" as const, dice: Number(match[2]) as 1 | 2 | 3 };
    assert.deepEqual(city.benefit, expectedBenefit, `${match[1]} preserves the physical board's printed ${match[2]} ${match[3]} benefit`);
    benefitKinds.add(city.benefit.kind === "health" ? `${city.benefit.kind}-${city.benefit.amount}` : `${city.benefit.kind}-${city.benefit.dice}`);

    const state = createGame(2, index + 101);
    state.boardId = AUDITED_BOARD.id;
    state.boardVersion = AUDITED_BOARD.version;
    state.boardContentHash = AUDITED_BOARD.contentHash;
    state.currentPlayer = 0;
    state.phase = "encounter";
    state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location };
    state.monsters[0].location = location;
    state.monsters[0].health = 1;
    const result = applyCommand(state, { type: "resolve-encounter", choice: "health" });
    const healthEffect = (result.eventPayload.effects as Array<{ type: string; amount: number; source: string }>).find((effect) => effect.type === "health" && effect.source === location);
    const expectedRolls = expectedBenefit.kind === "health-roll" ? result.eventPayload.rolls as number[] : [];
    assert.equal(expectedRolls.length, expectedBenefit.kind === "health-roll" ? expectedBenefit.dice : 0, `${match[1]} records exactly its printed Health dice`);
    assert.ok(expectedRolls.every((roll) => roll >= 1 && roll <= 6), `${match[1]} records legal d6 values`);
    assert.equal(healthEffect?.amount, expectedBenefit.kind === "health" ? expectedBenefit.amount : expectedRolls.reduce((sum, roll) => sum + roll, 0), `${match[1]} resolves its audited benefit through the authoritative engine`);
  }

  assert.deepEqual([...benefitKinds].sort(), ["health-1", "health-roll-1", "health-roll-2", "health-roll-3"]);
});

test("all signed-off physical military bases map to the audited branch owners", () => {
  const branches = ["Army", "Navy", "Air Force", "Marines"] as const;
  const baseCells = AUDITED_CELLS.filter((cell) => branches.some((branch) => cell.features.includes(`${branch} base`)));
  assert.equal(baseCells.length, 30);
  const counts = Object.fromEntries(branches.map((branch) => [branch, 0])) as Record<(typeof branches)[number], number>;

  for (const cell of baseCells) {
    const location = key(cell.row, cell.column);
    const expectedBranches = branches.filter((branch) => cell.features.includes(`${branch} base`));
    const actualBranches = AUDITED_BOARD.hexes[location].features
      .filter((feature) => feature.kind === "military-base")
      .map((feature) => feature.branch);
    assert.deepEqual(actualBranches, expectedBranches, `base ownership at ${cell.row}/${cell.column}`);
    for (const branch of expectedBranches) counts[branch] += 1;
  }

  assert.deepEqual(counts, { Army: 8, Navy: 8, "Air Force": 8, Marines: 8 });
  const compiledBaseCount = Object.values(AUDITED_BOARD.hexes).flatMap((hex) => hex.features).filter((feature) => feature.kind === "military-base").length;
  assert.equal(compiledBaseCount, 32, "both branch bases are preserved at the two co-located physical spaces");
  assert.equal(compiledBaseCount, Object.values(counts).reduce((sum, count) => sum + count, 0), "no branch base is missing from or invented in the compiled audited board");
});

test("all signed-off physical special sites and lairs map to the audited board", () => {
  const categories = [
    { label: "Infamy sites", source: "Infamy site", kind: "infamy-site", count: 16 },
    { label: "Mutation sites", source: "Mutation site", kind: "mutation-site", count: 4 },
    { label: "Monster Challenge sites", source: "Monster Challenge site", kind: "challenge-site", count: 4 },
    { label: "lairs", source: "potential spawn location", kind: "lair", count: 18 },
  ] as const;

  for (const category of categories) {
    const sourceCells = AUDITED_CELLS.filter((cell) => cell.features.includes(category.source));
    assert.equal(sourceCells.length, category.count, `${category.label} count in the signed-off transcription`);
    const compiledCells = AUDITED_CELLS.filter((cell) =>
      AUDITED_BOARD.hexes[key(cell.row, cell.column)].features.some((feature) => feature.kind === category.kind),
    );
    assert.deepEqual(
      compiledCells.map((cell) => key(cell.row, cell.column)).sort(),
      sourceCells.map((cell) => key(cell.row, cell.column)).sort(),
      `every physical ${category.label.toLowerCase()} is compiled once and no extra one is invented`,
    );
  }

  const losAngeles = AUDITED_CELLS.find((cell) => cell.features.includes("City: Los Angeles;"));
  assert.ok(losAngeles, "the signed-off transcription contains Los Angeles");
  const losAngelesHex = AUDITED_BOARD.hexes[key(losAngeles.row, losAngeles.column)];
  assert.equal(losAngelesHex.label, "Los Angeles");
  assert.equal(losAngelesHex.features.filter((feature) => feature.kind === "city").length, 1);
  assert.equal(losAngelesHex.features.filter((feature) => feature.kind === "los-angeles").length, 1);
  assert.equal(
    Object.values(AUDITED_BOARD.hexes).flatMap((hex) => hex.features).filter((feature) => feature.kind === "los-angeles").length,
    1,
    "Los Angeles is the only Hollywood return feature on the audited board",
  );
});

function finishOrdinaryPhases(state: GameState, observedPhases: Set<GameState["phase"]>): GameState {
  for (let step = 0; step < 30; step += 1) {
    observedPhases.add(state.phase);
    if (state.phase === "game-over" || state.phase === "move" || state.phase === "challenge") return state;
    if (state.phase === "fight") {
      state = applyCommand(state, { type: "resolve-fight" }).state;
    } else if (state.phase === "encounter") {
      if (state.pendingDecision?.type === "encounter-choice") {
        state = applyCommand(state, { type: "resolve-encounter", choice: state.pendingDecision.choices[0] ?? "health" }).state;
      } else if (state.pendingDecision?.type === "trophy-choice") {
        state = applyCommand(state, { type: "resolve-encounter", trophyUnitId: state.pendingTrophyChoice!.unitIds[0] }).state;
      } else {
        state = applyCommand(state, { type: "advance" }).state;
      }
    } else if (state.phase === "deploy") {
      state = applyCommand(state, { type: "pass-deploy" }).state;
    } else {
      throw new Error(`Unexpected phase while resolving an ordinary turn: ${state.phase}.`);
    }
  }
  throw new Error("The ordinary turn did not reach Move, Challenge, or game over.");
}

function finishChallenge(state: GameState): GameState {
  for (let step = 0; step < 1_000 && state.phase === "challenge"; step += 1) {
    const decision = state.pendingDecision;
    if (decision?.type === "challenge-opponent") {
      state = applyCommand(state, { type: "challenge-opponent", opponentMonsterId: decision.opponentIds[0]! }).state;
    } else if (decision?.type === "challenge-giant") {
      state = applyCommand(state, { type: "challenge-giant", giantUnitId: decision.giantUnitIds[0]! }).state;
    } else if (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution") {
      state = state.challenge?.turn?.remainingAttacks
        ? applyCommand(state, { type: "resolve-challenge" }).state
        : applyCommand(state, { type: "resolve-challenge", endTurn: true }).state;
    } else {
      throw new Error(`Unexpected Challenge decision: ${JSON.stringify(decision)}.`);
    }
  }
  assert.notEqual(state.phase, "challenge", "the Challenge route must reach a terminal state within the bounded fixture loop");
  return state;
}

function createTwoPlayerGameWithStartingResearch(seed: number): GameState {
  let game = createMvpRoomGame(2, seed);
  let setup = game.setupState!;
  for (let step = 0; step < 100 && setup.phase !== "complete"; step += 1) {
    const actor = setup.phase === "monster-selection"
      ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
      : setup.phase === "branch-selection"
        ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
        : setup.phase === "unused-branch-placement"
          ? 1
          : setup.phase === "lair-selection"
            ? setup.seats.find((seat) => !seat.lair)?.playerIndex
            : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
    assert.notEqual(actor, undefined, `setup actor for ${setup.phase}`);
    if (setup.phase === "starting-choice") setup = chooseStartingChoice(setup, actor!, { kind: "research" });
    else setup = chooseBotSetupAction(game, setup, actor!);
  }
  assert.equal(setup.phase, "complete");
  game = applyCompletedSetup({ ...game, setupState: setup });
  return game;
}

test("audited-board matches from setup can deplete Stomp markers and resolve a Monster Challenge at every player count", () => {
  for (const playerCount of [2, 3, 4] as const) {
    let game = createMvpRoomGame(playerCount, 171);
    let setup = game.setupState;
    for (let step = 0; step < 100 && setup.phase !== "complete"; step += 1) {
      const actor = setup.phase === "monster-selection"
        ? setup.seats.find((seat) => !seat.monsterId)?.playerIndex
        : setup.phase === "branch-selection"
          ? [...setup.seats].reverse().find((seat) => !seat.branch)?.playerIndex
          : setup.phase === "unused-branch-placement"
            ? playerCount - 1
            : setup.phase === "lair-selection"
              ? setup.seats.find((seat) => !seat.lair)?.playerIndex
              : setup.seats.find((seat) => !seat.startingChoice)?.playerIndex;
      assert.notEqual(actor, undefined, `setup actor for ${setup.phase}`);
      setup = chooseBotSetupAction(game, setup, actor!);
    }
    assert.equal(setup.phase, "complete");
    game = applyCompletedSetup({ ...game, setupState: setup });
    const initialMarkers = game.stompMarkers;
    let turns = 0;
    const observedPhases = new Set<GameState["phase"]>();

    while (game.phase !== "game-over" && !game.challenge?.active && turns < 250) {
      observedPhases.add(game.phase);
      if (game.phase === "move") {
        const activeMonster = game.monsters[game.currentPlayer]!;
        const board = boardForState(game);
        const targets = Object.values(board.hexes)
          .filter((hex) => hasStompableEncounterFeature(hex.features) && !game.stompedLocations.includes(hex.key))
          .map((hex) => hex.key);
        if (targets.includes(activeMonster.location as typeof targets[number])) {
          game = applyCommand(game, { type: "pass-move" }).state;
        } else {
          const route = legalMonsterPaths(game, activeMonster.id)
            .filter((path) => targets.includes(path.at(-1)!))
            .sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!))[0];
          game = route
            ? applyCommand(game, { type: "move", path: route }).state
            : applyCommand(game, { type: "pass-move" }).state;
        }
      }
      game = finishOrdinaryPhases(game, observedPhases);
      turns += 1;
    }

    observedPhases.add(game.phase);
    for (const phase of ["move", "fight", "encounter", "deploy", "challenge"] as const) {
      assert.ok(observedPhases.has(phase), `${playerCount}-player route must visit ${phase}`);
    }
    assert.equal(game.stompMarkers, 0, `${playerCount}-player route must consume its original Stomp markers`);
    assert.equal(game.challenge?.active, true, `${playerCount}-player route must start the declared Challenge`);
    game = finishChallenge(game);
    assert.equal(game.phase, "game-over", `${playerCount}-player Challenge must reach a terminal result`);
    assert.equal(game.victoryType, "monster-challenge");
    assert.notEqual(game.winnerPlayer, undefined);
    assert.equal(initialMarkers, playerCount === 2 ? 14 : playerCount === 3 ? 17 : 20);
  }
});

test("starting Research resolves immediate effects and lets the owner choose a giant base", () => {
  const giantDraw = createTwoPlayerGameWithStartingResearch(8);
  assert.equal(giantDraw.units.some((unit) => unit.unitTypeId === "mecha-monster"), false);
  assert.equal(giantDraw.pendingDecision?.type, "giant-placement");
  assert.equal(giantDraw.pendingDecision?.playerIndex, 0);
  assert.ok(giantDraw.pendingDecision?.type === "giant-placement" && giantDraw.pendingDecision.cardId === "Mecha-Monster", "seed 8 gives the first player Mecha-Monster as its starting Research card");
  const destinations = legalGiantPlacementDestinations(giantDraw);
  assert.ok(destinations.length > 1, "the physical board gives this branch a real placement choice");
  const selectedBase = destinations.at(-1)!;
  const placed = applyCommand(giantDraw, { type: "place-giant", destination: selectedBase }).state;
  const giant = placed.units.find((unit) => unit.unitTypeId === "mecha-monster");
  assert.ok(giant);
  assert.equal(giant.ownerPlayer, 0);
  assert.equal(giant.location, selectedBase);
  assert.equal(Object.hasOwn(AUDITED_BOARD.hexes, giant.location), true);
  assert.equal(placed.players[0]!.researchCardIds.includes("Mecha-Monster"), false);
  assert.equal(placed.decks.research.discard.includes("Mecha-Monster"), true);
  assert.equal(placed.phase, "move");

  const xFighterDraw = createTwoPlayerGameWithStartingResearch(18);
  const xFighters = xFighterDraw.units.filter((unit) => unit.unitTypeId === "x-fighter");
  assert.equal(xFighters.length, 2, "seed 18 gives the first player X-Fighters as its starting Research card");
  assert.deepEqual(xFighters.map((unit) => unit.location), ["record-tile", "record-tile"]);
  assert.deepEqual(xFighters.map((unit) => unit.ownerPlayer), [0, 0]);
  assert.ok(xFighterDraw.players[0]!.researchCardIds.includes("X-Fighters"));
});

test("flat-top geometry makes every displayed neighbor exactly one engine step", () => {
  for (const cell of AUDITED_CELLS) {
    const coord = auditedCoordinate(cell.row, cell.column);
    assert.deepEqual(auditedRowColumn(coord), { row: cell.row, column: cell.column });
    const odd = cell.column % 2;
    const neighbors = [
      [cell.row - 1, cell.column], [cell.row - 1 + odd, cell.column + 1],
      [cell.row + odd, cell.column + 1], [cell.row + 1, cell.column],
      [cell.row + odd, cell.column - 1], [cell.row - 1 + odd, cell.column - 1],
    ].filter(([row, column]) => row >= 0 && row < 14 && column >= 0 && column < 24);
    const actual = AUDITED_BOARD.edges.filter((edge) => edge.from === key(cell.row, cell.column));
    assert.deepEqual(actual.map((edge) => edge.to).sort(), neighbors.map(([row, column]) => key(row, column)).sort());
    for (const edge of actual) assert.equal(hexDistance(coord, AUDITED_BOARD.hexes[edge.to].coord), 1);
  }
  assert.equal(AUDITED_EDGE_DIRECTIONS.length, 6);
});

test("audited edge marks are unioned reciprocally, including one-sided lake and sea lines", () => {
  assert.equal(AUDITED_ONE_SIDED_BARRIERS.length, 14);
  for (const edge of AUDITED_BOARD.edges) {
    const reverse = AUDITED_BOARD.edges.find((candidate) => candidate.from === edge.to && candidate.to === edge.from);
    assert.equal(reverse?.barrier, edge.barrier);
    assert.equal(reverse?.enabled, true);
  }
  assert.equal(AUDITED_BOARD.edges.find((edge) => edge.from === key(4, 18) && edge.to === key(5, 18))?.barrier, "lake");
  assert.equal(AUDITED_BOARD.edges.find((edge) => edge.from === key(5, 22) && edge.to === key(4, 22))?.barrier, "sea");
});

test("Chicago remains land-accessible while lake crossings and naval eligibility use distinct gates", () => {
  const chicago = key(4, 15);
  assert.equal(AUDITED_BOARD.hexes[chicago].label, "Chicago");
  assert.equal(movementPathAllowed(AUDITED_BOARD, [key(4, 14), chicago], "land-only"), true);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago, key(4, 16)], "land-only"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago, key(4, 16)], "land-lake"), true);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago], "sea-seacoast-only"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago], "sea-seacoast-or-fly"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [key(3, 15)], "land-only"), true);
});

test("all six source monsters receive three audited lairs, including confirmed Tomanagi", () => {
  const setup = auditedSetupDefinition(2);
  assert.equal(setup.monsterIds.length, 6);
  for (const monster of monsters) {
    const lairs = setup.lairsByMonster[monster.id];
    assert.equal(lairs.length, 3);
    assert.equal(new Set(lairs).size, 3);
    for (const lair of lairs) assert.equal(AUDITED_BOARD.hexes[lair as keyof typeof AUDITED_BOARD.hexes].features.some((feature) => feature.kind === "lair" && feature.monsterId === monster.name.toLowerCase()), true);
  }
  assert.ok(setup.lairsByMonster["monster-2"].includes(key(10, 2)));
  assert.deepEqual(setup.lairsByMonster["monster-2"], [key(10, 2), key(11, 15), key(10, 21)]);
  for (const lair of setup.lairsByMonster["monster-2"]) {
    assert.equal(AUDITED_BOARD.hexes[lair as keyof typeof AUDITED_BOARD.hexes].features.some((feature) => feature.kind === "lair" && feature.monsterId === "tomanagi"), true);
  }
});

test("audited physical base ownership drives giant placement destinations for every branch", () => {
  const state = createMvpRoomGame(4, 78);
  const branches = ["Army", "Navy", "Air Force", "Marines"] as const;
  const setup = auditedSetupDefinition(4);
  state.setupAssignments = branches.map((branch, playerIndex) => ({
    playerIndex,
    monsterId: monsters[playerIndex]!.id,
    branch,
    lair: setup.lairsByMonster[monsters[playerIndex]!.id][0],
    ready: true,
  }));
  for (const [playerIndex, branch] of branches.entries()) {
    state.currentPlayer = playerIndex;
    const expected = Object.values(AUDITED_BOARD.hexes)
      .filter((hex) => hex.features.some((feature) => feature.kind === "military-base" && feature.branch === branch))
      .map((hex) => hex.key)
      .sort();
    assert.ok(expected.length > 0, `${branch} has reviewed physical bases`);
    assert.deepEqual(legalGiantPlacementDestinations(state), expected);
  }
});

test("new rooms use audited pins and materialize selected monsters on their actual lairs", () => {
  const state = createMvpRoomGame(2, 77);
  assert.equal(boardForState(state), AUDITED_BOARD);
  let setup = state.setupState!;
  setup = chooseMonster(setup, 0, "monster-6");
  setup = chooseMonster(setup, 1, "monster-5");
  setup = chooseBranch(setup, 1, "Marines");
  setup = chooseBranch(setup, 0, "Army");
  assert.equal(setup.phase, "unused-branch-placement");
  const unused = setup.definition.unusedBranchPlacements!;
  const placementBranches = ["Air Force", "Navy"] as const;
  const placements = placementBranches.flatMap((branch) => (unused.unitIdsByBranch[branch] ?? []).map((unitId, index) => ({ unitId, destination: unused.basesByBranch[branch]![index]! })));
  const sharedBase = unused.basesByBranch["Air Force"]!.find((base) => unused.basesByBranch["Navy"]!.includes(base));
  assert.ok(sharedBase, "the audited board has a hex with a base for both unused branches");
  assert.equal(placements.filter((placement) => placement.destination === sharedBase).length, 2);
  assert.throws(() => placeUnusedBranches(setup, 1, placements.slice(1)), /every unused branch unit/i);
  const duplicateBase = placements.map((placement, index) => index === 0 ? { ...placement, destination: placements[1]!.destination } : placement);
  assert.throws(() => placeUnusedBranches(setup, 1, duplicateBase), /distinct base/i);
  const crossBranch = placements.map((placement, index) => index === 0 ? { ...placement, destination: unused.basesByBranch["Navy"]![0]! } : placement);
  assert.throws(() => placeUnusedBranches(setup, 1, crossBranch), /base belonging to/i);
  assert.throws(() => placeUnusedBranches(setup, 0, placements), /player who chose a monster last/i);
  setup = placeUnusedBranches(setup, 1, placements);
  setup = chooseLair(setup, 0, setup.definition.lairsByMonster["monster-6"][0]);
  setup = chooseLair(setup, 1, setup.definition.lairsByMonster["monster-5"][0]);
  setup = chooseStartingChoice(setup, 0, { kind: "research" });
  setup = chooseStartingChoice(setup, 1, { kind: "research" });
  const ready = applyCompletedSetup({ ...state, setupState: setup });
  assert.deepEqual(ready.monsters.map((monster) => monster.name), ["Gargantis", "Toxicor"]);
  assert.equal(ready.monsters[0].location, setup.seats[0].lair);
  assert.equal(ready.monsters[1].location, setup.seats[1].lair);
  for (const placement of placements) assert.equal(ready.units.find((unit) => unit.id === placement.unitId)?.location, placement.destination);
  assert.equal(ready.setupApplied, true);
  assert.equal(boardForState(migrateGameState(JSON.parse(JSON.stringify(ready)))), AUDITED_BOARD);
});

test("four-player audited setup skips unused-branch placement", () => {
  const game = createMvpRoomGame(4, 79);
  let setup = game.setupState!;
  for (const monsterId of setup.definition.monsterIds.slice(0, 4)) setup = chooseMonster(setup, setup.seats.find((seat) => !seat.monsterId)!.playerIndex, monsterId);
  const branches = ["Army", "Navy", "Air Force", "Marines"] as const;
  for (const playerIndex of [3, 2, 1, 0]) setup = chooseBranch(setup, playerIndex, branches[playerIndex]!);
  assert.equal(setup.phase, "lair-selection");
  for (const seat of setup.seats) setup = chooseLair(setup, seat.playerIndex, setup.definition.lairsByMonster[seat.monsterId!]![0]!);
  for (const seat of setup.seats) setup = chooseStartingChoice(setup, seat.playerIndex, { kind: "research" });
  validateSetup(setup);
  assert.equal(setup.unusedBranchPlacements, undefined);
});

test("three-player audited setup assigns the single unused branch to the last monster picker", () => {
  const game = createMvpRoomGame(3, 80);
  let setup = game.setupState!;
  for (const monsterId of setup.definition.monsterIds.slice(0, 3)) setup = chooseMonster(setup, setup.seats.find((seat) => !seat.monsterId)!.playerIndex, monsterId);
  setup = chooseBranch(setup, 2, "Army");
  setup = chooseBranch(setup, 1, "Navy");
  setup = chooseBranch(setup, 0, "Air Force");
  assert.equal(setup.phase, "unused-branch-placement");
  const catalogue = setup.definition.unusedBranchPlacements!;
  const placements = (catalogue.unitIdsByBranch.Marines ?? []).map((unitId, index) => ({ unitId, destination: catalogue.basesByBranch.Marines![index]! }));
  assert.throws(() => placeUnusedBranches(setup, 0, placements), /player who chose a monster last/i);
  setup = chooseBotSetupAction(game, setup, 2);
  assert.equal(setup.unusedBranchPlacements?.length, placements.length);
  assert.equal(setup.phase, "lair-selection");
  for (const seat of setup.seats) setup = chooseLair(setup, seat.playerIndex, setup.definition.lairsByMonster[seat.monsterId!]![0]!);
  for (const seat of setup.seats) setup = chooseStartingChoice(setup, seat.playerIndex, { kind: "research" });
  validateSetup(setup);
  const ready = applyCompletedSetup({ ...game, setupState: setup });
  for (const placement of placements) assert.equal(ready.units.find((unit) => unit.id === placement.unitId)?.location, placement.destination);
});

test("legacy match board identities stay available and reject mismatched pins", () => {
  for (const board of [DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD]) {
    assert.equal(boardForState({ boardId: board.id, boardVersion: board.version, boardContentHash: board.contentHash }), board);
  }
  const state = createProvisionalPlaytestGame(2);
  assert.equal(boardForState(migrateGameState(JSON.parse(JSON.stringify(state)))), PROVISIONAL_AUTHORITATIVE_BOARD);
  assert.throws(() => boardForState({ ...state, boardContentHash: AUDITED_BOARD.contentHash }), /unavailable/);
});


test("off-board recovery returns to the audited lair or audited Los Angeles", () => {
  for (const position of ["disappeared", "hollywood"] as const) {
    const state = createMvpRoomGame(2, 9);
    state.setupState = undefined;
    state.setupAssignments = state.monsters.map((monster, playerIndex) => ({ playerIndex, monsterId: monster.id, lair: auditedSetupDefinition(2).lairsByMonster[monster.id][0], ready: true }));
    state.currentPlayer = 1;
    state.phase = "deploy";
    state.monsters[0].location = position;
    state.monsters[0].health = 8;
    const returned = applyCommand(state, { type: "pass-deploy" }).state;
    assert.equal(returned.currentPlayer, 0);
    assert.equal(returned.monsters[0].location, position === "hollywood" ? key(8, 2) : state.setupAssignments[0].lair);
    assert.ok(AUDITED_BOARD.hexes[returned.monsters[0].location as keyof typeof AUDITED_BOARD.hexes]);
  }
});
