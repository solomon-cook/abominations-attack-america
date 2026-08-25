import { randomBytes, createHash } from "node:crypto";
import { applyCommand, createGame, type GameCommand, type GameState } from "@abominations/game-engine";
import type { RoomEvent, RoomView, SessionResponse } from "@abominations/shared";
import type { RoomStore } from "./store.js";
import { prisma } from "../lib/prisma.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();

/** Prisma-backed store. The HTTP server selects this when DATABASE_URL is configured. */
export class PrismaRoomStore implements RoomStore {
  constructor(private readonly prismaClient = prisma) {}

  async createRoom(maxPlayers: number): Promise<SessionResponse> {
    const accessToken = token();
    const room = await this.prismaClient.gameRoom.create({ data: { code: code(), maxPlayers, state: createGame(2) as any } });
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: "Player 1", role: "PLAYER", playerIndex: 0, tokenHash: hash(accessToken) } });
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async joinRoom(roomCode: string, displayName: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const count = await this.prismaClient.participant.count({ where: { roomId: room.id, role: "PLAYER" } });
    if (count >= room.maxPlayers) throw new Error("This room is full.");
    const accessToken = token();
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player", role: "PLAYER", playerIndex: count, tokenHash: hash(accessToken) } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { status: count + 1 >= 2 ? "ACTIVE" : "WAITING" } });
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async spectateRoom(roomCode: string, displayName: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const accessToken = token();
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Spectator", role: "SPECTATOR", tokenHash: hash(accessToken) } });
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const room = await this.authorize(roomCode, accessToken);
    return this.view(room.id, afterVersion);
  }

  async submitAction(roomCode: string, accessToken: string, actionId: string, command: GameCommand) {
    const room = await this.authorize(roomCode, accessToken);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (actor.playerIndex !== (room.state as unknown as GameState).currentPlayer) throw new Error("It is not your turn.");
    const duplicate = await this.prismaClient.gameEvent.findFirst({ where: { roomId: room.id, payload: { path: ["actionId"], equals: actionId } } });
    if (duplicate) return this.view(room.id);
    const result = applyCommand(room.state as unknown as GameState, command);
    const version = room.version + 1;
    const updated = await this.prismaClient.$transaction(async (tx: any) => {
      const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version }, data: { state: result.state as any, version } });
      if (changed.count !== 1) throw new Error("The game changed before this action was committed. Refresh and try again.");
      await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: result.eventType, payload: { ...result.eventPayload, actionId } } });
      return changed;
    });
    void updated;
    return this.view(room.id);
  }

  private async authorize(roomCode: string, accessToken: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    return room;
  }

  private async view(roomId: string, afterVersion = 0): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, include: { participants: true, events: { where: { version: { gt: afterVersion } }, orderBy: { version: "desc" } } } });
    if (!room) throw new Error("Room not found.");
    const events: RoomEvent[] = room.events.map((event: any) => ({ id: event.id, roomId: event.roomId, version: event.version, actorId: event.actorId, type: event.type, payload: event.payload as Record<string, unknown>, createdAt: event.createdAt.toISOString() }));
    return { id: room.id, code: room.code, status: room.status.toLowerCase() as RoomView["status"], version: room.version, state: room.state as unknown as GameState, participants: room.participants.map((participant: any) => ({ id: participant.id, displayName: participant.displayName, role: participant.role.toLowerCase(), playerIndex: participant.playerIndex ?? undefined, connected: Boolean(participant.connectedAt) })), events };
  }
}
