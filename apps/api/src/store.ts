import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setupDeploymentState, applyCommandEnvelope, applyCompletedSetup, applySetupAction, chooseBotCommand, chooseBotSetupAction, createMvpRoomGame, createRoomGame, legalLaserFenceTargets, projectState, redactCardIdentifiers, type GameCommandEnvelope, type GameState, type SetupAction, type StateAudience } from "@abominations/game-engine";
import { knownRoomEventType, type JsonValue, type PublicRoomSummary, type RoomEvent, type RoomParticipantView, type RoomPrivacy, type RoomStatus, type RoomView, type SessionResponse } from "@abominations/shared";
import { isSessionExpired, sessionExpiresAt } from "./session.js";
import { emptyMatchCounters, updateMatchCounters, type MatchCounters } from "./player-stats.js";

type StoredParticipant = RoomParticipantView & { tokenHash: string; sessionExpiresAt: number; connectionId?: string; disconnectedAt?: number };
type StoredRoom = { id: string; code: string; status: RoomStatus; privacy: RoomPrivacy; maxPlayers: number; version: number; state: GameState; participants: StoredParticipant[]; events: RoomEvent[]; playerStats: MatchCounters[]; lastActivityAt: number };
export interface RoomSocketPrincipal { roomCode: string; participantId: string; sessionHash: string; connectionId: string }
export interface RoomSocketTicket { ticket: string; connectionId: string }
export const ROOM_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const MAX_RETAINED_ROOM_EVENTS = 256;
const CANCELLED_CONNECTION_PREFIX = "cancelled:";
export const cancelledConnectionId = (pendingConnectionId: string) => `${CANCELLED_CONNECTION_PREFIX}${pendingConnectionId}`;
export const cancelledPendingConnectionId = (connectionId: string | null | undefined) => connectionId?.startsWith(CANCELLED_CONNECTION_PREFIX)
  ? connectionId.slice(CANCELLED_CONNECTION_PREFIX.length)
  : undefined;

export function mutationBattleOwner(state: GameState, envelope: GameCommandEnvelope): number | undefined {
  const command = envelope.command;
  if (command.type !== "use-mutation") return undefined;
  if (state.phase === "fight") {
    const decision = state.pendingDecision;
    if (!decision || (decision.type !== "battle-resolution" && decision.type !== "attack-target")) return undefined;
    const battleId = command.battleId ?? decision.battleId;
    if (battleId !== decision.battleId) return undefined;
    const battle = state.pendingBattles.find((candidate) => candidate.id === battleId);
    return battle ? state.monsters.findIndex((monster) => monster.id === battle.monsterId) : undefined;
  }
  if (state.phase === "challenge" && state.challenge?.active && state.challenge.turn
    && (state.challenge.opponentMonsterId || state.challenge.giantUnitId)
    && (state.pendingDecision?.type === "challenge-resolution" || state.pendingDecision?.type === "challenge-giant-resolution")) {
    const participants = [state.challenge.challengerMonsterId, state.challenge.opponentMonsterId].filter((id): id is string => Boolean(id));
    for (const id of participants) {
      const monsterIndex = state.monsters.findIndex((monster) => monster.id === id);
      if (monsterIndex >= 0 && state.players[monsterIndex]?.mutationCardIds.includes(command.cardId)) return monsterIndex;
    }
  }
  return undefined;
}

/** The face-up Research holder owns a live Laser Fence reaction, even off-turn. */
export function laserFenceCardOwner(state: GameState, envelope: GameCommandEnvelope): number | undefined {
  const command = envelope.command;
  if (command.type !== "use-research" || command.cardId !== "Laser Fence") return undefined;
  const targetMonsterId = command.targetMonsterId ?? (command.battleId
    ? state.pendingBattles.find((battle) => battle.id === command.battleId)?.monsterId
    : undefined);
  if (!targetMonsterId || !legalLaserFenceTargets(state).some((target) => target.targetMonsterId === targetMonsterId)) return undefined;
  return state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
}

export function terminalResultSummary(state: GameState, terminalEvent: { type: string; version: number }): Record<string, unknown> {
  return {
    winnerPlayer: state.winnerPlayer,
    victoryType: state.victoryType,
    rulesetVersion: state.rulesetVersion,
    durationRounds: state.round,
    terminalEvent,
    finalStandings: state.monsters.map((monster, playerIndex) => ({
      playerIndex,
      playerId: state.players[playerIndex]?.id,
      monsterId: monster.id,
      monsterName: monster.name,
      health: monster.health,
      infamy: monster.infamy,
      location: monster.location,
      winner: playerIndex === state.winnerPlayer,
    })),
  };
}

export interface RoomStore {
  close(): Promise<void>;
  health(): Promise<{ persistence: "memory" | "prisma" }>;
  createRoom(maxPlayers: number, displayName?: string, privacy?: RoomPrivacy): Promise<SessionResponse>;
  listPublicRooms(): Promise<PublicRoomSummary[]>;
  joinRoom(code: string, displayName: string): Promise<SessionResponse>;
  spectateRoom(code: string, displayName: string): Promise<SessionResponse>;
  disconnect(code: string, token: string, connectionId?: string, pendingConnectionId?: string): Promise<RoomView>;
  reconnect(code: string, token: string, expectedConnectionId?: string, connectionId?: string): Promise<RoomView>;
  rotateSession(code: string, token: string): Promise<SessionResponse>;
  setReady(code: string, token: string, ready: boolean): Promise<RoomView>;
  setupAction(code: string, token: string, action: SetupAction, expectedRevision: number): Promise<RoomView>;
  getRoom(code: string, token: string, afterVersion?: number): Promise<RoomView>;
  submitAction(code: string, token: string, envelope: GameCommandEnvelope): Promise<RoomView>;
  createSocketTicket(code: string, token: string, expectedConnectionId?: string | null, requestedConnectionId?: string): Promise<RoomSocketTicket>;
  consumeSocketTicket(code: string, ticket: string): Promise<RoomSocketPrincipal>;
  participantIdForToken(code: string, token: string): Promise<string>;
  getRoomForParticipant(code: string, participantId: string, afterVersion?: number): Promise<RoomView>;
  getRoomForConnection(code: string, participantId: string, connectionId: string, sessionHash: string, afterVersion?: number): Promise<RoomView | undefined>;
  submitActionForParticipant(code: string, participantId: string, connectionId: string, sessionHash: string, envelope: GameCommandEnvelope): Promise<RoomView>;
  connectParticipant(code: string, participantId: string, connectionId: string, sessionHash: string): Promise<RoomView>;
  disconnectParticipant(code: string, participantId: string, connectionId?: string): Promise<RoomView>;
  processBotTakeovers(now?: number): Promise<string[]>;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const now = () => new Date().toISOString();
const gameSeed = () => randomBytes(4).readUInt32LE(0);

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, StoredRoom>();
  private actionIds = new Set<string>();
  private socketTickets = new Map<string, { roomCode: string; participantId: string; sessionHash: string; connectionId: string; expiresAt: number }>();

  constructor(private readonly allowDevelopmentFixture = false) {}

  async close(): Promise<void> {}

  async health(): Promise<{ persistence: "memory" }> { return { persistence: "memory" }; }

  async createRoom(maxPlayers: number, displayName = "Player 1", privacy: RoomPrivacy = "private"): Promise<SessionResponse> {
    const id = randomBytes(12).toString("hex");
    const roomCode = code();
    const seed = gameSeed();
    const state = this.allowDevelopmentFixture
      ? createRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`)
      : createMvpRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`);
    if (privacy !== "private" && privacy !== "public") throw new Error("Room privacy must be private or public.");
    const room: StoredRoom = { id, code: roomCode, status: "waiting", privacy, maxPlayers, version: 0, state, participants: [], events: [], playerStats: emptyMatchCounters(maxPlayers), lastActivityAt: Date.now() };
    this.rooms.set(room.code, room);
    return this.addParticipant(room, displayName, "player", 0);
  }

  async listPublicRooms(): Promise<PublicRoomSummary[]> {
    for (const room of this.rooms.values()) this.refreshStatus(room);
    return [...this.rooms.values()]
      .filter((room) => room.privacy === "public" && (room.status === "waiting" || room.status === "active"))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 20)
      .map((room) => ({
        code: room.code,
        status: room.status as "waiting" | "active",
        maxPlayers: room.maxPlayers,
        playerCount: room.participants.filter((participant) => participant.role === "player").length,
        spectatorCount: room.participants.filter((participant) => participant.role === "spectator").length,
      }));
  }

  async joinRoom(roomCode: string, displayName: string) {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") throw new Error("This room has expired.");
    const players = room.participants.filter((participant) => participant.role === "player");
    if (players.length >= room.maxPlayers) throw new Error("This room is full.");
    const playerIndex = players.length;
    const session = this.addParticipant(room, displayName, "player", playerIndex);
    this.touch(room);
    this.refreshStatus(room);
    session.room = this.view(room, 0, "player", playerIndex);
    return session;
  }

  async spectateRoom(roomCode: string, displayName: string) {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") throw new Error("This room has expired.");
    if (room.privacy === "private") throw new Error("This room is private and does not allow spectator entry.");
    const session = this.addParticipant(room, displayName || "Spectator", "spectator");
    this.touch(room);
    return session;
  }

  async disconnect(roomCode: string, accessToken: string, connectionId = "legacy", pendingConnectionId?: string) {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    if (pendingConnectionId) {
      if (participant.connectionId && participant.connectionId !== connectionId && participant.connectionId !== pendingConnectionId) return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
      // Preserve the cancelled lease in the existing connectionId field. This
      // lets a late reconnect be rejected without adding a persistence column.
      participant.connectionId = cancelledConnectionId(pendingConnectionId);
    } else if (participant.connectionId && participant.connectionId !== connectionId) {
      return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
    }
    participant.connected = false;
    participant.disconnectedAt = Date.now();
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async reconnect(roomCode: string, accessToken: string, expectedConnectionId = "legacy", connectionId = expectedConnectionId) {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    if (cancelledPendingConnectionId(participant.connectionId)) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    const retryingSameLease = participant.connectionId === connectionId;
    if (!retryingSameLease && participant.connectionId && participant.connectionId !== expectedConnectionId) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    if (retryingSameLease && participant.connected) {
      this.refreshStatus(room);
      return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
    }
    participant.connected = true;
    participant.disconnectedAt = undefined;
    participant.botControlled = false;
    participant.connectionId = connectionId;
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async rotateSession(roomCode: string, accessToken: string): Promise<SessionResponse> {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    participant.sessionExpiresAt = sessionExpiresAt().getTime();
    const replacement = token();
    participant.tokenHash = hash(replacement);
    participant.connected = false;
    participant.connectionId = undefined;
    participant.disconnectedAt = Date.now();
    return { room: this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex), participantId: participant.id, token: replacement };
  }

  async setReady(roomCode: string, accessToken: string, ready: boolean) {
    const room = this.authorize(roomCode, accessToken);
    if (room.status !== "waiting") throw new Error("Readiness can only change while a room is waiting.");
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant || participant.role !== "player") throw new Error("Only players can change readiness.");
    if (!participant.connected) throw new Error("Reconnect before changing readiness.");
    participant.ready = ready;
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, "player", participant.playerIndex);
  }

  async setupAction(roomCode: string, accessToken: string, action: SetupAction, expectedRevision: number) {
    const room = this.authorize(roomCode, accessToken);
    if (room.status === "expired") throw new Error("This room has expired.");
    if (room.version !== expectedRevision) throw new Error(`Expected revision ${expectedRevision}, current revision is ${room.version}.`);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant || participant.role !== "player" || participant.playerIndex === undefined) throw new Error("Only seated players can complete setup.");
    if (!room.state.setupState) throw new Error("This room has no setup state.");
    const nextSetup = applySetupAction(room.state.setupState, participant.playerIndex, action);
    if (action.type === "choose-starting-choice" && action.startingChoice.kind === "deploy") {
      const choice = action.startingChoice;
      setupDeploymentState(room.state, participant.playerIndex, "placements" in choice ? choice.placements : [choice]);
    }
    const setupState = { ...room.state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    room.state = nextSetup.phase === "complete" ? applyCompletedSetup(setupState) : setupState;
    this.touch(room);
    room.version += 1;
    room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: participant.id, type: knownRoomEventType("setup.updated"), payload: { phase: nextSetup.phase, action: action.type }, createdAt: now() });
    room.events.length = Math.min(room.events.length, MAX_RETAINED_ROOM_EVENTS);
    this.refreshStatus(room);
    return this.view(room, 0, "player", participant.playerIndex);
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const room = this.authorize(roomCode, accessToken);
    const viewer = room.participants.find((participant) => participant.tokenHash === hash(accessToken));
    return this.view(room, afterVersion, viewer?.role === "player" ? "player" : "spectator", viewer?.playerIndex);
  }

  async submitAction(roomCode: string, accessToken: string, envelope: GameCommandEnvelope) {
    const room = this.authorize(roomCode, accessToken);
    const actor = room.participants.find((participant) => participant.tokenHash === hash(accessToken));
    if (!actor || actor.role !== "player") throw new Error("Spectators cannot submit game actions.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    if (this.actionIds.has(`${room.id}:${envelope.actionId}`)) return this.view(room, 0, "player", actor.playerIndex);
    if (room.status === "completed") throw new Error("This room is completed; no further gameplay actions are legal.");
    if (room.status !== "active") throw new Error("This room is not ready for gameplay.");
    const requiredPlayer = laserFenceCardOwner(room.state, envelope) ?? mutationBattleOwner(room.state, envelope) ?? (room.state.pendingDecision?.type === "trophy-choice" || room.state.pendingDecision?.type === "mutation-choice"
      ? room.state.pendingDecision.playerIndex
      : room.state.currentPlayer);
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    return this.applyRoomCommand(room, actor, envelope, "human");
  }

  async createSocketTicket(roomCode: string, accessToken: string, expectedConnectionId: string | null = null, requestedConnectionId?: string): Promise<RoomSocketTicket> {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    const currentConnectionId = participant.connectionId ?? null;
    const connectionId = requestedConnectionId ?? randomUUID();
    const retryingSameLease = currentConnectionId === connectionId && !participant.connected;
    if (currentConnectionId === connectionId && participant.connected) throw new Error("This room connection is already connected.");
    if (!retryingSameLease && currentConnectionId !== expectedConnectionId) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    for (const [ticketHash, record] of this.socketTickets) {
      if (record.participantId === participant.id) this.socketTickets.delete(ticketHash);
    }
    const ticket = `${token()}.${connectionId}`;
    // Issuance is the lease handoff point: delayed sockets using older tickets and
    // the currently connected socket stop being authoritative immediately.
    participant.connectionId = connectionId;
    participant.connected = false;
    participant.disconnectedAt = Date.now();
    this.touch(room);
    this.refreshStatus(room);
    this.socketTickets.set(hash(ticket), { roomCode: room.code, participantId: participant.id, sessionHash: participant.tokenHash, connectionId, expiresAt: Date.now() + 30_000 });
    return { ticket, connectionId };
  }

  async consumeSocketTicket(roomCode: string, ticket: string): Promise<RoomSocketPrincipal> {
    const ticketHash = hash(ticket);
    const record = this.socketTickets.get(ticketHash);
    if (!record || record.expiresAt <= Date.now() || record.roomCode !== roomCode.toUpperCase()) throw new Error("WebSocket ticket is invalid or expired.");
    this.socketTickets.delete(ticketHash);
    const room = this.rooms.get(record.roomCode);
    const participant = room?.participants.find((candidate) => candidate.id === record.participantId);
    if (!participant || participant.tokenHash !== record.sessionHash) throw new Error("WebSocket ticket was issued for a replaced room session.");
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    return { roomCode: record.roomCode, participantId: record.participantId, sessionHash: record.sessionHash, connectionId: record.connectionId };
  }

  async participantIdForToken(roomCode: string, accessToken: string): Promise<string> {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    return participant.id;
  }

  async getRoomForParticipant(roomCode: string, participantId: string, afterVersion = 0): Promise<RoomView> {
    const room = this.requireRoom(roomCode);
    const viewer = room.participants.find((participant) => participant.id === participantId);
    if (!viewer) throw new Error("Room participant not found.");
    return this.view(room, afterVersion, viewer.role === "player" ? "player" : "spectator", viewer.playerIndex);
  }

  async getRoomForConnection(roomCode: string, participantId: string, connectionId: string, sessionHash: string, afterVersion = 0): Promise<RoomView | undefined> {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") return undefined;
    const participant = room.participants.find((candidate) => candidate.id === participantId);
    if (!participant || isSessionExpired(participant.sessionExpiresAt) || !participant.connected || participant.connectionId !== connectionId || participant.tokenHash !== sessionHash) return undefined;
    return this.view(room, afterVersion, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async submitActionForParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string, envelope: GameCommandEnvelope): Promise<RoomView> {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") throw new Error("This room has expired.");
    const actor = room.participants.find((candidate) => candidate.id === participantId);
    if (!actor || actor.role !== "player") throw new Error("Spectators cannot submit game actions.");
    if (isSessionExpired(actor.sessionExpiresAt)) throw new Error("Session token has expired.");
    if (!actor.connected || actor.connectionId !== connectionId || actor.tokenHash !== sessionHash) throw new Error("This WebSocket connection has been replaced. Reconnect to continue.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    if (this.actionIds.has(`${room.id}:${envelope.actionId}`)) return this.view(room, 0, "player", actor.playerIndex);
    if (room.status !== "active") throw new Error("This room is not ready for gameplay.");
    const requiredPlayer = this.requiredPlayer(room.state, envelope);
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    return this.applyRoomCommand(room, actor, envelope, "human");
  }

  async disconnectParticipant(roomCode: string, participantId: string, connectionId = "legacy"): Promise<RoomView> {
    const room = this.requireRoom(roomCode);
    const participant = room.participants.find((candidate) => candidate.id === participantId);
    if (!participant) throw new Error("Room participant not found.");
    if (participant.connectionId && participant.connectionId !== connectionId) return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
    participant.connected = false;
    participant.disconnectedAt = Date.now();
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async connectParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string): Promise<RoomView> {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") throw new Error("This room has expired.");
    const participant = room.participants.find((candidate) => candidate.id === participantId);
    if (!participant) throw new Error("Room participant not found.");
    if (participant.tokenHash !== sessionHash) throw new Error("WebSocket ticket was issued for a replaced room session.");
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    if (participant.connectionId !== connectionId) throw new Error("WebSocket ticket was replaced by a newer connection.");
    if (participant.connected) throw new Error("This room connection is already connected.");
    participant.connected = true;
    participant.disconnectedAt = undefined;
    participant.botControlled = false;
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async processBotTakeovers(nowMs = Date.now()): Promise<string[]> {
    const updated: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.status === "completed" || room.status === "expired") continue;
      for (const participant of room.participants) {
        if (participant.role === "player" && !participant.connected && participant.disconnectedAt !== undefined && nowMs - participant.disconnectedAt >= 4 * 60_000 && !participant.botControlled) {
          participant.botControlled = true;
          participant.botAssisted = true;
          updated.push(room.code);
        }
      }
      for (let step = 0; step < 12; step += 1) {
        const setup = room.state.setupState;
        if (setup && setup.phase !== "complete") {
          const setupPlayer = this.nextSetupPlayer(setup);
          const actor = room.participants.find((candidate) => candidate.playerIndex === setupPlayer && candidate.role === "player");
          if (!actor?.botControlled) break;
          const nextSetup = chooseBotSetupAction(room.state, setup, setupPlayer);
          if (nextSetup === setup) break;
          const seat = nextSetup.seats.find((candidate) => candidate.playerIndex === setupPlayer);
          if (seat?.startingChoice?.kind === "deploy") setupDeploymentState({ ...room.state, setupState: nextSetup }, setupPlayer, "placements" in seat.startingChoice ? seat.startingChoice.placements : [seat.startingChoice]);
          const setupState = { ...room.state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
          room.state = nextSetup.phase === "complete" ? applyCompletedSetup(setupState) : setupState;
          actor.ready = Boolean(seat?.startingChoice);
          this.touch(room);
          room.version += 1;
          room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: actor.id, type: knownRoomEventType("setup.updated"), controlSource: "bot", payload: { phase: nextSetup.phase, automated: true }, createdAt: now() });
          room.events.length = Math.min(room.events.length, MAX_RETAINED_ROOM_EVENTS);
          this.refreshStatus(room);
          updated.push(room.code);
          continue;
        }
        this.refreshStatus(room);
        if (room.status !== "active") break;
        if (room.state.phase === "game-over") break;
        const botIndices = new Set(room.participants.filter((candidate) => candidate.role === "player" && candidate.botControlled && candidate.playerIndex !== undefined).map((candidate) => candidate.playerIndex!));
        const command = chooseBotCommand(room.state, botIndices);
        if (!command) break;
        const playerIndex = this.requiredPlayer(room.state, { actionId: "bot-probe", actorId: "bot-probe", expectedRevision: room.version, protocolVersion: 1, command });
        const actor = room.participants.find((candidate) => candidate.role === "player" && candidate.playerIndex === playerIndex);
        if (!actor?.botControlled) break;
        const envelope = { actionId: randomBytes(16).toString("hex"), actorId: actor.id, expectedRevision: room.version, protocolVersion: 1 as const, command };
        this.applyRoomCommand(room, actor, envelope, "bot");
        updated.push(room.code);
      }
    }
    return [...new Set(updated)];
  }

  private requiredPlayer(state: GameState, envelope?: GameCommandEnvelope): number {
    const specialOwner = envelope ? laserFenceCardOwner(state, envelope) ?? mutationBattleOwner(state, envelope) : undefined;
    if (specialOwner !== undefined) return specialOwner;
    const decision = state.pendingDecision;
    return decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
  }

  private nextSetupPlayer(setup: NonNullable<GameState["setupState"]>): number {
    const field = setup.phase === "monster-selection" ? "monsterId" : setup.phase === "branch-selection" ? "branch" : setup.phase === "lair-selection" ? "lair" : "startingChoice";
    const seats = [...setup.seats].sort((left, right) => setup.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
    return seats.find((seat) => seat[field] === undefined)?.playerIndex ?? -1;
  }

  private applyRoomCommand(room: StoredRoom, actor: StoredParticipant, envelope: GameCommandEnvelope, controlSource: "human" | "bot"): RoomView {
    const result = applyCommandEnvelope(room.state, envelope, room.version);
    room.playerStats = updateMatchCounters(room.state, result.state, room.playerStats, actor.playerIndex ?? 0);
    room.state = result.state;
    this.touch(room);
    room.version += 1;
    room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: actor.id, type: knownRoomEventType(result.eventType), controlSource, payload: { ...result.eventPayload, receipt: { ...result.receipt } }, createdAt: now() });
    room.events.length = Math.min(room.events.length, MAX_RETAINED_ROOM_EVENTS);
    this.actionIds.add(`${room.id}:${envelope.actionId}`);
    if (room.state.phase === "game-over") room.status = "completed";
    return this.view(room, 0, "player", actor.playerIndex);
  }

  private addParticipant(room: StoredRoom, displayName: string, role: "player" | "spectator", playerIndex?: number): SessionResponse {
    const accessToken = token();
    const participant: StoredParticipant = { id: randomBytes(10).toString("hex"), displayName: displayName.trim().slice(0, 32) || "Player", role, playerIndex, connected: true, ready: false, botControlled: false, botAssisted: false, tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt().getTime() };
    room.participants.push(participant);
    return { room: this.view(room), participantId: participant.id, token: accessToken };
  }

  private authorize(roomCode: string, accessToken: string) {
    const room = this.requireRoom(roomCode);
    if (room.status === "expired") throw new Error("This room has expired.");
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    return room;
  }

  private refreshStatus(room: StoredRoom) {
    if (room.status !== "completed" && Date.now() - room.lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
      room.status = "expired";
      return;
    }
    const players = room.participants.filter((participant) => participant.role === "player");
    const setupComplete = !room.state.setupState || room.state.setupState.phase === "complete";
    if (room.status === "completed" || room.status === "expired") return;
    if (room.status === "active") {
      room.status = players.length > 0 && players.every((participant) => !participant.connected) ? "abandoned" : "active";
      return;
    }
    if (room.status === "abandoned" && !(setupComplete && players.length === room.maxPlayers && players.every((participant) => participant.ready && (participant.connected || participant.botControlled)))) return;
    room.status = setupComplete && players.length === room.maxPlayers && players.every((participant) => participant.ready && (participant.connected || participant.botControlled)) ? "active" : "waiting";
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("Room not found.");
    this.refreshStatus(room);
    return room;
  }

  private touch(room: StoredRoom) {
    if (room.status !== "expired" && room.status !== "completed") room.lastActivityAt = Date.now();
  }

  private view(room: StoredRoom, afterVersion = 0, audience: StateAudience = "spectator", viewerPlayerIndex?: number): RoomView {
    return { id: room.id, code: room.code, status: room.status, privacy: room.privacy, version: room.version, state: projectState(room.state, audience, viewerPlayerIndex), participants: room.participants.map((participant) => ({ id: participant.id, displayName: participant.displayName, role: participant.role, playerIndex: participant.playerIndex, connected: participant.connected, ready: participant.ready, botControlled: participant.botControlled, botAssisted: participant.botAssisted })), events: room.events.filter((event) => event.version > afterVersion).map((event) => ({ ...event, payload: redactCardIdentifiers(event.payload) as JsonValue })) };
  }
}
