import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyCommand,
  boardForState,
  createGame,
  deploymentChoices,
  type GameState,
} from "../packages/game-engine/src/index.js";
import { botTacticForPlayer, chooseBotCommand, routeBlockScores, type BotDeployDecisionDiagnostics, type BotTactic } from "../packages/game-engine/src/bots.js";

const SEED = 23;
const MATCH_ID = "bot-research-draw-eligibility-probe-2026-09-28";
const ACTOR = 1;
const POLICIES: readonly BotTactic[] = ["force-first", "research-first"];

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function makeEligibleState(): GameState {
  const state = createGame(2, SEED, MATCH_ID);
  state.currentPlayer = ACTOR;
  state.phase = "deploy";
  state.pendingDecision = { type: "deployment", playerIndex: ACTOR };
  state.deploymentsThisTurn = 0;
  state.deploymentDestinations = [];
  state.monsters.forEach((monster, index) => {
    if (index !== ACTOR) monster.health = 0;
  });

  const actorMonster = state.monsters[ACTOR];
  assert.ok(actorMonster && boardForState(state).hexes[actorMonster.location as keyof ReturnType<typeof boardForState>["hexes"]], "the focal monster must start on a board hex");
  let screen = state.units.find((unit) => unit.ownerPlayer === ACTOR
    && unit.location !== "record-tile"
    && unit.location !== "permanently-removed");
  if (!screen) {
    screen = state.units.find((unit) => unit.ownerPlayer === ACTOR);
    assert.ok(screen, "the focal player must own a military unit for the controlled screen fixture");
    screen.location = actorMonster.location;
  }

  assert.equal(state.players[ACTOR]?.researchCardIds.length, 0, "fresh game should begin with an empty Research hand");
  assert.equal(state.decks.research.exhausted, false, "fresh Research deck should be available");
  assert.ok(deploymentChoices(state).length > 0, "the eligible fixture must have legal deployment choices");
  return state;
}

function runPolicy(initial: GameState, policy: BotTactic) {
  const state = structuredClone(initial);
  const overrides = new Map<number, BotTactic>([[ACTOR, policy]]);
  const choices = deploymentChoices(state);
  const routeScores = routeBlockScores(state, ACTOR, undefined, overrides);
  const activeRivals = state.monsters.filter((monster, index) => index !== ACTOR && monster.health > 0
    && Boolean(boardForState(state).hexes[monster.location as keyof ReturnType<typeof boardForState>["hexes"]]));
  const activeUnits = state.units.filter((unit) => unit.ownerPlayer === ACTOR
    && unit.location !== "record-tile"
    && unit.location !== "permanently-removed");
  const objectiveThreat = activeRivals.some((monster) => {
    const board = boardForState(state);
    const objectives = Object.values(board.hexes).filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site")
      && !state.stompedLocations.includes(hex.key));
    const objectiveDistance = objectives.reduce((nearest, hex) => {
      const left = board.hexes[monster.location as keyof typeof board.hexes]?.coord;
      const right = hex.coord;
      if (!left || !right) return nearest;
      const dq = left.q - right.q;
      const dr = left.r - right.r;
      return Math.min(nearest, Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)));
    }, 99);
    return objectiveDistance <= monster.move + 1 && (monster.infamy >= 2 || objectiveDistance <= 1);
  });
  const blockerDestinations = choices.flatMap((choice) => choice.destinations)
    .filter((destination) => (routeScores.get(destination) ?? 0) >= 10);

  assert.ok(activeUnits.length >= 1, "Research-first eligibility requires a military screen already in play");
  assert.equal(state.players[ACTOR]!.researchCardIds.length < 2, true, "Research-first eligibility requires hand size below two");
  assert.equal(state.decks.research.exhausted, false, "Research-first eligibility requires an available Research deck");
  assert.equal(state.deploymentsThisTurn, 0, "Research-first eligibility requires choosing Research instead of a deployment");
  assert.equal(activeRivals.length, 0, "this fixture removes rival monsters, so there is no urgent objective target");
  assert.equal(objectiveThreat, false, "the fixture must not trigger the objective-threat gate");
  assert.deepEqual([...routeScores], [], "no living rival means there are no route-block scores");
  assert.deepEqual(blockerDestinations, [], "no legal deployment destination reaches the blocker-opportunity threshold");

  const selectorDiagnostics: BotDeployDecisionDiagnostics[] = [];
  const command = chooseBotCommand(state, new Set([ACTOR]), overrides, (diagnostics) => selectorDiagnostics.push(diagnostics));
  assert.ok(command, `${policy} must return a command for the active deployment decision`);
  assert.equal(selectorDiagnostics.length, 1, "the active Deploy choice should emit exactly one selector diagnostic");
  const selectorDiagnostic = selectorDiagnostics[0]!;
  assert.equal(selectorDiagnostic.path, "optional-research-choice", "legal deployments should exercise the optional Research branch");
  assert.equal(selectorDiagnostic.playerIndex, ACTOR);
  assert.equal(selectorDiagnostic.deploymentChoiceCount, choices.length);
  assert.equal(selectorDiagnostic.legalResearchDrawAvailable, true);
  assert.equal(selectorDiagnostic.selectedCommandType, command.type);
  const result = applyCommand(state, command);
  if (policy === "research-first") {
    assert.deepEqual(command, { type: "draw-research" }, "eligible research-first path should select the optional Research draw");
    assert.equal(result.eventType, "research.drawn", "the authoritative engine should accept the selected Research action");
    assert.equal(result.eventPayload.playerIndex, ACTOR, "the Research draw event must belong to the focal player");
    assert.equal(result.state.players[ACTOR]!.researchCardIds.length, 1, "the accepted action should add exactly one Research card");
    assert.equal(result.state.phase === "deploy" && result.state.currentPlayer === ACTOR, false, "drawing Research ends the current Deploy opportunity");
  } else {
    assert.notEqual(command.type, "draw-research", "force-first policy should deploy while legal deployments remain");
    assert.ok(command.type === "deploy" || command.type === "redeploy", "force-first should select a legal deployment action");
    assert.ok(["unit.deployed", "unit.redeployed"].includes(result.eventType), "the authoritative engine should accept the selected deployment");
    assert.equal(result.state.deploymentsThisTurn, 1, "the accepted deployment should consume this turn's Research alternative");
  }

  const eligibility = {
    researchDeckAvailable: !state.decks.research.exhausted,
    deploymentNotStarted: state.deploymentsThisTurn === 0,
    researchHandBelowTwo: state.players[ACTOR]!.researchCardIds.length < 2,
    researchFirstPolicy: policy === "research-first",
    activeMilitaryScreen: activeUnits.length >= 1,
    objectiveThreatAbsent: !objectiveThreat,
    blockerOpportunityAbsent: blockerDestinations.length === 0,
  };
  assert.equal(Object.values(eligibility).every(Boolean), policy === "research-first", "the Research draw gates should all pass only for research-first treatment");
  assert.deepEqual(selectorDiagnostic.gates, eligibility, "diagnostic gate values must match this independently constructed eligible fixture");
  assert.equal(selectorDiagnostic.eligible, Object.values(eligibility).every(Boolean), "selector diagnostics and independently checked eligibility must agree");

  return {
    treatment: policy,
    actor: ACTOR,
    inferredDefaultTactic: botTacticForPlayer(state, ACTOR),
    overrideTactic: botTacticForPlayer(state, ACTOR, overrides),
    eligibility: {
      phase: state.phase,
      pendingDecision: state.pendingDecision,
      deploymentsThisTurn: state.deploymentsThisTurn,
      deploymentsAvailable: choices.length,
      activeMilitaryScreenCount: activeUnits.length,
      researchHandSize: state.players[ACTOR]!.researchCardIds.length,
      researchDeckAvailable: !state.decks.research.exhausted,
      liveRivalCount: activeRivals.length,
      routeBlockScoreCount: routeScores.size,
      blockerOpportunityDestinations: blockerDestinations,
      objectiveThreat,
      objectiveThreatReason: "No living rival monster can be selected by focusTarget",
    },
    shouldDrawResearchEligibility: eligibility,
    allShouldDrawResearchRequirementsMet: Object.values(eligibility).every(Boolean),
    selectorDiagnostics: selectorDiagnostic,
    selectedCommand: command,
    acceptedAction: {
      eventType: result.eventType,
      eventPayload: result.eventPayload,
      resultingPhase: result.state.phase,
      resultingCurrentPlayer: result.state.currentPlayer,
      resultingDeploymentsThisTurn: result.state.deploymentsThisTurn,
      resultingResearchHand: result.state.players[ACTOR]!.researchCardIds,
      resultingDeckDrawIndex: result.state.decks.research.drawIndex,
    },
  };
}

const initial = makeEligibleState();
const baselineHash = digest(JSON.stringify(initial));
const outcomes = POLICIES.map((policy) => runPolicy(initial, policy));
assert.equal(digest(JSON.stringify(initial)), baselineHash, "each policy path must leave the shared starting state unchanged");

const botSource = readFileSync(resolve(process.cwd(), "packages/game-engine/src/bots.ts"), "utf8");
const harnessSource = readFileSync(new URL(import.meta.url), "utf8");
const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean);
const evidence = {
  schemaVersion: 2,
  researchDrawDiagnosticsVersion: 1,
  probe: "deterministic Research draw eligibility and action path",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  worktreeDirty: dirtyPaths.length > 0,
  dirtyPathCount: dirtyPaths.length,
  sourceSha256: { botSelector: digest(botSource), probe: digest(harnessSource) },
  fixture: {
    seed: SEED,
    matchId: MATCH_ID,
    playerCount: 2,
    focalPlayerIndex: ACTOR,
    initialStateSha256: baselineHash,
    construction: "Fresh deterministic development game, focal seat 1 in an authoritative Deploy decision, all rival monsters defeated, an owned military unit on the board, no deployments this turn, empty Research hand, available deck, and remaining legal deployment choices.",
    scope: "Single branch-selection probe; this does not measure strategic quality, gameplay balance, or terminal outcomes.",
  },
  outcomes,
  result: "Both tactic overrides exercised against cloned identical eligible state: force-first deployed; research-first selected and completed draw-research.",
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
