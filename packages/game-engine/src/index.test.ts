import assert from "node:assert/strict";
import test from "node:test";
import { CARD_STACKING_RULES, cardStackingRule, createCardDeckState, discardCard, drawCard, MILITARY_RESEARCH_CARD_IDS, MONSTER_MUTATION_CARD_IDS, sourcedCardRule, SOURCED_CARD_RULES } from "./cards.js";
import { applyCommand, applyCommandEnvelope, assertCardsAvailable, assertMvpBoardReady, boardForState, CARD_DATA_VERSION, CARD_DEFINITIONS, cardDefinition, createDevelopmentVictoryGame, createGame, createGameFromSetup, createMvpRoomGame, createNationalGuardInventory, createProvisionalPlaytestGame, DEVELOPMENT_STOMPABLE_KEYS, discardCardFromGame, drawCardFromGame, hasStompableEncounterFeature, legalMonsterDestinations, legalMonsterPaths, legalNationalGuardDeploymentDestinations, legalOwnedDeploymentDestinations, legalOwnedRedeploymentDestinations, legalUnitPaths, locations, migrateGameState, movementPathAllowed, occupantsAt, projectState, resolveEncounterResult, sourceNationalGuardInventoryErrors, sourceUnitInventoryErrors, stompMarkerCount, unsupportedCardIds, validateInventoryAccounting, type GameState } from "./index.js";
import { chooseBranch, chooseLair, chooseMonster, chooseStartingChoice, createSetup } from "./setup.js";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, locationIdToHexKey, validateBoardDefinition } from "./board.js";
import { MONSTER_DEFINITIONS, monsterDefinition } from "./monsters.js";
import { BRANCH_DEPLOYMENT_DEFINITIONS, GIANT_UNIT_DEFINITIONS, NATIONAL_GUARD_DEFINITIONS, UNIT_DEFINITIONS } from "./units.js";

const K = (id: string) => locationIdToHexKey(id)!;

function resolveDevelopmentRetreat(state: GameState): GameState {
  if (!state.pendingRetreat) return state;
  const destinations = Object.fromEntries(state.pendingRetreat.unitIds.map((unitId) => [unitId, state.pendingRetreat!.options[unitId]?.[0] ?? "disappeared"]));
  return applyCommand(state, { type: "retreat", destinations }).state;
}

function resolveDevelopmentFight(state: GameState): GameState {
  let next = resolveDevelopmentRetreat(state);
  for (let step = 0; next.phase === "fight" && step < 32; step += 1) {
    next = next.pendingDecision?.type === "attack-target"
      ? applyCommand(next, { type: "resolve-fight", battleId: next.pendingDecision.battleId, targetUnitId: next.pendingDecision.targetIds[0] }).state
      : applyCommand(next, { type: "advance" }).state;
    next = resolveDevelopmentRetreat(next);
  }
  return next;
}

test("MVP room creation uses the pinned best-guess honeycomb board", () => {
  assert.doesNotThrow(() => assertMvpBoardReady());
  const state = createMvpRoomGame(2, 7, "best-guess-mvp");
  assert.equal(state.boardId, "provisional-authoritative-honeycomb-board");
  assert.equal(state.boardVersion, 1);
  assert.equal(state.boardContentHash, "fnv1a:acc73e31");
  assert.equal(state.setupState?.phase, "monster-selection");
  assert.equal(state.setupState?.definition.lairsByMonster["monster-1"]?.length, 3);
});

test("supported player counts get the correct stomp stack", () => {
  assert.equal(stompMarkerCount(2), 14);
  assert.equal(createGame(3).stompMarkers, 17);
  assert.equal(createGame(4).stompMarkers, 20);
  assert.throws(() => createGame(1), /exactly 2, 3, or 4/);
  assert.throws(() => createGame(5), /exactly 2, 3, or 4/);
});

test("source-backed monster catalogue preserves record statistics and unresolved boundaries", () => {
  assert.equal(MONSTER_DEFINITIONS.length, 6);
  assert.deepEqual(MONSTER_DEFINITIONS.map((monster) => monster.id), ["zorb", "tomanagi", "gargantis", "megaclaw", "konk", "toxicor"]);
  assert.deepEqual(MONSTER_DEFINITIONS.map((monster) => monster.startingHealth), [11, 11, 10, 12, 10, 9]);
  assert.deepEqual(MONSTER_DEFINITIONS.map((monster) => monster.movement), ["land-only", "land-lake-sea", "fly", "land-lake", "land-only", "land-lake"]);
  for (const monster of MONSTER_DEFINITIONS) {
    assert.equal(monster.move >= 3, true);
    assert.equal(monster.defense, 4);
    assert.equal(monster.attacks, 3);
    assert.equal(monster.damage, 3);
    assert.equal(monster.sourceRefs.length, 1);
    assert.equal(monster.lairs, "source-gated");
    assert.equal(monster.specialAbilityImplementation, "source-gated");
  }
  assert.match(monsterDefinition("toxicor")!.specialAbilityText, /draw 2 Mutation cards/i);
  assert.equal(monsterDefinition("unknown"), undefined);
});

test("development monsters use the source-backed record statistics", () => {
  const state = createGame(4);
  assert.deepEqual(state.monsters.map((monster) => [monster.name, monster.health, monster.move, monster.attacks, monster.defense, monster.damage]), [
    ["Zorb", 11, 4, 3, 4, 3],
    ["Tomanagi", 11, 4, 3, 4, 3],
    ["Konk", 10, 4, 3, 4, 3],
    ["Megaclaw", 12, 4, 3, 4, 3],
  ]);
  assert.equal(state.monsters.every((monster) => monster.maxHealth === 40), true);
});

test("source-backed unit catalogue preserves branch quantities and control boundaries", () => {
  assert.deepEqual(UNIT_DEFINITIONS.map((unit) => unit.quantity), [5, 3, 5, 3, 4, 4, 6, 2]);
  assert.deepEqual(UNIT_DEFINITIONS.map((unit) => unit.branch), ["Army", "Army", "Navy", "Navy", "Marines", "Marines", "Air Force", "Air Force"]);
  assert.equal(UNIT_DEFINITIONS.every((unit) => unit.sourceRefs.length === 1 && unit.effectsImplementation === "source-gated"), true);
  assert.deepEqual(GIANT_UNIT_DEFINITIONS.map((unit) => [unit.id, unit.quantity]), [["mecha-monster", 1], ["captain-colossal", 1]]);
  assert.deepEqual(GIANT_UNIT_DEFINITIONS.map((unit) => [unit.health, unit.move, unit.defense, unit.attacks, unit.damage]), [[6, 4, 5, 1, 4], [8, 4, 4, 2, 2]]);
  assert.deepEqual(NATIONAL_GUARD_DEFINITIONS.map((unit) => [unit.quantity, unit.move, unit.defense, unit.damage]), [[6, 3, 4, 1], [2, 5, 3, 1]]);
  assert.equal(NATIONAL_GUARD_DEFINITIONS.every((unit) => unit.specialAbilityText.includes("Guard Commander") && unit.controlImplementation === "source-gated"), true);
  assert.deepEqual(BRANCH_DEPLOYMENT_DEFINITIONS.map((entry) => [entry.ownOrGuardUnits, entry.additionalNationalGuardUnits]), [[2, 1], [2, 1], [2, 1], [3, 0]]);
  assert.equal(BRANCH_DEPLOYMENT_DEFINITIONS.every((entry) => entry.canDrawResearchInstead && entry.implementation === "source-gated"), true);
});

test("development military roster uses source-backed unit records", () => {
  const state = createGame(2);
  assert.deepEqual(state.units.slice(0, 8).map((unit) => [unit.unitTypeId, unit.move, unit.defense, unit.damage]), [
    ["army-tank", 4, 5, 1],
    ["army-missile-launcher", 4, 3, 1],
    ["navy-fighter", 6, 4, 1],
    ["navy-nuclear-submarine", 4, 5, 1],
    ["air-force-fighter", 6, 4, 1],
    ["air-force-cruise-missile", 8, 6, 1],
    ["marines-fighter", 5, 4, 1],
    ["marines-rocket-launcher", 4, 3, 2],
  ]);
  assert.deepEqual(sourceUnitInventoryErrors(state.units), []);
  assert.equal(state.units.length, 32);
});

test("National Guard remains neutral on its record tile until sourced", () => {
  const state = createGame(2);
  assert.deepEqual(state.nationalGuard, createNationalGuardInventory());
  assert.equal(state.nationalGuard.branch, "National Guard");
  assert.equal(state.nationalGuard.control, "neutral");
  assert.equal(state.nationalGuard.location, "record-tile");
  assert.equal(state.nationalGuard.quantity, 8);
  assert.deepEqual(state.nationalGuard.unitIds, [
    "national-guard-tank-1", "national-guard-tank-2", "national-guard-tank-3", "national-guard-tank-4", "national-guard-tank-5", "national-guard-tank-6",
    "national-guard-fighter-1", "national-guard-fighter-2",
  ]);
  assert.equal(state.nationalGuard.statistics, "source-gated");
});

test("ordinary movement cannot move a neutral National Guard unit", () => {
  const state = createGame(2);
  assert.throws(() => applyCommand(state, { type: "move-unit", unitId: "national-guard-tank-1", path: [K("denver"), K("chicago")] }), /not legal/);
  assert.deepEqual(state.nationalGuard.unitIds, createNationalGuardInventory().unitIds);
  assert.equal(state.nationalGuard.control, "neutral");
});

test("Guard Commander grants only its holder National Guard movement and deployment control", () => {
  const state = createGame(2);
  const guard = {
    ...state.units[0],
    id: "national-guard-tank-1",
    branch: "National Guard" as const,
    unitTypeId: "national-guard-tank",
    ownerPlayer: undefined,
    location: K("denver"),
    move: 3,
    movement: "land-only" as const,
  };
  state.units = [...state.units, guard];
  state.players[state.currentPlayer].researchCardIds = ["Guard Commander"];
  assert.ok(legalUnitPaths(state, guard.id).some((path) => path.join(">") === `${K("denver")}>${K("chicago")}`));
  const moved = applyCommand(state, { type: "move-unit", unitId: guard.id, path: [K("denver"), K("chicago")] });
  assert.equal(moved.state.units.find((unit) => unit.id === guard.id)?.location, K("chicago"));

  const noCard = createGame(2);
  noCard.phase = "deploy";
  noCard.pendingDecision = { type: "deployment", playerIndex: noCard.currentPlayer };
  assert.throws(() => applyCommand(noCard, { type: "deploy", unitId: "national-guard-tank-1", destination: K("infamy-site") }), /Guard Commander card/);
});

test("inventory accounting rejects structural identity and reference drift", () => {
  const state = createGame(2);
  assert.deepEqual(validateInventoryAccounting(state), []);
  const invalid = structuredClone(state) as any;
  invalid.units[1].id = invalid.units[0].id;
  invalid.nationalGuard.unitIds = [invalid.units[0].id];
  invalid.movedPieceIds = ["missing-piece"];
  assert.deepEqual(validateInventoryAccounting(invalid), [
    "National Guard ID count mismatch: expected 8, got 1",
    "National Guard inventory mismatch for national-guard-tank-1: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-tank-2: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-tank-3: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-tank-4: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-tank-5: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-tank-6: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-fighter-1: expected 1, got 0",
    "National Guard inventory mismatch for national-guard-fighter-2: expected 1, got 0",
    "National Guard inventory mismatch for 0-0: expected 0, got 1",
    "duplicate piece IDs: 0-0",
    "National Guard ID collision: 0-0",
    "movement ledger references missing piece missing-piece",
  ]);
  const invalidRemoval = structuredClone(state) as any;
  invalidRemoval.removedUnitIds = ["missing-unit"];
  assert.deepEqual(validateInventoryAccounting(invalidRemoval), ["removed unit references missing unit missing-unit"]);
  const invalidPosition = structuredClone(state) as any;
  invalidPosition.units[0].location = "permanently-removed";
  assert.deepEqual(validateInventoryAccounting(invalidPosition), ["permanently-removed unit 0-0 is missing from removedUnitIds"]);
  const invalidBoardPosition = structuredClone(state) as any;
  invalidBoardPosition.monsters[0].location = "99,99";
  assert.deepEqual(validateInventoryAccounting(invalidBoardPosition), ["unknown position for piece monster-1: 99,99"]);
  const missingRegularUnit = structuredClone(state) as any;
  missingRegularUnit.units = missingRegularUnit.units.filter((unit: { unitTypeId: string }) => unit.unitTypeId !== "army-tank").slice(0, -1);
  assert.equal(validateInventoryAccounting(missingRegularUnit).some((error) => error.startsWith("army-tank: expected 5")), true);
  const invalidPendingTarget = createGame(2);
  invalidPendingTarget.pendingBattles = [{ id: "pending-battle", monsterId: "monster-1", location: invalidPendingTarget.monsters[0].location as any, militaryUnitIds: ["0-0"] }];
  invalidPendingTarget.pendingAttackTarget = { battleId: "pending-battle", attackerId: "monster-1", targetIds: ["missing-unit"] };
  assert.deepEqual(validateInventoryAccounting(invalidPendingTarget), [
    "pending attack target references non-military target missing-unit",
    "pending attack target missing-unit is not in battle pending-battle",
  ]);
});

test("National Guard source inventory validation rejects quantity and identity drift", () => {
  const inventory = createNationalGuardInventory();
  assert.deepEqual(sourceNationalGuardInventoryErrors(inventory), []);
  assert.ok(sourceNationalGuardInventoryErrors({ quantity: 7, unitIds: inventory.unitIds.slice(1) }).some((error) => error.startsWith("National Guard quantity mismatch")));
});

test("the active player controls neutral National Guard attacks", () => {
  const state = createGame(2, 4);
  const guard = {
    ...state.units[0],
    id: "national-guard-tank-1",
    branch: "National Guard" as const,
    unitTypeId: "national-guard-tank",
    ownerPlayer: undefined,
    location: K("los-angeles"),
    attacks: 1,
    damage: 1,
  };
  state.units = [...state.units, guard];
  state.monsters[0].location = K("los-angeles");
  state.monsters[0].attacks = 0;
  state.monsters[0].defense = 99;
  state.phase = "fight";
  state.pendingBattles = [{ id: "monster-1:1:guard", monsterId: "monster-1", location: K("los-angeles"), militaryUnitIds: [guard.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: state.currentPlayer, battleId: "monster-1:1:guard" };
  const result = applyCommand(state, { type: "resolve-fight" });
  const guardAttack = (result.eventPayload.attacks as Array<{ attackerId: string; controllerPlayer: number }>).find((attack) => attack.attackerId === guard.id);
  assert.equal(guardAttack?.controllerPlayer, state.currentPlayer);
});

test("ordinary branch attacks retain their owning player's controller", () => {
  const state = createGame(2, 4);
  const unit = state.units[0];
  unit.ownerPlayer = 1;
  unit.location = K("los-angeles");
  unit.attacks = 1;
  unit.damage = 1;
  state.monsters[0].location = K("los-angeles");
  state.monsters[0].attacks = 0;
  state.monsters[0].defense = 99;
  state.phase = "fight";
  state.currentPlayer = 0;
  state.pendingBattles = [{ id: "monster-1:1:owned", monsterId: "monster-1", location: K("los-angeles"), militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "monster-1:1:owned" };
  const result = applyCommand(state, { type: "resolve-fight" });
  const branchAttack = (result.eventPayload.attacks as Array<{ attackerId: string; controllerPlayer: number }>).find((attack) => attack.attackerId === unit.id);
  assert.equal(branchAttack?.controllerPlayer, 1);
});

test("National Guard deployment destinations are limited to unstomped city, base, and Infamy spaces", () => {
  const state = createGame(2);
  const destinations = legalNationalGuardDeploymentDestinations(state);
  assert.equal(destinations.includes(K("denver")), true);
  assert.equal(destinations.includes(K("los-angeles")), true);
  assert.equal(destinations.includes(K("infamy-site")), true);
  assert.equal(destinations.includes(K("dallas")), false);
  const stomped = { ...state, stompedLocations: [K("denver"), K("infamy-site")] };
  assert.equal(legalNationalGuardDeploymentDestinations(stomped).includes(K("denver")), false);
  assert.equal(legalNationalGuardDeploymentDestinations(stomped).includes(K("infamy-site")), false);
});

test("owned deployment destinations are verified, unstomped, and unique per Deploy step", () => {
  const state = createGame(2);
  assert.deepEqual(legalOwnedDeploymentDestinations(state), [K("denver")]);
  state.deploymentDestinations = [K("denver")];
  assert.deepEqual(legalOwnedDeploymentDestinations(state), []);
  state.deploymentDestinations = [];
  state.stompedLocations = [K("denver")];
  assert.deepEqual(legalOwnedDeploymentDestinations(state), []);
});

test("redeployment destinations require an active player's ordinary branch unit and unstomped branch base", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  const unit = state.units.find((candidate) => candidate.id === "0-0")!;
  unit.location = K("chicago");
  unit.ownerPlayer = 0;
  assert.deepEqual(legalOwnedRedeploymentDestinations(state, unit.id), [K("denver")]);
  state.stompedLocations = [K("denver")];
  assert.deepEqual(legalOwnedRedeploymentDestinations(state, unit.id), []);
  state.stompedLocations = [];
  unit.branch = "National Guard";
  assert.deepEqual(legalOwnedRedeploymentDestinations(state, unit.id), []);
  unit.branch = "Army";
  unit.unitTypeId = "mecha-monster";
  assert.deepEqual(legalOwnedRedeploymentDestinations(state, unit.id), []);
});

test("redeployment moves one owned branch unit and consumes one branch allowance", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  const unit = state.units.find((candidate) => candidate.id === "0-0")!;
  unit.location = K("chicago");
  unit.ownerPlayer = 0;
  const result = applyCommand(state, { type: "redeploy", unitId: unit.id, destination: K("denver") });
  assert.equal(result.eventType, "unit.redeployed");
  assert.equal(result.state.units.find((candidate) => candidate.id === unit.id)?.location, K("denver"));
  assert.equal(result.state.deploymentsThisTurn, 1);
  assert.deepEqual(result.eventPayload, { unitId: unit.id, branch: "Army", destination: K("denver"), deploymentsThisTurn: 1, nextPhase: "deploy" });
  assert.throws(() => applyCommand(result.state, { type: "redeploy", unitId: unit.id, destination: K("denver") }), /unstomped base|allowance|record/i);
});

test("inventory accounting remains exact across deploy, trophy, destruction, and redeploy boundaries", () => {
  const deployedState = createGame(2);
  deployedState.phase = "deploy";
  deployedState.pendingDecision = { type: "deployment", playerIndex: 0 };
  const deployed = applyCommand(deployedState, { type: "deploy" });
  assert.deepEqual(validateInventoryAccounting(deployed.state), []);

  const redeployState = createGame(2);
  redeployState.phase = "deploy";
  redeployState.pendingDecision = { type: "deployment", playerIndex: 0 };
  const redeployUnit = redeployState.units.find((unit) => unit.id === "0-0")!;
  redeployUnit.location = K("chicago");
  redeployUnit.ownerPlayer = 0;
  const redeployed = applyCommand(redeployState, { type: "redeploy", unitId: redeployUnit.id, destination: K("denver") });
  assert.deepEqual(validateInventoryAccounting(redeployed.state), []);

  const trophyState = createGame(2);
  trophyState.setupAssignments = [
    { playerIndex: 0, monsterId: "monster-1", branch: "Navy", lair: "los-angeles", ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Army", lair: "chicago", ready: true },
  ];
  trophyState.phase = "encounter";
  trophyState.monsters[0].location = K("denver");
  const trophyPending = applyCommand(trophyState, { type: "resolve-encounter" });
  const trophyId = trophyPending.state.pendingTrophyChoice!.unitIds[0];
  const trophy = applyCommand(trophyPending.state, { type: "resolve-encounter", trophyUnitId: trophyId });
  assert.deepEqual(validateInventoryAccounting(trophy.state), []);

  const destructionState = createGame(2, 0);
  destructionState.currentPlayer = 0;
  destructionState.monsters[0].health = 40;
  destructionState.units[5].location = destructionState.monsters[0].location;
  destructionState.phase = "fight";
  destructionState.pendingBattles = [{ id: "inventory-destruction", monsterId: "monster-1", location: destructionState.monsters[0].location as any, militaryUnitIds: [destructionState.units[5].id] }];
  destructionState.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "inventory-destruction" };
  const destruction = applyCommand(destructionState, { type: "resolve-fight" });
  assert.deepEqual(validateInventoryAccounting(destruction.state), []);
});

test("National Guard deployment creates a neutral unit at a legal destination", () => {
  const state = createGame(2);
  state.players[state.currentPlayer].researchCardIds = ["Guard Commander"];
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: state.currentPlayer };
  const result = applyCommand(state, { type: "deploy", unitId: "national-guard-tank-1", destination: K("infamy-site") });
  const guard = result.state.units.find((unit) => unit.id === "national-guard-tank-1");
  assert.equal(guard?.branch, "National Guard");
  assert.equal(guard?.location, K("infamy-site"));
  assert.equal(guard?.ownerPlayer, undefined);
  assert.equal(result.state.deploymentDestinations.includes(K("infamy-site")), true);
});

test("deployment into a monster space creates a compulsory pending battle", () => {
  const state = createGame(2);
  state.players[state.currentPlayer].researchCardIds = ["Guard Commander"];
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: state.currentPlayer };
  state.monsters[state.currentPlayer].location = K("infamy-site");
  const result = applyCommand(state, { type: "deploy", unitId: "national-guard-tank-1", destination: K("infamy-site") });
  assert.equal(result.state.phase, "fight");
  assert.equal(result.state.pendingBattles.length, 1);
  assert.deepEqual(result.state.pendingBattles[0].militaryUnitIds, ["national-guard-tank-1"]);
  assert.equal(result.state.pendingDecision?.type, "battle-resolution");
});

test("normal battle target validation keeps monster and military target classes separate", () => {
  const state = createGame(2);
  state.phase = "fight";
  state.pendingBattles = [{ id: "invalid-target", monsterId: "monster-1", location: state.monsters[0].location as `${number},${number}`, militaryUnitIds: ["monster-1"] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: state.currentPlayer, battleId: "invalid-target" };
  assert.throws(() => applyCommand(state, { type: "resolve-fight" }), /non-military target/);
});

test("Scientific Analysis resolves independently at battle start", () => {
  const state = createGame(2);
  state.players[0].researchCardIds = ["Scientific Analysis"];
  state.phase = "fight";
  state.monsters[0].health = 10;
  state.monsters[0].attacks = 0;
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  unit.attacks = 0;
  const battleId = "research-start-effects";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const result = applyCommand(state, { type: "resolve-fight", battleId });
  assert.equal(result.state.monsters[0].health, 9);
  assert.equal(result.state.log.some((entry) => /Scientific Analysis/.test(entry)), true);
});

test("Anti-Mutagen resolves independently at battle start", () => {
  const state = createGame(2);
  state.players[0].researchCardIds = ["Anti-Mutagen"];
  state.players[0].mutationCardIds = ["Rampage", "War Spikes"];
  state.phase = "fight";
  state.monsters[0].health = 10;
  state.monsters[0].attacks = 0;
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  unit.attacks = 0;
  const battleId = "anti-mutagen-start-effects";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const result = applyCommand(state, { type: "resolve-fight", battleId });
  assert.equal(result.state.monsters[0].health, 8);
  assert.equal(result.state.log.some((entry) => /Anti-Mutagen/.test(entry)), true);
});

test("Defense Satellites discards and resolves one deterministic roll per board monster", () => {
  const state = createGame(2, 0);
  state.players[0].researchCardIds = ["Defense Satellites"];
  const startingHealth = state.monsters.map((monster) => monster.health);
  const result = applyCommand(state, { type: "use-research", cardId: "Defense Satellites" });
  assert.deepEqual(result.state.players[0].researchCardIds, []);
  assert.deepEqual(result.state.decks.research.discard, ["Defense Satellites"]);
  assert.equal((result.eventPayload.rolls as number[]).length, 2);
  assert.deepEqual(result.state.monsters.map((monster) => monster.health < startingHealth[Number(monster.id.split("-")[1]) - 1]), [true, true]);
  assert.equal(result.eventType, "research.used");
});

test("Antimatter arms a battle and doubles first-round military damage", () => {
  const state = createGame(2, 0);
  state.players[0].researchCardIds = ["Antimatter"];
  state.phase = "fight";
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  const battleId = "antimatter";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const armed = applyCommand(state, { type: "use-research", cardId: "Antimatter", battleId });
  assert.deepEqual(armed.state.players[0].researchCardIds, []);
  assert.deepEqual(armed.state.decks.research.discard, ["Antimatter"]);
  assert.equal(armed.state.pendingBattles[0].antimatterActive, true);
  let doubledAttack: { damage: number; modifiers: string[] } | undefined;
  for (let seed = 0; seed < 128 && !doubledAttack; seed += 1) {
    const candidate = structuredClone(armed.state);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    doubledAttack = (result.eventPayload.attacks as Array<{ attackerId: string; hit: boolean; damage: number; modifiers: string[] }>)
      .find((attack) => attack.attackerId === unit.id && attack.hit);
  }
  assert.ok(doubledAttack);
  assert.equal(doubledAttack!.damage >= unit.damage * 2, true);
  assert.equal(doubledAttack!.modifiers.includes("Antimatter: double first-round damage"), true);
});

test("one-shot Research cards cannot be reused after authoritative discard", () => {
  const state = createGame(2, 0);
  state.players[0].researchCardIds = ["Antimatter"];
  state.phase = "fight";
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  const battleId = "one-shot-research";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const used = applyCommand(state, { type: "use-research", cardId: "Antimatter", battleId });
  assert.deepEqual(used.state.players[0].researchCardIds, []);
  assert.deepEqual(used.state.decks.research.discard, ["Antimatter"]);
  assert.throws(() => applyCommand(used.state, { type: "use-research", cardId: "Antimatter", battleId }), /does not have Antimatter/);
});

test("Stabilizer Ray discards its selected Mutation only after military damage", () => {
  const state = createGame(2, 0);
  state.players[0].researchCardIds = ["Stabilizer Ray"];
  state.players[0].mutationCardIds = ["Rampage"];
  state.phase = "fight";
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  const battleId = "stabilizer-ray";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  const armed = applyCommand(state, { type: "use-research", cardId: "Stabilizer Ray", battleId, mutationCardId: "Rampage" });
  assert.deepEqual(armed.state.players[0].researchCardIds, []);
  assert.deepEqual(armed.state.players[0].mutationCardIds, ["Rampage"]);
  let triggered: GameState | undefined;
  for (let seed = 0; seed < 128 && !triggered; seed += 1) {
    const candidate = structuredClone(armed.state);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight", battleId });
    if ((result.eventPayload.attacks as Array<{ stabilizerMutationCardId?: string }>).some((attack) => attack.stabilizerMutationCardId === "Rampage")) triggered = result.state;
  }
  assert.ok(triggered);
  assert.deepEqual(triggered!.players[0].mutationCardIds, []);
});

test("a monster may spend Infamy for one recorded extra attack before combat rolls", () => {
  const state = createGame(2, 0);
  const monster = state.monsters[0];
  const unit = state.units[0];
  state.currentPlayer = 0;
  state.phase = "fight";
  state.pendingBattles = [{ id: "infamy-battle", monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "infamy-battle" };
  state.stompedLocations = [];
  monster.infamy = 2;
  monster.defense = 99;
  unit.location = monster.location;
  unit.defense = 99;
  const result = applyCommand(state, { type: "resolve-fight", spendInfamy: 1 });
  const attacks = result.eventPayload.attacks as Array<{ attackerId: string }>;
  assert.equal(result.state.monsters[0].infamy, 1);
  assert.equal(result.eventPayload.infamySpent, 1);
  assert.equal(attacks.filter((attack) => attack.attackerId === monster.id).length, monster.attacks * 2 + 1);
});

test("successful command results remain inventory-conserving at the event boundary", () => {
  const state = createGame(2);
  const result = applyCommand(state, { type: "pass-move" });
  assert.deepEqual(validateInventoryAccounting(result.state), []);
  assert.equal(result.state.eventLog.at(-1)?.action, "monster.stayed");
});

test("source-inventoried cards have versioned structured metadata without guessed effects", () => {
  assert.equal(CARD_DATA_VERSION, 1);
  assert.equal(CARD_DEFINITIONS.length, 32);
  assert.equal(CARD_DEFINITIONS.filter((card) => card.deck === "mutation").length, 16);
  assert.equal(CARD_DEFINITIONS.filter((card) => card.deck === "research").length, 16);
  assert.equal(cardDefinition("Guard Commander")?.availability, "implemented");
  assert.equal(cardDefinition("Guard Commander")?.visibility, "unknown");
  assert.equal(cardDefinition("Guard Commander")?.lifecycle, "implemented");
  assert.equal(cardDefinition("Berserk")?.availability, "implemented");
  assert.deepEqual(unsupportedCardIds(["Guard Commander"]), []);
  assert.deepEqual(unsupportedCardIds(MONSTER_MUTATION_CARD_IDS), []);
  assert.deepEqual(unsupportedCardIds(["Defense Satellites"]), []);
  assert.deepEqual(unsupportedCardIds(["Antimatter", "Stabilizer Ray", "Laser Fence"]), []);
  assert.deepEqual(unsupportedCardIds(["Guard Commander", "Berserk"]), []);
  assert.deepEqual(unsupportedCardIds(["Guard Commander", "Mecha-Monster", "Captain Colossal"]), []);
  assert.doesNotThrow(() => assertCardsAvailable(["Mecha-Monster", "Captain Colossal"]));
  assert.deepEqual(SOURCED_CARD_RULES.map((card) => card.id).filter((id) => MILITARY_RESEARCH_CARD_IDS.includes(id as typeof MILITARY_RESEARCH_CARD_IDS[number])).sort(), [...MILITARY_RESEARCH_CARD_IDS].sort());
  assert.deepEqual(SOURCED_CARD_RULES.map((card) => card.id).sort(), CARD_DEFINITIONS.map((card) => card.id).sort());
  assert.equal(sourcedCardRule("Fins and Gills")?.effectsImplementation, "implemented");
  assert.equal(sourcedCardRule("Captain Colossal")?.effectsImplementation, "implemented");
  assert.equal(sourcedCardRule("2nd Generation")?.effectsImplementation, "implemented");
  assert.deepEqual(sourcedCardRule("Guard Commander"), {
    id: "Guard Commander",
    transcription: "You can move and redeploy Guard units. Tanks have Move 3 (land only). Fighters have Move 5 (fly). Other players can't deploy Guard units.",
    classification: "persistent",
    timing: "Continuous while face up.",
    duration: "Until removed from play.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "implemented",
  });
  assert.equal(cardDefinition("not-a-card"), undefined);
});

test("card stacking policies are explicit and fail closed when the cited text is insufficient", () => {
  assert.equal(CARD_STACKING_RULES.length, CARD_DEFINITIONS.length);
  assert.equal(CARD_STACKING_RULES.every((rule) => rule.sourceRefs.length > 0 && rule.rationale.length > 0), true);
  assert.deepEqual(cardStackingRule("High-Octane Blood")?.policy, "additive");
  assert.deepEqual(cardStackingRule("War Spikes")?.policy, "replacement");
  assert.deepEqual(cardStackingRule("Cutbacks")?.policy, "source-gated");
  assert.equal(CARD_STACKING_RULES.filter((rule) => rule.policy === "source-gated").length, 23);
});

test("runtime commands fail closed for every source-gated card", () => {
  const unsupportedMutations = CARD_DEFINITIONS.filter((card) => card.deck === "mutation" && card.availability === "source-gated").map((card) => card.id);
  const unsupportedResearch = CARD_DEFINITIONS.filter((card) => card.deck === "research" && card.availability === "source-gated").map((card) => card.id);
  assert.deepEqual(unsupportedMutations, []);
  assert.deepEqual(unsupportedResearch.sort(), ["Chopper Lift", "Cutbacks", "Molecular Cannon"].sort());
  for (const cardId of unsupportedResearch) {
    assert.throws(() => applyCommand(createGame(2), { type: "use-research", cardId } as any), /source-gated and unavailable/);
  }
  for (const cardId of unsupportedMutations) {
    assert.throws(() => applyCommand(createGame(2), { type: "use-mutation", cardId } as any), /source-gated and unavailable/);
  }
});

test("Blonde Lure constrains the targeted monster's next move when the destination is reachable", () => {
  const state = createGame(2, 0);
  state.phase = "move";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: "monster-1" };
  state.players[0].researchCardIds = ["Blonde Lure"];
  state.monsters[1].location = K("seattle");

  const armed = applyCommand(state, { type: "use-research", cardId: "Blonde Lure", targetMonsterId: "monster-2", destination: K("denver") });
  assert.deepEqual(armed.state.activeResearchLure, { monsterId: "monster-2", destination: K("denver") });
  assert.deepEqual(armed.state.players[0].researchCardIds, []);
  assert.deepEqual(armed.state.decks.research.discard, ["Blonde Lure"]);
  const reloaded = migrateGameState(JSON.parse(JSON.stringify(armed.state)) as GameState);
  assert.deepEqual(reloaded.activeResearchLure, { monsterId: "monster-2", destination: K("denver") });
  assert.deepEqual(projectState(reloaded, "spectator").activeResearchLure, reloaded.activeResearchLure);

  const targetTurn = structuredClone(reloaded);
  targetTurn.currentPlayer = 1;
  targetTurn.pendingDecision = { type: "monster-movement", playerIndex: 1, pieceId: "monster-2" };
  assert.deepEqual(legalMonsterDestinations(targetTurn, "monster-2"), [K("denver")]);
  const moved = applyCommand(targetTurn, { type: "move", path: [K("seattle"), K("denver")] });
  assert.equal(moved.state.monsters[1].location, K("denver"));
  assert.equal(moved.state.activeResearchLure, undefined);
  assert.throws(() => applyCommand(targetTurn, { type: "move", path: [K("seattle"), K("san-francisco")] }), /not legal/);
});

test("Laser Fence either spends 2 Infamy or retreats and suppresses the new Encounter", () => {
  const paid = createGame(2, 0);
  paid.players[0].researchCardIds = ["Laser Fence"];
  paid.monsters[0].infamy = 2;
  paid.phase = "fight";
  paid.units[0].location = paid.monsters[0].location;
  paid.pendingBattles = [{ id: "laser-fence-paid", monsterId: "monster-1", location: paid.monsters[0].location as any, militaryUnitIds: [paid.units[0].id] }];
  paid.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "laser-fence-paid" };
  const paidResult = applyCommand(paid, { type: "use-research", cardId: "Laser Fence", battleId: "laser-fence-paid", choice: "infamy" });
  assert.equal(paidResult.state.monsters[0].infamy, 0);
  assert.equal(paidResult.state.pendingBattles.length, 1);
  assert.deepEqual(paidResult.state.players[0].researchCardIds, []);

  const retreated = createGame(2, 0);
  retreated.players[0].researchCardIds = ["Laser Fence"];
  retreated.phase = "fight";
  retreated.units[0].location = retreated.monsters[0].location;
  const destination = DEVELOPMENT_BOARD.edges.find((edge) => edge.from === retreated.monsters[0].location)?.to;
  assert.ok(destination);
  retreated.pendingBattles = [{ id: "laser-fence-retreat", monsterId: "monster-1", location: retreated.monsters[0].location as any, militaryUnitIds: [retreated.units[0].id] }];
  retreated.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "laser-fence-retreat" };
  const retreatResult = applyCommand(retreated, { type: "use-research", cardId: "Laser Fence", battleId: "laser-fence-retreat", choice: "retreat", destination });
  assert.equal(retreatResult.state.monsters[0].location, destination);
  assert.equal(retreatResult.state.pendingBattles.length, 0);
  assert.equal(retreatResult.state.encounterSuppressed, true);
  assert.equal(retreatResult.state.phase, "deploy");
});

test("card lifecycle primitives draw deterministically and exhaust without reshuffling", () => {
  let deck = createCardDeckState(["card-a", "card-b"]);
  const first = drawCard(deck);
  deck = first.state;
  assert.equal(first.cardId, "card-a");
  const second = drawCard(deck);
  deck = second.state;
  assert.equal(second.cardId, "card-b");
  assert.equal(deck.exhausted, true);
  deck = discardCard(deck, "card-a");
  assert.deepEqual(deck.discard, ["card-a"]);
  const exhausted = drawCard(deck);
  assert.equal(exhausted.cardId, undefined);
  assert.equal(exhausted.exhausted, true);
  assert.throws(() => discardCard(deck, "card-a"), /not an available card/);
});

test("card lifecycle operations update the authoritative match deck", () => {
  const state = createGame(2, 19);
  const drawn = drawCardFromGame(state, "research");
  assert.equal(drawn.cardId, state.decks.research.order[0]);
  assert.equal(drawn.state.decks.research.drawIndex, 1);
  const discarded = discardCardFromGame(drawn.state, "research", drawn.cardId!);
  assert.deepEqual(discarded.decks.research.discard, [drawn.cardId]);
  assert.deepEqual(state.decks.research.discard, []);
});

test("recorded seed determines the first player", () => {
  assert.equal(createGame(2, 0).currentPlayer, 0);
  assert.equal(createGame(2, 1).currentPlayer, 1);
  assert.equal(createGame(3, 2).currentPlayer, 2);
});

test("seeded replay property preserves inventory, phase progression, and identical state", () => {
  for (let seed = 0; seed < 32; seed += 1) {
    let first = createGame(2, seed);
    let replay = createGame(2, seed);
    assert.deepEqual(validateInventoryAccounting(first), []);
    assert.deepEqual(validateInventoryAccounting(replay), []);
    const applySame = (command: Parameters<typeof applyCommand>[1]) => {
      first = applyCommand(first, command).state;
      replay = applyCommand(replay, command).state;
      assert.deepEqual(validateInventoryAccounting(first), []);
      assert.deepEqual(first, replay, `seed ${seed} diverged after ${command.type}`);
    };
    applySame({ type: "pass-move" });
    for (let step = 0; first.phase !== "move" && step < 4; step += 1) {
      const command = first.phase === "deploy"
        ? { type: "pass-deploy" as const }
        : first.pendingDecision?.type === "encounter-choice"
          ? { type: "resolve-encounter" as const, choice: "health" as const }
          : { type: "advance" as const };
      applySame(command);
    }
    assert.equal(first.phase, "move");
    assert.equal(first.currentPlayer, (seed + 1) % 2);
  }
});

test("matches and seats have stable identities without wall-clock IDs", () => {
  const state = createGame(3, 42, "match-fixed");
  assert.equal(state.matchId, "match-fixed");
  assert.deepEqual(state.players, [
    { id: "player-1", seat: 0, mutationCardIds: [], researchCardIds: [] },
    { id: "player-2", seat: 1, mutationCardIds: [], researchCardIds: [] },
    { id: "player-3", seat: 2, mutationCardIds: [], researchCardIds: [] },
  ]);
  assert.equal(new Set(state.players.map((player) => player.id)).size, 3);
  assert.equal(createGame(3, 42).matchId, createGame(3, 42).matchId);
});

test("phase transitions expose and enforce the authoritative pending decision", () => {
  const initial = createGame(2);
  assert.deepEqual(initial.pendingDecision, {
    type: "monster-movement",
    playerIndex: initial.currentPlayer,
    pieceId: initial.monsters[initial.currentPlayer].id,
  });
  const moved = applyCommand(initial, { type: "move", path: ["los-angeles", "denver"] });
  assert.deepEqual(moved.state.pendingDecision, {
    type: "battle-resolution",
    playerIndex: moved.state.currentPlayer,
    battleId: moved.state.pendingBattles[0].id,
  });
  const fought = applyCommand(moved.state, { type: "resolve-fight" });
  assert.ok(fought.state.pendingDecision?.type === "attack-target" || fought.state.pendingDecision?.type === "retreat" || fought.state.pendingDecision?.type === "encounter-resolution");
  const afterRetreat = resolveDevelopmentFight(fought.state);
  const legacy = { ...afterRetreat, pendingDecision: { type: "deployment", playerIndex: 99 } } as any;
  const migrated = migrateGameState(legacy);
  assert.equal(migrated.pendingDecision?.type, migrated.phase === "encounter" ? "encounter-resolution" : "deployment");
  if (migrated.phase === "encounter") {
    const deployed = applyCommand(migrated, { type: "advance" });
    assert.equal(deployed.state.phase, "deploy");
    assert.equal(deployed.state.pendingDecision?.type, "deployment");
  }
});

test("table-driven command legality matrix rejects cross-phase and terminal actions", () => {
  const cases: Array<{ name: string; state: GameState; command: Parameters<typeof applyCommand>[1]; message: RegExp }> = [
    { name: "movement during Deploy", state: (() => { const state = createGame(2); state.phase = "deploy"; state.pendingDecision = { type: "deployment", playerIndex: 0 }; return state; })(), command: { type: "move", path: [K("los-angeles"), K("denver")] }, message: /phase|decision|legal/ },
    { name: "combat during Move", state: createGame(2), command: { type: "resolve-fight" }, message: /phase|decision|battle/ },
    { name: "Encounter during Move", state: createGame(2), command: { type: "resolve-encounter" }, message: /phase|decision|Encounter/ },
    { name: "deployment during Move", state: createGame(2), command: { type: "deploy" }, message: /phase|decision|Deploy/ },
    { name: "action after victory", state: (() => { const state = createGame(2); state.phase = "game-over"; state.winnerPlayer = 0; state.victoryType = "development-stomp-exhaustion"; return state; })(), command: { type: "advance" }, message: /match is complete/ },
  ];
  for (const entry of cases) assert.throws(() => applyCommand(entry.state, entry.command), entry.message, entry.name);
});

test("command receipts record structured actor, action, outcome, and detail", () => {
  const result = applyCommandEnvelope(createGame(2), { actionId: "event-1", actorId: "player-1", expectedRevision: 0, protocolVersion: 1, command: { type: "move", path: ["los-angeles", "denver"] } }, 0);
  const entry = result.state.eventLog.at(-1);
  assert.equal(entry?.actorId, "player-1");
  assert.equal(entry?.action, "monster.moved");
  assert.equal(entry?.outcome, "moved");
  assert.deepEqual(entry?.detail, { path: ["los-angeles", "denver"], destination: "denver" });
});

test("legacy schema-1 snapshots without eventLog remain command-compatible", () => {
  const legacy = createGame(2) as any;
  delete legacy.eventLog;
  const result = applyCommand(legacy, { type: "move", path: ["los-angeles", "denver"] });
  assert.equal(result.state.eventLog.length, 1);
});

test("schema-1 development positions migrate explicitly to hex keys and schema 2", () => {
  const legacy = createGame(2) as any;
  legacy.schemaVersion = 1;
  legacy.monsters[0].location = "los-angeles";
  legacy.units[0].location = "denver";
  legacy.stompedLocations = ["chicago"];
  const migrated = migrateGameState(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.monsters[0].location, K("los-angeles"));
  assert.equal(migrated.units[0].location, K("denver"));
  assert.deepEqual(migrated.stompedLocations, [K("chicago")]);
  assert.equal(migrated.nationalGuard.location, "record-tile");
  assert.equal(migrated.nationalGuard.control, "neutral");
});

test("older snapshots receive stable identity defaults during migration", () => {
  const legacy = createGame(2, 7) as any;
  delete legacy.matchId;
  delete legacy.players;
  delete legacy.removedUnitIds;
  delete legacy.decks.mutation.discard;
  delete legacy.decks.mutation.exhausted;
  legacy.schemaVersion = 1;
  const migrated = migrateGameState(legacy);
  assert.equal(migrated.matchId, "development-match-7");
  assert.deepEqual(migrated.players, [
    { id: "player-1", seat: 0, mutationCardIds: [], researchCardIds: [] },
    { id: "player-2", seat: 1, mutationCardIds: [], researchCardIds: [] },
  ]);
  assert.deepEqual(migrated.decks.mutation.discard, []);
  assert.equal(migrated.decks.mutation.exhausted, false);
  assert.deepEqual(migrated.removedUnitIds, []);
});

test("command envelopes reject malformed identity, revision, and protocol fields", () => {
  const state = createGame(2);
  assert.throws(() => applyCommandEnvelope(state, { actionId: "", actorId: "player-1", expectedRevision: 0, protocolVersion: 1, command: { type: "advance" } }, 0), /requires actionId/);
  assert.throws(() => applyCommandEnvelope(state, { actionId: "bad-revision", actorId: "player-1", expectedRevision: 0.5, protocolVersion: 1, command: { type: "advance" } }, 0), /requires actionId/);
  assert.throws(() => applyCommandEnvelope(state, { actionId: "bad-protocol", actorId: "player-1", expectedRevision: 0, protocolVersion: 99, command: { type: "advance" } }, 0), /Unsupported command protocol/);
});

test("deterministic envelope fuzzing rejects malformed and stale retries without mutating state", () => {
  const state = createGame(2, 123);
  const baseline = JSON.stringify(state);
  const malformed = [
    { actionId: "", actorId: "player-1", expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" } },
    { actionId: "missing-actor", actorId: "", expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" } },
    { actionId: "bad-revision", actorId: "player-1", expectedRevision: Number.NaN, protocolVersion: 1, command: { type: "pass-move" } },
    { actionId: "bad-protocol", actorId: "player-1", expectedRevision: 0, protocolVersion: 2, command: { type: "pass-move" } },
    { actionId: "unknown-command", actorId: "player-1", expectedRevision: 0, protocolVersion: 1, command: { type: "unknown" } },
    { actionId: "bad-path", actorId: "player-1", expectedRevision: 0, protocolVersion: 1, command: { type: "move", path: ["not-a-hex"] } },
  ];
  for (const envelope of malformed) {
    assert.throws(() => applyCommandEnvelope(state, envelope as any, 0));
    assert.equal(JSON.stringify(state), baseline, envelope.actionId || "empty action id");
  }
  const accepted = applyCommandEnvelope(state, {
    actionId: "retryable-pass",
    actorId: "player-1",
    expectedRevision: 0,
    protocolVersion: 1,
    command: { type: "pass-move" },
  }, 0);
  assert.equal(accepted.receipt.revision, 1);
  assert.throws(() => applyCommandEnvelope(accepted.state, {
    actionId: "retryable-pass",
    actorId: "player-1",
    expectedRevision: 0,
    protocolVersion: 1,
    command: { type: "pass-move" },
  }, 1), /Expected revision 0, current revision is 1/);
});

test("mutation and research decks contain all source-inventoried cards in seed-stable order", () => {
  const first = createGame(2, 99);
  const replay = createGame(2, 99);
  const different = createGame(2, 100);
  assert.equal(first.decks.mutation.order.length, 16);
  assert.equal(first.decks.research.order.length, 16);
  assert.deepEqual(first.decks, replay.decks);
  assert.notDeepEqual(first.decks, different.decks);
  assert.equal(new Set(first.decks.mutation.order).size, 16);
  assert.equal(new Set(first.decks.research.order).size, 16);
});

test("player and spectator projections redact deck order while internal state retains it", () => {
  const state = createGame(2, 99);
  state.players[0].researchCardIds = ["Guard Commander"];
  state.players[1].mutationCardIds = ["Rampage"];
  state.eventLog = [{ id: "private-card", action: "research.drawn", outcome: "drawn", detail: { cardId: "Guard Commander", attacks: [{ mutationCardId: "Rampage" }] } }];
  assert.equal(projectState(state, "internal").decks.mutation.order.length, 16);
  assert.deepEqual(projectState(state, "player").decks.mutation.order, []);
  assert.deepEqual(projectState(state, "spectator").decks.research.order, []);
  const own = projectState(state, "player", 0);
  assert.deepEqual(own.players[0].researchCardIds, ["Guard Commander"]);
  assert.deepEqual(own.players[1].mutationCardIds, []);
  assert.equal(JSON.stringify(own.eventLog).includes("Guard Commander"), false);
  assert.equal(JSON.stringify(own.eventLog).includes("Rampage"), false);
  assert.deepEqual(projectState(state, "spectator").players.map((player) => player.researchCardIds), [[], []]);
  const serialized = JSON.stringify(own);
  assert.equal(serialized.includes("x:") || serialized.includes("y:"), false);
});

test("new matches pin board and ruleset metadata and reject unsupported state schemas", () => {
  const state = createGame(2);
  assert.equal(state.boardId, "development-nine-location");
  assert.equal(state.boardVersion, 1);
  assert.equal(state.rulesetVersion, "prototype-0.1");
  assert.throws(() => applyCommand({ ...state, schemaVersion: 999 as 1 }, { type: "advance" }), /Unsupported match-state schema/);
});

test("provisional playtest factory pins the complete guessed board without promoting it", () => {
  const state = createProvisionalPlaytestGame(2, 7);
  assert.equal(state.boardId, "provisional-authoritative-honeycomb-board");
  assert.equal(boardForState(state).rulesetVersion, "playtest-0.2-promoted-guess");
  assert.equal(state.monsters.every((monster) => typeof monster.location === "string" && monster.location.includes(",")), true);
  assert.equal(state.units.every((unit) => unit.location === "record-tile"), true);
  assert.deepEqual(validateInventoryAccounting(state), []);
  assert.equal(validateBoardDefinition(boardForState(state), { production: true }).length > 0, true);
});

test("provisional board gameplay coverage uses its own movement and encounter features", () => {
  const state = createProvisionalPlaytestGame(2, 11);
  const board = boardForState(state);
  const start = state.monsters[state.currentPlayer].location as `${number},${number}`;
  const adjacent = board.edges.find((edge) => edge.from === start)?.to;
  assert.ok(adjacent);
  assert.equal(legalMonsterDestinations(state).includes(adjacent), true);

  const cityKey = Object.values(board.hexes).find((hex) => hex.features.some((feature) => feature.kind === "city"))!.key;
  const cityState = structuredClone(state);
  cityState.phase = "encounter";
  cityState.monsters[cityState.currentPlayer].location = cityKey;
  cityState.pendingDecision = { type: "encounter-resolution", playerIndex: cityState.currentPlayer, location: cityKey };
  const cityResult = resolveEncounterResult(cityState, "health");
  assert.equal(cityResult.effects.some((effect) => effect.type === "health"), true);
  assert.equal(cityResult.state.stompedLocations.includes(cityKey), true);

  const baseKey = Object.values(board.hexes).find((hex) => hex.features.some((feature) => feature.kind === "military-base"))!.key;
  const baseState = structuredClone(state);
  baseState.phase = "encounter";
  baseState.monsters[baseState.currentPlayer].location = baseKey;
  baseState.pendingDecision = { type: "encounter-resolution", playerIndex: baseState.currentPlayer, location: baseKey };
  const baseResult = resolveEncounterResult(baseState, "health");
  assert.equal(baseResult.effects.some((effect) => effect.type === "infamy"), true);
  assert.equal(baseResult.state.stompedLocations.includes(baseKey), true);

  const skippedState = structuredClone(cityState);
  skippedState.stompedLocations = [cityKey];
  const markersBefore = skippedState.stompMarkers;
  const skippedResult = resolveEncounterResult(skippedState, "health");
  assert.deepEqual(skippedResult.effects, []);
  assert.equal(skippedResult.state.stompMarkers, markersBefore);
});

test("board-dependent engine helpers resolve the pinned board or fail closed", () => {
  const state = createGame(2);
  assert.equal(boardForState(state), DEVELOPMENT_BOARD);
  assert.throws(() => boardForState({ ...state, boardContentHash: "fnv1a:not-the-pinned-board" }), /unavailable/);
  assert.throws(() => boardForState({ ...state, boardVersion: 2 }), /unavailable/);
});

test("full-board encounter resolution never inherits development features", () => {
  const state = createGame(2);
  state.boardId = FULL_HONEYCOMB_BOARD.id;
  state.boardVersion = FULL_HONEYCOMB_BOARD.version;
  state.boardContentHash = FULL_HONEYCOMB_BOARD.contentHash;
  state.phase = "encounter";
  state.monsters[0].location = "0,0";
  state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: "0,0" };
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.deepEqual(result.eventPayload.effects, []);
  assert.equal(result.state.stompedLocations.length, 0);
  assert.equal(result.state.phase, "deploy");
});

test("movement validates every path edge and the complete path length", () => {
  const state = { ...createGame(2), units: createGame(2).units.map((unit) => ({ ...unit, location: "record-tile" as const })) };
  const twoStep = applyCommand(state, { type: "move", path: ["los-angeles", "denver", "chicago"] });
  assert.equal(twoStep.state.monsters[0].location, K("chicago"));
  assert.deepEqual(twoStep.state.pendingBattles, []);
  assert.throws(() => applyCommand(createGame(2), { type: "move", path: ["los-angeles", "denver", "new-york"] }));
  assert.throws(() => applyCommand(createGame(2), { type: "move", path: ["los-angeles", "denver", "chicago", "new-york", "miami"] }));
});

test("authoritative movement selectors expose reachable destinations and paths", () => {
  const state = createGame(2);
  const paths = legalMonsterPaths(state);
  assert.ok(paths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}`));
  assert.equal(paths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}>${K("chicago")}`), false);
  assert.equal(paths.some((path) => path.at(-1) === K("seattle")), false);
  assert.ok(legalMonsterDestinations(state).includes(K("denver")));
  assert.equal(legalMonsterDestinations({ ...state, phase: "fight" }).length, 0);
});

test("movement modes enforce canonical water classes and allow fly passage", () => {
  const lakeKey = K("denver");
  const syntheticBoard = {
    ...DEVELOPMENT_BOARD,
    hexes: { ...DEVELOPMENT_BOARD.hexes, [lakeKey]: { ...DEVELOPMENT_BOARD.hexes[lakeKey], waterClass: "lake" as const } },
  };
  assert.equal(movementPathAllowed(syntheticBoard, [K("los-angeles"), lakeKey], "land-only"), false);
  assert.equal(movementPathAllowed(syntheticBoard, [K("los-angeles"), lakeKey], "land-lake"), true);
  assert.equal(movementPathAllowed(syntheticBoard, [K("los-angeles"), lakeKey], "fly"), true);
  assert.equal(movementPathAllowed(syntheticBoard, [K("los-angeles"), lakeKey], "sea-seacoast-only"), false);
});

test("Fly pieces pass through occupants while preserving pre-Challenge monster finish restrictions", () => {
  const monsterState = createGame(2);
  monsterState.monsters[0].movement = "fly";
  monsterState.monsters[0].location = K("los-angeles");
  monsterState.monsters[1].location = K("denver");
  const monsterPaths = legalMonsterPaths(monsterState, monsterState.monsters[0].id);
  assert.equal(monsterPaths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}`), false);
  assert.equal(monsterPaths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}>${K("chicago")}`), true);
  const movedMonster = applyCommand(monsterState, { type: "move", path: ["los-angeles", "denver", "chicago"] });
  assert.equal(movedMonster.state.monsters[0].location, K("chicago"));

  const unitState = createGame(2);
  const unit = unitState.units[0];
  unit.location = K("los-angeles");
  unit.movement = "fly";
  unitState.monsters[1].location = K("denver");
  const unitPaths = legalUnitPaths(unitState, unit.id);
  assert.equal(unitPaths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}>${K("chicago")}`), true);
  const movedUnit = applyCommand(unitState, { type: "move-unit", unitId: unit.id, path: ["los-angeles", "denver", "chicago"] });
  assert.equal(movedUnit.state.units.find((candidate) => candidate.id === unit.id)?.location, K("chicago"));
});

test("movement modes enforce authored water barriers and reject unresolved edges", () => {
  const lakeEdgeBoard = {
    ...DEVELOPMENT_BOARD,
    edges: DEVELOPMENT_BOARD.edges.map((edge) => edge.from === K("los-angeles") && edge.to === K("denver") ? { ...edge, barrier: "lake" as const } : edge),
  };
  assert.equal(movementPathAllowed(lakeEdgeBoard, [K("los-angeles"), K("denver")], "land-only"), false);
  assert.equal(movementPathAllowed(lakeEdgeBoard, [K("los-angeles"), K("denver")], "land-lake"), true);
  assert.equal(movementPathAllowed(lakeEdgeBoard, [K("los-angeles"), K("denver")], "land-lake-sea"), true);
  const seaEdgeBoard = {
    ...DEVELOPMENT_BOARD,
    hexes: {
      ...DEVELOPMENT_BOARD.hexes,
      [K("los-angeles")]: { ...DEVELOPMENT_BOARD.hexes[K("los-angeles")], waterClass: "sea" as const },
      [K("denver")]: { ...DEVELOPMENT_BOARD.hexes[K("denver")], waterClass: "sea" as const },
    },
    edges: DEVELOPMENT_BOARD.edges.map((edge) => edge.from === K("los-angeles") && edge.to === K("denver") ? { ...edge, barrier: "sea" as const } : edge),
  };
  assert.equal(movementPathAllowed(seaEdgeBoard, [K("los-angeles"), K("denver")], "sea-seacoast-only"), true);
  assert.equal(movementPathAllowed(seaEdgeBoard, [K("los-angeles"), K("denver")], "land-lake"), false);
  const unresolvedBoard = {
    ...DEVELOPMENT_BOARD,
    edges: DEVELOPMENT_BOARD.edges.map((edge) => edge.from === K("los-angeles") && edge.to === K("denver") ? { ...edge, barrier: "unresolved" as const } : edge),
  };
  assert.equal(movementPathAllowed(unresolvedBoard, [K("los-angeles"), K("denver")], "fly"), false);
  assert.equal(movementPathAllowed(DEVELOPMENT_BOARD, ["hollywood" as never, K("denver")], "fly"), false);
});

test("movement matrix covers every implemented movement mode, water class, barrier, and off-board state", () => {
  const modes = [
    ["land-only", { land: true, lake: false, sea: false, seacoast: true, unresolved: false }],
    ["land-lake", { land: true, lake: true, sea: false, seacoast: true, unresolved: false }],
    ["land-lake-sea", { land: true, lake: true, sea: true, seacoast: true, unresolved: false }],
    ["fly", { land: true, lake: true, sea: true, seacoast: true, unresolved: false }],
    ["sea-seacoast-only", { land: false, lake: false, sea: true, seacoast: true, unresolved: false }],
    ["sea-seacoast-or-fly", { land: false, lake: false, sea: true, seacoast: true, unresolved: false }],
    ["stationary", { land: false, lake: false, sea: false, seacoast: false, unresolved: false }],
  ] as const;
  for (const [movement, expected] of modes) {
    for (const waterClass of ["land", "lake", "sea", "seacoast", "unresolved"] as const) {
      const board = {
        ...DEVELOPMENT_BOARD,
        hexes: {
          ...DEVELOPMENT_BOARD.hexes,
          [K("los-angeles")]: { ...DEVELOPMENT_BOARD.hexes[K("los-angeles")], waterClass },
          [K("denver")]: { ...DEVELOPMENT_BOARD.hexes[K("denver")], waterClass },
        },
      };
      assert.equal(movementPathAllowed(board, [K("los-angeles"), K("denver")], movement), expected[waterClass], `${movement} -> ${waterClass}`);
    }
  }
  const barriers = [
    ["none", { "land-only": true, "land-lake": true, "land-lake-sea": true, fly: true, "sea-seacoast-only": false, "sea-seacoast-or-fly": false, stationary: false }],
    ["lake", { "land-only": false, "land-lake": true, "land-lake-sea": true, fly: true, "sea-seacoast-only": false, "sea-seacoast-or-fly": false, stationary: false }],
    ["sea", { "land-only": false, "land-lake": false, "land-lake-sea": true, fly: true, "sea-seacoast-only": false, "sea-seacoast-or-fly": false, stationary: false }],
    ["unresolved", { "land-only": false, "land-lake": false, "land-lake-sea": false, fly: false, "sea-seacoast-only": false, "sea-seacoast-or-fly": false, stationary: false }],
  ] as const;
  for (const [barrier, expected] of barriers) {
    const board = {
      ...DEVELOPMENT_BOARD,
      edges: DEVELOPMENT_BOARD.edges.map((edge) => edge.from === K("los-angeles") && edge.to === K("denver") ? { ...edge, barrier } : edge),
    };
    for (const [movement, allowed] of modes) assert.equal(movementPathAllowed(board, [K("los-angeles"), K("denver")], movement), expected[movement], `${barrier} -> ${movement}`);
  }
  for (const [barrier, expected] of barriers) {
    const board = {
      ...DEVELOPMENT_BOARD,
      hexes: {
        ...DEVELOPMENT_BOARD.hexes,
        [K("los-angeles")]: { ...DEVELOPMENT_BOARD.hexes[K("los-angeles")], waterClass: "sea" as const },
        [K("denver")]: { ...DEVELOPMENT_BOARD.hexes[K("denver")], waterClass: "sea" as const },
      },
      edges: DEVELOPMENT_BOARD.edges.map((edge) => edge.from === K("los-angeles") && edge.to === K("denver") ? { ...edge, barrier } : edge),
    };
    const expectedSea = barrier === "none" || barrier === "sea";
    assert.equal(movementPathAllowed(board, [K("los-angeles"), K("denver")], "sea-seacoast-only"), expectedSea, `${barrier} -> sea-seacoast-only`);
    assert.equal(movementPathAllowed(board, [K("los-angeles"), K("denver")], "sea-seacoast-or-fly"), expectedSea, `${barrier} -> sea-seacoast-or-fly`);
  }
  const offBoard = createGame(2);
  offBoard.monsters[0].location = "hollywood";
  offBoard.units[0].location = "record-tile";
  assert.deepEqual(legalMonsterPaths(offBoard), []);
  assert.deepEqual(legalUnitPaths(offBoard, offBoard.units[0].id), []);

  const challengePhase = createGame(2);
  challengePhase.phase = "challenge";
  challengePhase.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: challengePhase.monsters[0].id,
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  assert.deepEqual(legalMonsterPaths(challengePhase), []);
  assert.deepEqual(legalUnitPaths(challengePhase, challengePhase.units[0].id), []);

  const flyingChallenge = createGame(2);
  flyingChallenge.monsters[0].movement = "fly";
  flyingChallenge.monsters[0].location = K("los-angeles");
  flyingChallenge.monsters[1].location = K("denver");
  flyingChallenge.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: flyingChallenge.monsters[0].id,
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  const challengeFinish = legalMonsterPaths(flyingChallenge).some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}`);
  assert.equal(challengeFinish, true);
});

test("movement stops at military occupancy and rejects monster occupancy", () => {
  const state = createGame(2);
  assert.throws(() => applyCommand(state, { type: "move", path: ["los-angeles", "denver", "seattle"] }), /not legal/);
  const stopped = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] });
  assert.equal(stopped.state.pendingBattles.length, 1);
  assert.equal(legalMonsterPaths(state).some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}>${K("chicago")}`), false);
});

test("Kinda Friendly passes through and returns National Guard without creating a battle", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Kinda Friendly"];
  state.monsters[1].location = "record-tile";
  state.units.forEach((unit) => { unit.location = "record-tile"; });
  const guard = {
    id: "national-guard-tank-1",
    branch: "National Guard" as const,
    unitTypeId: "national-guard-tank",
    move: 3,
    movement: "land-only" as const,
    attacks: 1,
    damage: 1,
    health: 1,
    defense: 4,
    location: K("denver") as any,
  };
  state.units.push(guard);
  const moved = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] });
  assert.equal(moved.state.phase, "encounter");
  assert.deepEqual(moved.state.pendingBattles, []);
  assert.equal(moved.state.units.find((unit) => unit.id === guard.id)?.location, "record-tile");
  assert.match(moved.state.log.at(-1) ?? "", /Kinda Friendly returned National Guard/);
});

test("Fusion Cells adds one Move to the cardholder's unit selectors and commands", () => {
  const base = createGame(2);
  base.monsters[1].location = "record-tile";
  base.units.forEach((unit) => { unit.location = "record-tile"; });
  const unitId = base.units[0].id;
  base.units[0].location = K("los-angeles");
  const baseMaxMove = Math.max(...legalUnitPaths(base, unitId).map((path) => path.length - 1));

  const fused = structuredClone(base);
  fused.players[0].researchCardIds = ["Fusion Cells"];
  const fusedPaths = legalUnitPaths(fused, unitId);
  const fusedMaxMove = Math.max(...fusedPaths.map((path) => path.length - 1));
  assert.equal(fusedMaxMove, baseMaxMove + 1);
  const longestPath = fusedPaths.find((path) => path.length - 1 === fusedMaxMove)!;
  const moved = applyCommand(fused, { type: "move-unit", unitId, path: longestPath });
  assert.equal(moved.state.units.find((unit) => unit.id === unitId)?.location, longestPath.at(-1));
});

test("continuous Research effects compose through the shared projection", () => {
  const state = createGame(2, 0);
  state.players[0].researchCardIds = ["Fusion Cells", "2nd Generation", "Guard Commander"];
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  state.deploymentsThisTurn = 2;
  state.deploymentDestinations = [K("chicago")];

  const result = applyCommand(state, { type: "deploy", destination: K("denver") });
  assert.equal(result.state.deploymentsThisTurn, 3);

  const guard = {
    ...result.state.units[0],
    id: "research-projection-guard",
    branch: "National Guard" as const,
    unitTypeId: "national-guard-tank",
    ownerPlayer: undefined,
    location: K("denver"),
    move: 3,
    movement: "land-only" as const,
  };
  result.state.units.push(guard);
  result.state.phase = "move";
  result.state.currentPlayer = 0;
  assert.ok(legalUnitPaths(result.state, guard.id).some((path) => path.join(">") === `${K("denver")}>${K("chicago")}`));
});

test("occupancy is derived from positions and supports shared spaces", () => {
  const state = createGame(2);
  state.units[0].location = state.monsters[0].location;
  const occupants = occupantsAt(state, state.monsters[0].location);
  assert.equal(occupants.monsters.length, 1);
  assert.equal(occupants.units.length, 1);
  assert.deepEqual(occupantsAt(state, "__empty__"), { monsters: [], units: [] });
});

test("pass-move explicitly resolves the monster decision while preserving unmoved units", () => {
  const state = createGame(2);
  const passed = applyCommand(state, { type: "pass-move" });
  assert.equal(passed.state.phase, "encounter");
  assert.deepEqual(passed.state.movedPieceIds, [state.monsters[state.currentPlayer].id]);
  assert.deepEqual(passed.state.units.map((unit) => unit.location), state.units.map((unit) => unit.location));
  assert.equal(passed.eventType, "monster.stayed");
});

test("the active player can move multiple owned branch units independently during Move", () => {
  const state = createGame(2);
  state.units.forEach((unit) => { unit.location = "record-tile"; });
  const ownedUnits = state.units.filter((unit) => unit.ownerPlayer === state.currentPlayer).slice(0, 2);
  assert.equal(ownedUnits.length, 2);
  ownedUnits[0]!.location = K("los-angeles");
  ownedUnits[1]!.location = K("san-francisco");
  const firstPath = legalUnitPaths(state, ownedUnits[0]!.id).find((path) => path.length === 2)!;
  const secondPath = legalUnitPaths(state, ownedUnits[1]!.id).find((path) => path.length === 2)!;
  assert.ok(firstPath);
  assert.ok(secondPath);
  const first = applyCommand(state, { type: "move-unit", unitId: ownedUnits[0]!.id, path: firstPath });
  const second = applyCommand(first.state, { type: "move-unit", unitId: ownedUnits[1]!.id, path: secondPath });
  assert.equal(second.state.units.find((unit) => unit.id === ownedUnits[0]!.id)?.location, firstPath.at(-1));
  assert.equal(second.state.units.find((unit) => unit.id === ownedUnits[1]!.id)?.location, secondPath.at(-1));
  assert.deepEqual(second.state.movedPieceIds, [ownedUnits[0]!.id, ownedUnits[1]!.id]);
  assert.throws(() => applyCommand(second.state, { type: "move-unit", unitId: state.units.find((unit) => unit.ownerPlayer !== state.currentPlayer)!.id, path: [K("los-angeles"), K("denver")] }), /not legal/);
});

test("pass-deploy advances the turn without inventing a deployment", () => {
  const encounter = applyCommand(createGame(2), { type: "pass-move" }).state;
  const deployPhase = applyCommand(encounter, { type: "resolve-encounter", choice: "health" }).state;
  const beforeUnits = deployPhase.units.length;
  const passed = applyCommand(deployPhase, { type: "pass-deploy" });
  assert.equal(passed.state.phase, "move");
  assert.equal(passed.state.currentPlayer, (deployPhase.currentPlayer + 1) % 2);
  assert.equal(passed.state.units.length, beforeUnits);
  assert.equal(passed.eventType, "turn.passed");
});

test("Deploy can draw one deterministic Military Research card instead of deploying", () => {
  const state = createGame(2, 17);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: state.currentPlayer };
  const expectedCard = state.decks.research.order[0];
  const unitLocations = state.units.map((unit) => unit.location);
  const result = applyCommand(state, { type: "draw-research" });
  assert.equal(result.eventType, "research.drawn");
  assert.equal(result.eventPayload.cardId, expectedCard);
  assert.deepEqual(result.state.players[0].researchCardIds, state.currentPlayer === 0 ? [expectedCard] : []);
  assert.equal(result.state.players[1].researchCardIds.length, state.currentPlayer === 1 ? 1 : 0);
  assert.equal(result.state.decks.research.drawIndex, 1);
  assert.equal(result.state.phase, "move");
  assert.equal(result.state.currentPlayer, (state.currentPlayer + 1) % 2);
  assert.equal(result.state.deploymentsThisTurn, 0);
  assert.deepEqual(result.state.units.map((unit) => unit.location), unitLocations);
});

test("giant Research cards place a sourced giant on the active branch base without consuming Deploy", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  state.decks.research = { order: ["Mecha-Monster"], drawIndex: 0, discard: [], exhausted: false };
  const result = applyCommand(state, { type: "draw-research" });
  const giant = result.state.units.find((unit) => unit.unitTypeId === "mecha-monster");
  assert.equal(result.eventType, "research.drawn");
  assert.equal(giant?.branch, "Giant");
  assert.equal(giant?.ownerPlayer, 0);
  assert.equal(giant?.location, K("denver"));
  assert.equal(giant?.health, 6);
  assert.equal(result.eventPayload.unitId, giant?.id);
  assert.equal(result.eventPayload.destination, K("denver"));
  assert.equal(result.state.deploymentsThisTurn, 0);
  assert.deepEqual(result.state.players[0]?.researchCardIds, []);
  assert.deepEqual(result.state.decks.research.discard, ["Mecha-Monster"]);
});

test("giant units take Health damage and are permanently removed at zero", () => {
  const state = createGame(2, 0);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  state.decks.research = { order: ["Mecha-Monster"], drawIndex: 0, discard: [], exhausted: false };
  const placed = applyCommand(state, { type: "draw-research" }).state;
  const giant = placed.units.find((unit) => unit.unitTypeId === "mecha-monster")!;
  const monster = placed.monsters[0]!;
  monster.location = K("denver");
  monster.attacks = 1;
  monster.damage = 1;
  monster.defense = 99;
  giant.health = 1;
  placed.phase = "fight";
  placed.pendingBattles = [{ id: "giant-battle", monsterId: monster.id, location: K("denver"), militaryUnitIds: [giant.id] }];
  placed.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "giant-battle" };
  const resolved = applyCommand(placed, { type: "resolve-fight", battleId: "giant-battle" });
  const removed = resolved.state.units.find((unit) => unit.id === giant.id)!;
  assert.equal(removed.location, "permanently-removed");
  assert.equal(removed.health, 0);
  assert.deepEqual(resolved.state.removedUnitIds, [giant.id]);
});

test("X-Fighters draw creates two persistent deployable pieces and branch deployment consumes one allowance", () => {
  const state = createGame(2, 3);
  state.currentPlayer = 0;
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  state.decks.research = { order: ["X-Fighters"], drawIndex: 0, discard: [], exhausted: false };
  const drawn = applyCommand(state, { type: "draw-research" });
  const fighters = drawn.state.units.filter((unit) => unit.unitTypeId === "x-fighter");
  assert.equal(fighters.length, 2);
  assert.equal(drawn.state.players[0]?.researchCardIds.includes("X-Fighters"), true);
  assert.equal(drawn.state.phase, "move");
  drawn.state.phase = "deploy";
  drawn.state.currentPlayer = 0;
  drawn.state.pendingDecision = { type: "deployment", playerIndex: 0 };
  const deployed = applyCommand(drawn.state, { type: "deploy", unitId: fighters[0]!.id, destination: K("denver") });
  const deployedFighter = deployed.state.units.find((unit) => unit.id === fighters[0]!.id)!;
  assert.equal(deployedFighter.location, K("denver"));
  assert.equal(deployed.state.deploymentsThisTurn, 1);
  assert.equal(deployed.state.players[0]?.researchCardIds.includes("X-Fighters"), true);
});

test("exhausted Military Research cannot consume Deploy or mutate the match", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: state.currentPlayer };
  state.decks.research = { ...state.decks.research, order: [], drawIndex: 0, exhausted: true };
  const before = JSON.stringify(state);
  assert.throws(() => applyCommand(state, { type: "draw-research" }), /Research deck is exhausted/);
  assert.equal(JSON.stringify(state), before);
});

test("Deploy consumes a typed record unit, enforces destination uniqueness, and requires an explicit pass", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  const sourceUnit = state.units.find((unit) => unit.branch === "Army" && unit.location === "record-tile");
  assert.ok(sourceUnit);
  const deployed = applyCommand(state, { type: "deploy" });
  assert.equal(deployed.eventType, "unit.deployed");
  assert.equal(deployed.state.phase, "deploy");
  assert.equal(deployed.state.deploymentsThisTurn, 1);
  assert.equal(deployed.state.units.find((unit) => unit.id === sourceUnit.id)?.location, K("denver"));
  assert.throws(() => applyCommand(deployed.state, { type: "deploy" }), /one newly deployed unit/);
  const passed = applyCommand(deployed.state, { type: "pass-deploy" });
  assert.equal(passed.state.phase, "move");
  assert.equal(passed.state.deploymentsThisTurn, 0);
  assert.deepEqual(sourceUnitInventoryErrors(passed.state.units), []);
});

test("2nd Generation grants one additional deployment slot", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  state.players[0].researchCardIds = ["2nd Generation"];
  state.deploymentsThisTurn = 2;
  state.deploymentDestinations = [K("chicago")];
  const result = applyCommand(state, { type: "deploy", destination: K("denver") });
  assert.equal(result.eventType, "unit.deployed");
  assert.equal(result.state.deploymentsThisTurn, 3);
});

test("normal deployment rejects an already stomped branch base", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.currentPlayer = 0;
  state.stompedLocations = [K("denver")];
  state.pendingDecision = { type: "deployment", playerIndex: 0 };
  assert.throws(() => applyCommand(state, { type: "deploy" }), /base is stomped/);
});

test("deployment matrix covers supported player counts, every branch, inventory, collision, and pass boundaries", () => {
  for (const playerCount of [2, 3, 4] as const) {
    const state = createGame(playerCount, 31 + playerCount);
    assert.equal(state.players.length, playerCount);
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const branch = state.setupAssignments?.[playerIndex]?.branch
        ?? (["Army", "Navy", "Air Force", "Marines"] as const)[playerIndex % 4];
      state.currentPlayer = playerIndex;
      state.phase = "deploy";
      state.pendingDecision = { type: "deployment", playerIndex };
      const sourceUnit = state.units.find((unit) => unit.branch === branch && unit.location === "record-tile");
      assert.ok(sourceUnit, `${branch} should have a deployable record unit`);
      const hasVerifiedBase = Object.values(DEVELOPMENT_BOARD.hexes).some((hex) => hex.features.some((feature) => feature.kind === "military-base" && feature.branch === branch));
      if (!hasVerifiedBase) {
        assert.throws(() => applyCommand(state, { type: "deploy" }), /No verified .* base exists/);
        continue;
      }
      const deployed = applyCommand(state, { type: "deploy" });
      assert.equal(deployed.eventType, "unit.deployed");
      assert.equal(deployed.eventPayload.branch, branch);
      assert.equal(deployed.state.deploymentsThisTurn, 1);
      assert.equal(deployed.state.units.find((unit) => unit.id === sourceUnit.id)?.ownerPlayer, playerIndex);
      assert.deepEqual(sourceUnitInventoryErrors(deployed.state.units), []);
      assert.throws(() => applyCommand(deployed.state, { type: "deploy" }), /one newly deployed unit/);
      const passed = applyCommand(deployed.state, { type: "pass-deploy" });
      assert.equal(passed.eventType, "turn.passed");
      assert.equal(passed.state.phase, "move");
      assert.equal(passed.state.deploymentsThisTurn, 0);
      assert.deepEqual(sourceUnitInventoryErrors(passed.state.units), []);
    }
  }

  const exhausted = createGame(2);
  exhausted.phase = "deploy";
  exhausted.currentPlayer = 0;
  exhausted.pendingDecision = { type: "deployment", playerIndex: 0 };
  for (const unit of exhausted.units.filter((candidate) => candidate.branch === "Army")) {
    unit.location = "permanently-removed";
    exhausted.removedUnitIds.push(unit.id);
  }
  assert.throws(() => applyCommand(exhausted, { type: "deploy" }), /No Army unit remains/);
  assert.deepEqual(sourceUnitInventoryErrors(exhausted.units), []);

  const collision = createGame(2);
  collision.phase = "deploy";
  collision.currentPlayer = 0;
  collision.pendingDecision = { type: "deployment", playerIndex: 0 };
  const first = applyCommand(collision, { type: "deploy" });
  assert.throws(() => applyCommand(first.state, { type: "deploy", unitId: "0-1" }), /one newly deployed unit/);
  assert.deepEqual(sourceUnitInventoryErrors(first.state.units), []);
});

test("military movement has authoritative paths, shared-unit passage, and a movement ledger", () => {
  const state = createGame(2);
  const paths = legalUnitPaths(state, "0-0");
  assert.ok(paths.some((path) => path.join(">") === `${K("denver")}>${K("chicago")}`));
  const moved = applyCommand(state, { type: "move-unit", unitId: "0-0", path: ["denver", "chicago"] });
  assert.equal(moved.state.units.find((unit) => unit.id === "0-0")?.location, K("chicago"));
  assert.deepEqual(moved.state.movedPieceIds, ["0-0"]);
  assert.equal(moved.state.phase, "move");
  assert.throws(() => applyCommand(moved.state, { type: "move-unit", unitId: "0-0", path: ["chicago", "new-york"] }), /not legal/);
  const battle = applyCommand(createGame(2), { type: "move-unit", unitId: "0-0", path: ["denver", "los-angeles"] });
  assert.equal(battle.state.phase, "move");
  assert.deepEqual(battle.state.pendingBattles[0]?.militaryUnitIds, ["0-0"]);
  const resolvedMove = applyCommand(battle.state, { type: "pass-move" });
  assert.equal(resolvedMove.state.phase, "fight");
});

test("Move collects multiple compulsory battles and Fight resolves the chosen battle first", () => {
  const state = createGame(2, 0);
  state.monsters[1].location = K("new-york");
  state.units.find((unit) => unit.id === "2-0")!.location = K("chicago");
  const first = applyCommand(state, { type: "move-unit", unitId: "0-0", path: ["denver", "los-angeles"] });
  const second = applyCommand(first.state, { type: "move-unit", unitId: "2-0", path: ["chicago", "new-york"] });
  assert.equal(second.state.phase, "move");
  assert.equal(second.state.pendingBattles.length, 2);
  const firstBattleId = second.state.pendingBattles[0].id;
  const secondBattleId = second.state.pendingBattles[1].id;
  const fight = applyCommand(second.state, { type: "pass-move" });
  assert.equal(fight.state.pendingDecision?.type, "battle-resolution");
  const chosen = applyCommand(fight.state, { type: "resolve-fight", battleId: secondBattleId });
  assert.equal(chosen.eventPayload.battleId, secondBattleId);
  assert.deepEqual(chosen.state.pendingBattles.map((battle) => battle.id), [firstBattleId]);
  assert.equal(chosen.state.phase, "fight");
  const final = resolveDevelopmentFight(chosen.state);
  assert.equal(final.pendingBattles.length, 0);
  assert.ok(final.phase === "encounter" || final.phase === "deploy");
});

test("legacy snapshots without a movement ledger remain movement-selector compatible", () => {
  const state = createGame(2);
  const legacy = { ...state } as GameState & { movedPieceIds?: string[] };
  delete legacy.movedPieceIds;
  assert.ok(legalUnitPaths(legacy, "0-0").some((path) => path.at(-1) === K("chicago")));
  const moved = applyCommand(legacy, { type: "move-unit", unitId: "0-0", path: ["denver", "chicago"] });
  assert.deepEqual(moved.state.movedPieceIds, ["0-0"]);
});

test("movement creates and fight resolution consumes a compulsory pending battle", () => {
  const moved = applyCommand(createGame(2, 6), { type: "move", path: ["los-angeles", "denver"] }).state;
  assert.equal(moved.pendingBattles.length, 1);
  assert.equal(moved.pendingBattles[0].militaryUnitIds.length, 2);
  const resolved = resolveDevelopmentFight(moved);
  assert.deepEqual(resolved.pendingBattles, []);
  assert.ok(resolved.phase === "encounter" || resolved.phase === "deploy");
});

test("multi-target battle requires and persists an explicit first target", () => {
  const moved = applyCommand(createGame(2, 6), { type: "move", path: ["los-angeles", "denver"] }).state;
  assert.equal(moved.pendingBattles[0].militaryUnitIds.length, 2);
  moved.monsters[0].health = 40;
  for (const unit of moved.units.filter((candidate) => moved.pendingBattles[0].militaryUnitIds.includes(candidate.id))) unit.defense = 99;
  const requested = applyCommand(moved, { type: "resolve-fight", battleId: moved.pendingBattles[0].id });
  assert.equal(requested.eventType, "battle.target-required");
  assert.equal(requested.state.pendingDecision?.type, "attack-target");
  assert.equal(requested.state.rng.cursor, moved.rng.cursor);
  const reloaded = migrateGameState(JSON.parse(JSON.stringify(requested.state)) as GameState);
  assert.deepEqual(reloaded.pendingAttackTarget, requested.state.pendingAttackTarget);
  assert.deepEqual(reloaded.pendingDecision, requested.state.pendingDecision);
  const targetId = reloaded.pendingAttackTarget!.targetIds[1];
  const firstAttack = applyCommand(reloaded, {
    type: "resolve-fight",
    battleId: reloaded.pendingAttackTarget!.battleId,
    targetUnitId: targetId,
  });
  assert.equal(firstAttack.eventType, "battle.target-required");
  assert.equal(firstAttack.state.pendingCombat?.monsterAttackIndex, 1);
  const continued = migrateGameState(JSON.parse(JSON.stringify(firstAttack.state)) as GameState);
  assert.deepEqual(continued.pendingCombat, firstAttack.state.pendingCombat);
  let resolved = firstAttack;
  while (resolved.state.pendingDecision?.type === "attack-target") {
    const decision = resolved.state.pendingDecision;
    resolved = applyCommand(resolved.state, {
      type: "resolve-fight",
      battleId: decision.battleId,
      targetUnitId: decision.targetIds[0],
    });
  }
  assert.equal(resolved.eventType, "fight.resolved");
  const monsterAttack = (resolved.eventPayload.attacks as Array<{ attackerId: string; targetId: string }>).find(
    (attack) => attack.attackerId === reloaded.pendingAttackTarget!.attackerId && attack.targetId === targetId,
  );
  assert.equal(monsterAttack?.targetId, targetId);
});

test("multi-target attack sequencing preserves an explicit Infamy spend", () => {
  const state = createGame(2, 14);
  state.currentPlayer = 0;
  state.monsters[0].health = 40;
  state.monsters[0].infamy = 1;
  state.units[0].location = state.monsters[0].location;
  state.units[2].location = state.monsters[0].location;
  state.units[0].defense = 99;
  state.units[2].defense = 99;
  state.phase = "fight";
  state.pendingBattles = [{ id: "infamy-sequence", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[0].id, state.units[2].id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "infamy-sequence" };
  const requested = applyCommand(state, { type: "resolve-fight", battleId: "infamy-sequence", spendInfamy: 1 });
  assert.equal(requested.state.pendingAttackTarget?.spendInfamy, 1);
  const first = applyCommand(requested.state, { type: "resolve-fight", battleId: "infamy-sequence", targetUnitId: requested.state.pendingAttackTarget!.targetIds[0] });
  assert.equal(first.state.monsters[0].infamy, 0);
  assert.equal(first.state.pendingCombat?.spendInfamy, 1);
});

test("deterministic combat fixtures cover misses, hits, smashes, and selected-target sequencing", () => {
  let miss: { hit: boolean; roll: number } | undefined;
  let hit: { hit: boolean; roll: number } | undefined;
  let smash: { smash: boolean; roll: number } | undefined;
  for (let seed = 0; seed < 256 && (!miss || !hit || !smash); seed += 1) {
    const state = createGame(2, seed);
    state.currentPlayer = 0;
    state.monsters[0].health = 40;
    state.units[0].location = state.monsters[0].location;
    state.units[0].defense = 4;
    state.phase = "fight";
    state.pendingBattles = [{ id: "fixture-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[0].id] }];
    state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "fixture-battle" };
    const result = applyCommand(state, { type: "resolve-fight" });
    const attack = (result.eventPayload.attacks as Array<{ attackerId: string; hit: boolean; smash: boolean; roll: number }>).find((entry) => entry.attackerId === "monster-1");
    if (!attack) continue;
    if (!attack.hit) miss = attack;
    if (attack.hit && !attack.smash) hit = attack;
    if (attack.smash) smash = attack;
  }
  assert.ok(miss && miss.roll < 4, "a deterministic monster miss fixture should exist");
  assert.ok(hit && hit.roll >= 4 && hit.roll < 6, "a deterministic monster hit fixture should exist");
  assert.ok(smash?.smash && smash.roll === 6, "a deterministic natural-six smash fixture should exist");

  const state = createGame(2, 0);
  state.currentPlayer = 0;
  state.monsters[0].health = 40;
  state.units[0].location = state.monsters[0].location;
  state.units[2].location = state.monsters[0].location;
  state.units[0].defense = 99;
  state.units[2].defense = 99;
  state.phase = "fight";
  state.pendingBattles = [{ id: "sequence-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[0].id, state.units[2].id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "sequence-battle" };
  const requested = applyCommand(state, { type: "resolve-fight" });
  const firstTarget = requested.state.pendingAttackTarget!.targetIds[1];
  let resolved = applyCommand(requested.state, { type: "resolve-fight", battleId: "sequence-battle", targetUnitId: firstTarget });
  let followUpChoice = 0;
  while (resolved.state.pendingDecision?.type === "attack-target") {
    const decision = resolved.state.pendingDecision;
    resolved = applyCommand(resolved.state, { type: "resolve-fight", battleId: "sequence-battle", targetUnitId: decision.targetIds[followUpChoice % decision.targetIds.length] });
    followUpChoice += 1;
  }
  const monsterTargets = (resolved.eventPayload.attacks as Array<{ attackerId: string; targetId: string }>)
    .filter((entry) => entry.attackerId === "monster-1")
    .map((entry) => entry.targetId);
  assert.deepEqual(monsterTargets.slice(0, 3), [firstTarget, requested.state.pendingAttackTarget!.targetIds[0], firstTarget]);
});

test("surviving normal battle requires retreat and suppresses Encounter", () => {
  const moved = applyCommand(createGame(2, 8), { type: "move", path: ["los-angeles", "denver"] }).state;
  moved.monsters[0].health = 40;
  moved.pendingBattles[0].militaryUnitIds = ["0-0"];
  moved.units.find((unit) => unit.id === "0-0")!.defense = 99;
  const fought = applyCommand(moved, { type: "resolve-fight" }).state;
  assert.equal(fought.pendingDecision?.type, "retreat");
  assert.ok(fought.pendingRetreat);
  const destinations = Object.fromEntries(fought.pendingRetreat.unitIds.map((unitId) => [unitId, fought.pendingRetreat!.options[unitId][0] ?? "disappeared"]));
  const retreated = applyCommand(fought, { type: "retreat", destinations });
  assert.equal(retreated.eventType, "retreat.resolved");
  assert.equal(retreated.state.encounterSuppressed, true);
  assert.equal(retreated.state.pendingRetreat, undefined);
  assert.equal(retreated.eventPayload.researchAwarded, true);
  assert.equal(retreated.state.players[0].researchCardIds.length, 1);
  assert.ok(retreated.state.phase === "deploy" || retreated.state.phase === "fight");
  if (retreated.state.phase === "deploy") {
    const nextTurn = applyCommand(retreated.state, { type: "pass-deploy" });
    assert.equal(nextTurn.state.encounterSuppressed, false);
    assert.equal(nextTurn.state.pendingDecision?.type, "monster-movement");
  }
});

test("forced retreat preserves the declared Monster Challenge challenger", () => {
  const state = createGame(2, 8);
  state.challenge = {
    declared: true,
    active: false,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  const moved = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] }).state;
  moved.monsters[0].health = 40;
  moved.pendingBattles[0].militaryUnitIds = ["0-0"];
  moved.units.find((unit) => unit.id === "0-0")!.defense = 99;
  const fought = applyCommand(moved, { type: "resolve-fight" }).state;
  const destinations = Object.fromEntries(fought.pendingRetreat!.unitIds.map((unitId) => [unitId, fought.pendingRetreat!.options[unitId][0] ?? "disappeared"]));
  const retreated = applyCommand(fought, { type: "retreat", destinations });
  assert.equal(retreated.state.challenge?.challengerMonsterId, "monster-1");
  assert.equal(retreated.state.challenge?.declared, true);
});

test("a battle with no legal retreat forces disappearance and skips Encounter", () => {
  const state = createGame(2);
  state.phase = "fight";
  state.monsters[0].location = K("denver");
  state.units[0].location = K("denver");
  state.pendingBattles = [{ id: "no-retreat", monsterId: "monster-1", location: K("denver"), militaryUnitIds: ["0-0"] }];
  state.pendingRetreat = { battleId: "no-retreat", unitIds: ["0-0"], options: { "0-0": [] } };
  state.pendingDecision = { type: "retreat", playerIndex: state.currentPlayer, battleId: "no-retreat", unitIds: ["0-0"] };
  const result = applyCommand(state, { type: "retreat", destinations: { "0-0": "disappeared" } });
  assert.equal(result.state.units.find((unit) => unit.id === "0-0")?.location, "disappeared");
  assert.equal(result.state.encounterSuppressed, true);
  assert.equal(result.state.phase, "deploy");
  assert.equal(result.state.pendingDecision?.type, "deployment");
  assert.deepEqual(result.eventPayload.disappearedUnitIds, ["0-0"]);
});

test("the simplified Stomp exhaustion rule produces one terminal winner and freezes commands", () => {
  let state = createGame(2);
  state.stompMarkers = 1;
  state.units.forEach((unit) => { unit.location = "record-tile"; });
  state = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] }).state;
  state = applyCommand(state, { type: "advance" }).state;
  assert.equal(state.phase, "game-over");
  assert.equal(state.winnerPlayer, 0);
  assert.equal(state.victoryType, "development-stomp-exhaustion");
  assert.throws(() => applyCommand(state, { type: "advance" }), /match is complete/);
});

test("the final active Stomp marker declares a delayed Monster Challenge challenger", () => {
  let state = createGame(2, 0);
  state.rulesetVersion = "challenge-0.1";
  state.stompMarkers = 1;
  state.units.forEach((unit) => { unit.location = "record-tile"; });
  state = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] }).state;
  const encounter = applyCommand(state, { type: "advance" });
  assert.equal(encounter.state.phase, "deploy");
  assert.deepEqual(encounter.state.challenge, {
    declared: true,
    active: false,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  });
  const nextTurn = applyCommand(encounter.state, { type: "pass-deploy" }).state;
  assert.equal(nextTurn.phase, "move");
  assert.equal(nextTurn.currentPlayer, 1);
  assert.equal(nextTurn.pendingDecision?.type, "monster-movement");
});

test("the Monster Challenge chooses eligible opponents, records weigh-in Health, and resolves unlimited monster combat", () => {
  let state = createGame(2, 0);
  state.rulesetVersion = "challenge-0.1";
  state.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  state.monsters[0].health = 1;
  state.monsters[1].health = 1;
  state.monsters[1].location = "disappeared";
  const selected = applyCommand(state, { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  assert.equal(selected.state.monsters[1].location, selected.state.monsters[0].location);
  assert.deepEqual(selected.state.challenge?.weighInHealth, { "monster-1": 1, "monster-2": 1 });
  assert.equal(selected.state.pendingDecision?.type, "challenge-resolution");
  const resolved = applyCommand(selected.state, { type: "resolve-challenge" });
  assert.equal(resolved.eventType, "challenge.resolved");
  assert.equal(resolved.state.phase, "game-over");
  assert.equal(resolved.state.victoryType, "monster-challenge");
  assert.equal(resolved.state.challenge?.defeatedMonsterIds.length, 1);
  assert.equal((resolved.eventPayload.rolls as number[]).length > 0, true);
});

test("Monster Challenge fights surviving giants last and awards America-saved victory", () => {
  const state = createGame(2, 0);
  const giant = GIANT_UNIT_DEFINITIONS.find((definition) => definition.id === "mecha-monster")!;
  state.rulesetVersion = "challenge-0.1";
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.monsters[0].location = K("denver");
  state.monsters[0].health = 1;
  state.monsters[0].defense = 1;
  state.monsters[0].attacks = 1;
  state.monsters[1].location = "defeated";
  state.monsters[1].health = 0;
  state.units.push({ id: "challenge-mecha", branch: "Giant", unitTypeId: giant.id, move: giant.move, movement: giant.movement, attacks: giant.attacks, damage: giant.damage, ownerPlayer: 1, health: giant.health, defense: 1, location: K("denver") });
  state.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: ["monster-2"], giantUnitIds: ["challenge-mecha"] };
  state.pendingDecision = { type: "challenge-giant", playerIndex: 0, challengerMonsterId: "monster-1", giantUnitIds: ["challenge-mecha"] };

  const selected = applyCommand(state, { type: "challenge-giant", giantUnitId: "challenge-mecha" });
  assert.equal(selected.state.pendingDecision?.type, "challenge-giant-resolution");
  const resolved = applyCommand(selected.state, { type: "resolve-challenge" });
  assert.equal(resolved.state.victoryType, "america-saved");
  assert.equal(resolved.state.winnerPlayer, 1);
  assert.equal(resolved.state.monsters[0].location, "defeated");
});

test("a monster can defeat giants in the selected order and retain Monster Challenge victory", () => {
  const state = createGame(2, 0);
  const mecha = GIANT_UNIT_DEFINITIONS.find((definition) => definition.id === "mecha-monster")!;
  const captain = GIANT_UNIT_DEFINITIONS.find((definition) => definition.id === "captain-colossal")!;
  state.rulesetVersion = "challenge-0.1";
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.monsters[0].location = K("denver");
  state.monsters[0].health = 40;
  state.monsters[0].defense = 99;
  state.monsters[0].damage = 99;
  state.monsters[1].location = "defeated";
  state.monsters[1].health = 0;
  state.units.push(
    { id: "challenge-mecha-order", branch: "Giant", unitTypeId: mecha.id, move: mecha.move, movement: mecha.movement, attacks: mecha.attacks, damage: mecha.damage, ownerPlayer: 1, health: 1, defense: 1, location: K("denver") },
    { id: "challenge-captain-order", branch: "Giant", unitTypeId: captain.id, move: captain.move, movement: captain.movement, attacks: captain.attacks, damage: captain.damage, ownerPlayer: 0, health: 1, defense: 1, location: K("denver") },
  );
  state.challenge = { declared: true, active: true, challengerMonsterId: "monster-1", declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: ["monster-2"], giantUnitIds: ["challenge-mecha-order", "challenge-captain-order"] };
  state.pendingDecision = { type: "challenge-giant", playerIndex: 0, challengerMonsterId: "monster-1", giantUnitIds: ["challenge-mecha-order", "challenge-captain-order"] };

  const first = applyCommand(state, { type: "challenge-giant", giantUnitId: "challenge-captain-order" });
  const firstResolved = applyCommand(first.state, { type: "resolve-challenge" });
  assert.equal(firstResolved.state.units.find((unit) => unit.id === "challenge-captain-order")?.location, "permanently-removed");
  assert.deepEqual(firstResolved.state.pendingDecision, { type: "challenge-giant", playerIndex: 0, challengerMonsterId: "monster-1", giantUnitIds: ["challenge-mecha-order"] });
  const second = applyCommand(firstResolved.state, { type: "challenge-giant", giantUnitId: "challenge-mecha-order" });
  const final = applyCommand(second.state, { type: "resolve-challenge" });
  assert.equal(final.state.victoryType, "monster-challenge");
  assert.equal(final.state.winnerPlayer, 0);
});

test("Monster Challenge target validation admits only distinct living eligible monsters", () => {
  const state = createGame(2, 0);
  state.rulesetVersion = "challenge-0.1";
  state.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  assert.throws(() => applyCommand(state, { type: "challenge-opponent", opponentMonsterId: "monster-1" }), /eligible monster/);

  const unavailable = structuredClone(state);
  unavailable.monsters[1].location = "hollywood";
  assert.throws(() => applyCommand(unavailable, { type: "challenge-opponent", opponentMonsterId: "monster-2" }), /eligible monster/);

  const malformedDuel = structuredClone(state);
  malformedDuel.monsters[1].health = 0;
  malformedDuel.challenge = { ...malformedDuel.challenge!, opponentMonsterId: "monster-2", weighInHealth: { "monster-1": 5, "monster-2": 0 } };
  malformedDuel.pendingDecision = { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2" };
  assert.throws(() => applyCommand(malformedDuel, { type: "resolve-challenge" }), /living, eligible monsters/);
});

test("High-Octane Blood lets a non-challenger attack first in the Monster Challenge", () => {
  const state = createGame(2, 0);
  state.rulesetVersion = "challenge-0.1";
  state.players[1].mutationCardIds = ["High-Octane Blood"];
  state.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  state.monsters[0].health = 2;
  state.monsters[1].health = 2;
  state.monsters[1].location = "disappeared";
  const selected = applyCommand(state, { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  const resolved = applyCommand(selected.state, { type: "resolve-challenge" });
  const firstAttack = (resolved.eventPayload.attacks as Array<{ attackerId: string; modifiers: string[] }>)[0];
  assert.equal(firstAttack.attackerId, "monster-2");
  assert.deepEqual(firstAttack.modifiers, ["High-Octane Blood: attacks first"]);
});

test("It's a Robot! electrocutes a monster after a Monster Challenge miss", () => {
  const state = createGame(2, 0);
  state.rulesetVersion = "challenge-0.1";
  state.players[1].mutationCardIds = ["It's a Robot!"];
  state.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.phase = "challenge";
  state.currentPlayer = 0;
  state.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  state.monsters[0].health = 2;
  state.monsters[1].health = 2;
  state.monsters[1].location = "disappeared";
  const selected = applyCommand(state, { type: "challenge-opponent", opponentMonsterId: "monster-2" });

  let miss: { hit: boolean; retaliationDamage?: number } | undefined;
  for (let seed = 0; seed < 128 && !miss; seed += 1) {
    const candidate = structuredClone(selected.state);
    candidate.rng.seed = seed;
    const resolved = applyCommand(candidate, { type: "resolve-challenge" });
    const attack = (resolved.eventPayload.attacks as Array<{ attackerId: string; roll: number; hit: boolean; retaliationDamage?: number }>)
      .find((entry) => entry.attackerId === "monster-1");
    if (attack && attack.roll < 4) miss = attack;
  }

  assert.equal(miss?.hit, false);
  assert.equal(miss?.retaliationDamage, 1);
});

test("a pending challenger lost to Hollywood is cleared while a disappeared monster remains eligible", () => {
  const state = createGame(2, 0);
  state.challenge = {
    declared: true,
    active: false,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.phase = "fight";
  state.currentPlayer = 0;
  state.monsters[0].health = 1;
  state.monsters[0].defense = 1;
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  unit.attacks = 1;
  unit.defense = 99;
  state.pendingBattles = [{ id: "pending-hollywood", monsterId: state.monsters[0].id, location: state.monsters[0].location as `${number},${number}`, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "pending-hollywood" };
  const result = applyCommand(state, { type: "resolve-fight" });
  assert.equal(result.state.monsters[0].location, "hollywood");
  assert.equal(result.state.challenge?.challengerMonsterId, undefined);
  assert.equal(result.state.log.some((entry) => entry.includes("pending Challenger status")), true);
  const challengeState = createGame(2);
  challengeState.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  challengeState.phase = "challenge";
  challengeState.currentPlayer = 0;
  challengeState.monsters[1].location = "disappeared";
  challengeState.pendingDecision = { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] };
  const selected = applyCommand(challengeState, { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  assert.equal(selected.state.challenge?.opponentMonsterId, "monster-2");

  const disappearing = createGame(2);
  disappearing.challenge = {
    declared: true,
    active: false,
    challengerMonsterId: "monster-1",
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  disappearing.setupAssignments = [
    { playerIndex: 0, monsterId: "monster-1", branch: "Army", lair: "los-angeles", startingChoice: { kind: "research" }, ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Navy", lair: "chicago", startingChoice: { kind: "research" }, ready: true },
  ];
  disappearing.currentPlayer = 0;
  disappearing.pendingDecision = { type: "monster-movement", playerIndex: 0, monsterId: "monster-1" };
  const vanished = applyCommand(disappearing, { type: "disappear-monster" });
  assert.equal(vanished.state.monsters[0].location, "disappeared");
  assert.equal(vanished.state.challenge?.challengerMonsterId, undefined);
});

test("a confirmed concession records the next seat as winner and freezes the match", () => {
  const state = createGame(2);
  const result = applyCommand(state, { type: "concede" });
  assert.equal(result.eventType, "match.conceded");
  assert.equal(result.state.phase, "game-over");
  assert.equal(result.state.winnerPlayer, 1);
  assert.equal(result.state.victoryType, "concession");
  assert.deepEqual(result.state.pendingDecision, { type: "game-over", playerIndex: 1, victoryType: "concession" });
  assert.throws(() => applyCommand(result.state, { type: "concede" }), /match is complete/);
});

test("every command is rejected after terminal state without changing the winner", () => {
  let state = createGame(2);
  state.stompMarkers = 1;
  state.units.forEach((unit) => { unit.location = "record-tile"; });
  state = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] }).state;
  state = applyCommand(state, { type: "advance" }).state;
  const snapshot = JSON.stringify(state);
  const commands = [
    { type: "move", path: ["los-angeles", "denver"] },
    { type: "move-unit", unitId: "0-0", path: ["denver", "chicago"] },
    { type: "pass-move" }, { type: "resolve-fight" }, { type: "resolve-encounter" },
    { type: "deploy" }, { type: "pass-deploy" }, { type: "advance" }
  ] as const;
  for (const command of commands) {
    assert.throws(() => applyCommand(state, command), /match is complete/);
    assert.equal(JSON.stringify(state), snapshot);
  }
});

test("the development fixture can end when its smaller abstract board is exhausted", () => {
  const state = createGame(2);
  state.monsters[0].location = K("los-angeles");
  state.stompedLocations = locations.filter((location) => location.id !== "los-angeles").map((location) => K(location.id));
  state.stompMarkers = 14;
  const result = applyCommand(state, { type: "pass-move" }).state;
  const encounter = applyCommand(result, { type: "resolve-encounter", choice: "health" }).state;
  assert.equal(encounter.phase, "game-over");
  assert.equal(encounter.victoryType, "development-board-exhaustion");
});

test("the browser-only temporary victory fixture is reachable by legal encounters", () => {
  let state = createDevelopmentVictoryGame();
  assert.equal(state.stompMarkers, DEVELOPMENT_STOMPABLE_KEYS.length);
  for (const location of DEVELOPMENT_STOMPABLE_KEYS) {
    state = { ...state, phase: "encounter", monsters: state.monsters.map((monster, index) => index === state.currentPlayer ? { ...monster, location } : monster) };
    state = resolveEncounterResult(state, "health").state;
    if (state.phase === "game-over") break;
  }
  assert.equal(state.phase, "game-over");
  assert.equal(state.victoryType, "development-board-exhaustion");
  assert.equal(state.winnerPlayer, 0);
});

test("phase-specific commands resolve Fight, Encounter, and Deploy explicitly", () => {
  let state = applyCommand(createGame(2), { type: "move", path: ["los-angeles", "denver"] }).state;
  state = resolveDevelopmentFight(state);
  if (state.phase === "encounter") state = applyCommand(state, { type: "resolve-encounter", choice: "health" }).state;
  else assert.equal(state.phase, "deploy");
  state = applyCommand(state, { type: "deploy" }).state;
  if (state.phase === "fight") state = resolveDevelopmentFight(state);
  assert.equal(state.phase, "deploy");
  state = applyCommand(state, { type: "pass-deploy" }).state;
  assert.equal(state.phase, "move");
});

test("a legal move advances the game to fight", () => {
  const state = createGame(2);
  const result = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] });
  assert.equal(result.state.phase, "fight");
  assert.equal(result.state.monsters[0].location, K("denver"));
  assert.equal(result.eventType, "monster.moved");
});

test("an illegal move is rejected", () => {
  const state = createGame(2);
  const before = JSON.stringify(state);
  assert.throws(() => applyCommand(state, { type: "move", path: ["los-angeles", "new-york"] }));
  assert.equal(JSON.stringify(state), before);
});

test("a complete turn returns to move for the next player", () => {
  let state = createGame(2);
  state = applyCommand(state, { type: "move", path: ["los-angeles", "denver"] }).state;
  state = resolveDevelopmentFight(state);
  if (state.phase === "encounter") state = applyCommand(state, { type: "advance" }).state;
  if (state.phase === "deploy") state = applyCommand(state, { type: "pass-deploy" }).state;
  assert.equal(state.phase, "move");
  assert.equal(state.currentPlayer, 1);
});

test("combat rolls and stomped-base deployment rejection are deterministic and recorded", () => {
  const initialUnitCount = createGame(2, 76).units.length;
  const firstMove = applyCommand(createGame(2, 76), { type: "move", path: ["los-angeles", "denver"] });
  const firstFight = applyCommand(firstMove.state, { type: "advance" });
  const firstEncounter = applyCommand(firstFight.state, { type: "advance" });
  const firstDeploy = applyCommand(firstEncounter.state, { type: "pass-deploy" });

  const replayMove = applyCommand(createGame(2, 76), { type: "move", path: ["los-angeles", "denver"] });
  const replayFight = applyCommand(replayMove.state, { type: "advance" });
  const replayEncounter = applyCommand(replayFight.state, { type: "advance" });
  const replayDeploy = applyCommand(replayEncounter.state, { type: "pass-deploy" });

  assert.deepEqual(firstFight.eventPayload, replayFight.eventPayload);
  assert.equal((firstFight.eventPayload.attacks as Array<{ attackerId: string; targetId: string; modifiers: string[] }>)[0]?.attackerId, "0-1");
  assert.equal((firstFight.eventPayload.attacks as Array<{ attackerId: string; targetId: string; modifiers: string[] }>)[0]?.targetId, "monster-1");
  assert.deepEqual((firstFight.eventPayload.attacks as Array<{ modifiers: string[] }>)[0]?.modifiers, ["extra first-round attack before monster"]);
  assert.equal((firstEncounter.eventPayload.effects as Array<{ type: string }>).some((effect) => effect.type === "stomp"), true);
  assert.equal(firstDeploy.eventType, "turn.passed");
  assert.equal(firstDeploy.eventPayload.nextPhase, "move");
  assert.deepEqual(firstDeploy.state, replayDeploy.state);
  assert.equal(firstDeploy.state.units.length, initialUnitCount);
  assert.deepEqual(sourceUnitInventoryErrors(firstDeploy.state.units), []);
  assert.equal(firstDeploy.state.units.find((unit) => unit.id === "0-0")?.location, "record-tile");
  assert.equal(firstFight.eventPayload.combatRounds, 2);
  assert.equal(typeof (firstFight.eventPayload.attacks as Array<{ smash: boolean }>)[0]?.smash, "boolean");
  assert.equal((firstFight.eventPayload.rolls as number[]).length, 4);
  assert.equal(JSON.stringify(firstDeploy.state), JSON.stringify(replayDeploy.state));
});

test("a completed development setup is carried into the local game state", () => {
  let setup = createSetup({ playerCount: 2, monsterIds: ["monster-1", "monster-2"], eligibleBranches: ["Army", "Navy"], lairsByMonster: { "monster-1": ["los-angeles", "seattle", "denver"], "monster-2": ["chicago", "new-york", "miami"] } });
  setup = chooseMonster(setup, 0, "monster-1");
  setup = chooseMonster(setup, 1, "monster-2");
  setup = chooseBranch(setup, 1, "Army");
  setup = chooseBranch(setup, 0, "Navy");
  setup = chooseLair(setup, 0, "los-angeles");
  setup = chooseLair(setup, 1, "chicago");
  setup = chooseStartingChoice(setup, 0, { kind: "research" });
  setup = chooseStartingChoice(setup, 1, { kind: "research" });
  const game = createGameFromSetup(setup);
  assert.deepEqual(game.setupAssignments?.map((seat) => seat.monsterId), ["monster-1", "monster-2"]);
  assert.deepEqual(game.monsters.map((monster) => monster.id), ["monster-1", "monster-2"]);
});

test("a monster can disappear, return to its assigned lair, and consume the return Move step", () => {
  const state = createGame(2);
  state.setupAssignments = [
    { playerIndex: 0, monsterId: "monster-1", branch: "Army", lair: "los-angeles", startingChoice: { kind: "research" }, ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Navy", lair: "chicago", startingChoice: { kind: "research" }, ready: true },
  ];
  state.currentPlayer = 0;
  state.monsters[0].health = 1;
  const disappeared = applyCommand(state, { type: "disappear-monster" });
  assert.equal(disappeared.eventType, "monster.disappeared");
  assert.equal(disappeared.state.monsters[0].location, "disappeared");
  assert.equal(disappeared.state.phase, "deploy");

  const nextPlayer = applyCommand(disappeared.state, { type: "pass-deploy" }).state;
  const playerOneEncounter = applyCommand(nextPlayer, { type: "pass-move" }).state;
  const playerOneDeploy = applyCommand(playerOneEncounter, { type: "resolve-encounter" }).state;
  const returningPlayer = applyCommand(playerOneDeploy, { type: "pass-deploy" }).state;
  assert.equal(returningPlayer.currentPlayer, 0);
  assert.equal(returningPlayer.monsters[0].location, K("los-angeles"));
  assert.equal(returningPlayer.monsters[0].health, returningPlayer.monsters[0].startingHealth);
  assert.equal(returningPlayer.movedPieceIds.includes("monster-1"), true);
  const finishedMove = applyCommand(returningPlayer, { type: "pass-move" });
  assert.equal(finishedMove.state.phase, "deploy");
  assert.equal(finishedMove.state.pendingDecision?.type, "deployment");

  const rampageState = structuredClone(disappeared.state);
  rampageState.players[0].mutationCardIds = ["Rampage"];
  const rampagePlayerOneMove = applyCommand(rampageState, { type: "pass-deploy" }).state;
  const rampagePlayerOneEncounter = applyCommand(rampagePlayerOneMove, { type: "pass-move" }).state;
  const rampagePlayerOneDeploy = applyCommand(rampagePlayerOneEncounter, { type: "resolve-encounter" }).state;
  const rampageReturn = applyCommand(rampagePlayerOneDeploy, { type: "pass-deploy" }).state;
  assert.equal(rampageReturn.movedPieceIds.includes("monster-1"), false);
  const rampageMove = applyCommand(rampageReturn, { type: "move", path: ["los-angeles", "denver"] });
  assert.equal(rampageMove.state.monsters[0].location, K("denver"));
});

test("Hollywood monsters cannot disappear", () => {
  const state = createGame(2);
  state.setupAssignments = [{ playerIndex: 0, monsterId: "monster-1", lair: "los-angeles", ready: true }];
  state.monsters[0].location = "hollywood";
  assert.throws(() => applyCommand(state, { type: "disappear-monster" }), /Hollywood monster cannot disappear/);
});

test("a defeated monster goes to Hollywood and recovers at the start of its next turn", () => {
  const state = createGame(2);
  state.phase = "fight";
  state.currentPlayer = 0;
  state.monsters[0].health = 0;
  const battleLocation = state.monsters[0].location as `${number},${number}`;
  state.pendingBattles = [{ id: "monster-1:1:test", monsterId: "monster-1", location: battleLocation, militaryUnitIds: [] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "monster-1:1:test" };
  const defeated = applyCommand(state, { type: "resolve-fight" });
  assert.equal(defeated.state.monsters[0].location, "hollywood");
  assert.equal(defeated.state.monsters[0].infamy, 0);
  assert.equal(defeated.state.phase, "deploy");

  const recovering = defeated.state;
  recovering.currentPlayer = 1;
  recovering.pendingDecision = { type: "deployment", playerIndex: 1 };
  const nextTurnResult = applyCommand(recovering, { type: "pass-deploy" });
  const nextTurn = nextTurnResult.state;
  assert.equal(nextTurn.currentPlayer, 0);
  assert.equal(nextTurn.monsters[0].health > 0, true);
  assert.equal(nextTurn.movedPieceIds.includes("monster-1"), true);
  assert.equal(nextTurn.encounterSuppressed, true);
  assert.equal(nextTurn.phase, "move");
  assert.equal(typeof nextTurnResult.eventPayload.recoveryRoll, "number");
  assert.equal((nextTurnResult.eventPayload.recoveryRoll as number) >= 1 && (nextTurnResult.eventPayload.recoveryRoll as number) <= 6, true);
  assert.equal(nextTurnResult.eventPayload.recoveryReleased, nextTurn.monsters[0].location !== "hollywood");
});

test("Atomic Recovery restores a monster to starting Health at the start of its turn", () => {
  const state = createGame(2);
  state.phase = "deploy";
  state.currentPlayer = 1;
  state.pendingDecision = { type: "deployment", playerIndex: 1 };
  state.players[0].mutationCardIds = ["Atomic Recovery"];
  state.monsters[0].health = 3;
  const result = applyCommand(state, { type: "pass-deploy" });
  assert.equal(result.state.currentPlayer, 0);
  assert.equal(result.state.monsters[0].health, result.state.monsters[0].startingHealth);
  assert.equal(result.state.log.some((entry) => /Atomic Recovery/.test(entry)), true);
});

test("persistent Mutation movement and combat modifiers alter authoritative outcomes", () => {
  const base = createGame(2);
  base.monsters[1].location = "record-tile";
  base.units.forEach((unit) => { unit.location = "record-tile"; });
  const baseMaxMove = Math.max(...legalMonsterPaths(base).map((path) => path.length - 1));

  const armored = createGame(2);
  armored.monsters[1].location = "record-tile";
  armored.units.forEach((unit) => { unit.location = "record-tile"; });
  armored.players[0].mutationCardIds = ["Armored Scales"];
  const armoredMaxMove = Math.max(...legalMonsterPaths(armored).map((path) => path.length - 1));
  assert.equal(armoredMaxMove, baseMaxMove - 1);

  const faster = createGame(2);
  faster.monsters[1].location = "record-tile";
  faster.units.forEach((unit) => { unit.location = "record-tile"; });
  faster.players[0].mutationCardIds = ["High-Octane Blood"];
  const fasterMaxMove = Math.max(...legalMonsterPaths(faster).map((path) => path.length - 1));
  assert.equal(fasterMaxMove, baseMaxMove + 1);

  const stackedMove = createGame(2);
  stackedMove.monsters[1].location = "record-tile";
  stackedMove.units.forEach((unit) => { unit.location = "record-tile"; });
  stackedMove.players[0].mutationCardIds = ["High-Octane Blood", "Winged Horror"];
  const stackedMaxMove = Math.max(...legalMonsterPaths(stackedMove).map((path) => path.length - 1));
  assert.equal(stackedMaxMove, baseMaxMove + 2);

  const opposingModifiers = createGame(2);
  opposingModifiers.monsters[1].location = "record-tile";
  opposingModifiers.units.forEach((unit) => { unit.location = "record-tile"; });
  opposingModifiers.players[0].mutationCardIds = ["High-Octane Blood", "Armored Scales"];
  const opposingMaxMove = Math.max(...legalMonsterPaths(opposingModifiers).map((path) => path.length - 1));
  assert.equal(opposingMaxMove, baseMaxMove);

  const warSpikes = createGame(2, 3);
  warSpikes.players[0].mutationCardIds = ["War Spikes"];
  warSpikes.phase = "fight";
  warSpikes.pendingBattles = [{ id: "war-spikes", monsterId: "monster-1", location: warSpikes.monsters[0].location as any, militaryUnitIds: [warSpikes.units[0].id] }];
  warSpikes.units[0].location = warSpikes.monsters[0].location;
  warSpikes.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "war-spikes" };
  let attackDamage: number | undefined;
  for (let seed = 0; seed < 128 && attackDamage === undefined; seed += 1) {
    const candidate = structuredClone(warSpikes);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight" });
    attackDamage = (result.eventPayload.attacks as Array<{ attackerId: string; damage: number }>).find((attack) => attack.attackerId === "monster-1")?.damage;
  }
  assert.equal(attackDamage, 4);
});

test("Atomic Breath adds one first-round monster attack", () => {
  const state = createGame(2, 0);
  state.players[0].mutationCardIds = ["Atomic Breath"];
  state.monsters[0].attacks = 0;
  state.units[0].location = state.monsters[0].location;
  state.units[0].defense = 99;
  state.phase = "fight";
  state.pendingBattles = [{ id: "atomic-breath", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[0].id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "atomic-breath" };
  const result = applyCommand(state, { type: "resolve-fight" });
  assert.equal((result.eventPayload.attacks as Array<{ attackerId: string }>).filter((attack) => attack.attackerId === "monster-1").length, 1);
});

test("Winged Horror grants fly movement and one extra Move", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Winged Horror"];
  state.monsters[1].location = K("denver");
  const paths = legalMonsterPaths(state, "monster-1");
  assert.ok(paths.some((path) => path.join(">") === `${K("los-angeles")}>${K("denver")}>${K("chicago")}`));
  assert.equal(Math.max(...paths.map((path) => path.length - 1)), 5);
});

test("Berserk and Son of a Monster resolve their sourced optional battle windows", () => {
  const berserk = createGame(2, 0);
  berserk.players[0].mutationCardIds = ["Berserk"];
  berserk.phase = "fight";
  berserk.pendingBattles = [{ id: "berserk", monsterId: "monster-1", location: berserk.monsters[0].location as any, militaryUnitIds: [berserk.units[0].id] }];
  berserk.units[0].location = berserk.monsters[0].location;
  berserk.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "berserk" };
  const berserkResult = applyCommand(berserk, { type: "use-mutation", cardId: "Berserk", battleId: "berserk" });
  assert.deepEqual(berserkResult.state.players[0].mutationCardIds, []);
  assert.equal(berserkResult.state.pendingBattles[0].bonusMonsterAttacks, 5);
  assert.equal(berserkResult.eventType, "mutation.used");
  assert.equal(berserkResult.eventPayload.extraAttacks, 5);

  const son = createGame(2, 0);
  son.players[0].mutationCardIds = ["Son of a Monster"];
  son.monsters[0].health = 1;
  son.phase = "fight";
  son.pendingBattles = [{ id: "son", monsterId: "monster-1", location: son.monsters[0].location as any, militaryUnitIds: [son.units[0].id] }];
  son.units[0].location = son.monsters[0].location;
  son.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "son" };
  const sonResult = applyCommand(son, { type: "use-mutation", cardId: "Son of a Monster", battleId: "son" });
  assert.deepEqual(sonResult.state.players[0].mutationCardIds, []);
  assert.equal(sonResult.state.pendingBattles[0].bonusMonsterAttacks, 2);
  assert.equal(sonResult.state.monsters[0].health, 1 + (sonResult.eventPayload.healthRoll as number));
  assert.equal((sonResult.eventPayload.healthRoll as number) >= 1, true);
});

test("Laser Beam Eyes applies its sourced cruise-missile attack bonus", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Laser Beam Eyes"];
  state.phase = "fight";
  state.monsters[0].attacks = 1;
  const missile = state.units.find((unit) => unit.unitTypeId === "air-force-cruise-missile")!;
  missile.location = state.monsters[0].location;
  const battleId = "laser-eyes";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [missile.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  let laserAttack: { hit: boolean; roll: number; modifiers: string[] } | undefined;
  for (let seed = 0; seed < 128 && !laserAttack; seed += 1) {
    const candidate = structuredClone(state);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight" });
    const attack = (result.eventPayload.attacks as Array<{ attackerId: string; hit: boolean; roll: number; modifiers: string[] }>).find((entry) => entry.attackerId === "monster-1");
    if (attack && attack.roll === 4) laserAttack = attack;
  }
  assert.equal(laserAttack?.hit, true);
  assert.deepEqual(laserAttack?.modifiers, ["Laser Beam Eyes: +2 to hit cruise missiles"]);
});

test("Radiation Field destroys a military attacker on a roll of one", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Radiation Field"];
  state.phase = "fight";
  state.monsters[0].attacks = 0;
  const unit = state.units[0];
  unit.location = state.monsters[0].location;
  const battleId = "radiation-field";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  let radiationAttack: { attackerDestroyed?: boolean; roll: number } | undefined;
  for (let seed = 0; seed < 128 && !radiationAttack; seed += 1) {
    const candidate = structuredClone(state);
    candidate.rng.seed = seed;
    const result = applyCommand(candidate, { type: "resolve-fight" });
    const attack = (result.eventPayload.attacks as Array<{ attackerId: string; attackerDestroyed?: boolean; roll: number }>).find((entry) => entry.attackerId === unit.id);
    if (attack?.roll === 1) radiationAttack = attack;
  }
  assert.equal(radiationAttack?.attackerDestroyed, true);
});

test("Whip Tentacles adds an attack after each monster roll of six", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Whip Tentacles"];
  state.phase = "fight";
  const battleUnits = state.units.slice(0, 8);
  battleUnits.forEach((unit) => {
    unit.location = state.monsters[0].location;
    unit.attacks = 0;
  });
  const battleId = "whip-tentacles";
  state.pendingBattles = [{ id: battleId, monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: battleUnits.map((unit) => unit.id) }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  let monsterAttacks: Array<{ attackerId: string; roll: number }> | undefined;
  for (let seed = 0; seed < 256 && !monsterAttacks; seed += 1) {
    let current = structuredClone(state);
    current.rng.seed = seed;
    for (let step = 0; step < 24 && current.phase === "fight"; step += 1) {
      const decision = current.pendingDecision;
      if (decision?.type === "retreat") break;
      const result = decision?.type === "attack-target"
        ? applyCommand(current, { type: "resolve-fight", battleId: decision.battleId, targetUnitId: decision.targetIds[0] })
        : decision?.type === "battle-resolution"
          ? applyCommand(current, { type: "resolve-fight", battleId })
          : applyCommand(current, { type: "advance" });
      current = result.state;
      if (result.eventType === "fight.resolved") {
        const attacks = result.eventPayload.attacks as Array<{ attackerId: string; roll: number }>;
        const monsterRolls = attacks.filter((attack) => attack.attackerId === "monster-1");
        if (monsterRolls.some((attack) => attack.roll === 6) && monsterRolls.length > 6) monsterAttacks = monsterRolls;
      }
    }
  }
  assert.equal((monsterAttacks?.length ?? 0) > 6, true);
});

test("a rival military player draws Military Research when their attack sends a monster to Hollywood", () => {
  const state = createGame(2, 7);
  state.phase = "fight";
  state.currentPlayer = 0;
  state.monsters[0].health = 1;
  state.monsters[0].attacks = 0;
  const battleLocation = state.monsters[0].location as `${number},${number}`;
  const unit = state.units[0];
  unit.location = battleLocation;
  unit.ownerPlayer = 1;
  unit.defense = 99;
  unit.attacks = 1;
  unit.damage = 1;
  state.pendingBattles = [{ id: "monster-1:1:research", monsterId: "monster-1", location: battleLocation, militaryUnitIds: [unit.id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "monster-1:1:research" };

  const result = applyCommand(state, { type: "resolve-fight" });

  assert.equal(result.state.monsters[0].location, "hollywood");
  assert.equal(result.state.players[1].researchCardIds.length, 1);
  assert.equal(typeof result.eventPayload.hollywoodResearchCardId, "string");
  assert.equal(result.eventPayload.hollywoodResearchAwarded, true);
});

test("encounter stomps are persisted once and Infamy is capped", () => {
  let state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = "infamy-site";
  state.monsters[0].infamy = 14;
  const first = applyCommand(state, { type: "resolve-encounter" });
  assert.deepEqual(first.state.stompedLocations, ["infamy-site"]);
  assert.equal(first.state.stompMarkers, 13);
  assert.equal(first.state.monsters[0].infamy, 15);
  const secondState = { ...first.state, phase: "encounter" as const };
  const second = applyCommand(secondState, { type: "resolve-encounter" });
  assert.equal(second.state.stompMarkers, 13);
  assert.equal(second.state.monsters[0].infamy, 15);
  assert.equal(second.eventPayload.stomped, false);
});

test("Megaclaw receives its source-backed three-Infamy site benefit", () => {
  const state = createGame(4);
  state.currentPlayer = 3;
  state.phase = "encounter";
  state.monsters[3].name = "Megaclaw";
  state.monsters[3].location = K("infamy-site");
  state.monsters[3].infamy = 12;
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(result.state.monsters[3].infamy, 15);
  assert.deepEqual(result.eventPayload.effects, [
    { type: "infamy", amount: 3, source: "infamy-site" },
    { type: "stomp", amount: 1, source: "infamy-site" },
  ]);
});

test("Zorb city encounter exposes and applies its source-backed benefit choice", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = K("los-angeles");
  state.monsters[0].health = 11;
  const pending = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(pending.state.phase, "encounter");
  assert.equal(pending.state.pendingDecision?.type, "encounter-choice");
  assert.deepEqual(pending.state.pendingEncounterChoice?.choices, ["health", "infamy"]);
  assert.throws(() => applyCommand(pending.state, { type: "advance" }), /city benefit choice is required/);
  const resolved = applyCommand(pending.state, { type: "resolve-encounter", choice: "infamy" });
  assert.equal(resolved.state.monsters[0].infamy, 2);
  assert.equal(resolved.state.monsters[0].health, 11);
  assert.equal(resolved.state.pendingDecision?.type, "deployment");
});

test("Encounter is gated by movement and pending battles, and development features are covered", () => {
  const featureKinds = new Set(Object.values(DEVELOPMENT_BOARD.hexes).flatMap((hex) => hex.features.map((feature) => feature.kind)));
  assert.deepEqual([...featureKinds].sort(), ["challenge-site", "city", "infamy-site", "military-base", "mutation-site"]);

  const initial = createGame(2);
  assert.throws(() => applyCommand(initial, { type: "resolve-encounter" }), /advance action available|pending decision/);

  const moved = applyCommand(initial, { type: "move", path: ["los-angeles", "denver"] }).state;
  assert.equal(moved.phase, "fight");
  assert.equal(moved.pendingBattles.length, 1);
  assert.throws(() => applyCommand(moved, { type: "resolve-encounter" }), /advance action available|pending decision/);
});

test("blank cells and lairs have no stompable Encounter effect", () => {
  assert.equal(hasStompableEncounterFeature([]), false);
  assert.equal(hasStompableEncounterFeature([{ kind: "lair", monsterId: "monster-1" }]), false);
  assert.equal(hasStompableEncounterFeature([{ kind: "challenge-site" }]), false);
  assert.equal(hasStompableEncounterFeature([{ kind: "city", benefit: { kind: "health", amount: 1 } }]), true);
});

test("stomped spaces do not consume another Stomp marker", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = K("seattle");
  state.stompedLocations = [K("seattle")];
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(result.state.stompMarkers, state.stompMarkers);
  assert.deepEqual(result.eventPayload.effects, []);
  assert.equal(result.state.phase, "deploy");
});

test("military-base Encounter grants Infamy and requires a legal branch trophy", () => {
  const state = createGame(2);
  state.setupAssignments = [
    { playerIndex: 0, monsterId: "monster-1", branch: "Navy", lair: "los-angeles", ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Army", lair: "chicago", ready: true },
  ];
  state.phase = "encounter";
  state.currentPlayer = 0;
  state.monsters[0].location = K("denver");
  const pending = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(pending.eventType, "trophy.choice-required");
  assert.equal(pending.state.monsters[0].infamy, 1);
  assert.equal(pending.state.pendingDecision?.type, "trophy-choice");
  const trophyId = pending.state.pendingTrophyChoice!.unitIds[0];
  const chosen = applyCommand(pending.state, { type: "resolve-encounter", trophyUnitId: trophyId });
  assert.equal(chosen.eventType, "trophy.chosen");
  assert.equal(chosen.state.units.find((unit) => unit.id === trophyId)?.location, "permanently-removed");
  assert.equal(chosen.state.removedUnitIds.includes(trophyId), true);
  assert.equal(chosen.state.phase, "deploy");
});

test("Iron Stomach lets a monster choose Health instead of military-base Infamy", () => {
  const state = createGame(2);
  state.players[0].mutationCardIds = ["Iron Stomach"];
  state.phase = "encounter";
  state.currentPlayer = 0;
  state.monsters[0].location = K("denver");
  state.monsters[0].health = 5;
  const pending = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(pending.eventType, "encounter.choice-required");
  assert.deepEqual(pending.state.pendingEncounterChoice?.choices, ["health", "infamy"]);
  const resolved = applyCommand(pending.state, { type: "resolve-encounter", choice: "health" });
  assert.equal(resolved.state.monsters[0].health, 8);
  assert.equal(resolved.state.monsters[0].infamy, 0);
  assert.equal((resolved.eventPayload.effects as Array<{ type: string; amount: number }>).some((effect) => effect.type === "health" && effect.amount === 3), true);
});

test("Mutation sites are usable once per monster and do not invent a Health reward", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = K("dallas");
  state.monsters[0].health = 10;
  const first = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(first.state.monsters[0].health, 10);
  assert.deepEqual(first.state.mutationSiteUses["monster-1"], ["dallas"]);
  const secondState = { ...first.state, phase: "encounter" as const, pendingDecision: { type: "encounter-resolution" as const, playerIndex: 0, location: K("dallas") } };
  const second = applyCommand(secondState, { type: "resolve-encounter" });
  assert.deepEqual(second.state.mutationSiteUses["monster-1"], ["dallas"]);
  assert.equal(second.state.monsters[0].health, 10);
});

test("Mutation sites apply implemented card effects immediately and disclose gated cards", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = K("dallas");
  state.decks.mutation = { order: ["Fins and Gills"], drawIndex: 0, discard: [], exhausted: false };
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.deepEqual(result.state.players[0].mutationCardIds, ["Fins and Gills"]);
  assert.deepEqual(result.eventPayload.mutationDraws, [{ siteId: "dallas", cardDrawn: true, effectStatus: "implemented" }]);
  assert.match(result.state.log.at(-2) ?? "", /implemented effect is active immediately/);
});

test("Challenge sites are inert before the Monster Challenge is declared", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.monsters[0].location = K("miami");
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(result.state.stompMarkers, state.stompMarkers);
  assert.deepEqual(result.eventPayload.effects, []);
  assert.equal(result.state.phase, "deploy");
});

test("a post-declaration Challenge-site arrival replaces the pending challenger and starts at turn end", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.currentPlayer = 0;
  state.monsters[0].location = K("miami");
  state.challenge = {
    declared: true,
    active: false,
    challengerMonsterId: "monster-2",
    declarationPlayerIndex: 1,
    pendingStartPlayerIndex: 1,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: K("miami") };
  const reached = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(reached.state.challenge?.challengerMonsterId, "monster-1");
  assert.equal(reached.state.challenge?.startAtEndOfTurn, true);
  assert.equal(reached.state.phase, "deploy");
  const started = applyCommand(reached.state, { type: "pass-deploy" });
  assert.equal(started.state.phase, "challenge");
  assert.equal(started.state.currentPlayer, 0);
  assert.equal(started.state.challenge?.active, true);
});

test("stomps after Challenge declaration use extra markers without redeclaring", () => {
  const state = createGame(2);
  state.phase = "encounter";
  state.currentPlayer = 0;
  state.stompMarkers = 0;
  state.monsters[0].location = K("infamy-site");
  state.challenge = {
    declared: true,
    active: false,
    challengerMonsterId: "monster-2",
    declarationPlayerIndex: 1,
    pendingStartPlayerIndex: 1,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: K("infamy-site") };
  const result = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(result.state.stompMarkers, 0);
  assert.deepEqual(result.state.stompedLocations, [K("infamy-site")]);
  assert.equal(result.state.challenge?.challengerMonsterId, "monster-2");
  assert.equal(result.state.challenge?.declared, true);
  assert.equal((result.eventPayload.effects as Array<{ type: string }>).some((effect) => effect.type === "stomp"), true);
});

test("Konk applies its source-backed fighter attack modifier", () => {
  let attack: any;
  for (let seed = 0; seed < 128 && !attack; seed += 1) {
    const state = createGame(2, seed);
    state.currentPlayer = 0;
    state.monsters[0].name = "Konk";
    state.units[0].location = state.monsters[0].location;
    const navyFighter = state.units.find((unit) => unit.unitTypeId === "navy-fighter" && unit.id !== state.units[0].id)!;
    const originalType = state.units[0].unitTypeId;
    state.units[0].unitTypeId = "navy-fighter";
    navyFighter.unitTypeId = originalType;
    state.units[0].defense = 5;
    state.phase = "fight";
    state.pendingBattles = [{ id: "test-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[0].id] }];
    state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "test-battle" };
    const result = applyCommand(state, { type: "resolve-fight" });
    const first = (result.eventPayload.attacks as Array<{ roll: number; hit: boolean; modifiers: readonly string[] }>)[0];
    if (first?.roll === 4) attack = first;
  }
  assert.ok(attack, "a deterministic fixture with a roll of four should exist");
  assert.equal(attack.hit, true);
  assert.deepEqual(attack.modifiers, ["+1 to hit fighters"]);
});

test("Army Missile Launcher makes its source-backed pre-monster first-round attack", () => {
  const state = createGame(2, 0);
  state.currentPlayer = 0;
  state.monsters[0].health = 40;
  state.units[1].location = state.monsters[0].location;
  state.phase = "fight";
  state.pendingBattles = [{ id: "missile-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[1].id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "missile-battle" };
  const result = applyCommand(state, { type: "resolve-fight" });
  const first = (result.eventPayload.attacks as Array<{ attackerId: string; modifiers: readonly string[] }>)[0];
  assert.equal(first.attackerId, state.units[1].id);
  assert.deepEqual(first.modifiers, ["extra first-round attack before monster"]);
});

test("Air Force Cruise Missile is source-backed one-round hardware", () => {
  const state = createGame(2, 0);
  state.currentPlayer = 0;
  state.monsters[0].health = 40;
  state.units[5].location = state.monsters[0].location;
  state.phase = "fight";
  state.pendingBattles = [{ id: "cruise-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[5].id] }];
  state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "cruise-battle" };
  const result = applyCommand(state, { type: "resolve-fight" });
  assert.equal(result.state.units[5].location, "record-tile");
  assert.ok((result.eventPayload.destroyedUnitIds as string[]).includes(state.units[5].id));
  assert.equal((result.eventPayload.attacks as Array<{ attackerId: string }>).filter((attack) => attack.attackerId === state.units[5].id).length, 1);
});

test("Air Force Cruise Missile roll of one draws a face-up mutation card before later attacks", () => {
  let mutationResult: ReturnType<typeof applyCommand> | undefined;
  let missileId = "";
  for (let seed = 0; seed < 256 && !mutationResult; seed += 1) {
    const state = createGame(2, seed);
    state.currentPlayer = 0;
    state.monsters[0].health = 40;
    state.monsters[0].defense = 99;
    state.units[5].location = state.monsters[0].location;
    missileId = state.units[5].id;
    state.units[5].defense = 99;
    state.phase = "fight";
    state.pendingBattles = [{ id: "cruise-mutation-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [state.units[5].id] }];
    state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "cruise-mutation-battle" };
    const result = applyCommand(state, { type: "resolve-fight" });
    if ((result.eventPayload.attacks as Array<{ attackerId: string; roll: number }>).some((attack) => attack.attackerId === state.units[5].id && attack.roll === 1)) mutationResult = result;
  }
  assert.ok(mutationResult, "a deterministic seed with a cruise-missile mutation roll should exist");
  const mutationAttack = (mutationResult!.eventPayload.attacks as Array<{ attackerId: string; mutationCardId?: string }>).find((attack) => attack.attackerId === missileId && attack.mutationCardId);
  assert.ok(mutationAttack?.mutationCardId);
  assert.equal(mutationResult!.state.players[0].mutationCardIds.length, 1);
  assert.equal(mutationResult!.state.decks.mutation.drawIndex, 1);
  const reloaded = migrateGameState(JSON.parse(JSON.stringify(mutationResult!.state)) as GameState);
  assert.deepEqual(reloaded.players[0].mutationCardIds, mutationResult!.state.players[0].mutationCardIds);
  assert.equal(reloaded.decks.mutation.drawIndex, mutationResult!.state.decks.mutation.drawIndex);
});

test("a Cruise Missile mutation is active for later attacks in the same battle", () => {
  let resolved: ReturnType<typeof applyCommand> | undefined;
  for (let seed = 0; seed < 512 && !resolved; seed += 1) {
    const state = createGame(2, seed);
    state.currentPlayer = 0;
    state.monsters[0].attacks = 1;
    state.monsters[0].defense = 99;
    state.monsters[0].health = 40;
    const missile = state.units[5];
    const laterUnit = state.units[0];
    missile.location = state.monsters[0].location;
    laterUnit.location = state.monsters[0].location;
    missile.defense = 99;
    laterUnit.defense = 99;
    state.decks.mutation.order = ["Radiation Field", ...state.decks.mutation.order.filter((cardId) => cardId !== "Radiation Field")];
    state.phase = "fight";
    state.pendingBattles = [{ id: "cruise-sequencing-battle", monsterId: "monster-1", location: state.monsters[0].location as any, militaryUnitIds: [missile.id, laterUnit.id] }];
    state.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: "cruise-sequencing-battle" };
    const candidate = applyCommand(state, { type: "resolve-fight", battleId: "cruise-sequencing-battle", targetUnitId: missile.id });
    const attacks = candidate.eventPayload.attacks as Array<{ attackerId: string; roll: number; hit: boolean; modifiers: string[]; mutationCardId?: string }>;
    const laterAttack = attacks.find((attack) => attack.attackerId === laterUnit.id && attack.modifiers.includes("Radiation Field: attacker destroyed on roll 1"));
    const missileMutation = attacks.find((attack) => attack.attackerId === missile.id && attack.roll === 1 && attack.mutationCardId === "Radiation Field");
    if (laterAttack && missileMutation) resolved = candidate;
  }
  assert.ok(resolved, "a deterministic seed should draw Radiation Field before a later unit attack");
  assert.equal(resolved!.state.players[0].mutationCardIds.includes("Radiation Field"), true);
  assert.equal((resolved!.eventPayload.attacks as Array<{ modifiers: string[] }>).some((attack) => attack.modifiers.includes("Radiation Field: attacker destroyed on roll 1")), true);
});

test("encounter rewards, trophy removal, health, mutation history, and stomp state survive save/reload and replay", () => {
  const state = createGame(2, 23);
  state.setupAssignments = [
    { playerIndex: 0, monsterId: "monster-1", branch: "Army", lair: "los-angeles", startingChoice: { kind: "research" }, ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Navy", lair: "chicago", startingChoice: { kind: "research" }, ready: true },
  ];
  state.currentPlayer = 0;
  state.phase = "encounter";
  state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: K("denver") };
  state.monsters[0].location = K("denver");
  state.monsters[0].health = 23;
  state.monsters[0].infamy = 14;
  state.stompedLocations = [K("infamy-site")];
  state.mutationSiteUses = { "monster-1": ["dallas"] };
  state.players[0].mutationCardIds = ["Rampage"];

  const encountered = applyCommand(state, { type: "resolve-encounter" });
  assert.equal(encountered.state.monsters[0].health, 23);
  assert.equal(encountered.state.monsters[0].infamy, 15);
  assert.deepEqual(encountered.state.stompedLocations, [K("infamy-site"), K("denver")]);
  assert.equal(encountered.state.pendingDecision?.type, "trophy-choice");
  const trophyUnitId = encountered.state.pendingTrophyChoice!.unitIds[0];

  const reloaded = migrateGameState(JSON.parse(JSON.stringify(encountered.state)) as GameState);
  assert.equal(reloaded.monsters[0].health, encountered.state.monsters[0].health);
  assert.equal(reloaded.monsters[0].infamy, encountered.state.monsters[0].infamy);
  assert.deepEqual(reloaded.stompedLocations, encountered.state.stompedLocations);
  assert.deepEqual(reloaded.mutationSiteUses, encountered.state.mutationSiteUses);
  assert.deepEqual(reloaded.players[0].mutationCardIds, encountered.state.players[0].mutationCardIds);
  assert.deepEqual(reloaded.pendingTrophyChoice, encountered.state.pendingTrophyChoice);

  const chosen = applyCommand(encountered.state, { type: "resolve-encounter", trophyUnitId });
  const replayed = applyCommand(reloaded, { type: "resolve-encounter", trophyUnitId });
  assert.equal(JSON.stringify(replayed.state), JSON.stringify(chosen.state));
  assert.equal(replayed.state.removedUnitIds.includes(trophyUnitId), true);
  assert.equal(replayed.state.units.find((unit) => unit.id === trophyUnitId)?.location, "permanently-removed");
});

test("encounter health-roll dice are recorded in the authoritative event payload", () => {
  const state = createGame(2, 29);
  state.currentPlayer = 0;
  state.phase = "encounter";
  state.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: K("san-francisco") };
  state.monsters[0].location = K("san-francisco");
  state.monsters[0].health = 10;
  const result = applyCommand(state, { type: "resolve-encounter", choice: "health" });
  const rolls = result.eventPayload.rolls as number[];
  assert.equal(rolls.length, 2);
  assert.ok(rolls.every((roll) => roll >= 1 && roll <= 6));
  assert.equal(result.eventType, "encounter.resolved");
});

test("development city markers resolve fixed and dice health benefits with the cap", () => {
  const fixed = createGame(2, 11);
  fixed.currentPlayer = 0;
  fixed.phase = "encounter";
  fixed.monsters[0].location = K("chicago");
  fixed.monsters[0].health = 10;
  const fixedResult = applyCommand(fixed, { type: "resolve-encounter", choice: "health" });
  assert.equal(fixedResult.state.monsters[0].health, 12);
  assert.deepEqual(fixedResult.eventPayload.effects, [
    { type: "health", amount: 2, source: "chicago" },
    { type: "stomp", amount: 1, source: "chicago" },
  ]);

  const dice = createGame(2, 11);
  dice.currentPlayer = 0;
  dice.phase = "encounter";
  dice.monsters[0].location = K("los-angeles");
  dice.monsters[0].health = 39;
  const diceResult = applyCommand(dice, { type: "resolve-encounter", choice: "health" });
  assert.equal(diceResult.state.monsters[0].health, 40);
  assert.equal(diceResult.state.rng.cursor, 3);
  assert.equal((diceResult.eventPayload.effects as Array<{ type: string; amount: number }>).find((effect) => effect.type === "health")?.amount, 1);
});
