import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  applyCommand,
  createGame,
  deploymentChoices,
  getLocation,
  legalOwnedDeploymentDestinations,
  type DeploymentChoice,
  type GameCommand,
  type GameState,
  type HexKey,
} from "@abominations/game-engine";
import { MilitaryReference } from "./components/SheetReference";
import { PlayerStatusControls } from "./components/PlayerStatusControls";
import { TrophyChoicePanel } from "./components/TrophyChoicePanel";
import { branchDeploymentCounts, trophyUnitsForPlayer } from "./player-visuals";
import "./styles.css";
import "./physical-sheets.css";
import "./command-panels.css";
import "./civ-hud.css";

const branch = "Army" as const;
const targetPlayer = 0;

function keyFor(locationId: string): HexKey {
  const location = getLocation(locationId);
  if (!location) throw new Error(`The fixture requires the ${locationId} location.`);
  return `${location.coord.q},${location.coord.r}` as HexKey;
}

function assignments() {
  return [
    { playerIndex: 0, monsterId: "monster-1", branch: "Army" as const, lair: "los-angeles", ready: true },
    { playerIndex: 1, monsterId: "monster-2", branch: "Navy" as const, lair: "chicago", ready: true },
  ];
}

function createTrophyFixture(): GameState {
  const game = createGame(2, 7, "military-tray-trophy-harness");
  game.setupAssignments = assignments();
  game.currentPlayer = 1;
  game.phase = "encounter";
  const denver = keyFor("denver");
  game.monsters[1]!.location = denver;
  game.pendingDecision = { type: "encounter-resolution", playerIndex: 1, location: denver };
  for (const unit of game.units) if (unit.branch === branch) unit.ownerPlayer = targetPlayer;
  return applyCommand(game, { type: "resolve-encounter" }).state;
}

function createNonPendingFixture(): GameState {
  const game = createGame(2, 7, "military-tray-non-pending-harness");
  game.setupAssignments = assignments();
  for (const unit of game.units) if (unit.branch === branch) unit.ownerPlayer = targetPlayer;
  return game;
}

function createRedeployFixture(): GameState {
  const game = createGame(2, 0, "military-tray-redeploy-harness");
  game.setupAssignments = assignments();
  game.currentPlayer = targetPlayer;
  game.phase = "deploy";
  game.pendingDecision = { type: "deployment", playerIndex: targetPlayer };
  game.deploymentsThisTurn = 0;
  game.deploymentDestinations = [];
  for (const unit of game.units) if (unit.branch === branch) {
    unit.ownerPlayer = targetPlayer;
    unit.location = "record-tile";
  }
  const unit = game.units.find((candidate) => candidate.branch === branch)!;
  unit.location = keyFor("chicago");
  const destinations = legalOwnedDeploymentDestinations(game).filter((destination) => !game.monsters.some((monster) => monster.location === destination));
  if (!destinations.length) throw new Error("The redeployment fixture needs an empty legal Army base.");
  return game;
}

function createInitialGame(scenario: string): GameState {
  if (scenario === "redeploy") return createRedeployFixture();
  if (scenario === "nonpending") return createNonPendingFixture();
  return createTrophyFixture();
}

function Harness() {
  const query = new URLSearchParams(window.location.search);
  const scenario = query.get("scenario") ?? "trophy";
  const viewerPlayer = query.get("viewer") === "1" ? 1 : 0;
  const [game, setGame] = useState<GameState>(() => createInitialGame(scenario));
  const [selectedChoice, setSelectedChoice] = useState<DeploymentChoice | null>(null);
  const pendingTrophy = game.pendingDecision?.type === "trophy-choice" ? game.pendingDecision : undefined;
  const canAct = scenario === "trophy"
    ? pendingTrophy?.playerIndex === viewerPlayer
    : game.pendingDecision && "playerIndex" in game.pendingDecision && game.pendingDecision.playerIndex === viewerPlayer;
  const choices = scenario === "redeploy" ? deploymentChoices(game) : [];
  const currentBranchCounts = branchDeploymentCounts(game, targetPlayer, branch);
  const selectedTrophyFromEvent = game.eventLog.at(-1)?.action === "trophy.chosen" && typeof game.eventLog.at(-1)?.detail.unitId === "string"
    ? game.eventLog.at(-1)!.detail.unitId as string
    : undefined;
  const pendingReserveTrophies = (pendingTrophy?.unitIds ?? []).flatMap((id) => {
    const unit = game.units.find((candidate) => candidate.id === id && candidate.location === "record-tile");
    return unit ? [{ id, typeId: unit.unitTypeId ?? unit.branch, location: unit.location }] : [];
  });
  const trackedUnitId = scenario === "redeploy"
    ? game.units.find((unit) => unit.branch === branch && unit.location !== "record-tile")?.id
    : pendingReserveTrophies[0]?.id ?? selectedTrophyFromEvent;
  const trackedUnit = game.units.find((unit) => unit.id === trackedUnitId);
  const takerIndex = game.eventLog.at(-1)?.action === "trophy.chosen" && typeof game.eventLog.at(-1)?.detail.takerPlayerIndex === "number"
    ? game.eventLog.at(-1)!.detail.takerPlayerIndex as number
    : null;
  const stateSnapshot = {
    scenario,
    canAct,
    phase: game.phase,
    currentPlayer: game.currentPlayer,
    pendingDecision: game.pendingDecision,
    pendingTrophyUnitIds: pendingTrophy?.unitIds ?? [],
    pendingTrophies: (pendingTrophy?.unitIds ?? []).flatMap((id) => {
      const unit = game.units.find((candidate) => candidate.id === id);
      return unit ? [{ id, typeId: unit.unitTypeId ?? unit.branch, location: unit.location }] : [];
    }),
    pendingReserveTrophies,
    trackedUnitId,
    trackedUnitTypeId: trackedUnit?.unitTypeId ?? trackedUnit?.branch,
    trackedUnitLocation: trackedUnit?.location,
    removedUnitIds: game.removedUnitIds,
    trayCounts: currentBranchCounts,
    trayLabel: `Open ${branch} military sheet, ${currentBranchCounts.deployed} deployed, ${currentBranchCounts.reserve} in reserve`,
    latestEvent: game.eventLog.at(-1) ? { action: game.eventLog.at(-1)!.action, detail: game.eventLog.at(-1)!.detail } : null,
    trophyTakerIndex: takerIndex,
    trophyIdsByPlayer: [0, 1].map((playerIndex) => trophyUnitsForPlayer(game, playerIndex).map((unit) => unit.id)),
  };
  const runCommand = (command: GameCommand) => setGame((current) => applyCommand(current, command).state);
  const authorizedChoice = (unitId: string) => runCommand({ type: "resolve-encounter", trophyUnitId: unitId });
  const activeMonster = game.monsters[targetPlayer]!;
  const onSelectDeployment = (choice: DeploymentChoice) => setSelectedChoice(choice);
  const legalDestination = selectedChoice?.destinations.find((destination) => !game.monsters.some((monster) => monster.location === destination));

  return <main className="game-screen military-tray-harness">
    <h1>Military tray acceptance harness</h1>
    <output id="military-tray-state" aria-label="Military tray state">{JSON.stringify(stateSnapshot)}</output>
    <PlayerStatusControls
      game={game}
      monster={activeMonster}
      branch={branch}
      playerIndex={targetPlayer}
      canAct={Boolean(canAct)}
      mobileCommandExpanded={false}
      runCommand={() => undefined}
      onDeploy={() => undefined}
    />
    {scenario === "redeploy" ? <>
      <MilitaryReference sheet={branch} game={game} choices={choices} onSelect={onSelectDeployment} />
      {selectedChoice && legalDestination && <button type="button" aria-label="Choose legal redeployment destination" onClick={() => {
        runCommand({ type: "redeploy", unitId: selectedChoice.id, destination: legalDestination });
        setSelectedChoice(null);
      }}>Choose legal redeployment destination</button>}
    </> : <TrophyChoicePanel game={game} canAct={Boolean(canAct)} onChoose={authorizedChoice} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
