export * from "./board.js";
export * from "./cards.js";
export * from "./setup.js";
import { buildBoardIndex, DEVELOPMENT_BOARD, DEVELOPMENT_LOCATIONS, FULL_HONEYCOMB_BOARD, hexKeyToLocationId, isHexKey, locationIdToHexKey, toDevelopmentSpaceKey, validateBoardDefinition, type BoardDefinition, type BoardFeature, type HexKey, type SpaceKey, type WaterClass } from "./board.js";
import { createCardDeckState, discardCard as discardCardFromDeck, drawCard as drawCardFromDeck, MILITARY_RESEARCH_CARD_IDS, MONSTER_MUTATION_CARD_IDS, type CardDeckState } from "./cards.js";
import { monsterDefinition, type MonsterMovement } from "./monsters.js";
import { BRANCH_DEPLOYMENT_DEFINITIONS, NATIONAL_GUARD_DEFINITIONS, UNIT_DEFINITIONS, type UnitDefinition, type UnitMovement } from "./units.js";
export { MONSTER_DEFINITIONS, monsterDefinition, type MonsterDefinition, type MonsterMovement } from "./monsters.js";
export { UNIT_DEFINITIONS, GIANT_UNIT_DEFINITIONS, NATIONAL_GUARD_DEFINITIONS, BRANCH_DEPLOYMENT_DEFINITIONS, type UnitDefinition, type GiantUnitDefinition, type NationalGuardDefinition, type BranchDeploymentDefinition, type UnitBranch, type UnitMovement } from "./units.js";
import { createSetup, developmentSetupDefinition, validateSetup, type SetupSeat, type SetupState } from "./setup.js";

export type Phase = "move" | "fight" | "encounter" | "deploy" | "challenge" | "game-over";
export type Branch = "Army" | "Navy" | "Air Force" | "Marines";
export type MilitaryUnitBranch = Branch | "National Guard";
export const MATCH_STATE_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_PLAYER_COUNTS = [2, 3, 4] as const;

export function stompMarkerCount(playerCount: number): number {
  if (playerCount === 2) return 14;
  if (playerCount === 3) return 17;
  if (playerCount === 4) return 20;
  throw new GameDomainError("INVALID_COMMAND_ENVELOPE", "A production match must have exactly 2, 3, or 4 players.");
}

export function assertSupportedPlayerCount(playerCount: number): asserts playerCount is 2 | 3 | 4 {
  stompMarkerCount(playerCount);
}

export interface Monster {
  id: string;
  name: string;
  health: number;
  /** Printed starting Health used when a disappeared monster returns to its lair. */
  startingHealth: number;
  maxHealth: number;
  move: number;
  movement: MonsterMovement;
  attacks: number;
  /** Development-fixture combat values; production values remain source-gated. */
  defense: number;
  damage: number;
  infamy: number;
  /** Canonical board hex key or an explicit off-board position. */
  location: SpaceKey;
}

export interface MilitaryUnit {
  id: string;
  branch: MilitaryUnitBranch;
  /** Source-backed unit record ID when this unit comes from the typed catalogue. */
  unitTypeId?: string;
  /** Development-fixture movement value; production values must come from verified unit records. */
  move: number;
  movement: UnitMovement;
  /** Development-fixture combat values; production values remain source-gated. */
  attacks: number;
  damage: number;
  ownerPlayer?: number;
  health: number;
  defense: number;
  /** Canonical board hex key or an explicit off-board position. */
  location: SpaceKey;
}

/**
 * Neutral National Guard record inventory is explicit; statistics, placement,
 * and redeployment remain source-gated. Guard Commander control is the one
 * source-backed card exception implemented at the command boundary.
 */
export interface NationalGuardInventory {
  readonly branch: "National Guard";
  readonly control: "neutral";
  readonly location: "record-tile";
  readonly quantity: number;
  readonly unitIds: readonly string[];
  readonly statistics: "source-gated";
}

function expectedNationalGuardUnitIds(): string[] {
  return NATIONAL_GUARD_DEFINITIONS.flatMap((definition) => Array.from({ length: definition.quantity }, (_, index) => `${definition.id}-${index + 1}`));
}

/** Validate the source-backed neutral Guard record inventory without enabling its rules effects. */
export function sourceNationalGuardInventoryErrors(inventory: Pick<NationalGuardInventory, "quantity" | "unitIds">): string[] {
  const expected = expectedNationalGuardUnitIds();
  const actual = [...inventory.unitIds];
  const errors: string[] = [];
  if (inventory.quantity !== expected.length) errors.push(`National Guard quantity mismatch: expected ${expected.length}, got ${inventory.quantity}`);
  if (actual.length !== expected.length) errors.push(`National Guard ID count mismatch: expected ${expected.length}, got ${actual.length}`);
  const expectedCounts = new Map(expected.map((id) => [id, 1]));
  const actualCounts = new Map<string, number>();
  for (const id of actual) actualCounts.set(id, (actualCounts.get(id) ?? 0) + 1);
  for (const id of new Set([...expected, ...actual])) {
    const expectedCount = expectedCounts.get(id) ?? 0;
    const actualCount = actualCounts.get(id) ?? 0;
    if (expectedCount !== actualCount) errors.push(`National Guard inventory mismatch for ${id}: expected ${expectedCount}, got ${actualCount}`);
  }
  return errors;
}

export interface PlayerState {
  readonly id: string;
  readonly seat: number;
  /** Face-up cards owned by this player; effects remain source-gated until implemented. */
  mutationCardIds: string[];
  researchCardIds: string[];
}

export interface GameLogEntry {
  readonly id: string;
  readonly actorId?: string;
  readonly action: string;
  readonly outcome: string;
  readonly detail: Record<string, unknown>;
}

export interface GameState {
  schemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
  /** Stable match identity; production room creation should inject its own ID. */
  matchId: string;
  boardId: string;
  boardVersion: number;
  boardContentHash: string;
  rulesetVersion: string;
  currentPlayer: number;
  players: PlayerState[];
  phase: Phase;
  round: number;
  stompMarkers: number;
  stompedLocations: HexKey[];
  winnerPlayer?: number;
  victoryType?: "development-stomp-exhaustion" | "development-board-exhaustion" | "monster-challenge" | "america-saved" | "concession";
  rng: { seed: number; cursor: number };
  nextUnitSequence: number;
  decks: DeckState;
  pendingBattles: PendingBattle[];
  /** The authoritative decision currently required before the next phase transition. */
  pendingDecision?: PendingDecision;
  /** Target choice awaiting the active monster player before a multi-target battle resolves. */
  pendingAttackTarget?: PendingAttackTarget;
  /** Resumable normal-battle sequence used while later multi-target attacks await a choice. */
  pendingCombat?: PendingCombat;
  pendingEncounterChoice?: PendingEncounterChoice;
  pendingTrophyChoice?: PendingTrophyChoice;
  /** Source-backed Monster Challenge declaration and duel state. Giant-unit rules remain source-gated. */
  challenge?: MonsterChallengeState;
  /** Monster/site keys that have already consumed their one Mutation-site use. */
  mutationSiteUses: Record<string, string[]>;
  pendingRetreat?: PendingRetreat;
  /** A retreat consumes the Encounter step for the active monster. */
  encounterSuppressed?: boolean;
  monsters: Monster[];
  units: MilitaryUnit[];
  /** Permanently removed unit IDs; ordinary destruction returns a unit to record-tile instead. */
  removedUnitIds: string[];
  nationalGuard: NationalGuardInventory;
  log: string[];
  eventLog: GameLogEntry[];
  movedPieceIds: string[];
  /** Source-backed deployment allowance bookkeeping for the current Deploy step. */
  deploymentsThisTurn: number;
  deploymentDestinations: HexKey[];
  /** Development/setup metadata only; production component definitions remain source-gated. */
  setupAssignments?: readonly SetupSeat[];
  /** Present only for rooms that are still completing the development setup flow. */
  setupState?: SetupState;
}

export interface PendingEncounterChoice {
  readonly playerIndex: number;
  readonly location: HexKey;
  readonly choices: readonly ("health" | "infamy")[];
}

export interface PendingTrophyChoice {
  readonly playerIndex: number;
  readonly location: HexKey;
  readonly branch: Branch;
  readonly unitIds: readonly string[];
}

export interface MonsterChallengeState {
  readonly declared: boolean;
  readonly active: boolean;
  readonly challengerMonsterId?: string;
  readonly declarationPlayerIndex: number;
  readonly pendingStartPlayerIndex: number;
  readonly startAtEndOfTurn?: boolean;
  readonly opponentMonsterId?: string;
  readonly weighInHealth: Readonly<Record<string, number>>;
  readonly defeatedMonsterIds: readonly string[];
}

export type PendingDecision =
  | Readonly<{ type: "monster-movement"; playerIndex: number; pieceId: string }>
  | Readonly<{ type: "battle-resolution"; playerIndex: number; battleId: string }>
  | Readonly<{ type: "attack-target"; playerIndex: number; battleId: string; attackerId: string; targetIds: readonly string[]; round?: number; attackNumber?: number; attackTotal?: number }>
  | Readonly<{ type: "retreat"; playerIndex: number; battleId: string; unitIds: readonly string[] }>
  | Readonly<{ type: "encounter-resolution"; playerIndex: number; location: HexKey }>
  | Readonly<{ type: "encounter-choice"; playerIndex: number; location: HexKey; choices: readonly ("health" | "infamy")[] }>
  | Readonly<{ type: "trophy-choice"; playerIndex: number; location: HexKey; branch: Branch; unitIds: readonly string[] }>
  | Readonly<{ type: "deployment"; playerIndex: number }>
  | Readonly<{ type: "challenge-opponent"; playerIndex: number; challengerMonsterId: string; opponentIds: readonly string[] }>
  | Readonly<{ type: "challenge-resolution"; playerIndex: number; challengerMonsterId: string; opponentMonsterId: string }>
  | Readonly<{ type: "game-over"; playerIndex: number; victoryType: NonNullable<GameState["victoryType"]> }>;

export interface PendingBattle {
  id: string;
  monsterId: string;
  location: HexKey;
  militaryUnitIds: string[];
}

export interface PendingAttackTarget {
  readonly battleId: string;
  readonly attackerId: string;
  readonly targetIds: readonly string[];
  readonly round?: number;
  readonly attackNumber?: number;
  readonly attackTotal?: number;
  readonly spendInfamy?: number;
}

export interface PendingCombat {
  readonly battleId: string;
  readonly monsterId: string;
  readonly round: 1 | 2;
  readonly monsterAttackIndex: number;
  readonly preMonsterResolved: boolean;
  readonly spendInfamy: number;
  readonly rolls: readonly number[];
  readonly attacks: readonly BattleAttack[];
  readonly destroyedUnitIds: readonly string[];
}

export interface PendingRetreat {
  readonly battleId: string;
  readonly unitIds: readonly string[];
  readonly options: Readonly<Record<string, readonly HexKey[]>>;
  /** Player whose units forced the retreat and therefore earns Research. */
  readonly researchPlayerIndex?: number;
}

function retreatResearchPlayer(state: GameState, unitIds: readonly string[]): number | undefined {
  return unitIds
    .map((unitId) => state.units.find((unit) => unit.id === unitId)?.ownerPlayer)
    .find((ownerPlayer) => ownerPlayer === state.currentPlayer);
}

export interface SpaceOccupants {
  monsters: Monster[];
  units: MilitaryUnit[];
}

/**
 * Validate conservation and cross-reference invariants for the source-counted
 * regular catalogue. National Guard record quantities are explicit, while
 * giant quantities and Guard control/placement remain source-gated.
 */
export function validateInventoryAccounting(state: Pick<GameState, "monsters" | "units" | "nationalGuard" | "removedUnitIds" | "pendingBattles" | "movedPieceIds" | "pendingAttackTarget" | "pendingCombat">): string[] {
  const errors: string[] = [];
  errors.push(...sourceUnitInventoryErrors(state.units));
  errors.push(...sourceNationalGuardInventoryErrors(state.nationalGuard));
  const monsterIds = state.monsters.map((monster) => monster.id);
  const unitIds = state.units.map((unit) => unit.id);
  const allPieceIds = [...monsterIds, ...unitIds];
  const duplicates = [...new Set(allPieceIds.filter((id, index) => allPieceIds.indexOf(id) !== index))];
  if (duplicates.length > 0) errors.push(`duplicate piece IDs: ${duplicates.join(", ")}`);
  const overlap = monsterIds.filter((id) => unitIds.includes(id));
  if (overlap.length > 0) errors.push(`monster/unit ID collision: ${overlap.join(", ")}`);
  const guardIds = [...state.nationalGuard.unitIds];
  const guardDuplicates = guardIds.filter((id, index) => guardIds.indexOf(id) !== index);
  if (guardDuplicates.length > 0) errors.push(`duplicate National Guard IDs: ${[...new Set(guardDuplicates)].join(", ")}`);
  const guardOverlap = guardIds.filter((id) => allPieceIds.includes(id) && !state.units.some((unit) => unit.id === id && unit.branch === "National Guard"));
  if (guardOverlap.length > 0) errors.push(`National Guard ID collision: ${guardOverlap.join(", ")}`);
  const removedDuplicates = state.removedUnitIds.filter((id, index) => state.removedUnitIds.indexOf(id) !== index);
  if (removedDuplicates.length > 0) errors.push(`duplicate removed unit IDs: ${[...new Set(removedDuplicates)].join(", ")}`);
  const removedSet = new Set(state.removedUnitIds);
  for (const removedId of removedSet) {
    const unit = state.units.find((candidate) => candidate.id === removedId);
    if (!unit) errors.push(`removed unit references missing unit ${removedId}`);
    else if (unit.location !== "permanently-removed") errors.push(`removed unit ${removedId} is not on the permanently-removed position`);
  }
  for (const unit of state.units) {
    if (unit.location === "permanently-removed" && !removedSet.has(unit.id)) errors.push(`permanently-removed unit ${unit.id} is missing from removedUnitIds`);
  }
  for (const piece of [...state.monsters, ...state.units]) {
    if (!toDevelopmentSpaceKey(piece.location)) errors.push(`unknown position for piece ${piece.id}: ${piece.location}`);
  }
  for (const battle of state.pendingBattles) {
    if (!monsterIds.includes(battle.monsterId)) errors.push(`battle ${battle.id} references missing monster ${battle.monsterId}`);
    const duplicateTargets = battle.militaryUnitIds.filter((id, index) => battle.militaryUnitIds.indexOf(id) !== index);
    if (duplicateTargets.length > 0) errors.push(`battle ${battle.id} has duplicate military targets: ${[...new Set(duplicateTargets)].join(", ")}`);
    for (const unitId of battle.militaryUnitIds) if (!unitIds.includes(unitId)) errors.push(`battle ${battle.id} references non-military target ${unitId}`);
    if (!state.monsters.some((monster) => monster.id === battle.monsterId && monster.location === battle.location)) errors.push(`battle ${battle.id} location does not match its monster`);
  }
  if (state.pendingAttackTarget) {
    const pendingTarget = state.pendingAttackTarget;
    const battle = state.pendingBattles.find((candidate) => candidate.id === pendingTarget.battleId);
    if (!battle) errors.push(`pending attack target references missing battle ${pendingTarget.battleId}`);
    if (!monsterIds.includes(pendingTarget.attackerId)) errors.push(`pending attack target references missing monster ${pendingTarget.attackerId}`);
    if (battle && battle.monsterId !== pendingTarget.attackerId) errors.push(`pending attack target attacker does not match battle ${battle.id}`);
    if (pendingTarget.spendInfamy !== undefined && (!Number.isInteger(pendingTarget.spendInfamy) || pendingTarget.spendInfamy < 0)) errors.push(`pending attack target has invalid Infamy spend ${pendingTarget.spendInfamy}`);
    const duplicateTargets = pendingTarget.targetIds.filter((id, index) => pendingTarget.targetIds.indexOf(id) !== index);
    if (duplicateTargets.length > 0) errors.push(`pending attack target has duplicate military targets: ${[...new Set(duplicateTargets)].join(", ")}`);
    for (const targetId of pendingTarget.targetIds) {
      if (!unitIds.includes(targetId)) errors.push(`pending attack target references non-military target ${targetId}`);
      if (battle && !battle.militaryUnitIds.includes(targetId)) errors.push(`pending attack target ${targetId} is not in battle ${battle.id}`);
    }
  }
  if (state.pendingCombat) {
    const pendingCombat = state.pendingCombat;
    const battle = state.pendingBattles.find((candidate) => candidate.id === pendingCombat.battleId);
    if (!battle) errors.push(`pending combat references missing battle ${pendingCombat.battleId}`);
    if (!monsterIds.includes(pendingCombat.monsterId)) errors.push(`pending combat references missing monster ${pendingCombat.monsterId}`);
    if (battle && battle.monsterId !== pendingCombat.monsterId) errors.push(`pending combat monster does not match battle ${battle.id}`);
    if (!Number.isInteger(pendingCombat.round) || (pendingCombat.round !== 1 && pendingCombat.round !== 2)) errors.push(`pending combat has invalid round ${pendingCombat.round}`);
    if (!Number.isInteger(pendingCombat.monsterAttackIndex) || pendingCombat.monsterAttackIndex < 0) errors.push(`pending combat has invalid monster attack index ${pendingCombat.monsterAttackIndex}`);
    if (!Number.isInteger(pendingCombat.spendInfamy) || pendingCombat.spendInfamy < 0) errors.push(`pending combat has invalid Infamy spend ${pendingCombat.spendInfamy}`);
  }
  for (const pieceId of state.movedPieceIds) if (!allPieceIds.includes(pieceId)) errors.push(`movement ledger references missing piece ${pieceId}`);
  return [...new Set(errors)];
}

function assertInventoryAccounting(state: Pick<GameState, "monsters" | "units" | "nationalGuard" | "removedUnitIds" | "pendingBattles" | "movedPieceIds" | "pendingAttackTarget" | "pendingCombat">): void {
  const errors = validateInventoryAccounting(state);
  if (errors.length > 0) throw new GameDomainError("ILLEGAL_COMMAND", `Inventory invariant failed: ${errors.join("; ")}`);
}

/** Occupancy is always derived from current piece positions; it is never persisted separately. */
export function occupantsAt(state: Pick<GameState, "monsters" | "units">, location: SpaceKey): SpaceOccupants {
  return {
    monsters: state.monsters.filter((monster) => monster.location === location),
    units: state.units.filter((unit) => unit.location === location),
  };
}

export interface DeckState {
  mutation: CardDeckState;
  research: CardDeckState;
}

export type GameCardDeck = keyof DeckState;

export interface GameCardDrawResolution {
  readonly state: GameState;
  readonly cardId?: string;
  readonly exhausted: boolean;
}

/** Draw and discard mutate only the authoritative deck state; card effects are separate. */
export function drawCardFromGame(state: GameState, deckName: GameCardDeck): GameCardDrawResolution {
  const result = drawCardFromDeck(state.decks[deckName]);
  const next = structuredClone(state);
  next.decks[deckName] = result.state;
  return { state: next, cardId: result.cardId, exhausted: result.exhausted };
}

export function discardCardFromGame(state: GameState, deckName: GameCardDeck, cardId: string): GameState {
  const next = structuredClone(state);
  next.decks[deckName] = discardCardFromDeck(next.decks[deckName], cardId);
  return next;
}

export type StateAudience = "internal" | "player" | "spectator";

/** Remove card identifiers from event details before they cross a projection boundary. */
export function redactCardIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCardIdentifiers);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cardId" && key !== "mutationCardId").map(([key, entry]) => [key, redactCardIdentifiers(entry)]));
}

/** Client projections never expose authoritative deck order or another player's hand. */
export function projectState(state: GameState, audience: StateAudience, viewerPlayerIndex?: number): GameState {
  if (audience === "internal") return structuredClone(state);
  const projected = structuredClone(state);
  projected.decks.mutation = { ...projected.decks.mutation, order: [], discard: [] };
  projected.decks.research = { ...projected.decks.research, order: [], discard: [] };
  projected.players = projected.players.map((player, index) => audience === "player" && index === viewerPlayerIndex
    ? player
    : { ...player, mutationCardIds: [], researchCardIds: [] });
  projected.eventLog = projected.eventLog.map((entry) => ({ ...entry, detail: redactCardIdentifiers(entry.detail) as Record<string, unknown> }));
  return projected;
}

function shuffledDeck(ids: readonly string[], seed: number): string[] {
  const deck = [...ids];
  let value = seed >>> 0;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    value = (Math.imul(value ^ (value >>> 16), 1664525) + 1013904223) >>> 0;
    const swapIndex = value % (index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

export type GameCommand =
  | { type: "move"; path: string[] }
  | { type: "move-unit"; unitId: string; path: string[] }
  | { type: "disappear-monster" }
  | { type: "pass-move" }
  | { type: "resolve-fight"; battleId?: string; spendInfamy?: number; targetUnitId?: string }
  | { type: "retreat"; destinations: Record<string, HexKey | "disappeared"> }
  | { type: "resolve-encounter"; choice?: "health" | "infamy"; trophyUnitId?: string }
  | { type: "deploy"; unitId?: string; destination?: HexKey }
  | { type: "redeploy"; unitId: string; destination?: HexKey }
  | { type: "draw-research" }
  | { type: "pass-deploy" }
  | { type: "challenge-opponent"; opponentMonsterId: string }
  | { type: "resolve-challenge" }
  | { type: "concede" }
  | { type: "advance" };

export const COMMAND_PROTOCOL_VERSION = 1;

export interface GameCommandEnvelope {
  actionId: string;
  actorId: string;
  expectedRevision: number;
  protocolVersion: number;
  command: GameCommand;
}

export type DomainErrorCode = "INVALID_COMMAND_ENVELOPE" | "UNSUPPORTED_PROTOCOL" | "STALE_REVISION" | "ILLEGAL_COMMAND";

export class GameDomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = "GameDomainError";
  }
}

export interface GameEventResult {
  state: GameState;
  eventType: string;
  eventPayload: Record<string, unknown>;
}

export interface CommandReceipt {
  actionId: string;
  actorId: string;
  revision: number;
  eventType: string;
}

export interface CommandResult extends GameEventResult {
  receipt: CommandReceipt;
}

/** Explicit one-time migration for discarded development snapshots that used location names. */
export function migrateGameState(input: GameState): GameState {
  const state = structuredClone(input) as GameState & { schemaVersion: number; stompedLocations: string[] };
  if (!state.matchId) state.matchId = `development-match-${state.rng?.seed ?? 0}`;
  if (!state.players) state.players = state.monsters.map((_, seat) => ({ id: `player-${seat + 1}`, seat, mutationCardIds: [], researchCardIds: [] }));
  state.players = state.players.map((player) => ({ ...player, mutationCardIds: Array.isArray(player.mutationCardIds) ? player.mutationCardIds : [], researchCardIds: Array.isArray(player.researchCardIds) ? player.researchCardIds : [] }));
  if (!state.nationalGuard || typeof state.nationalGuard.quantity !== "number" || state.nationalGuard.unitIds.length !== state.nationalGuard.quantity) {
    state.nationalGuard = createNationalGuardInventory();
  }
  if (!Array.isArray(state.removedUnitIds)) state.removedUnitIds = [];
  if (!Array.isArray(state.movedPieceIds)) state.movedPieceIds = [];
  if (typeof state.deploymentsThisTurn !== "number") state.deploymentsThisTurn = 0;
  if (!Array.isArray(state.deploymentDestinations)) state.deploymentDestinations = [];
  if (!Array.isArray(state.pendingBattles)) state.pendingBattles = [];
  if (state.challenge && (!Array.isArray(state.challenge.defeatedMonsterIds) || (state.challenge.challengerMonsterId !== undefined && typeof state.challenge.challengerMonsterId !== "string"))) state.challenge = undefined;
  if (!state.mutationSiteUses || typeof state.mutationSiteUses !== "object") state.mutationSiteUses = {};
  if (typeof state.encounterSuppressed !== "boolean") state.encounterSuppressed = false;
  state.monsters = state.monsters.map((monster) => {
    const definition = monsterDefinition(monster.name.toLowerCase());
    return { ...monster, startingHealth: monster.startingHealth ?? definition?.startingHealth ?? monster.health, movement: monster.movement ?? definition?.movement ?? "land-lake-sea", defense: monster.defense ?? 4, damage: monster.damage ?? 1 };
  });
  state.units = state.units.map((unit) => ({ ...unit, movement: unit.movement ?? UNIT_DEFINITIONS.find((definition) => definition.id === unit.unitTypeId)?.movement ?? "land-only", attacks: unit.attacks ?? 1, damage: unit.damage ?? 1 }));
  state.decks = {
    mutation: { ...state.decks.mutation, discard: Array.isArray(state.decks.mutation.discard) ? state.decks.mutation.discard : [], exhausted: typeof state.decks.mutation.exhausted === "boolean" ? state.decks.mutation.exhausted : state.decks.mutation.drawIndex >= state.decks.mutation.order.length },
    research: { ...state.decks.research, discard: Array.isArray(state.decks.research.discard) ? state.decks.research.discard : [], exhausted: typeof state.decks.research.exhausted === "boolean" ? state.decks.research.exhausted : state.decks.research.drawIndex >= state.decks.research.order.length },
  };
  // Recompute this derived command boundary on every migration so old snapshots
  // and test/transport copies cannot retain a decision that disagrees with phase
  // or current occupancy.
  state.pendingDecision = pendingDecisionForState(state);
  if (state.schemaVersion === MATCH_STATE_SCHEMA_VERSION) return state;
  if (state.schemaVersion !== 1) throw new GameDomainError("INVALID_COMMAND_ENVELOPE", `Unsupported match-state schema: ${String(state.schemaVersion)}.`);
  const normalize = (value: string): SpaceKey => {
    const normalized = toDevelopmentSpaceKey(value);
    if (!normalized) throw new GameDomainError("INVALID_COMMAND_ENVELOPE", `Cannot migrate unknown development space: ${value}.`);
    return normalized;
  };
  state.monsters = state.monsters.map((monster) => ({ ...monster, defense: monster.defense ?? 4, damage: monster.damage ?? 1, location: normalize(monster.location) }));
  state.units = state.units.map((unit) => ({ ...unit, attacks: unit.attacks ?? 1, damage: unit.damage ?? 1, location: normalize(unit.location) }));
  state.pendingBattles = state.pendingBattles.map((battle) => ({ ...battle, location: normalize(battle.location) as HexKey }));
  state.stompedLocations = state.stompedLocations.map((location) => normalize(location) as HexKey);
  state.schemaVersion = MATCH_STATE_SCHEMA_VERSION;
  return state;
}

function pendingDecisionForState(state: Pick<GameState, "phase" | "currentPlayer" | "monsters" | "pendingBattles" | "winnerPlayer" | "victoryType" | "pendingRetreat" | "pendingEncounterChoice" | "pendingTrophyChoice" | "pendingAttackTarget" | "challenge">): PendingDecision | undefined {
  if (state.pendingRetreat) return { type: "retreat", playerIndex: state.currentPlayer, battleId: state.pendingRetreat.battleId, unitIds: state.pendingRetreat.unitIds };
  if (state.pendingTrophyChoice) return { type: "trophy-choice", playerIndex: state.pendingTrophyChoice.playerIndex, location: state.pendingTrophyChoice.location, branch: state.pendingTrophyChoice.branch, unitIds: state.pendingTrophyChoice.unitIds };
  if (state.pendingAttackTarget) return {
    type: "attack-target",
    playerIndex: state.currentPlayer,
    battleId: state.pendingAttackTarget.battleId,
    attackerId: state.pendingAttackTarget.attackerId,
    targetIds: state.pendingAttackTarget.targetIds,
    ...(state.pendingAttackTarget.round === undefined ? {} : { round: state.pendingAttackTarget.round }),
    ...(state.pendingAttackTarget.attackNumber === undefined ? {} : { attackNumber: state.pendingAttackTarget.attackNumber }),
    ...(state.pendingAttackTarget.attackTotal === undefined ? {} : { attackTotal: state.pendingAttackTarget.attackTotal }),
  };
  if (state.phase === "move") {
    const pieceId = state.monsters[state.currentPlayer]?.id;
    return pieceId ? { type: "monster-movement", playerIndex: state.currentPlayer, pieceId } : undefined;
  }
  if (state.phase === "fight") {
    const battle = state.pendingBattles[0];
    return battle ? { type: "battle-resolution", playerIndex: state.currentPlayer, battleId: battle.id } : undefined;
  }
  if (state.phase === "encounter") {
    const location = state.monsters[state.currentPlayer]?.location;
    if (state.pendingEncounterChoice) return { type: "encounter-choice", playerIndex: state.currentPlayer, location: state.pendingEncounterChoice.location, choices: state.pendingEncounterChoice.choices };
    return isHexKey(location) ? { type: "encounter-resolution", playerIndex: state.currentPlayer, location } : undefined;
  }
  if (state.phase === "deploy") return { type: "deployment", playerIndex: state.currentPlayer };
  if (state.phase === "challenge" && state.challenge?.active) {
    const challenger = state.monsters.find((monster) => monster.id === state.challenge?.challengerMonsterId);
    if (!challenger) return undefined;
    const opponentIds = state.monsters
      .filter((monster) => monster.id !== challenger.id && !state.challenge?.defeatedMonsterIds.includes(monster.id) && monster.location !== "hollywood")
      .map((monster) => monster.id);
    if (state.challenge.opponentMonsterId) return { type: "challenge-resolution", playerIndex: state.currentPlayer, challengerMonsterId: challenger.id, opponentMonsterId: state.challenge.opponentMonsterId };
    return { type: "challenge-opponent", playerIndex: state.currentPlayer, challengerMonsterId: challenger.id, opponentIds };
  }
  if (state.phase === "game-over" && state.winnerPlayer !== undefined && state.victoryType) {
    return { type: "game-over", playerIndex: state.winnerPlayer, victoryType: state.victoryType };
  }
  return undefined;
}

export function createNationalGuardInventory(): NationalGuardInventory {
  const unitIds = expectedNationalGuardUnitIds();
  return {
    branch: "National Guard",
    control: "neutral",
    location: "record-tile",
    quantity: unitIds.length,
    unitIds,
    statistics: "source-gated",
  };
}

/** Backwards-compatible alias for the explicitly non-production development fixture. */
export const locations = DEVELOPMENT_LOCATIONS;
const developmentBoardIndex = buildBoardIndex(DEVELOPMENT_BOARD);

function developmentKey(value: string): HexKey {
  const key = locationIdToHexKey(value) ?? (toDevelopmentSpaceKey(value) as HexKey | undefined);
  if (!key || !DEVELOPMENT_BOARD.hexes[key]) throw new GameDomainError("ILLEGAL_COMMAND", `Unknown development board space: ${value}.`);
  return key;
}

function canonicalPath(path: readonly string[]): HexKey[] | undefined {
  try {
    return path.map((space) => developmentKey(space));
  } catch {
    return undefined;
  }
}

const developmentMonsterOrder = ["zorb", "tomanagi", "konk", "megaclaw", "toxicor", "gargantis"] as const;
export const monsters = developmentMonsterOrder.map((id, i) => {
  const definition = monsterDefinition(id)!;
  return {
  id: `monster-${i + 1}`, name: definition.name, health: definition.startingHealth, startingHealth: definition.startingHealth, maxHealth: 40, move: definition.move, movement: definition.movement, attacks: definition.attacks, defense: definition.defense, damage: definition.damage, infamy: 0, location: developmentKey(i % 2 ? "seattle" : "los-angeles")
  };
});

const developmentUnitRosterSeed: readonly { branch: Branch; definition: UnitDefinition; location: string }[] = [
  { branch: "Army", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "army-tank")!, location: "denver" },
  { branch: "Army", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "army-missile-launcher")!, location: "denver" },
  { branch: "Navy", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "navy-fighter")!, location: "chicago" },
  { branch: "Navy", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "navy-nuclear-submarine")!, location: "chicago" },
  { branch: "Air Force", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "air-force-fighter")!, location: "new-york" },
  { branch: "Air Force", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "air-force-cruise-missile")!, location: "new-york" },
  { branch: "Marines", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "marines-fighter")!, location: "dallas" },
  { branch: "Marines", definition: UNIT_DEFINITIONS.find((unit) => unit.id === "marines-rocket-launcher")!, location: "dallas" },
];

/** Complete source-counted regular-unit inventory for the development fixture.
 * Additional copies remain on their record tiles because the nine-location
 * board does not yet contain verified bases for every branch. */
const developmentUnitRoster: readonly { branch: Branch; definition: UnitDefinition; location: string }[] = [
  ...developmentUnitRosterSeed,
  ...UNIT_DEFINITIONS.flatMap((definition) => {
    const branch: Branch = definition.id.startsWith("army-")
      ? "Army"
      : definition.id.startsWith("navy-")
        ? "Navy"
        : definition.id.startsWith("air-force-")
          ? "Air Force"
          : "Marines";
    return Array.from({ length: definition.quantity - 1 }, () => ({ branch, definition, location: "record-tile" }));
  }),
];

export function sourceUnitInventoryErrors(units: readonly Pick<MilitaryUnit, "unitTypeId">[]): string[] {
  const counts = new Map<string, number>();
  for (const unit of units) if (unit.unitTypeId) counts.set(unit.unitTypeId, (counts.get(unit.unitTypeId) ?? 0) + 1);
  return UNIT_DEFINITIONS.flatMap((definition) => {
    const actual = counts.get(definition.id) ?? 0;
    return actual === definition.quantity ? [] : [`${definition.id}: expected ${definition.quantity}, found ${actual}`];
  });
}

export function createGame(playerCount = 2, seed = 0, matchId = `development-match-${playerCount}-${seed >>> 0}`): GameState {
  const stompMarkers = stompMarkerCount(playerCount);
  const active = monsters.slice(0, Math.max(2, Math.min(playerCount, 4))).map((monster, i) => ({ ...monster, location: developmentKey(i === 0 ? "los-angeles" : "seattle") }));
  const state: GameState = {
    schemaVersion: MATCH_STATE_SCHEMA_VERSION, matchId, boardId: DEVELOPMENT_BOARD.id, boardVersion: DEVELOPMENT_BOARD.version, boardContentHash: DEVELOPMENT_BOARD.contentHash, rulesetVersion: DEVELOPMENT_BOARD.rulesetVersion,
    currentPlayer: (seed >>> 0) % active.length, players: active.map((_, seat) => ({ id: `player-${seat + 1}`, seat, mutationCardIds: [], researchCardIds: [] })), phase: "move", round: 1, stompMarkers, stompedLocations: [],
    rng: { seed: seed >>> 0, cursor: 0 }, nextUnitSequence: developmentUnitRoster.length,
    decks: { mutation: createCardDeckState(shuffledDeck(MONSTER_MUTATION_CARD_IDS, seed ^ 0x4d555441)), research: createCardDeckState(shuffledDeck(MILITARY_RESEARCH_CARD_IDS, seed ^ 0x52455345)) },
    pendingBattles: [], pendingDecision: { type: "monster-movement", playerIndex: (seed >>> 0) % active.length, pieceId: active[(seed >>> 0) % active.length].id }, encounterSuppressed: false, movedPieceIds: [], deploymentsThisTurn: 0, deploymentDestinations: [], mutationSiteUses: {},
    monsters: active,
    nationalGuard: createNationalGuardInventory(),
    units: developmentUnitRoster.map(({ branch, definition, location }, index) => ({
      id: `${Math.floor(index / 2)}-${index % 2}`, branch, unitTypeId: definition.id, move: definition.move, movement: definition.movement, attacks: definition.attacks, damage: Array.isArray(definition.damage) ? definition.damage[0] : definition.damage, ownerPlayer: Math.floor(index / 2) % active.length, health: 1, defense: Array.isArray(definition.defense) ? definition.defense[0] : definition.defense, location: location === "record-tile" ? "record-tile" : developmentKey(location)
    })),
    removedUnitIds: [],
    log: ["Game ready. Choose a destination for the active monster."], eventLog: []
  };
  const sourceInventoryErrors = sourceUnitInventoryErrors(state.units);
  if (sourceInventoryErrors.length > 0) throw new Error(`Source unit inventory is incomplete: ${sourceInventoryErrors.join("; ")}`);
  assertInventoryAccounting(state);
  return state;
}

/** Create a room snapshot with the explicit development setup state attached. */
export function createRoomGame(playerCount: 2 | 3 | 4, seed = 0, matchId = `development-room-${playerCount}-${seed >>> 0}`): GameState {
  const state = createGame(playerCount, seed, matchId);
  state.setupState = createSetup(developmentSetupDefinition(playerCount));
  return state;
}

/**
 * Production/MVP room creation boundary. The development graph is never a
 * valid fallback here: until the photographed honeycomb board is fully
 * transcribed and verified, creation fails with an explicit release blocker.
 */
export function assertMvpBoardReady(): void {
  const errors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
  if (errors.length > 0) throw new GameDomainError("ILLEGAL_COMMAND", `MVP board is not ready for playable matches: ${errors.length} unresolved board validation errors. Complete the source-gated board review before creating a room.`);
}

export function createMvpRoomGame(playerCount: 2 | 3 | 4, seed = 0, matchId = `mvp-room-${playerCount}-${seed >>> 0}`): GameState {
  assertMvpBoardReady();
  return createRoomGame(playerCount, seed, matchId);
}

/**
 * Initialize a local development match from the validated setup state machine.
 * A production initializer must be supplied with verified component data first.
 */
export function createGameFromSetup(setup: SetupState, seed = 0): GameState {
  validateSetup(setup);
  const selectedMonsters = setup.seats.map((seat) => {
    const monster = monsters.find((candidate) => candidate.id === seat.monsterId);
    if (!monster) throw new Error(`Development monster ${seat.monsterId ?? "unknown"} is not available in the engine fixture.`);
    return { ...monster };
  });
  const state = createGame(setup.definition.playerCount, seed);
  state.monsters = selectedMonsters.map((monster, index) => ({ ...monster, location: developmentKey(index === 0 ? "los-angeles" : "seattle") }));
  state.setupAssignments = structuredClone(setup.seats);
  assertInventoryAccounting(state);
  state.log.unshift("Development setup complete. Production component verification is still required.");
  return state;
}

export function getLocation(id: string) {
  const legacyId = hexKeyToLocationId(id) ?? id;
  return locations.find((location) => location.id === legacyId);
}

function waterClassAllowed(movement: MonsterMovement | UnitMovement, waterClass: WaterClass): boolean {
  if (waterClass === "unresolved") return false;
  if (movement === "fly") return true;
  if (movement === "land-only") return waterClass === "land" || waterClass === "seacoast";
  if (movement === "land-lake") return waterClass === "land" || waterClass === "lake" || waterClass === "seacoast";
  if (movement === "land-lake-sea") return true;
  if (movement === "sea-seacoast-only" || movement === "sea-seacoast-or-fly") return waterClass === "sea" || waterClass === "seacoast";
  return false;
}

function waterBarrierAllowed(movement: MonsterMovement | UnitMovement, barrier: BoardDefinition["edges"][number]["barrier"]): boolean {
  if (barrier === "unresolved") return false;
  if (movement === "fly") return true;
  if (movement === "land-only") return barrier === "none";
  if (movement === "land-lake") return barrier === "none" || barrier === "lake";
  if (movement === "land-lake-sea") return true;
  if (movement === "sea-seacoast-only" || movement === "sea-seacoast-or-fly") return barrier === "none" || barrier === "sea";
  return false;
}

/** Shared movement-mode gate used by selectors and command validation. */
export function movementPathAllowed(board: BoardDefinition, path: readonly HexKey[], movement: MonsterMovement | UnitMovement): boolean {
  return path.every((space, index) => {
    if (index === 0) return Boolean(board.hexes[space]) && waterClassAllowed(movement, board.hexes[space].waterClass);
    const previous = path[index - 1];
    const edge = board.edges.find((candidate) => candidate.from === previous && candidate.to === space && candidate.enabled);
    return Boolean(edge && waterBarrierAllowed(movement, edge.barrier) && board.hexes[space] && waterClassAllowed(movement, board.hexes[space].waterClass));
  });
}

export function legalMonsterPaths(state: GameState, monsterId = state.monsters[state.currentPlayer]?.id): HexKey[][] {
  if (state.phase !== "move") return [];
  const monster = state.monsters.find((candidate) => candidate.id === monsterId);
  if (!monster || !isHexKey(monster.location)) return [];
  const movement = effectiveMonsterMovement(state, monster);
  const move = effectiveMonsterMove(state, monster);
  const paths: HexKey[][] = [];
  const visit = (path: HexKey[], record = true) => {
    if (record && path.length > 1) paths.push(path);
    if (path.length - 1 >= move) return;
    for (const next of developmentBoardIndex.neighbours[path.at(-1)!] ?? []) {
      if (path.includes(next)) continue;
      const otherMonster = state.monsters.some((candidate) => candidate.id !== monster.id && candidate.location === next);
      if (otherMonster && movement !== "fly") continue;
      const nextPath = [...path, next];
      if (!movementPathAllowed(DEVELOPMENT_BOARD, nextPath, movement)) continue;
      const occupiedByMilitary = state.units.some((unit) => unit.location === next);
      const flyMayPass = movement === "fly";
      const finishForbidden = otherMonster && flyMayPass && !state.challenge?.active;
      if (!finishForbidden) paths.push(nextPath);
      if (!flyMayPass && occupiedByMilitary) continue;
      visit(nextPath, !finishForbidden);
    }
  };
  visit([monster.location]);
  return paths;
}

export function legalMonsterDestinations(state: GameState, monsterId = state.monsters[state.currentPlayer]?.id): HexKey[] {
  return [...new Set(legalMonsterPaths(state, monsterId).map((path) => path.at(-1)!))];
}

export function legalUnitPaths(state: GameState, unitId: string): HexKey[][] {
  if (state.phase !== "move") return [];
  const unit = state.units.find((candidate) => candidate.id === unitId);
  const movedPieceIds = state.movedPieceIds ?? [];
  const guardControlled = unit?.branch === "National Guard" && state.players[state.currentPlayer]?.researchCardIds.includes("Guard Commander");
  if (!unit || !isHexKey(unit.location) || (!guardControlled && unit.ownerPlayer !== state.currentPlayer) || movedPieceIds.includes(unitId) || !Number.isInteger(unit.move) || unit.move <= 0) return [];
  const paths: HexKey[][] = [];
  const visit = (path: HexKey[]) => {
    if (path.length > 1) paths.push(path);
    if (path.length - 1 >= unit.move) return;
    for (const next of developmentBoardIndex.neighbours[path.at(-1)!] ?? []) {
      if (path.includes(next)) continue;
      const nextPath = [...path, next];
      if (!movementPathAllowed(DEVELOPMENT_BOARD, nextPath, unit.movement)) continue;
      const occupiedByMonster = state.monsters.some((monster) => monster.location === next);
      if (occupiedByMonster && unit.movement !== "fly") { paths.push(nextPath); continue; }
      visit(nextPath);
    }
  };
  visit([unit.location]);
  return paths;
}

/**
 * Source-backed destination classes for neutral National Guard deployment.
 * Allowance, control overrides, and physical Guard-piece lifecycle remain
 * separate rules-gated concerns.
 */
export function legalNationalGuardDeploymentDestinations(state: Pick<GameState, "stompedLocations"> & Partial<Pick<GameState, "deploymentDestinations">>): HexKey[] {
  const stomped = new Set(state.stompedLocations ?? []);
  const deployedThisTurn = new Set(state.deploymentDestinations ?? []);
  return Object.values(DEVELOPMENT_BOARD.hexes)
    .filter((hex) => !stomped.has(hex.key) && !deployedThisTurn.has(hex.key) && hex.features.some((feature) => feature.kind === "city" || feature.kind === "military-base" || feature.kind === "infamy-site"))
    .map((hex) => hex.key)
    .sort();
}

/** Return verified, unstomped, unused destinations for the active owned branch. */
export function legalOwnedDeploymentDestinations(state: Pick<GameState, "stompedLocations" | "deploymentDestinations" | "setupAssignments" | "currentPlayer">): HexKey[] {
  const branch = state.setupAssignments?.[state.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as Branch[])[state.currentPlayer % 4];
  const stomped = new Set(state.stompedLocations ?? []);
  const deployedThisTurn = new Set(state.deploymentDestinations ?? []);
  return Object.values(DEVELOPMENT_BOARD.hexes)
    .filter((hex) => !stomped.has(hex.key) && !deployedThisTurn.has(hex.key) && hex.features.some((feature) => feature.kind === "military-base" && feature.branch === branch))
    .map((hex) => hex.key)
    .sort();
}

/** Return legal unstomped bases for one active player's ordinary branch unit. */
export function legalOwnedRedeploymentDestinations(state: Pick<GameState, "stompedLocations" | "deploymentDestinations" | "setupAssignments" | "currentPlayer" | "units" | "removedUnitIds">, unitId: string): HexKey[] {
  const branch = state.setupAssignments?.[state.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as Branch[])[state.currentPlayer % 4];
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || unit.branch !== branch || unit.unitTypeId === "mecha-monster" || unit.unitTypeId === "captain-colossal" || unit.ownerPlayer !== state.currentPlayer || !isHexKey(unit.location) || state.removedUnitIds.includes(unit.id)) return [];
  const stomped = new Set(state.stompedLocations ?? []);
  const deployedThisTurn = new Set(state.deploymentDestinations ?? []);
  return Object.values(DEVELOPMENT_BOARD.hexes)
    .filter((hex) => !stomped.has(hex.key) && !deployedThisTurn.has(hex.key) && hex.features.some((feature) => feature.kind === "military-base" && feature.branch === branch))
    .map((hex) => hex.key)
    .sort();
}

export function moveUnit(state: GameState, unitId: string, path: string[]): GameState {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  const canonical = canonicalPath(path);
  const destination = canonical?.at(-1);
  const movedPieceIds = state.movedPieceIds ?? [];
  const guardControlled = unit?.branch === "National Guard" && state.players[state.currentPlayer]?.researchCardIds.includes("Guard Commander");
  const controlsUnit = unit && (unit.ownerPlayer === state.currentPlayer || guardControlled);
  const legalPath = Boolean(unit && canonical && controlsUnit && destination && canonical.length >= 2 && canonical[0] === unit.location && !movedPieceIds.includes(unitId) && canonical.length - 1 <= unit.move && canonical.every((space, index) => index === 0 || developmentBoardIndex.neighbours[canonical[index - 1]]?.includes(space)) && movementPathAllowed(DEVELOPMENT_BOARD, canonical, unit.movement));
  const blockedByMonster = unit?.movement !== "fly" && (canonical ?? []).slice(1, -1).some((space) => occupantsAt(state, space).monsters.length > 0);
  if (!legalPath || blockedByMonster || state.phase !== "move" || !unit || !destination) return state;
  const next = structuredClone(state);
  const moved = next.units.find((candidate) => candidate.id === unitId)!;
  moved.location = destination;
  next.movedPieceIds = [...movedPieceIds, unitId];
  const monster = next.monsters.find((candidate) => candidate.location === destination);
  if (monster) {
    const existing = next.pendingBattles.find((battle) => battle.monsterId === monster.id && battle.location === destination);
    if (existing) existing.militaryUnitIds = [...new Set([...existing.militaryUnitIds, unitId])];
    else next.pendingBattles = [...next.pendingBattles, { id: `${monster.id}:${next.round}:${destination}`, monsterId: monster.id, location: destination, militaryUnitIds: [unitId] }];
  }
  next.log.push(`${unit.branch} unit moved to ${getLocation(destination)?.name}.`);
  return next;
}

export function moveMonster(state: GameState, monsterId: string, path: string[]): GameState {
  const monster = state.monsters[state.currentPlayer];
  const movement = effectiveMonsterMovement(state, monster);
  const move = effectiveMonsterMove(state, monster);
  const canonical = canonicalPath(path);
  const destination = canonical?.at(-1);
  const movedPieceIds = state.movedPieceIds ?? [];
  const legalPath = Boolean(canonical && canonical.length >= 2 && canonical[0] === monster.location && canonical.length - 1 <= move && canonical.every((space, index) => index === 0 || developmentBoardIndex.neighbours[canonical[index - 1]]?.includes(space)) && movementPathAllowed(DEVELOPMENT_BOARD, canonical, movement));
  const intermediate = (canonical ?? []).slice(1, -1);
  const blockedByMilitary = movement !== "fly" && intermediate.some((space) => occupantsAt(state, space).units.length > 0);
  const otherMonsterSpaces = (canonical ?? []).slice(1).filter((space) => occupantsAt(state, space).monsters.some((candidate) => candidate.id !== monster.id));
  const entersOtherMonster = movement === "fly" && !state.challenge?.active
    ? otherMonsterSpaces.includes(destination!)
    : otherMonsterSpaces.length > 0;
  const legal = monster.id === monsterId && destination && !movedPieceIds.includes(monsterId) && legalPath && !blockedByMilitary && !entersOtherMonster;
  if (!legal || state.phase !== "move") return state;
  const next = structuredClone(state);
  next.monsters[state.currentPlayer].location = destination;
  next.movedPieceIds = [...movedPieceIds, monsterId];
  const militaryUnitIds = occupantsAt(next, destination).units.map((unit) => unit.id);
  if (militaryUnitIds.length > 0) {
    const existing = next.pendingBattles.find((battle) => battle.monsterId === monster.id && battle.location === destination);
    if (existing) existing.militaryUnitIds = [...new Set([...existing.militaryUnitIds, ...militaryUnitIds])];
    else next.pendingBattles = [...next.pendingBattles, { id: `${monster.id}:${next.round}:${destination}`, monsterId: monster.id, location: destination, militaryUnitIds }];
  }
  next.phase = next.pendingBattles.length > 0 ? "fight" : "encounter";
  next.pendingDecision = next.pendingBattles[0]
    ? { type: "battle-resolution", playerIndex: next.currentPlayer, battleId: next.pendingBattles[0].id }
    : { type: "encounter-resolution", playerIndex: next.currentPlayer, location: destination };
  next.log.push(`${monster.name} moved to ${getLocation(destination)?.name}. Fight any units in the space.`);
  return next;
}

export function resolveFight(state: GameState): GameState {
  return resolveFightResult(state).state;
}

interface FightResolution {
  state: GameState;
  rolls: number[];
  destroyedUnitIds: string[];
  attacks: readonly BattleAttack[];
  combatRounds: number;
  infamySpent: number;
  hollywoodResearchCardId?: string;
}

export interface BattleAttack {
  readonly attackerId: string;
  readonly targetId: string;
  readonly controllerPlayer: number;
  readonly roll: number;
  readonly modifiers: readonly string[];
  readonly hit: boolean;
  readonly smash: boolean;
  readonly damage: number;
  readonly destroyed: boolean;
  readonly mutationCardId?: string;
  /** Present on Monster Challenge attacks so the UI can animate authoritative Health changes. */
  readonly targetHealthBefore?: number;
  readonly targetHealthAfter?: number;
}

function drawMutationForMonster(state: GameState, monster: Monster): string | undefined {
  const playerIndex = state.monsters.findIndex((candidate) => candidate.id === monster.id);
  const player = state.players[playerIndex];
  if (!player) return undefined;
  const result = drawCardFromDeck(state.decks.mutation);
  state.decks.mutation = result.state;
  if (!result.cardId) return undefined;
  player.mutationCardIds.push(result.cardId);
  return result.cardId;
}

function drawResearchCardForPlayer(state: GameState, playerIndex: number): string | undefined {
  const player = state.players[playerIndex];
  if (!player) return undefined;
  const result = drawCardFromDeck(state.decks.research);
  state.decks.research = result.state;
  if (!result.cardId) return undefined;
  player.researchCardIds.push(result.cardId);
  return result.cardId;
}

function monsterHasMutation(state: Pick<GameState, "monsters" | "players">, monster: Monster, cardId: string): boolean {
  const playerIndex = state.monsters.findIndex((candidate) => candidate.id === monster.id);
  return playerIndex >= 0 && state.players[playerIndex]?.mutationCardIds.includes(cardId) === true;
}

function effectiveMonsterMove(state: Pick<GameState, "monsters" | "players">, monster: Monster): number {
  const bonus = monsterHasMutation(state, monster, "High-Octane Blood") || monsterHasMutation(state, monster, "Winged Horror") ? 1 : 0;
  const penalty = monsterHasMutation(state, monster, "Armored Scales") ? 1 : 0;
  return Math.max(1, monster.move + bonus - penalty);
}

function effectiveMonsterMovement(state: Pick<GameState, "monsters" | "players">, monster: Monster): MonsterMovement {
  return monsterHasMutation(state, monster, "Winged Horror") ? "fly" : monster.movement;
}

function effectiveMonsterDefense(state: Pick<GameState, "monsters" | "players">, monster: Monster): number {
  return monster.defense + (monsterHasMutation(state, monster, "Armored Scales") ? 1 : 0);
}

function effectiveMonsterDamage(state: Pick<GameState, "monsters" | "players">, monster: Monster): number {
  return monsterHasMutation(state, monster, "War Spikes") ? 4 : monster.damage;
}

function effectiveMonsterAttacks(state: Pick<GameState, "monsters" | "players">, monster: Monster, round: number): number {
  return monster.attacks + (round === 1 && monsterHasMutation(state, monster, "Atomic Breath") ? 1 : 0);
}

function awardHollywoodResearch(state: GameState, controllerPlayer: number | undefined): string | undefined {
  if (controllerPlayer === undefined || controllerPlayer === state.currentPlayer) return undefined;
  const cardId = drawResearchCardForPlayer(state, controllerPlayer);
  if (cardId) state.log.push(`Player ${controllerPlayer + 1} drew a Military Research card after sending a monster to Hollywood.`);
  return cardId;
}

function nextD6(state: GameState): number {
  let value = (state.rng.seed + Math.imul(state.rng.cursor + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  state.rng.cursor += 1;
  return ((value % 6) + 6) % 6 + 1;
}

function developmentRetreatOptions(state: GameState, battle: PendingBattle, unitIds: readonly string[]): Record<string, readonly HexKey[]> {
  const options: Record<string, readonly HexKey[]> = {};
  for (const unitId of unitIds) {
    options[unitId] = (developmentBoardIndex.neighbours[battle.location] ?? [])
      .filter((destination) => !state.monsters.some((monster) => monster.location === destination));
  }
  return options;
}

function finishBattleQueue(next: GameState): void {
  next.pendingAttackTarget = undefined;
  next.pendingCombat = undefined;
  if (next.pendingBattles.length > 0) {
    next.phase = "fight";
    next.pendingDecision = { type: "battle-resolution", playerIndex: next.currentPlayer, battleId: next.pendingBattles[0].id };
  } else if (next.encounterSuppressed) {
    next.phase = "deploy";
    next.deploymentsThisTurn = 0;
    next.deploymentDestinations = [];
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
  } else {
    next.phase = "encounter";
    next.pendingDecision = { type: "encounter-resolution", playerIndex: next.currentPlayer, location: next.monsters[next.currentPlayer].location as HexKey };
  }
}

/** Resolve a multi-unit normal battle one monster attack at a time. The
 * continuation is serialized so a reconnect cannot silently choose the next
 * target or lose rolls already resolved. */
function resolvePendingMultiTargetFight(state: GameState, selectedTargetId: string): FightResolution {
  const next = structuredClone(state);
  const pendingTarget = next.pendingAttackTarget;
  const pending = next.pendingBattles.find((battle) => battle.id === pendingTarget?.battleId);
  if (!pending) throw new GameDomainError("ILLEGAL_COMMAND", "The pending target battle no longer exists.");
  const monster = next.monsters.find((candidate) => candidate.id === pending.monsterId);
  if (!monster) throw new GameDomainError("ILLEGAL_COMMAND", "The pending target monster no longer exists.");
  const selectedUnit = next.units.find((unit) => unit.id === selectedTargetId);
  if (!selectedUnit || !pending.militaryUnitIds.includes(selectedTargetId) || selectedUnit.location !== pending.location) {
    throw new GameDomainError("ILLEGAL_COMMAND", "That battle target is no longer present.");
  }
  const existing = next.pendingCombat;
  const combat: PendingCombat = existing ?? {
    battleId: pending.id,
    monsterId: monster.id,
    round: 1,
    monsterAttackIndex: 0,
    preMonsterResolved: false,
    spendInfamy: pendingTarget?.spendInfamy ?? 0,
    rolls: [],
    attacks: [],
    destroyedUnitIds: [],
  };
  if (!existing) {
    if (!Number.isInteger(combat.spendInfamy) || combat.spendInfamy < 0 || combat.spendInfamy > monster.infamy) throw new GameDomainError("ILLEGAL_COMMAND", "A monster cannot spend more Infamy than it currently has.");
    monster.infamy -= combat.spendInfamy;
  }
  const rolls = [...combat.rolls];
  const attacks = [...combat.attacks];
  const destroyedUnitIds = [...combat.destroyedUnitIds];
  let hollywoodResearchCardId: string | undefined;
  let round = combat.round;
  let monsterAttackIndex = combat.monsterAttackIndex;
  let preMonsterResolved = combat.preMonsterResolved;
  const sendToHollywood = (controllerPlayer?: number) => {
    if (monster.health !== 0 || monster.location === "hollywood") return;
    monster.location = "hollywood";
    monster.infamy = 0;
    clearPendingChallengerIfLost(next, monster.id);
    next.encounterSuppressed = true;
    hollywoodResearchCardId = awardHollywoodResearch(next, controllerPlayer);
    next.log.push(`${monster.name} was defeated and went to Hollywood.`);
  };
  const performMonsterAttack = (target: MilitaryUnit) => {
    const roll = nextD6(next);
    rolls.push(roll);
    const fighterBonus = monster.name === "Konk" && target.unitTypeId?.endsWith("-fighter") ? 1 : 0;
    const hit = roll + fighterBonus >= target.defense;
    const smash = hit && roll === 6;
    const damage = hit ? effectiveMonsterDamage(next, monster) + (smash ? 1 : 0) : 0;
    const destroyed = hit;
    const modifiers = [
      ...(fighterBonus ? ["+1 to hit fighters"] : []),
      ...(monsterHasMutation(next, monster, "War Spikes") ? ["War Spikes: 4 damage"] : []),
    ];
    attacks.push({ attackerId: monster.id, targetId: target.id, controllerPlayer: next.currentPlayer, roll, modifiers, hit, smash, damage, destroyed });
    if (destroyed) {
      target.location = "record-tile";
      destroyedUnitIds.push(target.id);
      next.log.push(`${monster.name} destroyed a ${target.branch} unit; it returned to its record tile in combat round ${round} (${roll}${smash ? ", smash" : ""}).`);
    } else next.log.push(`${monster.name} missed a ${target.branch} unit in combat round ${round} (${roll}).`);
  };
  const performCounterAttacks = () => {
    for (const unit of next.units.filter((candidate) => pending.militaryUnitIds.includes(candidate.id) && candidate.location === pending.location)) {
      for (let attackIndex = 0; attackIndex < (unit.attacks ?? 1) && monster.health > 0; attackIndex += 1) {
        const roll = nextD6(next);
        rolls.push(roll);
        const hit = roll >= effectiveMonsterDefense(next, monster);
        const smash = hit && roll === 6;
        const damage = hit ? (unit.damage ?? 1) + (smash ? 1 : 0) : 0;
        monster.health = Math.max(0, monster.health - damage);
        const destroyed = monster.health === 0;
        const mutationCardId = unit.unitTypeId === "air-force-cruise-missile" && roll === 1 ? drawMutationForMonster(next, monster) : undefined;
        attacks.push({ attackerId: unit.id, targetId: monster.id, controllerPlayer: unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer ?? next.currentPlayer, roll, modifiers: [], hit, smash, damage, destroyed, mutationCardId });
        next.log.push(`${unit.branch} attacked ${monster.name} in combat round ${round}: ${hit ? `hit for ${damage}${smash ? ", smash" : ""}` : "missed"} (${roll}).${mutationCardId ? " A Mutation card was drawn face up; its effect remains source-gated." : ""}`);
        sendToHollywood(unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer);
      }
    }
  };
  const liveTargets = () => next.units.filter((unit) => pending.militaryUnitIds.includes(unit.id) && unit.location === pending.location);
  const saveCombat = () => {
    next.pendingCombat = { ...combat, round, monsterAttackIndex, preMonsterResolved, rolls, attacks, destroyedUnitIds };
  };
  const requestNextTarget = (targets: readonly MilitaryUnit[], allowance: number): boolean => {
    if (targets.length <= 1) return false;
    saveCombat();
    const targetIds = targets.map((unit) => unit.id);
    next.pendingAttackTarget = { battleId: pending.id, attackerId: monster.id, targetIds, round, attackNumber: monsterAttackIndex + 1, attackTotal: allowance };
    next.pendingDecision = { type: "attack-target", playerIndex: next.currentPlayer, battleId: pending.id, attackerId: monster.id, targetIds, round, attackNumber: monsterAttackIndex + 1, attackTotal: allowance };
    next.log.push(`Choose the target for ${monster.name}'s attack ${monsterAttackIndex + 1} of ${allowance} in combat round ${round}.`);
    return true;
  };
  if (!preMonsterResolved) {
    const preMonsterAttackers = next.units.filter((unit) => pending.militaryUnitIds.includes(unit.id) && unit.location === monster.location && unit.unitTypeId === "army-missile-launcher");
    for (const unit of preMonsterAttackers) {
      if (monster.health === 0) break;
      const roll = nextD6(next);
      rolls.push(roll);
      const hit = roll >= effectiveMonsterDefense(next, monster);
      const smash = hit && roll === 6;
      const damage = hit ? (unit.damage ?? 1) + (smash ? 1 : 0) : 0;
      monster.health = Math.max(0, monster.health - damage);
      const destroyed = monster.health === 0;
      attacks.push({ attackerId: unit.id, targetId: monster.id, controllerPlayer: unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer ?? next.currentPlayer, roll, modifiers: ["extra first-round attack before monster"], hit, smash, damage, destroyed });
      next.log.push(`${unit.branch} missile launcher attacked ${monster.name} before the monster in combat round 1: ${hit ? `hit for ${damage}${smash ? ", smash" : ""}` : "missed"} (${roll}).`);
      sendToHollywood(unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer);
    }
    preMonsterResolved = true;
  }
  if (monster.health > 0) {
    performMonsterAttack(selectedUnit);
    monsterAttackIndex += 1;
  }
  const runMonsterRemainder = (): boolean => {
    const allowance = effectiveMonsterAttacks(next, monster, round) + (round === 1 ? combat.spendInfamy : 0);
    while (monsterAttackIndex < allowance && monster.health > 0) {
      const targets = liveTargets();
      if (targets.length === 0) break;
      if (requestNextTarget(targets, allowance)) return true;
      performMonsterAttack(targets[0]!);
      monsterAttackIndex += 1;
    }
    return false;
  };
  if (runMonsterRemainder()) return { state: next, rolls, destroyedUnitIds, attacks, combatRounds: round, infamySpent: combat.spendInfamy, hollywoodResearchCardId };
  if (monster.health > 0) performCounterAttacks();
  if (round === 1) {
    for (const unit of next.units.filter((candidate) => pending.militaryUnitIds.includes(candidate.id) && candidate.location === pending.location && candidate.unitTypeId === "air-force-cruise-missile")) {
      unit.location = "record-tile";
      if (!destroyedUnitIds.includes(unit.id)) destroyedUnitIds.push(unit.id);
      next.log.push(`${unit.branch} cruise missile was destroyed after combat round 1.`);
    }
  }
  const survivingTargets = liveTargets();
  if (round === 1 && monster.health > 0 && survivingTargets.length > 0) {
    round = 2;
    monsterAttackIndex = 0;
    const secondRoundAllowance = effectiveMonsterAttacks(next, monster, round);
    if (requestNextTarget(survivingTargets, secondRoundAllowance)) return { state: next, rolls, destroyedUnitIds, attacks, combatRounds: 1, infamySpent: combat.spendInfamy, hollywoodResearchCardId };
    while (monsterAttackIndex < secondRoundAllowance && monster.health > 0) {
      const target = liveTargets()[0];
      if (!target) break;
      performMonsterAttack(target);
      monsterAttackIndex += 1;
    }
    if (monster.health > 0) performCounterAttacks();
  }
  const survivingUnitIds = next.units.filter((unit) => pending.militaryUnitIds.includes(unit.id) && unit.location === pending.location).map((unit) => unit.id);
  next.pendingCombat = undefined;
  next.pendingAttackTarget = undefined;
  if (survivingUnitIds.length > 0) {
    pending.militaryUnitIds = survivingUnitIds;
    next.pendingRetreat = { battleId: pending.id, unitIds: survivingUnitIds, options: developmentRetreatOptions(next, pending, survivingUnitIds), researchPlayerIndex: retreatResearchPlayer(next, survivingUnitIds) };
    next.phase = "fight";
    next.pendingDecision = { type: "retreat", playerIndex: next.currentPlayer, battleId: pending.id, unitIds: survivingUnitIds };
    next.log.push(`${survivingUnitIds.length} military unit${survivingUnitIds.length === 1 ? " requires" : "s require"} retreat after the normal battle.`);
  } else {
    next.pendingBattles = next.pendingBattles.filter((battle) => battle.id !== pending.id);
    finishBattleQueue(next);
  }
  return { state: next, rolls, destroyedUnitIds, attacks, combatRounds: 2, infamySpent: combat.spendInfamy, hollywoodResearchCardId };
}

function resolveFightResult(state: GameState, battleId?: string, spendInfamy = 0, preferredTargetId?: string): FightResolution {
  const rolls: number[] = [];
  const destroyedUnitIds: string[] = [];
  const attacks: BattleAttack[] = [];
  if (state.phase !== "fight") return { state, rolls, destroyedUnitIds, attacks, combatRounds: 0, infamySpent: 0 };
  const next = structuredClone(state);
  const pending = next.pendingBattles.find((battle) => battle.id === battleId) ?? next.pendingBattles[0];
  const monster = pending
    ? next.monsters.find((candidate) => candidate.id === pending.monsterId)
    : next.monsters[next.currentPlayer];
  if (!monster) return { state, rolls, destroyedUnitIds, attacks, combatRounds: 0, infamySpent: 0 };
  if (!Number.isInteger(spendInfamy) || spendInfamy < 0 || spendInfamy > monster.infamy) throw new GameDomainError("ILLEGAL_COMMAND", "A monster cannot spend more Infamy than it currently has.");
  monster.infamy -= spendInfamy;
  next.pendingAttackTarget = undefined;
  let hollywoodResearchCardId: string | undefined;
  const sendToHollywood = (controllerPlayer?: number) => {
    if (monster.health !== 0 || monster.location === "hollywood") return;
    monster.location = "hollywood";
    monster.infamy = 0;
    clearPendingChallengerIfLost(next, monster.id);
    next.encounterSuppressed = true;
    hollywoodResearchCardId = awardHollywoodResearch(next, controllerPlayer);
    next.log.push(`${monster.name} was defeated and went to Hollywood.`);
  };
  sendToHollywood();
  const targetIds = pending?.militaryUnitIds ?? next.units.filter((unit) => unit.location === monster.location).map((unit) => unit.id);
  const targets = next.units.filter((unit) => targetIds.includes(unit.id));
  if (targets.length === 0) next.log.push("No battle here. Continue to Encounter.");
  else {
    for (let combatRound = 1; combatRound <= 2; combatRound += 1) {
      if (combatRound === 1) {
        const preMonsterAttackers = next.units.filter((unit) => targetIds.includes(unit.id) && unit.location === monster.location && unit.unitTypeId === "army-missile-launcher");
        for (const unit of preMonsterAttackers) {
          if (monster.health === 0) break;
          const roll = nextD6(next);
          rolls.push(roll);
          const hit = roll >= effectiveMonsterDefense(next, monster);
          const smash = hit && roll === 6;
          const damage = hit ? (unit.damage ?? 1) + (smash ? 1 : 0) : 0;
          monster.health = Math.max(0, monster.health - damage);
          const destroyed = monster.health === 0;
          attacks.push({ attackerId: unit.id, targetId: monster.id, controllerPlayer: unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer ?? next.currentPlayer, roll, modifiers: ["extra first-round attack before monster"], hit, smash, damage, destroyed });
          next.log.push(`${unit.branch} missile launcher attacked ${monster.name} before the monster in combat round 1: ${hit ? `hit for ${damage}${smash ? ", smash" : ""}` : "missed"} (${roll}).`);
          sendToHollywood(unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer);
        }
      }
      const survivingTargets = next.units.filter((unit) => targetIds.includes(unit.id) && unit.location === monster.location);
        const attackAllowance = effectiveMonsterAttacks(next, monster, combatRound) + (combatRound === 1 ? spendInfamy : 0);
      for (let attackIndex = 0; attackIndex < attackAllowance && survivingTargets.length > 0 && monster.health > 0; attackIndex += 1) {
        const currentTargets = next.units.filter((unit) => targetIds.includes(unit.id) && unit.location === monster.location);
        if (currentTargets.length === 0) break;
        const orderedTargets = preferredTargetId
          ? [
              ...currentTargets.filter((candidate) => candidate.id === preferredTargetId),
              ...currentTargets.filter((candidate) => candidate.id !== preferredTargetId),
            ]
          : currentTargets;
        const target = attackIndex === 0 && preferredTargetId
          ? orderedTargets[0]
          : orderedTargets[attackIndex % orderedTargets.length];
        if (!target) throw new GameDomainError("ILLEGAL_COMMAND", "The selected battle target is no longer in the battle.");
        const roll = nextD6(next);
        rolls.push(roll);
        const fighterBonus = monster.name === "Konk" && target.unitTypeId?.endsWith("-fighter") ? 1 : 0;
        const hit = roll + fighterBonus >= target.defense;
        const smash = hit && roll === 6;
        const damage = hit ? effectiveMonsterDamage(next, monster) + (smash ? 1 : 0) : 0;
        const destroyed = hit;
        const modifiers = [
          ...(fighterBonus ? ["+1 to hit fighters"] : []),
          ...(monsterHasMutation(next, monster, "War Spikes") ? ["War Spikes: 4 damage"] : []),
        ];
        attacks.push({ attackerId: monster.id, targetId: target.id, controllerPlayer: next.currentPlayer, roll, modifiers, hit, smash, damage, destroyed });
        if (destroyed) { target.location = "record-tile"; destroyedUnitIds.push(target.id); next.log.push(`${monster.name} destroyed a ${target.branch} unit; it returned to its record tile in combat round ${combatRound} (${roll}${smash ? ", smash" : ""}).`); }
        else next.log.push(`${monster.name} missed a ${target.branch} unit in combat round ${combatRound} (${roll}).`);
      }
      const survivingUnits = next.units.filter((unit) => targetIds.includes(unit.id) && unit.location === monster.location);
      for (const unit of survivingUnits) {
        for (let attackIndex = 0; attackIndex < (unit.attacks ?? 1) && monster.health > 0; attackIndex += 1) {
          const roll = nextD6(next);
          rolls.push(roll);
          const hit = roll >= effectiveMonsterDefense(next, monster);
          const smash = hit && roll === 6;
          const damage = hit ? (unit.damage ?? 1) + (smash ? 1 : 0) : 0;
          monster.health = Math.max(0, monster.health - damage);
          const destroyed = monster.health === 0;
          const mutationCardId = unit.unitTypeId === "air-force-cruise-missile" && roll === 1 ? drawMutationForMonster(next, monster) : undefined;
          attacks.push({ attackerId: unit.id, targetId: monster.id, controllerPlayer: unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer ?? next.currentPlayer, roll, modifiers: [], hit, smash, damage, destroyed, mutationCardId });
          next.log.push(`${unit.branch} attacked ${monster.name} in combat round ${combatRound}: ${hit ? `hit for ${damage}${smash ? ", smash" : ""}` : "missed"} (${roll}).${mutationCardId ? " A Mutation card was drawn face up; its effect remains source-gated." : ""}`);
          sendToHollywood(unit.branch === "National Guard" ? next.currentPlayer : unit.ownerPlayer);
        }
      }
      if (combatRound === 1) {
        for (const unit of next.units.filter((candidate) => targetIds.includes(candidate.id) && candidate.location === monster.location && candidate.unitTypeId === "air-force-cruise-missile")) {
          unit.location = "record-tile";
          if (!destroyedUnitIds.includes(unit.id)) destroyedUnitIds.push(unit.id);
          next.log.push(`${unit.branch} cruise missile was destroyed after combat round 1.`);
        }
      }
    }
  }
  const survivingUnitIds = pending
    ? next.units.filter((unit) => targetIds.includes(unit.id) && unit.location === monster.location).map((unit) => unit.id)
    : [];
  if (pending && survivingUnitIds.length > 0) {
    pending.militaryUnitIds = survivingUnitIds;
    next.pendingRetreat = { battleId: pending.id, unitIds: survivingUnitIds, options: developmentRetreatOptions(next, pending, survivingUnitIds), researchPlayerIndex: retreatResearchPlayer(next, survivingUnitIds) };
    next.phase = "fight";
    next.pendingDecision = { type: "retreat", playerIndex: next.currentPlayer, battleId: pending.id, unitIds: survivingUnitIds };
    next.log.push(`${survivingUnitIds.length} military unit${survivingUnitIds.length === 1 ? " requires" : "s require"} retreat after the normal battle.`);
  } else {
    next.pendingBattles = pending
      ? next.pendingBattles.filter((battle) => battle.id !== pending.id)
      : [];
    finishBattleQueue(next);
  }
  return { state: next, rolls, destroyedUnitIds, attacks, combatRounds: targets.length > 0 ? 2 : 0, infamySpent: spendInfamy, hollywoodResearchCardId };
}

export interface EncounterResolution {
  state: GameState;
  effects: readonly Readonly<{ type: "health" | "infamy" | "stomp"; amount: number; source: string }>[];
  rolls: readonly number[];
}

export function resolveEncounterResult(state: GameState, choice?: "health" | "infamy"): EncounterResolution {
  if (state.phase !== "encounter") return { state, effects: [], rolls: [] };
  const next = structuredClone(state);
  if (!Array.isArray(next.stompedLocations)) next.stompedLocations = [];
  const monster = next.monsters[next.currentPlayer];
  const place = getLocation(monster.location);
  const effects: Array<Readonly<{ type: "health" | "infamy" | "stomp"; amount: number; source: string }>> = [];
  const rolls: number[] = [];
  const locationKey = monster.location as HexKey;
  const canonicalLocationKey = (locationIdToHexKey(locationKey) ?? locationKey) as HexKey;
  const locationId = place?.id ?? locationKey;
  const alreadyStomped = next.stompedLocations.includes(locationKey);
  const features = isHexKey(canonicalLocationKey) ? DEVELOPMENT_BOARD.hexes[canonicalLocationKey]?.features ?? [] : [];
  const stompable = features.some((feature) => feature.kind === "city" || feature.kind === "military-base" || feature.kind === "infamy-site");
  const challengeSite = features.some((feature) => feature.kind === "challenge-site");
  const mutationFeatures = features.filter((feature): feature is Extract<BoardFeature, { kind: "mutation-site" }> => feature.kind === "mutation-site");
  for (const feature of mutationFeatures) {
    const usedSites = next.mutationSiteUses[monster.id] ?? [];
    if (usedSites.includes(feature.siteId)) continue;
    next.mutationSiteUses[monster.id] = [...usedSites, feature.siteId];
    const mutationCardId = drawMutationForMonster(next, monster);
    next.log.push(`${monster.name} used Mutation site ${feature.siteId};${mutationCardId ? " A Mutation card was drawn face up;" : " No Mutation card was available;"} its effect remains source-gated.`);
  }
  if (next.challenge?.declared && !next.challenge.active && challengeSite && monster.location !== "hollywood" && !next.challenge.defeatedMonsterIds.includes(monster.id)) {
    next.challenge = { ...next.challenge, challengerMonsterId: monster.id, pendingStartPlayerIndex: next.currentPlayer, startAtEndOfTurn: true };
    next.log.push(`${monster.name} reached a Challenge site and replaced the pending challenger; the Monster Challenge begins at the end of this turn.`);
    next.phase = "deploy";
    next.deploymentsThisTurn = 0;
    next.deploymentDestinations = [];
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
    return { state: next, effects, rolls };
  }
  if (!stompable) {
    next.log.push(`${monster.name} encountered a space with no active encounter effect.`);
    next.phase = "deploy";
    next.deploymentsThisTurn = 0;
    next.deploymentDestinations = [];
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
    return { state: next, effects, rolls };
  }
  const zorbCityChoiceRequired = !alreadyStomped && monster.name === "Zorb" && features.some((feature) => feature.kind === "city") && !choice;
  if (zorbCityChoiceRequired) {
    next.pendingEncounterChoice = { playerIndex: next.currentPlayer, location: canonicalLocationKey, choices: ["health", "infamy"] };
    next.pendingDecision = { type: "encounter-choice", playerIndex: next.currentPlayer, location: canonicalLocationKey, choices: ["health", "infamy"] };
    next.log.push(`${monster.name} must choose a city benefit.`);
    return { state: next, effects: [], rolls };
  }
  if (!alreadyStomped) {
    for (const feature of features) {
      if (feature.kind === "city") {
        if (monster.name === "Zorb" && choice === "infamy") {
          const before = monster.infamy;
          monster.infamy = Math.min(15, monster.infamy + 2);
          effects.push({ type: "infamy", amount: monster.infamy - before, source: locationId });
          continue;
        }
        const benefitRolls = feature.benefit.kind === "health"
          ? []
          : Array.from({ length: feature.benefit.dice }, () => nextD6(next));
        rolls.push(...benefitRolls);
        const amount = feature.benefit.kind === "health"
          ? feature.benefit.amount
          : benefitRolls.reduce((total, roll) => total + roll, 0);
        const before = monster.health;
        monster.health = Math.min(monster.maxHealth, monster.health + amount);
        effects.push({ type: "health", amount: monster.health - before, source: locationId });
      }
      if (feature.kind === "infamy-site") {
        const before = monster.infamy;
        const amount = monster.name === "Megaclaw" ? 3 : 2;
        monster.infamy = Math.min(15, monster.infamy + amount);
        effects.push({ type: "infamy", amount: monster.infamy - before, source: locationId });
      }
      if (feature.kind === "military-base") {
        const before = monster.infamy;
        monster.infamy = Math.min(15, monster.infamy + 1);
        effects.push({ type: "infamy", amount: monster.infamy - before, source: locationId });
      }
    }
    next.stompedLocations.push(locationKey);
    next.pendingEncounterChoice = undefined;
    next.stompMarkers = Math.max(0, next.stompMarkers - 1);
    effects.push({ type: "stomp", amount: 1, source: locationId });
  }
  const baseFeature = features.find((feature): feature is Extract<BoardFeature, { kind: "military-base" }> => feature.kind === "military-base");
  if (!alreadyStomped && baseFeature) {
    const branchOwner = next.setupAssignments?.find((seat) => seat.branch === baseFeature.branch);
    const trophyUnitIds = next.units
      .filter((unit) => unit.branch === baseFeature.branch && !next.removedUnitIds.includes(unit.id) && (unit.location === "record-tile" || isHexKey(unit.location)))
      .map((unit) => unit.id);
    if (branchOwner?.playerIndex !== undefined && trophyUnitIds.length > 0) {
      next.pendingTrophyChoice = { playerIndex: branchOwner.playerIndex, location: canonicalLocationKey, branch: baseFeature.branch, unitIds: trophyUnitIds };
      next.pendingDecision = { type: "trophy-choice", playerIndex: branchOwner.playerIndex, location: canonicalLocationKey, branch: baseFeature.branch, unitIds: trophyUnitIds };
      next.log.push(`${baseFeature.branch} must choose one legal trophy for the monster.`);
      return { state: next, effects, rolls };
    }
  }
  next.log.push(`${monster.name} encountered ${place?.name}.`);
  const developmentBoardExhausted = next.rulesetVersion === "prototype-0.1" && locations.every((location) => next.stompedLocations.includes(locationIdToHexKey(location.id)!));
  const challengeRulesEnabled = next.rulesetVersion !== "prototype-0.1";
  if (next.stompMarkers === 0 && !next.challenge?.declared) {
    next.challenge = challengeDeclaration(next, monster);
    next.log.push(`${monster.name} took the final active Stomp marker and became the Monster Challenge challenger.`);
  }
  if (developmentBoardExhausted) {
    next.winnerPlayer = next.currentPlayer;
    next.victoryType = "development-board-exhaustion";
    next.phase = "game-over";
    next.pendingDecision = { type: "game-over", playerIndex: next.currentPlayer, victoryType: next.victoryType };
    next.log.push(`${monster.name} wins the development fixture by stomping every abstract board space.`);
  } else if (next.stompMarkers === 0 && !challengeRulesEnabled) {
    next.winnerPlayer = next.currentPlayer;
    next.victoryType = "development-stomp-exhaustion";
    next.phase = "game-over";
    next.pendingDecision = { type: "game-over", playerIndex: next.currentPlayer, victoryType: next.victoryType };
    next.log.push(`${monster.name} wins the development game by taking the final Stomp marker; the full Monster Challenge remains source-gated for this fixture.`);
  } else {
    next.phase = "deploy";
    next.deploymentsThisTurn = 0;
    next.deploymentDestinations = [];
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
  }
  return { state: next, effects, rolls };
}

export function resolveEncounter(state: GameState): GameState {
  return resolveEncounterResult(state).state;
}

export interface DeploymentResolution {
  state: GameState;
  unitId?: string;
  branch?: MilitaryUnitBranch;
  destination?: string;
}

export function deployUnitResult(state: GameState, requested?: { unitId?: string; destination?: HexKey }): DeploymentResolution {
  if (state.phase !== "deploy") return { state };
  const next = structuredClone(state);
  const branch = next.setupAssignments?.[next.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as Branch[])[next.currentPlayer % 4];
  const guardDeployment = requested?.unitId?.startsWith("national-guard-") ?? false;
  const allowanceDefinition = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === branch);
  const allowance = (allowanceDefinition?.ownOrGuardUnits ?? 0) + (guardDeployment ? allowanceDefinition?.additionalNationalGuardUnits ?? 0 : 0);
  if (guardDeployment && !next.players[next.currentPlayer]?.researchCardIds.includes("Guard Commander")) throw new GameDomainError("ILLEGAL_COMMAND", "Only the player with the Guard Commander card can deploy National Guard units.");
  if (next.deploymentsThisTurn >= allowance) throw new GameDomainError("ILLEGAL_COMMAND", `${branch} deployment allowance is exhausted; pass Deploy or draw Research when that source rule is implemented.`);
  const baseHex = Object.values(DEVELOPMENT_BOARD.hexes).find((hex) => hex.features.some((feature) => feature.kind === "military-base" && feature.branch === branch));
  const destination = guardDeployment
    ? requested?.destination ?? legalNationalGuardDeploymentDestinations(next)[0]
    : requested?.destination ?? legalOwnedDeploymentDestinations(next)[0] ?? baseHex?.key;
  if (!destination) throw new GameDomainError("ILLEGAL_COMMAND", `No verified ${guardDeployment ? "National Guard destination" : `${branch} base`} exists in the development board; deployment remains source-gated.`);
  if (guardDeployment) {
    if (!legalNationalGuardDeploymentDestinations(next).includes(destination)) throw new GameDomainError("ILLEGAL_COMMAND", "National Guard may deploy only to an unstomped city, military base, or Infamy site.");
  } else {
    const baseHex = DEVELOPMENT_BOARD.hexes[destination];
    if (!baseHex?.features.some((feature) => feature.kind === "military-base" && feature.branch === branch)) throw new GameDomainError("ILLEGAL_COMMAND", `${branch} units may deploy only to their verified base.`);
    if ((next.stompedLocations ?? []).includes(destination)) throw new GameDomainError("ILLEGAL_COMMAND", `${branch} base is stomped and cannot receive a deployment.`);
  }
  if (next.deploymentDestinations.includes(destination)) throw new GameDomainError("ILLEGAL_COMMAND", "Only one newly deployed unit may occupy a destination space during this Deploy step.");
  const unit = guardDeployment
    ? (() => {
        const definition = NATIONAL_GUARD_DEFINITIONS.find((candidate) => requested!.unitId!.startsWith(`${candidate.id}-`));
        if (!definition) return undefined;
        if (next.units.some((candidate) => candidate.id === requested!.unitId)) return undefined;
        return {
          id: requested!.unitId!, branch: "National Guard" as const, unitTypeId: definition.id,
          move: definition.move, movement: definition.name === "Fighter" ? "fly" as const : "land-only" as const,
          attacks: 1, damage: definition.damage, ownerPlayer: undefined, health: 1, defense: definition.defense,
          location: destination,
        } satisfies MilitaryUnit;
      })()
    : next.units.find((candidate) => candidate.branch === branch && candidate.location === "record-tile" && !next.removedUnitIds.includes(candidate.id));
  if (!unit) throw new GameDomainError("ILLEGAL_COMMAND", `No ${branch} unit remains on its record tile for deployment.`);
  if (guardDeployment) next.units.push(unit);
  else {
    unit.location = destination;
    unit.ownerPlayer = next.currentPlayer;
  }
  const unitId = unit.id;
  next.deploymentsThisTurn += 1;
  next.deploymentDestinations.push(destination);
  next.log.push(`${guardDeployment ? "National Guard" : branch} deployed ${unit.unitTypeId ?? unit.id} to ${DEVELOPMENT_BOARD.hexes[destination]?.label ?? destination}.`);
  const occupyingMonster = next.monsters.find((candidate) => candidate.location === destination);
  if (occupyingMonster) {
    const existingBattle = next.pendingBattles.find((battle) => battle.monsterId === occupyingMonster.id && battle.location === destination);
    if (existingBattle) existingBattle.militaryUnitIds = [...new Set([...existingBattle.militaryUnitIds, unitId])];
    else next.pendingBattles.push({ id: `${occupyingMonster.id}:${next.round}:${destination}:deployment`, monsterId: occupyingMonster.id, location: destination, militaryUnitIds: [unitId] });
    next.phase = "fight";
    next.pendingDecision = { type: "battle-resolution", playerIndex: next.currentPlayer, battleId: next.pendingBattles.at(-1)!.id };
    next.log.push(`${occupyingMonster.name} must fight the newly deployed unit at ${DEVELOPMENT_BOARD.hexes[destination]?.label ?? destination}.`);
  } else {
    next.phase = "deploy";
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
  }
  return { state: next, unitId, branch: guardDeployment ? "National Guard" : branch, destination };
}

export function deployUnit(state: GameState): GameState {
  return deployUnitResult(state).state;
}

export function redeployUnitResult(state: GameState, requested: { unitId: string; destination?: HexKey }): DeploymentResolution {
  if (state.phase !== "deploy") return { state };
  const next = structuredClone(state);
  const branch = next.setupAssignments?.[next.currentPlayer]?.branch
    ?? (["Army", "Navy", "Air Force", "Marines"] as Branch[])[next.currentPlayer % 4];
  const allowance = BRANCH_DEPLOYMENT_DEFINITIONS.find((definition) => definition.branch === branch)?.ownOrGuardUnits ?? 0;
  if (next.deploymentsThisTurn >= allowance) throw new GameDomainError("ILLEGAL_COMMAND", `${branch} deployment allowance is exhausted; redeployment counts against the same allowance.`);
  const destinations = legalOwnedRedeploymentDestinations(next, requested.unitId);
  const destination = requested.destination ?? destinations[0];
  if (!destination || !destinations.includes(destination)) throw new GameDomainError("ILLEGAL_COMMAND", "Redeployment is limited to an unstomped base belonging to the active player's branch.");
  const unit = next.units.find((candidate) => candidate.id === requested.unitId);
  if (!unit) throw new GameDomainError("ILLEGAL_COMMAND", `Unknown redeployment unit: ${requested.unitId}.`);
  unit.location = destination;
  next.deploymentsThisTurn += 1;
  next.deploymentDestinations.push(destination);
  next.log.push(`${branch} redeployed ${unit.unitTypeId ?? unit.id} from the board to ${DEVELOPMENT_BOARD.hexes[destination]?.label ?? destination}.`);
  const occupyingMonster = next.monsters.find((candidate) => candidate.location === destination);
  if (occupyingMonster) {
    const existingBattle = next.pendingBattles.find((battle) => battle.monsterId === occupyingMonster.id && battle.location === destination);
    if (existingBattle) existingBattle.militaryUnitIds = [...new Set([...existingBattle.militaryUnitIds, unit.id])];
    else next.pendingBattles.push({ id: `${occupyingMonster.id}:${next.round}:${destination}:redeployment`, monsterId: occupyingMonster.id, location: destination, militaryUnitIds: [unit.id] });
    next.phase = "fight";
    next.pendingDecision = { type: "battle-resolution", playerIndex: next.currentPlayer, battleId: next.pendingBattles.at(-1)!.id };
  } else {
    next.phase = "deploy";
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
  }
  return { state: next, unitId: unit.id, branch, destination };
}

export interface ResearchDrawResolution {
  readonly state: GameState;
  readonly cardId: string;
  readonly recoveryRoll?: number;
  readonly recoveryReleased?: boolean;
}

interface TurnAdvanceResolution {
  readonly recoveryRoll?: number;
  readonly recoveryReleased?: boolean;
}

function challengeOpponentIds(state: Pick<GameState, "monsters" | "challenge">, challengerMonsterId: string): string[] {
  const defeated = new Set(state.challenge?.defeatedMonsterIds ?? []);
  return state.monsters
    .filter((monster) => monster.id !== challengerMonsterId && !defeated.has(monster.id) && monster.location !== "hollywood")
    .map((monster) => monster.id);
}

function clearPendingChallengerIfLost(state: GameState, monsterId: string): void {
  if (!state.challenge?.declared || state.challenge.active || state.challenge.challengerMonsterId !== monsterId) return;
  state.challenge = { ...state.challenge, challengerMonsterId: undefined, startAtEndOfTurn: false };
  state.log.push(`${state.monsters.find((monster) => monster.id === monsterId)?.name ?? monsterId} lost pending Challenger status; the next eligible Challenge-site arrival may replace it.`);
}

function challengePlayerIndex(state: Pick<GameState, "monsters">, monsterId: string): number {
  const playerIndex = state.monsters.findIndex((monster) => monster.id === monsterId);
  if (playerIndex < 0) throw new GameDomainError("ILLEGAL_COMMAND", `Unknown Challenge monster: ${monsterId}.`);
  return playerIndex;
}

function beginMonsterChallenge(state: GameState): void {
  if (!state.challenge?.declared || state.challenge.active || !state.challenge.challengerMonsterId) return;
  const challengerPlayer = challengePlayerIndex(state, state.challenge.challengerMonsterId);
  state.challenge = { ...state.challenge, active: true, startAtEndOfTurn: false };
  state.currentPlayer = challengerPlayer;
  state.phase = "challenge";
  state.pendingDecision = pendingDecisionForState(state);
  state.log.push(`${state.monsters[challengerPlayer].name} begins the Monster Challenge.`);
}

function challengeDeclaration(state: GameState, monster: Monster): MonsterChallengeState {
  return {
    declared: true,
    active: false,
    challengerMonsterId: monster.id,
    declarationPlayerIndex: state.currentPlayer,
    pendingStartPlayerIndex: state.currentPlayer,
    weighInHealth: {},
    defeatedMonsterIds: [],
  };
}

interface ChallengeResolution {
  readonly state: GameState;
  readonly rolls: readonly number[];
  readonly attacks: readonly BattleAttack[];
  readonly winnerMonsterId: string;
  readonly defeatedMonsterId: string;
  readonly winnerPlayer: number;
  readonly winnerHealth: number;
  readonly loserWeighIn: number;
  readonly winnerName: string;
  readonly defeatedName: string;
}

function resolveMonsterChallengeDuel(state: GameState): ChallengeResolution {
  if (state.phase !== "challenge" || !state.challenge?.active || !state.challenge.opponentMonsterId) throw new GameDomainError("ILLEGAL_COMMAND", "There is no Monster Challenge duel to resolve.");
  const next = structuredClone(state);
  const challenge = next.challenge!;
  const challenger = next.monsters.find((monster) => monster.id === challenge.challengerMonsterId);
  const opponent = next.monsters.find((monster) => monster.id === challenge.opponentMonsterId);
  if (!challenger || !opponent) throw new GameDomainError("ILLEGAL_COMMAND", "The Monster Challenge duel references an unknown monster.");
  const challengerWeighIn = challenge.weighInHealth[challenger.id] ?? challenger.health;
  const opponentWeighIn = challenge.weighInHealth[opponent.id] ?? opponent.health;
  const rolls: number[] = [];
  const attacks: BattleAttack[] = [];
  let attacker = challenger;
  let defender = opponent;
  while (attacker.health > 0 && defender.health > 0) {
    for (let attackIndex = 0; attackIndex < attacker.attacks && defender.health > 0; attackIndex += 1) {
      const roll = nextD6(next);
      const hit = roll >= defender.defense;
      const smash = hit && roll === 6;
      const damage = hit ? attacker.damage + (smash ? 1 : 0) : 0;
      const targetHealthBefore = defender.health;
      defender.health = Math.max(0, defender.health - damage);
      rolls.push(roll);
      attacks.push({ attackerId: attacker.id, targetId: defender.id, controllerPlayer: challengePlayerIndex(next, attacker.id), roll, modifiers: [], hit, smash, damage, destroyed: defender.health === 0, targetHealthBefore, targetHealthAfter: defender.health });
    }
    if (defender.health === 0) break;
    [attacker, defender] = [defender, attacker];
  }
  const winner = challenger.health > 0 ? challenger : opponent;
  const loser = winner.id === challenger.id ? opponent : challenger;
  const loserWeighIn = loser.id === challenger.id ? challengerWeighIn : opponentWeighIn;
  winner.health = Math.min(winner.maxHealth, winner.health + loserWeighIn);
  loser.location = "defeated";
  loser.health = 0;
  const defeatedMonsterIds = [...new Set([...challenge.defeatedMonsterIds, loser.id])];
  next.challenge = { ...challenge, challengerMonsterId: winner.id, opponentMonsterId: undefined, weighInHealth: {}, defeatedMonsterIds };
  const nextOpponents = challengeOpponentIds(next, winner.id);
  if (nextOpponents.length === 0) {
    next.phase = "game-over";
    next.winnerPlayer = challengePlayerIndex(next, winner.id);
    next.victoryType = "monster-challenge";
    next.pendingDecision = { type: "game-over", playerIndex: next.winnerPlayer, victoryType: next.victoryType };
    next.log.push(`${winner.name} won the Monster Challenge and became King of the Giant Monsters.`);
  } else {
    next.currentPlayer = challengePlayerIndex(next, winner.id);
    next.phase = "challenge";
    next.pendingDecision = pendingDecisionForState(next);
    next.log.push(`${winner.name} defeated ${loser.name} in the Monster Challenge and gained ${loserWeighIn} weigh-in Health.`);
  }
  return { state: next, rolls, attacks, winnerMonsterId: winner.id, defeatedMonsterId: loser.id, winnerPlayer: challengePlayerIndex(next, winner.id), winnerHealth: winner.health, loserWeighIn, winnerName: winner.name, defeatedName: loser.name };
}

function advanceAfterDeployment(next: GameState): TurnAdvanceResolution {
  if (next.challenge?.declared && !next.challenge.active && next.challenge.startAtEndOfTurn) {
    beginMonsterChallenge(next);
    return {};
  }
  next.currentPlayer = (next.currentPlayer + 1) % next.monsters.length;
  next.movedPieceIds = [];
  next.deploymentsThisTurn = 0;
  next.deploymentDestinations = [];
  next.encounterSuppressed = false;
  if (next.currentPlayer === 0) next.round += 1;
  if (next.challenge?.declared && !next.challenge.active && next.currentPlayer === next.challenge.pendingStartPlayerIndex) {
    beginMonsterChallenge(next);
    return {};
  }
  next.phase = "move";
  const recovery = prepareMonsterForTurn(next);
  next.pendingDecision = { type: "monster-movement", playerIndex: next.currentPlayer, pieceId: next.monsters[next.currentPlayer].id };
  return { recoveryRoll: recovery?.recoveryRoll, recoveryReleased: recovery?.recoveryReleased };
}

/** Draw the current branch's one Military Research alternative and end Deploy. */
export function drawResearchForDeployment(state: GameState): ResearchDrawResolution {
  if (state.phase !== "deploy") throw new GameDomainError("ILLEGAL_COMMAND", "Military Research can only be drawn during Deploy.");
  const result = drawCardFromDeck(state.decks.research);
  if (!result.cardId) throw new GameDomainError("ILLEGAL_COMMAND", "The Military Research deck is exhausted; no Research card can be drawn.");
  const next = structuredClone(state);
  next.decks.research = result.state;
  const player = next.players[next.currentPlayer];
  if (!player) throw new GameDomainError("ILLEGAL_COMMAND", "The active player has no Research-card hand.");
  player.researchCardIds.push(result.cardId);
  next.log.push(`Player ${next.currentPlayer + 1} drew a Military Research card instead of deploying.`);
  const recovery = advanceAfterDeployment(next);
  return { state: next, cardId: result.cardId, ...recovery };
}

/** Resolve the active monster's automatic off-board recovery at the start of Move. */
function prepareMonsterForTurn(state: GameState): { monsterId: string; recoveryRoll?: number; recoveryReleased?: boolean } | undefined {
  const monster = state.monsters[state.currentPlayer];
  if (!monster) return undefined;
  if (monsterHasMutation(state, monster, "Atomic Recovery") && monster.health < monster.startingHealth) {
    monster.health = monster.startingHealth;
    state.log.push(`${monster.name} recovered to its starting Health through Atomic Recovery.`);
  }
  let recoveryRoll: number | undefined;
  let recoveryReleased = false;
  if (monster.location === "hollywood") {
    const roll = nextD6(state);
    recoveryRoll = roll;
    monster.health = Math.min(monster.maxHealth, monster.health + roll);
    if (monster.health < 5) {
      state.log.push(`${monster.name} recovered ${roll} Health in Hollywood but remains there.`);
    } else {
      const losAngeles = developmentKey("los-angeles");
      const assignment = state.setupAssignments?.find((seat) => seat.monsterId === monster.id);
      const destination = state.monsters.some((candidate) => candidate.id !== monster.id && candidate.location === losAngeles)
        ? assignment?.lair ? developmentKey(assignment.lair) : undefined
        : losAngeles;
      if (!destination) throw new GameDomainError("ILLEGAL_COMMAND", "A Hollywood monster needs a verified lair when Los Angeles is occupied.");
      monster.location = destination;
      recoveryReleased = true;
      state.log.push(`${monster.name} broke free from Hollywood after recovering ${roll} Health.`);
    }
  } else if (monster.location === "disappeared") {
    const assignment = state.setupAssignments?.find((seat) => seat.monsterId === monster.id);
    if (!assignment?.lair) throw new GameDomainError("ILLEGAL_COMMAND", "A disappeared monster cannot return without a verified setup lair.");
    monster.location = developmentKey(assignment.lair);
    if (monster.health < monster.startingHealth) monster.health = monster.startingHealth;
    state.log.push(`${monster.name} returned to its lair for the entire Move step.`);
  } else return undefined;
  state.movedPieceIds = [...new Set([...(state.movedPieceIds ?? []), monster.id])];
  state.encounterSuppressed = true;
  return { monsterId: monster.id, recoveryRoll, recoveryReleased };
}

/** Apply a client command at the rules boundary. The API should call this function, never mutate state directly. */
export function applyCommand(state: GameState, command: GameCommand): GameEventResult {
  state = migrateGameState(state);
  assertSupportedStateVersion(state);
  assertInventoryAccounting(state);
  if (state.phase === "game-over") throw new GameDomainError("ILLEGAL_COMMAND", "The match is complete; no further commands are legal.");
  if (command.type === "concede") {
    if (state.players.length < 2) throw new GameDomainError("ILLEGAL_COMMAND", "A match needs another player before a concession can produce a winner.");
    const next = structuredClone(state);
    next.phase = "game-over";
    next.winnerPlayer = (state.currentPlayer + 1) % state.players.length;
    next.victoryType = "concession";
    next.pendingDecision = { type: "game-over", playerIndex: next.winnerPlayer, victoryType: next.victoryType };
    next.log.push(`${state.monsters[state.currentPlayer]?.name ?? `Player ${state.currentPlayer + 1}`} conceded; Player ${next.winnerPlayer + 1} wins.`);
    const eventPayload = { concedingPlayer: state.currentPlayer, winnerPlayer: next.winnerPlayer, victoryType: next.victoryType };
    return { state: appendEvent(next, "match.conceded", eventPayload), eventType: "match.conceded", eventPayload };
  }
  const requireDecision = (type: PendingDecision["type"]) => {
    if (!state.pendingDecision || state.pendingDecision.type !== type || ("playerIndex" in state.pendingDecision && state.pendingDecision.playerIndex !== state.currentPlayer)) {
      throw new Error(`The authoritative pending decision is not ${type}.`);
    }
  };
  if (state.phase === "challenge" && command.type === "challenge-opponent") {
    requireDecision("challenge-opponent");
    const challenge = state.challenge;
    if (!challenge?.active || !challenge.challengerMonsterId) throw new GameDomainError("ILLEGAL_COMMAND", "The Monster Challenge has not started.");
    const opponentIds = challengeOpponentIds(state, challenge.challengerMonsterId);
    if (!opponentIds.includes(command.opponentMonsterId)) throw new GameDomainError("ILLEGAL_COMMAND", "Choose an eligible monster that is not in Hollywood or already defeated.");
    const next = structuredClone(state);
    const challenger = next.monsters.find((monster) => monster.id === challenge.challengerMonsterId)!;
    const opponent = next.monsters.find((monster) => monster.id === command.opponentMonsterId)!;
    opponent.location = challenger.location;
    next.challenge = { ...challenge, opponentMonsterId: opponent.id, weighInHealth: { [challenger.id]: challenger.health, [opponent.id]: opponent.health } };
    next.currentPlayer = challengePlayerIndex(next, challenger.id);
    next.pendingDecision = pendingDecisionForState(next);
    next.log.push(`${challenger.name} chose ${opponent.name} as the next Monster Challenge opponent; both monsters weighed in.`);
    const eventPayload = { challengerMonsterId: challenger.id, opponentMonsterId: opponent.id, challengerWeighIn: challenger.health, opponentWeighIn: opponent.health };
    return { state: appendEvent(next, "challenge.opponent.selected", eventPayload), eventType: "challenge.opponent.selected", eventPayload };
  }
  if (state.phase === "challenge" && command.type === "resolve-challenge") {
    requireDecision("challenge-resolution");
    const result = resolveMonsterChallengeDuel(state);
    const eventPayload = { challengerMonsterId: result.winnerMonsterId, defeatedMonsterId: result.defeatedMonsterId, winnerPlayer: result.winnerPlayer, winnerName: result.winnerName, defeatedName: result.defeatedName, winnerHealth: result.winnerHealth, loserWeighIn: result.loserWeighIn, rolls: result.rolls, attacks: result.attacks, victoryType: result.state.victoryType, nextPhase: result.state.phase };
    return { state: appendEvent(result.state, "challenge.resolved", eventPayload), eventType: "challenge.resolved", eventPayload };
  }
  if (command.type === "pass-move") {
    requireDecision("monster-movement");
    if (state.phase !== "move") throw new Error("Move has already been resolved.");
    const monsterId = state.monsters[state.currentPlayer]?.id;
    if (!monsterId) throw new Error("The monster movement decision has already been resolved.");
    const next = structuredClone(state);
    const alreadyMoved = (next.movedPieceIds ?? []).includes(monsterId);
    if (!alreadyMoved) next.movedPieceIds = [...(next.movedPieceIds ?? []), monsterId];
    next.phase = next.encounterSuppressed ? "deploy" : next.pendingBattles.length > 0 ? "fight" : "encounter";
    if (next.phase === "deploy") {
      next.deploymentsThisTurn = 0;
      next.deploymentDestinations = [];
    }
    next.pendingDecision = next.pendingBattles[0]
      ? { type: "battle-resolution", playerIndex: next.currentPlayer, battleId: next.pendingBattles[0].id }
      : next.phase === "encounter"
        ? { type: "encounter-resolution", playerIndex: next.currentPlayer, location: next.monsters[next.currentPlayer].location as HexKey }
        : { type: "deployment", playerIndex: next.currentPlayer };
    next.log.push(next.phase === "deploy" ? `${next.monsters[next.currentPlayer].name} has no Encounter after returning to its lair.` : `${next.monsters[next.currentPlayer].name} stays in place; resolve the Encounter step.`);
    const eventPayload = { location: next.monsters[next.currentPlayer].location };
    return { state: appendEvent(next, "monster.stayed", eventPayload), eventType: "monster.stayed", eventPayload };
  }
  if (command.type === "disappear-monster") {
    requireDecision("monster-movement");
    const monster = state.monsters[state.currentPlayer];
    if (!monster || monster.location === "hollywood") throw new Error("A Hollywood monster cannot disappear.");
    if ((state.movedPieceIds ?? []).includes(monster.id)) throw new Error("The monster movement decision has already been resolved.");
    if (!state.setupAssignments?.some((seat) => seat.monsterId === monster.id && seat.lair)) throw new Error("Monster disappearance requires a verified setup lair.");
    const next = structuredClone(state);
    next.monsters[next.currentPlayer].location = "disappeared";
    clearPendingChallengerIfLost(next, next.monsters[next.currentPlayer].id);
    next.movedPieceIds = [...(next.movedPieceIds ?? []), monster.id];
    next.encounterSuppressed = true;
    next.phase = "deploy";
    next.deploymentsThisTurn = 0;
    next.deploymentDestinations = [];
    next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
    next.log.push(`${monster.name} disappeared instead of moving; it will return to its lair next turn.`);
    const eventPayload = { monsterId: monster.id, nextPhase: next.phase };
    return { state: appendEvent(next, "monster.disappeared", eventPayload), eventType: "monster.disappeared", eventPayload };
  }
  if (command.type === "move") {
    requireDecision("monster-movement");
    const next = moveMonster(state, state.monsters[state.currentPlayer].id, command.path);
    if (next === state) throw new Error("That move is not legal in the current phase.");
    const eventPayload = { path: command.path, destination: command.path.at(-1) };
    return { state: appendEvent(next, "monster.moved", eventPayload), eventType: "monster.moved", eventPayload };
  }
  if (command.type === "move-unit") {
    requireDecision("monster-movement");
    const next = moveUnit(state, command.unitId, command.path);
    if (next === state) throw new Error("That unit move is not legal in the current phase.");
    const eventPayload = { unitId: command.unitId, path: command.path, destination: command.path.at(-1) };
    return { state: appendEvent(next, "unit.moved", eventPayload), eventType: "unit.moved", eventPayload };
  }
  if (state.phase === "fight" && command.type === "retreat") {
    requireDecision("retreat");
    const retreat = state.pendingRetreat;
    if (!retreat) throw new Error("There is no retreat decision to resolve.");
    const requestedIds = Object.keys(command.destinations).sort();
    const expectedIds = [...retreat.unitIds].sort();
    if (requestedIds.join("|") !== expectedIds.join("|")) throw new Error("Every surviving military unit must receive one retreat destination.");
    const next = structuredClone(state);
    const disappearedIds: string[] = [];
    for (const unitId of retreat.unitIds) {
      const destination = command.destinations[unitId];
      const allowed = retreat.options[unitId] ?? [];
      const unit = next.units.find((candidate) => candidate.id === unitId);
      if (!unit) throw new Error(`Unknown retreat unit: ${unitId}.`);
      if (destination === "disappeared") {
        if (allowed.length > 0) throw new Error(`Unit ${unitId} has a legal retreat and cannot disappear in the development ruleset.`);
        unit.location = "disappeared";
        disappearedIds.push(unitId);
      } else {
        if (!allowed.includes(destination)) throw new Error(`Illegal retreat destination for ${unitId}: ${destination}.`);
        unit.location = destination;
      }
    }
    next.pendingBattles = next.pendingBattles.filter((battle) => battle.id !== retreat.battleId);
    next.pendingRetreat = undefined;
    next.encounterSuppressed = true;
    const researchCardId = retreat.researchPlayerIndex === undefined ? undefined : drawResearchCardForPlayer(next, retreat.researchPlayerIndex);
    if (researchCardId) next.log.push(`Player ${retreat.researchPlayerIndex! + 1} drew a Military Research card after forcing the monster to retreat.`);
    finishBattleQueue(next);
    const eventPayload = { battleId: retreat.battleId, destinations: command.destinations, disappearedUnitIds: disappearedIds, researchCardId, researchAwarded: Boolean(researchCardId), nextPhase: next.phase };
    return { state: appendEvent(next, "retreat.resolved", eventPayload), eventType: "retreat.resolved", eventPayload };
  }
  if (state.phase === "fight" && (command.type === "resolve-fight" || command.type === "advance")) {
    const attackDecision = state.pendingDecision?.type === "attack-target" ? state.pendingDecision : undefined;
    if (attackDecision) {
      if (command.type !== "resolve-fight" || command.battleId !== attackDecision.battleId || !command.targetUnitId) throw new Error("Choose a legal target before resolving this attack.");
      if (!attackDecision.targetIds.includes(command.targetUnitId)) throw new Error("That unit is not a legal battle target.");
      const selectedUnit = state.units.find((unit) => unit.id === command.targetUnitId);
      const selectedBattle = state.pendingBattles.find((battle) => battle.id === attackDecision.battleId);
      if (!selectedUnit || !selectedBattle || selectedUnit.location !== selectedBattle.location) throw new Error("That battle target is no longer present.");
      const result = resolvePendingMultiTargetFight(state, command.targetUnitId);
      const eventType = result.state.pendingAttackTarget ? "battle.target-required" : "fight.resolved";
      const eventPayload = { battleId: attackDecision.battleId, targetUnitId: command.targetUnitId, remainingBattleIds: result.state.pendingBattles.map((battle) => battle.id), combatRounds: result.combatRounds, rolls: result.rolls, destroyedUnitIds: result.destroyedUnitIds, attacks: result.attacks, infamySpent: result.infamySpent, hollywoodResearchCardId: result.hollywoodResearchCardId, hollywoodResearchAwarded: Boolean(result.hollywoodResearchCardId), nextPhase: result.state.phase, nextDecision: result.state.pendingDecision };
      return { state: appendEvent(result.state, eventType, eventPayload), eventType, eventPayload };
    }
    requireDecision("battle-resolution");
    if (command.type === "resolve-fight" && command.battleId && !state.pendingBattles.some((battle) => battle.id === command.battleId)) {
      throw new Error(`Unknown pending battle: ${command.battleId}.`);
    }
    const selectedBattle = state.pendingBattles.find((battle) => battle.id === (command.type === "resolve-fight" ? command.battleId : undefined)) ?? state.pendingBattles[0];
    if (selectedBattle && selectedBattle.militaryUnitIds.length > 1 && command.type === "resolve-fight" && !command.targetUnitId) {
      const targetIds = selectedBattle.militaryUnitIds.filter((unitId) => state.units.some((unit) => unit.id === unitId && unit.location === selectedBattle.location));
      if (targetIds.length > 1) {
        const next = structuredClone(state);
        const monster = state.monsters.find((candidate) => candidate.id === selectedBattle.monsterId);
        const spendInfamy = command.type === "resolve-fight" ? command.spendInfamy ?? 0 : 0;
        if (!Number.isInteger(spendInfamy) || spendInfamy < 0 || spendInfamy > (monster?.infamy ?? 0)) throw new GameDomainError("ILLEGAL_COMMAND", "A monster cannot spend more Infamy than it currently has.");
        const attackTotal = (monster?.attacks ?? 0) + spendInfamy;
        next.pendingAttackTarget = { battleId: selectedBattle.id, attackerId: selectedBattle.monsterId, targetIds, round: 1, attackNumber: 1, attackTotal, spendInfamy };
        next.pendingDecision = { type: "attack-target", playerIndex: next.currentPlayer, battleId: selectedBattle.id, attackerId: selectedBattle.monsterId, targetIds, round: 1, attackNumber: 1, attackTotal };
        next.log.push(`Choose the target for ${monster?.name ?? "the monster"}'s attack 1 of ${attackTotal} in combat round 1.`);
        const eventPayload = { battleId: selectedBattle.id, attackerId: selectedBattle.monsterId, targetIds, round: 1, attackNumber: 1, attackTotal, infamySpent: spendInfamy, nextPhase: next.phase };
        return { state: appendEvent(next, "battle.target-required", eventPayload), eventType: "battle.target-required", eventPayload };
      }
    }
    const result = resolveFightResult(state, command.type === "resolve-fight" ? command.battleId : undefined, command.type === "resolve-fight" ? command.spendInfamy ?? 0 : 0, command.type === "resolve-fight" ? command.targetUnitId : undefined);
    const eventPayload = { battleId: command.type === "resolve-fight" ? command.battleId : state.pendingBattles[0]?.id, targetUnitId: command.type === "resolve-fight" ? command.targetUnitId : undefined, remainingBattleIds: result.state.pendingBattles.map((battle) => battle.id), combatRounds: result.combatRounds, rolls: result.rolls, destroyedUnitIds: result.destroyedUnitIds, attacks: result.attacks, infamySpent: result.infamySpent, hollywoodResearchCardId: result.hollywoodResearchCardId, hollywoodResearchAwarded: Boolean(result.hollywoodResearchCardId), nextPhase: result.state.phase };
    return { state: appendEvent(result.state, "fight.resolved", eventPayload), eventType: "fight.resolved", eventPayload };
  }
  if (state.phase === "encounter" && (command.type === "resolve-encounter" || command.type === "advance")) {
    const decision = state.pendingDecision;
    if (decision?.type === "trophy-choice") {
      if (command.type !== "resolve-encounter" || !command.trophyUnitId) throw new Error("The branch owner must choose a trophy unit before continuing.");
      const pendingTrophy = state.pendingTrophyChoice;
      if (!pendingTrophy || decision.playerIndex !== pendingTrophy.playerIndex || !pendingTrophy.unitIds.includes(command.trophyUnitId)) throw new Error("That unit is not a legal trophy choice.");
      const next = structuredClone(state);
      const trophy = next.units.find((unit) => unit.id === command.trophyUnitId);
      if (!trophy || trophy.location === "permanently-removed" || !(trophy.location === "record-tile" || isHexKey(trophy.location))) throw new Error("That unit is no longer available as a trophy.");
      trophy.location = "permanently-removed";
      next.removedUnitIds = [...new Set([...next.removedUnitIds, trophy.id])];
      next.pendingTrophyChoice = undefined;
      next.phase = "deploy";
      next.deploymentsThisTurn = 0;
      next.deploymentDestinations = [];
      next.pendingDecision = { type: "deployment", playerIndex: next.currentPlayer };
      next.log.push(`${trophy.branch} ${trophy.unitTypeId ?? trophy.id} became a permanent trophy.`);
      const eventPayload = { location: pendingTrophy.location, branch: pendingTrophy.branch, unitId: trophy.id, nextPhase: next.phase };
      return { state: appendEvent(next, "trophy.chosen", eventPayload), eventType: "trophy.chosen", eventPayload };
    }
    if (!decision || (decision.type !== "encounter-resolution" && decision.type !== "encounter-choice") || decision.playerIndex !== state.currentPlayer) {
      throw new Error("The authoritative pending decision is not encounter resolution.");
    }
    if (decision.type === "encounter-choice" && command.type === "advance") {
      throw new Error("A city benefit choice is required before resolving the Encounter.");
    }
    if (decision.type === "encounter-choice" && command.type === "resolve-encounter" && !command.choice) {
      throw new Error("A city benefit choice is required before resolving the Encounter.");
    }
    const result = resolveEncounterResult(state, command.type === "resolve-encounter" ? command.choice : undefined);
    const location = state.monsters[state.currentPlayer]?.location;
    const eventPayload = { location, stomped: isHexKey(location) && !(state.stompedLocations ?? []).includes(location), effects: result.effects, rolls: result.rolls, remainingStompMarkers: result.state.stompMarkers, choices: result.state.pendingEncounterChoice?.choices, challenge: result.state.challenge ? { declared: result.state.challenge.declared, active: result.state.challenge.active, challengerMonsterId: result.state.challenge.challengerMonsterId, pendingStartPlayerIndex: result.state.challenge.pendingStartPlayerIndex, startAtEndOfTurn: result.state.challenge.startAtEndOfTurn } : undefined, nextPhase: result.state.phase };
    const eventType = result.state.pendingEncounterChoice ? "encounter.choice-required" : result.state.pendingTrophyChoice ? "trophy.choice-required" : "encounter.resolved";
    return { state: appendEvent(result.state, eventType, eventPayload), eventType, eventPayload };
  }
  if (state.phase === "deploy" && command.type === "draw-research") {
    requireDecision("deployment");
    const result = drawResearchForDeployment(state);
    const eventPayload = { cardId: result.cardId, playerIndex: state.currentPlayer, nextPlayer: result.state.currentPlayer, nextPhase: result.state.phase, recoveryRoll: result.recoveryRoll, recoveryReleased: result.recoveryReleased };
    return { state: appendEvent(result.state, "research.drawn", eventPayload), eventType: "research.drawn", eventPayload };
  }
  if (state.phase === "deploy" && command.type === "redeploy") {
    requireDecision("deployment");
    const result = redeployUnitResult(state, command);
    const eventPayload = { unitId: result.unitId, branch: result.branch, destination: result.destination, deploymentsThisTurn: result.state.deploymentsThisTurn, nextPhase: result.state.phase };
    return { state: appendEvent(result.state, "unit.redeployed", eventPayload), eventType: "unit.redeployed", eventPayload };
  }
  if (state.phase === "deploy" && (command.type === "deploy" || command.type === "advance")) {
    requireDecision("deployment");
    const result = deployUnitResult(state, command.type === "deploy" ? command : undefined);
    const eventPayload = { unitId: result.unitId, branch: result.branch, destination: result.destination, deploymentsThisTurn: result.state.deploymentsThisTurn, nextPlayer: result.state.currentPlayer, nextPhase: result.state.phase };
    return { state: appendEvent(result.state, "unit.deployed", eventPayload), eventType: "unit.deployed", eventPayload };
  }
  if (state.phase === "deploy" && command.type === "pass-deploy") {
    requireDecision("deployment");
    const next = structuredClone(state);
    const recovery = advanceAfterDeployment(next);
    next.log.push("Deployment passed; the next player begins Move.");
    const eventPayload = { nextPlayer: next.currentPlayer, nextPhase: next.phase, recoveryRoll: recovery.recoveryRoll, recoveryReleased: recovery.recoveryReleased };
    return { state: appendEvent(next, "turn.passed", eventPayload), eventType: "turn.passed", eventPayload };
  }
  throw new Error("There is no advance action available in the current phase.");
}

function appendEvent(state: GameState, eventType: string, detail: Record<string, unknown>, actorId?: string): GameState {
  const next = structuredClone(state);
  // Every successful command crosses this event boundary. Re-check the
  // conservation invariant after mutation so a command cannot return a state
  // that was valid only at its input boundary.
  assertInventoryAccounting(next);
  if (!Array.isArray(next.eventLog)) next.eventLog = [];
  next.eventLog.push({ id: `${next.round}:${next.eventLog.length}`, actorId, action: eventType, outcome: eventType.split(".").at(-1) ?? eventType, detail });
  return next;
}

export function assertSupportedStateVersion(state: Pick<GameState, "schemaVersion">): void {
  if (state.schemaVersion !== MATCH_STATE_SCHEMA_VERSION) {
    throw new GameDomainError("INVALID_COMMAND_ENVELOPE", `Unsupported match-state schema: ${String(state.schemaVersion)}.`);
  }
}

/** Validate the transport-level command contract before entering the rules boundary. */
export function applyCommandEnvelope(state: GameState, envelope: GameCommandEnvelope, actualRevision: number): CommandResult {
  if (!envelope.actionId || !envelope.actorId || !Number.isInteger(envelope.expectedRevision)) {
    throw new GameDomainError("INVALID_COMMAND_ENVELOPE", "A command requires actionId, actorId, and an integer expectedRevision.");
  }
  if (envelope.protocolVersion !== COMMAND_PROTOCOL_VERSION) {
    throw new GameDomainError("UNSUPPORTED_PROTOCOL", `Unsupported command protocol: ${envelope.protocolVersion}.`);
  }
  if (envelope.expectedRevision !== actualRevision) {
    throw new GameDomainError("STALE_REVISION", `Expected revision ${envelope.expectedRevision}, current revision is ${actualRevision}.`);
  }
  let result: GameEventResult;
  try {
    result = applyCommand(state, envelope.command);
  } catch (error) {
    throw new GameDomainError("ILLEGAL_COMMAND", error instanceof Error ? error.message : "Command is not legal.");
  }
  const next = structuredClone(result.state);
  const last = next.eventLog.at(-1);
  if (last) next.eventLog[next.eventLog.length - 1] = { ...last, actorId: envelope.actorId };
  return {
    ...result,
    state: next,
    receipt: { actionId: envelope.actionId, actorId: envelope.actorId, revision: actualRevision + 1, eventType: result.eventType }
  };
}
