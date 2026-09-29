import { StrictMode, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
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
  shortestLegalUnitPaths,
  legalSubmarineTargets,
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupAction,
  type SetupState,
} from "@abominations/game-engine";
import type { AccountSummary, RoomView, SessionResponse } from "@abominations/shared";
import {
  claimRoomSeat,
  createRoom,
  createWebSocketTicket,
  joinRoom,
  listPublicRooms,
  markDisconnected,
  markReconnected,
  RoomCommandChannel,
  readRoom,
  rotateSession,
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
import { InviteLinkControl } from "./components/InviteLinkControl";
import { LogPanel } from "./components/LogPanel";
import { MatchStatus } from "./components/MatchStatus";
import { PhaseActions } from "./components/PhaseActions";
import { ChallengeActions } from "./components/ChallengeActions";
import { BlondeLureActions } from "./components/BlondeLureActions";
import { PieceStackInspector } from "./components/PieceStackInspector";
import { PlayerStatusControls } from "./components/PlayerStatusControls";
import { RevealedCardsPanel } from "./components/RevealedCardsPanel";
import { LaserFenceControls } from "./components/LaserFenceControls";
import { ChopperLiftChoiceControls } from "./components/ChopperLiftChoiceControls";
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
import { TrophyChoicePanel } from "./components/TrophyChoicePanel";
import { BoardViewport } from "./components/BoardViewport";
import { HomeScreen } from "./components/HomeScreen";
import { AccountPanel } from "./components/AccountPanel";
import { botActionDelayMs, botStrategyHint, botTacticForPlayer, chooseBotSetupAction, hasBotLaserFenceReaction, runBotActionWithExplanation } from "./solo-bots";
import { recoverBotActionStep } from "./bot-action-fallback";
import { EncounterResultPanel } from "./components/EncounterResultPanel";
import { CardReveal, ResolutionStage } from "./components/ResolutionStage";
import { EncounterOverlay } from "./components/EncounterOverlay";
import { useEncounterOverlayState } from "./encounter-overlay-state";
import { BoardEventPlayback } from "./components/BoardEventPlayback";
import { isRoutineCityStompEvent, pendingRoutineCityStomp } from "./routine-stomp";
import { ChallengeArena } from "./components/ChallengeArena";
import { DieCube } from "./components/DieCube";
import { ChallengeDuelPanel } from "./components/ChallengeDuelPanel";
import { FightResolutionPanel } from "./components/FightResolutionPanel";
import { ActionResolutionFeedback } from "./components/ActionResolutionFeedback";
import { playSound, type SoundCategory } from "./audio";
import { monsterAssetSlug } from "./monster-assets";
import { BRANCH_MARK } from "./player-visuals";
import { activatePwaUpdate, registerPwaServiceWorker } from "./pwa";
import "./styles.css";

function randomGameSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
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

const BoardReview = lazy(() => import("./components/BoardReview").then(({ BoardReview }) => ({ default: BoardReview })));

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

function shouldShowFirstMatchGuide(): boolean {
  return safeStorageGet("abominations-onboarding-seen") !== "1";
}

function safeStoredNumber(key: string, fallback: number): number {
  const stored = safeStorageGet(key);
  if (stored === null || stored.trim() === "") return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function App() {
  const actionHeadingRef = useRef<HTMLHeadingElement>(null);
  const guideOpenerRef = useRef<HTMLElement | null>(null);
  const gameMenuRef = useRef<HTMLDetailsElement>(null);
  const commandChannelRef = useRef<RoomCommandChannel | null>(null);
  const intentionalRoomLeaveRef = useRef<string | null>(null);
  const completedRoomLeaveRef = useRef<string | null>(null);
  const pendingRoomPollRef = useRef<{ connectionKey: string; promise: Promise<void>; reconnectRequestStarted: boolean } | null>(null);
  const [game, setGame] = useState<GameState>(() => createGame(2));
  const [localPlaytestStarted, setLocalPlaytestStarted] = useState(false);
  const [soloMode, setSoloMode] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [botExplanation, setBotExplanation] = useState("");
  const botTurnRunning = useRef(false);
  const nextBotStepDelay = useRef(650);
  const [session, setSessionState] = useState<SessionResponse | null>(null);
  const sessionRef = useRef(session);
  const setSession: typeof setSessionState = (action) => {
    const next = typeof action === "function" ? action(sessionRef.current) : action;
    sessionRef.current = next;
    setSessionState(next);
  };
  const [room, setRoomState] = useState<RoomView | null>(null);
  const roomRef = useRef(room);
  const setRoom: typeof setRoomState = (action) => {
    const next = typeof action === "function" ? action(roomRef.current) : action;
    roomRef.current = next;
    setRoomState(next);
  };
  const [account, setAccount] = useState<AccountSummary | null>(null);
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
  const commandErrorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [roomStartPending, setRoomStartPending] = useState(false);
  const roomStartPendingRef = useRef(false);
  const roomStartRequestIdRef = useRef(0);
  const homeDestinationVersionRef = useRef(0);
  const [setupActionPending, setSetupActionPending] = useState(false);
  const setupActionInFlight = useRef(false);
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
  const latestAnimatedUnitMoveRef = useRef<{ matchId: string; eventId?: string } | null>(null);
  const moveAnimationSequence = useRef(0);
  const [acceptedActionFeedback, setAcceptedActionFeedback] = useState<{ label: string; key: number } | null>(null);
  const [selectedStackKey, setSelectedStackKey] = useState<HexKey | null>(null);
  const [focusedHexKey, setFocusedHexKey] = useState<HexKey | null>(null);
  const [retreatChoices, setRetreatChoices] = useState<Record<string, HexKey | "disappeared">>({});
  const [onboardingOpen, setOnboardingOpen] = useState(shouldShowFirstMatchGuide);
  const [homeRulesOpen, setHomeRulesOpen] = useState(false);
  const [boardReviewOpen, setBoardReviewOpen] = useState(false);
  const [challengeDuelOpen, setChallengeDuelOpen] = useState(false);
  const [researchReveal, setResearchReveal] = useState<string | null>(null);
  const [fightBaselineEventId, setFightBaselineEventId] = useState<string>();
  const [fightOverlayOpen, setFightOverlayOpen] = useState(false);
  const fightReturnFocusRef = useRef<HTMLElement | null>(null);
  const researchReturnFocusRef = useRef<HTMLElement | null>(null);
  const researchReturnFocusFallbackRef = useRef<HTMLElement | null>(null);
  const [encounterBaselineEventId, setEncounterBaselineEventId] = useState<string | undefined>();
  const encounterReturnFocusRef = useRef<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [gamePanelOpen, setGamePanelOpen] = useState(false);
  const [mobileCommandExpanded, setMobileCommandExpanded] = useState(false);
  const [followBotTurns, setFollowBotTurns] = useState(false);
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
  const commandUnit = activeGame.units.find((unit) => unit.id === selectedUnitId);
  const commandPieceName = commandUnit
    ? (commandUnit.unitTypeId ?? commandUnit.branch).replaceAll("-", " ")
    : activePlayer.name;
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
    () => (selectedUnitId ? shortestLegalUnitPaths(activeGame, selectedUnitId) : []),
    [activeGame, selectedUnitId],
  );
  const selectableUnitIds = useMemo(
    () => activeGame.pendingDecision?.type === "trophy-choice"
      ? new Set(activeGame.pendingDecision.unitIds)
      : activeGame.phase === "move"
      ? new Set(activeGame.units.filter((unit) => shortestLegalUnitPaths(activeGame, unit.id).length > 0 || legalSubmarineTargets(activeGame, unit.id).length > 0).map((unit) => unit.id))
      : new Set<string>(),
    [activeGame],
  );
  const remainingMovementOrders = selectableUnitIds.size + (legalPaths.length > 0 ? 1 : 0);
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
    setGamePanelOpen(false);
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
  const routineStompEvent = lastEncounterEvent && activeBoard
    ? isRoutineCityStompEvent(lastEncounterEvent, activeGame.eventLog, activeBoard)
    : false;
  const encounterRevealCard = activeGame.players[activeGame.currentPlayer]?.mutationCardIds.at(-1);
  const lastChallengeEvent = [...activeGame.eventLog].reverse().find((entry) => ["challenge.resolved", "challenge.giant.resolved"].includes(entry.action));
  useEffect(() => {
    if (activeGame.phase === "challenge") setChallengeDuelOpen(true);
  }, [activeGame.phase]);
  const challengeHistory = lastChallengeEvent?.detail.duelAttacks ?? lastChallengeEvent?.detail.attacks;
  const challengeRolls = Array.isArray(lastChallengeEvent?.detail.rolls)
    ? lastChallengeEvent.detail.rolls.filter((roll): roll is number => typeof roll === "number")
    : [];
  const challengeAttacks = Array.isArray(challengeHistory)
    ? challengeHistory
      .filter((attack): attack is Record<string, unknown> => Boolean(attack && typeof attack === "object"))
      .map((attack) => ({
        attackerId: typeof attack.attackerId === "string" ? attack.attackerId : "monster",
        targetId: typeof attack.targetId === "string" ? attack.targetId : "monster",
        roll: typeof attack.roll === "number" ? attack.roll : 0,
        hit: attack.hit === true,
        smash: attack.smash === true,
        damage: typeof attack.damage === "number" ? attack.damage : 0,
        retaliationDamage: typeof attack.retaliationDamage === "number" ? attack.retaliationDamage : undefined,
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
  const encounterChoiceSource = lastEncounterEvent?.detail.choiceSource === "iron-stomach" || lastEncounterEvent?.detail.choiceSource === "zorb-city"
    ? lastEncounterEvent.detail.choiceSource
    : activeGame.pendingDecision?.type === "encounter-choice" ? activeGame.pendingDecision.source : undefined;
  const encounterMutationDraws = Array.isArray(lastEncounterEvent?.detail.mutationDraws)
    ? lastEncounterEvent.detail.mutationDraws.filter((draw): draw is { siteId: string; cardDrawn: boolean; effectStatus: "implemented" | "source-gated" | "none" } => Boolean(draw && typeof draw === "object" && typeof draw.siteId === "string" && typeof draw.cardDrawn === "boolean" && (draw.effectStatus === "implemented" || draw.effectStatus === "source-gated" || draw.effectStatus === "none")))
    : [];
  const lastTurnStartEvent = [...activeGame.eventLog].reverse().find((entry) =>
    ["turn.passed", "research.drawn"].includes(entry.action) && entry.detail.nextPlayer === activeGame.currentPlayer,
  );
  const lastRecoveryEvent = lastTurnStartEvent && (typeof lastTurnStartEvent.detail.recoveryRoll === "number" || lastTurnStartEvent.detail.atomicRecovery === true)
    ? lastTurnStartEvent
    : undefined;
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
  const localSolo = soloMode && !online;
  const playerRecordIndex = localSolo ? 0 : participant?.playerIndex ?? activeGame.currentPlayer;
  const playerRecordMonster = activeGame.monsters[playerRecordIndex] ?? activePlayer;
  const playerRecordBranch = activeGame.setupAssignments?.[playerRecordIndex]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as const)[playerRecordIndex % 4];
  const activeSetup = online ? activeGame.setupState : localSetup;
  const localSetupComplete = localSetup.phase === "complete";
  const setupComplete = !activeSetup || activeSetup.phase === "complete";
  const gameScreenActive = online || localPlaytestStarted;
  const gameOverlayAvailable = gameScreenActive && !boardReviewOpen;
  const onboardingVisible = gameOverlayAvailable && setupComplete && onboardingOpen;
  const settingsVisible = gameOverlayAvailable && settingsOpen;
  const decisionPlayer = activeGame.pendingDecision?.type === "trophy-choice" || activeGame.pendingDecision?.type === "mutation-choice"
    ? activeGame.pendingDecision.playerIndex
    : activeGame.currentPlayer;
  const encounterOverlay = useEncounterOverlayState({
    online,
    participantRole: participant?.role,
    participantPlayerIndex: participant?.playerIndex,
    decisionPlayer,
  });
  const soloBotTurn = localSolo && activeGame.phase !== "game-over" && decisionPlayer !== 0;
  const soloOtherPlayerTurn = localSolo && activeGame.currentPlayer !== 0;
  const commandMedallionPlayer = localSolo ? playerRecordMonster : activePlayer;
  const commandMedallionBranch = localSolo ? playerRecordBranch : activeBranch;
  const commandMedallionHealthPercent = Math.round(commandMedallionPlayer.health / commandMedallionPlayer.maxHealth * 100);
  const commandMedallionSummary = soloOtherPlayerTurn
    ? `★ ${playerRecordMonster.infamy} · Your record`
    : `★ ${activePlayer.infamy} · ${remainingMovementOrders} ${remainingMovementOrders === 1 ? "order" : "orders"}`;
  const selectedFollowUnit = selectedUnitId ? activeGame.units.find((unit) => unit.id === selectedUnitId
    && isHexKey(unit.location)
    && !activeGame.removedUnitIds.includes(unit.id)
    && (unit.ownerPlayer === activeGame.currentPlayer || unit.branch === "National Guard" && activeGame.players[activeGame.currentPlayer]?.researchCardIds.includes("Guard Commander"))) : undefined;
  const boardFollowHexKey = setupComplete && (!soloOtherPlayerTurn || soloBotTurn && followBotTurns)
    ? selectedFollowUnit?.location ?? activePlayer.location
    : null;
  const canAct =
    setupComplete &&
    !botThinking &&
    !pendingAction &&
    (!soloMode || decisionPlayer === 0) &&
    !activeGame.pendingChopperLift &&
    activeGame.phase !== "game-over" &&
    (!online ||
      (room?.status === "active" && participant?.role === "player" &&
        participant.playerIndex === decisionPlayer));
  const routineStompPrompt = canAct ? pendingRoutineCityStomp(activeGame, activeBoard) : undefined;
  useEffect(() => {
    if (!soloBotTurn) setFollowBotTurns(false);
  }, [soloBotTurn]);
  const mutationWindowOwners = new Set<number>();
  const pendingFightBattleId = activeGame.pendingDecision?.type === "battle-resolution" || activeGame.pendingDecision?.type === "attack-target"
    ? activeGame.pendingDecision.battleId
    : undefined;
  if (activeGame.phase === "fight" && pendingFightBattleId) {
    const battle = activeGame.pendingBattles.find((candidate) => candidate.id === pendingFightBattleId);
    const ownerIndex = battle ? activeGame.monsters.findIndex((monster) => monster.id === battle.monsterId) : -1;
    if (ownerIndex >= 0 && activeGame.players[ownerIndex]?.mutationCardIds.some((cardId) => cardId === "Berserk" || cardId === "Son of a Monster")) mutationWindowOwners.add(ownerIndex);
  }
  if (activeGame.phase === "challenge" && activeGame.challenge?.active && activeGame.challenge.turn
    && (activeGame.challenge.opponentMonsterId || activeGame.challenge.giantUnitId)
    && (activeGame.pendingDecision?.type === "challenge-resolution" || activeGame.pendingDecision?.type === "challenge-giant-resolution")) {
    for (const monsterId of [activeGame.challenge.challengerMonsterId, activeGame.challenge.opponentMonsterId]) {
      const ownerIndex = activeGame.monsters.findIndex((monster) => monster.id === monsterId);
      if (ownerIndex >= 0 && activeGame.players[ownerIndex]?.mutationCardIds.some((cardId) => cardId === "Berserk" || cardId === "Son of a Monster")) mutationWindowOwners.add(ownerIndex);
    }
  }
  const localMutationWindow = !online && mutationWindowOwners.size > 0;
  const canUseMutation = setupComplete && !pendingAction && (localMutationWindow || Boolean(online && participant?.role === "player" && participant.playerIndex !== undefined && mutationWindowOwners.has(participant.playerIndex)));
  const laserFenceOwnerIndex = activeGame.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
  const canUseLaserFence = setupComplete && !pendingAction && laserFenceOwnerIndex >= 0
    && (!online || participant?.role === "player" && participant.playerIndex === laserFenceOwnerIndex);
  const canChooseChopperLift = setupComplete && !pendingAction && Boolean(activeGame.pendingChopperLift)
    && (!online || room?.status === "active" && participant?.role === "player" && participant.playerIndex === activeGame.pendingChopperLift?.playerIndex);
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
  const selectNextMovableUnit = () => {
    const nextUnit = activeGame.units.find((unit) => selectableUnitIds.has(unit.id));
    if (!nextUnit) return;
    setSelectedUnitId(nextUnit.id);
    setSelectedPath([]);
    setSelectedUnitPath([]);
    setHoveredPath([]);
    if (isHexKey(nextUnit.location)) setFocusedHexKey(nextUnit.location);
  };
  const actionDock = activeGame.phase === "move"
    ? selectedUnitPath.length > 1
      ? { label: "Confirm unit move", command: { type: "move-unit", unitId: selectedUnitId!, path: selectedUnitPath } as GameCommand }
      : selectedPath.length > 1
        ? { label: "Confirm monster move", command: { type: "move", path: selectedPath } as GameCommand }
        : !legalPaths.length && !selectableUnitIds.size
          ? { label: "Continue to Fight", command: { type: "pass-move" } as GameCommand }
          : selectedUnitId && selectableUnitIds.has(selectedUnitId)
            ? { label: "Hold this unit", command: { type: "stay-piece", pieceId: selectedUnitId } as GameCommand }
            : selectedUnitId
              ? { label: "Choose another piece", command: undefined }
              : !activeGame.movedPieceIds.includes(activePlayer.id) && legalPaths.length > 0
                ? { label: `Hold ${activePlayer.name}`, command: { type: "stay-piece", pieceId: activePlayer.id } as GameCommand }
                : { label: "Next piece", command: undefined }
    : activeGame.phase === "fight"
      ? pendingBattle && !pendingAttackTarget && !activeGame.pendingDecision?.type?.includes("retreat") && !canSpendInfamyOnPendingBattle && activeGame.pendingBattles.length === 1
        ? { label: "Resolve fight", command: { type: "resolve-fight", battleId: pendingBattle.id } as GameCommand }
        : { label: pendingAttackTarget ? "Choose attack target" : "Continue to Fight", command: undefined }
      : activeGame.phase === "encounter"
        ? activeGame.pendingDecision && activeGame.pendingDecision.type !== "encounter-resolution"
          ? { label: activeGame.pendingDecision.type === "mutation-choice" ? "Choose Toxicor Mutation" : activeGame.pendingDecision.type === "stabilizer-ray-choice" ? "Choose Mutation to discard" : "Choose encounter option", command: undefined }
          : routineStompPrompt
            ? { label: routineStompPrompt.dice > 0 ? `Roll all ${routineStompPrompt.dice} dice` : "Resolve city stomp", command: { type: "resolve-encounter" } as GameCommand }
            : { label: "Resolve encounter", command: { type: "resolve-encounter" } as GameCommand }
        : activeGame.phase === "deploy"
          ? militaryChoices.length
            ? { label: deploymentPiece ? "Change deployment piece" : "Deploy military", command: undefined }
            : { label: "Deployment complete", command: undefined }
          : activeGame.phase === "challenge"
            ? { label: "Resolve Monster Challenge", command: undefined }
          : { label: "Match complete", command: undefined };
  const readOnlyFightView = activeGame.phase === "fight" && !canAct;

  useEffect(() => {
    actionHeadingRef.current?.focus({ preventScroll: true });
  }, [activeGame.phase, activeGame.round, room?.version, localPlaytestStarted]);
  useEffect(() => {
    const selector = settingsVisible ? ".settings-panel" : onboardingVisible ? ".onboarding" : undefined;
    if (!selector) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>(`${selector} button, ${selector} input`)?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSettingsOpen(false); setOnboardingOpen(false); }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      if (settingsVisible && settingsOpenerRef.current?.isConnected) settingsOpenerRef.current.focus({ preventScroll: true });
      else if (onboardingVisible && guideOpenerRef.current?.isConnected) {
        guideOpenerRef.current.focus({ preventScroll: true });
        guideOpenerRef.current = null;
      } else if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
      else if (onboardingVisible) actionHeadingRef.current?.focus({ preventScroll: true });
    };
  }, [settingsVisible, onboardingVisible]);
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
  const canSetup = Boolean(setupSeat && (!online || participant?.playerIndex === setupSeat.playerIndex) && (!soloMode || setupSeat.playerIndex === 0));
  const setupPreview = useMemo(() => activeSetup?.phase === "starting-choice" && setupSeat
    ? setupDeploymentState(activeGame, setupSeat.playerIndex, setupPlacementPlayer === setupSeat.playerIndex ? setupPlacements : []) : undefined,
    [activeGame, activeSetup?.phase, setupSeat, setupPlacements, setupPlacementPlayer]);
  const setupChoices = useMemo(() => setupPreview ? deploymentChoices(setupPreview).filter((choice) => choice.kind === "deploy") : [], [setupPreview]);
  const retreatingMonsterId = activeGame.pendingRetreat?.monsterId;
  const activeRetreatChoice = Boolean(canAct && retreatingMonsterId);
  // The expanded turn panel overlays board cells. Temporarily render the map
  // unobstructed while every retreat destination is an immediate choice; the
  // saved preference returns as soon as the decision resolves.
  const gamePanelVisible = gamePanelOpen && !activeRetreatChoice;
  const retreatDestinations = useMemo(() => {
    if (!activeGame.pendingRetreat || !retreatingMonsterId) return new Set<HexKey>();
    return new Set(activeGame.pendingRetreat.options[retreatingMonsterId] ?? []);
  }, [activeGame.pendingRetreat, retreatingMonsterId]);
  const retreatCameraFocusKeys = useMemo(() => activeRetreatChoice ? [...retreatDestinations].sort() : undefined,
    [activeRetreatChoice, retreatDestinations]);
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
    const latestMove = [...activeGame.eventLog].reverse().find((event) => event.action === "unit.moved");
    const previous = latestAnimatedUnitMoveRef.current;
    if (!previous || previous.matchId !== activeGame.matchId) {
      latestAnimatedUnitMoveRef.current = { matchId: activeGame.matchId, eventId: latestMove?.id };
      return;
    }
    if (!latestMove || latestMove.id === previous.eventId) return;
    latestAnimatedUnitMoveRef.current = { matchId: activeGame.matchId, eventId: latestMove.id };
    const unitId = latestMove.detail.unitId;
    const pathValue = latestMove.detail.path;
    if (typeof unitId !== "string" || !Array.isArray(pathValue) || pathValue.length < 2 || !pathValue.every(isHexKey)) return;
    const path = pathValue as HexKey[];
    if (!activeGame.units.some((unit) => unit.id === unitId && unit.location === path.at(-1))) return;
    moveAnimationSequence.current += 1;
    setAcceptedMoveAnimation({ path, pieceId: unitId, key: moveAnimationSequence.current });
  }, [activeGame.eventLog, activeGame.matchId, activeGame.units]);

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
        accountLinked?: boolean;
        room?: { code: string };
      };
      if (!stored.token || !stored.room?.code) return;
      void readRoom(stored.room.code, stored.token)
        .then((restoredRoom) => {
          setSession({
          token: stored.token,
          participantId: stored.participantId,
          accountLinked: stored.accountLinked,
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
    let socket: WebSocket | undefined;
    let commandChannel: RoomCommandChannel | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let disconnected = false;
    let cancelled = false;
    const connectionKey = `${room.code.toUpperCase()}:${session.token}`;
    const connectionIsCurrent = () => sessionRef.current?.token === session.token
      && roomRef.current?.code.toUpperCase() === room.code.toUpperCase();
    const markOffline = () => {
      if (disconnected || !connectionIsCurrent()) return;
      if (intentionalRoomLeaveRef.current === connectionKey) return;
      disconnected = true;
      void markDisconnected(room.code, session.token).catch(() => undefined);
    };
    const startPolling = () => {
      if (cancelled || !connectionIsCurrent() || intentionalRoomLeaveRef.current === connectionKey) return;
      if (polling) return;
      setConnectionState("reconnecting");
      polling = setInterval(() => {
        if (cancelled || !connectionIsCurrent() || intentionalRoomLeaveRef.current === connectionKey || pendingRoomPollRef.current?.connectionKey === connectionKey) return;
        const pollState = { connectionKey, promise: Promise.resolve(), reconnectRequestStarted: false };
        const pollRequest = readRoom(room.code, session.token, room.version)
          .then(async (nextRoom) => {
            if (cancelled || !connectionIsCurrent() || intentionalRoomLeaveRef.current === connectionKey) return;
            pollState.reconnectRequestStarted = true;
            const reconnectedRoom = await markReconnected(room.code, session.token);
            if (cancelled || !connectionIsCurrent() || intentionalRoomLeaveRef.current === connectionKey) return;
            setRoom(reconnectedRoom ?? nextRoom);
            disconnected = false;
            setConnectionState("online");
          })
          .catch(() => {
            if (!cancelled && connectionIsCurrent() && intentionalRoomLeaveRef.current !== connectionKey) setConnectionState("stale");
          });
        pollState.promise = pollRequest;
        pendingRoomPollRef.current = pollState;
        void pollRequest.finally(() => {
          if (pendingRoomPollRef.current?.promise === pollRequest) pendingRoomPollRef.current = null;
        });
      }, 2000);
    };
    void createWebSocketTicket(room.code, session.token).then(({ ticket }) => {
      if (cancelled || !connectionIsCurrent()) return;
      socket = new WebSocket(websocketUrl(room.code, ticket));
      commandChannel = new RoomCommandChannel(socket);
      commandChannelRef.current = commandChannel;
      socket.onopen = () => {
        if (cancelled || !connectionIsCurrent()) return;
        setConnectionState("online");
        if (polling) { clearInterval(polling); polling = undefined; }
      };
      socket.onmessage = (event) => {
        if (cancelled || !connectionIsCurrent()) return;
        const message = JSON.parse(event.data) as { type: string; room: RoomView };
        if (message.type === "room.updated") { setRoom(message.room); setConnectionState("online"); }
      };
      socket.onerror = () => { markOffline(); startPolling(); };
      socket.onclose = () => { markOffline(); startPolling(); };
    }).catch(() => {
      if (cancelled) return;
      markOffline();
      startPolling();
    });
    return () => {
      cancelled = true;
      if (intentionalRoomLeaveRef.current === connectionKey) {
        if (completedRoomLeaveRef.current === connectionKey) {
          intentionalRoomLeaveRef.current = null;
          completedRoomLeaveRef.current = null;
        }
        disconnected = true;
      } else {
        markOffline();
      }
      commandChannel?.dispose();
      if (commandChannelRef.current === commandChannel) commandChannelRef.current = null;
      socket?.close();
      if (polling) clearInterval(polling);
    };
  }, [session?.token, room?.code]);

  const focusNextMovementUnit = (nextGame: GameState) => {
    if (nextGame.phase !== "move") return;
    const monster = nextGame.monsters[nextGame.currentPlayer];
    if (!monster || !nextGame.movedPieceIds.includes(monster.id)) return;
    const nextUnit = nextGame.units.find((unit) =>
      shortestLegalUnitPaths(nextGame, unit.id).length > 0 || legalSubmarineTargets(nextGame, unit.id).length > 0,
    );
    if (!nextUnit) return;
    setSelectedUnitId(nextUnit.id);
    setSelectedPath([]);
    setSelectedUnitPath([]);
    setHoveredPath([]);
    if (isHexKey(nextUnit.location)) setFocusedHexKey(nextUnit.location);
  };

  const captureResearchReturnFocus = () => {
    researchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    researchReturnFocusFallbackRef.current = actionHeadingRef.current;
  };

  const runCommand = async (command: GameCommand, opener?: HTMLButtonElement) => {
    if (pendingAction) return;
    commandErrorOpenerRef.current = null;
    if (command.type === "draw-research") captureResearchReturnFocus();
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
          commandChannelRef.current,
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
      commandErrorOpenerRef.current = opener ?? null;
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
    if (pendingAction || !error) return;
    const opener = commandErrorOpenerRef.current;
    commandErrorOpenerRef.current = null;
    if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
  }, [error, pendingAction]);

  useEffect(() => {
    if (activeGame.phase !== "deploy" || militaryChoices.length > 0) {
      autoFinishDeploymentRequested.current = false;
      return;
    }
    if (!canAct || pendingAction || autoFinishDeploymentRequested.current) return;
    autoFinishDeploymentRequested.current = true;
    void runCommand({ type: "pass-deploy" });
  }, [activeGame.phase, canAct, militaryChoices.length, pendingAction]);

  const runBoardAction = (command: GameCommand, opener?: HTMLButtonElement) => {
    if (command.type === "resolve-fight") {
      fightReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFightBaselineEventId(lastBattleEvent?.id);
      setFightOverlayOpen(true);
      return;
    }
    if (command.type === "resolve-encounter" && !command.choice && !command.trophyUnitId) {
      if (routineStompPrompt) { void runCommand(command); return; }
      encounterReturnFocusRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setEncounterBaselineEventId(lastEncounterEvent?.id);
      encounterOverlay.openForPlayer(activeGame.currentPlayer);
      return;
    }
    void runCommand(command, opener);
  };

  const replaceOnlineSession = (next: SessionResponse | null) => {
    if (!next) {
      setSession(null);
      setRoom(null);
      localStorage.removeItem("abominations-session");
      return;
    }
    const accountLinked = next.accountLinked ?? (
      session?.participantId === next.participantId && session.room.code === next.room.code
        ? session.accountLinked
        : undefined
    );
    const normalized = accountLinked === undefined ? next : { ...next, accountLinked };
    setSession(normalized);
    setRoom(next.room);
    setRoomCode(next.room.code);
    localStorage.setItem("abominations-session", JSON.stringify({ token: next.token, participantId: next.participantId, accountLinked, room: { code: next.room.code } }));
  };
  const startSession = async (kind: "create" | "join" | "spectate") => {
    if (roomStartPendingRef.current) return;
    roomStartPendingRef.current = true;
    const requestId = ++roomStartRequestIdRef.current;
    const destinationVersion = homeDestinationVersionRef.current;
    setRoomStartPending(true);
    setError("");
    setLocalPlaytestStarted(false);
    setOnboardingOpen(shouldShowFirstMatchGuide());
    setGamePanelOpen(true);
    try {
      const created =
        kind === "create"
          ? await createRoom(playerCount, displayName || "Player 1", roomPrivacy)
          : kind === "join"
            ? await joinRoom(roomCode, displayName || "Player")
            : await spectateRoom(roomCode, displayName || "Spectator");
      if (requestId !== roomStartRequestIdRef.current || destinationVersion !== homeDestinationVersionRef.current) return;
      const result = account && kind !== "spectate" ? await claimRoomSeat(created.room.code, created.token) : created;
      if (requestId !== roomStartRequestIdRef.current || destinationVersion !== homeDestinationVersionRef.current) return;
      replaceOnlineSession(result);
    } catch (caught) {
      if (requestId === roomStartRequestIdRef.current && destinationVersion === homeDestinationVersionRef.current) {
        setError(caught instanceof Error ? caught.message : "Could not join room");
      }
    } finally {
      if (requestId === roomStartRequestIdRef.current) {
        roomStartPendingRef.current = false;
        setRoomStartPending(false);
      }
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
      const created = await createRoom(rematchPlayerCount, (account?.username ?? displayName) || "Player 1");
      const result = account ? await claimRoomSeat(created.room.code, created.token) : created;
      setPlayerCount(rematchPlayerCount);
      replaceOnlineSession(result);
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

  const recoverRoomConnection = async () => {
    if (!session || !room) return;
    setError("");
    setConnectionState("reconnecting");
    try {
      const replacement = await rotateSession(room.code, session.token);
      replaceOnlineSession(replacement);
    } catch (caught) {
      setConnectionState("stale");
      setError(caught instanceof Error ? caught.message : "Could not reset the room connection.");
    }
  };

  const applyLocalSetup = (next: SetupState) => {
    setLocalSetup(next);
    setGame((current) => { const updated = { ...current, setupState: next }; return next.phase === "complete" ? applyCompletedSetup(updated) : updated; });
  };

  useEffect(() => {
    if (!soloMode || online || localSetup.phase === "complete") return;
    let next = localSetup;
    for (let step = 0; step < 12; step += 1) {
      const seat = next.phase === "monster-selection"
        ? next.seats.find((candidate) => !candidate.monsterId)
        : next.phase === "branch-selection"
          ? [...next.seats].sort((a, b) => b.playerIndex - a.playerIndex).find((candidate) => !candidate.branch)
          : next.phase === "lair-selection"
            ? next.seats.find((candidate) => !candidate.lair)
            : next.phase === "starting-choice"
              ? next.seats.find((candidate) => !candidate.startingChoice)
              : undefined;
      if (!seat || seat.playerIndex === 0) break;
      const updated = chooseBotSetupAction({ ...game, setupState: next }, next, seat.playerIndex);
      if (updated === next) break;
      next = updated;
    }
    if (next === localSetup) return;
    setLocalSetup(next);
    setGame((current) => {
      const updated = { ...current, setupState: next };
      return next.phase === "complete" ? applyCompletedSetup(updated) : updated;
    });
  }, [game, localSetup, online, soloMode]);

  useEffect(() => {
    if (!soloMode || online || !setupComplete || activeGame.phase === "game-over") return;
    const decision = activeGame.pendingDecision;
    const actor = decision && "playerIndex" in decision ? decision.playerIndex : activeGame.currentPlayer;
    const botFenceReaction = hasBotLaserFenceReaction(activeGame);
    if ((actor === 0 && !botFenceReaction) || botTurnRunning.current) return;
    botTurnRunning.current = true;
    setBotThinking(true);
    const currentGame = activeGame;
    const timer = window.setTimeout(() => {
      const result = runBotActionWithExplanation(currentGame);
      let nextState = result.state;
      let command = result.command;
      let explanation = result.explanation;
      const recovery = recoverBotActionStep(currentGame, result);
      if (recovery.type === "error") {
        setError(recovery.message);
        setBotThinking(false);
        botTurnRunning.current = false;
        return;
      }
      if (!command || nextState === currentGame) {
        const fallback = recovery.type === "fallback" ? recovery.command : undefined;
        if (fallback) {
          try {
            nextState = applyCommand(currentGame, fallback).state;
            command = fallback;
            explanation = currentGame.phase === "deploy"
              ? "Finished Deploy and passed the turn after checking the remaining legal choices."
              : "Finished movement and continued the turn after checking the remaining legal moves.";
          } catch { /* Surface the stalled choice below rather than repeat it indefinitely. */ }
        }
      }
      if (!command || nextState === currentGame) {
        setError(`The bot could not finish its ${currentGame.phase} action. The match state has been preserved.`);
        setBotThinking(false);
        botTurnRunning.current = false;
        return;
      }
      if (command.type === "move" || command.type === "move-unit") {
        if (command.type === "move") {
          const pieceId = currentGame.monsters[currentGame.currentPlayer]?.id;
          if (pieceId) {
            moveAnimationSequence.current += 1;
            setAcceptedMoveAnimation({ path: command.path as HexKey[], pieceId, key: moveAnimationSequence.current });
          }
        }
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(document.querySelector(".manual-reduced-motion"));
        nextBotStepDelay.current = botActionDelayMs(command, reducedMotion);
      } else if (command.type === "resolve-fight") {
        const resolvedEvent = nextState.eventLog.at(-1);
        const previousBattleEvent = resolvedEvent && (resolvedEvent.action === "fight.resolved" || resolvedEvent.action === "battle.target-required")
          ? [...currentGame.eventLog].reverse().find((event) => (event.action === "fight.resolved" || event.action === "battle.target-required") && event.detail.battleId === resolvedEvent.detail.battleId && Array.isArray(event.detail.attacks))
          : undefined;
        const totalAttacks = Array.isArray(resolvedEvent?.detail.attacks) ? resolvedEvent.detail.attacks.length : 0;
        const priorAttacks = Array.isArray(previousBattleEvent?.detail.attacks) ? previousBattleEvent.detail.attacks.length : 0;
        const newAttacks = Math.max(0, totalAttacks - priorAttacks);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(document.querySelector(".manual-reduced-motion"));
        // Let the board playback show each newly logged strike before the bot takes its next action.
        nextBotStepDelay.current = newAttacks > 0
          ? reducedMotion ? 1600 : Math.max(1600, newAttacks * 720 + 800)
          : botActionDelayMs(command, reducedMotion);
      } else if (command.type === "resolve-encounter") {
        // Other players follow the bot encounter from the board instead of opening its modal.
        nextBotStepDelay.current = botActionDelayMs(command);
      } else {
        nextBotStepDelay.current = 650;
      }
      const nextDecision = nextState.pendingDecision;
      const nextActor = nextDecision && "playerIndex" in nextDecision ? nextDecision.playerIndex : nextState.currentPlayer;
      const botContinues = nextState.phase !== "game-over" && (nextActor !== 0 || hasBotLaserFenceReaction(nextState));
      setGame(nextState);
      if (explanation) setBotExplanation(explanation);
      setBotThinking(botContinues);
      botTurnRunning.current = false;
    }, nextBotStepDelay.current);
    return () => {
      window.clearTimeout(timer);
      botTurnRunning.current = false;
    };
  }, [activeGame, online, setupComplete, soloMode]);
  const submitOnlineSetupAction = async (action: SetupAction) => {
    if (!online || !session || !room || setupActionInFlight.current) return;
    setupActionInFlight.current = true;
    setSetupActionPending(true);
    setError("");
    try {
      setRoom(await sendSetupAction(room.code, session.token, room.version, action));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update setup");
    } finally {
      setupActionInFlight.current = false;
      setSetupActionPending(false);
    }
  };
  const chooseSetupOption = async (value: string) => {
    if (
      !setupSeat ||
      !activeSetup ||
      setupActionInFlight.current ||
      (online && participant?.playerIndex !== setupSeat.playerIndex) ||
      (soloMode && setupSeat.playerIndex !== 0)
    )
      return;
    if (online && session && room) {
      const action: SetupAction = activeSetup.phase === "monster-selection"
        ? { type: "choose-monster", monsterId: value }
        : activeSetup.phase === "branch-selection"
          ? { type: "choose-branch", branch: value as "Army" | "Navy" | "Air Force" | "Marines" }
          : { type: "choose-lair", lair: value };
      await submitOnlineSetupAction(action);
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
      setupActionInFlight.current ||
      (online && participant?.playerIndex !== setupSeat.playerIndex) ||
      (soloMode && setupSeat.playerIndex !== 0)
    )
      return;
    const startingChoice = kind === "research" ? { kind } as const : { kind, placements: setupPlacements } as const;
    if (online && session && room) {
      await submitOnlineSetupAction({ type: "choose-starting-choice", startingChoice });
      return;
    }
    applyLocalSetup(
      chooseStartingChoice(localSetup, setupSeat.playerIndex, startingChoice),
    );
  };
  const changePlayerCount = (value: 2 | 3 | 4) => {
    if (roomStartPendingRef.current) return;
    setPlayerCount(value);
    const next = createMvpRoomGame(value);
    setLocalSetup(next.setupState!);
    setGame(next);
  };
  const resetLocal = () => {
    if (roomStartPendingRef.current) return;
    homeDestinationVersionRef.current += 1;
    setSoloMode(false);
    setBotThinking(false);
    setBotExplanation("");
    setLocalPlaytestStarted(true);
    setOnboardingOpen(shouldShowFirstMatchGuide());
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
  const startSolo = () => {
    if (roomStartPendingRef.current) return;
    homeDestinationVersionRef.current += 1;
    setSoloMode(true);
    setBotThinking(false);
    setBotExplanation("");
    botTurnRunning.current = false;
    nextBotStepDelay.current = 650;
    setLocalPlaytestStarted(true);
    setOnboardingOpen(shouldShowFirstMatchGuide());
    setGamePanelOpen(true);
    setSession(null);
    setRoom(null);
    setError("");
    const next = createMvpRoomGame(playerCount, randomGameSeed());
    setLocalSetup(next.setupState!);
    setGame(next);
    localStorage.removeItem("abominations-session");
  };
  const startTemporaryVictoryScenario = () => {
    if (roomStartPendingRef.current) return;
    homeDestinationVersionRef.current += 1;
    setLocalPlaytestStarted(true);
    setOnboardingOpen(shouldShowFirstMatchGuide());
    setGamePanelOpen(true);
    setSession(null);
    setRoom(null);
    setError("");
    setPlayerCount(2);
    setLocalSetup(createCompletedDevelopmentSetup());
    // Seed the setup-less browser fixture with a Research order that avoids
    // immediate giant placement cards requiring setup-assigned bases.
    setGame(createDevelopmentVictoryGame(4));
    localStorage.removeItem("abominations-session");
  };
  const startProvisionalPlaytest = resetLocal;
  const leaveRoom = async () => {
    if (session && room) {
      const leavingSession = session;
      const leavingRoom = room;
      const connectionKey = `${room.code.toUpperCase()}:${session.token}`;
      if (intentionalRoomLeaveRef.current === connectionKey) return;
      intentionalRoomLeaveRef.current = connectionKey;
      let explicitDisconnectCompleted = false;
      try {
        const pendingPoll = pendingRoomPollRef.current;
        const cancelPendingReconnect = pendingPoll?.connectionKey === connectionKey && pendingPoll.reconnectRequestStarted;
        if (intentionalRoomLeaveRef.current !== connectionKey) return;
        await markDisconnected(room.code, session.token, cancelPendingReconnect);
        explicitDisconnectCompleted = true;
      } catch {
        if (intentionalRoomLeaveRef.current === connectionKey) intentionalRoomLeaveRef.current = null;
        if (completedRoomLeaveRef.current === connectionKey) completedRoomLeaveRef.current = null;
        // Returning to the lobby is still safe when the network is unavailable.
      }
      if (sessionRef.current !== leavingSession || roomRef.current?.code.toUpperCase() !== leavingRoom.code.toUpperCase()) {
        if (intentionalRoomLeaveRef.current === connectionKey) intentionalRoomLeaveRef.current = null;
        if (completedRoomLeaveRef.current === connectionKey) completedRoomLeaveRef.current = null;
        return;
      }
      completedRoomLeaveRef.current = explicitDisconnectCompleted ? connectionKey : null;
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
    const category: SoundCategory = latestEvent.action === "fight.resolved" || ["challenge.resolved", "challenge.giant.resolved", "challenge.attack.rolled"].includes(latestEvent.action)
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
    return <Suspense fallback={<main className="board-review-screen" role="status">Loading board review…</main>}><BoardReview onClose={() => setBoardReviewOpen(false)} /></Suspense>;
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
        roomStartPending={roomStartPending}
        onDisplayNameChange={setDisplayName}
        onPlayerCountChange={changePlayerCount}
        onRoomPrivacyChange={setRoomPrivacy}
        onRoomCodeChange={setRoomCode}
        onRefreshPublicRooms={() => void refreshPublicRooms()}
        onStartSession={startSession}
        onToggleReady={() => undefined}
        onRecoverConnection={() => undefined}
        onLeaveRoom={() => undefined}
        rulesOpen={homeRulesOpen}
        onToggleRules={() => setHomeRulesOpen((open) => !open)}
        onStartLocal={resetLocal}
        onStartSolo={startSolo}
        onStartProvisionalPlaytest={startProvisionalPlaytest}
        onOpenBoardReview={() => {
          if (roomStartPendingRef.current) return;
          homeDestinationVersionRef.current += 1;
          setBoardReviewOpen(true);
        }}
        onStartVictoryScenario={startTemporaryVictoryScenario}
        accountPanel={<AccountPanel account={account} session={session} onAccountChange={setAccount} onSessionChange={replaceOnlineSession} />}
      />
    );
  }

  const renderedBoard = boardForGame(activeGame);
  const boardHasCompleteTranscriptionFlags = (renderedBoard?.id === AUDITED_BOARD.id || renderedBoard?.id === FULL_HONEYCOMB_BOARD.id)
    && Object.values(renderedBoard.hexes).every((hex) => hex.verification === "verified");
  const boardDescription = boardHasCompleteTranscriptionFlags
    ? "The 336-cell transcribed board is active for playtesting. Independent source review and production sign-off remain open."
    : renderedBoard?.id === FULL_HONEYCOMB_BOARD.id
      ? "The full honeycomb coordinate shell is unresolved review tooling and is not a playable board. Physical cell data is still being transcribed."
      : renderedBoard?.id === PROVISIONAL_AUTHORITATIVE_BOARD.id
        ? "The provisional honeycomb board is a playtest guess. Its labels, terrain, barriers, and features are not verified."
      : renderedBoard
      ? "This match uses the nine-space development board. Physical-board data is still being transcribed."
      : "This match references an unavailable board version, so board interaction is disabled until the matching definition is loaded.";

  return (
    <main
      className={`game-screen ${!setupComplete ? "setup-in-progress" : ""} ${online ? "online-game" : "local-game"} ${gamePanelVisible ? "game-panel-open" : "game-panel-closed"} ${largeText ? "large-text" : ""} ${!showBoardLabels ? "board-labels-hidden" : ""} ${manualReducedMotion ? "manual-reduced-motion" : ""}`}
      data-board-id={renderedBoard?.id ?? ""}
      data-board-version={renderedBoard?.version ?? ""}
      data-board-content-hash={renderedBoard?.contentHash ?? ""}
      data-rendered-board-id={renderedBoard?.id ?? ""}
      data-rendered-board-content-hash={renderedBoard?.contentHash ?? ""}
    >
      <header>
        <div className="top-turn-summary" aria-live="polite">
          <div className="turn-hud-heading">
            <div><span className="label">{!setupComplete ? "GAME SETUP" : `ROUND ${activeGame.round} · ${soloMode && decisionPlayer !== 0 ? "BOT TURN" : canAct ? "YOUR TURN" : "CURRENT TURN"} · PLAYER ${decisionPlayer + 1}`}</span><h2 ref={actionHeadingRef} tabIndex={-1}>{setupComplete ? action : "Monster and branch selection"}</h2>{retreatingMonsterId && <span className="retreat-phase-indicator" role="status">{canAct ? "Choose retreat" : "Waiting for retreat choice"}</span>}</div>
            <button type="button" className="ghost" onClick={() => setGamePanelOpen((open) => !open)} aria-expanded={gamePanelVisible} aria-controls="turn-hud-body" aria-label={activeRetreatChoice ? gamePanelOpen ? "Keep turn panel minimized after retreat" : "Expand turn panel after retreat" : gamePanelVisible ? "Minimize turn panel" : "Expand turn panel"}>{gamePanelVisible ? "−" : "+"}</button>
          </div>
        </div>
        <div className="header-actions">
          {setupComplete && <PlayerStatusControls game={activeGame} playerIndex={playerRecordIndex} monster={playerRecordMonster} branch={playerRecordBranch} canAct={canAct} mobileCommandExpanded={mobileCommandExpanded} runCommand={runCommand} onDeploy={openMilitarySheet} onSelectDeployment={(choice) => { setDeploymentPieceId(choice.id); setFocusedHexKey(choice.destinations[0]); }} />}
          <details ref={gameMenuRef} className="hud-menu" onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            const menu = event.currentTarget;
            menu.open = false;
            menu.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
          }}>
            <summary aria-label="Open game menu">☰ <span>Menu</span></summary>
            <div className="hud-menu-items">
              {online && <span className="room-hud-menu-status" role="status">{room?.code} · {connectionState}</span>}
              {online && <InviteLinkControl roomCode={room?.code ?? ""} buttonClassName="ghost" />}
              <button className="ghost how-to-play-action" onClick={() => {
                setSettingsOpen(false);
                guideOpenerRef.current = gameMenuRef.current?.querySelector(":scope > summary") ?? null;
                if (gameMenuRef.current) gameMenuRef.current.open = false;
                setOnboardingOpen(true);
              }}>How to play</button>
              <button className="ghost settings-action" onClick={(event) => { settingsOpenerRef.current = event.currentTarget; setOnboardingOpen(false); setSettingsOpen((open) => !open); }} aria-expanded={settingsOpen}>Settings</button>
              <button className="ghost new-game-action" onClick={soloMode ? startSolo : resetLocal}>{soloMode ? "New solo game" : "New local game"}</button>
              {online && participant?.role === "player" && room?.status === "waiting" && <button className="ghost" disabled={!setupComplete || pendingAction} onClick={() => void toggleReady()}>{participant.ready ? "Not ready" : "Ready"}</button>}
              {online && <button className="ghost leave-room-action" onClick={leaveRoomSafely}>Leave room</button>}
              <AccountPanel account={account} session={session} onAccountChange={setAccount} onSessionChange={replaceOnlineSession} />
            </div>
          </details>
        </div>
      </header>
      <details className="board-map-controls">
        <summary aria-label="Open map view controls" title="Map controls">⌖</summary>
        <div className="map-control-slot" />
      </details>
      {error && <p className="error global-game-error" role="alert">{error}</p>}
      {soloMode && setupComplete && (decisionPlayer !== 0 || botExplanation || botThinking) && <aside className="bot-turn-guidance" role="status"><strong>{botThinking ? decisionPlayer === 0 && hasBotLaserFenceReaction(activeGame) ? "Bot is reacting" : "Bot is planning" : decisionPlayer !== 0 ? `${activePlayer.name} bot` : "Bot plan"}</strong><span>{botThinking ? decisionPlayer === 0 && hasBotLaserFenceReaction(activeGame) ? "Checking whether to force a retreat or make the monster spend Infamy." : botStrategyHint(activePlayer.name, activeGame.setupAssignments?.[decisionPlayer]?.branch ?? "Army", decisionPlayer > 0 ? botTacticForPlayer(activeGame, decisionPlayer) : undefined) : decisionPlayer !== 0 ? botStrategyHint(activePlayer.name, activeGame.setupAssignments?.[decisionPlayer]?.branch ?? "Army", botTacticForPlayer(activeGame, decisionPlayer)) : botExplanation}</span></aside>}
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
        onStartSession={startSession}
        onToggleReady={() => void toggleReady()}
        onRecoverConnection={() => void recoverRoomConnection()}
        onLeaveRoom={leaveRoomSafely}
      />
      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} largeText={largeText} showBoardLabels={showBoardLabels} manualReducedMotion={manualReducedMotion} confirmIrreversible={confirmIrreversible} masterVolume={masterVolume} musicVolume={musicVolume} effectsVolume={effectsVolume} muted={muted} setLargeText={setLargeText} setShowBoardLabels={setShowBoardLabels} setManualReducedMotion={setManualReducedMotion} setConfirmIrreversible={setConfirmIrreversible} setMasterVolume={(value) => setStoredVolume("abominations-master-volume", setMasterVolume, value)} setMusicVolume={(value) => setStoredVolume("abominations-music-volume", setMusicVolume, value)} setEffectsVolume={(value) => setStoredVolume("abominations-effects-volume", setEffectsVolume, value)} setMuted={setMuted} togglePreference={togglePreference} />
      )}
      {onboardingVisible && (
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
          setupApplied={Boolean(activeGame.setupApplied)}
          board={renderedBoard}
          setupSeat={setupSeat}
          online={online}
          playerIndex={participant?.playerIndex}
          participants={room?.participants ?? []}
          submitting={setupActionPending}
          onChooseOption={(value) => void chooseSetupOption(value)}
          deploymentCount={setupPlacements.length}
          hasAvailableDeploymentOptions={setupChoices.length > 0}
          selectingDeployment={setupDeploying}
          selectedPiece={setupPiece?.typeId}
          onFinishDeployment={() => void chooseSetupStartingChoice("deploy")}
          onUndoDeployment={() => { setSetupPlacements((current) => current.slice(0, -1)); setSetupPieceId(null); }}
          onChooseStartingChoice={(kind) => { if (setupActionPending) return; if (kind === "deploy") { setSetupPlacementPlayer(setupSeat?.playerIndex ?? null); setSetupDeploying(true); setSetupSheetOpen(true); } else void chooseSetupStartingChoice(kind); }}
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
      <section className={`layout ${gamePanelVisible ? "panel-open" : "panel-closed"}`} data-panel-preference={gamePanelOpen ? "open" : "closed"}>
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
          <BoardViewport board={renderedBoard} boardId={activeGame.boardId} boardContentHash={activeGame.boardContentHash} focusHexKey={boardFollowHexKey} focusHexKeys={retreatCameraFocusKeys} overviewImage={renderedBoard?.id === AUDITED_BOARD.id ? "/assets/board/audited/overview.webp" : undefined}>
            {activeGame.phase === "encounter" && activeGame.pendingDecision?.type === "trophy-choice" && <div className="deployment-prompt trophy-prompt" role="status">
              {activeGame.pendingDecision.unitIds.some((id) => activeGame.units.some((unit) => unit.id === id && unit.location === "record-tile"))
                ? <>Player {activeGame.pendingDecision.playerIndex + 1} · {activeGame.pendingDecision.branch} military record<br />Choose a card still in reserve.</>
                : <>Player {activeGame.pendingDecision.playerIndex + 1} · {activeGame.pendingDecision.branch} units<br />No cards remain in reserve · choose a highlighted unit on the board.</>}
            </div>}
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
              trophyUnitIds={activeGame.pendingDecision?.type === "trophy-choice" ? new Set(activeGame.pendingDecision.unitIds.filter((id) => activeGame.units.some((unit) => unit.id === id && unit.location !== "record-tile"))) : new Set()}
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
          <div className={`command-station ${activeGame.phase === "deploy" ? "deploy-command-station" : ""} ${mobileCommandExpanded ? "mobile-command-expanded" : ""} ${routineStompPrompt ? "routine-stomp-pending" : ""}`}>
          <div id="mobile-record-slot" className="mobile-record-slot" />
          <button type="button" className="mobile-command-toggle" aria-label={mobileCommandExpanded ? "Collapse player record and commands" : `Open ${playerRecordMonster.name} player record`} aria-expanded={mobileCommandExpanded} aria-controls="mobile-record-slot mobile-command-details" onClick={() => setMobileCommandExpanded((expanded) => !expanded)}>
            <span className="record-medallion command-medallion" data-branch={commandMedallionBranch} style={{ background: `linear-gradient(#182725,#182725) padding-box, conic-gradient(#e6cc83 ${commandMedallionHealthPercent}%,#45544b 0) border-box` }}>
              <img src={`/assets/monsters/portraits/${monsterAssetSlug(commandMedallionPlayer.name)}.webp`} alt="" />
              <b>{commandMedallionPlayer.health}</b>
              <i className="record-branch-mark" aria-hidden="true" title={commandMedallionBranch}>{BRANCH_MARK[commandMedallionBranch]}</i>
            </span>
            <span><strong>{soloOtherPlayerTurn ? playerRecordMonster.name : commandPieceName}</strong><small>{commandMedallionSummary}</small></span>
            <b aria-hidden="true">{mobileCommandExpanded ? "⌄" : "⌃"}</b>
          </button>
          {activeGame.phase === "move" && <MovementChecklist game={activeGame} canAct={canAct}
            selectedUnitId={selectedUnitId} movableUnitIds={selectableUnitIds} monsterCanMove={legalPaths.length > 0}
            onSelect={(unitId) => {
              setGamePanelOpen(false); setSelectedUnitId(unitId); setSelectedPath([]); setSelectedUnitPath([]); setHoveredPath([]);
              const location = unitId ? activeGame.units.find((unit) => unit.id === unitId)?.location : activePlayer.location;
              if (location && isHexKey(location)) setFocusedHexKey(location);
            }}
            onEnd={() => void runCommand({ type: "pass-move" })}
          />}
          {activeGame.phase === "move" && <LaserFenceControls game={activeGame} cardOwnerIndex={laserFenceOwnerIndex} canUse={canUseLaserFence} runCommand={runCommand} getLocationName={(key) => getLocation(key)?.name ?? key} />}
          {activeGame.pendingChopperLift && <ChopperLiftChoiceControls game={activeGame} canChoose={canChooseChopperLift} runCommand={runCommand} getLocationName={(key) => getLocation(key)?.name ?? key} />}
          <div className="board-action-bar">
            {soloBotTurn ? <ActionDock
              label={followBotTurns ? "Stop following" : "Follow bot"}
              contextLabel="BOT TURN"
              guidance={followBotTurns ? `Camera follows ${activePlayer.name} until your turn.` : `The board stays on your monster. Follow ${activePlayer.name} if you want.`}
              onPrimary={() => setFollowBotTurns((following) => !following)}
              canAct
              pressed={followBotTurns}
              onAction={runBoardAction}
            /> : activeGame.phase === "move" ? <ActionDock
              label={actionDock.command?.type === "move" || actionDock.command?.type === "move-unit" ? "Confirm move" : actionDock.label}
              contextLabel={`Move · ${remainingMovementOrders} ${remainingMovementOrders === 1 ? "order" : "orders"} remaining`}
              guidance={actionDock.command?.type === "move" || actionDock.command?.type === "move-unit" ? "Route ready to confirm." : actionDock.label === "Next piece" ? "Select a military piece or continue." : actionDock.command?.type === "pass-move" ? "All movement orders are resolved." : "Choose a destination or hold."}
              command={actionDock.command ?? (actionDock.label === "Next piece" || actionDock.label === "Choose another piece" ? undefined : (selectedUnitId ? selectableUnitIds.has(selectedUnitId) : legalPaths.length > 0) ? { type: "stay-piece", pieceId: selectedUnitId ?? activePlayer.id } : { type: "pass-move" })}
              onPrimary={actionDock.label === "Next piece" || actionDock.label === "Choose another piece" ? selectNextMovableUnit : undefined}
              canAct={canAct} unavailableReason={unavailableReason} onAction={runBoardAction}
            /> : <ActionDock contextLabel={activeGame.phase} guidance={readOnlyFightView ? "Open a read-only view of the current battles." : activeGame.phase === "deploy" ? "Choose a military action." : actionDock.command ? "Ready to continue." : "Choose an option in the attached tab."}
              onPrimary={!actionDock.command || readOnlyFightView ? (event) => { if (activeGame.phase === "deploy") { openMilitarySheet(); return; } if (activeGame.phase === "fight") { fightReturnFocusRef.current = event.currentTarget; setFightBaselineEventId(lastBattleEvent?.id); setFightOverlayOpen(true); return; } if (activeGame.phase === "move" && selectableUnitIds.size) { selectNextMovableUnit(); return; } const context = document.querySelector<HTMLDetailsElement>("#phase-command-context"); if (context) { context.open = true; context.querySelector<HTMLElement>("button:not(:disabled)")?.focus(); } } : undefined}
              label={readOnlyFightView ? "Watch fight" : actionDock.label} canAct={canAct || readOnlyFightView} command={actionDock.command} unavailableReason={unavailableReason} onAction={runBoardAction} />}
          </div>
          <div id="mobile-command-details" className="bottom-context-dock">
          <TrophyChoicePanel
            game={activeGame}
            canAct={canAct}
            onChoose={(unitId) => void runCommand({ type: "resolve-encounter", trophyUnitId: unitId })}
          />
          {activeGame.phase === "deploy" ? null : activeGame.phase === "move" ? <details className="piece-context-tab" key={selectedUnitId ?? activePlayer.id}>
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
                canUseMutation={canUseMutation}
                canUseLaserFence={canUseLaserFence}
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
              <ChallengeActions onOpen={() => setChallengeDuelOpen(true)} activeGame={activeGame} />
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
          <div id="turn-hud-body" hidden={!gamePanelVisible}>
          {setupComplete && <>
            <TurnProgress game={activeGame} />
            <MatchStatus game={activeGame} action={action} />
          </>}
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
              lastAtomicRecovery={lastRecoveryEvent?.detail.atomicRecovery === true}
            />
            <ActionResolutionFeedback label={acceptedActionFeedback?.label} animationKey={acceptedActionFeedback?.key} />
            <BlondeLureActions
              game={activeGame}
              canAct={canAct}
              runCommand={runCommand}
              getLocationName={(key) => getLocation(key)?.name ?? key}
            />
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
            canUseMutation={canUseMutation}
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
              rolls={challengeAttacks.length ? challengeAttacks.map(attack => attack.roll) : challengeRolls}
              attacks={challengeAttacks}
              game={activeGame}
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
          <LogPanel eventLog={eventLog} log={log} participants={room?.participants ?? []} />
          </details>
          </div>
        </aside>
      </section>
      {setupSheetOpen && canSetup && setupPreview && setupSeat?.branch && <MilitarySheet
        branch={setupSeat.branch} game={setupPreview} choices={setupChoices} canAct={canSetup}
        onClose={() => setSetupSheetOpen(false)}
        onSelect={(choice) => { setSetupPieceId(choice.id); setSetupSheetOpen(false); setFocusedHexKey(choice.destinations[0]); }}
      />}
      {militarySheetOpen && canAct && activeGame.phase === "deploy" && <MilitarySheet initialSheet={militaryInitialSheet} canAct={canAct} runCommand={(command) => { if (command.type === "draw-research") captureResearchReturnFocus(); setMilitarySheetOpen(false); return runCommand(command); }} game={activeGame} branch={activeBranch} choices={militaryChoices} onClose={() => setMilitarySheetOpen(false)} onSelect={(choice) => {
        setDeploymentPieceId(choice.id);
        setMilitarySheetOpen(false);
        setFocusedHexKey(choice.destinations[0]);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-hex-key="${choice.destinations[0]}"]`)?.focus({ preventScroll: true }));
      }} />}
      {challengeDuelOpen && activeGame.challenge?.active && <ChallengeArena game={activeGame} canAct={canAct} canUseMutation={canUseMutation} playerIndex={online ? participant?.playerIndex : undefined} runCommand={runCommand} error={error} onClose={() => setChallengeDuelOpen(false)} />}
      <FightResolutionPanel open={fightOverlayOpen} returnFocusTo={fightReturnFocusRef.current} returnFocusFallbackTo={actionHeadingRef.current} onClose={() => setFightOverlayOpen(false)} game={activeGame} canAct={canAct} pendingBattle={pendingBattle} pendingAttackTarget={pendingAttackTarget} event={lastBattleEvent?.id !== fightBaselineEventId ? lastBattleEvent : undefined} onChooseTarget={(unitId, battleId, spendInfamy) => { void runCommand({ type: "resolve-fight", battleId, targetUnitId: unitId, spendInfamy }); }} controls={<>
        <PhaseActions hideAttackTargets activeGame={activeGame} onOpenMilitarySheet={openMilitarySheet} canAct={canAct} canUseMutation={canUseMutation} canUseLaserFence={canUseLaserFence} runCommand={runCommand} getLocationName={(key) => getLocation(key)?.name ?? key} pendingAttackTarget={pendingAttackTarget} pendingAttackPrompt={pendingAttackPrompt} pendingBattle={pendingBattle} pendingBattleDecision={pendingBattleDecision} canSpendInfamyOnPendingBattle={canSpendInfamyOnPendingBattle} retreatChoices={retreatChoices} setRetreatChoices={setRetreatChoices} />
        {error && <p role="alert">{error}</p>}
      </>} />
      {researchReveal && <ResolutionStage title="Research" eyebrow="MILITARY / RESEARCH DIVISION" variant="research" returnFocusTo={researchReturnFocusRef.current} returnFocusFallbackTo={researchReturnFocusFallbackRef.current} onClose={() => setResearchReveal(null)}><CardReveal key={researchReveal} cardId={researchReveal} kind="research" /></ResolutionStage>}
      <EncounterOverlay
        error={error}
        open={encounterOverlay.open}
        returnFocusTo={encounterReturnFocusRef.current}
        returnFocusFallbackTo={actionHeadingRef.current}
        canAct={canAct}
        pendingChoice={activeGame.pendingDecision?.type === "encounter-choice"}
        monsterName={activePlayer.name}
        locationName={activeLocation?.name ?? activePlayer.location}
        eventId={lastEncounterEvent?.id}
        baselineEventId={encounterBaselineEventId}
        effects={encounterEffects}
        rolls={encounterRolls}
        choices={encounterChoices}
        choiceSource={encounterChoiceSource}
        mutationDraws={encounterMutationDraws}
        mutationCardId={encounterMutationDraws.some((draw) => draw.cardDrawn) ? encounterRevealCard : undefined}
        onReveal={() => void runCommand({ type: "resolve-encounter" })}
        onChoice={(choice, opener) => void runCommand({ type: "resolve-encounter", choice }, opener)}
        onClose={encounterOverlay.close}
      />
      <BoardEventPlayback
        matchId={activeGame.matchId}
        events={activeGame.eventLog}
        monsters={activeGame.monsters}
        units={activeGame.units}
        board={activeBoard}
        enabled={online || soloMode || Boolean(routineStompPrompt) || routineStompEvent}
        botPlayback={soloMode}
        spectator={online && participant?.role !== "player"}
        viewerPlayerIndex={online ? participant?.playerIndex : soloMode ? 0 : activeGame.currentPlayer}
        reducedMotion={manualReducedMotion}
        routineStomp={routineStompPrompt}
        canResolveRoutineStomp={canAct}
        onResolveRoutineStomp={() => void runCommand({ type: "resolve-encounter" })}
        onResolveRoutineStompChoice={(choice) => void runCommand({ type: "resolve-encounter", choice })}
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
