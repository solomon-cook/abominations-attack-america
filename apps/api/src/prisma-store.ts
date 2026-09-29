import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { setupDeploymentState, applyCommandEnvelope, applyCompletedSetup, applySetupAction, chooseBotCommand, chooseBotSetupAction, createMvpRoomGame, createRoomGame, projectState, redactCardIdentifiers, type GameCommandEnvelope, type GameState, type SetupAction, type StateAudience } from "@abominations/game-engine";
import { knownRoomEventType, type JsonValue, type PublicRoomSummary, type RoomEvent, type RoomPrivacy, type RoomView, type SessionResponse } from "@abominations/shared";
import { completedMatchRows, emptyMatchCounters, updateMatchCounters } from "./player-stats.js";
import { MAX_RETAINED_ROOM_EVENTS, ROOM_IDLE_TIMEOUT_MS, cancelledConnectionId, cancelledPendingConnectionId, laserFenceCardOwner, mutationBattleOwner, terminalResultSummary, type RoomSocketPrincipal, type RoomSocketTicket, type RoomStore } from "./store.js";
import { isSessionExpired, sessionExpiresAt } from "./session.js";
import { prisma } from "../lib/prisma.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const gameSeed = () => randomBytes(4).readUInt32LE(0);
type PersistedRoomStatus = "WAITING" | "ACTIVE" | "COMPLETED" | "ABANDONED" | "EXPIRED";
type RoomExpirySnapshot = { id: string; status: PersistedRoomStatus; lastActivityAt: Date };
type RoomWriteSnapshot = RoomExpirySnapshot & { version: number };
class RoomSnapshotConflictError extends Error {}
const expectedBotActionRaceMessages = new Set([
  "Room not found.",
  "This room has expired.",
  "The room changed before this action was committed. Refresh and try again.",
  "The game changed before this action was committed. Refresh and try again.",
  "The room changed repeatedly while recovering setup.",
  "The room changed repeatedly while checking its expiry.",
  "The room changed repeatedly while refreshing its lifecycle status.",
  "Bot control changed before this action was committed.",
  "Bot control changed before setup was committed.",
]);
const isExpectedBotActionRace = (error: unknown) => error instanceof RoomSnapshotConflictError
  || error instanceof Error && expectedBotActionRaceMessages.has(error.message);
const socketTicketConnectionId = (ticket: string) => {
  const separator = ticket.lastIndexOf(".");
  const connectionId = ticket.slice(separator + 1);
  return separator > 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)
    ? connectionId
    : undefined;
};
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

  async createRoom(maxPlayers: number, displayName = "Player 1", privacy: RoomPrivacy = "private"): Promise<SessionResponse> {
    const accessToken = token();
    const roomCode = code();
    const seed = gameSeed();
    const state = this.allowDevelopmentFixture
      ? createRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`)
      : createMvpRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`);
    if (privacy !== "private" && privacy !== "public") throw new Error("Room privacy must be private or public.");
    const { room, participant } = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
      const playerStats = emptyMatchCounters(maxPlayers).map(({ stompedTiles, damageTaken, healthGained, luckTotal, luckRolls }) => ({ stompedTiles, damageTaken, healthGained, luckTotal, luckRolls }));
      const room = await tx.gameRoom.create({ data: { code: roomCode, maxPlayers, privacy: privacy.toUpperCase() as "PRIVATE" | "PUBLIC", state: state as any, playerStats, isTest: this.allowDevelopmentFixture } });
      const participant = await tx.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player 1", role: "PLAYER", playerIndex: 0, ready: false, connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
      return { room, participant };
    });
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: accessToken };
  }

  async listPublicRooms(): Promise<PublicRoomSummary[]> {
    const rooms = await this.prismaClient.gameRoom.findMany({
      where: { privacy: "PUBLIC", status: { in: ["WAITING", "ACTIVE"] }, lastActivityAt: { gt: new Date(Date.now() - ROOM_IDLE_TIMEOUT_MS) } },
      orderBy: { lastActivityAt: "desc" },
      take: 20,
      include: { participants: { select: { role: true } } },
    });
    return rooms.map((room) => ({
      code: room.code,
      status: room.status.toLowerCase() as "waiting" | "active",
      maxPlayers: room.maxPlayers,
      playerCount: room.participants.filter((participant) => participant.role === "PLAYER").length,
      spectatorCount: room.participants.filter((participant) => participant.role === "SPECTATOR").length,
    }));
  }

  async joinRoom(roomCode: string, displayName: string) {
    const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!foundRoom) throw new Error("Room not found.");
    await this.assertRoomNotExpired(foundRoom);
    const room = await this.ensureActiveSetupMaterialized(foundRoom);
    const accessToken = token();
    let participant;
    try {
      participant = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const activityAt = this.nextRoomActivityAt(room);
        await this.touchRoomSnapshot(tx, room, activityAt);
        const count = await tx.participant.count({ where: { roomId: room.id, role: "PLAYER" } });
        if (count >= room.maxPlayers) throw new Error("This room is full.");
        return tx.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player", role: "PLAYER", playerIndex: count, ready: false, connectedAt: activityAt, tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id, room.maxPlayers);
      if ((error as { code?: string }).code === "P2002") throw new Error("This room is full.");
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: accessToken };
  }

  async spectateRoom(roomCode: string, displayName: string) {
    const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!foundRoom) throw new Error("Room not found.");
    await this.assertRoomNotExpired(foundRoom);
    if (foundRoom.privacy === "PRIVATE") throw new Error("This room is private and does not allow spectator entry.");
    const room = await this.ensureActiveSetupMaterialized(foundRoom);
    const accessToken = token();
    let participant;
    try {
      participant = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const activityAt = this.nextRoomActivityAt(room);
        await this.touchRoomSnapshot(tx, room, activityAt);
        return tx.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Spectator", role: "SPECTATOR", connectedAt: activityAt, tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async disconnect(roomCode: string, accessToken: string, connectionId = "legacy", pendingConnectionId?: string) {
    if (pendingConnectionId) return this.disconnectCancellingPendingReconnect(roomCode, accessToken, connectionId, pendingConnectionId);
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (participant.connectionId && participant.connectionId !== connectionId) {
      const projection = await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
      await this.assertCurrentRoomNotExpired(room.id);
      return projection;
    }
    const participantWhere = { id: participant.id, roomId: room.id, tokenHash: hash(accessToken), connectionId: participant.connectionId, connectedAt: participant.connectedAt };
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This room connection was replaced. Reconnect with the current lease.");
        const activityAt = this.nextRoomActivityAt(room);
        await this.touchRoomSnapshot(tx, room, activityAt);
        const disconnected = await tx.participant.updateMany({ where: participantWhere, data: { connectedAt: null, disconnectedAt: activityAt } });
        if (disconnected.count !== 1) throw new Error("This room connection was replaced. Reconnect with the current lease.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  private async disconnectCancellingPendingReconnect(roomCode: string, accessToken: string, connectionId: string, pendingConnectionId: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const room = await this.authorize(roomCode, accessToken);
      const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
      if (!participant) throw new Error("Invalid room token.");
      const audience = participant.role === "PLAYER" ? "player" : "spectator";
      if (participant.connectionId && participant.connectionId !== connectionId && participant.connectionId !== pendingConnectionId) {
        const projection = await this.view(room.id, 0, audience, participant.playerIndex ?? undefined);
        await this.assertCurrentRoomNotExpired(room.id);
        return projection;
      }

      const participantWhere = { id: participant.id, roomId: room.id, tokenHash: hash(accessToken), connectionId: participant.connectionId, connectedAt: participant.connectedAt };
      try {
        const disconnected = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
          if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) return false;
          const activityAt = this.nextRoomActivityAt(room);
          await this.touchRoomSnapshot(tx, room, activityAt);
          const changed = await tx.participant.updateMany({
            where: participantWhere,
            data: { connectedAt: null, disconnectedAt: activityAt, connectionId: cancelledConnectionId(pendingConnectionId) },
          });
          if (changed.count !== 1) throw new RoomSnapshotConflictError();
          return true;
        });
        if (!disconnected) continue;
      } catch (error) {
        if (error instanceof RoomSnapshotConflictError) continue;
        throw error;
      }

      await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
      return this.view(room.id, 0, audience, participant.playerIndex ?? undefined);
    }

    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const audience = participant.role === "PLAYER" ? "player" : "spectator";
    if (participant.connectionId && participant.connectionId !== connectionId && participant.connectionId !== pendingConnectionId) {
      return this.view(room.id, 0, audience, participant.playerIndex ?? undefined);
    }
    throw new Error("The room changed repeatedly while disconnecting.");
  }

  async reconnect(roomCode: string, accessToken: string, expectedConnectionId = "legacy", connectionId = expectedConnectionId) {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (cancelledPendingConnectionId(participant.connectionId)) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    const retryingSameLease = participant.connectionId === connectionId;
    if (!retryingSameLease && participant.connectionId && participant.connectionId !== expectedConnectionId) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    if (retryingSameLease && participant.connectedAt) {
      try {
        await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
          const participantWhere = { id: participant.id, tokenHash: hash(accessToken), connectionId };
          if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This room connection was replaced. Reconnect with the current lease.");
          await this.guardRoomSnapshot(tx, room, new Date());
        });
      } catch (error) {
        if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
        throw error;
      }
      await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
      const projection = await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
      await this.assertCurrentRoomNotExpired(room.id);
      return projection;
    }
    const participantWhere = { id: participant.id, tokenHash: hash(accessToken), ...(retryingSameLease ? { connectionId, connectedAt: null } : { OR: [{ connectionId: expectedConnectionId }, { connectionId: null }] }) };
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This room session was replaced. Sign in again to resume.");
        await this.touchRoomSnapshot(tx, room, this.nextRoomActivityAt(room));
        const changed = await tx.participant.updateMany({ where: participantWhere, data: { connectedAt: new Date(), disconnectedAt: null, botControlled: false, connectionId } });
        if (changed.count !== 1) throw new Error("This room session was replaced. Sign in again to resume.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    const projection = await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return projection;
  }

  async rotateSession(roomCode: string, accessToken: string): Promise<SessionResponse> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const replacement = token();
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const participantWhere = { id: participant.id, tokenHash: hash(accessToken) };
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This room session was replaced. Sign in again to resume.");
        await this.guardRoomSnapshot(tx, room, new Date());
        await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
        const updated = await tx.participant.updateMany({ where: participantWhere, data: { tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectionId: null, connectedAt: null, disconnectedAt: new Date() } });
        if (updated.count !== 1) throw new Error("This room session was replaced. Sign in again to resume.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    const projection = await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return { room: projection, participantId: participant.id, token: replacement };
  }

  async claimParticipant(roomCode: string, accessToken: string, user: { id: string; username: string; emailVerifiedAt: Date | null }): Promise<SessionResponse> {
    if (!user.emailVerifiedAt) throw new Error("Verify your email before linking a game seat.");
    const room = await this.authorize(roomCode, accessToken);
    if (room.status === "COMPLETED" || room.status === "EXPIRED") throw new Error("Only an active match seat can be linked to an account.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken), role: "PLAYER" } });
    if (!participant) throw new Error("Only a player seat can be linked to an account.");
    if (participant.userId && participant.userId !== user.id) throw new Error("This seat is already linked to another account.");
    const replacement = token();
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const participantWhere = { id: participant.id, tokenHash: hash(accessToken), ...(participant.userId ? { userId: user.id } : { userId: null }) };
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This seat was linked from another session. Refresh the room and try again.");
        // Linking a seat creates the ACTIVE+linked-player idle-expiry exemption.
        // Advance room activity with that transition so an expiry worker holding
        // the prior unlinked snapshot cannot expire it after the link commits.
        await this.touchRoomSnapshot(tx, room, this.nextRoomActivityAt(room));
        await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
        const linked = await tx.participant.updateMany({ where: { ...participantWhere, ...(participant.userId ? {} : { userId: null }) }, data: { userId: user.id, displayName: user.username, tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectedAt: null, disconnectedAt: new Date(), botControlled: false, connectionId: null } });
        if (linked.count !== 1) throw new Error("This seat was linked from another session. Refresh the room and try again.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    const projection = await this.view(room.id, 0, "player", participant.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return { room: projection, participantId: participant.id, token: replacement, accountLinked: true };
  }

  async resumeParticipant(roomId: string, user: { id: string; username: string }): Promise<SessionResponse> {
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId, userId: user.id, role: "PLAYER" }, include: { room: true } });
    if (!participant) throw new Error("You do not have a player seat in this match.");
    await this.assertRoomNotExpired(participant.room);
    const room = await this.ensureActiveSetupMaterialized(participant.room);
    const replacement = token();
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const participantWhere = { id: participant.id, roomId: participant.roomId, userId: user.id, role: "PLAYER" as const, tokenHash: participant.tokenHash };
        if (!await this.lockParticipantSnapshot(tx, participantWhere, participant.connectedAt)) throw new Error("This seat was resumed from another session. Refresh and try again.");
        await this.guardRoomSnapshot(tx, room, new Date());
        const resumed = await tx.participant.updateMany({
          where: participantWhere,
          data: { tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectedAt: null, disconnectedAt: new Date(), botControlled: false, displayName: user.username, connectionId: null },
        });
        if (resumed.count !== 1) throw new Error("This seat was resumed from another session. Refresh and try again.");
        await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    const projection = await this.view(room.id, 0, "player", participant.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return { room: projection, participantId: participant.id, token: replacement, accountLinked: true };
  }

  async setReady(roomCode: string, accessToken: string, ready: boolean) {
    const room = await this.authorize(roomCode, accessToken);
    if (room.status !== "WAITING") throw new Error("Readiness can only change while a room is waiting.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant || participant.role !== "PLAYER") throw new Error("Only players can change readiness.");
    if (!participant.connectedAt) throw new Error("Reconnect before changing readiness.");
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const activityAt = this.nextRoomActivityAt(room);
        const participantWhere = { id: participant.id, tokenHash: hash(accessToken), botControlled: false, connectedAt: { not: null } };
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("Reconnect before changing readiness.");
        await this.touchRoomSnapshot(tx, room, activityAt);
        const updated = await tx.participant.updateMany({ where: participantWhere, data: { ready } });
        if (updated.count !== 1) throw new Error("Reconnect before changing readiness.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, "player", participant.playerIndex ?? undefined);
  }

  async setupAction(roomCode: string, accessToken: string, action: SetupAction, expectedRevision: number) {
    const room = await this.authorize(roomCode, accessToken);
    if (room.version !== expectedRevision) throw new Error(`Expected revision ${expectedRevision}, current revision is ${room.version}.`);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER" || actor.playerIndex === null) throw new Error("Only seated players can complete setup.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    const state = room.state as unknown as GameState;
    if (!state.setupState) throw new Error("This room has no setup state.");
    const nextSetup = applySetupAction(state.setupState, actor.playerIndex, action);
    if (action.type === "choose-starting-choice" && action.startingChoice.kind === "deploy") {
      const choice = action.startingChoice;
      setupDeploymentState(state, actor.playerIndex, "placements" in choice ? choice.placements : [choice]);
    }
    const setupState = { ...state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    const nextState = nextSetup.phase === "complete" ? applyCompletedSetup(setupState) : setupState;
    const version = room.version + 1;
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const activityAt = this.nextRoomActivityAt(room);
        const humanWhere = { id: actor.id, tokenHash: hash(accessToken), botControlled: false };
        if (!await this.lockLiveSessionSnapshot(tx, humanWhere, actor.connectedAt, actor.sessionExpiresAt)) throw new Error("This room session was replaced. Reconnect before completing setup.");
        const changed = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, activityAt), data: { state: nextState as any, version, lastActivityAt: activityAt } });
        if (changed.count !== 1) throw new RoomSnapshotConflictError();
        const human = await tx.participant.updateMany({ where: humanWhere, data: { disconnectedAt: actor.disconnectedAt } });
        if (human.count !== 1) throw new Error("This room session was replaced. Reconnect before completing setup.");
        await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: knownRoomEventType("setup.updated"), payload: { phase: nextSetup.phase, action: action.type } } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, nextState);
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const room = await this.authorize(roomCode, accessToken);
    const viewer = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    const projection = await this.view(room.id, afterVersion, viewer?.role === "PLAYER" ? "player" : "spectator", viewer?.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return projection;
  }

  async submitAction(roomCode: string, accessToken: string, envelope: GameCommandEnvelope) {
    const room = await this.authorize(roomCode, accessToken);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    const duplicate = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
    if (duplicate) {
      const projection = await this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
      await this.assertCurrentRoomNotExpired(room.id);
      return projection;
    }
    if (room.status !== "ACTIVE") throw new Error("This room is not ready for gameplay.");
    const gameState = room.state as unknown as GameState;
    if (gameState.setupState?.phase === "complete" && !gameState.setupApplied) throw new Error("Room setup is not materialized; refresh the room before submitting gameplay.");
    const requiredPlayer = this.requiredPlayer(gameState, envelope);
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    await this.commitCommand(room, actor, envelope, "human", { tokenHash: hash(accessToken) });
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async createSocketTicket(roomCode: string, accessToken: string, expectedConnectionId: string | null = null, requestedConnectionId?: string): Promise<RoomSocketTicket> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const currentConnectionId = participant.connectionId ?? null;
    const connectionId = requestedConnectionId ?? randomUUID();
    const retryingSameLease = currentConnectionId === connectionId && !participant.connectedAt;
    if (currentConnectionId === connectionId && participant.connectedAt) throw new Error("This room connection is already connected.");
    if (!retryingSameLease && currentConnectionId !== expectedConnectionId) throw new Error("This room connection was replaced. Reconnect with the current lease.");
    const value = `${token()}.${connectionId}`;
    const participantWhere = { id: participant.id, roomId: room.id, tokenHash: hash(accessToken), connectionId: currentConnectionId, ...(retryingSameLease ? { connectedAt: null } : {}) };
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, participant.connectedAt, participant.sessionExpiresAt)) throw new Error("This room session was replaced. Sign in again to continue.");
        await this.touchRoomSnapshot(tx, room, this.nextRoomActivityAt(room));
        await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id, consumedAt: null } });
        const issued = await tx.participant.updateMany({ where: participantWhere, data: { connectionId, connectedAt: null, disconnectedAt: new Date() } });
        if (issued.count !== 1) throw new Error("This room session was replaced. Sign in again to continue.");
        await tx.webSocketTicket.create({ data: { roomId: room.id, participantId: participant.id, participantTokenHash: participant.tokenHash, tokenHash: hash(value), expiresAt: new Date(Date.now() + 30_000) } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return { ticket: value, connectionId };
  }

  async consumeSocketTicket(roomCode: string, ticket: string): Promise<RoomSocketPrincipal> {
    const record = await this.prismaClient.webSocketTicket.findUnique({ where: { tokenHash: hash(ticket) }, include: { room: true, participant: true } });
    if (!record || record.room.code !== roomCode.toUpperCase() || record.consumedAt || record.expiresAt <= new Date() || record.participant.tokenHash !== record.participantTokenHash) throw new Error("WebSocket ticket is invalid or expired.");
    await this.assertRoomNotExpired(record.room);
    if (isSessionExpired(record.participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const participantWhere = { id: record.participantId, roomId: record.roomId, tokenHash: record.participantTokenHash };
        if (!await this.lockLiveSessionSnapshot(tx, participantWhere, record.participant.connectedAt, record.participant.sessionExpiresAt)) throw new Error("WebSocket ticket was issued for an expired or replaced room session.");
        await this.guardRoomSnapshot(tx, record.room, new Date());
        const consumed = await tx.webSocketTicket.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
        if (consumed.count !== 1) throw new Error("WebSocket ticket is invalid or expired.");
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(record.roomId);
      throw error;
    }
    const participant = await this.prismaClient.participant.findFirst({ where: { id: record.participantId, roomId: record.roomId, tokenHash: record.participantTokenHash } });
    if (!participant || isSessionExpired(participant.sessionExpiresAt)) throw new Error("WebSocket ticket was issued for an expired or replaced room session.");
    const connectionId = socketTicketConnectionId(ticket) ?? randomUUID();
    return { roomCode: record.room.code, participantId: record.participantId, sessionHash: record.participantTokenHash, connectionId };
  }

  async participantIdForToken(roomCode: string, accessToken: string): Promise<string> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    return participant.id;
  }

  async getRoomForParticipant(roomCode: string, participantId: string, afterVersion = 0): Promise<RoomView> {
    const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    const participant = foundRoom && await this.prismaClient.participant.findFirst({ where: { id: participantId, roomId: foundRoom.id } });
    if (!foundRoom || !participant) throw new Error("Room participant not found.");
    const room = await this.ensureActiveSetupMaterialized(foundRoom);
    const projection = await this.view(room.id, afterVersion, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
    await this.assertCurrentRoomNotExpired(room.id);
    return projection;
  }

  async getRoomForConnection(roomCode: string, participantId: string, connectionId: string, sessionHash: string, afterVersion = 0): Promise<RoomView | undefined> {
    const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!foundRoom) throw new Error("Room not found.");
    if (await this.isRoomExpired(foundRoom)) return undefined;
    const where = { id: participantId, roomId: foundRoom.id, connectionId, tokenHash: sessionHash, connectedAt: { not: null } };
    const currentBeforeProjection = await this.prismaClient.participant.findFirst({ where });
    if (!currentBeforeProjection || isSessionExpired(currentBeforeProjection.sessionExpiresAt)) return undefined;
    const room = await this.ensureActiveSetupMaterialized(foundRoom);
    const view = await this.view(room.id, afterVersion, currentBeforeProjection.role === "PLAYER" ? "player" : "spectator", currentBeforeProjection.playerIndex ?? undefined);
    // Projection loading crosses await points; recheck the lease so a session rotation
    // or replacement on another API process suppresses this private snapshot.
    const currentAfterProjection = await this.prismaClient.participant.findFirst({ where });
    if (!currentAfterProjection || isSessionExpired(currentAfterProjection.sessionExpiresAt)) return undefined;
    const currentRoom = await this.prismaClient.gameRoom.findUnique({ where: { id: room.id }, select: { id: true, status: true, lastActivityAt: true } });
    return currentRoom && !(await this.isRoomExpired(currentRoom)) ? view : undefined;
  }

  async submitActionForParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string, envelope: GameCommandEnvelope): Promise<RoomView> {
    const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!foundRoom) throw new Error("Room not found.");
    await this.assertRoomNotExpired(foundRoom);
    const actor = await this.prismaClient.participant.findFirst({ where: { id: participantId, roomId: foundRoom.id, connectionId, tokenHash: sessionHash, connectedAt: { not: null } } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (isSessionExpired(actor.sessionExpiresAt)) throw new Error("Session token has expired.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    const room = await this.ensureActiveSetupMaterialized(foundRoom);
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    const duplicate = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
    if (duplicate) {
      const projection = await this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
      await this.assertCurrentRoomNotExpired(room.id);
      return projection;
    }
    if (room.status !== "ACTIVE") throw new Error("This room is not ready for gameplay.");
    if (actor.playerIndex !== this.requiredPlayer(room.state as unknown as GameState, envelope)) throw new Error("It is not your turn.");
    await this.commitCommand(room, actor, envelope, "human", { tokenHash: sessionHash, connectionId });
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async disconnectParticipant(roomCode: string, participantId: string, connectionId = "legacy"): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const participant = await this.prismaClient.participant.findFirst({ where: { id: participantId, roomId: room.id } });
    if (!participant) throw new Error("Room participant not found.");
    await this.assertRoomNotExpired(room);
    if (participant.connectionId && participant.connectionId !== connectionId) return this.getRoomForParticipant(roomCode, participantId);
    const participantWhere = { id: participantId, roomId: room.id, connectionId, connectedAt: participant.connectedAt };
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        if (!await this.lockParticipantSnapshot(tx, participantWhere, participant.connectedAt)) return;
        await this.guardRoomSnapshot(tx, room, new Date());
        await tx.participant.updateMany({ where: participantWhere, data: { connectedAt: null, disconnectedAt: new Date() } });
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.getRoomForParticipant(roomCode, participantId);
  }

  async connectParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    await this.assertRoomNotExpired(room);
    const now = new Date();
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const participantWhere = { id: participantId, roomId: room.id, tokenHash: sessionHash, connectionId, sessionExpiresAt: { gt: now }, connectedAt: null };
        if (!await this.lockParticipantSnapshot(tx, participantWhere, null)) {
          await this.assertParticipantSessionLive(tx, participantId);
          throw new Error("WebSocket ticket was replaced or its room session was expired or rotated.");
        }
        await this.guardRoomSnapshot(tx, room, now);
        const changed = await tx.participant.updateMany({ where: participantWhere, data: { connectedAt: now, disconnectedAt: null, botControlled: false } });
        if (changed.count !== 1) {
          await this.assertParticipantSessionLive(tx, participantId);
          throw new Error("WebSocket ticket was replaced or its room session was expired or rotated.");
        }
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) throw await this.roomSnapshotConflict(room.id);
      throw error;
    }
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.getRoomForParticipant(roomCode, participantId);
  }

  async processBotTakeovers(nowMs = Date.now()): Promise<string[]> {
    const due = await this.prismaClient.participant.findMany({ where: { role: "PLAYER", connectedAt: null, botControlled: false, disconnectedAt: { lte: new Date(nowMs - 4 * 60_000) }, room: { status: { in: ["WAITING", "ACTIVE", "ABANDONED"] } } }, select: { id: true, roomId: true } });
    const affected = new Set<string>();
    for (const participant of due) {
      const participantWhere = { id: participant.id, roomId: participant.roomId, role: "PLAYER" as const, connectedAt: null, botControlled: false, disconnectedAt: { lte: new Date(nowMs - 4 * 60_000) } };
      try {
        const takenOver = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
          if (!await this.lockParticipantSnapshot(tx, participantWhere, null)) return false;
          const room = await tx.gameRoom.findUnique({ where: { id: participant.roomId }, select: { id: true, status: true, version: true, lastActivityAt: true } });
          if (!room || !["WAITING", "ACTIVE", "ABANDONED"].includes(room.status)) return false;
          await this.guardRoomSnapshot(tx, room, new Date(nowMs));
          const changed = await tx.participant.updateMany({ where: participantWhere, data: { botControlled: true, botAssisted: true } });
          return changed.count === 1;
        });
        if (takenOver) affected.add(participant.roomId);
      } catch (error) {
        if (!(error instanceof RoomSnapshotConflictError)) throw error;
      }
    }
    const completedCodes: string[] = [];
    for (const roomId of affected) {
      const info = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { code: true } });
      if (info) completedCodes.push(info.code);
    }
    const activeRooms = await this.prismaClient.gameRoom.findMany({ where: { status: { in: ["WAITING", "ACTIVE"] }, participants: { some: { botControlled: true, role: "PLAYER" } } }, select: { code: true } });
    for (const item of activeRooms) if (!completedCodes.includes(item.code)) completedCodes.push(item.code);
    for (const roomCode of completedCodes) await this.runBotActions(roomCode);
    return completedCodes;
  }

  private requiredPlayer(state: GameState, envelope?: GameCommandEnvelope): number {
    const specialOwner = envelope ? laserFenceCardOwner(state, envelope) ?? mutationBattleOwner(state, envelope) : undefined;
    if (specialOwner !== undefined) return specialOwner;
    const decision = state.pendingDecision;
    return decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
  }

  private async commitCommand(room: Prisma.GameRoomModel, actor: Prisma.ParticipantModel, envelope: GameCommandEnvelope, controlSource: "human" | "bot", humanLease?: { tokenHash?: string; connectionId?: string }): Promise<void> {
    const state = room.state as unknown as GameState;
    if (state.setupState?.phase === "complete" && !state.setupApplied) throw new Error("Room setup is not materialized; gameplay commands are blocked until setup recovery completes.");
    const result = applyCommandEnvelope(state, envelope, room.version);
    const version = room.version + 1;
    const counters = updateMatchCounters(state, result.state, room.playerStats as any, actor.playerIndex ?? 0);
    const terminal = result.state.phase === "game-over";
    try {
      await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        if (controlSource === "bot") {
          const lease = await tx.participant.updateMany({ where: { id: actor.id, roomId: room.id, botControlled: true, connectedAt: null }, data: { disconnectedAt: actor.disconnectedAt } });
          if (lease.count !== 1) throw new Error("Bot control changed before this action was committed.");
        } else if (humanLease?.connectionId) {
          const evaluatedAt = new Date();
          if (isSessionExpired(actor.sessionExpiresAt, evaluatedAt.getTime())) throw new Error("Session token has expired.");
          const human = await tx.participant.updateMany({ where: { id: actor.id, roomId: room.id, botControlled: false, tokenHash: humanLease.tokenHash, connectionId: humanLease.connectionId, sessionExpiresAt: { gt: evaluatedAt }, connectedAt: { not: null } }, data: { disconnectedAt: actor.disconnectedAt } });
          if (human.count !== 1) {
            await this.assertParticipantSessionLive(tx, actor.id);
            throw new Error("This WebSocket connection was replaced or its room session expired. Reconnect to continue.");
          }
        } else {
          const humanWhere = { id: actor.id, roomId: room.id, botControlled: false, ...(humanLease?.tokenHash ? { tokenHash: humanLease.tokenHash } : {}) };
          if (!await this.lockLiveSessionSnapshot(tx, humanWhere, actor.connectedAt, actor.sessionExpiresAt)) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
        }
        const activityAt = this.nextRoomActivityAt(room);
        const changed = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, activityAt), data: { state: result.state as unknown as Prisma.InputJsonValue, playerStats: counters as unknown as Prisma.InputJsonValue, version, lastActivityAt: activityAt, ...(terminal ? { status: "COMPLETED", completedAt: activityAt } : {}) } });
        if (changed.count !== 1) throw new RoomSnapshotConflictError();
        await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: knownRoomEventType(result.eventType), controlSource, payload: { ...result.eventPayload, receipt: result.receipt } as unknown as Prisma.InputJsonValue } });
        await tx.commandReceipt.create({ data: { roomId: room.id, actionId: envelope.actionId, actorId: actor.id, version, eventType: result.eventType } });
        if (terminal) {
          const participants = await tx.participant.findMany({ where: { roomId: room.id, role: "PLAYER", userId: { not: null }, playerIndex: { not: null } }, include: { user: { select: { username: true } } } });
          const identities = participants.flatMap((participant) => participant.userId === null || participant.playerIndex === null ? [] : [{ participantId: participant.id, userId: participant.userId, username: participant.user?.username ?? participant.displayName, playerIndex: participant.playerIndex, botAssisted: participant.botAssisted }]);
          const rows = room.isTest ? [] : completedMatchRows(room.id, result.state, counters, identities);
          if (rows.length) await tx.playerMatchStat.createMany({ data: rows });
          const winner = participants.find((participant) => participant.playerIndex === result.state.winnerPlayer);
          const winnerParticipant = winner ?? await tx.participant.findFirst({ where: { roomId: room.id, role: "PLAYER", playerIndex: result.state.winnerPlayer } });
          const winnerName = result.state.winnerPlayer === undefined ? null : winner?.user?.username ?? winnerParticipant?.displayName ?? actor.displayName;
          const summary = terminalResultSummary(result.state, { type: result.eventType, version });
          await tx.gameResult.upsert({ where: { roomId: room.id }, update: { winnerId: winnerParticipant?.id ?? null, winnerName, summary: summary as unknown as Prisma.InputJsonValue }, create: { roomId: room.id, winnerId: winnerParticipant?.id ?? null, winnerName, summary: summary as unknown as Prisma.InputJsonValue } });
        }
      });
    } catch (error) {
      if (error instanceof RoomSnapshotConflictError) {
        const conflict = await this.roomSnapshotConflict(room.id);
        if (conflict.message === "This room has expired." || conflict.message === "Room not found.") throw conflict;
        throw new Error("The game changed before this action was committed. Refresh and try again.");
      }
      throw error;
    }
  }

  private async runBotActions(roomCode: string): Promise<void> {
    for (let step = 0; step < 12; step += 1) {
      const foundRoom = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
      if (!foundRoom || !["ACTIVE", "WAITING", "ABANDONED"].includes(foundRoom.status)) return;
      let room;
      try {
        room = await this.ensureActiveSetupMaterialized(foundRoom);
      } catch (error) {
        if (isExpectedBotActionRace(error)) return;
        throw error;
      }
      const state = room.state as unknown as GameState;
      const participants = await this.prismaClient.participant.findMany({ where: { roomId: room.id, role: "PLAYER" } });
      const botIndices = new Set<number>(participants.filter((participant: any) => participant.botControlled && participant.playerIndex !== null).map((participant: any) => participant.playerIndex));
      if (!botIndices.size) return;
      if (state.setupState && state.setupState.phase !== "complete") {
        const field = state.setupState.phase === "monster-selection" ? "monsterId" : state.setupState.phase === "branch-selection" ? "branch" : state.setupState.phase === "lair-selection" ? "lair" : "startingChoice";
        const seats = [...state.setupState.seats].sort((left, right) => state.setupState?.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
        const playerIndex = seats.find((seat) => (seat as any)[field] === undefined)?.playerIndex;
        const actor = participants.find((participant: any) => participant.playerIndex === playerIndex);
        if (playerIndex === undefined || !actor?.botControlled) return;
        const nextSetup = chooseBotSetupAction(state, state.setupState, playerIndex);
        if (nextSetup === state.setupState) return;
        const seat = nextSetup.seats.find((candidate) => candidate.playerIndex === playerIndex);
        if (seat?.startingChoice?.kind === "deploy") setupDeploymentState({ ...state, setupState: nextSetup }, playerIndex, "placements" in seat.startingChoice ? seat.startingChoice.placements : [seat.startingChoice]);
        const setupState = { ...state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
        const nextState = nextSetup.phase === "complete" ? applyCompletedSetup(setupState) : setupState;
        try {
          await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
            const leaseWhere = { id: actor.id, roomId: room.id, botControlled: true, connectedAt: null, disconnectedAt: actor.disconnectedAt };
            if (!await this.lockParticipantSnapshot(tx, leaseWhere, null)) throw new Error("Bot control changed before setup was committed.");
            const activityAt = this.nextRoomActivityAt(room);
            const changed = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, activityAt), data: { state: nextState as any, version: room.version + 1, lastActivityAt: activityAt } });
            if (changed.count !== 1) throw new RoomSnapshotConflictError();
            if (seat?.startingChoice) {
              const lease = await tx.participant.updateMany({ where: leaseWhere, data: { ready: true, disconnectedAt: actor.disconnectedAt } });
              if (lease.count !== 1) throw new Error("Bot control changed before setup was committed.");
            }
            await tx.gameEvent.create({ data: { roomId: room.id, version: room.version + 1, actorId: actor.id, type: knownRoomEventType("setup.updated"), controlSource: "bot", payload: { phase: nextSetup.phase, automated: true } } });
          });
        } catch (error) {
          if (isExpectedBotActionRace(error)) return;
          throw error;
        }
        try {
          await this.refreshStatus(room.id, room.maxPlayers, nextState);
        } catch (error) {
          if (isExpectedBotActionRace(error)) return;
          throw error;
        }
        continue;
      }
      try {
        await this.refreshStatus(room.id, room.maxPlayers, state);
      } catch (error) {
        if (isExpectedBotActionRace(error)) return;
        throw error;
      }
      const refreshed = await this.prismaClient.gameRoom.findUnique({ where: { id: room.id } });
      if (!refreshed || refreshed.status !== "ACTIVE") return;
      const liveState = refreshed.state as unknown as GameState;
      if (liveState.phase === "game-over") return;
      const command = chooseBotCommand(liveState, botIndices);
      if (!command) return;
      const probe = { command, actorId: "bot-probe", actionId: "bot-probe", expectedRevision: refreshed.version, protocolVersion: 1 as const };
      const actor = participants.find((participant: any) => participant.playerIndex === this.requiredPlayer(liveState, probe));
      if (!actor?.botControlled) return;
      const envelope: GameCommandEnvelope = { actionId: randomBytes(16).toString("hex"), actorId: actor.id, expectedRevision: refreshed.version, protocolVersion: 1, command };
      try {
        await this.commitCommand(refreshed, actor, envelope, "bot");
      } catch (error) {
        if (isExpectedBotActionRace(error)) return;
        throw error;
      }
    }
  }

  private async authorize(roomCode: string, accessToken: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    await this.assertRoomNotExpired(room);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    return this.ensureActiveSetupMaterialized(room);
  }

  private async ensureActiveSetupMaterialized(room: Prisma.GameRoomModel) {
    await this.assertRoomNotExpired(room);
    const state = room.state as unknown as GameState;
    if (room.status !== "ACTIVE" || state.setupState?.phase !== "complete" || state.setupApplied) return room;
    await this.repairUnmaterializedActiveSetup(room.id);
    const repaired = await this.prismaClient.gameRoom.findUnique({ where: { id: room.id } });
    if (!repaired) throw new Error("Room not found.");
    await this.assertRoomNotExpired(repaired);
    return repaired;
  }

  /** Repair the old activation race only when event history proves no gameplay command followed setup. */
  private async repairUnmaterializedActiveSetup(roomId: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repaired = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const room = await tx.gameRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true, version: true, lastActivityAt: true, state: true } });
        const state = room?.state as GameState | undefined;
        if (room?.status !== "ACTIVE" || state?.setupState?.phase !== "complete" || state.setupApplied) return true;
        const setupEvent = await tx.gameEvent.findFirst({ where: { roomId, type: "setup.updated" }, orderBy: { version: "desc" }, select: { version: true, actorId: true, controlSource: true } });
        if (!setupEvent) throw new Error("Room setup recovery is ambiguous because its final setup event is missing.");
        const laterEvent = await tx.gameEvent.findFirst({ where: { roomId, version: { gt: setupEvent.version } }, select: { id: true } });
        if (laterEvent) throw new Error("Room setup recovery is ambiguous because gameplay events followed setup.");
        const prepared = applyCompletedSetup(state);
        const version = room.version + 1;
        const changed = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, new Date()), data: { state: prepared as any, version } });
        if (changed.count !== 1) return false;
        await tx.gameEvent.create({ data: { roomId, version, actorId: setupEvent.actorId, controlSource: setupEvent.controlSource, type: knownRoomEventType("setup.updated"), payload: { phase: "complete", action: "legacy-active-materialization" } } });
        return true;
      });
      if (repaired) return;
    }
    throw new Error("The room changed repeatedly while recovering setup.");
  }

  private async assertRoomNotExpired(room: RoomExpirySnapshot) {
    if (await this.isRoomExpired(room)) throw new Error("This room has expired.");
  }

  private async assertCurrentRoomNotExpired(roomId: string) {
    const current = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true, lastActivityAt: true } });
    if (!current) throw new Error("Room not found.");
    await this.assertRoomNotExpired(current);
  }

  private roomSnapshotWhere(room: RoomWriteSnapshot, activityAt: Date) {
    const liveAlternatives: Prisma.GameRoomWhereInput[] = [{ lastActivityAt: { gt: new Date(activityAt.getTime() - ROOM_IDLE_TIMEOUT_MS) } }];
    if (room.status === "ACTIVE") liveAlternatives.push({ participants: { some: { role: "PLAYER", userId: { not: null } } } });
    return {
      id: room.id,
      status: room.status,
      version: room.version,
      lastActivityAt: { equals: room.lastActivityAt },
      ...(room.status === "COMPLETED" ? {} : { AND: [{ OR: liveAlternatives }] }),
    };
  }

  private nextRoomActivityAt(room: RoomWriteSnapshot) {
    // Ensure a successful write always invalidates another request holding the
    // same snapshot, even when the clock has not advanced by a millisecond.
    return new Date(Math.max(Date.now(), room.lastActivityAt.getTime() + 1));
  }

  private async touchRoomSnapshot(tx: Prisma.TransactionClient, room: RoomWriteSnapshot, activityAt: Date) {
    const touched = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, activityAt), data: { lastActivityAt: activityAt } });
    if (touched.count !== 1) throw new RoomSnapshotConflictError();
  }

  private async guardRoomSnapshot(tx: Prisma.TransactionClient, room: RoomWriteSnapshot, evaluatedAt: Date) {
    const guarded = await tx.gameRoom.updateMany({ where: this.roomSnapshotWhere(room, evaluatedAt), data: { lastActivityAt: room.lastActivityAt } });
    if (guarded.count !== 1) throw new RoomSnapshotConflictError();
  }

  private async lockParticipantSnapshot(tx: Prisma.TransactionClient, where: Prisma.ParticipantWhereInput & { id: string }, connectedAt: Date | null) {
    const locked = await tx.participant.updateMany({ where, data: { connectedAt } });
    return locked.count === 1;
  }

  private async lockLiveSessionSnapshot(tx: Prisma.TransactionClient, where: Prisma.ParticipantWhereInput & { id: string }, connectedAt: Date | null, observedExpiry: Date) {
    const evaluatedAt = new Date();
    if (isSessionExpired(observedExpiry, evaluatedAt.getTime())) throw new Error("Session token has expired.");
    const locked = await this.lockParticipantSnapshot(tx, { ...where, sessionExpiresAt: { gt: evaluatedAt } }, connectedAt);
    if (locked) return true;
    await this.assertParticipantSessionLive(tx, where.id);
    return false;
  }

  private async assertParticipantSessionLive(tx: Prisma.TransactionClient, participantId: string) {
    const current = await tx.participant.findFirst({ where: { id: participantId }, select: { sessionExpiresAt: true } });
    if (current && isSessionExpired(current.sessionExpiresAt)) throw new Error("Session token has expired.");
  }

  private async roomSnapshotConflict(roomId: string, fullRoomMaxPlayers?: number): Promise<Error> {
    let current = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true, lastActivityAt: true } });
    if (!current) return new Error("Room not found.");
    if (await this.isRoomExpired(current)) return new Error("This room has expired.");
    if (fullRoomMaxPlayers !== undefined) {
      const playerCount = await this.prismaClient.participant.count({ where: { roomId, role: "PLAYER" } });
      current = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true, lastActivityAt: true } });
      if (!current) return new Error("Room not found.");
      if (await this.isRoomExpired(current)) return new Error("This room has expired.");
      if (playerCount >= fullRoomMaxPlayers) return new Error("This room is full.");
    }
    return new Error("The room changed before this action was committed. Refresh and try again.");
  }

  private async isRoomExpired(room: RoomExpirySnapshot) {
    let current = room;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (current.status === "EXPIRED") return true;
      if (current.status === "COMPLETED") return false;
      const lastActivityAt = current.lastActivityAt.getTime();
      const linkedActive = current.status === "ACTIVE" && await this.prismaClient.participant.count({ where: { roomId: current.id, userId: { not: null }, role: "PLAYER" } }) > 0;
      if (linkedActive) return false;
      if (Date.now() - lastActivityAt < ROOM_IDLE_TIMEOUT_MS) return false;

      // Only expire the exact idle snapshot we observed. If room activity or a
      // terminal status update wins first, reload and evaluate that state instead.
      const expired = await this.prismaClient.gameRoom.updateMany({
        where: { id: current.id, status: current.status, lastActivityAt: current.lastActivityAt, ...(current.status === "ACTIVE" ? { participants: { none: { userId: { not: null }, role: "PLAYER" } } } : {}) },
        data: { status: "EXPIRED" },
      });
      if (expired.count === 1) return true;
      const latest = await this.prismaClient.gameRoom.findUnique({ where: { id: current.id }, select: { id: true, status: true, lastActivityAt: true } });
      if (!latest) throw new Error("Room not found.");
      current = latest;
    }
    throw new Error("The room changed repeatedly while checking its expiry.");
  }

  private async refreshStatus(roomId: string, maxPlayers: number, state?: GameState) {
    // Lock each player row with a compare-and-set before deriving presence. This
    // makes a concurrent connect/disconnect either wait for this status write or
    // force a retry instead of letting an old presence snapshot win last.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const refreshed = await this.prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
        const room = await tx.gameRoom.findUnique({ where: { id: roomId }, select: { status: true, lastActivityAt: true, version: true, state: true } });
        if (!room || room.status === "COMPLETED" || room.status === "EXPIRED") return true;
        const players = await tx.participant.findMany({ where: { roomId, role: "PLAYER" } });
        for (const player of [...players].sort((left: any, right: any) => String(left.id).localeCompare(String(right.id)))) {
          const locked = await tx.participant.updateMany({
            where: { id: player.id, roomId, role: "PLAYER", connectionId: player.connectionId, connectedAt: player.connectedAt, ready: player.ready, botControlled: player.botControlled },
            data: { connectedAt: player.connectedAt },
          });
          if (locked.count !== 1) return false;
        }
        const linkedActive = room.status === "ACTIVE" && players.some((participant: any) => participant.userId !== null && participant.userId !== undefined);
        const expiredByIdle = !linkedActive && Date.now() - (room.lastActivityAt?.getTime?.() ?? Date.now()) >= ROOM_IDLE_TIMEOUT_MS;
        if (expiredByIdle) {
          const expired = await tx.gameRoom.updateMany({ where: { id: roomId, status: room.status, version: room.version, lastActivityAt: room.lastActivityAt, ...(room.status === "ACTIVE" ? { participants: { none: { userId: { not: null }, role: "PLAYER" } } } : {}) }, data: { status: "EXPIRED" } });
          return expired.count === 1;
        }

        const currentState = (room.state ?? state) as GameState | undefined;
        const setupComplete = !currentState?.setupState || currentState.setupState.phase === "complete";
        let nextStatus = room.status;
        if (room.status === "ACTIVE") {
          const allPlayersDisconnected = players.length > 0 && players.every((participant: any) => !participant.connectedAt);
          nextStatus = allPlayersDisconnected ? "ABANDONED" : "ACTIVE";
        } else if (room.status !== "ABANDONED" || (setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && (participant.connectedAt || participant.botControlled)))) {
          nextStatus = setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && (participant.connectedAt || participant.botControlled)) ? "ACTIVE" : "WAITING";
        }
        if (nextStatus === room.status) return true;
        if (nextStatus === "ACTIVE" && currentState?.setupState?.phase === "complete" && !currentState.setupApplied) {
          const prepared = applyCompletedSetup(currentState);
          const version = room.version + 1;
          const setupEvent = await tx.gameEvent.findFirst({ where: { roomId, type: "setup.updated" }, orderBy: { version: "desc" }, select: { actorId: true, controlSource: true } });
          const changed = await tx.gameRoom.updateMany({ where: { id: roomId, status: room.status, version: room.version, lastActivityAt: room.lastActivityAt }, data: { status: nextStatus, state: prepared as any, version } });
          if (changed.count !== 1) return false;
          await tx.gameEvent.create({ data: { roomId, version, actorId: setupEvent?.actorId ?? "setup-migration", controlSource: setupEvent?.controlSource ?? "human", type: knownRoomEventType("setup.updated"), payload: { phase: "complete", action: "legacy-activation-materialization" } } });
          return true;
        }
        const changed = await tx.gameRoom.updateMany({ where: { id: roomId, status: room.status, version: room.version, lastActivityAt: room.lastActivityAt }, data: { status: nextStatus } });
        return changed.count === 1;
      });
      if (refreshed) return;
    }
    throw new Error("The room changed repeatedly while refreshing its lifecycle status.");
  }

  private async view(roomId: string, afterVersion = 0, audience: StateAudience = "spectator", viewerPlayerIndex?: number): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, include: { participants: { include: { user: { select: { username: true } } } }, events: { where: { version: { gt: afterVersion } }, orderBy: { version: "desc" }, take: MAX_RETAINED_ROOM_EVENTS } } });
    if (!room) throw new Error("Room not found.");
    const events: RoomEvent[] = room.events.map((event) => ({ id: event.id, roomId: event.roomId, version: event.version, actorId: event.actorId, type: event.type, controlSource: event.controlSource === "bot" ? "bot" : "human", payload: redactCardIdentifiers(event.payload) as JsonValue, createdAt: event.createdAt.toISOString() }));
    return { id: room.id, code: room.code, status: room.status.toLowerCase() as RoomView["status"], privacy: room.privacy.toLowerCase() as RoomView["privacy"], version: room.version, state: projectState(room.state as unknown as GameState, audience, viewerPlayerIndex), participants: room.participants.map((participant: any) => ({ id: participant.id, displayName: participant.displayName, ...(participant.user?.username ? { username: participant.user.username } : {}), role: participant.role.toLowerCase(), playerIndex: participant.playerIndex ?? undefined, connected: Boolean(participant.connectedAt), ready: Boolean(participant.ready), botControlled: Boolean(participant.botControlled), botAssisted: Boolean(participant.botAssisted) })), events };
  }
}
