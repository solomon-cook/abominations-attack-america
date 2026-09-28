import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, getLocation, locationIdToHexKey, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { PhaseActions } from "./components/PhaseActions";
import "./styles.css";
import "./encounter-command.css";

const battleId = "retreat-choice-acceptance-battle";
const retreatingUnitIds = ["0-0", "0-1", "2-0"];
const hex = (locationId: string): HexKey => {
  const key = locationIdToHexKey(locationId);
  if (!key) throw new Error(`Expected development-board hex for ${locationId}.`);
  return key;
};
const destinations: Record<string, readonly HexKey[]> = {
  "0-0": [hex("chicago"), hex("dallas")],
  "0-1": [hex("los-angeles")],
  "2-0": [],
};

function createFixture(): GameState {
  const game = createGame(2, 12, "retreat-choice-acceptance");
  game.phase = "fight";
  game.currentPlayer = 0;
  game.monsters[0]!.location = hex("denver");
  for (const id of retreatingUnitIds) {
    const unit = game.units.find((candidate) => candidate.id === id);
    if (!unit) throw new Error(`Expected retreat fixture unit ${id}.`);
    unit.location = hex("denver");
    unit.ownerPlayer = 0;
  }
  game.pendingBattles = [{
    id: battleId,
    monsterId: game.monsters[0]!.id,
    location: hex("denver"),
    militaryUnitIds: [...retreatingUnitIds],
  }];
  game.pendingRetreat = {
    battleId,
    unitIds: [...retreatingUnitIds],
    options: destinations,
    researchPlayerIndex: 0,
  };
  game.pendingDecision = { type: "retreat", playerIndex: 0, battleId, unitIds: [...retreatingUnitIds] };
  return game;
}

function Harness() {
  const canActUnavailable = new URLSearchParams(window.location.search).get("canAct") === "false";
  const [game, setGame] = useState(createFixture);
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const [submittedCommands, setSubmittedCommands] = useState<GameCommand[]>([]);
  const commandResult = game.eventLog.at(-1)?.action === "retreat.resolved" ? game.eventLog.at(-1) : undefined;
  const snapshot = {
    phase: game.phase,
    currentPlayer: game.currentPlayer,
    pendingDecision: game.pendingDecision,
    pendingRetreat: game.pendingRetreat,
    retreatChoices,
    units: game.units.filter((unit) => retreatingUnitIds.includes(unit.id)).map((unit) => ({ id: unit.id, location: unit.location })),
    eventCount: game.eventLog.length,
    lastEventAction: commandResult?.action ?? null,
    lastEventDetail: commandResult?.detail ?? null,
    submittedCommands,
  };
  const runCommand = (command: GameCommand) => {
    setSubmittedCommands((commands) => [...commands, command]);
    setGame((current) => applyCommand(current, command).state);
  };

  return <main className="game-screen retreat-choice-harness">
    <header><h1>Retreat choice acceptance fixture</h1></header>
    <output id="retreat-choice-state" aria-label="Retreat fixture state" hidden>{JSON.stringify(snapshot)}</output>
    <p className="card" aria-label="Fixture action availability">{canActUnavailable ? "canAct=false · actions unavailable" : "canAct=true · retreat decision"}</p>
    <section className="bottom-context-dock" aria-label="Retreat actions">
      <PhaseActions
        activeGame={game}
        onOpenMilitarySheet={() => undefined}
        canAct={!canActUnavailable}
        runCommand={runCommand}
        getLocationName={(key) => getLocation(key)?.name ?? key}
        pendingAttackPrompt=""
        canSpendInfamyOnPendingBattle={false}
        retreatChoices={retreatChoices}
        setRetreatChoices={setRetreatChoices}
      />
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
