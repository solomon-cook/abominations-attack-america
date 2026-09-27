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
  type GameState,
} from "../packages/game-engine/src/index.js";
import { deploymentChoices } from "../apps/web/src/components/MilitarySheet.js";
import { botActionDelayMs, botStrategyHint, chooseBotCommand, chooseBotSetupAction, hasBotLaserFenceReaction, routeBlockScores, runBotActionWithExplanation, runBotTurnWithExplanation } from "../apps/web/src/solo-bots.js";

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

// The bot counters Konk with a monster plan and selects a legal branch counter,
// and prefers legal starting deployments over a blind Research draw.
const konkMatch = createSoloMatch("monster-5");
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
  Army: "Block the next city or lair with tanks",
  Navy: "Use fighters to close distance",
  "Air Force": "Mass fighters",
  Marines: "Bring rocket launchers together",
};
for (const [monster, tactic] of Object.entries(monsterTactics)) {
  for (const [branch, branchTactic] of Object.entries(branchTactics)) {
    const hint = botStrategyHint(monster, branch);
    assert.ok(hint.includes(tactic), `expected a monster tactic for ${monster}`);
    assert.ok(hint.includes(branchTactic), `expected a branch tactic for ${branch}`);
  }
}

// When the force is assembled and there is no immediate objective threat, Research is the better Deploy action.
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
researchState.monsters.forEach((monster, index) => { if (index !== 1) monster.health = 0; });
const deployedAtStart = researchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile" && unit.location !== "permanently-removed").length;
assert.ok(deployedAtStart < 3, "the scenario should begin below the bot's three-unit attack group threshold");
assert.notEqual(chooseBotCommand(researchState)?.type, "draw-research", "the bot should deploy its force before taking optional Research");
const attackHex = deploymentChoices(researchState).flatMap((choice) => choice.destinations)[0];
assert.ok(attackHex, "the bot should have a legal destination for the attack timing scenario");
const cautiousAttackState = structuredClone(researchState);
cautiousAttackState.monsters[0]!.health = cautiousAttackState.monsters[0]!.maxHealth;
cautiousAttackState.monsters[0]!.location = attackHex;
const cautiousAttack = chooseBotCommand(cautiousAttackState);
assert.ok(cautiousAttack?.type === "deploy" || cautiousAttack?.type === "redeploy");
assert.notEqual(cautiousAttack.destination, attackHex, "the bot should not start a healthy-monster fight with an undersized force");
const establishedResearchState = structuredClone(researchState);
const reserveUnits = establishedResearchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location === "record-tile");
for (const unit of reserveUnits) {
  if (establishedResearchState.units.filter((candidate) => candidate.ownerPlayer === 1 && candidate.location !== "record-tile" && candidate.location !== "permanently-removed").length >= 3) break;
  unit.location = safeHex.key;
}
assert.ok(establishedResearchState.units.filter((unit) => unit.ownerPlayer === 1 && unit.location !== "record-tile" && unit.location !== "permanently-removed").length >= 3);
assert.equal(chooseBotCommand(establishedResearchState)?.type, "draw-research", "after assembling three units, Research is a valid fallback when no monster route is urgent");

// A high-Infamy monster beside an objective turns the same choice into a deployment to defend.
const threatenedState = structuredClone(researchState);
const threatenedCity = objectives.find((hex) => hex.features.some((feature) => feature.kind === "city"))!;
threatenedState.monsters[0]!.location = threatenedCity.key;
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
assert.ok(botActionDelayMs({ type: "move", path: ["0,0", "1,0", "2,0"] }) >= 1200, "multi-hex bot movement should wait for its board animation to finish");
assert.equal(botActionDelayMs({ type: "move", path: ["0,0", "1,0", "2,0"] }, true), 650, "reduced motion should not retain the movement animation delay");
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
  assert.ok(routeBlockScores(routeState).size > 0, `${branch} route scoring should identify spaces where a blocker can intercept objective routes`);
}
console.log("Solo bots choose counters and starting forces, draw or deploy based on threat, react with Laser Fence, use Research at battle timing, and finish a turn with an explanation.");
