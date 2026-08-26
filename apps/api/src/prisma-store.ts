import { randomBytes, createHash } from "node:crypto";
import { applyCommandEnvelope, applySetupAction, createMvpRoomGame, createRoomGame, projectState, redactCardIdentifiers, type GameCommandEnvelope, type GameState, type SetupAction, type StateAudience } from "@abominations/game-engine";
import type { RoomEvent, RoomView, SessionResponse } from "@abominations/shared";
import { MAX_RETAINED_ROOM_EVENTS, ROOM_IDLE_TIMEOUT_MS, terminalResultSummary, type RoomStore } from "./store.js";
import { isSessionExpired, sessionExpiresAt } from "./session.js";
import { prisma } from "../lib/prisma.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const getPrisma = () => {
  if (!prisma) throw new Error("DATABASE_URL is required to initialize Prisma.");
  return prisma;
};

/** Prisma-backed store. The HTTP server selects this when DATABASE_URL is configured. */
export class PrismaRoomStore implements RoomStore {
  constructor(private readonly prismaClient = getPrisma(), private readonly allowDevelopmentFixture = false) {}

  async close(): Promise<void> {
    await this.prismaClient.$disconnect();
  }

  async health(): Promise<{ persistence: "prisma" }> {
    await this.prismaClient.$queryRaw`SELECT 1`;
    return { persistence: "prisma" };
  }

  async createRoom(maxPlayers: number): Promise<SessionResponse> {
    const accessToken = token();
    const roomCode = code();
    const state = this.allowDevelopmentFixture
      ? createRoomGame(maxPlayers as 2 | 3 | 4, 0, `room-${roomCode}`)
      : createMvpRoomGame(maxPlayers as 2 | 3 | 4, 0, `room-${roomCode}`);
    const room = await this.prismaClient.gameRoom.create({ data: { code: roomCode, maxPlayers, state: state as any } });
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: "Player 1", role: "PLAYER", playerIndex: 0, ready: false, connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: accessToken };
  }

  async joinRoom(roomCode: string, displayName: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    if (room.status === "EXPIRED") throw new Error("This room has expired.");
    const count = await this.prismaClient.participant.count({ where: { roomId: room.id, role: "PLAYER" } });
    if (count >= room.maxPlayers) throw new Error("This room is full.");
    const accessToken = token();
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player", role: "PLAYER", playerIndex: count, ready: false, connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: accessToken };
  }

  async spectateRoom(roomCode: string, displayName: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const accessToken = token();
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Spectator", role: "SPECTATOR", connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async disconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (participant.connectionId && participant.connectionId !== connectionId) return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
    await this.prismaClient.participant.update({ where: { id: participant.id }, data: { connectedAt: null } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  async reconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    await this.prismaClient.participant.update({ where: { id: participant.id }, data: { connectedAt: new Date(), connectionId } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  async rotateSession(roomCode: string, accessToken: string): Promise<SessionResponse> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const replacement = token();
    await this.prismaClient.participant.update({ where: { id: participant.id }, data: { tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt() } });
    return { room: await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined), participantId: participant.id, token: replacement };
  }

  async setReady(roomCode: string, accessToken: string, ready: boolean) {
    const room = await this.authorize(roomCode, accessToken);
    if (room.status !== "WAITING") throw new Error("Readiness can only change while a room is waiting.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant || participant.role !== "PLAYER") throw new Error("Only players can change readiness.");
    if (!participant.connectedAt) throw new Error("Reconnect before changing readiness.");
    await this.prismaClient.participant.update({ where: { id: participant.id }, data: { ready } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, "player", participant.playerIndex ?? undefined);
  }

  async setupAction(roomCode: string, accessToken: string, action: SetupAction, expectedRevision: number) {
    const room = await this.authorize(roomCode, accessToken);
    if (room.version !== expectedRevision) throw new Error(`Expected revision ${expectedRevision}, current revision is ${room.version}.`);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER" || actor.playerIndex === null) throw new Error("Only seated players can complete setup.");
    const state = room.state as unknown as GameState;
    if (!state.setupState) throw new Error("This room has no setup state.");
    const nextSetup = applySetupAction(state.setupState, actor.playerIndex, action);
    const nextState = { ...state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    const version = room.version + 1;
    await this.prismaClient.$transaction(async (tx: any) => {
      const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version }, data: { state: nextState as any, version, lastActivityAt: new Date() } });
      if (changed.count !== 1) throw new Error("The room changed before setup was committed. Refresh and try again.");
      await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: "setup.updated", payload: { phase: nextState.setupState.phase, action: action.type } } });
    });
    await this.refreshStatus(room.id, room.maxPlayers, nextState);
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const room = await this.authorize(roomCode, accessToken);
    const viewer = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    return this.view(room.id, afterVersion, viewer?.role === "PLAYER" ? "player" : "spectator", viewer?.playerIndex ?? undefined);
  }

  async submitAction(roomCode: string, accessToken: string, envelope: GameCommandEnvelope) {
    const room = await this.authorize(roomCode, accessToken);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (room.status !== "ACTIVE") throw new Error("This room is not ready for gameplay.");
    const gameState = room.state as unknown as GameState;
    const requiredPlayer = gameState.pendingDecision?.type === "trophy-choice"
      ? gameState.pendingDecision.playerIndex
      : gameState.currentPlayer;
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    const duplicate = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
    if (duplicate) return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
    const result = applyCommandEnvelope(room.state as unknown as GameState, envelope, room.version);
    const version = room.version + 1;
    try {
      await this.prismaClient.$transaction(async (tx: any) => {
        const terminal = result.state.phase === "game-over";
        const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version }, data: { state: result.state as any, version, lastActivityAt: new Date(), ...(terminal ? { status: "COMPLETED", completedAt: new Date() } : {}) } });
        if (changed.count !== 1) throw new Error("The game changed before this action was committed. Refresh and try again.");
        await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: result.eventType, payload: { ...result.eventPayload, receipt: result.receipt } } });
        await tx.commandReceipt.create({ data: { roomId: room.id, actionId: envelope.actionId, actorId: actor.id, version, eventType: result.eventType } });
        if (terminal) {
          const summary = terminalResultSummary(result.state, { type: result.eventType, version });
          await tx.gameResult.upsert({ where: { roomId: room.id }, update: { winnerId: actor.id, winnerName: actor.displayName, summary }, create: { roomId: room.id, winnerId: actor.id, winnerName: actor.displayName, summary } });
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
      throw error;
    }
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  private async authorize(roomCode: string, accessToken: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const lastActivityAt = room.lastActivityAt?.getTime?.() ?? Date.now();
    if (room.status !== "COMPLETED" && Date.now() - lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
      await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { status: "EXPIRED" } });
      throw new Error("This room has expired.");
    }
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    return room;
  }

  private async refreshStatus(roomId: string, maxPlayers: number, state?: GameState) {
    const players = await this.prismaClient.participant.findMany({ where: { roomId, role: "PLAYER" } });
    const currentState = state ?? await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { state: true } }).then((room: any) => room?.state as GameState | undefined);
    const room = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { status: true, lastActivityAt: true } });
    const setupComplete = !currentState?.setupState || currentState.setupState.phase === "complete";
    if (room?.status === "COMPLETED" || room?.status === "EXPIRED") return;
    if (room && Date.now() - (room.lastActivityAt?.getTime?.() ?? Date.now()) >= ROOM_IDLE_TIMEOUT_MS) {
      await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: "EXPIRED" } });
      return;
    }
    if (room?.status === "ACTIVE") {
      await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: players.length > 0 && players.every((participant: any) => !participant.connectedAt) ? "ABANDONED" : "ACTIVE" } });
      return;
    }
    if (room?.status === "ABANDONED" && !(setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && participant.connectedAt))) return;
    const nextStatus = setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && participant.connectedAt) ? "ACTIVE" : "WAITING";
    await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: nextStatus } });
  }

  private async view(roomId: string, afterVersion = 0, audience: StateAudience = "spectator", viewerPlayerIndex?: number): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, include: { participants: true, events: { where: { version: { gt: afterVersion } }, orderBy: { version: "desc" }, take: MAX_RETAINED_ROOM_EVENTS } } });
    if (!room) throw new Error("Room not found.");
    const events: RoomEvent[] = room.events.map((event: any) => ({ id: event.id, roomId: event.roomId, version: event.version, actorId: event.actorId, type: event.type, payload: redactCardIdentifiers(event.payload) as Record<string, unknown>, createdAt: event.createdAt.toISOString() }));
    return { id: room.id, code: room.code, status: room.status.toLowerCase() as RoomView["status"], version: room.version, state: projectState(room.state as unknown as GameState, audience, viewerPlayerIndex), participants: room.participants.map((participant: any) => ({ id: participant.id, displayName: participant.displayName, role: participant.role.toLowerCase(), playerIndex: participant.playerIndex ?? undefined, connected: Boolean(participant.connectedAt), ready: Boolean(participant.ready) })), events };
  }
}
