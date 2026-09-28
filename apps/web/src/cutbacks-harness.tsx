import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, projectState, type GameCommand, type GameState } from "@abominations/game-engine";
import { MilitarySheet } from "./components/MilitarySheet";
import "./styles.css";
import "./physical-sheets.css";

const PUBLIC_TARGET = "Guard Commander";
const HIDDEN_RESEARCH = "Molecular Cannon";

function createFixture(viewerPlayer: number) {
  const game = createGame(2, 73, `cutbacks-card-leaf-03-viewer-${viewerPlayer}`);
  game.currentPlayer = 0;
  game.phase = "move";
  game.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: game.monsters[0]!.id };
  if (viewerPlayer === 0) {
    game.players[0]!.researchCardIds = ["Cutbacks"];
    game.players[1]!.researchCardIds = [PUBLIC_TARGET, HIDDEN_RESEARCH];
    game.players[1]!.visibleResearchCardIds = [PUBLIC_TARGET];
  } else {
    game.players[0]!.researchCardIds = [PUBLIC_TARGET, HIDDEN_RESEARCH];
    game.players[0]!.visibleResearchCardIds = [PUBLIC_TARGET];
    game.players[1]!.researchCardIds = ["Cutbacks"];
  }
  return game;
}

function Harness() {
  const viewerPlayer = new URLSearchParams(window.location.search).get("viewer") === "1" ? 1 : 0;
  const [startingGame] = useState(() => createFixture(viewerPlayer));
  const [authoritativeGame, setAuthoritativeGame] = useState<GameState>(startingGame);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const projectedGame = projectState(authoritativeGame, "player", viewerPlayer);
  const canAct = authoritativeGame.currentPlayer === viewerPlayer;
  const runCommand = (command: GameCommand) => {
    if (!canAct) return;
    setAuthoritativeGame((current) => applyCommand(current, command).state);
  };
  const latestEvent = authoritativeGame.eventLog.at(-1);
  const publicResearch = projectedGame.players.flatMap((player, playerIndex) =>
    (player.visibleResearchCardIds ?? (playerIndex === viewerPlayer ? player.researchCardIds : [])).map((cardId) => ({ playerIndex, cardId })),
  );
  const stateSnapshot = {
    viewerPlayer,
    currentPlayer: authoritativeGame.currentPlayer,
    phase: authoritativeGame.phase,
    pendingDecision: authoritativeGame.pendingDecision,
    canAct,
    publicResearch,
    researchCounts: authoritativeGame.players.map((player) => player.researchCardIds.length),
    removedResearchCardIds: authoritativeGame.removedResearchCardIds ?? [],
    cutbacksStillInHand: authoritativeGame.players.some((player) => player.researchCardIds.includes("Cutbacks")),
    publicTargetStillInHand: authoritativeGame.players.some((player) => player.researchCardIds.includes(PUBLIC_TARGET)),
    hiddenResearchRemains: authoritativeGame.players.some((player) => player.researchCardIds.includes(HIDDEN_RESEARCH)),
    cutbacksDiscarded: authoritativeGame.decks.research.discard.includes("Cutbacks"),
    latestEvent: latestEvent ? { action: latestEvent.action, detail: latestEvent.detail } : null,
    drawerOpen,
  };

  return <main className="game-screen cutbacks-harness">
    <output id="cutbacks-state" aria-label="Cutbacks browser fixture state" hidden>{JSON.stringify(stateSnapshot)}</output>
    {drawerOpen && <MilitarySheet
      branch="Army"
      choices={[]}
      referenceOnly
      game={projectedGame}
      playerIndex={viewerPlayer}
      canAct={canAct}
      runCommand={runCommand}
      onClose={() => setDrawerOpen(false)}
      onSelect={() => undefined}
    />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
