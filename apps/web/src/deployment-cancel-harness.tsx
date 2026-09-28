import { createRoot } from "react-dom/client";
import { useState } from "react";
import { applyCommand, createGame, deploymentChoices, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { BoardViewport } from "./components/BoardViewport";
import { HexGrid } from "./components/HexGrid";
import { MilitarySheet } from "./components/MilitarySheet";
import { boardForGame } from "./board-pin";
import "./styles.css";
import "./physical-sheets.css";

type Scenario = "deploy" | "redeploy";

function createFixture(scenario: Scenario): GameState {
  const game = createGame(2, 0, `deployment-cancel-${scenario}-fixture`);
  game.currentPlayer = 0;
  game.phase = "deploy";
  game.pendingDecision = { type: "deployment", playerIndex: 0 };
  if (scenario === "redeploy") {
    const unit = game.units.find((candidate) => candidate.id === "0-0");
    if (!unit) throw new Error("The deterministic Army redeployment fixture unit is missing.");
    unit.location = "chicago" as HexKey;
    unit.ownerPlayer = 0;
  }
  return game;
}

function Harness() {
  const scenario: Scenario = new URLSearchParams(window.location.search).get("scenario") === "redeploy" ? "redeploy" : "deploy";
  const [game, setGame] = useState(() => createFixture(scenario));
  const [deploymentPieceId, setDeploymentPieceId] = useState<string | null>(null);
  const [militarySheetOpen, setMilitarySheetOpen] = useState(false);
  const [submittedCommands, setSubmittedCommands] = useState<GameCommand[]>([]);
  const choices = deploymentChoices(game);
  const deploymentPiece = choices.find((choice) => choice.id === deploymentPieceId);
  const board = boardForGame(game);
  const activePlayer = game.monsters[game.currentPlayer]!;
  const branch = game.setupAssignments?.[game.currentPlayer]?.branch ?? "Army";
  const inventory = {
    totalUnits: game.units.length,
    reserveUnits: game.units.filter((unit) => unit.location === "record-tile").length,
    onBoardUnits: game.units.filter((unit) => unit.location !== "record-tile" && unit.location !== "permanently-removed").length,
    removedUnits: game.units.filter((unit) => unit.location === "permanently-removed").length,
  };
  const selectedUnit = game.units.find((unit) => unit.id === deploymentPieceId);
  const snapshot = {
    scenario,
    phase: game.phase,
    currentPlayer: game.currentPlayer,
    pendingDecision: game.pendingDecision,
    deploymentPieceId,
    selectedKind: deploymentPiece?.kind ?? null,
    selectedDestinationCount: deploymentPiece?.destinations.length ?? 0,
    selectedDestinations: deploymentPiece?.destinations ?? [],
    selectedUnit: selectedUnit ? { id: selectedUnit.id, typeId: selectedUnit.unitTypeId, location: selectedUnit.location, ownerPlayer: selectedUnit.ownerPlayer } : null,
    unitPositions: game.units.map((unit) => ({ id: unit.id, typeId: unit.unitTypeId, location: unit.location, ownerPlayer: unit.ownerPlayer })),
    availableChoices: choices.map((choice) => {
      const unitIndex = game.units.filter((unit) => unit.unitTypeId === choice.typeId).findIndex((unit) => unit.id === choice.id);
      return { ...choice, accessibleName: `${choice.kind === "deploy" ? "Deploy" : "Redeploy"} ${choice.typeId.replaceAll("-", " ")} piece ${unitIndex + 1}` };
    }),
    inventory,
    deploymentCountThisTurn: game.deploymentsThisTurn,
    deploymentDestinations: game.deploymentDestinations,
    eventCount: game.eventLog.length,
    submittedCommands,
  };
  const runCommand = (command: GameCommand) => {
    setSubmittedCommands((commands) => [...commands, command]);
    setGame((current) => applyCommand(current, command).state);
    setDeploymentPieceId(null);
  };
  const onDeploy = (destination: HexKey) => {
    if (!deploymentPiece) return;
    runCommand({ type: deploymentPiece.kind, unitId: deploymentPiece.id, destination });
  };

  return <main className="game-screen deployment-cancel-harness">
    <h1>Cancel placement acceptance fixture</h1>
    <output id="deployment-cancel-state" aria-label="Deployment cancellation fixture state" hidden>{JSON.stringify(snapshot)}</output>
    <section className="card" aria-label="Deployment controls">
      <p>{scenario === "deploy" ? "Reserve unit" : "Owned unit on the board"} · {branch} · Player {game.currentPlayer + 1}</p>
      <button type="button" onClick={() => setMilitarySheetOpen(true)}>Open military sheets</button>
    </section>
    <section className="board-panel">
      <div className="map" aria-label="Deployment board">
        <BoardViewport board={board} boardId={game.boardId} boardContentHash={game.boardContentHash} focusHexKey={deploymentPiece?.destinations[0]}>
          <HexGrid
            game={game}
            activePlayerId={activePlayer.id}
            canAct
            deploymentDestinations={new Set(deploymentPiece?.destinations ?? [])}
            retreatDestinations={new Set()}
            onRetreat={() => undefined}
            onDeploy={onDeploy}
            onSelectMonster={() => undefined}
            legalDestinations={new Set()}
            legalUnitDestinations={new Set()}
            selectableUnitIds={new Set()}
            selectedUnitId={null}
            selectedPath={[]}
            hoveredPath={[]}
            selectedUnitPath={[]}
            acceptedPath={[]}
            onSelectUnit={() => undefined}
            onFocusHex={() => undefined}
            onSelectStack={() => undefined}
            onChoosePath={() => undefined}
            onChooseUnitPath={() => undefined}
            onPreviewPath={() => undefined}
            onClearPreview={() => undefined}
          />
        </BoardViewport>
      </div>
    </section>
    {deploymentPiece && <div className="deployment-prompt" role="status">
      Place {deploymentPiece.typeId.replaceAll("-", " ")} · Select a glowing location.
      <button type="button" onClick={() => setDeploymentPieceId(null)}>Cancel placement</button>
    </div>}
    {militarySheetOpen && <MilitarySheet
      initialSheet={deploymentPiece?.sheet ?? branch}
      canAct
      game={game}
      branch={branch}
      choices={choices}
      onClose={() => setMilitarySheetOpen(false)}
      onSelect={(choice) => { setDeploymentPieceId(choice.id); setMilitarySheetOpen(false); }}
    />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
