import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, type GameState, type HexKey, type PendingDecision } from "../packages/game-engine/src/index.js";
import { AttentionBanner } from "../apps/web/src/components/AttentionBanner.js";
import { TurnProgress } from "../apps/web/src/components/TurnProgress.js";

const battleId = "pending-ui-battle";
const key = "1,1" as HexKey;
const cases: Array<{ decision: PendingDecision; phase: GameState["phase"]; expected: string }> = [
  { decision: { type: "monster-movement", playerIndex: 0, pieceId: "monster-1" }, phase: "move", expected: "Choose monster movement" },
  { decision: { type: "battle-resolution", playerIndex: 0, battleId }, phase: "fight", expected: "Choose battle" },
  { decision: { type: "attack-target", playerIndex: 0, battleId, attackerId: "monster-1", targetIds: ["unit-1"] }, phase: "fight", expected: "Choose attack target" },
  { decision: { type: "retreat", playerIndex: 0, battleId, unitIds: ["unit-1"] }, phase: "fight", expected: "Choose retreat" },
  { decision: { type: "encounter-resolution", playerIndex: 0, location: key }, phase: "encounter", expected: "Resolve Encounter" },
  { decision: { type: "encounter-choice", playerIndex: 0, location: key, choices: ["health", "infamy"] }, phase: "encounter", expected: "Choose Encounter reward" },
  { decision: { type: "mutation-choice", playerIndex: 0, monsterId: "monster-1", cardIds: ["Rampage", "Iron Stomach"] }, phase: "encounter", expected: "Choose Toxicor Mutation" },
  { decision: { type: "stabilizer-ray-choice", playerIndex: 0, monsterId: "monster-2", battleId, cardIds: ["Rampage"] }, phase: "fight", expected: "Choose Mutation to discard" },
  { decision: { type: "chopper-lift-choice", playerIndex: 0, roll: 4 }, phase: "move", expected: "Chopper Lift: choose a monster and destination (roll 4)" },
  { decision: { type: "trophy-choice", playerIndex: 0, location: key, branch: "Army", unitIds: ["unit-1"] }, phase: "encounter", expected: "Choose trophy" },
  { decision: { type: "deployment", playerIndex: 0 }, phase: "deploy", expected: "Deploy or pass" },
  { decision: { type: "giant-placement", playerIndex: 0, cardId: "Mecha-Monster", destinations: [key] }, phase: "move", expected: "Place Mecha-Monster on a base" },
  { decision: { type: "challenge-opponent", playerIndex: 0, challengerMonsterId: "monster-1", opponentIds: ["monster-2"] }, phase: "challenge", expected: "Choose Challenge opponent" },
  { decision: { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2" }, phase: "challenge", expected: "Roll, spend Infamy, or pass the dice" },
  { decision: { type: "challenge-giant", playerIndex: 0, challengerMonsterId: "monster-1", giantUnitIds: ["giant-1"] }, phase: "challenge", expected: "Choose giant opponent" },
  { decision: { type: "challenge-giant-resolution", playerIndex: 0, challengerMonsterId: "monster-1", giantUnitId: "giant-1" }, phase: "challenge", expected: "Roll, then hand over the dice" },
  { decision: { type: "game-over", playerIndex: 0, victoryType: "monster-challenge" }, phase: "game-over", expected: "Match complete" },
];

for (const { decision, phase, expected } of cases) {
  const game = createGame(2);
  game.currentPlayer = 1;
  game.phase = phase;
  game.pendingDecision = decision;

  const progress = renderToStaticMarkup(React.createElement(TurnProgress, { game }));
  assert.ok(progress.includes(expected), `${decision.type} should show its specific progress label`);
  assert.ok(!progress.includes("Current step:"), `${decision.type} must not fall back to a generic phase label`);

  if (phase !== "game-over") {
    const attention = renderToStaticMarkup(React.createElement(AttentionBanner, {
      game,
      action: "Resolve decision",
      canAct: false,
      online: true,
    }));
    assert.ok(attention.includes("Waiting for Player 1"), `${decision.type} should name pendingDecision.playerIndex instead of currentPlayer`);
  }
}

assert.equal(cases.length, 17, "the UI fixture should cover all current authoritative pending-decision types");
console.log("PASS: all 17 pending decisions render a specific progress label; waiting status names the assigned decision owner.");
