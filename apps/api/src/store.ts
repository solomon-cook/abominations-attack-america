import { createHash, randomBytes } from "node:crypto";
import { createGame, applyCommand, type GameCommand, type GameState } from "@abominations/game-engine";
import type { RoomEvent, RoomParticipantView, RoomStatus, RoomView, SessionResponse } from "@abominations/shared";

type StoredParticipant = RoomParticipantView & { tokenHash: string };
type StoredRoom = { id: string; code: string; status: RoomStatus; maxPlayers: number; version: number; state: GameState; participants: StoredParticipant[]; events: RoomEvent[] };

export interface RoomStore {
  createRoom(maxPlayers: number): Promise<SessionResponse>;
  joinRoom(code: string, displayName: string): Promise<SessionResponse>;
  spectateRoom(code: string, displayName: string): Promise<SessionResponse>;
  getRoom(code: string, token: string, afterVersion?: number): Promise<RoomView>;
  submitAction(code: string, token: string, actionId: string, command: GameCommand): Promise<RoomView>;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const now = () => new Date().toISOString();

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, StoredRoom>();
  private actionIds = new Set<string>();

  async createRoom(maxPlayers: number): Promise<SessionResponse> {
    const id = randomBytes(12).toString("hex");
    const room: StoredRoom = { id, code: code(), status: "waiting", maxPlayers, version: 0, state: createGame(2), participants: [], events: [] };
    this.rooms.set(room.code, room);
    return this.addParticipant(room, "Player 1", "player", 0);
  }

  async joinRoom(roomCode: string, displayName: string) {
    const room = this.requireRoom(roomCode);
    const players = room.participants.filter((participant) => participant.role === "player");
    if (players.length >= room.maxPlayers) throw new Error("This room is full.");
    const session = this.addParticipant(room, displayName, "player", players.length);
    if (players.length + 1 >= 2) { room.status = "active"; session.room.status = room.status; }
    return session;
  }

  async spectateRoom(roomCode: string, displayName: string) {
    return this.addParticipant(this.requireRoom(roomCode), displayName || "Spectator", "spectator");
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const room = this.authorize(roomCode, accessToken);
    return this.view(room, afterVersion);
  }

  async submitAction(roomCode: string, accessToken: string, actionId: string, command: GameCommand) {
    const room = this.authorize(roomCode, accessToken);
    const actor = room.participants.find((participant) => participant.tokenHash === hash(accessToken));
    if (!actor || actor.role !== "player") throw new Error("Spectators cannot submit game actions.");
    if (this.actionIds.has(`${room.id}:${actionId}`)) return this.view(room);
    if (actor.playerIndex !== room.state.currentPlayer) throw new Error("It is not your turn.");
    const result = applyCommand(room.state, command);
    room.state = result.state;
    room.version += 1;
    room.events.unshift({ id: randomBytes(10).toString("hex"), roomId: room.id, version: room.version, actorId: actor.id, type: result.eventType, payload: result.eventPayload, createdAt: now() });
    this.actionIds.add(`${room.id}:${actionId}`);
    if (room.state.phase === "game-over") room.status = "completed";
    return this.view(room);
  }

  private addParticipant(room: StoredRoom, displayName: string, role: "player" | "spectator", playerIndex?: number): SessionResponse {
    const accessToken = token();
    const participant: StoredParticipant = { id: randomBytes(10).toString("hex"), displayName: displayName.trim().slice(0, 32) || "Player", role, playerIndex, connected: true, tokenHash: hash(accessToken) };
    room.participants.push(participant);
    return { room: this.view(room), participantId: participant.id, token: accessToken };
  }

  private authorize(roomCode: string, accessToken: string) {
    const room = this.requireRoom(roomCode);
    if (!room.participants.some((participant) => participant.tokenHash === hash(accessToken))) throw new Error("Invalid room token.");
    return room;
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("Room not found.");
    return room;
  }

  private view(room: StoredRoom, afterVersion = 0): RoomView {
    return { id: room.id, code: room.code, status: room.status, version: room.version, state: room.state, participants: room.participants.map(({ tokenHash: _tokenHash, ...participant }) => participant), events: room.events.filter((event) => event.version > afterVersion) };
  }
}
