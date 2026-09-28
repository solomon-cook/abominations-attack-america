import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, projectState, type GameCommand, type GameState } from "@abominations/game-engine";
import { ChallengeArena } from "./components/ChallengeArena";
import { ChallengeActions } from "./components/ChallengeActions";
import "./styles.css";
import "./encounter-command.css";

function createFixture() {
  const game = createGame(3, 2841, "challenge-arena-browser-acceptance");
  game.currentPlayer = 0;
  game.phase = "challenge";
  game.monsters.forEach((monster) => {
    monster.health = 20;
    monster.maxHealth = 20;
    monster.defense = 1;
    monster.damage = 1;
    monster.attacks = 1;
  });
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
    opponentIds: game.monsters.slice(1).map((monster) => monster.id),
  };
  return game;
}

function Harness() {
  const spectator = new URLSearchParams(window.location.search).get("role") === "spectator";
  const enterThroughAction = new URLSearchParams(window.location.search).get("entry") === "cta";
  const [authoritativeGame, setAuthoritativeGame] = useState<GameState>(createFixture);
  const [submittedCommands, setSubmittedCommands] = useState<GameCommand[]>([]);
  const [arenaOpen, setArenaOpen] = useState(!enterThroughAction);
  const viewerGame = spectator
    ? projectState(authoritativeGame, "spectator")
    : projectState(authoritativeGame, "player", 0);
  const event = authoritativeGame.eventLog.at(-1);
  const snapshot = {
    role: spectator ? "spectator" : "active-owner",
    currentPlayer: authoritativeGame.currentPlayer,
    pendingDecision: authoritativeGame.pendingDecision,
    challenge: authoritativeGame.challenge,
    selectedOpponentMonsterId: authoritativeGame.challenge?.opponentMonsterId ?? null,
    latestEvent: event ? { id: event.id, action: event.action, detail: event.detail } : null,
    submittedCommands,
  };
  const runCommand = (command: GameCommand) => {
    setSubmittedCommands((commands) => [...commands, command]);
    setAuthoritativeGame((current) => applyCommand(current, command).state);
  };

  return <main>
    <h1>Monster Challenge arena fixture</h1>
    <output id="challenge-arena-state" aria-label="Challenge arena fixture state">{JSON.stringify(snapshot)}</output>
    {enterThroughAction && <ChallengeActions activeGame={viewerGame} onOpen={() => setArenaOpen(true)} />}
    {arenaOpen && <ChallengeArena
        game={viewerGame}
        canAct={!spectator && authoritativeGame.pendingDecision?.playerIndex === 0}
        playerIndex={spectator ? undefined : 0}
        runCommand={runCommand}
        onClose={() => setArenaOpen(false)}
      />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
