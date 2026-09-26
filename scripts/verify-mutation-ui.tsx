import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, projectState } from "../packages/game-engine/src/index.js";
import { RevealedCardsPanel } from "../apps/web/src/components/RevealedCardsPanel.js";
import { ChallengeMutationControls } from "../apps/web/src/components/ChallengeMutationControls.js";

const use = (game: ReturnType<typeof createGame>, phase: "fight" | "challenge", cardId: "Berserk" | "Son of a Monster") => {
  const monster = game.monsters[1]!;
  game.currentPlayer = 0;
  game.phase = phase;
  game.players[1]!.mutationCardIds = [cardId];
  if (phase === "fight") {
    const battleId = `ui-${cardId}`;
    game.pendingBattles = [{ id: battleId, monsterId: monster.id, location: monster.location as `${number},${number}`, militaryUnitIds: [] }];
    game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId };
  } else {
    game.challenge = {
      declared: true, active: true, challengerMonsterId: "monster-1", opponentMonsterId: monster.id,
      declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: [],
      turn: { attackerId: "monster-1", firstAttackerId: "monster-1", round: 1, remainingAttacks: 1, attacks: [] },
    };
    game.pendingDecision = { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: "monster-1", opponentMonsterId: monster.id };
  }
  const html = renderToStaticMarkup(React.createElement(RevealedCardsPanel, {
    game: projectState(game, "player", 1),
    playerIndex: 1,
    canAct: false,
    canUseMutation: true,
    runCommand: () => undefined,
  }));
  assert.match(html, new RegExp(`Play ${cardId}`));
  assert.doesNotMatch(html, /disabled=""/);
  return html;
};

const fightHtml = use(createGame(2), "fight", "Berserk");
assert.match(fightHtml, /Any time during a battle involving this monster/);
const challengeHtml = use(createGame(2), "challenge", "Son of a Monster");
assert.match(challengeHtml, /Any time during a battle involving this monster/);
const challengeGame = createGame(2);
challengeGame.currentPlayer = 0;
challengeGame.phase = "challenge";
challengeGame.players[1]!.mutationCardIds = ["Son of a Monster"];
challengeGame.challenge = {
  declared: true, active: true, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2",
  declarationPlayerIndex: 0, pendingStartPlayerIndex: 0, weighInHealth: {}, defeatedMonsterIds: [],
  turn: { attackerId: "monster-1", firstAttackerId: "monster-1", round: 1, remainingAttacks: 1, attacks: [] },
};
challengeGame.pendingDecision = { type: "challenge-resolution", playerIndex: 0, challengerMonsterId: "monster-1", opponentMonsterId: "monster-2" };
const controlsHtml = renderToStaticMarkup(React.createElement(ChallengeMutationControls, {
  game: projectState(challengeGame, "player", 1),
  canUseMutation: true,
  playerIndex: 1,
  runCommand: () => undefined,
}));
assert.match(controlsHtml, /Son of a Monster/);
assert.doesNotMatch(controlsHtml, /disabled=""/);
console.log("Berserk and Son of a Monster controls render enabled for their off-turn monster owner in Fight and Challenge player projections.");
