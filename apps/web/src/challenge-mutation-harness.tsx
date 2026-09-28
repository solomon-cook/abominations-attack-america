import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, projectState, type GameCommand, type GameState } from "@abominations/game-engine";
import { ChallengeArena } from "./components/ChallengeArena";
import "./styles.css";
import "./encounter-command.css";

function createFixture() {
  const game = createGame(2, 7311, "challenge-mutation-browser-acceptance");
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.monsters.forEach((monster) => {
    monster.health = 10;
    monster.maxHealth = 20;
    monster.defense = 1;
    monster.damage = 1;
    monster.attacks = 1;
  });
  game.players[0]!.mutationCardIds = ["Berserk", "Son of a Monster"];
  game.challenge = {
    declared: true,
    active: true,
    challengerMonsterId: game.monsters[0]!.id,
    declarationPlayerIndex: 0,
    pendingStartPlayerIndex: 0,
    startAtEndOfTurn: false,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
  game.pendingDecision = {
    type: "challenge-opponent",
    playerIndex: 0,
    challengerMonsterId: game.monsters[0]!.id,
    opponentIds: [game.monsters[1]!.id],
  };
  return applyCommand(game, { type: "challenge-opponent", opponentMonsterId: game.monsters[1]!.id }).state;
}

function Harness() {
  const waiting = new URLSearchParams(window.location.search).get("role") === "waiting";
  const viewerIndex = waiting ? 1 : 0;
  const [authoritativeGame, setAuthoritativeGame] = useState<GameState>(createFixture);
  const [submittedCommands, setSubmittedCommands] = useState<GameCommand[]>([]);
  const viewerGame = projectState(authoritativeGame, "player", viewerIndex);
  const event = authoritativeGame.eventLog.at(-1);
  const challenger = authoritativeGame.monsters[0]!;
  const snapshot = {
    role: waiting ? "waiting-player" : "mutation-owner",
    viewerIndex,
    currentPlayer: authoritativeGame.currentPlayer,
    pendingDecision: authoritativeGame.pendingDecision,
    remainingAttacks: authoritativeGame.challenge?.turn?.remainingAttacks ?? null,
    heldMutationCardIds: authoritativeGame.players[0]!.mutationCardIds,
    discardedMutationCardIds: authoritativeGame.decks.mutation.discard,
    challengerHealth: challenger.health,
    challengerMaxHealth: challenger.maxHealth,
    latestEvent: event ? { id: event.id, action: event.action, detail: event.detail } : null,
    eventCount: authoritativeGame.eventLog.length,
    submittedCommands,
  };
  const runCommand = (command: GameCommand) => {
    setSubmittedCommands((commands) => [...commands, command]);
    setAuthoritativeGame((current) => applyCommand(current, command).state);
  };

  return <main>
    <h1>Challenge Mutation controls fixture</h1>
    <output id="challenge-mutation-state" aria-label="Challenge Mutation fixture state">{JSON.stringify(snapshot)}</output>
    <ChallengeArena
      game={viewerGame}
      canAct={!waiting}
      canUseMutation={!waiting}
      playerIndex={viewerIndex}
      runCommand={runCommand}
      onClose={() => undefined}
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
