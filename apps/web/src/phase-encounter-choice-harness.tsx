import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { applyCommand, createGame, locationIdToHexKey, type GameCommand, type GameState } from "@abominations/game-engine";
import { PhaseActions } from "./components/PhaseActions";
import "./styles.css";
import "./fullscreen-shell.css";
import "./command-panels.css";

type Scenario = "zorb-city" | "iron-stomach";
type HarnessWindow = Window & {
  __phaseEncounterChoiceHarness?: {
    replayLastAcceptedCommand: () => Promise<void>;
  };
};

const matchId = "phase-encounter-choice-acceptance";
const query = new URLSearchParams(window.location.search);
const scenario = query.get("scenario") === "iron-stomach" ? "iron-stomach" : "zorb-city";
const waitingRole = query.get("role") === "waiting";
const injectFailure = query.get("injectFailure") === "once";
const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function prepareEncounterFixture(selectedScenario: Scenario, seedChoiceForWaitingRole: boolean): GameState {
  const game = createGame(2, 4078, matchId);
  game.currentPlayer = 0;
  game.phase = "encounter";
  game.pendingDecision = {
    type: "encounter-resolution",
    playerIndex: 0,
    location: locationIdToHexKey(selectedScenario === "iron-stomach" ? "denver" : "los-angeles")!,
  };
  const monster = game.monsters[0]!;
  monster.location = game.pendingDecision.location;
  monster.health = selectedScenario === "iron-stomach" ? 5 : 1;
  monster.infamy = 0;
  if (selectedScenario === "iron-stomach") game.players[0]!.mutationCardIds = ["Iron Stomach"];

  if (!seedChoiceForWaitingRole) return game;
  const pending = applyCommand(game, { type: "resolve-encounter" }).state;
  if (pending.pendingDecision?.type !== "encounter-choice") {
    throw new Error(`Expected an encounter choice for waiting ${selectedScenario}; got ${pending.pendingDecision?.type ?? "none"}.`);
  }
  if (pending.pendingDecision.source !== selectedScenario) {
    throw new Error(`Expected ${selectedScenario} choice source; got ${pending.pendingDecision.source ?? "unspecified"}.`);
  }
  return pending;
}

function Harness() {
  const [game, setGame] = useState(() => prepareEncounterFixture(scenario, waitingRole));
  const initialEventCount = useRef(game.eventLog.length);
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState("");
  const commandErrorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [attemptedCommands, setAttemptedCommands] = useState<GameCommand[]>([]);
  const [appliedCommands, setAppliedCommands] = useState<GameCommand[]>([]);
  const actionHeadingRef = useRef<HTMLHeadingElement>(null);
  const commandInFlight = useRef(false);
  const failNextCommand = useRef(injectFailure);
  const lastAcceptedCommand = useRef<GameCommand | null>(null);
  const replayLastAcceptedCommand = useRef<() => Promise<void>>(async () => undefined);

  const canAct = !waitingRole && !pendingAction;
  const runCommand = async (command: GameCommand, opener?: HTMLButtonElement) => {
    if (commandInFlight.current || !canAct) return;
    commandErrorOpenerRef.current = null;
    commandInFlight.current = true;
    setPendingAction(true);
    setError("");
    setAttemptedCommands((current) => [...current, command]);
    await delay(90);
    try {
      if (failNextCommand.current && command.type === "resolve-encounter" && command.choice) {
        failNextCommand.current = false;
        throw new Error("Harness-injected command-handler failure.");
      }
      const result = applyCommand(game, command);
      setGame(result.state);
      setAppliedCommands((current) => [...current, command]);
      lastAcceptedCommand.current = command;
    } catch (caught) {
      commandErrorOpenerRef.current = opener ?? null;
      setError(caught instanceof Error ? caught.message : "Fixture command failed.");
    } finally {
      commandInFlight.current = false;
      setPendingAction(false);
    }
  };

  replayLastAcceptedCommand.current = async () => {
    if (lastAcceptedCommand.current) await runCommand(lastAcceptedCommand.current);
  };

  useEffect(() => {
    const harnessWindow = window as HarnessWindow;
    harnessWindow.__phaseEncounterChoiceHarness = {
      replayLastAcceptedCommand: () => replayLastAcceptedCommand.current(),
    };
    return () => { delete harnessWindow.__phaseEncounterChoiceHarness; };
  }, []);

  useEffect(() => {
    if (pendingAction || !error) return;
    const opener = commandErrorOpenerRef.current;
    commandErrorOpenerRef.current = null;
    if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
  }, [error, pendingAction]);

  useEffect(() => {
    if (game.phase !== "encounter") actionHeadingRef.current?.focus({ preventScroll: true });
  }, [game.phase]);

  const activeMonster = game.monsters[game.currentPlayer]!;
  const snapshot = {
    scenario,
    roleProjection: waitingRole ? "canAct=false fixture; no live room or server role is mounted" : "active chooser fixture",
    canAct,
    pendingAction,
    phase: game.phase,
    currentPlayer: game.currentPlayer,
    decision: game.pendingDecision,
    monster: { name: activeMonster.name, health: activeMonster.health, maxHealth: activeMonster.maxHealth, infamy: activeMonster.infamy },
    initialEventCount: initialEventCount.current,
    eventCount: game.eventLog.length,
    lastEventAction: game.eventLog.at(-1)?.action ?? null,
    lastEventDetail: game.eventLog.at(-1)?.detail ?? null,
    attemptedCommands,
    appliedCommands,
    error,
  };

  return <main className="game-screen phase-encounter-choice-harness">
    <header><h1>Encounter reward choice fixture</h1></header>
    <h2 id="phase-choice-action-heading" ref={actionHeadingRef} tabIndex={-1}>Deploy phase actions</h2>
    <output id="phase-encounter-choice-state" aria-label="Encounter choice fixture state" hidden>{JSON.stringify(snapshot)}</output>
    <p className="phase-choice-fixture-status" role="status">
      {waitingRole ? "Waiting player projection · controls unavailable" : "Active decision maker · encounter choice available"}
      {pendingAction ? " · command pending" : ""}
    </p>
    {error && <p id="phase-choice-error" className="error" role="alert">{error}</p>}
    <section className="layout panel-closed" aria-label="Encounter phase actions">
      <div className="bottom-context-dock">
    {game.phase === "encounter" ? <details className="piece-context-tab" open key={game.phase}>
      <summary><span>Encounter options</span><small>Open <span aria-hidden="true">⌃</span></small></summary>
          <div className="context-tab-body">
            <PhaseActions
              activeGame={game}
              onOpenMilitarySheet={() => undefined}
              canAct={canAct}
              runCommand={runCommand}
              getLocationName={(key) => key}
              pendingAttackPrompt=""
              canSpendInfamyOnPendingBattle={false}
              retreatChoices={{}}
              setRetreatChoices={() => undefined}
            />
          </div>
        </details> : <p className="phase-choice-resolved" role="status">Encounter reward resolved.</p>}
      </div>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
