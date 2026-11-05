import { randomBytes, createHash } from "node:crypto";
import { setupDeploymentState, applyCommandEnvelope, applyCompletedSetup, applySetupAction, chooseBotCommand, chooseBotSetupActionWithRecord, createMvpRoomGame, createRoomGame, projectState, type GameCommandEnvelope, type GameState, type SetupAction, type StateAudience } from "@abominations/game-engine";
import type { PublicReplayExport, PublicReplayPage, PublicRoomSummary, ReplayFrame, RoomEvent, RoomPrivacy, RoomView, SessionResponse } from "@abominations/shared";
import { completedMatchRows, emptyMatchCounters, updateMatchCounters } from "./player-stats.js";
import { MAX_REPLAY_PAGE_BYTES, MAX_REPLAY_PAGE_FRAMES, MAX_REPLAY_VERSIONS, MAX_RETAINED_ROOM_EVENTS, ROOM_IDLE_TIMEOUT_MS, laserFenceCardOwner, mutationBattleOwner, terminalResultSummary, type RoomSocketPrincipal, type RoomStore } from "./store.js";
import { cacheReplayFrames, getCachedReplayFrames, MAX_REPLAY_EXPORT_BYTES, reconstructReplay, type ReplayCommandRecord, type ReplaySourceEvent } from "./replay.js";
import { isSessionExpired, sessionExpiresAt } from "./session.js";
import { prisma } from "../lib/prisma.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const gameSeed = () => randomBytes(4).readUInt32LE(0);
const privateGameSeed = () => randomBytes(32).toString("hex");
export type RoomEventDivergence = Readonly<{
  roomCode: string;
  snapshotVersion: number;
  latestEventVersion: number | null;
  missingVersionCount: number;
}>;
const getPrisma = () => {
  if (!prisma) throw new Error("DATABASE_URL is required to initialize Prisma.");
  return prisma;
};

/** Prisma-backed store. The HTTP server selects this when DATABASE_URL is configured. */
export class PrismaRoomStore implements RoomStore {
  private readonly reportedEventDivergences = new Set<string>();

  constructor(
    private readonly prismaClient = getPrisma(),
    private readonly allowDevelopmentFixture = false,
    private readonly onEventDivergence?: (issue: RoomEventDivergence) => void,
    private readonly testRoomSeed?: number,
  ) {}

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
    const seed = this.testRoomSeed ?? gameSeed();
    const secretSeed = this.allowDevelopmentFixture || this.testRoomSeed !== undefined ? undefined : privateGameSeed();
    const state = this.allowDevelopmentFixture
      ? createRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`, secretSeed)
      : createMvpRoomGame(maxPlayers as 2 | 3 | 4, seed, `room-${roomCode}`, secretSeed);
    if (privacy !== "private" && privacy !== "public") throw new Error("Room privacy must be private or public.");
    const room = await this.prismaClient.gameRoom.create({ data: { code: roomCode, maxPlayers, privacy: privacy.toUpperCase() as "PRIVATE" | "PUBLIC", state: state as any, initialReplayState: structuredClone(state) as any, playerStats: emptyMatchCounters(maxPlayers) as any, isTest: this.allowDevelopmentFixture } });
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player 1", role: "PLAYER", playerIndex: 0, ready: false, connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
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
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    if (room.status === "EXPIRED") throw new Error("This room has expired.");
    if (room.matchStarted) throw new Error("This match has already started.");
    const count = await this.prismaClient.participant.count({ where: { roomId: room.id, role: "PLAYER" } });
    if (count >= room.maxPlayers) throw new Error("This room is full.");
    const accessToken = token();
    let participant;
    try {
      participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Player", role: "PLAYER", playerIndex: count, ready: false, connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new Error("This room is full.");
      throw error;
    }
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: accessToken };
  }

  async startMatch(roomCode: string, accessToken: string) {
    const room = await this.authorize(roomCode, accessToken);
    const starter = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken), role: "PLAYER" } });
    if (!starter || starter.playerIndex === null || !starter.connectedAt) throw new Error("Only a connected player can start the match.");
    const players = await this.prismaClient.participant.findMany({ where: { roomId: room.id, role: "PLAYER" }, select: { id: true, connectedAt: true } });
    if (players.length !== room.maxPlayers || players.some((player: any) => !player.connectedAt)) throw new Error("Wait until every player has joined and is connected.");
    const started = await this.prismaClient.gameRoom.updateMany({ where: { id: room.id, status: "WAITING", matchStarted: false }, data: { matchStarted: true, lastActivityAt: new Date() } });
    if (started.count !== 1) throw new Error("This room has already started.");
    return this.view(room.id, 0, "player", starter.playerIndex ?? undefined);
  }

  async spectateRoom(roomCode: string, displayName: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    if (room.privacy === "PRIVATE") throw new Error("This room is private and does not allow spectator entry.");
    const accessToken = token();
    const participant = await this.prismaClient.participant.create({ data: { roomId: room.id, displayName: displayName.trim().slice(0, 32) || "Spectator", role: "SPECTATOR", connectedAt: new Date(), tokenHash: hash(accessToken), sessionExpiresAt: sessionExpiresAt() } });
    return { room: await this.view(room.id), participantId: participant.id, token: accessToken };
  }

  async disconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    if (participant.connectionId && participant.connectionId !== connectionId) return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
    await this.prismaClient.participant.updateMany({ where: { id: participant.id, tokenHash: hash(accessToken), ...(participant.connectionId ? { connectionId } : {}) }, data: { connectedAt: null, disconnectedAt: new Date() } });
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  async reconnect(roomCode: string, accessToken: string, connectionId = "legacy") {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const changed = await this.prismaClient.participant.updateMany({ where: { id: participant.id, tokenHash: hash(accessToken) }, data: { connectedAt: new Date(), disconnectedAt: null, botControlled: false, connectionId } });
    if (changed.count !== 1) throw new Error("This room session was replaced. Sign in again to resume.");
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  async rotateSession(roomCode: string, accessToken: string): Promise<SessionResponse> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const replacement = token();
    await this.prismaClient.$transaction(async (tx: any) => {
      await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
      const updated = await tx.participant.updateMany({ where: { id: participant.id, tokenHash: hash(accessToken) }, data: { tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectionId: null, connectedAt: null, disconnectedAt: new Date() } });
      if (updated.count !== 1) throw new Error("This room session was replaced. Sign in again to resume.");
    });
    return { room: await this.view(room.id, 0, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined), participantId: participant.id, token: replacement };
  }

  async claimParticipant(roomCode: string, accessToken: string, user: { id: string; username: string; emailVerifiedAt: Date | null }): Promise<SessionResponse> {
    if (!user.emailVerifiedAt) throw new Error("Verify your email before linking a game seat.");
    const room = await this.authorize(roomCode, accessToken);
    if (room.status === "COMPLETED" || room.status === "EXPIRED") throw new Error("Only an active match seat can be linked to an account.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken), role: "PLAYER" } });
    if (!participant) throw new Error("Only a player seat can be linked to an account.");
    if (participant.userId && participant.userId !== user.id) throw new Error("This seat is already linked to another account.");
    const replacement = token();
    await this.prismaClient.$transaction(async (tx: any) => {
      await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
      const linked = await tx.participant.updateMany({ where: { id: participant.id, tokenHash: hash(accessToken), ...(participant.userId ? { userId: user.id } : { userId: null }) }, data: { userId: user.id, displayName: user.username, tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectedAt: null, disconnectedAt: new Date(), botControlled: false, connectionId: null } });
      if (linked.count !== 1) throw new Error("This seat was linked from another session. Refresh the room and try again.");
    });
    return { room: await this.view(room.id, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: replacement, accountLinked: true };
  }

  async resumeParticipant(roomId: string, user: { id: string; username: string }): Promise<SessionResponse> {
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId, userId: user.id, role: "PLAYER" }, include: { room: true } });
    if (!participant) throw new Error("You do not have a player seat in this match.");
    const replacement = token();
    await this.prismaClient.$transaction(async (tx: any) => {
      await tx.webSocketTicket.deleteMany({ where: { participantId: participant.id } });
      await tx.participant.update({ where: { id: participant.id }, data: { tokenHash: hash(replacement), sessionExpiresAt: sessionExpiresAt(), connectedAt: null, disconnectedAt: new Date(), botControlled: false, displayName: user.username, connectionId: null } });
    });
    return { room: await this.view(participant.roomId, 0, "player", participant.playerIndex ?? undefined), participantId: participant.id, token: replacement, accountLinked: true };
  }

  async setReady(roomCode: string, accessToken: string, ready: boolean) {
    const room = await this.authorize(roomCode, accessToken);
    if (!room.matchStarted) throw new Error("Start the match before players can ready up.");
    if (room.status !== "WAITING") throw new Error("Readiness can only change while a room is waiting.");
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant || participant.role !== "PLAYER") throw new Error("Only players can change readiness.");
    if (!participant.connectedAt) throw new Error("Reconnect before changing readiness.");
    const updated = await this.prismaClient.participant.updateMany({ where: { id: participant.id, tokenHash: hash(accessToken), botControlled: false, connectedAt: { not: null } }, data: { ready } });
    if (updated.count !== 1) throw new Error("Reconnect before changing readiness.");
    await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { lastActivityAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    const activated = await this.prismaClient.gameRoom.findUnique({ where: { id: room.id }, select: { status: true, state: true, version: true } });
    if (activated?.status === "ACTIVE" && (activated.state as unknown as GameState).setupState?.phase === "complete" && !(activated.state as unknown as GameState).setupApplied) {
      await this.commitSetupCompletion(room.id, participant.id, activated.version, activated.state as unknown as GameState, "human");
    }
    return this.view(room.id, 0, "player", participant.playerIndex ?? undefined);
  }

  async setupAction(roomCode: string, accessToken: string, action: SetupAction, expectedRevision: number) {
    const room = await this.authorize(roomCode, accessToken);
    if (!room.matchStarted) throw new Error("This match has not been started yet.");
    if (room.version !== expectedRevision) throw new Error(`Expected revision ${expectedRevision}, current revision is ${room.version}.`);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER" || actor.playerIndex === null) throw new Error("Only seated players can complete setup.");
    const playerIndex = actor.playerIndex;
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    const state = room.state as unknown as GameState;
    if (!state.setupState) throw new Error("This room has no setup state.");
    const nextSetup = applySetupAction(state.setupState, actor.playerIndex, action);
    if (action.type === "choose-starting-choice" && action.startingChoice.kind === "deploy") {
      const choice = action.startingChoice;
      setupDeploymentState(state, actor.playerIndex, "placements" in choice ? choice.placements : [choice]);
    }
    if (nextSetup.phase === "complete") applyCompletedSetup({ ...state, setupState: nextSetup });
    const nextState = { ...state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    const version = room.version + 1;
    await this.prismaClient.$transaction(async (tx: any) => {
      const human = await tx.participant.updateMany({ where: { id: actor.id, tokenHash: hash(accessToken), botControlled: false }, data: { disconnectedAt: actor.disconnectedAt } });
      if (human.count !== 1) throw new Error("This room session was replaced. Reconnect before completing setup.");
      const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version }, data: { state: nextState as any, version, lastActivityAt: new Date() } });
      if (changed.count !== 1) throw new Error("The room changed before setup was committed. Refresh and try again.");
      const replayCommand: ReplayCommandRecord = { kind: "setup", playerIndex, action: structuredClone(action) };
      await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: "setup.updated", payload: { phase: nextState.setupState.phase, action: action.type }, replayCommand: replayCommand as any } });
    });
    await this.refreshStatus(room.id, room.maxPlayers, nextState);
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async getRoom(roomCode: string, accessToken: string, afterVersion = 0) {
    const participant = await this.prismaClient.participant.findFirst({
      relationLoadStrategy: "join",
      where: { room: { code: roomCode.toUpperCase() }, tokenHash: hash(accessToken) },
      include: {
        room: {
          include: {
            participants: { include: { user: { select: { username: true } } } },
            events: { orderBy: { version: "desc" }, take: MAX_RETAINED_ROOM_EVENTS },
          },
        },
      },
    });
    if (!participant) {
      const roomExists = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() }, select: { id: true } });
      throw new Error(roomExists ? "Invalid room token." : "Room not found.");
    }
    const room = participant.room;
    if (isSessionExpired(participant.sessionExpiresAt)) throw new Error("Session token has expired.");
    const linkedActive = room.status === "ACTIVE" && room.participants.some((candidate: any) => candidate.role === "PLAYER" && candidate.userId !== null);
    const lastActivityAt = room.lastActivityAt?.getTime?.() ?? Date.now();
    if (room.status !== "COMPLETED" && !linkedActive && Date.now() - lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
      await this.prismaClient.gameRoom.update({ where: { id: room.id }, data: { status: "EXPIRED" } });
      throw new Error("This room has expired.");
    }
    return this.view(room.id, afterVersion, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined, room);
  }

  async getPublicReplay(roomCode: string, fromVersion: number, requestedLimit: number): Promise<PublicReplayPage> {
    const room = await this.prismaClient.gameRoom.findUnique({
      where: { code: roomCode.toUpperCase() },
      select: { id: true, code: true, privacy: true, status: true, version: true, initialReplayState: true, state: true },
    });
    if (!room || room.privacy !== "PUBLIC") return { replayable: false, reason: "not-found" };
    if (room.status !== "COMPLETED") return { replayable: false, reason: "not-completed" };
    if (!Number.isInteger(fromVersion) || fromVersion < 0 || fromVersion > room.version
      || !Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error("Replay pagination is invalid.");
    if (!room.initialReplayState) return { replayable: false, reason: "history-incomplete" };
    const initial = room.initialReplayState as unknown as GameState;
    const limit = Math.min(requestedLimit, MAX_REPLAY_PAGE_FRAMES);
    const pageFor = (base: ReplayFrame, candidate: ReplayFrame[], nextFromVersion?: number): PublicReplayPage => ({ replayable: true, roomCode: room.code, terminalVersion: room.version, boardId: initial.boardId, boardVersion: initial.boardVersion, boardContentHash: initial.boardContentHash, rulesetVersion: initial.rulesetVersion, base, frames: candidate, ...(nextFromVersion === undefined ? {} : { nextFromVersion }) });
    const cacheKey = `prisma:${room.id}`;
    let frames = getCachedReplayFrames(cacheKey, room.version);
    if (!frames) {
      const events = await this.prismaClient.gameEvent.findMany({ where: { roomId: room.id }, orderBy: { version: "asc" }, take: MAX_REPLAY_VERSIONS + 1, select: { version: true, type: true, replayCommand: true } });
      if (events.length > MAX_REPLAY_VERSIONS) return { replayable: false, reason: "history-too-large" };
      if (events.length !== room.version || events.some((event: any) => !event.replayCommand)) return { replayable: false, reason: "history-incomplete" };
      const sources: ReplaySourceEvent[] = (events as any[]).map((event) => ({ version: event.version, eventType: event.type, record: event.replayCommand as ReplayCommandRecord }));
      frames = [];
      const status = reconstructReplay(initial, sources, room.state as unknown as GameState, room.version, (frame) => frames!.push(frame));
      if (status !== "ok") return { replayable: false, reason: status };
      cacheReplayFrames(cacheKey, room.version, frames);
    }
    const cachedBase = frames[fromVersion];
    if (!cachedBase || cachedBase.version !== fromVersion) return { replayable: false, reason: "history-incomplete" };
    const base = structuredClone(cachedBase);
    const selected: ReplayFrame[] = [];
    for (const frame of frames.slice(fromVersion + 1, fromVersion + limit + 1)) {
      const candidate = [...selected, frame];
      if (Buffer.byteLength(JSON.stringify(pageFor(base, candidate))) > MAX_REPLAY_PAGE_BYTES) break;
      selected.push(structuredClone(frame));
    }
    if (!selected.length && fromVersion < room.version
      && Buffer.byteLength(JSON.stringify(pageFor(base, [frames[fromVersion + 1]!]))) > MAX_REPLAY_PAGE_BYTES) return { replayable: false, reason: "frame-too-large" };
    const lastVersion = selected.at(-1)?.version ?? base.version;
    const page = pageFor(base, selected, lastVersion < room.version ? lastVersion : undefined);
    if (Buffer.byteLength(JSON.stringify(page)) > MAX_REPLAY_PAGE_BYTES) return { replayable: false, reason: "frame-too-large" };
    return page;
  }

  async getPublicReplayExport(roomCode: string): Promise<PublicReplayExport> {
    const room = await this.prismaClient.gameRoom.findUnique({
      where: { code: roomCode.toUpperCase() },
      select: { id: true, code: true, privacy: true, status: true, version: true, initialReplayState: true, state: true },
    });
    if (!room || room.privacy !== "PUBLIC") return { replayable: false, reason: "not-found" };
    if (room.status !== "COMPLETED") return { replayable: false, reason: "not-completed" };
    if (!room.initialReplayState) return { replayable: false, reason: "history-incomplete" };
    const initial = room.initialReplayState as unknown as GameState;
    const result: PublicReplayExport & { replayable: true } = {
      replayable: true,
      formatVersion: 1,
      roomCode: room.code,
      terminalVersion: room.version,
      boardId: initial.boardId,
      boardVersion: initial.boardVersion,
      boardContentHash: initial.boardContentHash,
      rulesetVersion: initial.rulesetVersion,
      frames: [],
    };
    const cacheKey = `prisma:${room.id}`;
    let frames = getCachedReplayFrames(cacheKey, room.version);
    if (!frames) {
      const events = await this.prismaClient.gameEvent.findMany({ where: { roomId: room.id }, orderBy: { version: "asc" }, take: MAX_REPLAY_VERSIONS + 1, select: { version: true, type: true, replayCommand: true } });
      if (events.length > MAX_REPLAY_VERSIONS) return { replayable: false, reason: "history-too-large" };
      if (events.length !== room.version || events.some((event: any) => !event.replayCommand)) return { replayable: false, reason: "history-incomplete" };
      const sources: ReplaySourceEvent[] = (events as any[]).map((event) => ({ version: event.version, eventType: event.type, record: event.replayCommand as ReplayCommandRecord }));
      frames = [];
      const status = reconstructReplay(initial, sources, room.state as unknown as GameState, room.version, (frame) => frames!.push(frame));
      if (status !== "ok") return { replayable: false, reason: status };
      cacheReplayFrames(cacheKey, room.version, frames);
    }
    result.frames = structuredClone(frames);
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_REPLAY_EXPORT_BYTES) return { replayable: false, reason: "export-too-large" };
    return result;
  }

  async submitAction(roomCode: string, accessToken: string, envelope: GameCommandEnvelope) {
    const room = await this.authorize(roomCode, accessToken);
    const actor = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    const duplicate = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
    if (duplicate) return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
    if (room.status !== "ACTIVE") throw new Error("This room is not ready for gameplay.");
    const gameState = room.state as unknown as GameState;
    const requiredPlayer = this.requiredPlayer(gameState, envelope);
    if (actor.playerIndex !== requiredPlayer) throw new Error("It is not your turn.");
    try {
      await this.commitCommand(room, actor, envelope, "human", { tokenHash: hash(accessToken) });
    } catch (error) {
      // A concurrent retry can lose the room-version compare-and-swap after
      // another process commits this same action. Return the durable result
      // only when the winning receipt belongs to this authenticated actor.
      const concurrentReceipt = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
      if (concurrentReceipt?.actorId === actor.id) return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
      throw error;
    }
    return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
  }

  async createSocketTicket(roomCode: string, accessToken: string): Promise<string> {
    const room = await this.authorize(roomCode, accessToken);
    const participant = await this.prismaClient.participant.findFirst({ where: { roomId: room.id, tokenHash: hash(accessToken) } });
    if (!participant) throw new Error("Invalid room token.");
    const value = token();
    await this.prismaClient.webSocketTicket.create({ data: { roomId: room.id, participantId: participant.id, participantTokenHash: participant.tokenHash, tokenHash: hash(value), expiresAt: new Date(Date.now() + 30_000) } });
    return value;
  }

  async consumeSocketTicket(roomCode: string, ticket: string): Promise<RoomSocketPrincipal> {
    const record = await this.prismaClient.webSocketTicket.findUnique({ where: { tokenHash: hash(ticket) }, include: { room: true, participant: true } });
    if (!record || record.room.code !== roomCode.toUpperCase() || record.consumedAt || record.expiresAt <= new Date() || record.participant.tokenHash !== record.participantTokenHash) throw new Error("WebSocket ticket is invalid or expired.");
    const consumed = await this.prismaClient.webSocketTicket.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new Error("WebSocket ticket is invalid or expired.");
    return { roomCode: record.room.code, participantId: record.participantId, sessionHash: record.participantTokenHash };
  }

  async getRoomForParticipant(roomCode: string, participantId: string, afterVersion = 0): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    const participant = room && await this.prismaClient.participant.findFirst({ where: { id: participantId, roomId: room.id } });
    if (!room || !participant) throw new Error("Room participant not found.");
    return this.view(room.id, afterVersion, participant.role === "PLAYER" ? "player" : "spectator", participant.playerIndex ?? undefined);
  }

  async submitActionForParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string, envelope: GameCommandEnvelope): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const actor = await this.prismaClient.participant.findFirst({ where: { id: participantId, roomId: room.id, connectionId, tokenHash: sessionHash, connectedAt: { not: null } } });
    if (!actor || actor.role !== "PLAYER") throw new Error("Spectators cannot submit game actions.");
    if (actor.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    if (envelope.actorId !== actor.id) throw new Error("Command actor does not match the room participant.");
    const duplicate = await this.prismaClient.commandReceipt.findUnique({ where: { roomId_actionId: { roomId: room.id, actionId: envelope.actionId } } });
    if (duplicate) return this.view(room.id, 0, "player", actor.playerIndex ?? undefined);
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
    if (participant.connectionId && participant.connectionId !== connectionId) return this.getRoomForParticipant(roomCode, participantId);
    await this.prismaClient.participant.updateMany({ where: { id: participantId, connectionId }, data: { connectedAt: null, disconnectedAt: new Date() } });
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.getRoomForParticipant(roomCode, participantId);
  }

  async connectParticipant(roomCode: string, participantId: string, connectionId: string, sessionHash: string): Promise<RoomView> {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const changed = await this.prismaClient.participant.updateMany({ where: { id: participantId, roomId: room.id, tokenHash: sessionHash }, data: { connectedAt: new Date(), disconnectedAt: null, botControlled: false, connectionId } });
    if (changed.count !== 1) throw new Error("Room participant not found.");
    await this.refreshStatus(room.id, room.maxPlayers, room.state as unknown as GameState);
    return this.getRoomForParticipant(roomCode, participantId);
  }

  async processBotTakeovers(nowMs = Date.now()): Promise<string[]> {
    const due = await this.prismaClient.participant.findMany({ where: { role: "PLAYER", connectedAt: null, botControlled: false, disconnectedAt: { lte: new Date(nowMs - 4 * 60_000) }, room: { status: { in: ["WAITING", "ACTIVE"] } } }, select: { id: true, roomId: true } });
    const affected = new Set<string>();
    for (const participant of due) {
      const changed = await this.prismaClient.participant.updateMany({ where: { id: participant.id, connectedAt: null, botControlled: false, disconnectedAt: { lte: new Date(nowMs - 4 * 60_000) } }, data: { botControlled: true, botAssisted: true } });
      if (changed.count) affected.add(participant.roomId);
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

  private async commitCommand(room: any, actor: any, envelope: GameCommandEnvelope, controlSource: "human" | "bot", humanLease?: { tokenHash?: string; connectionId?: string }): Promise<void> {
    const state = room.state as unknown as GameState;
    const result = applyCommandEnvelope(state, envelope, room.version);
    const version = room.version + 1;
    const counters = updateMatchCounters(state, result.state, room.playerStats as any, actor.playerIndex ?? 0);
    const terminal = result.state.phase === "game-over";
    await this.prismaClient.$transaction(async (tx: any) => {
      if (controlSource === "bot") {
        const lease = await tx.participant.updateMany({ where: { id: actor.id, botControlled: true, connectedAt: null }, data: { disconnectedAt: actor.disconnectedAt } });
        if (lease.count !== 1) throw new Error("Bot control changed before this action was committed.");
      } else {
        const human = await tx.participant.findFirst({ where: { id: actor.id, botControlled: false, ...(humanLease?.tokenHash ? { tokenHash: humanLease.tokenHash } : {}), ...(humanLease?.connectionId ? { connectionId: humanLease.connectionId, connectedAt: { not: null } } : {}) } });
        if (!human) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
      }
      const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version, status: "ACTIVE" }, data: { state: result.state as any, playerStats: counters as any, version, lastActivityAt: new Date(), ...(terminal ? { status: "COMPLETED", completedAt: new Date() } : {}) } });
      if (changed.count !== 1) throw new Error("The game changed before this action was committed. Refresh and try again.");
      const replayCommand: ReplayCommandRecord = { kind: "command", playerIndex: actor.playerIndex ?? 0, command: structuredClone(envelope.command) };
      await tx.gameEvent.create({ data: { roomId: room.id, version, actorId: actor.id, type: result.eventType, controlSource, payload: { ...result.eventPayload, receipt: result.receipt }, replayCommand: replayCommand as any } });
      await tx.commandReceipt.create({ data: { roomId: room.id, actionId: envelope.actionId, actorId: actor.id, version, eventType: result.eventType } });
      if (terminal) {
        const participants = await tx.participant.findMany({ where: { roomId: room.id, role: "PLAYER", userId: { not: null }, playerIndex: { not: null } }, include: { user: { select: { username: true } } } });
        const identities = participants.map((participant: any) => ({ participantId: participant.id, userId: participant.userId, username: participant.user?.username ?? participant.displayName, playerIndex: participant.playerIndex, botAssisted: participant.botAssisted }));
        const rows = room.isTest ? [] : completedMatchRows(room.id, result.state, counters, identities);
        if (rows.length) await tx.playerMatchStat.createMany({ data: rows });
        const winner = participants.find((participant: any) => participant.playerIndex === result.state.winnerPlayer);
        const winnerParticipant = winner ?? await tx.participant.findFirst({ where: { roomId: room.id, role: "PLAYER", playerIndex: result.state.winnerPlayer } });
        const winnerName = result.state.winnerPlayer === undefined ? null : winner?.user?.username ?? winnerParticipant?.displayName ?? actor.displayName;
        const summary = terminalResultSummary(result.state, { type: result.eventType, version });
        await tx.gameResult.upsert({ where: { roomId: room.id }, update: { winnerId: winnerParticipant?.id ?? null, winnerName, summary }, create: { roomId: room.id, winnerId: winnerParticipant?.id ?? null, winnerName, summary } });
      }
    });
  }

  private async runBotActions(roomCode: string): Promise<void> {
    for (let step = 0; step < 12; step += 1) {
      const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
      if (!room || !["ACTIVE", "WAITING"].includes(room.status)) return;
      const state = room.state as unknown as GameState;
      const participants = await this.prismaClient.participant.findMany({ where: { roomId: room.id, role: "PLAYER" } });
      const botIndices = new Set<number>(participants.filter((participant: any) => participant.botControlled && participant.playerIndex !== null).map((participant: any) => participant.playerIndex));
      if (!botIndices.size) return;
      if (state.setupState && state.setupState.phase !== "complete") {
        const field = state.setupState.phase === "monster-selection" ? "monsterId" : state.setupState.phase === "branch-selection" ? "branch" : state.setupState.phase === "lair-selection" ? "lair" : "startingChoice";
        const seats = [...state.setupState.seats].sort((left, right) => state.setupState?.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
        const playerIndex = state.setupState.phase === "unused-branch-placement" ? state.setupState.definition.playerCount - 1 : seats.find((seat) => (seat as any)[field] === undefined)?.playerIndex;
        const actor = participants.find((participant: any) => participant.playerIndex === playerIndex);
        if (playerIndex === undefined || !actor?.botControlled) return;
        const { setup: nextSetup, action } = chooseBotSetupActionWithRecord(state, state.setupState, playerIndex);
        if (nextSetup === state.setupState) return;
        if (!action) throw new Error("The room bot produced a setup transition without a replayable action.");
        const seat = nextSetup.seats.find((candidate) => candidate.playerIndex === playerIndex);
        if (seat?.startingChoice?.kind === "deploy") setupDeploymentState({ ...state, setupState: nextSetup }, playerIndex, "placements" in seat.startingChoice ? seat.startingChoice.placements : [seat.startingChoice]);
        const nextState = { ...state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
        await this.prismaClient.$transaction(async (tx: any) => {
          const lease = await tx.participant.updateMany({ where: { id: actor.id, botControlled: true, connectedAt: null }, data: { ...(seat?.startingChoice ? { ready: true } : {}), disconnectedAt: actor.disconnectedAt } });
          if (lease.count !== 1) throw new Error("Bot control changed before setup was committed.");
          const changed = await tx.gameRoom.updateMany({ where: { id: room.id, version: room.version, status: room.status }, data: { state: nextState as any, version: room.version + 1, lastActivityAt: new Date() } });
          if (changed.count !== 1) throw new Error("Bot setup became stale.");
          const replayCommand: ReplayCommandRecord = { kind: "setup", playerIndex, action };
          await tx.gameEvent.create({ data: { roomId: room.id, version: room.version + 1, actorId: actor.id, type: "setup.updated", controlSource: "bot", payload: { phase: nextSetup.phase, automated: true }, replayCommand: replayCommand as any } });
        }).catch(() => undefined);
        await this.refreshStatus(room.id, room.maxPlayers, nextState);
        const activated = await this.prismaClient.gameRoom.findUnique({ where: { id: room.id }, select: { status: true, state: true, version: true } });
        const activatedState = activated?.state as unknown as GameState | undefined;
        if (activated?.status === "ACTIVE" && activatedState?.setupState?.phase === "complete" && !activatedState.setupApplied) {
          await this.commitSetupCompletion(room.id, actor.id, activated.version, activatedState, "bot").catch(() => false);
        }
        continue;
      }
      await this.refreshStatus(room.id, room.maxPlayers, state);
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
      try { await this.commitCommand(refreshed, actor, envelope, "bot"); } catch { return; }
    }
  }

  private async authorize(roomCode: string, accessToken: string) {
    const room = await this.prismaClient.gameRoom.findUnique({ where: { code: roomCode.toUpperCase() } });
    if (!room) throw new Error("Room not found.");
    const lastActivityAt = room.lastActivityAt?.getTime?.() ?? Date.now();
    const linkedActive = room.status === "ACTIVE" && await this.prismaClient.participant.count({ where: { roomId: room.id, userId: { not: null }, role: "PLAYER" } }) > 0;
    if (room.status !== "COMPLETED" && !linkedActive && Date.now() - lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
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
    const linkedActive = room?.status === "ACTIVE" && await this.prismaClient.participant.count({ where: { roomId, userId: { not: null }, role: "PLAYER" } }) > 0;
    if (room && !linkedActive && Date.now() - (room.lastActivityAt?.getTime?.() ?? Date.now()) >= ROOM_IDLE_TIMEOUT_MS) {
      await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: "EXPIRED" } });
      return;
    }
    if (room?.status === "ACTIVE") {
      await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: "ACTIVE" } });
      return;
    }
    if (room?.status === "ABANDONED" && !(setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && (participant.connectedAt || participant.botControlled)))) return;
    const nextStatus = setupComplete && players.length === maxPlayers && players.every((participant: any) => participant.ready && (participant.connectedAt || participant.botControlled)) ? "ACTIVE" : "WAITING";
    await this.prismaClient.gameRoom.update({ where: { id: roomId }, data: { status: nextStatus } });
  }

  private async commitSetupCompletion(roomId: string, actorId: string, expectedVersion: number, state: GameState, controlSource: "human" | "bot"): Promise<boolean> {
    const nextState = applyCompletedSetup(state);
    const version = expectedVersion + 1;
    return this.prismaClient.$transaction(async (tx: any) => {
      const changed = await tx.gameRoom.updateMany({ where: { id: roomId, version: expectedVersion, status: "ACTIVE" }, data: { state: nextState as any, version } });
      if (changed.count !== 1) return false;
      const replayCommand: ReplayCommandRecord = { kind: "start" };
      await tx.gameEvent.create({ data: { roomId, version, actorId, type: "match.started", controlSource, payload: { phase: nextState.phase, currentPlayer: nextState.currentPlayer }, replayCommand: replayCommand as any } });
      return true;
    });
  }

  private async view(roomId: string, afterVersion = 0, audience: StateAudience = "spectator", viewerPlayerIndex?: number, loadedRoom?: any): Promise<RoomView> {
    const room = loadedRoom ?? await this.prismaClient.gameRoom.findUnique({ where: { id: roomId }, include: { participants: { include: { user: { select: { username: true } } } }, events: { orderBy: { version: "desc" }, take: MAX_RETAINED_ROOM_EVENTS } } });
    if (!room) throw new Error("Room not found.");
    const newestEvents = room.events ?? [];
    this.inspectEventHistory(room, newestEvents);
    // Read the newest bounded suffix, then restore chronological order and
    // apply the caller's cursor so the snapshot can also be checked for gaps.
    const events = newestEvents.map((event: any): RoomEvent => ({ id: event.id, roomId: event.roomId, version: event.version, actorId: event.actorId, type: event.type, controlSource: event.controlSource === "bot" ? "bot" : "human", payload: event.payload as Record<string, unknown>, createdAt: event.createdAt.toISOString() })).reverse().filter((event: RoomEvent) => event.version > afterVersion);
    return { id: room.id, code: room.code, status: room.status.toLowerCase() as RoomView["status"], matchStarted: Boolean(room.matchStarted), maxPlayers: room.maxPlayers, privacy: room.privacy.toLowerCase() as RoomView["privacy"], version: room.version, state: projectState(room.state as unknown as GameState, audience, viewerPlayerIndex), participants: room.participants.map((participant: any) => ({ id: participant.id, displayName: participant.displayName, ...(participant.user?.username ? { username: participant.user.username } : {}), role: participant.role.toLowerCase(), playerIndex: participant.playerIndex ?? undefined, connected: Boolean(participant.connectedAt), ready: Boolean(participant.ready), botControlled: Boolean(participant.botControlled), botAssisted: Boolean(participant.botAssisted) })), events };
  }

  private inspectEventHistory(room: { id: string; code: string; version: number }, newestEvents: readonly { version: number }[]): void {
    if (!this.onEventDivergence) return;
    if (room.version === 0 && newestEvents.length === 0) return;
    let missingVersionCount = 0;
    for (let index = 0; index < newestEvents.length - 1; index += 1) {
      missingVersionCount += Math.max(0, newestEvents[index]!.version - newestEvents[index + 1]!.version - 1);
    }
    const latestEventVersion = newestEvents[0]?.version ?? null;
    if (latestEventVersion === null) missingVersionCount += room.version;
    else if (latestEventVersion < room.version) missingVersionCount += room.version - latestEventVersion;
    if (latestEventVersion === room.version && missingVersionCount === 0) return;

    const fingerprint = `${room.id}:${room.version}`;
    if (this.reportedEventDivergences.has(fingerprint)) return;
    if (this.reportedEventDivergences.size >= 1024) this.reportedEventDivergences.clear();
    this.reportedEventDivergences.add(fingerprint);
    try {
      this.onEventDivergence({ roomCode: room.code, snapshotVersion: room.version, latestEventVersion, missingVersionCount });
    } catch {
      // Monitoring callbacks must never make an otherwise readable room fail.
    }
  }
}
