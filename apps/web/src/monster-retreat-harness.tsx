import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { applyCommand, createGame, type GameCommand, type GameState, type HexKey } from "@abominations/game-engine";
import { BoardViewport } from "./components/BoardViewport";
import { HexGrid } from "./components/HexGrid";
import { TurnPrompt } from "./components/TurnPrompt";
import { TurnProgress } from "./components/TurnProgress";
import { PhaseActions } from "./components/PhaseActions";
import { boardForGame } from "./board-pin";
import "./styles.css";
import "./fullscreen-shell.css";
import "./board-terrain.css";
import "./physical-sheets.css";
import "./chat-ui.css";
import "./command-panels.css";
import "./encounter-command.css";
import "./board-event-playback.css";
import "./monster-selection.css";
import "./setup-command.css";
import "./home-screen.css";
import "./civ-hud.css";
import "./account-panel.css";
import "./monster-retreat-harness.css";

type FightFixture = { game: GameState; setupCommands: GameCommand[]; setupFightEvents: string[] };

function createFightRetreat(): FightFixture {
  const created = createGame(2, 8, "monster-retreat-board-acceptance");
  const moveCommand: GameCommand = { type: "move", path: ["los-angeles", "denver"] };
  const moved = applyCommand(created, moveCommand).state;
  const battle = moved.pendingBattles[0];
  if (!battle) throw new Error("The real monster move did not generate the deterministic battle fixture.");

  // Bound combat randomness without fabricating a retreat result: the real
  // fight resolver must still generate pendingRetreat.monsterId.
  const combatReady = structuredClone(moved);
  for (const unit of combatReady.units) if (battle.militaryUnitIds.includes(unit.id)) unit.defense = 99;
  const monster = combatReady.monsters.find((candidate) => candidate.id === battle.monsterId);
  if (!monster) throw new Error("The generated battle's monster is missing.");
  monster.health = 40;

  const setupCommands: GameCommand[] = [moveCommand, { type: "resolve-fight", battleId: battle.id }];
  const setupFightEvents: string[] = [];
  let result = applyCommand(combatReady, setupCommands[1]!);
  setupFightEvents.push(result.eventType);
  let state = result.state;
  let targetSteps = 0;
  while (state.pendingDecision?.type === "attack-target") {
    if (targetSteps++ >= 12) throw new Error("Fight resolution exceeded the target-choice safety cap.");
    const decision = state.pendingDecision;
    const command: GameCommand = { type: "resolve-fight", battleId: decision.battleId, targetUnitId: decision.targetIds[0]! };
    result = applyCommand(state, command);
    setupCommands.push(command);
    setupFightEvents.push(result.eventType);
    state = result.state;
  }
  if (state.pendingRetreat?.monsterId !== battle.monsterId) {
    throw new Error(`The real fight resolver did not produce a monster retreat decision: ${JSON.stringify(state.pendingDecision)}`);
  }
  if (!state.pendingRetreat.options[battle.monsterId]?.length) {
    throw new Error("The real fight resolver produced no legal monster retreat destination.");
  }
  return { game: state, setupCommands, setupFightEvents };
}

function snapshot(game: GameState, submittedCommands: GameCommand[], panelPreferenceOpen: boolean, canChoose: boolean, cameraFocusKeys?: HexKey[]) {
  const pending = game.pendingRetreat;
  const submittedRetreat = [...submittedCommands].reverse().find((command) => command.type === "retreat");
  const monsterId = pending?.monsterId ?? (submittedRetreat?.type === "retreat" ? Object.keys(submittedRetreat.destinations)[0] : undefined);
  const monster = monsterId ? game.monsters.find((candidate) => candidate.id === monsterId) : undefined;
  const lastEvent = game.eventLog.at(-1);
  return {
    phase: game.phase,
    pendingDecision: game.pendingDecision,
    pendingRetreat: pending,
    monster: monster ? { id: monster.id, name: monster.name, location: monster.location, health: monster.health } : null,
    legalDestinationKeys: pending?.monsterId ? pending.options[pending.monsterId] ?? [] : [],
    eventCount: game.eventLog.length,
    lastEventAction: lastEvent?.action ?? null,
    lastEventDetail: lastEvent?.detail ?? null,
    submittedCommands,
    panelPreferenceOpen,
    panelVisible: panelPreferenceOpen && !(canChoose && pending?.monsterId),
    canChoose,
    cameraFocusKeys: cameraFocusKeys ?? [],
    cameraSingleFocusKey: monster?.location ?? null,
  };
}

function Harness() {
  const [fixture] = useState(createFightRetreat);
  const [game, setGame] = useState(fixture.game);
  const [submittedCommands, setSubmittedCommands] = useState<GameCommand[]>([]);
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const [panelPreferenceOpen, setPanelPreferenceOpen] = useState(() => new URLSearchParams(window.location.search).get("panel") === "open");
  const [canChoose] = useState(() => new URLSearchParams(window.location.search).get("role") !== "waiting");
  const pending = game.pendingRetreat;
  const activeRetreatChoice = Boolean(canChoose && pending?.monsterId);
  const panelVisible = panelPreferenceOpen && !activeRetreatChoice;
  const destinations = useMemo(() => new Set<HexKey>(pending?.monsterId ? pending.options[pending.monsterId] ?? [] : []), [pending]);
  const retreatCameraFocusKeys = useMemo(() => activeRetreatChoice ? [...destinations].sort() : undefined, [activeRetreatChoice, destinations]);
  const board = boardForGame(game);
  const monster = pending?.monsterId ? game.monsters.find((candidate) => candidate.id === pending.monsterId) : undefined;
  const currentMonster = game.monsters[game.currentPlayer]!;
  const state = snapshot(game, submittedCommands, panelPreferenceOpen, canChoose, retreatCameraFocusKeys);
  const runCommand = (command: GameCommand) => {
    setSubmittedCommands((commands) => [...commands, command]);
    setGame((current) => applyCommand(current, command).state);
  };

  return <main className="game-screen monster-retreat-harness">
    <output id="monster-retreat-state" aria-label="Monster retreat fixture state" hidden>{JSON.stringify(state)}</output>
    <output id="monster-retreat-fixture" aria-label="Monster retreat fixture setup" hidden>{JSON.stringify({
      setupCommands: fixture.setupCommands,
      setupFightEvents: fixture.setupFightEvents,
      battleCreatedByMove: true,
      combatStatsControlled: { unitDefense: 99, monsterHealth: 40 },
    })}</output>
      {pending?.monsterId && <div className="retreat-phase-status" aria-label="Current fight status">
        <span className="retreat-phase-indicator" role="status">{canChoose ? "Choose retreat" : "Waiting for retreat choice"}</span>
        <button type="button" className="ghost" onClick={() => setPanelPreferenceOpen((open) => !open)}
          aria-expanded={panelVisible}
          aria-label={activeRetreatChoice ? panelPreferenceOpen ? "Keep turn panel minimized after retreat" : "Expand turn panel after retreat" : panelVisible ? "Minimize turn panel" : "Expand turn panel"}>
          {panelVisible ? "−" : "+"}
        </button>
      </div>}
      <section className={`layout ${panelVisible ? "panel-open" : "panel-closed"}`} data-panel-preference={panelPreferenceOpen ? "open" : "closed"}>
      <div className="board-panel">
        <div className="panel-heading">
          <div><span className="label">FIGHT · MONSTER RETREAT</span><h2>{monster?.name ?? "Monster"}</h2></div>
          <span className="chip">PLAYER {game.currentPlayer + 1}</span>
        </div>
        <BoardViewport board={board} boardId={game.boardId} boardContentHash={game.boardContentHash} focusHexKey={monster?.location} focusHexKeys={retreatCameraFocusKeys}>
          <HexGrid
            game={game}
            activePlayerId={currentMonster.id}
            canAct={canChoose}
            legalDestinations={new Set()}
            legalUnitDestinations={new Set()}
            deploymentDestinations={new Set()}
            retreatDestinations={destinations}
            selectableUnitIds={new Set()}
            selectedUnitId={null}
            selectedPath={[]}
            hoveredPath={[]}
            selectedUnitPath={[]}
            acceptedPath={[]}
            onRetreat={(destination) => {
              const monsterId = game.pendingRetreat?.monsterId;
              if (canChoose && monsterId && destinations.has(destination)) {
                runCommand({ type: "retreat", destinations: { [monsterId]: destination } });
              }
            }}
            onDeploy={() => undefined}
            onSelectMonster={() => undefined}
            onSelectUnit={() => undefined}
            onFocusHex={() => undefined}
            onSelectStack={() => undefined}
            onChoosePath={() => undefined}
            onChooseUnitPath={() => undefined}
            onPreviewPath={() => undefined}
            onClearPreview={() => undefined}
          />
        </BoardViewport>
        {game.phase === "fight" && pending?.monsterId && <div className="deployment-prompt retreat-prompt" role="status" aria-label="Board retreat prompt">
          {monster?.name ?? "Monster"} retreats · Select a glowing adjacent hex.
        </div>}
        <p className="sr-only" id="board-description">Select a glowing legal adjacent hex to retreat the monster.</p>
      </div>
      <aside className="game-side-panel" aria-label="Fight status">
        <TurnProgress game={game} />
        <div className="card action-card" id="monster-retreat-status-message" aria-label="Fight status message">
          <TurnPrompt
            action="Fight"
            description={pending?.monsterId ? "The monster must retreat. Select a glowing adjacent hex on the board." : "Monster retreat resolved."}
            rulesHelp={{ title: "Resolve retreat", body: "Select a glowing adjacent hex for the monster." }}
            unavailableReason=""
            canAct
            lastFightRolls={[]}
            lastFightOutcomes={[]}
          />
        </div>
        <div className="card" aria-label="Production PhaseActions retreat presentation">
          <PhaseActions
            activeGame={game}
            onOpenMilitarySheet={() => undefined}
            canAct={canChoose}
            runCommand={runCommand}
            getLocationName={(key) => key}
            pendingAttackPrompt=""
            canSpendInfamyOnPendingBattle={false}
            retreatChoices={retreatChoices}
            setRetreatChoices={setRetreatChoices}
          />
        </div>
      </aside>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
