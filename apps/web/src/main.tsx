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
  createMvpRoomGame,
  applyCompletedSetup,
  setupDeploymentState,
  AUDITED_BOARD,
  FULL_HONEYCOMB_BOARD,
  PROVISIONAL_AUTHORITATIVE_BOARD,
  isHexKey,
  getLocation,
  legalMonsterPaths,
  legalUnitPaths,
  legalSubmarineTargets,
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupState,
} from "@abominations/game-engine";
import type { RoomView, SessionResponse } from "@abominations/shared";
import {
  createRoom,
  joinRoom,
  listPublicRooms,
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
import { BoardContextTray } from "./components/BoardContextTray";
import { SettingsPanel } from "./components/SettingsPanel";
import { SetupPanel } from "./components/SetupPanel";
import { TerminalSummary } from "./components/TerminalSummary";
import { TurnPrompt } from "./components/TurnPrompt";
import { TurnProgress } from "./components/TurnProgress";
import { setupLairLabel } from "./components/setup-location-label";
import { MilitarySheet, deploymentChoices, nextDeploymentSheet } from "./components/MilitarySheet";
import { MovementChecklist } from "./components/MovementChecklist";
import { UnitCard } from "./components/UnitCard";
import { HexGrid } from "./components/HexGrid";
import { BoardViewport } from "./components/BoardViewport";
import { HomeScreen } from "./components/HomeScreen";
import { BoardReview } from "./components/BoardReview";
import { EncounterResultPanel } from "./components/EncounterResultPanel";
import { CardReveal, ResolutionStage } from "./components/ResolutionStage";
import { EncounterOverlay } from "./components/EncounterOverlay";
import { ChallengeDuelPanel } from "./components/ChallengeDuelPanel";
import { FightResolutionPanel } from "./components/FightResolutionPanel";
import { ActionResolutionFeedback } from "./components/ActionResolutionFeedback";
import { playSound, type SoundCategory } from "./audio";
import { activatePwaUpdate, registerPwaServiceWorker } from "./pwa";
import "./styles.css";
import "./fullscreen-shell.css";
import "./board-terrain.css";
import "./physical-sheets.css";
import "./chat-ui.css";
import "./command-panels.css";
import "./encounter-command.css";
import "./monster-selection.css";
import "./setup-command.css";
import "./home-screen.css";

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
    case "stay-piece": return "Piece stays in place";
    case "disappear-monster": return "Monster disappearance resolved";
    case "use-monster-ability": return "Monster ability used";
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
  const [game, setGame] = useState<GameState>(() => createGame(2));
  const [localPlaytestStarted, setLocalPlaytestStarted] = useState(false);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase().slice(0, 6) ?? "";
  });
  const [publicRooms, setPublicRooms] = useState<import("@abominations/shared").PublicRoomSummary[]>([]);
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [roomPrivacy, setRoomPrivacy] = useState<"private" | "public">("private");
  const [localSetup, setLocalSetup] = useState<SetupState>(() =>
    createDevelopmentSetup(2),
  );
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const [selectedPath, setSelectedPath] = useState<HexKey[]>([]);
  const [hoveredPath, setHoveredPath] = useState<HexKey[]>([]);
  const [militaryInitialSheet, setMilitaryInitialSheet] = useState<string | undefined>();
  const [militarySheetOpen, setMilitarySheetOpen] = useState(false);
  const [setupPlacementPlayer, setSetupPlacementPlayer] = useState<number | null>(null);
  const [setupPlacements, setSetupPlacements] = useState<{ unitId: string; destination: HexKey }[]>([]);
  const [setupDeploying, setSetupDeploying] = useState(false);
  const [setupSheetOpen, setSetupSheetOpen] = useState(false);
  const [setupPieceId, setSetupPieceId] = useState<string | null>(null);
  const [deploymentPieceId, setDeploymentPieceId] = useState<string | null>(null);
  const autoFinishDeploymentRequested = useRef(false);
  const [submarineTargetingId, setSubmarineTargetingId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedUnitPath, setSelectedUnitPath] = useState<HexKey[]>([]);
  const [acceptedMoveAnimation, setAcceptedMoveAnimation] = useState<{ path: HexKey[]; pieceId: string; key: number } | null>(null);
  const [acceptedActionFeedback, setAcceptedActionFeedback] = useState<{ label: string; key: number } | null>(null);
  const [selectedStackKey, setSelectedStackKey] = useState<HexKey | null>(null);
  const [focusedHexKey, setFocusedHexKey] = useState<HexKey | null>(null);
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const [onboardingOpen, setOnboardingOpen] = useState(() => safeStorageGet("abominations-onboarding-seen") !== "1");
  const [homeRulesOpen, setHomeRulesOpen] = useState(false);
  const [boardReviewOpen, setBoardReviewOpen] = useState(false);
  const [challengeDuelOpen, setChallengeDuelOpen] = useState(false);
  const [researchReveal, setResearchReveal] = useState<string | null>(null);
  const [fightBaselineEventId, setFightBaselineEventId] = useState<string>();
  const [fightOverlayOpen, setFightOverlayOpen] = useState(false);
  const [encounterOverlayOpen, setEncounterOverlayOpen] = useState(false);
  const [encounterBaselineEventId, setEncounterBaselineEventId] = useState<string | undefined>();
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
  const focusedBoardHex = focusedHexKey && activeBoard?.hexes[focusedHexKey] ? activeBoard.hexes[focusedHexKey] : activeBoardHex;
  const activeBranch = activeGame.setupAssignments?.[activeGame.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as const)[activeGame.currentPlayer % 4];
  const legalPaths = useMemo(
    () => legalMonsterPaths(activeGame, activePlayer.id),
    [activeGame, activePlayer.id],
  );
  const legalDestinations = useMemo(
    () => new Set(legalPaths.map((path) => path.at(-1)!)),
    [legalPaths],
  );
  useEffect(() => {
    if (!selectedUnitId) return;
    setGamePanelOpen(false);
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(".piece-detail-tray")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selectedUnitId]);
  const legalUnitPathsForSelection = useMemo(
    () => (selectedUnitId ? legalUnitPaths(activeGame, selectedUnitId) : []),
    [activeGame, selectedUnitId],
  );
  const selectableUnitIds = useMemo(
    () => activeGame.phase === "move"
      ? new Set(activeGame.units.filter((unit) => legalUnitPaths(activeGame, unit.id).length > 0 || legalSubmarineTargets(activeGame, unit.id).length > 0).map((unit) => unit.id))
      : activeGame.pendingDecision?.type === "trophy-choice" ? new Set(activeGame.pendingDecision.unitIds) : new Set<string>(),
    [activeGame],
  );
  useEffect(() => {
    if (activeGame.phase !== "move" || pendingAction) return;
    if (selectedUnitId ? selectableUnitIds.has(selectedUnitId) : legalPaths.length > 0) return;
    setSelectedUnitId(legalPaths.length > 0 ? null : [...selectableUnitIds][0] ?? null);
    setSelectedUnitPath([]);
    setSelectedPath([]);
    setHoveredPath([]);
  }, [activeGame.phase, pendingAction, selectedUnitId, selectableUnitIds, legalPaths]);
  useEffect(() => {
    if (activeGame.phase === "deploy" && selectedUnitId) {
      setSelectedUnitId(null);
      setSelectedUnitPath([]);
      setSelectedPath([]);
    }
  }, [activeGame.phase, selectedUnitId]);
  const legalUnitDestinations = useMemo(
    () => new Set(legalUnitPathsForSelection.map((path) => path.at(-1)!)),
    [legalUnitPathsForSelection],
  );
  const submarineTargets = useMemo(() => selectedUnitId ? legalSubmarineTargets(activeGame, selectedUnitId) : [], [activeGame, selectedUnitId]);
  const choosingSubmarineTarget = submarineTargetingId !== null && submarineTargetingId === selectedUnitId && submarineTargets.length > 0;
  const submarineTargetLocations = new Map<HexKey, string>(submarineTargets.filter((monster) => isHexKey(monster.location)).map((monster) => [monster.location as HexKey, `Launch missile at ${monster.name}`]));
  useEffect(() => { setSubmarineTargetingId(null); }, [activeGame, selectedUnitId]);
  const militaryChoices = useMemo(() => deploymentChoices(activeGame), [activeGame]);
  const deploymentPiece = militaryChoices.find((choice) => choice.id === deploymentPieceId);
  const deploymentDestinations = new Set(deploymentPiece?.destinations ?? []);
  const openMilitarySheet = (sheet?: string) => {
    const requestedSheet = typeof sheet === "string" ? sheet : undefined;
    setMilitaryInitialSheet(requestedSheet ?? nextDeploymentSheet(militaryChoices, activeBranch));
    setMilitarySheetOpen(true);
  };
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
  const lastBattleEvent = [...activeGame.eventLog].reverse().find(entry =>
    (entry.action === "fight.resolved" || entry.action === "battle.target-required") && Array.isArray(entry.detail.attacks));
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
  const encounterRevealCard = activeGame.players[activeGame.currentPlayer]?.mutationCardIds.at(-1);
  const lastChallengeEvent = [...activeGame.eventLog].reverse().find((entry) => entry.action === "challenge.resolved");
  useEffect(() => {
    if (lastChallengeEvent?.id) setChallengeDuelOpen(true);
  }, [lastChallengeEvent?.id]);
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
      (room?.status === "active" && participant?.role === "player" &&
        participant.playerIndex === decisionPlayer));
  const unavailableReason = pendingAction
    ? "Waiting for the server."
    : !setupComplete
      ? "Complete setup before taking a gameplay action."
      : online && room?.status === "waiting"
        ? "Waiting for all players to press Ready."
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
        : !legalPaths.length && !selectableUnitIds.size
          ? { label: "Continue to Fight", command: { type: "pass-move" } as GameCommand }
        : selectedUnitId
          ? { label: "Move this unit", command: undefined }
          : { label: "Choose a piece to move", command: undefined }
    : activeGame.phase === "fight"
      ? pendingBattle && !pendingAttackTarget && !activeGame.pendingDecision?.type?.includes("retreat") && !canSpendInfamyOnPendingBattle && activeGame.pendingBattles.length === 1
        ? { label: "Resolve fight", command: { type: "resolve-fight", battleId: pendingBattle.id } as GameCommand }
        : { label: pendingAttackTarget ? "Choose attack target" : "Continue to Fight", command: undefined }
      : activeGame.phase === "encounter"
        ? activeGame.pendingDecision && activeGame.pendingDecision.type !== "encounter-resolution"
          ? { label: "Choose encounter option", command: undefined }
          : { label: "Resolve encounter", command: { type: "resolve-encounter" } as GameCommand }
        : activeGame.phase === "deploy"
          ? militaryChoices.length
            ? { label: deploymentPiece ? "Change deployment piece" : "Deploy military", command: undefined }
            : { label: "Deployment complete", command: undefined }
          : activeGame.phase === "challenge"
            ? { label: "Resolve Monster Challenge", command: undefined }
            : { label: "Match complete", command: undefined };

  useEffect(() => {
    actionHeadingRef.current?.focus({ preventScroll: true });
  }, [activeGame.phase, activeGame.round, room?.version, localPlaytestStarted]);
  useEffect(() => {
    if (!settingsOpen && !onboardingOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const selector = settingsOpen ? ".settings-panel" : ".onboarding";
    document.querySelector<HTMLElement>(`${selector} button, ${selector} input`)?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSettingsOpen(false); setOnboardingOpen(false); }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); previous?.focus({ preventScroll: true }); };
  }, [settingsOpen, onboardingOpen]);
  useEffect(() => {
    // Start with the map unobstructed; decisions remain in the bottom dock.
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
  const canSetup = Boolean(setupSeat && (!online || participant?.playerIndex === setupSeat.playerIndex));
  const setupPreview = useMemo(() => activeSetup?.phase === "starting-choice" && setupSeat
    ? setupDeploymentState(activeGame, setupSeat.playerIndex, setupPlacementPlayer === setupSeat.playerIndex ? setupPlacements : []) : undefined,
    [activeGame, activeSetup?.phase, setupSeat, setupPlacements, setupPlacementPlayer]);
  const setupChoices = useMemo(() => setupPreview ? deploymentChoices(setupPreview).filter((choice) => choice.kind === "deploy") : [], [setupPreview]);
  const retreatingMonsterId = activeGame.pendingRetreat?.monsterId;
  const retreatDestinations = useMemo(() => {
    if (!activeGame.pendingRetreat || !retreatingMonsterId) return new Set<HexKey>();
    return new Set(activeGame.pendingRetreat.options[retreatingMonsterId] ?? []);
  }, [activeGame.pendingRetreat, retreatingMonsterId]);
  const setupPiece = setupChoices.find((choice) => choice.id === setupPieceId);
  const setupLocations = new Map<HexKey, string>();
  if (canSetup && activeSetup?.phase === "lair-selection" && setupSeat?.monsterId) {
    for (const lair of activeSetup.definition.lairsByMonster[setupSeat.monsterId] ?? []) {
      if (isHexKey(lair) && !activeSetup.seats.some((seat) => seat.lair === lair)) setupLocations.set(lair, setupLairLabel(activeSetup, activeBoard, setupSeat.monsterId, lair));
    }
  } else if (canSetup && setupPiece) {
    for (const destination of setupPiece.destinations) setupLocations.set(destination, activeBoard?.hexes[destination]?.label ?? (setupPiece.sheet + " deployment site"));
  }
  useEffect(() => {
    setSetupPlacements([]); setSetupDeploying(false); setSetupSheetOpen(false); setSetupPieceId(null);
  }, [setupSeat?.playerIndex, activeSetup?.phase]);
  useEffect(() => {
    setSelectedPath([]);
    setHoveredPath([]);
    setSelectedUnitId(null);
    setSelectedUnitPath([]);
    setRetreatChoices({});
    setDeploymentPieceId(null);
    setMilitarySheetOpen(false);
  }, [activeGame.currentPlayer, activeGame.phase, activePlayer.location]);

  useEffect(() => {
    if (activeGame.pendingRetreat?.monsterId) setFightOverlayOpen(false);
  }, [activeGame.pendingRetreat?.monsterId]);

  useEffect(() => {
    if (!acceptedMoveAnimation) return;
    const timeout = window.setTimeout(() => setAcceptedMoveAnimation(null), (acceptedMoveAnimation.path.length - 1) * 400 + 250);
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

  const focusNextMovementUnit = (nextGame: GameState) => {
    if (nextGame.phase !== "move") return;
    const monster = nextGame.monsters[nextGame.currentPlayer];
    if (!monster || !nextGame.movedPieceIds.includes(monster.id)) return;
    const nextUnit = nextGame.units.find((unit) =>
      legalUnitPaths(nextGame, unit.id).length > 0 || legalSubmarineTargets(nextGame, unit.id).length > 0,
    );
    if (!nextUnit) return;
    setSelectedUnitId(nextUnit.id);
    setSelectedPath([]);
    setSelectedUnitPath([]);
    setHoveredPath([]);
    if (isHexKey(nextUnit.location)) setFocusedHexKey(nextUnit.location);
  };

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
        : command.type === "move" ? { ...command, continueMovement: true } : command;
    const acceptedMove = normalized.type === "move"
      ? { path: normalized.path as HexKey[], pieceId: activePlayer.id }
      : normalized.type === "move-unit"
        ? { path: normalized.path as HexKey[], pieceId: normalized.unitId }
        : undefined;
    try {
      let nextGame: GameState;
      if (online && session && room) {
        const nextRoom = await sendCommand(
          room.code,
          session.token,
          session.participantId,
          room.version,
          normalized,
        );
        setRoom(nextRoom);
        nextGame = nextRoom.state;
        if (normalized.type === "draw-research") {
          const event = nextRoom.state.eventLog.at(-1);
          if (typeof event?.detail.cardId === "string") setResearchReveal(event.detail.cardId);
        }
        if (acceptedMove) setAcceptedMoveAnimation({ ...acceptedMove, key: Date.now() });
        const actionLabel = acceptedActionLabel(normalized);
        if (actionLabel) setAcceptedActionFeedback({ label: actionLabel, key: Date.now() });
      } else {
        const result = applyCommand(game, normalized);
        setGame(result.state);
        nextGame = result.state;
        if (normalized.type === "draw-research" && typeof result.eventPayload.cardId === "string") setResearchReveal(result.eventPayload.cardId);
        if (acceptedMove) setAcceptedMoveAnimation({ ...acceptedMove, key: Date.now() });
        const actionLabel = acceptedActionLabel(normalized);
        if (actionLabel) setAcceptedActionFeedback({ label: actionLabel, key: Date.now() });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (normalized.type === "deploy" || normalized.type === "redeploy") {
        setDeploymentPieceId(null);
        const remaining = deploymentChoices(nextGame);
        if (nextGame.phase === "deploy" && nextGame.currentPlayer === activeGame.currentPlayer && remaining.length) {
          setMilitaryInitialSheet(nextDeploymentSheet(remaining, activeBranch));
          setMilitarySheetOpen(true);
        }
      }
      if (acceptedMove || normalized.type === "stay-piece") { setSelectedPath([]); setSelectedUnitPath([]); setHoveredPath([]); setSelectedUnitId(null); }
      if (normalized.type === "move" || (normalized.type === "stay-piece" && normalized.pieceId === activePlayer.id)) {
        focusNextMovementUnit(nextGame);
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

  useEffect(() => {
    if (activeGame.phase !== "deploy" || militaryChoices.length > 0) {
      autoFinishDeploymentRequested.current = false;
      return;
    }
    if (!canAct || pendingAction || autoFinishDeploymentRequested.current) return;
    autoFinishDeploymentRequested.current = true;
    void runCommand({ type: "pass-deploy" });
  }, [activeGame.phase, canAct, militaryChoices.length, pendingAction]);

  const runBoardAction = (command: GameCommand) => {
    if (command.type === "resolve-fight") { setFightBaselineEventId(lastBattleEvent?.id); setFightOverlayOpen(true); return; }
    if (command.type === "resolve-encounter" && !command.choice && !command.trophyUnitId) {
      setEncounterBaselineEventId(lastEncounterEvent?.id);
      setEncounterOverlayOpen(true);
      return;
    }
    void runCommand(command);
  };

  const startSession = async (kind: "create" | "join" | "spectate") => {
    setError("");
    setLocalPlaytestStarted(false);
    setOnboardingOpen(false);
    setGamePanelOpen(true);
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
  const refreshPublicRooms = async () => {
    setError("");
    try {
      setPublicRooms(await listPublicRooms());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load public rooms");
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
    setGame((current) => { const updated = { ...current, setupState: next }; return next.phase === "complete" ? applyCompletedSetup(updated) : updated; });
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
    const startingChoice = kind === "research" ? { kind } as const : { kind, placements: setupPlacements } as const;
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
    const next = createMvpRoomGame(value);
    setLocalSetup(next.setupState!);
    setGame(next);
  };
  const resetLocal = () => {
    setLocalPlaytestStarted(true);
    setOnboardingOpen(false);
    // Start with turn instructions expanded.
    setGamePanelOpen(true);
    setSession(null);
    setRoom(null);
    setError("");
    const next = createMvpRoomGame(playerCount);
    setLocalSetup(next.setupState!);
    setGame(next);
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
  const startProvisionalPlaytest = resetLocal;
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
        : activeGame.movedPieceIds.includes(activePlayer.id) ? (selectableUnitIds.size ? "Monster movement complete. Move your remaining units or end movement." : "Movement complete. End movement to continue.") : `Move ${activePlayer.name} up to ${activePlayer.move} spaces, or select a military unit below.`
    : activeGame.phase === "fight"
      ? activeGame.pendingDecision?.type === "attack-target"
        ? pendingAttackPrompt
        : activeGame.pendingDecision?.type === "retreat"
          ? activeGame.pendingRetreat?.monsterId
            ? "The monster must retreat. Select a glowing adjacent hex on the board."
            : "Choose a legal retreat destination."
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
        ? { title: "Choose an attack target", body: "Select a highlighted military unit." }
        : activeGame.pendingDecision?.type === "retreat"
          ? { title: "Resolve retreat", body: activeGame.pendingRetreat?.monsterId ? "Select a glowing adjacent hex for the monster." : "Choose a legal destination for each surviving unit." }
          : { title: "Resolve the Fight", body: "Choose a battle if more than one is pending." }
      : activeGame.phase === "encounter"
        ? { title: "Resolve Encounter", body: "Choose from the options shown." }
        : activeGame.phase === "challenge"
          ? activeGame.pendingDecision?.type === "challenge-opponent"
            ? { title: "Choose the next challenger", body: "Select an eligible monster." }
            : activeGame.pendingDecision?.type === "challenge-giant"
              ? { title: "Choose the next giant", body: "Select the next surviving giant unit." }
              : activeGame.pendingDecision?.type === "challenge-giant-resolution"
                ? { title: "Resolve giant Challenge", body: "The monster attacks first. A giant victory saves America." }
                : { title: "Resolve Monster Challenge", body: "The challenger attacks first." }
          : activeGame.phase === "game-over"
            ? { title: "Match complete", body: "No more actions are available." }
            : { title: "Deploy", body: "Deploy, draw Research, or pass." };
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
    if ((selectedUnitId ? selectedUnitPath : selectedPath).length > 1) return;
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
        <p className="lede">Use a current Chrome, Edge, Firefox, or Safari browser, then reload. No match state has been started.</p>
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
        publicRooms={publicRooms}
        setupComplete={false}
        error={error}
        onDisplayNameChange={setDisplayName}
        onPlayerCountChange={changePlayerCount}
        onRoomPrivacyChange={setRoomPrivacy}
        onRoomCodeChange={setRoomCode}
        onRefreshPublicRooms={() => void refreshPublicRooms()}
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
  const fullBoardVerified = (renderedBoard?.id === AUDITED_BOARD.id || renderedBoard?.id === FULL_HONEYCOMB_BOARD.id)
    && Object.values(renderedBoard.hexes).every((hex) => hex.verification === "verified");
  const boardDescription = fullBoardVerified
    ? "The complete 336-cell human-audited North America board is active. Movement follows its printed features and water barriers."
    : renderedBoard?.id === FULL_HONEYCOMB_BOARD.id
      ? "The full honeycomb coordinate shell is unresolved review tooling and is not a playable board. Physical cell data is still being transcribed."
      : renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id
        ? "The provisional honeycomb board is a playtest guess. Its labels, terrain, barriers, and features are not verified."
      : renderedBoard
      ? "This match uses the nine-space development board. Physical-board data is still being transcribed."
      : "This match references an unavailable board version, so board interaction is disabled until the matching definition is loaded.";

  return (
    <main
      className={`game-screen ${!setupComplete ? "setup-in-progress" : ""} ${online ? "online-game" : "local-game"} ${gamePanelOpen ? "game-panel-open" : "game-panel-closed"} ${largeText ? "large-text" : ""} ${!showBoardLabels ? "board-labels-hidden" : ""} ${manualReducedMotion ? "manual-reduced-motion" : ""}`}
      data-board-id={renderedBoard?.id ?? ""}
      data-board-version={renderedBoard?.version ?? ""}
      data-board-content-hash={renderedBoard?.contentHash ?? ""}
      data-rendered-board-id={renderedBoard?.id ?? ""}
      data-rendered-board-content-hash={renderedBoard?.contentHash ?? ""}
    >
      <header>
        <div className="top-turn-summary">
          <div className="turn-hud-heading">
            <div><span className="label">{!setupComplete ? "GAME SETUP" : canAct ? "YOUR TURN" : "CURRENT TURN"} · PLAYER {decisionPlayer + 1}</span><h2 ref={actionHeadingRef} tabIndex={-1}>{setupComplete ? `${activePlayer.name} · ${action}` : "Monster and branch selection"}</h2></div>
            <button type="button" className="ghost" onClick={() => setGamePanelOpen((open) => !open)} aria-expanded={gamePanelOpen} aria-controls="turn-hud-body" aria-label={gamePanelOpen ? "Minimize turn panel" : "Expand turn panel"}>{gamePanelOpen ? "−" : "+"}</button>
          </div>
          <TurnProgress game={activeGame} />
        </div>
        <div className="header-actions">
          {setupComplete && <MatchStatus game={activeGame} action={action} />}
          {setupComplete && <PlayerStatusControls game={activeGame} playerIndex={participant?.playerIndex ?? activeGame.currentPlayer} monster={activeGame.monsters[participant?.playerIndex ?? activeGame.currentPlayer]} branch={activeGame.setupAssignments?.[participant?.playerIndex ?? activeGame.currentPlayer]?.branch ?? (["Army", "Navy", "Air Force", "Marines"] as const)[(participant?.playerIndex ?? activeGame.currentPlayer) % 4]} canAct={canAct} runCommand={runCommand} onDeploy={openMilitarySheet} onSelectDeployment={(choice) => { setDeploymentPieceId(choice.id); setFocusedHexKey(choice.destinations[0]); }} />}
          <button className="ghost how-to-play-action" onClick={() => { setSettingsOpen(false); setOnboardingOpen(true); }}>
            How to play
          </button>
          <button className="ghost settings-action" onClick={() => { setOnboardingOpen(false); setSettingsOpen((open) => !open); }} aria-expanded={settingsOpen}>
            Settings
          </button>
          <button className="ghost new-game-action" onClick={resetLocal}>
            New local game
          </button>
          {online && <span className="room-hud-status" role="status">{room?.code} · {connectionState}</span>}
          {online && participant?.role === "player" && room?.status === "waiting" && <button className="ghost" disabled={!setupComplete || pendingAction} onClick={() => void toggleReady()}>{participant.ready ? "Not ready" : "Ready"}</button>}
          {online && <button className="ghost leave-room-action" onClick={leaveRoomSafely}>Leave room</button>}
        </div>
      </header>
      {error && <p className="error global-game-error" role="alert">{error}</p>}
      <LobbyPanel
        online={online}
        room={room}
        participant={participant}
        connectionState={connectionState}
        displayName={displayName}
        playerCount={playerCount}
        roomPrivacy={roomPrivacy}
        roomCode={roomCode}
        publicRooms={publicRooms}
        setupComplete={setupComplete}
        error={error}
        onDisplayNameChange={setDisplayName}
        onPlayerCountChange={changePlayerCount}
        onRoomPrivacyChange={setRoomPrivacy}
        onRoomCodeChange={setRoomCode}
        onRefreshPublicRooms={() => void refreshPublicRooms()}
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
            <p>Choose a monster, then move, fight, take an Encounter, and Deploy.</p>
            <div className="onboarding-grid">
              <div><strong>Move</strong><span>Choose a path or stay put.</span></div>
              <div><strong>Fight</strong><span>Resolve battles and choose targets.</span></div>
              <div><strong>Encounter</strong><span>Take the site reward.</span></div>
              <div><strong>Deploy</strong><span>Place a unit or draw Research.</span></div>
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
          board={renderedBoard}
          setupSeat={setupSeat}
          online={online}
          playerIndex={participant?.playerIndex}
          participants={room?.participants ?? []}
          onChooseOption={(value) => void chooseSetupOption(value)}
          deploymentCount={setupPlacements.length}
          hasAvailableDeploymentOptions={setupChoices.length > 0}
          selectingDeployment={setupDeploying}
          selectedPiece={setupPiece?.typeId}
          onFinishDeployment={() => void chooseSetupStartingChoice("deploy")}
          onUndoDeployment={() => { setSetupPlacements((current) => current.slice(0, -1)); setSetupPieceId(null); }}
          onChooseStartingChoice={(kind) => { if (kind === "deploy") { setSetupPlacementPlayer(setupSeat?.playerIndex ?? null); setSetupDeploying(true); setSetupSheetOpen(true); } else void chooseSetupStartingChoice(kind); }}
        />
      )}
      <section className="development-notice" aria-label="Development ruleset notice">
        <span className="label">{renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id ? "PROVISIONAL HONEYCOMB PLAYTEST · NOT VERIFIED" : "DEVELOPMENT RULESET · PROTOTYPE 0.1"}</span>
        <p>
          {renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id
            ? "This playtest uses a provisional 336-cell honeycomb board. Its labels, terrain, barriers, and features are not verified."
            : "This playtest uses a nine-space development board. The unresolved physical-board shell is not rendered as playable topology. The physical board, full combat, card effects, National Guard rules, and Monster Challenge are still under review."}
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
          <BoardViewport board={renderedBoard} boardId={activeGame.boardId} boardContentHash={activeGame.boardContentHash} focusHexKey={setupComplete ? (selectedUnitId ? activeGame.units.find((unit) => unit.id === selectedUnitId)?.location : activePlayer.location) : null} overviewImage={renderedBoard?.id === AUDITED_BOARD.id ? "/assets/board/audited/overview.webp" : undefined}>
            <HexGrid
              game={setupPreview ?? activeGame}
              setupLocations={choosingSubmarineTarget && canAct ? submarineTargetLocations : setupLocations}
              onSetupLocation={(destination) => {
                if (choosingSubmarineTarget && canAct && selectedUnitId) {
                  const target = submarineTargets.find((monster) => monster.location === destination);
                  if (target) void runCommand({ type: "launch-submarine-at-monster", unitId: selectedUnitId, monsterId: target.id });
                  return;
                }
                if (activeSetup?.phase === "lair-selection") void chooseSetupOption(destination);
                else if (setupPiece && canSetup && setupSeat) {
                  const placements = [...setupPlacements, { unitId: setupPiece.id, destination }];
                  setSetupPlacements(placements);
                  setSetupPieceId(null);
                  const nextPreview = setupDeploymentState(activeGame, setupSeat.playerIndex, placements);
                  setSetupSheetOpen(deploymentChoices(nextPreview).some((choice) => choice.kind === "deploy"));
                }
              }}
              activePlayerId={activePlayer.id}
              canAct={canAct}
              legalDestinations={selectedUnitId ? new Set() : legalDestinations}
              deploymentDestinations={deploymentDestinations}
              retreatDestinations={retreatDestinations}
              onRetreat={(destination) => {
                const monsterId = activeGame.pendingRetreat?.monsterId;
                if (canAct && monsterId) void runCommand({ type: "retreat", destinations: { [monsterId]: destination } });
              }}
              onDeploy={(destination) => { if (canAct && deploymentPiece) void runCommand({ type: deploymentPiece.kind, unitId: deploymentPiece.id, destination }); }}
              onSelectMonster={() => { setSelectedUnitId(null); setSelectedUnitPath([]); setHoveredPath([]); }}
              legalUnitDestinations={choosingSubmarineTarget ? new Set() : legalUnitDestinations}
              selectableUnitIds={selectableUnitIds}
              selectedUnitId={selectedUnitId}
              selectedPath={selectedPath}
              hoveredPath={hoveredPath}
              selectedUnitPath={selectedUnitPath}
              focusedHexKey={focusedHexKey}
              acceptedPath={acceptedMoveAnimation?.path ?? []}
              acceptedPieceId={acceptedMoveAnimation?.pieceId}
              acceptedAnimationKey={acceptedMoveAnimation?.key}
              onFocusHex={setFocusedHexKey}
              onSelectStack={setSelectedStackKey}
              onSelectUnit={(unitId) => {
                if (activeGame.pendingDecision?.type === "trophy-choice" && activeGame.pendingDecision.unitIds.includes(unitId)) {
                  void runCommand({ type: "resolve-encounter", trophyUnitId: unitId });
                  return;
                }
                setHoveredPath([]);
                setGamePanelOpen(false);
                setSelectedUnitId(unitId);
                setSelectedPath([]);
                setSelectedUnitPath([]);
                const location = activeGame.units.find((unit) => unit.id === unitId)?.location;
                if (location && isHexKey(location)) setFocusedHexKey(location);
              }}
              onChoosePath={choosePath}
              onChooseUnitPath={chooseUnitPath}
              onPreviewPath={previewPath}
              onClearPreview={() => setHoveredPath((current) => current.length ? [] : current)}
            />
          </BoardViewport>
          {choosingSubmarineTarget && <div className="deployment-prompt" role="status">Choose a glowing monster to launch the cruise missile. <button onClick={() => setSubmarineTargetingId(null)}>Cancel</button></div>}
          {activeGame.phase === "deploy" && deploymentPiece && <div className="deployment-prompt" role="status">
            Place {deploymentPiece.typeId.replaceAll("-", " ")} · Select a glowing location.
            <button onClick={() => setDeploymentPieceId(null)}>Cancel placement</button>
          </div>}
          {activeGame.phase === "fight" && activeGame.pendingRetreat?.monsterId && <div className="deployment-prompt retreat-prompt" role="status">
            {activeGame.monsters.find((monster) => monster.id === activeGame.pendingRetreat?.monsterId)?.name ?? "Monster"} retreats · Select a glowing adjacent hex.
          </div>}

          <p className="sr-only" id="board-description">
            {boardDescription}
          </p>
          <div className="board-secondary">
            <p className="map-note">Map art is decorative. Movement and features come from the game board.</p>
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
            <PieceStackInspector
              game={activeGame}
              activeMonsterId={activePlayer.id}
              selectedStackKey={selectedStackKey}
              onSelect={setSelectedStackKey}
              onClear={() => setSelectedStackKey(null)}
            />
          </div>
        </div>
        {setupComplete && <>
          <div className={`command-station ${activeGame.phase === "deploy" ? "deploy-command-station" : ""}`}>
          <div className="board-action-bar">
            {activeGame.phase === "deploy" ? null : activeGame.phase === "move" ? <ActionDock
              label={actionDock.command?.type === "move" || actionDock.command?.type === "move-unit" ? "Confirm move" : (selectedUnitId ? selectableUnitIds.has(selectedUnitId) : legalPaths.length > 0) ? "Hold position" : "End movement"}
              contextLabel={`Move · ${selectableUnitIds.size + (legalPaths.length > 0 ? 1 : 0)} remaining`}
              guidance={actionDock.command?.type === "move" || actionDock.command?.type === "move-unit" ? "Route ready" : (selectedUnitId ? selectableUnitIds.has(selectedUnitId) : legalPaths.length > 0) ? "Choose a destination or hold." : "Ready for the next phase."}
              command={actionDock.command ?? ((selectedUnitId ? selectableUnitIds.has(selectedUnitId) : legalPaths.length > 0) ? { type: "stay-piece", pieceId: selectedUnitId ?? activePlayer.id } : { type: "pass-move" })}
              canAct={canAct} unavailableReason={unavailableReason} onAction={runBoardAction}
            /> : <ActionDock contextLabel={activeGame.phase} guidance={actionDock.command ? "Ready to continue." : "Choose an option in the attached tab."}
              onPrimary={!actionDock.command ? () => { if (activeGame.phase === "fight") { setFightBaselineEventId(lastBattleEvent?.id); setFightOverlayOpen(true); return; } const context = document.querySelector<HTMLDetailsElement>("#phase-command-context"); if (context) { context.open = true; context.querySelector<HTMLElement>("button:not(:disabled)")?.focus(); } } : undefined}
              label={actionDock.label} canAct={canAct} command={actionDock.command} unavailableReason={unavailableReason} onAction={runBoardAction} />}
          </div>
          <div className="bottom-context-dock">
          {activeGame.phase === "deploy" ? <div className="context-tab-body deploy-options-body">
            <PhaseActions
              activeGame={activeGame}
              onOpenMilitarySheet={openMilitarySheet}
              canAct={canAct}
              runCommand={runBoardAction}
              getLocationName={(key) => getLocation(key)?.name ?? key}
              pendingAttackTarget={pendingAttackTarget}
              pendingAttackPrompt={pendingAttackPrompt}
              pendingBattle={pendingBattle}
              pendingBattleDecision={pendingBattleDecision}
              canSpendInfamyOnPendingBattle={canSpendInfamyOnPendingBattle}
              retreatChoices={retreatChoices}
              setRetreatChoices={setRetreatChoices}
            />
          </div> : activeGame.phase === "move" ? <details className="piece-context-tab" key={selectedUnitId ?? activePlayer.id}>
            <summary><span>{selectedUnitId ? (activeGame.units.find(unit => unit.id === selectedUnitId)?.unitTypeId ?? "Unit").replaceAll("-", " ") : activePlayer.name}</span><small>Details & options <span aria-hidden="true">⌃</span></small></summary>
            <div className="context-tab-body">
          <SelectedPieceTray
            game={activeGame}
            selectedUnitId={selectedUnitId}
            selectedUnitPath={selectedUnitPath}
            canLaunchSubmarine={canAct && submarineTargets.length > 0}
            choosingSubmarineTarget={choosingSubmarineTarget}
            onLaunchSubmarine={() => { setSubmarineTargetingId(selectedUnitId); setSelectedUnitPath([]); setHoveredPath([]); setSelectedPath([]); }}
            onClear={() => {
              setSelectedUnitId(null);
              setSelectedUnitPath([]);
              setHoveredPath([]);
            }}
          />
              <div className="piece-context-options">
                {(selectedUnitId ? selectedUnitPath.length > 1 : selectedPath.length > 1) && <button disabled={pendingAction} onClick={() => { setSelectedPath([]); setSelectedUnitPath([]); setHoveredPath([]); }}>Cancel route</button>}
                {!selectedUnitId && !activeGame.movedPieceIds.includes(activePlayer.id) && activeGame.setupAssignments?.[activeGame.currentPlayer]?.lair && activePlayer.location !== "hollywood" && <button disabled={!canAct} onClick={() => runIrreversibleAction(() => void runCommand({ type: "disappear-monster" }), "Leave the monster in its lair and consume the Move step?")}>Disappear to lair</button>}
                <button disabled={!canAct} onClick={() => void runCommand({ type: "pass-move" })}>End all movement →</button>
              </div>
            </div>
          </details> : <details id="phase-command-context" className="piece-context-tab" key={activeGame.phase}>
            <summary><span>{activeGame.phase} options</span><small>Open <span aria-hidden="true">⌃</span></small></summary>
            <div className="context-tab-body">
            {activeGame.phase === "fight" || activeGame.phase === "encounter" ? (
              <PhaseActions
                activeGame={activeGame}
                onOpenMilitarySheet={openMilitarySheet}
                canAct={canAct}
                runCommand={runBoardAction}
                getLocationName={(key) => getLocation(key)?.name ?? key}
                pendingAttackTarget={pendingAttackTarget}
                pendingAttackPrompt={pendingAttackPrompt}
                pendingBattle={pendingBattle}
                pendingBattleDecision={pendingBattleDecision}
                canSpendInfamyOnPendingBattle={canSpendInfamyOnPendingBattle}
                retreatChoices={retreatChoices}
                setRetreatChoices={setRetreatChoices}
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
            </div>
          </details>}
          </div>
          </div>
        </>}
        <aside id="game-side-panel" className="game-side-panel" aria-label="Game controls and information">
          <div id="turn-hud-body" hidden={!gamePanelOpen}>
          <div className="card action-card">
            <TurnPrompt
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
            <BlondeLureActions
              game={activeGame}
              canAct={canAct}
              runCommand={runCommand}
              getLocationName={(key) => getLocation(key)?.name ?? key}
            />
            {activeGame.phase === "move" && <MovementChecklist game={activeGame} canAct={canAct}
              selectedUnitId={selectedUnitId} movableUnitIds={selectableUnitIds} monsterCanMove={legalPaths.length > 0}
              onSelect={(unitId) => {
                setGamePanelOpen(false); setSelectedUnitId(unitId); setSelectedPath([]); setSelectedUnitPath([]); setHoveredPath([]);
                const location = unitId ? activeGame.units.find((unit) => unit.id === unitId)?.location : activePlayer.location;
                if (location && isHexKey(location)) setFocusedHexKey(location);
              }}
              onEnd={() => void runCommand({ type: "pass-move" })}
            />}
            <details className="hud-section"><summary>Match options</summary>
            {setupComplete && activeGame.phase !== "game-over" && (
              <button
                className="cancel"
                disabled={!canAct}
                onClick={() => runIrreversibleAction(() => void runCommand({ type: "concede" }), "Concede this match? The next player will be recorded as the winner.")}
              >
                Concede match
              </button>
            )}
            </details>
          </div>
          <details className="hud-section"><summary>Selected board space</summary>
          <BoardContextTray game={activeGame} board={activeBoard} hex={focusedBoardHex} />
          </details>
          <details className="hud-section"><summary>Pieces, cards & board reference</summary>
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
          </details>
          <details className="hud-section"><summary>Recent results & turn history</summary>
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
          <LogPanel eventLog={eventLog} log={log} />
          </details>
          </div>
        </aside>
      </section>
      {setupSheetOpen && canSetup && setupPreview && setupSeat?.branch && <MilitarySheet
        branch={setupSeat.branch} game={setupPreview} choices={setupChoices} canAct={canSetup}
        onClose={() => setSetupSheetOpen(false)}
        onSelect={(choice) => { setSetupPieceId(choice.id); setSetupSheetOpen(false); setFocusedHexKey(choice.destinations[0]); }}
      />}
      {militarySheetOpen && canAct && activeGame.phase === "deploy" && <MilitarySheet initialSheet={militaryInitialSheet} canAct={canAct} runCommand={(command) => { setMilitarySheetOpen(false); return runCommand(command); }} game={activeGame} branch={activeBranch} choices={militaryChoices} onClose={() => setMilitarySheetOpen(false)} onSelect={(choice) => {
        setDeploymentPieceId(choice.id);
        setMilitarySheetOpen(false);
        setFocusedHexKey(choice.destinations[0]);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-hex-key="${choice.destinations[0]}"]`)?.focus({ preventScroll: true }));
      }} />}
      {challengeDuelOpen && lastChallengeEvent && (
        <div className="challenge-duel-overlay" role="dialog" aria-modal="true" aria-label="Monster Challenge result">
          <ChallengeDuelPanel
            eventId={lastChallengeEvent.id}
            winnerName={typeof lastChallengeEvent.detail.winnerName === "string" ? lastChallengeEvent.detail.winnerName : undefined}
            defeatedName={typeof lastChallengeEvent.detail.defeatedName === "string" ? lastChallengeEvent.detail.defeatedName : undefined}
            winnerHealth={typeof lastChallengeEvent.detail.winnerHealth === "number" ? lastChallengeEvent.detail.winnerHealth : undefined}
            loserWeighIn={typeof lastChallengeEvent.detail.loserWeighIn === "number" ? lastChallengeEvent.detail.loserWeighIn : undefined}
            rolls={challengeRolls}
            attacks={challengeAttacks}
            victoryType={typeof lastChallengeEvent.detail.victoryType === "string" ? lastChallengeEvent.detail.victoryType : undefined}
            onClose={() => setChallengeDuelOpen(false)}
          />
        </div>
      )}
      <FightResolutionPanel open={fightOverlayOpen} onClose={() => setFightOverlayOpen(false)} game={activeGame} canAct={canAct} pendingBattle={pendingBattle} pendingAttackTarget={pendingAttackTarget} event={lastBattleEvent?.id !== fightBaselineEventId ? lastBattleEvent : undefined} onChooseTarget={unitId => { if (pendingAttackTarget) void runCommand({ type: "resolve-fight", battleId: pendingAttackTarget.battleId, targetUnitId: unitId }); }} controls={<>
        <PhaseActions hideAttackTargets activeGame={activeGame} onOpenMilitarySheet={openMilitarySheet} canAct={canAct} runCommand={runCommand} getLocationName={(key) => getLocation(key)?.name ?? key} pendingAttackTarget={pendingAttackTarget} pendingAttackPrompt={pendingAttackPrompt} pendingBattle={pendingBattle} pendingBattleDecision={pendingBattleDecision} canSpendInfamyOnPendingBattle={canSpendInfamyOnPendingBattle} retreatChoices={retreatChoices} setRetreatChoices={setRetreatChoices} />
        {activeGame.phase === "fight" && !pendingAttackTarget && !activeGame.pendingRetreat && !canSpendInfamyOnPendingBattle && activeGame.pendingBattles.length <= 1 && <button className="cinema-primary" disabled={!canAct} onClick={() => void runCommand({ type: "resolve-fight", ...(pendingBattle ? { battleId: pendingBattle.id } : {}) })}>Resolve fight →</button>}
        {error && <p role="alert">{error}</p>}
      </>} />
      {researchReveal && <ResolutionStage title="Research" eyebrow="MILITARY / RESEARCH DIVISION" variant="research" onClose={() => setResearchReveal(null)}><CardReveal key={researchReveal} cardId={researchReveal} kind="research" /></ResolutionStage>}
      <EncounterOverlay
        error={error}
        open={encounterOverlayOpen}
        canAct={canAct}
        monsterName={activePlayer.name}
        locationName={activeLocation?.name ?? activePlayer.location}
        eventId={lastEncounterEvent?.id}
        baselineEventId={encounterBaselineEventId}
        effects={encounterEffects}
        rolls={encounterRolls}
        choices={encounterChoices}
        mutationDraws={encounterMutationDraws}
        mutationCardId={encounterMutationDraws.some((draw) => draw.cardDrawn) ? encounterRevealCard : undefined}
        onReveal={() => void runCommand({ type: "resolve-encounter" })}
        onChoice={(choice) => void runCommand({ type: "resolve-encounter", choice })}
        onClose={() => setEncounterOverlayOpen(false)}
      />
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
