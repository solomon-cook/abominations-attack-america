import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { PlayerStatusControls } from "./components/PlayerStatusControls";
import "./styles.css";
import "./physical-sheets.css";

const BATTLE_ID = "monster-sheet-berserk-browser-fixture";

function createFixture() {
  const game = createGame(2, 23, "monster-sheet-mutation-card-leaf-02");
  game.currentPlayer = 0;
  game.players[0]!.mutationCardIds = ["Berserk"];
  game.monsters[0]!.health = 24;
  game.units[0]!.location = game.monsters[0]!.location;
  game.units[0]!.defense = 99;
  game.phase = "fight";
  game.pendingBattles = [{
    id: BATTLE_ID,
    monsterId: game.monsters[0]!.id,
    location: game.monsters[0]!.location as HexKey,
    militaryUnitIds: [game.units[0]!.id],
  }];
  game.pendingDecision = { type: "battle-resolution", playerIndex: 0, battleId: BATTLE_ID };
  return game;
}

function Harness() {
  const role = new URLSearchParams(window.location.search).get("role") === "waiting" ? "waiting" : "owner";
  const canAct = role === "owner";
  const [game, setGame] = useState<GameState>(createFixture);
  const latestEvent = game.eventLog.at(-1);
  const snapshot = {
    fixture: "Berserk during an active Fight battle; isolated UI acceptance state",
    role,
    canAct,
    playerIndex: 0,
    phase: game.phase,
    pendingDecision: game.pendingDecision,
    mutationCardIds: game.players[0]?.mutationCardIds ?? [],
    mutationDiscard: game.decks.mutation.discard,
    pendingBattle: game.pendingBattles.find((battle) => battle.id === BATTLE_ID) ?? null,
    latestEvent: latestEvent ? { action: latestEvent.action, detail: latestEvent.detail } : null,
  };
  const runCommand = (command: GameCommand) => {
    if (!canAct) return;
    setGame((current) => applyCommand(current, command).state);
  };

  return <main className="game-screen monster-sheet-mutation-harness">
    <h1>Monster Sheet Mutation action fixture</h1>
    <output id="monster-sheet-mutation-state" aria-label="Mutation action fixture state" hidden>{JSON.stringify(snapshot)}</output>
    <PlayerStatusControls
      game={game}
      monster={game.monsters[0]!}
      branch="Army"
      playerIndex={0}
      canAct={canAct}
      mobileCommandExpanded={false}
      runCommand={runCommand}
      onDeploy={() => undefined}
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
