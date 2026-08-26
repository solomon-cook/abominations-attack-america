import { createHash, randomBytes } from "node:crypto";
import { applyCommandEnvelope, applySetupAction, createMvpRoomGame, createRoomGame, projectState, redactCardIdentifiers, type GameCommandEnvelope, type GameState, type SetupAction, type StateAudience } from "@abominations/game-engine";
import type { RoomEvent, RoomParticipantView, RoomStatus, RoomView, SessionResponse } from "@abominations/shared";

type StoredParticipant = RoomParticipantView & { tokenHash: string; connectionId?: string };
type StoredRoom = { id: string; code: string; status: RoomStatus; maxPlayers: number; version: number; state: GameState; participants: StoredParticipant[]; events: RoomEvent[]; lastActivityAt: number };
export const ROOM_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const MAX_RETAINED_ROOM_EVENTS = 256;

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
  createRoom(maxPlayers: number): Promise<SessionResponse>;
  joinRoom(code: string, displayName: string): Promise<SessionResponse>;
  spectateRoom(code: string, displayName: string): Promise<SessionResponse>;
  disconnect(code: string, token: string, connectionId?: string): Promise<RoomView>;
  reconnect(code: string, token: string, connectionId?: string): Promise<RoomView>;
  rotateSession(code: string, token: string): Promise<SessionResponse>;
  setReady(code: string, token: string, ready: boolean): Promise<RoomView>;
  setupAction(code: string, token: string, action: SetupAction, expectedRevision: number): Promise<RoomView>;
  getRoom(code: string, token: string, afterVersion?: number): Promise<RoomView>;
  submitAction(code: string, token: string, envelope: GameCommandEnvelope): Promise<RoomView>;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const now = () => new Date().toISOString();

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, StoredRoom>();
  private actionIds = new Set<string>();

  constructor(private readonly allowDevelopmentFixture = false) {}

  async close(): Promise<void> {}

  async health(): Promise<{ persistence: "memory" }> { return { persistence: "memory" }; }

  async createRoom(maxPlayers: number): Promise<SessionResponse> {
    const id = randomBytes(12).toString("hex");
    const roomCode = code();
    const state = this.allowDevelopmentFixture
      ? createRoomGame(maxPlayers as 2 | 3 | 4, 0, `room-${roomCode}`)
      : createMvpRoomGame(maxPlayers as 2 | 3 | 4, 0, `room-${roomCode}`);
    const room: StoredRoom = { id, code: roomCode, status: "waiting", maxPlayers, version: 0, state, participants: [], events: [], lastActivityAt: Date.now() };
    this.rooms.set(room.code, room);
    return this.addParticipant(room, "Player 1", "player", 0);
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
    const session = this.addParticipant(room, displayName || "Spectator", "spectator");
    this.touch(room);
    return session;
  }

  async disconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    if (participant.connectionId && participant.connectionId !== connectionId) return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
    participant.connected = false;
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async reconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    participant.connected = true;
    participant.connectionId = connectionId;
    this.touch(room);
    this.refreshStatus(room);
    return this.view(room, 0, participant.role === "player" ? "player" : "spectator", participant.playerIndex);
  }

  async rotateSession(roomCode: string, accessToken: string): Promise<SessionResponse> {
    const room = this.authorize(roomCode, accessToken);
    const participant = room.participants.find((candidate) => candidate.tokenHash === hash(accessToken));
    if (!participant) throw new Error("Invalid room token.");
    const replacement = token();
    participant.tokenHash = hash(replacement);
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
    room.state = { ...room.state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    this.touch(room);
    room.version += 1;
    room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: participant.id, type: "setup.updated", payload: { phase: nextSetup.phase, action: action.type }, createdAt: now() });
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
    if (room.status === "completed") throw new Error("This room is completed; no further gameplay actions are legal.");
    if (room.status !== "active") throw new Error("This room is not ready for gameplay.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    if (this.actionIds.has(`${room.id}:${envelope.actionId}`)) return this.view(room, 0, "player", actor.playerIndex);
    const requiredPlayer = room.state.pendingDecision?.type === "trophy-choice"
      ? room.state.pendingDecision.playerIndex
      : room.state.currentPlayer;
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    const result = applyCommandEnvelope(room.state, envelope, room.version);
    room.state = result.state;
    this.touch(room);
    room.version += 1;
    room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: actor.id, type: result.eventType, payload: { ...result.eventPayload, receipt: result.receipt }, createdAt: now() });
    room.events.length = Math.min(room.events.length, MAX_RETAINED_ROOM_EVENTS);
    this.actionIds.add(`${room.id}:${envelope.actionId}`);
    if (room.state.phase === "game-over") room.status = "completed";
    return this.view(room, 0, "player", actor.playerIndex);
  }

  private addParticipant(room: StoredRoom, displayName: string, role: "player" | "spectator", playerIndex?: number): SessionResponse {
    const accessToken = token();
    const participant: StoredParticipant = { id: randomBytes(10).toString("hex"), displayName: displayName.trim().slice(0, 32) || "Player", role, playerIndex, connected: true, ready: false, tokenHash: hash(accessToken) };
    room.participants.push(participant);
    return { room: this.view(room), participantId: participant.id, token: accessToken };
  }

  private authorize(roomCode: string, accessToken: string) {
    const room = this.requireRoom(roomCode);
    if (!room.participants.some((participant) => participant.tokenHash === hash(accessToken))) throw new Error("Invalid room token.");
    return room;
  }

  private refreshStatus(room: StoredRoom) {
    if (room.status !== "completed" && Date.now() - room.lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
      room.status = "expired";
      return;
    }
    const players = room.participants.filter((participant) => participant.role === "player");
    const setupComplete = !room.state.setupState || room.state.setupState.phase === "complete";
    if (room.status === "completed") return;
    if (room.status === "active") {
      room.status = players.length > 0 && players.every((participant) => !participant.connected) ? "abandoned" : "active";
      return;
    }
    if (room.status === "abandoned" && !(setupComplete && players.length === room.maxPlayers && players.every((participant) => participant.ready && participant.connected))) return;
    room.status = setupComplete && players.length === room.maxPlayers && players.every((participant) => participant.ready && participant.connected) ? "active" : "waiting";
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
    return { id: room.id, code: room.code, status: room.status, version: room.version, state: projectState(room.state, audience, viewerPlayerIndex), participants: room.participants.map(({ tokenHash: _tokenHash, ...participant }) => participant), events: room.events.filter((event) => event.version > afterVersion).map((event) => ({ ...event, payload: redactCardIdentifiers(event.payload) as Record<string, unknown> })) };
  }
}
