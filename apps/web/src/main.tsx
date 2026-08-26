import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyCommand,
  chooseBranch,
  chooseLair,
  chooseMonster,
  chooseStartingChoice,
  createGame,
  createDevelopmentVictoryGame,
  createProvisionalPlaytestGame,
  createGameFromSetup,
  FULL_HONEYCOMB_BOARD,
  PROVISIONAL_AUTHORITATIVE_BOARD,
  isHexKey,
  getLocation,
    legalNationalGuardDeploymentDestinations,
    legalOwnedDeploymentDestinations,
  legalMonsterDestinations,
  legalMonsterPaths,
  legalUnitPaths,
  BRANCH_DEPLOYMENT_DEFINITIONS,
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupState,
} from "@abominations/game-engine";
import type { RoomView, SessionResponse } from "@abominations/shared";
import {
  createRoom,
  joinRoom,
  markDisconnected,
  markReconnected,
  readRoom,
  sendCommand,
  sendSetupAction,
  setReady,
  spectateRoom,
  websocketUrl,
} from "./api";
import { createCompletedDevelopmentSetup, createDevelopmentSetup } from "./development-setup";
import { boardForGame } from "./board-pin";
import { BoardReferenceCard } from "./components/BoardReferenceCard";
import { ActionDock } from "./components/ActionDock";
import { LobbyPanel } from "./components/LobbyPanel";
import { LogPanel } from "./components/LogPanel";
import { MatchStatus } from "./components/MatchStatus";
import { PhaseActions } from "./components/PhaseActions";
import { ChallengeActions } from "./components/ChallengeActions";
import { BlondeLureActions } from "./components/BlondeLureActions";
import { PieceStackInspector } from "./components/PieceStackInspector";
import { PlayerStatusControls } from "./components/PlayerStatusControls";
import { RevealedCardsPanel } from "./components/RevealedCardsPanel";
import { SelectedPieceTray } from "./components/SelectedPieceTray";
import { SettingsPanel } from "./components/SettingsPanel";
import { SetupPanel } from "./components/SetupPanel";
import { TerminalSummary } from "./components/TerminalSummary";
import { TurnPrompt } from "./components/TurnPrompt";
import { TurnProgress } from "./components/TurnProgress";
import { UnitCard } from "./components/UnitCard";
import { HexGrid } from "./components/HexGrid";
import { HomeScreen } from "./components/HomeScreen";
import { BoardReview } from "./components/BoardReview";
import { EncounterResultPanel } from "./components/EncounterResultPanel";
import { ChallengeDuelPanel } from "./components/ChallengeDuelPanel";
import { ActionResolutionFeedback } from "./components/ActionResolutionFeedback";
import { playSound, type SoundCategory } from "./audio";
import { activatePwaUpdate, registerPwaServiceWorker } from "./pwa";
import "./styles.css";

const MAP_ZOOM_MIN = 0.9;
const MAP_ZOOM_MAX = 1.75;
const MAP_PAN_STEP = 8;

function clampMapPan(pan: { x: number; y: number }, zoom: number) {
  const extent = Math.max(0, (zoom - 1) * 50);
  return {
    x: Math.max(-extent, Math.min(extent, pan.x)),
    y: Math.max(-extent, Math.min(extent, pan.y)),
  };
}

function clampMapZoom(zoom: number) {
  return Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, Number(zoom.toFixed(2))));
}

function supportsPlaytestBrowser(): boolean {
  return typeof window !== "undefined"
    && typeof WebSocket !== "undefined"
    && typeof fetch !== "undefined"
    && typeof crypto !== "undefined"
    && typeof crypto.randomUUID === "function"
    && typeof localStorage !== "undefined"
    && typeof CSS !== "undefined"
    && CSS.supports("height", "100dvh");
}

function acceptedActionLabel(command: GameCommand): string | undefined {
  switch (command.type) {
    case "resolve-fight": return command.targetUnitId ? "Target resolved" : "Fight resolved";
    case "retreat": return "Retreat resolved";
    case "resolve-encounter": return command.choice ? "Encounter choice resolved" : command.trophyUnitId ? "Trophy choice resolved" : "Encounter resolved";
    case "deploy": return "Deployment resolved";
    case "redeploy": return "Redeployment resolved";
    case "draw-research": return "Research card drawn";
    case "pass-deploy": return "Deployment passed";
    case "pass-move": return "Move step resolved";
    case "disappear-monster": return "Monster disappearance resolved";
    case "concede": return "Concession recorded";
    case "advance": return "Action resolved";
    case "move":
    case "move-unit": return undefined;
  }
}

function safeStorageGet(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStoredNumber(key: string, fallback: number): number {
  const value = Number(safeStorageGet(key));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function App() {
  const actionHeadingRef = useRef<HTMLHeadingElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapDragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [game, setGame] = useState<GameState>(() => createGame(2));
  const [localPlaytestStarted, setLocalPlaytestStarted] = useState(false);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [roomPrivacy, setRoomPrivacy] = useState<"private" | "public">("private");
  const [localSetup, setLocalSetup] = useState<SetupState>(() =>
    createDevelopmentSetup(2),
  );
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const [selectedPath, setSelectedPath] = useState<HexKey[]>([]);
  const [hoveredPath, setHoveredPath] = useState<HexKey[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedUnitPath, setSelectedUnitPath] = useState<HexKey[]>([]);
  const [acceptedMoveAnimation, setAcceptedMoveAnimation] = useState<{ path: HexKey[]; pieceId: string; key: number } | null>(null);
  const [acceptedActionFeedback, setAcceptedActionFeedback] = useState<{ label: string; key: number } | null>(null);
  const [selectedStackKey, setSelectedStackKey] = useState<HexKey | null>(null);
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [onboardingOpen, setOnboardingOpen] = useState(() => safeStorageGet("abominations-onboarding-seen") !== "1");
  const [homeRulesOpen, setHomeRulesOpen] = useState(false);
  const [boardReviewOpen, setBoardReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gamePanelOpen, setGamePanelOpen] = useState(false);
  const [largeText, setLargeText] = useState(() => safeStorageGet("abominations-large-text") === "1");
  const [showBoardLabels, setShowBoardLabels] = useState(() => safeStorageGet("abominations-board-labels") !== "0");
  const [manualReducedMotion, setManualReducedMotion] = useState(() => safeStorageGet("abominations-reduced-motion") === "1");
  const [confirmIrreversible, setConfirmIrreversible] = useState(() => safeStorageGet("abominations-confirm-irreversible") !== "0");
  const [masterVolume, setMasterVolume] = useState(() => safeStoredNumber("abominations-master-volume", 1));
  const [musicVolume, setMusicVolume] = useState(() => safeStoredNumber("abominations-music-volume", 0));
  const [effectsVolume, setEffectsVolume] = useState(() => safeStoredNumber("abominations-effects-volume", 0.7));
  const [muted, setMuted] = useState(() => safeStorageGet("abominations-audio-muted") === "1");
  const lastSoundEventRef = useRef<string | undefined>(undefined);
  const [connectionState, setConnectionState] = useState<
    "online" | "reconnecting" | "stale" | "offline"
  >("offline");
  const online = Boolean(session && room);
  const browserSupported = supportsPlaytestBrowser();
  const activeGame = room?.state ?? game;
  const activePlayer = activeGame.monsters[activeGame.currentPlayer];
  const activeLocation = getLocation(activePlayer.location);
  const activeBoard = boardForGame(activeGame);
  const activeBoardHex = activeBoard && isHexKey(activePlayer.location) ? activeBoard.hexes[activePlayer.location] : undefined;
  const guardCommanderActive = activeGame.players[activeGame.currentPlayer]?.researchCardIds.includes("Guard Commander") ?? false;
  const availableGuardUnitId = guardCommanderActive
    ? activeGame.nationalGuard.unitIds.find((unitId) => !activeGame.units.some((unit) => unit.id === unitId))
    : undefined;
  const guardDeploymentDestination = legalNationalGuardDeploymentDestinations(activeGame).at(0);
  const activeBranch = activeGame.setupAssignments?.[activeGame.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as const)[activeGame.currentPlayer % 4];
  const activeDeploymentDefinition = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === activeBranch);
  const ownedDeploymentDestinations = legalOwnedDeploymentDestinations(activeGame);
  const availableXFighterUnitId = activeGame.players[activeGame.currentPlayer]?.researchCardIds.includes("X-Fighters")
    ? activeGame.units.find((unit) => unit.unitTypeId === "x-fighter" && unit.ownerPlayer === activeGame.currentPlayer && unit.location === "record-tile" && !activeGame.removedUnitIds.includes(unit.id))?.id
    : undefined;
  const ownDeploymentAvailable = activeGame.deploymentsThisTurn < (activeDeploymentDefinition?.ownOrGuardUnits ?? 0)
    && ownedDeploymentDestinations.length > 0
    && (Boolean(availableXFighterUnitId) || activeGame.units.some((unit) => unit.branch === activeBranch && unit.location === "record-tile" && !activeGame.removedUnitIds.includes(unit.id)));
  const guardDeploymentAvailable = Boolean(availableGuardUnitId && guardDeploymentDestination)
    && activeGame.deploymentsThisTurn < ((activeDeploymentDefinition?.ownOrGuardUnits ?? 0) + (activeDeploymentDefinition?.additionalNationalGuardUnits ?? 0));
  const legalPaths = useMemo(
    () => legalMonsterPaths(activeGame, activePlayer.id),
    [activeGame, activePlayer.id],
  );
  const legalDestinations = useMemo(
    () => new Set(legalMonsterDestinations(activeGame, activePlayer.id)),
    [activeGame, activePlayer.id],
  );
  const legalUnitPathsForSelection = useMemo(
    () => (selectedUnitId ? legalUnitPaths(activeGame, selectedUnitId) : []),
    [activeGame, selectedUnitId],
  );
  const selectableUnitIds = useMemo(
    () => new Set(activeGame.units.filter((unit) => legalUnitPaths(activeGame, unit.id).length > 0).map((unit) => unit.id)),
    [activeGame],
  );
  const legalUnitDestinations = useMemo(
    () => new Set(legalUnitPathsForSelection.map((path) => path.at(-1)!)),
    [legalUnitPathsForSelection],
  );
  const activeResearchLure = activeGame.activeResearchLure?.monsterId === activePlayer.id
    ? activeGame.activeResearchLure
    : undefined;
  const researchLurePrompt = activeResearchLure
    ? `Blonde Lure is active: end this Move on ${getLocation(activeResearchLure.destination)?.name ?? activeResearchLure.destination} if that destination is reachable.`
    : undefined;
  const action = pendingAction
    ? "Waiting for server…"
    : activeGame.phase === "move"
      ? "Move"
      : activeGame.phase === "fight"
        ? "Fight"
        : activeGame.phase === "encounter"
          ? "Encounter"
          : activeGame.phase === "challenge"
            ? "Monster Challenge"
          : activeGame.phase === "game-over"
            ? `Victory · ${activeGame.monsters[activeGame.winnerPlayer ?? 0]?.name}`
            : "Deploy";
  const pendingAttackTarget = activeGame.pendingDecision?.type === "attack-target"
    ? activeGame.pendingDecision
    : undefined;
  const pendingAttackPrompt = pendingAttackTarget
    ? `Choose the target for attack ${pendingAttackTarget.attackNumber ?? 1}${pendingAttackTarget.attackTotal ? ` of ${pendingAttackTarget.attackTotal}` : ""} in combat round ${pendingAttackTarget.round ?? 1}.`
    : "Choose the target for the monster attack.";
  const pendingBattleDecision = activeGame.pendingDecision?.type === "battle-resolution"
    ? activeGame.pendingDecision
    : undefined;
  const pendingBattle = pendingBattleDecision
    ? activeGame.pendingBattles.find((battle) => battle.id === pendingBattleDecision.battleId)
    : undefined;
  const lastFightEvent = [...activeGame.eventLog].reverse().find((entry) => entry.action === "fight.resolved");
  const lastFightRolls = Array.isArray(lastFightEvent?.detail.rolls)
    ? lastFightEvent.detail.rolls.filter((roll): roll is number => typeof roll === "number")
    : [];
  const lastFightOutcomes = Array.isArray(lastFightEvent?.detail.attacks)
    ? lastFightEvent.detail.attacks
      .filter((attack): attack is Record<string, unknown> => Boolean(attack && typeof attack === "object"))
      .map((attack) => {
        const roll = typeof attack.roll === "number" ? `roll ${attack.roll}` : "recorded roll";
        const result = attack.hit === true ? `hit for ${typeof attack.damage === "number" ? attack.damage : "recorded damage"}${attack.smash === true ? ", smash" : ""}` : "missed";
        const modifiers = Array.isArray(attack.modifiers) ? attack.modifiers.filter((modifier): modifier is string => typeof modifier === "string") : [];
        return `${roll}: ${result}${modifiers.length ? ` (${modifiers.join(", ")})` : ""}`;
      })
    : [];
  const lastEncounterEvent = [...activeGame.eventLog].reverse().find((entry) => ["encounter.resolved", "encounter.choice-required", "trophy.choice-required"].includes(entry.action));
  const lastChallengeEvent = [...activeGame.eventLog].reverse().find((entry) => entry.action === "challenge.resolved");
  const challengeRolls = Array.isArray(lastChallengeEvent?.detail.rolls)
    ? lastChallengeEvent.detail.rolls.filter((roll): roll is number => typeof roll === "number")
    : [];
  const challengeAttacks = Array.isArray(lastChallengeEvent?.detail.attacks)
    ? lastChallengeEvent.detail.attacks
      .filter((attack): attack is Record<string, unknown> => Boolean(attack && typeof attack === "object"))
      .map((attack) => ({
        attackerId: typeof attack.attackerId === "string" ? attack.attackerId : "monster",
        targetId: typeof attack.targetId === "string" ? attack.targetId : "monster",
        roll: typeof attack.roll === "number" ? attack.roll : 0,
        hit: attack.hit === true,
        smash: attack.smash === true,
        damage: typeof attack.damage === "number" ? attack.damage : 0,
        targetHealthBefore: typeof attack.targetHealthBefore === "number" ? attack.targetHealthBefore : undefined,
        targetHealthAfter: typeof attack.targetHealthAfter === "number" ? attack.targetHealthAfter : undefined,
      }))
    : [];
  const encounterEffects = Array.isArray(lastEncounterEvent?.detail.effects)
    ? lastEncounterEvent.detail.effects.filter((effect): effect is { type: string; amount: number; source: string } => Boolean(effect && typeof effect === "object" && typeof effect.type === "string" && typeof effect.amount === "number" && typeof effect.source === "string"))
    : [];
  const encounterRolls = Array.isArray(lastEncounterEvent?.detail.rolls)
    ? lastEncounterEvent.detail.rolls.filter((roll): roll is number => typeof roll === "number")
    : [];
  const encounterChoices = Array.isArray(lastEncounterEvent?.detail.choices)
    ? lastEncounterEvent.detail.choices.filter((choice): choice is string => typeof choice === "string")
    : [];
  const encounterMutationDraws = Array.isArray(lastEncounterEvent?.detail.mutationDraws)
    ? lastEncounterEvent.detail.mutationDraws.filter((draw): draw is { siteId: string; cardDrawn: boolean; effectStatus: "implemented" | "source-gated" | "none" } => Boolean(draw && typeof draw === "object" && typeof draw.siteId === "string" && typeof draw.cardDrawn === "boolean" && (draw.effectStatus === "implemented" || draw.effectStatus === "source-gated" || draw.effectStatus === "none")))
    : [];
  const lastRecoveryEvent = [...activeGame.eventLog].reverse().find((entry) =>
    ["turn.passed", "research.drawn"].includes(entry.action) && typeof entry.detail.recoveryRoll === "number",
  );
  const canSpendInfamyOnPendingBattle = Boolean(
    pendingBattle &&
    activePlayer.infamy > 0,
  );
  const participant =
    room && session
      ? room.participants.find(
          (candidate) => candidate.id === session.participantId,
        )
      : undefined;
  const activeSetup = online ? activeGame.setupState : localSetup;
  const localSetupComplete = localSetup.phase === "complete";
  const setupComplete = !activeSetup || activeSetup.phase === "complete";
  const decisionPlayer = activeGame.pendingDecision?.type === "trophy-choice"
    ? activeGame.pendingDecision.playerIndex
    : activeGame.currentPlayer;
  const canAct =
    setupComplete &&
    !pendingAction &&
    activeGame.phase !== "game-over" &&
    (!online ||
      (participant?.role === "player" &&
        participant.playerIndex === decisionPlayer));
  const unavailableReason = pendingAction
    ? "Waiting for the authoritative server acknowledgement."
    : !setupComplete
      ? "Complete setup before taking a gameplay action."
      : online && participant?.role !== "player"
        ? "Spectators can follow the match but cannot submit actions."
        : online && participant?.playerIndex !== decisionPlayer
          ? `Waiting for Player ${decisionPlayer + 1} to make the current decision.`
          : activeGame.phase === "game-over"
            ? "The match is complete; gameplay actions are disabled."
            : "";
  const actionDock = activeGame.phase === "move"
    ? selectedUnitPath.length > 1
      ? { label: "Confirm unit move", command: { type: "move-unit", unitId: selectedUnitId!, path: selectedUnitPath } as GameCommand }
      : selectedPath.length > 1
        ? { label: "Confirm monster move", command: { type: "move", path: selectedPath } as GameCommand }
        : { label: "Select a highlighted destination", command: undefined }
    : activeGame.phase === "fight"
      ? pendingBattle && !pendingAttackTarget && !activeGame.pendingDecision?.type?.includes("retreat") && !canSpendInfamyOnPendingBattle && activeGame.pendingBattles.length === 1
        ? { label: "Resolve fight", command: { type: "resolve-fight", battleId: pendingBattle.id } as GameCommand }
        : { label: "Choose the Fight decision", command: undefined }
      : activeGame.phase === "encounter"
        ? activeGame.pendingDecision
          ? { label: "Choose the Encounter decision", command: undefined }
          : { label: "Resolve encounter", command: { type: "resolve-encounter" } as GameCommand }
        : activeGame.phase === "deploy"
          ? { label: "Pass deployment", command: { type: "pass-deploy" } as GameCommand }
          : { label: "Match complete", command: undefined };
  const resetMapView = () => {
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
  };
  const panMap = (x: number, y: number) => setMapPan((current) => clampMapPan({ x: current.x + x, y: current.y + y }, mapZoom));
  const setClampedMapZoom = (nextZoom: number) => {
    const zoom = clampMapZoom(nextZoom);
    setMapZoom(zoom);
    setMapPan((current) => clampMapPan(current, zoom));
  };
  const startMapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    mapDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: mapPan.x, panY: mapPan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = mapDragRef.current;
    const map = mapRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !map) return;
    const bounds = map.getBoundingClientRect();
    setMapPan(clampMapPan({
      x: drag.panX + ((event.clientX - drag.x) / bounds.width) * 100,
      y: drag.panY + ((event.clientY - drag.y) / bounds.height) * 100,
    }, mapZoom));
  };
  const endMapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current?.pointerId !== event.pointerId) return;
    mapDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const zoomMapWithWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setClampedMapZoom(mapZoom + (event.deltaY < 0 ? .1 : -.1));
  };

  useEffect(() => {
    actionHeadingRef.current?.focus();
  }, [activeGame.phase, activeGame.round, room?.version, localPlaytestStarted]);
  useEffect(() => {
    // Setup is intentionally panel-open, but gameplay should return to the
    // board-first presentation as soon as the authoritative setup completes.
    if ((localPlaytestStarted || online) && setupComplete) {
      setGamePanelOpen(false);
    }
  }, [localPlaytestStarted, online, setupComplete]);
  const setupSeat =
    activeSetup?.phase === "monster-selection"
      ? activeSetup.seats.find((seat) => !seat.monsterId)
      : activeSetup?.phase === "branch-selection"
        ? [...activeSetup.seats]
            .sort((a, b) => b.playerIndex - a.playerIndex)
            .find((seat) => !seat.branch)
        : (activeSetup?.seats.find(
            (seat) => !seat.lair && activeSetup.phase === "lair-selection",
          ) ??
          activeSetup?.seats.find(
            (seat) =>
              !seat.startingChoice && activeSetup.phase === "starting-choice",
          ));
  useEffect(() => {
    setSelectedPath([]);
    setHoveredPath([]);
    setSelectedUnitId(null);
    setSelectedUnitPath([]);
    setRetreatChoices({});
  }, [activeGame.currentPlayer, activeGame.phase, activePlayer.location]);

  useEffect(() => {
    if (!acceptedMoveAnimation) return;
    const timeout = window.setTimeout(() => setAcceptedMoveAnimation(null), 720);
    return () => window.clearTimeout(timeout);
  }, [acceptedMoveAnimation]);

  useEffect(() => {
    if (!acceptedActionFeedback) return;
    const timeout = window.setTimeout(() => setAcceptedActionFeedback(null), 1100);
    return () => window.clearTimeout(timeout);
  }, [acceptedActionFeedback]);

  useEffect(() => {
    const saved = safeStorageGet("abominations-session");
    if (!saved) return;
    try {
      const stored = JSON.parse(saved) as {
        token: string;
        participantId: string;
        room?: { code: string };
      };
      if (!stored.token || !stored.room?.code) return;
      void readRoom(stored.room.code, stored.token)
        .then((restoredRoom) => {
          setSession({
            token: stored.token,
            participantId: stored.participantId,
            room: restoredRoom,
          });
          setRoom(restoredRoom);
          setRoomCode(restoredRoom.code);
        })
        .catch(() => localStorage.removeItem("abominations-session"));
    } catch {
      localStorage.removeItem("abominations-session");
    }
  }, []);

  useEffect(() => {
    if (!session || !room) return;
    const socket = new WebSocket(websocketUrl(room.code, session.token));
    let polling: ReturnType<typeof setInterval> | undefined;
    let disconnected = false;
    const markOffline = () => {
      if (disconnected) return;
      disconnected = true;
      void markDisconnected(room.code, session.token).catch(() => undefined);
    };
    const startPolling = () => {
      if (polling) return;
      setConnectionState("reconnecting");
      polling = setInterval(() => {
        readRoom(room.code, session.token, room.version)
          .then((nextRoom) => markReconnected(room.code, session.token).then((reconnectedRoom) => {
            setRoom(reconnectedRoom ?? nextRoom);
            disconnected = false;
            setConnectionState("online");
          }))
          .catch(() => setConnectionState("stale"));
      }, 2000);
    };
    socket.onopen = () => {
      void markReconnected(room.code, session.token)
        .then((nextRoom) => {
          setRoom(nextRoom);
          setConnectionState("online");
          if (polling) {
            clearInterval(polling);
            polling = undefined;
          }
        })
        .catch(() => setConnectionState("stale"));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        type: string;
        room: RoomView;
      };
      if (message.type === "room.updated") {
        setRoom(message.room);
        setConnectionState("online");
      }
    };
    socket.onerror = () => {
      markOffline();
      startPolling();
    };
    socket.onclose = () => {
      markOffline();
      startPolling();
    };
    return () => {
      markOffline();
      socket.close();
      if (polling) clearInterval(polling);
    };
  }, [session?.token, room?.code]);

  const runCommand = async (command: GameCommand) => {
    if (pendingAction) return;
    setError("");
    setPendingAction(true);
    // Keep the pending-action surface observable for one render even when the
    // development fixture resolves locally without a network round trip.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const normalized: GameCommand =
      command.type === "advance"
        ? activeGame.phase === "fight"
          ? { type: "resolve-fight" }
          : activeGame.phase === "encounter"
            ? { type: "resolve-encounter" }
            : { type: "deploy" }
        : command;
    const acceptedMove = normalized.type === "move"
      ? { path: normalized.path as HexKey[], pieceId: activePlayer.id }
      : normalized.type === "move-unit"
        ? { path: normalized.path as HexKey[], pieceId: normalized.unitId }
        : undefined;
    try {
      if (online && session && room) {
        const nextRoom = await sendCommand(
          room.code,
          session.token,
          session.participantId,
          room.version,
          normalized,
        );
        setRoom(nextRoom);
        if (acceptedMove) setAcceptedMoveAnimation({ ...acceptedMove, key: Date.now() });
        const actionLabel = acceptedActionLabel(normalized);
        if (actionLabel) setAcceptedActionFeedback({ label: actionLabel, key: Date.now() });
      } else {
        const result = applyCommand(game, normalized);
        setGame(result.state);
        if (acceptedMove) setAcceptedMoveAnimation({ ...acceptedMove, key: Date.now() });
        const actionLabel = acceptedActionLabel(normalized);
        if (actionLabel) setAcceptedActionFeedback({ label: actionLabel, key: Date.now() });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
      if (online && session && room) {
        try {
          setRoom(await readRoom(room.code, session.token));
        } catch {
          /* retain the original action error when refresh also fails */
        }
      }
    } finally {
      setPendingAction(false);
    }
  };

  const startSession = async (kind: "create" | "join" | "spectate") => {
    setError("");
    setLocalPlaytestStarted(false);
    setOnboardingOpen(false);
    setGamePanelOpen(false);
    try {
      const result =
        kind === "create"
          ? await createRoom(playerCount, displayName || "Player 1", roomPrivacy)
          : kind === "join"
            ? await joinRoom(roomCode, displayName || "Player")
            : await spectateRoom(roomCode, displayName || "Spectator");
      setSession(result);
      setRoom(result.room);
      setRoomCode(result.room.code);
      localStorage.setItem(
        "abominations-session",
        JSON.stringify({
          token: result.token,
          participantId: result.participantId,
          room: { code: result.room.code },
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not join room",
      );
    }
  };
  const startRematch = async () => {
    if (!room) return;
    setError("");
    setPendingAction(true);
    try {
      const count = room.participants.filter((candidate) => candidate.role === "player").length;
      const rematchPlayerCount = (count === 3 || count === 4 ? count : 2) as 2 | 3 | 4;
      const result = await createRoom(rematchPlayerCount, displayName || "Player 1");
      setPlayerCount(rematchPlayerCount);
      setSession(result);
      setRoom(result.room);
      setRoomCode(result.room.code);
      localStorage.setItem("abominations-session", JSON.stringify({ token: result.token, participantId: result.participantId, room: { code: result.room.code } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create rematch room");
    } finally {
      setPendingAction(false);
    }
  };

  const toggleReady = async () => {
    if (!session || !room || !participant || participant.role !== "player")
      return;
    try {
      setRoom(await setReady(room.code, session.token, !participant.ready));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update readiness",
      );
    }
  };

  const applyLocalSetup = (next: SetupState) => {
    setLocalSetup(next);
    if (next.phase === "complete") setGame(createGameFromSetup(next));
  };
  const chooseSetupOption = async (value: string) => {
    if (
      !setupSeat ||
      !activeSetup ||
      (online && participant?.playerIndex !== setupSeat.playerIndex)
    )
      return;
    if (online && session && room) {
      try {
        setRoom(
          await sendSetupAction(
            room.code,
            session.token,
            room.version,
            activeSetup.phase === "monster-selection"
              ? { type: "choose-monster", monsterId: value }
              : activeSetup.phase === "branch-selection"
                ? {
                    type: "choose-branch",
                    branch: value as "Army" | "Navy" | "Air Force" | "Marines",
                  }
                : { type: "choose-lair", lair: value },
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not update setup",
        );
      }
      return;
    }
    if (localSetup.phase === "monster-selection")
      applyLocalSetup(chooseMonster(localSetup, setupSeat.playerIndex, value));
    if (localSetup.phase === "branch-selection")
      applyLocalSetup(
        chooseBranch(
          localSetup,
          setupSeat.playerIndex,
          value as "Army" | "Navy" | "Air Force" | "Marines",
        ),
      );
    if (localSetup.phase === "lair-selection")
      applyLocalSetup(chooseLair(localSetup, setupSeat.playerIndex, value));
  };
  const chooseSetupStartingChoice = async (kind: "research" | "deploy") => {
    if (
      !setupSeat ||
      !activeSetup ||
      (online && participant?.playerIndex !== setupSeat.playerIndex)
    )
      return;
    const startingChoice =
      kind === "research"
        ? ({ kind } as const)
        : ({
            kind,
            unitId: "development-unit-0",
            destination: "denver",
          } as const);
    if (online && session && room) {
      try {
        setRoom(
          await sendSetupAction(room.code, session.token, room.version, {
            type: "choose-starting-choice",
            startingChoice,
          }),
        );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not update setup",
        );
      }
      return;
    }
    applyLocalSetup(
      chooseStartingChoice(localSetup, setupSeat.playerIndex, startingChoice),
    );
  };
  const changePlayerCount = (value: 2 | 3 | 4) => {
    setPlayerCount(value);
    setLocalSetup(createDevelopmentSetup(value));
    setGame(createGame(value));
  };
  const resetLocal = () => {
    setLocalPlaytestStarted(true);
    setOnboardingOpen(false);
    // Setup is a focused decision screen: keep the current-step prompt visible
    // so focus can move to it. The board-first closed layout returns after the
    // authoritative setup completes or the player closes the panel.
    setGamePanelOpen(true);
    setSession(null);
    setRoom(null);
    setError("");
    setPlayerCount(2);
    setLocalSetup(createDevelopmentSetup(2));
    setGame(createGame(2));
    localStorage.removeItem("abominations-session");
  };
  const startTemporaryVictoryScenario = () => {
    setLocalPlaytestStarted(true);
    setOnboardingOpen(false);
    setGamePanelOpen(true);
    setSession(null);
    setRoom(null);
    setError("");
    setPlayerCount(2);
    setLocalSetup(createCompletedDevelopmentSetup());
    setGame(createDevelopmentVictoryGame());
    localStorage.removeItem("abominations-session");
  };
  const startProvisionalPlaytest = () => {
    setLocalPlaytestStarted(true);
    setOnboardingOpen(false);
    setGamePanelOpen(false);
    setSession(null);
    setRoom(null);
    setError("");
    setPlayerCount(2);
    setLocalSetup(createCompletedDevelopmentSetup());
    setGame(createProvisionalPlaytestGame(2));
    localStorage.removeItem("abominations-session");
  };
  const leaveRoom = async () => {
    if (session && room) {
      try {
        await markDisconnected(room.code, session.token);
      } catch {
        // Returning to the lobby is still safe when the network is unavailable.
      }
    }
    setSession(null);
    setRoom(null);
    setError("");
    localStorage.removeItem("abominations-session");
  };
  const togglePreference = (key: string, setter: (value: boolean | ((current: boolean) => boolean)) => void) => {
    setter((current: boolean) => {
      const next = !current;
      localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  };
  const setStoredVolume = (key: string, setter: (value: number) => void, value: number) => {
    setter(value);
    localStorage.setItem(key, String(value));
  };
  const runIrreversibleAction = (actionToRun: () => void, message: string) => {
    if (!confirmIrreversible || window.confirm(message)) actionToRun();
  };
  const leaveRoomSafely = () => {
    if (online && activeGame.phase !== "game-over") {
      runIrreversibleAction(() => void leaveRoom(), "Leave this active match? Your seat will be marked disconnected.");
      return;
    }
    void leaveRoom();
  };
  const closeOnboarding = () => {
    setOnboardingOpen(false);
    localStorage.setItem("abominations-onboarding-seen", "1");
  };
  const log = useMemo(() => activeGame.log.slice(-5), [activeGame.log]);
  const eventLog = useMemo(
    () => (activeGame.eventLog ?? []).slice(-5).reverse(),
    [activeGame.eventLog],
  );
  const latestEvent = activeGame.eventLog.at(-1);
  useEffect(() => {
    if (!latestEvent?.id) return;
    if (lastSoundEventRef.current === latestEvent.id) return;
    const category: SoundCategory = latestEvent.action === "fight.resolved" || latestEvent.action === "challenge.resolved"
      ? "combat"
      : latestEvent.action === "research.drawn" || latestEvent.action === "mutation.used"
        ? "cards"
        : latestEvent.action === "match.conceded" || activeGame.phase === "game-over"
          ? "victory"
          : latestEvent.action.includes("rejected") || latestEvent.outcome === "rejected"
            ? "warnings"
            : latestEvent.action === "turn.passed"
              ? "turn"
              : "dice";
    playSound(category, { masterVolume, musicVolume, effectsVolume, muted });
    lastSoundEventRef.current = latestEvent.id;
  }, [activeGame.eventLog, activeGame.phase, effectsVolume, latestEvent, masterVolume, musicVolume, muted]);
  const baseTurnDescription = activeGame.phase === "move"
    ? selectedUnitId
      ? selectedUnitPath.length > 1
        ? `${selectedUnitPath.map((id) => getLocation(id)?.name ?? id).join(" → ")} · ${selectedUnitPath.length - 1} movement ${selectedUnitPath.length - 1 === 1 ? "space" : "spaces"}`
        : "Move the selected military unit along a highlighted path."
      : selectedPath.length > 1
        ? `${selectedPath.map((id) => getLocation(id)?.name ?? id).join(" → ")} · ${selectedPath.length - 1} movement ${selectedPath.length - 1 === 1 ? "space" : "spaces"}`
        : `Move up to ${activePlayer.move} spaces. Choose a connected location on the map.`
    : activeGame.phase === "fight"
      ? activeGame.pendingDecision?.type === "attack-target"
        ? pendingAttackPrompt
        : activeGame.pendingDecision?.type === "retreat"
          ? "Choose a legal retreat for every surviving military unit."
          : activeGame.pendingBattles.length > 1
            ? `Choose which of ${activeGame.pendingBattles.length} compulsory battles to resolve first.`
            : "Resolve the compulsory battle started by movement."
      : activeGame.phase === "encounter"
        ? "Resolve the space your monster ended on."
        : activeGame.phase === "challenge"
          ? activeGame.pendingDecision?.type === "challenge-opponent"
            ? "Choose the next eligible monster; it will appear in the challenger’s space for weigh-in."
            : activeGame.pendingDecision?.type === "challenge-giant"
              ? "Choose the next surviving giant military unit; giants are challenged last."
              : activeGame.pendingDecision?.type === "challenge-giant-resolution"
                ? "Resolve the giant duel; a giant victory immediately saves America."
                : "Resolve the recorded Monster Challenge duel; the challenger attacks first."
        : activeGame.phase === "game-over"
          ? "The development match is complete. Further commands are disabled."
          : `Place a legal military unit, then pass Deploy.${activeGame.deploymentsThisTurn ? ` ${activeGame.deploymentsThisTurn} placed this step.` : ""}`;
  const turnDescription = researchLurePrompt ? `${baseTurnDescription} ${researchLurePrompt}` : baseTurnDescription;
  const rulesHelp = activeGame.phase === "move"
    ? { title: "Move", body: `Select a highlighted monster or an owned or authorised unit, choose a connected legal destination, then confirm the previewed path. ${researchLurePrompt ?? "Pass Move when no further movement is required."}` }
    : activeGame.phase === "fight"
      ? activeGame.pendingDecision?.type === "attack-target"
        ? { title: "Choose an attack target", body: "Select one of the highlighted military units in the current battle. The recorded attack result is resolved by the shared engine after the target is confirmed." }
        : activeGame.pendingDecision?.type === "retreat"
          ? { title: "Resolve retreat", body: "Assign every surviving military unit a highlighted legal destination. Disappearance is offered only when the authoritative option set is empty." }
          : { title: "Resolve the compulsory Fight", body: "Choose a pending battle when more than one is available, then resolve the recorded monster-first combat sequence." }
      : activeGame.phase === "encounter"
        ? { title: "Resolve Encounter", body: "Resolve the space where the monster ended movement. Choose only from the reward, trophy, or city options shown by the engine." }
        : activeGame.phase === "challenge"
          ? activeGame.pendingDecision?.type === "challenge-opponent"
            ? { title: "Choose the next challenger", body: "Select an eligible monster shown by the engine. Hollywood, defeated, and self targets are not offered." }
            : activeGame.pendingDecision?.type === "challenge-giant"
              ? { title: "Choose the next giant", body: "After all monster duels, select the next surviving giant military unit. Giants never fight each other." }
              : activeGame.pendingDecision?.type === "challenge-giant-resolution"
                ? { title: "Resolve giant Challenge", body: "The monster attacks first. If the giant defeats the challenger, the authoritative result is America-saved." }
                : { title: "Resolve Monster Challenge", body: "The challenger attacks first. Review the recorded dice and Health transitions; this presentation cannot change the authoritative duel." }
          : activeGame.phase === "game-over"
            ? { title: "Match complete", body: "The terminal result is authoritative. No further commands can change the winner or victory type." }
            : { title: "Deploy", body: "Choose a legal deployment or redeployment, draw Research when the action is available, or pass Deploy to begin the next turn." };
  const choosePath = (destination: HexKey) => {
    const options = legalPaths
      .filter((path) => path.at(-1) === destination)
      .sort((a, b) => a.length - b.length);
    if (options[0]) setSelectedPath(options[0]);
  };
  const chooseUnitPath = (destination: HexKey) => {
    const options = legalUnitPathsForSelection
      .filter((path) => path.at(-1) === destination)
      .sort((a, b) => a.length - b.length);
    if (options[0]) setSelectedUnitPath(options[0]);
  };
  const previewPath = (destination: HexKey) => {
    const paths = selectedUnitId ? legalUnitPathsForSelection : legalPaths;
    const options = paths
      .filter((path) => path.at(-1) === destination)
      .sort((a, b) => a.length - b.length);
    setHoveredPath(options[0] ?? []);
  };

  if (!browserSupported) {
    return (
      <main className="unsupported-browser" role="main">
        <p className="eyebrow">ABOMINATIONS ATTACK AMERICA · BROWSER SUPPORT</p>
        <h1>This browser cannot run the playtest</h1>
        <p className="lede">Use a current Chrome, Edge, Firefox, Safari, or Chromium-based mobile browser with JavaScript, WebSocket, Fetch, CSS Grid, and dynamic viewport support enabled.</p>
        <p className="settings-note">No match state has been started. Update the browser and reload this page.</p>
      </main>
    );
  }

  if (boardReviewOpen) {
    return <BoardReview onClose={() => setBoardReviewOpen(false)} />;
  }
  if (!online && !localPlaytestStarted) {
    return (
      <HomeScreen
        online={false}
        room={null}
        participant={undefined}
        connectionState={connectionState}
        displayName={displayName}
        playerCount={playerCount}
        roomPrivacy={roomPrivacy}
        roomCode={roomCode}
        setupComplete={false}
        error={error}
        onDisplayNameChange={setDisplayName}
        onPlayerCountChange={changePlayerCount}
        onRoomPrivacyChange={setRoomPrivacy}
        onRoomCodeChange={setRoomCode}
        onStartSession={(kind) => void startSession(kind)}
        onToggleReady={() => undefined}
        onLeaveRoom={() => undefined}
        rulesOpen={homeRulesOpen}
        onToggleRules={() => setHomeRulesOpen((open) => !open)}
        onStartLocal={resetLocal}
        onStartProvisionalPlaytest={startProvisionalPlaytest}
        onOpenBoardReview={() => setBoardReviewOpen(true)}
        onStartVictoryScenario={startTemporaryVictoryScenario}
      />
    );
  }

  const renderedBoard = boardForGame(activeGame);
  const fullBoardVerified = renderedBoard?.id === FULL_HONEYCOMB_BOARD.id
    && Object.values(renderedBoard.hexes).every((hex) => hex.verification === "verified");
  const boardDescription = fullBoardVerified
    ? "The reviewed full honeycomb board is rendered from the pinned board definition; its cells are interactive only where the authoritative rules expose a legal action."
    : renderedBoard?.id === FULL_HONEYCOMB_BOARD.id
      ? "The full honeycomb coordinate shell is unresolved review tooling and is not a playable board; physical cell data remains unavailable until source transcription and sign-off are complete."
      : renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id
        ? "The provisional full honeycomb board is rendered from a separately pinned playtest guess; its physical labels, terrain, barriers, and feature positions remain unverified and are not production board data."
      : renderedBoard
      ? "The nine-space development board is rendered from the pinned development fixture. The unresolved physical-board shell is not part of this match; unknown physical-board data remains unavailable until source transcription is complete."
      : "This match references an unavailable board version, so board interaction is disabled until the matching definition is loaded.";

  return (
    <main className={`game-screen ${online ? "online-game" : "local-game"} ${gamePanelOpen ? "game-panel-open" : "game-panel-closed"} ${largeText ? "large-text" : ""} ${!showBoardLabels ? "board-labels-hidden" : ""} ${manualReducedMotion ? "manual-reduced-motion" : ""}`}>
      <header>
        <div>
          <p className="eyebrow">ABOMINATIONS ATTACK AMERICA · WEB PLAYTEST</p>
          <h1>Take the city. Become the legend.</h1>
          <p className="lede">
            A digital monster-versus-military strategy game. Local play and
            online rooms share the same rules engine.
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost game-panel-toggle" onClick={() => setGamePanelOpen((open) => !open)} aria-expanded={gamePanelOpen} aria-controls="game-side-panel">
            {gamePanelOpen ? "Hide details" : "Show details"}
          </button>
          <button className="ghost" onClick={() => setOnboardingOpen(true)}>
            How to play
          </button>
          <button className="ghost" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            Settings
          </button>
          <button className="ghost" onClick={resetLocal}>
            Development playtest
          </button>
        </div>
      </header>
      <LobbyPanel
        online={online}
        room={room}
        participant={participant}
        connectionState={connectionState}
        displayName={displayName}
        playerCount={playerCount}
        roomPrivacy={roomPrivacy}
        roomCode={roomCode}
        setupComplete={setupComplete}
        error={error}
        onDisplayNameChange={setDisplayName}
        onPlayerCountChange={changePlayerCount}
        onRoomPrivacyChange={setRoomPrivacy}
        onRoomCodeChange={setRoomCode}
        onStartSession={(kind) => void startSession(kind)}
        onToggleReady={() => void toggleReady()}
        onLeaveRoom={leaveRoomSafely}
      />
      {settingsOpen && (
        <SettingsPanel largeText={largeText} showBoardLabels={showBoardLabels} manualReducedMotion={manualReducedMotion} confirmIrreversible={confirmIrreversible} masterVolume={masterVolume} musicVolume={musicVolume} effectsVolume={effectsVolume} muted={muted} setLargeText={setLargeText} setShowBoardLabels={setShowBoardLabels} setManualReducedMotion={setManualReducedMotion} setConfirmIrreversible={setConfirmIrreversible} setMasterVolume={(value) => setStoredVolume("abominations-master-volume", setMasterVolume, value)} setMusicVolume={(value) => setStoredVolume("abominations-music-volume", setMusicVolume, value)} setEffectsVolume={(value) => setStoredVolume("abominations-effects-volume", setEffectsVolume, value)} setMuted={setMuted} togglePreference={togglePreference} />
      )}
      {onboardingOpen && (
        <section className="onboarding" aria-label="First match guide">
          <div>
            <span className="label">FIRST MATCH GUIDE</span>
            <h2>One turn, four decisions</h2>
            <p>Choose a monster and setup options, then use the shared board controls to move, resolve compulsory battles, take an Encounter, and Deploy. The current prompt always identifies the next authoritative decision.</p>
            <div className="onboarding-grid">
              <div><strong>Move</strong><span>Choose a highlighted path, confirm it, or leave the monster in place.</span></div>
              <div><strong>Fight</strong><span>Resolve every compulsory battle, choose targets or retreat destinations when prompted.</span></div>
              <div><strong>Encounter</strong><span>Take the available site reward or make the displayed choice.</span></div>
              <div><strong>Deploy</strong><span>Place a legal unit or Research card, then pass to the next player.</span></div>
            </div>
          </div>
          <div className="onboarding-actions">
            <span>Current decision: {action}</span>
            <button className="subtle" onClick={closeOnboarding}>Got it · hide guide</button>
          </div>
        </section>
      )}
      {activeSetup && (
        <SetupPanel
          activeSetup={activeSetup}
          setupSeat={setupSeat}
          online={online}
          playerIndex={participant?.playerIndex}
          participants={room?.participants ?? []}
          onChooseOption={(value) => void chooseSetupOption(value)}
          onChooseStartingChoice={(kind) => void chooseSetupStartingChoice(kind)}
        />
      )}
      <MatchStatus game={activeGame} action={action} />
      <TurnProgress game={activeGame} />
      <section className="development-notice" aria-label="Development ruleset notice">
        <span className="label">{renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id ? "PROVISIONAL HONEYCOMB PLAYTEST · NOT VERIFIED" : "DEVELOPMENT RULESET · PROTOTYPE 0.1"}</span>
        <p>
          {renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id
            ? "This local playtest uses the complete 254-cell provisional honeycomb board. Its guessed labels, terrain, barriers, and feature positions are not physically verified and cannot be used by production rooms."
            : "This playtest uses only the nine-space development fixture; the unresolved physical-board shell is not rendered as playable topology. The physical board transcription, full combat, card effects, National Guard rules, and Monster Challenge are not yet production-verified. The temporary victory condition ends the fixture when its active Stomp spaces are exhausted."}
        </p>
      </section>
      <section className={`layout ${gamePanelOpen ? "panel-open" : "panel-closed"}`}>
        <div className="board-panel">
          <div className="panel-heading">
            <div>
              <span className="label">
                TACTICAL MAP · RULE SPACE RECONSTRUCTION
              </span>
              <h2>{activeLocation?.name ?? activeBoardHex?.label ?? "Board position"}</h2>
            </div>
            <span className="chip">
              {online
                ? `ROOM ${room?.code}`
                : `PLAYER ${activeGame.currentPlayer + 1}`}
            </span>
          </div>
          <div className="map-controls" aria-label="Board view controls">
            <span className="label">BOARD VIEW</span>
            <button type="button" aria-label="Pan board left" onClick={() => panMap(-MAP_PAN_STEP, 0)}>←</button>
            <button type="button" aria-label="Pan board up" onClick={() => panMap(0, -MAP_PAN_STEP)}>↑</button>
            <button type="button" aria-label="Pan board down" onClick={() => panMap(0, MAP_PAN_STEP)}>↓</button>
            <button type="button" aria-label="Pan board right" onClick={() => panMap(MAP_PAN_STEP, 0)}>→</button>
            <button type="button" aria-label="Zoom board out" onClick={() => setClampedMapZoom(mapZoom - .25)}>−</button>
            <span className="map-zoom" aria-live="polite">{Math.round(mapZoom * 100)}%</span>
            <button type="button" aria-label="Zoom board in" onClick={() => setClampedMapZoom(mapZoom + .25)}>+</button>
            <button type="button" className="map-reset" onClick={resetMapView}>Fit / reset</button>
          </div>
          <div
            ref={mapRef}
            className="map"
            role="group"
            aria-label="Board coordinate shell"
            aria-describedby="board-description"
            data-board-id={activeGame.boardId}
            data-board-content-hash={activeGame.boardContentHash}
            data-rendered-board-id={renderedBoard?.id ?? "unavailable"}
            data-rendered-board-content-hash={renderedBoard?.contentHash ?? "unavailable"}
            onPointerDown={startMapDrag}
            onPointerMove={moveMapDrag}
            onPointerUp={endMapDrag}
            onPointerCancel={endMapDrag}
            onWheel={zoomMapWithWheel}
          >
            <div className="map-canvas" style={{ transform: `translate(${mapPan.x}%, ${mapPan.y}%) scale(${mapZoom})` }}>
            <HexGrid
              game={activeGame}
              activePlayerId={activePlayer.id}
              canAct={canAct}
              legalDestinations={legalDestinations}
              legalUnitDestinations={legalUnitDestinations}
              selectableUnitIds={selectableUnitIds}
              selectedUnitId={selectedUnitId}
              selectedPath={selectedPath}
              hoveredPath={hoveredPath}
              selectedUnitPath={selectedUnitPath}
              acceptedPath={acceptedMoveAnimation?.path ?? []}
              acceptedPieceId={acceptedMoveAnimation?.pieceId}
              acceptedAnimationKey={acceptedMoveAnimation?.key}
              onSelectUnit={(unitId) => {
                setSelectedUnitId(unitId);
                setSelectedPath([]);
                setSelectedUnitPath([]);
              }}
              onChoosePath={choosePath}
              onChooseUnitPath={chooseUnitPath}
              onPreviewPath={previewPath}
              onClearPreview={() => setHoveredPath([])}
            />
            </div>
          </div>
          <div className="board-action-bar">
            <ActionDock label={actionDock.label} canAct={canAct} command={actionDock.command} onAction={(command) => void runCommand(command)} onOpenPanel={() => setGamePanelOpen(true)} />
          </div>
          <p className="sr-only" id="board-description">
            {boardDescription}
          </p>
          <div className="board-secondary">
            <p className="map-note">The sea-and-land treatment is decorative only; legal movement and features come from the canonical engine board.</p>
            <p className="map-note">
              {canAct
                ? selectedUnitId
                  ? selectedUnitPath.length > 1
                    ? `Previewing ${selectedUnitPath.length - 1}-space unit path to ${getLocation(selectedUnitPath.at(-1)!)?.name}. Confirm or cancel below.`
                    : "Select a highlighted reachable space for the selected unit."
                  : selectedPath.length > 1
                    ? `Previewing ${selectedPath.length - 1}-space path to ${getLocation(selectedPath.at(-1)!)?.name}. Confirm or cancel below.`
                    : `Select a highlighted reachable space to preview a path for ${activePlayer.name}.`
                : "Waiting for the active player."}
            </p>
            <SelectedPieceTray
              game={activeGame}
              selectedUnitId={selectedUnitId}
              selectedUnitPath={selectedUnitPath}
              onClear={() => {
                setSelectedUnitId(null);
                setSelectedUnitPath([]);
              }}
            />
            <PlayerStatusControls game={activeGame} monster={activePlayer} branch={activeBranch} />
            <PieceStackInspector
              game={activeGame}
              activeMonsterId={activePlayer.id}
              selectedStackKey={selectedStackKey}
              onSelect={setSelectedStackKey}
              onClear={() => setSelectedStackKey(null)}
            />
          </div>
        </div>
        <aside id="game-side-panel" className="game-side-panel" aria-label="Game controls and information">
          <div className="card monster-card">
            <span className="label">MONSTER RECORD</span>
            <h2>{activePlayer.name}</h2>
            <div className="meter">
              <span
                style={{
                  width: `${(activePlayer.health / activePlayer.maxHealth) * 100}%`,
                }}
              />
            </div>
            <div className="stats">
              <span>
                <b>{activePlayer.health}</b> health
              </span>
              <span>
                <b>{activePlayer.infamy}</b> infamy
              </span>
              <span>
                <b>{activePlayer.move}</b> move
              </span>
            </div>
          </div>
          <BoardReferenceCard />
          <UnitCard
            game={activeGame}
            canAct={canAct}
            selectedUnitId={selectedUnitId}
            onSelect={(unitId) => {
              setSelectedUnitId(unitId);
              setSelectedPath([]);
              setSelectedUnitPath([]);
            }}
          />
          <RevealedCardsPanel
            game={activeGame}
            playerIndex={participant?.playerIndex ?? activeGame.currentPlayer}
            canAct={canAct}
            runCommand={runCommand}
          />
          <div className="card action-card">
            <TurnPrompt
              actionHeadingRef={actionHeadingRef}
              action={action}
              description={turnDescription}
              rulesHelp={rulesHelp}
              unavailableReason={unavailableReason}
              canAct={canAct}
              lastFightEventId={lastFightEvent?.id}
              lastFightRolls={lastFightRolls}
              lastFightOutcomes={lastFightOutcomes}
              hollywoodResearchAwarded={lastFightEvent?.detail.hollywoodResearchAwarded === true}
              lastRecoveryEventId={lastRecoveryEvent?.id}
              lastRecoveryRoll={typeof lastRecoveryEvent?.detail.recoveryRoll === "number" ? lastRecoveryEvent.detail.recoveryRoll : undefined}
              lastRecoveryReleased={lastRecoveryEvent?.detail.recoveryReleased === true}
            />
            <ActionResolutionFeedback label={acceptedActionFeedback?.label} animationKey={acceptedActionFeedback?.key} />
            <ChallengeDuelPanel
              eventId={lastChallengeEvent?.id}
              winnerName={typeof lastChallengeEvent?.detail.winnerName === "string" ? lastChallengeEvent.detail.winnerName : undefined}
              defeatedName={typeof lastChallengeEvent?.detail.defeatedName === "string" ? lastChallengeEvent.detail.defeatedName : undefined}
              winnerHealth={typeof lastChallengeEvent?.detail.winnerHealth === "number" ? lastChallengeEvent.detail.winnerHealth : undefined}
              loserWeighIn={typeof lastChallengeEvent?.detail.loserWeighIn === "number" ? lastChallengeEvent.detail.loserWeighIn : undefined}
              rolls={challengeRolls}
              attacks={challengeAttacks}
              victoryType={typeof lastChallengeEvent?.detail.victoryType === "string" ? lastChallengeEvent.detail.victoryType : undefined}
            />
            <EncounterResultPanel
              eventId={lastEncounterEvent?.id}
              effects={encounterEffects}
              rolls={encounterRolls}
              choices={encounterChoices}
              stomped={typeof lastEncounterEvent?.detail.stomped === "boolean" ? lastEncounterEvent.detail.stomped : undefined}
              remainingStompMarkers={typeof lastEncounterEvent?.detail.remainingStompMarkers === "number" ? lastEncounterEvent.detail.remainingStompMarkers : undefined}
              challenge={lastEncounterEvent?.detail.challenge && typeof lastEncounterEvent.detail.challenge === "object" ? lastEncounterEvent.detail.challenge as { declared: boolean; active: boolean; challengerMonsterId?: string; pendingStartPlayerIndex: number; startAtEndOfTurn?: boolean } : undefined}
              mutationDraws={encounterMutationDraws}
              nextPhase={typeof lastEncounterEvent?.detail.nextPhase === "string" ? lastEncounterEvent.detail.nextPhase : undefined}
            />
            <BlondeLureActions
              game={activeGame}
              canAct={canAct}
              runCommand={runCommand}
              getLocationName={(key) => getLocation(key)?.name ?? key}
            />
            {activeGame.phase === "move" &&
            selectedUnitId &&
            selectedUnitPath.length > 1 ? (
              <div className="path-controls">
                <button
                  disabled={!canAct}
                  onClick={() =>
                    void runCommand({
                      type: "move-unit",
                      unitId: selectedUnitId,
                      path: selectedUnitPath,
                    })
                  }
                >
                  Confirm unit path
                </button>
                <button
                  className="cancel"
                  disabled={pendingAction}
                  onClick={() => {
                    setSelectedUnitId(null);
                    setSelectedUnitPath([]);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : activeGame.phase === "move" && selectedPath.length > 1 ? (
              <div className="path-controls">
                <button
                  disabled={!canAct}
                  onClick={() =>
                    void runCommand({ type: "move", path: selectedPath })
                  }
                >
                  Confirm path
                </button>
                <button
                  className="cancel"
                  disabled={pendingAction}
                  onClick={() => setSelectedPath([])}
                >
                  Cancel
                </button>
              </div>
            ) : activeGame.phase === "move" ? (
              <div className="move-actions">
                {activeGame.setupAssignments?.[activeGame.currentPlayer]?.lair && activeGame.monsters[activeGame.currentPlayer]?.location !== "hollywood" && (
                  <button
                    disabled={!canAct}
                    onClick={() => runIrreversibleAction(() => void runCommand({ type: "disappear-monster" }), "Leave the monster in its lair and consume the Move step?")}
                  >
                    Disappear instead of moving
                  </button>
                )}
                <button
                  disabled={!canAct}
                  onClick={() => void runCommand({ type: "pass-move" })}
                >
                  Leave monster here & finish Move
                </button>
              </div>
            ) : activeGame.phase === "fight" || activeGame.phase === "encounter" || activeGame.phase === "deploy" ? (
              <PhaseActions
                activeGame={activeGame}
                canAct={canAct}
                runCommand={runCommand}
                getLocationName={(key) => getLocation(key)?.name ?? key}
                pendingAttackTarget={pendingAttackTarget}
                pendingAttackPrompt={pendingAttackPrompt}
                pendingBattle={pendingBattle}
                pendingBattleDecision={pendingBattleDecision}
                canSpendInfamyOnPendingBattle={canSpendInfamyOnPendingBattle}
                retreatChoices={retreatChoices}
                setRetreatChoices={setRetreatChoices}
                ownDeploymentAvailable={ownDeploymentAvailable}
                availableXFighterUnitId={availableXFighterUnitId}
                availableGuardUnitId={availableGuardUnitId}
                guardDeploymentDestination={guardDeploymentDestination}
                guardDeploymentAvailable={guardDeploymentAvailable}
              />
            ) : activeGame.phase === "challenge" ? (
              <ChallengeActions activeGame={activeGame} canAct={canAct} runCommand={runCommand} />
            ) : activeGame.phase === "game-over" ? (
              <TerminalSummary action={action} victoryType={activeGame.victoryType} online={online} onLeaveRoom={leaveRoomSafely} onResetLocal={resetLocal} onRematch={() => void startRematch()} />
            ) : (
              <button
                disabled={!canAct}
                onClick={() => void runCommand({ type: "advance" })}
              >
                Resolve {action.toLowerCase()}
              </button>
            )}
            {setupComplete && activeGame.phase !== "game-over" && (
              <button
                className="cancel"
                disabled={!canAct}
                onClick={() => runIrreversibleAction(() => void runCommand({ type: "concede" }), "Concede this match? The next player will be recorded as the winner.")}
              >
                Concede match
              </button>
            )}
          </div>
          <LogPanel eventLog={eventLog} log={log} />
        </aside>
      </section>
    </main>
  );
}

function AppShell() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => registerPwaServiceWorker(() => setUpdateAvailable(true)), []);
  return (
    <>
      <App />
      {updateAvailable && (
        <aside className="pwa-update-prompt" aria-live="polite" aria-label="Update available">
          <strong>New version available</strong>
          <span>Reload to use the latest playtest shell.</span>
          <button onClick={() => void activatePwaUpdate()}>Reload and update</button>
        </aside>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
