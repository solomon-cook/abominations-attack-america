import assert from "node:assert/strict";
import {
  applyCommand,
  applyCompletedSetup,
  boardForState,
  chooseBranch,
  chooseLair,
  chooseMonster,
  chooseStartingChoice,
  createMvpRoomGame,
  legalGiantPlacementDestinations,
  legalMonsterPaths,
  shortestLegalUnitPaths,
  type GameState,
} from "../packages/game-engine/src/index.js";
import { deploymentChoices } from "../apps/web/src/components/MilitarySheet.js";
import { botActionDelayMs, botStrategyHint, botTacticForPlayer, chooseBotCommand, chooseBotSetupAction, hasBotLaserFenceReaction, routeBlockScores, runBotActionWithExplanation, runBotTurnWithExplanation } from "../apps/web/src/solo-bots.js";

function createSoloMatch(humanMonsterId: string): GameState {
  const game = createMvpRoomGame(2, 37);
  let setup = game.setupState!;
  setup = chooseMonster(setup, 0, humanMonsterId);
  setup = chooseBotSetupAction(game, setup, 1);
  assert.equal(setup.phase, "branch-selection");
  setup = chooseBotSetupAction({ ...game, setupState: setup }, setup, 1);
  const botBranch = setup.seats[1]!.branch!;
  const humanBranch = setup.definition.eligibleBranches.find((branch) => branch !== botBranch)!;
  setup = chooseBranch(setup, 0, humanBranch);
  setup = chooseLair(setup, 0, setup.definition.lairsByMonster[setup.seats[0]!.monsterId!]![0]!);
  setup = chooseBotSetupAction({ ...game, setupState: setup }, setup, 1);
  setup = chooseStartingChoice(setup, 0, { kind: "research" });
  setup = chooseBotSetupAction({ ...game, setupState: setup }, setup, 1);
  assert.equal(setup.phase, "complete");
  assert.equal(setup.seats[1]!.startingChoice?.kind, "deploy", "bots should field a starting force when the branch base permits it");
  const started = applyCompletedSetup({ ...game, setupState: setup });
  return started;
}

function createAllBotMatch(playerCount: 2 | 3 | 4, seed: number): GameState {
  const game = createMvpRoomGame(playerCount, seed, `all-bot-${playerCount}-${seed}`);
  let setup = game.setupState!;
  for (let step = 0; setup.phase !== "complete" && step < playerCount * 4; step += 1) {
    let playerIndex: number;
    if (setup.phase === "monster-selection" || setup.phase === "starting-choice") {
      playerIndex = setup.seats.find((seat) => seat[setup.phase === "monster-selection" ? "monsterId" : "startingChoice"] === undefined)!.playerIndex;
    } else if (setup.phase === "branch-selection") {
      playerIndex = [...setup.seats].reverse().find((seat) => !seat.branch)!.playerIndex;
    } else {
      playerIndex = setup.seats.find((seat) => !seat.lair)!.playerIndex;
    }
    const next = chooseBotSetupAction({ ...game, setupState: setup }, setup, playerIndex);
    assert.notEqual(next, setup, `bot setup should advance ${setup.phase} for seat ${playerIndex}`);
    setup = next;
  }
  assert.equal(setup.phase, "complete", `${playerCount}-seat bot setup should complete`);
  assert.equal(new Set(setup.seats.map((seat) => seat.monsterId)).size, playerCount);
  assert.equal(new Set(setup.seats.map((seat) => seat.branch)).size, playerCount);
  assert.equal(new Set(setup.seats.map((seat) => seat.lair)).size, playerCount);
  return applyCompletedSetup({ ...game, setupState: setup });
}

interface BotMatchMetrics {
  playerCount: 3 | 4;
  seed: number;
  actions: number;
  turns: number;
  turnsBySeat: number[];
  commandsBySeat: number[];
  invalidActions: number;
  winnerPlayer?: number;
  victoryType?: GameState["victoryType"];
  terminal: boolean;
}

function playAllBotMatch(playerCount: 3 | 4, seed: number, maxActions = 80): BotMatchMetrics {
  let state = createAllBotMatch(playerCount, seed);
  const botSeats = new Set(state.players.map((_, index) => index));
  let actions = 0;
  let turns = 0;
  let invalidActions = 0;
  const commandsBySeat = Array.from({ length: playerCount }, () => 0);
  const turnsBySeat = Array.from({ length: playerCount }, () => 0);
  while (state.phase !== "game-over" && actions < maxActions && turnsBySeat.some((count) => count < 1)) {
    const command = chooseBotCommand(state, botSeats);
    assert.ok(command, `all-bot match should have a command at action ${actions + 1} (seat=${state.currentPlayer}, phase=${state.phase}, decision=${state.pendingDecision?.type})`);
    const actor = state.pendingDecision && "playerIndex" in state.pendingDecision ? state.pendingDecision.playerIndex : state.currentPlayer;
    commandsBySeat[actor]! += 1;
    try {
      state = applyCommand(state, command!).state;
    } catch (error) {
      invalidActions += 1;
      assert.fail(`bot selected an invalid command in ${playerCount}-seat match at action ${actions + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    actions += 1;
    if (state.eventLog.at(-1)?.action === "turn.passed") {
      turns += 1;
      turnsBySeat[actor]! += 1;
    }
  }
  return {
    playerCount,
    seed,
    actions,
    turns,
    turnsBySeat,
    commandsBySeat,
    invalidActions,
    winnerPlayer: state.winnerPlayer,
    victoryType: state.victoryType,
    terminal: state.phase === "game-over",
  };
}

function beginBotMove(state: GameState): GameState {
  const next = structuredClone(state);
  next.currentPlayer = 1;
  next.phase = "move";
  next.pendingDecision = { type: "monster-movement", playerIndex: 1, pieceId: next.monsters[1]!.id };
  next.movedPieceIds = [];
  next.pendingBattles = [];
  next.pendingRetreat = undefined;
  next.pendingCombat = undefined;
  next.pendingAttackTarget = undefined;
  next.laserFenceWindowMonsterIds = [];
  next.encounterSuppressed = false;
  return next;
}

function stateWithTactic(state: GameState, tactic: "force-first" | "research-first"): GameState {
  for (let seed = 0; seed < 100; seed += 1) {
    const candidate = structuredClone(state);
    candidate.rng.seed = seed;
    candidate.matchId = `tactic-test-${seed}`;
    if (botTacticForPlayer(candidate, 1) === tactic) return candidate;
  }
  throw new Error(`Could not select ${tactic} for test fixture`);
}

// The bot counters Konk with a monster plan and selects a legal branch counter,
// and prefers legal starting deployments over a blind Research draw.
const konkMatch = createSoloMatch("monster-5");
const tacticStyles = new Set(Array.from({ length: 40 }, (_, seed) => {
  const sample = structuredClone(konkMatch);
  sample.rng.seed = seed;
  sample.matchId = `tactic-balance-${seed}`;
  const tactic = botTacticForPlayer(sample, 1);
  assert.equal(botTacticForPlayer(sample, 1), tactic, "a bot should keep its tactic throughout the match");
  return tactic;
}));
assert.deepEqual([...tacticStyles].sort(), ["force-first", "research-first"]);
assert.equal(konkMatch.monsters[1]!.name, "Gargantis");
assert.ok(["Army", "Marines"].includes(konkMatch.setupAssignments?.[1]?.branch ?? ""));
assert.ok(konkMatch.units.filter((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile").length >= 1);
const monsterTactics: Record<string, string> = {
  Konk: "speed to stomp objectives",
  Zorb: "Build Infamy at cities",
  Megaclaw: "break isolated screens",
  Gargantis: "Mutation cards available as healing reserves",
  Toxicor: "make attackers think twice",
  Tomanagi: "Contest central objectives",
};
const branchTactics: Record<string, string> = {
  Army: "screen threatened cities and Army bases",
  Navy: "Cover coastal cities and Navy bases",
  "Air Force": "Spread fighters across threatened cities and bases",
  Marines: "Guard the most threatened city approaches",
};
for (const [monster, tactic] of Object.entries(monsterTactics)) {
  for (const [branch, branchTactic] of Object.entries(branchTactics)) {
    const hint = botStrategyHint(monster, branch);
    assert.ok(hint.includes(tactic), `expected a monster tactic for ${monster}`);
    assert.ok(hint.includes(branchTactic), `expected a branch tactic for ${branch}`);
  }
}

const toxicorMutationState = structuredClone(konkMatch);
toxicorMutationState.monsters[1]!.name = "Toxicor";
toxicorMutationState.currentPlayer = 1;
toxicorMutationState.pendingDecision = { type: "mutation-choice", playerIndex: 1, monsterId: toxicorMutationState.monsters[1]!.id, cardIds: ["Rampage", "High-Octane Blood"] };
assert.deepEqual(chooseBotCommand(toxicorMutationState), { type: "choose-mutation-card", cardId: "High-Octane Blood" }, "Toxicor should take a mutation that gives it attack priority in a Monster Challenge");

const toxicorChallenge = structuredClone(konkMatch);
const toxicor = toxicorChallenge.monsters[1]!;
toxicor.name = "Toxicor";
toxicor.health = 15;
toxicorChallenge.currentPlayer = 1;
toxicorChallenge.phase = "challenge";
toxicorChallenge.players[1]!.mutationCardIds = ["Son of a Monster", "Berserk"];
toxicorChallenge.challenge = {
  declared: true,
  active: true,
  challengerMonsterId: toxicor.id,
  opponentMonsterId: toxicorChallenge.monsters[0]!.id,
  declarationPlayerIndex: 1,
  pendingStartPlayerIndex: 1,
  weighInHealth: {},
  defeatedMonsterIds: [],
  turn: { attackerId: toxicor.id, firstAttackerId: toxicor.id, round: 1, remainingAttacks: toxicor.attacks, attacks: [] },
};
toxicorChallenge.pendingDecision = { type: "challenge-resolution", playerIndex: 1, challengerMonsterId: toxicor.id, opponentMonsterId: toxicorChallenge.monsters[0]!.id };
const toxicorChallengeCommand = chooseBotCommand(toxicorChallenge);
assert.deepEqual(toxicorChallengeCommand, { type: "use-mutation", cardId: "Son of a Monster" }, "Toxicor should heal and add challenge attacks before its duel turn");
const toxicorAfterSon = applyCommand(toxicorChallenge, toxicorChallengeCommand!).state;
assert.ok(toxicorAfterSon.monsters[1]!.health > 15);
assert.equal(toxicorAfterSon.challenge?.turn?.remainingAttacks, toxicor.attacks + 2);
assert.deepEqual(chooseBotCommand(toxicorAfterSon), { type: "use-mutation", cardId: "Berserk" }, "Toxicor should spend Berserk for extra Monster Challenge attacks");

const toxicorMoveState = beginBotMove(konkMatch);
toxicorMoveState.monsters[0]!.health = 0;
const movingToxicor = toxicorMoveState.monsters[1]!;
movingToxicor.name = "Toxicor";
movingToxicor.movement = "land-lake";
const movementBoard = boardForState(toxicorMoveState);
let healthAndMutationRoutes = false;
for (const start of Object.keys(movementBoard.hexes) as Array<keyof typeof movementBoard.hexes>) {
  movingToxicor.location = start;
  const destinations = new Set(legalMonsterPaths(toxicorMoveState, movingToxicor.id).map((path) => path.at(-1)!));
  const hasCity = [...destinations].some((key) => movementBoard.hexes[key]?.features.some((feature) => feature.kind === "city"));
  const hasMutation = [...destinations].some((key) => movementBoard.hexes[key]?.features.some((feature) => feature.kind === "mutation-site" && !(toxicorMoveState.mutationSiteUses[movingToxicor.id] ?? []).includes(feature.siteId)));
  if (hasCity && hasMutation) { healthAndMutationRoutes = true; break; }
}
assert.ok(healthAndMutationRoutes, "the test board should offer Toxicor both a city and Mutation site within movement range");
movingToxicor.health = 15;
const healthRoute = chooseBotCommand(toxicorMoveState);
assert.equal(healthRoute?.type, "move");
if (healthRoute?.type !== "move") throw new Error("Expected Toxicor to move toward healing while below 20 Health.");
assert.ok(movementBoard.hexes[healthRoute.path.at(-1)!]?.features.some((feature) => feature.kind === "city"), "Toxicor should choose the health gain before reaching 20 Health");
movingToxicor.health = 20;
const mutationRoute = chooseBotCommand(toxicorMoveState);
assert.equal(mutationRoute?.type, "move");
if (mutationRoute?.type !== "move") throw new Error("Expected Toxicor to move toward a Mutation site once it reaches 20 Health.");
assert.ok(movementBoard.hexes[mutationRoute.path.at(-1)!]?.features.some((feature) => feature.kind === "mutation-site"), "Toxicor should pivot to Mutation sites at 20 Health");

const highCityState = beginBotMove(konkMatch);
const highCityMonster = highCityState.monsters[1]!;
highCityMonster.name = "Konk";
highCityMonster.movement = "land-only";
highCityMonster.move = 4;
highCityState.monsters[0]!.health = 0;
highCityState.monsters[0]!.location = "defeated";
highCityState.units.forEach((unit) => { unit.location = "record-tile"; });
const highCityBoard = boardForState(highCityState);
const rollCities = Object.values(highCityBoard.hexes).flatMap((hex) => {
  const city = hex.features.find((feature) => feature.kind === "city");
  return city?.benefit.kind === "health-roll" && city.benefit.dice >= 2 ? [{ key: hex.key, dice: city.benefit.dice }] : [];
}).sort((a, b) => b.dice - a.dice);
assert.ok(rollCities.length >= 1, "the board should contain a high-roll city");
let bestRollCity: typeof rollCities[number] | undefined;
let highCityScenario = false;
for (const start of Object.keys(highCityBoard.hexes) as Array<keyof typeof highCityBoard.hexes>) {
  highCityMonster.location = start;
  const destinations = new Set(legalMonsterPaths(highCityState, highCityMonster.id).map((path) => path.at(-1)!));
  bestRollCity = rollCities.find((city) => destinations.has(city.key));
  if (!bestRollCity) continue;
  highCityState.stompedLocations = Object.keys(highCityBoard.hexes).filter((key) => key !== start && key !== bestRollCity!.key) as typeof highCityState.stompedLocations;
  highCityScenario = true;
  break;
}
assert.ok(highCityScenario && bestRollCity, "Konk should be able to reach a high-roll city in the movement fixture");
const highCityMove = chooseBotCommand(highCityState);
assert.equal(highCityMove?.type, "move");
if (highCityMove?.type !== "move") throw new Error("Expected Konk to choose a high-roll city route.");
assert.equal(highCityMove.path.at(-1), bestRollCity.key, "a monster without a conflicting objective plan should prefer a high-roll city");

// Bots randomly commit to a force-first or research-first policy for the full match.
const researchMatch = createSoloMatch("monster-4");
const researchState = structuredClone(researchMatch);
researchState.currentPlayer = 1;
researchState.phase = "deploy";
researchState.pendingDecision = { type: "deployment", playerIndex: 1 };
researchState.deploymentsThisTurn = 0;
researchState.deploymentDestinations = [];
const researchBoard = boardForState(researchState);
const objectives = Object.values(researchBoard.hexes).filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site"));
const safeHex = Object.values(researchBoard.hexes).sort((a, b) => {
  const minDistance = (key: string) => Math.min(...objectives.map((site) => {
    const left = researchBoard.hexes[key as keyof typeof researchBoard.hexes]!.coord;
    const right = site.coord;
    const dq = left.q - right.q;
    const dr = left.r - right.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }));
  return minDistance(b.key) - minDistance(a.key);
})[0]!;
researchState.monsters[0]!.location = safeHex.key;
researchState.monsters[0]!.infamy = 0;
researchState.monsters.forEach((monster) => { monster.health = 0; });
const forceFirstState = stateWithTactic(researchState, "force-first");
assert.notEqual(chooseBotCommand(forceFirstState)?.type, "draw-research", "force-first bots should field more units before taking optional Research");
const researchFirstState = stateWithTactic(researchState, "research-first");
assert.equal(chooseBotCommand(researchFirstState)?.type, "draw-research", "research-first bots should draw early once a screen is deployed");
const deployedAtStart = researchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile" && unit.location !== "permanently-removed").length;
assert.ok(deployedAtStart < 3, "the scenario should begin below the bot's three-unit attack group threshold");
assert.notEqual(chooseBotCommand(researchState)?.type, "draw-research", "the bot should deploy its force before taking optional Research");
const attackHex = deploymentChoices(forceFirstState).flatMap((choice) => choice.destinations)[0];
assert.ok(attackHex, "the bot should have a legal destination for the attack timing scenario");
const cautiousAttackState = structuredClone(forceFirstState);
cautiousAttackState.monsters[0]!.health = cautiousAttackState.monsters[0]!.maxHealth;
cautiousAttackState.monsters[0]!.location = attackHex;
const cautiousAttack = chooseBotCommand(cautiousAttackState);
assert.ok(cautiousAttack?.type === "deploy" || cautiousAttack?.type === "redeploy");
assert.notEqual(cautiousAttack.destination, attackHex, "the bot should not start a healthy-monster fight with an undersized force");
const establishedResearchState = structuredClone(researchFirstState);
const reserveUnits = establishedResearchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location === "record-tile");
for (const unit of reserveUnits) {
  if (establishedResearchState.units.filter((candidate) => candidate.ownerPlayer === 1 && candidate.location !== "record-tile" && candidate.location !== "permanently-removed").length >= 3) break;
  unit.location = safeHex.key;
}
assert.ok(establishedResearchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile" && unit.location !== "permanently-removed").length >= 3);
assert.equal(chooseBotCommand(establishedResearchState)?.type, "draw-research", "research-first bots should continue drawing when no monster route is urgent");

// A high-Infamy monster beside an objective turns the same choice into a deployment to defend.
const threatenedState = structuredClone(researchState);
const threatenedCity = objectives.find((hex) => hex.features.some((feature) => feature.kind === "city"))!;
threatenedState.monsters[0]!.location = threatenedCity.key;
threatenedState.monsters[0]!.health = threatenedState.monsters[0]!.maxHealth;
threatenedState.monsters[0]!.infamy = 3;
assert.notEqual(chooseBotCommand(threatenedState)?.type, "draw-research");

// Bot Laser Fence is a legal off-turn reaction and gives the player a concise explanation.
const fenceState = structuredClone(konkMatch);
const fenceBoard = boardForState(fenceState);
const fenceHex = Object.values(fenceBoard.hexes).find((hex) => fenceBoard.edges.some((edge) => edge.enabled && edge.from === hex.key));!
fenceState.units.forEach((unit) => { unit.location = "record-tile"; });
fenceState.monsters[0]!.location = fenceHex.key;
fenceState.monsters[0]!.infamy = 1;
fenceState.monsters[1]!.location = fenceBoard.hexes[fenceHex.key]!.key === fenceState.monsters[1]!.location ? "hollywood" : fenceState.monsters[1]!.location;
fenceState.players[1]!.researchCardIds = ["Laser Fence"];
fenceState.phase = "move";
fenceState.currentPlayer = 0;
fenceState.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: fenceState.monsters[0]!.id };
fenceState.laserFenceWindowMonsterIds = [fenceState.monsters[0]!.id];
assert.equal(hasBotLaserFenceReaction(fenceState), true);
const fenceCommand = chooseBotCommand(fenceState);
assert.equal(fenceCommand?.type, "use-research");
if (fenceCommand?.type !== "use-research") throw new Error("Expected a Laser Fence reaction.");
const fenced = applyCommand(fenceState, fenceCommand).state;
assert.equal(fenced.players[1]!.researchCardIds.includes("Laser Fence"), false);
assert.equal(fenced.monsters[0]!.location === fenceHex.key, false, "with less than 2 Infamy, the target must retreat");

// A whole bot turn uses legal commands and returns control to the human with a rationale.
const botTurn = runBotTurnWithExplanation(beginBotMove(konkMatch));
assert.equal(botTurn.state.currentPlayer, 0, `the engine should return control to the human after the bot's turn (phase=${botTurn.state.phase}, decision=${botTurn.state.pendingDecision?.type}, actions=${botTurn.state.eventLog.length - konkMatch.eventLog.length})`);
assert.ok(botTurn.state.eventLog.length > konkMatch.eventLog.length, "the bot should resolve real engine actions");
assert.ok(botTurn.explanation.length > 0, "the bot should explain its tactical plan");
const firstBotInput = beginBotMove(konkMatch);
const firstBotStep = runBotActionWithExplanation(firstBotInput);
assert.ok(firstBotStep.command, "the UI runner should expose one bot command at a time");
assert.ok(firstBotStep.state !== firstBotInput, "one bot step should apply only its selected action");
const botUnitMoveFixture = beginBotMove(konkMatch);
const movingBotUnit = botUnitMoveFixture.units.find((unit) => unit.ownerPlayer === 1 && shortestLegalUnitPaths(botUnitMoveFixture, unit.id).length > 0);
assert.ok(movingBotUnit, "the bot fixture should have an available military route");
botUnitMoveFixture.pendingDecision = { type: "monster-movement", playerIndex: 1, pieceId: movingBotUnit.id };
botUnitMoveFixture.movedPieceIds = [botUnitMoveFixture.monsters[1]!.id];
const botUnitMove = runBotActionWithExplanation(botUnitMoveFixture);
assert.equal(botUnitMove.command?.type, "move-unit", "the bot should move a military unit along its selected route");
assert.equal(botUnitMove.state.eventLog.at(-1)?.action, "unit.moved", "the accepted bot unit move should be available to animate from its event path");
assert.deepEqual(botUnitMove.state.eventLog.at(-1)?.detail.path, botUnitMove.command?.type === "move-unit" ? botUnitMove.command.path : undefined, "the authoritative unit.moved event should carry the complete route consumed by the board animation");
assert.ok(botActionDelayMs({ type: "move", path: ["0,0", "1,0", "2,0"] }) >= 1200, "multi-hex bot movement should wait for its board animation to finish");
assert.equal(botActionDelayMs({ type: "move", path: ["0,0", "1,0", "2,0"] }, true), 650, "reduced motion should not retain the movement animation delay");
assert.ok(botActionDelayMs(botUnitMove.command!) >= 650, "the bot should allow time for a military route animation to finish");
let pacedTurn = beginBotMove(konkMatch);
for (let action = 0; action < 30 && pacedTurn.currentPlayer === 1 && pacedTurn.phase !== "game-over"; action += 1) {
  const step = runBotActionWithExplanation(pacedTurn);
  assert.ok(step.command && step.state !== pacedTurn, `paced bot action ${action + 1} should advance the turn`);
  pacedTurn = step.state;
}
assert.equal(pacedTurn.currentPlayer, 0, `one-action bot playback should hand control back after Deploy (phase=${pacedTurn.phase})`);

// A force of two or more military units arms Antimatter at the legal start of its battle.
const antimatterState = structuredClone(konkMatch);
const battleHex = antimatterState.monsters[0]!.location;
const attackers = antimatterState.units.filter((unit) => unit.ownerPlayer === 1).slice(0, 2);
assert.equal(attackers.length, 2);
attackers.forEach((unit) => { unit.location = battleHex; });
antimatterState.currentPlayer = 1;
antimatterState.phase = "fight";
antimatterState.pendingBattles = [{ id: "solo-antimatter", monsterId: antimatterState.monsters[0]!.id, location: battleHex as `${number},${number}`, militaryUnitIds: attackers.map((unit) => unit.id) }];
antimatterState.pendingDecision = { type: "battle-resolution", playerIndex: 1, battleId: "solo-antimatter" };
antimatterState.players[1]!.researchCardIds = ["Antimatter"];
const antimatterCommand = chooseBotCommand(antimatterState);
assert.deepEqual(antimatterCommand, { type: "use-research", cardId: "Antimatter", battleId: "solo-antimatter" });
assert.equal(applyCommand(antimatterState, antimatterCommand!).state.pendingBattles[0]!.antimatterActive, true);

const satelliteState = structuredClone(konkMatch);
satelliteState.currentPlayer = 1;
satelliteState.phase = "move";
satelliteState.pendingDecision = { type: "monster-movement", playerIndex: 1, pieceId: satelliteState.monsters[1]!.id };
satelliteState.players[1]!.researchCardIds = ["Defense Satellites"];
satelliteState.monsters[0]!.health = 1;
assert.deepEqual(chooseBotCommand(satelliteState), { type: "use-research", cardId: "Defense Satellites" });

// Giant Research cards do not consume the branch allowance, so place Mecha-Monster even after ordinary Deploy is exhausted.
const mechaState = structuredClone(konkMatch);
mechaState.currentPlayer = 1;
mechaState.phase = "deploy";
mechaState.pendingDecision = { type: "deployment", playerIndex: 1 };
mechaState.deploymentsThisTurn = 99;
mechaState.players[1]!.researchCardIds.push("Mecha-Monster");
const mechaDestinations = legalGiantPlacementDestinations(mechaState);
assert.ok(mechaDestinations.length > 0);
const mechaCommand = chooseBotCommand(mechaState);
assert.deepEqual(mechaCommand, { type: "use-research", cardId: "Mecha-Monster", destination: mechaDestinations.sort()[0] });
const mechaPlaced = applyCommand(mechaState, mechaCommand!).state;
assert.equal(mechaPlaced.players[1]!.researchCardIds.includes("Mecha-Monster"), false);
assert.ok(mechaPlaced.units.some((unit) => unit.unitTypeId === "mecha-monster" && unit.ownerPlayer === 1 && unit.location !== "record-tile"));
const mechaFollowUp = chooseBotCommand(mechaPlaced);
assert.equal(mechaFollowUp?.type, "pass-deploy", "after placing Mecha-Monster, the bot should end an exhausted Deploy step");
assert.equal(applyCommand(mechaPlaced, mechaFollowUp!).state.currentPlayer, 0, "the bot should return control after placing its giant");

// Army route maps should expose legal approach spaces to unclaimed objectives for blocking.
const routeState = beginBotMove(konkMatch);
routeState.setupAssignments![1]!.branch = "Army";
const routes = legalMonsterPaths(routeState, konkMatch.monsters[0]!.id);
assert.ok(routes.length > 0, "the enemy monster should have legal routes for blocker evaluation");
for (const branch of ["Army", "Navy", "Air Force", "Marines"] as const) {
  routeState.setupAssignments![1]!.branch = branch;
  const defenseScores = routeBlockScores(routeState, 1, branch);
  assert.ok(defenseScores.size > 0, `${branch} route scoring should identify spaces where a blocker can intercept objective routes`);
  assert.ok([...defenseScores.keys()].some((key) => boardForState(routeState).hexes[key]?.features.some((feature) => feature.kind === "city")), `${branch} should cover 3D city spaces`);
  assert.ok([...defenseScores.keys()].some((key) => boardForState(routeState).hexes[key]?.features.some((feature) => feature.kind === "military-base")), `${branch} should cover military base spaces`);
}

// Deterministic bot runs complete one turn for every seat at each supported multiplayer size.
const multiplayerBotMatches = [playAllBotMatch(3, 303), playAllBotMatch(4, 404)];
for (const metrics of multiplayerBotMatches) {
  assert.equal(metrics.invalidActions, 0, `${metrics.playerCount}-seat bot match should not emit invalid actions`);
  assert.ok(metrics.actions > metrics.turns, `${metrics.playerCount}-seat match should exercise multiple actions per turn`);
  assert.ok(metrics.turns >= metrics.playerCount, `${metrics.playerCount}-seat match should hand off control through a complete round`);
  assert.ok(metrics.turnsBySeat.every((count) => count >= 1), `${metrics.playerCount}-seat match should complete one turn for every bot`);
  assert.ok(metrics.commandsBySeat.every((count) => count > 0), `${metrics.playerCount}-seat match should exercise every bot seat`);
  if (metrics.terminal) {
    assert.ok(metrics.winnerPlayer !== undefined && metrics.winnerPlayer >= 0 && metrics.winnerPlayer < metrics.playerCount);
    assert.ok(metrics.victoryType, `${metrics.playerCount}-seat match should record its victory condition`);
  }
}
console.log(`Solo bot verification passed. Multiplayer match metrics: ${multiplayerBotMatches.map((match) => `${match.playerCount} seats: ${match.terminal ? `winner=${match.winnerPlayer} (${match.victoryType})` : "winner=not reached in one-round sample"}, actions=${match.actions}, turns=${match.turns}, turns by seat=[${match.turnsBySeat.join(",")}], actions by seat=[${match.commandsBySeat.join(",")}], invalid=${match.invalidActions}`).join("; ")}.`);
