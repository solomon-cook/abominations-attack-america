import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  applyCommandEnvelope,
  applyCompletedSetup,
  applySetupAction,
  createMvpRoomGame,
  chooseBotCommand,
  chooseBotSetupActionWithRecord,
  legalLaserFenceTargets,
  projectState,
  setupDeploymentState,
  type GameCommandEnvelope,
  type GameState,
  type SetupAction,
  type StateAudience,
} from "../packages/game-engine/src/index.js";
import { completedMatchRows, emptyMatchCounters, updateMatchCounters } from "../apps/api/src/player-stats.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const RETAINED_EVENTS = 256;
const now = () => Date.now();
const randomHex = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const newToken = () => randomHex(32);
const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const roomCode = () => randomHex(3).toUpperCase();

async function roomByCode(ctx: any, code: string) {
  const room = await ctx.db.query("rooms").withIndex("by_code", (q: any) => q.eq("code", code.toUpperCase())).unique();
  if (!room) throw new Error("Room not found.");
  if (room.status !== "completed" && now() - room.lastActivityAt >= IDLE_TIMEOUT_MS) {
    throw new Error("This room has expired.");
  }
  return room;
}

async function getParticipants(ctx: any, roomId: string) {
  return ctx.db.query("participants").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect();
}

function refreshStatus(room: any, participants: any[], timestamp = now()) {
  if (room.status === "completed" || room.status === "expired") return room.status;
  if (timestamp - room.lastActivityAt >= IDLE_TIMEOUT_MS) return "expired";
  if (room.status === "active") return "active";
  const players = participants.filter((participant) => participant.role === "player");
  const setupComplete = !room.state.setupState || room.state.setupState.phase === "complete";
  if (room.status === "abandoned" && !(setupComplete && players.length === room.maxPlayers && players.every((player) => player.ready && (player.connectedAt !== undefined || player.botControlled)))) return "abandoned";
  return setupComplete && players.length === room.maxPlayers && players.every((player) => player.ready && (player.connectedAt !== undefined || player.botControlled)) ? "active" : "waiting";
}

function projectRoom(room: any, participants: any[], viewer: any, afterVersion = 0) {
  const audience: StateAudience = viewer.role === "player" ? "player" : "spectator";
  return {
    id: room.externalId,
    code: room.code,
    status: room.status,
    matchStarted: Boolean(room.matchStarted),
    maxPlayers: room.maxPlayers,
    privacy: room.privacy,
    version: room.version,
    state: projectState(room.state as GameState, audience, viewer.playerIndex),
    participants: participants.map((participant) => ({
      id: participant.externalId,
      displayName: participant.displayName,
      ...(participant.username ? { username: participant.username } : {}),
      role: participant.role,
      ...(participant.playerIndex === undefined ? {} : { playerIndex: participant.playerIndex }),
      connected: participant.connectedAt !== undefined,
      ready: participant.ready,
      botControlled: participant.botControlled,
      botAssisted: participant.botAssisted,
    })),
    events: [],
    afterVersion,
  };
}

async function addParticipant(ctx: any, room: any, displayName: string, role: "player" | "spectator", playerIndex?: number) {
  const token = newToken();
  const timestamp = now();
  const externalId = crypto.randomUUID();
  await ctx.db.insert("participants", {
    externalId,
    roomId: room.externalId,
    displayName: displayName.trim().slice(0, 32) || (role === "player" ? "Player" : "Spectator"),
    role,
    ...(playerIndex === undefined ? {} : { playerIndex }),
    tokenHash: await hashToken(token),
    sessionExpiresAt: timestamp + SESSION_TTL_MS,
    connectedAt: timestamp,
    lastSeenAt: timestamp,
    ready: false,
    botControlled: false,
    botAssisted: false,
    createdAt: timestamp,
  });
  return { token, externalId };
}

async function loadRoomView(ctx: any, room: any, participant: any, afterVersion = 0) {
  const [roomParticipants, events] = await Promise.all([
    getParticipants(ctx, room.externalId),
    ctx.db.query("events").withIndex("by_room_version", (q: any) => q.eq("roomId", room.externalId)).order("desc").take(RETAINED_EVENTS),
  ]);
  const participants = await Promise.all(roomParticipants.map(async (item: any) => {
    if (!item.userId) return item;
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", item.userId)).unique();
    return user ? { ...item, username: user.username } : item;
  }));
  const result = projectRoom(room, participants, participant);
  return { ...result, events: events.filter((event: any) => event.version > afterVersion).reverse().map((event: any) => ({
    id: event.externalId,
    roomId: event.roomId,
    version: event.version,
    actorId: event.actorId,
    type: event.type,
    controlSource: event.controlSource,
    payload: event.payload,
    createdAt: new Date(event.createdAt).toISOString(),
  })) };
}

async function insertEvent(ctx: any, room: any, actorId: string, version: number, type: string, payload: unknown, replayCommand?: unknown, controlSource: "human" | "bot" = "human") {
  await ctx.db.insert("events", {
    externalId: crypto.randomUUID(), roomId: room.externalId, version, actorId,
    type, controlSource, payload,
    ...(replayCommand === undefined ? {} : { replayCommand }), createdAt: now(),
  });
}

function requiredPlayer(state: GameState, envelope: GameCommandEnvelope) {
  const command = envelope.command;
  if (command.type === "use-research" && command.cardId === "Laser Fence") {
    const targetMonsterId = command.targetMonsterId ?? (command.battleId
      ? state.pendingBattles.find((battle) => battle.id === command.battleId)?.monsterId
      : undefined);
    if (targetMonsterId && legalLaserFenceTargets(state).some((target) => target.targetMonsterId === targetMonsterId)) {
      const owner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
      if (owner >= 0) return owner;
    }
  }
  if (command.type === "use-mutation") {
    const decision = state.pendingDecision;
    if (state.phase === "fight" && decision
      && (decision.type === "battle-resolution" || decision.type === "attack-target")) {
      const battleId = command.battleId ?? decision.battleId;
      if (battleId === decision.battleId) {
        const battle = state.pendingBattles.find((candidate) => candidate.id === battleId);
        const owner = battle ? state.monsters.findIndex((monster) => monster.id === battle.monsterId) : -1;
        if (owner >= 0) return owner;
      }
    }
    if (state.phase === "challenge" && state.challenge?.active && state.challenge.turn
      && (state.challenge.opponentMonsterId || state.challenge.giantUnitId)
      && (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution")) {
      for (const id of [state.challenge.challengerMonsterId, state.challenge.opponentMonsterId]) {
        if (!id) continue;
        const owner = state.monsters.findIndex((monster) => monster.id === id);
        if (owner >= 0 && state.players[owner]?.mutationCardIds.includes(command.cardId)) return owner;
      }
    }
  }
  const decision = state.pendingDecision;
  return decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
}

export const create = mutation({
  args: { maxPlayers: v.number(), displayName: v.string(), privacy: v.union(v.literal("private"), v.literal("public")) },
  handler: async (ctx, args) => {
    if (![2, 3, 4].includes(args.maxPlayers)) throw new Error("A room must support 2, 3, or 4 players.");
    let code = roomCode();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      if (!existing) break;
      code = roomCode();
    }
    if (await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique()) throw new Error("Could not create a room. Try again.");
    const id = crypto.randomUUID();
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const secretSeed = randomHex(32);
    const state = createMvpRoomGame(args.maxPlayers as 2 | 3 | 4, seedBytes[0]!, `room-${code}`, secretSeed);
    const timestamp = now();
    const roomId = await ctx.db.insert("rooms", {
      externalId: id, code, status: "waiting", matchStarted: false, privacy: args.privacy, isTest: false,
      maxPlayers: args.maxPlayers, version: 0, state,
      initialReplayState: structuredClone(state), createdAt: timestamp,
      updatedAt: timestamp, lastActivityAt: timestamp,
      playerStats: emptyMatchCounters(args.maxPlayers),
    });
    const room = await ctx.db.get(roomId);
    const session = await addParticipant(ctx, room, args.displayName || "Player 1", "player", 0);
    const participant = await ctx.db.query("participants").withIndex("by_external_id", (q) => q.eq("externalId", session.externalId)).unique();
    return { room: await loadRoomView(ctx, room, participant), participantId: session.externalId, token: session.token };
  },
});

export const join = mutation({
  args: { code: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.matchStarted) throw new Error("This match has already started.");
    const participants = await getParticipants(ctx, room.externalId);
    const players = participants.filter((participant: any) => participant.role === "player");
    if (players.length >= room.maxPlayers) throw new Error("This room is full.");
    const playerIndex = Array.from({ length: room.maxPlayers }, (_, index) => index).find((index) => !players.some((player: any) => player.playerIndex === index));
    if (playerIndex === undefined) throw new Error("This room is full.");
    const session = await addParticipant(ctx, room, args.displayName || "Player", "player", playerIndex);
    await ctx.db.patch(room._id, { lastActivityAt: now(), updatedAt: now() });
    const participant = await ctx.db.query("participants").withIndex("by_external_id", (q) => q.eq("externalId", session.externalId)).unique();
    const refreshed = { ...room, lastActivityAt: now() };
    return { room: await loadRoomView(ctx, refreshed, participant), participantId: session.externalId, token: session.token };
  },
});

export const addBot = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.status !== "waiting" || room.matchStarted) throw new Error("Bots can only be added while the room is waiting.");
    const tokenHash = await hashToken(args.token);
    const requester = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!requester || requester.roomId !== room.externalId || requester.sessionExpiresAt <= now() || requester.role !== "player" || requester.botControlled) throw new Error("Only a human player can add a bot.");
    const participants = await getParticipants(ctx, room.externalId);
    const players = participants.filter((candidate: any) => candidate.role === "player");
    if (players.length >= room.maxPlayers) throw new Error("This room is full.");
    const playerIndex = Array.from({ length: room.maxPlayers }, (_, index) => index).find((index) => !players.some((player: any) => player.playerIndex === index));
    if (playerIndex === undefined) throw new Error("This room is full.");
    const token = newToken();
    const timestamp = now();
    await ctx.db.insert("participants", {
      externalId: crypto.randomUUID(), roomId: room.externalId,
      displayName: `Bot ${playerIndex + 1}`, role: "player", playerIndex,
      tokenHash: await hashToken(token), sessionExpiresAt: timestamp + SESSION_TTL_MS,
      ready: true, botControlled: true, botAssisted: false, createdAt: timestamp,
    });
    await ctx.db.patch(room._id, { lastActivityAt: timestamp, updatedAt: timestamp });
    const refreshed = { ...room, lastActivityAt: timestamp };
    return loadRoomView(ctx, refreshed, requester);
  },
});

export const createViewerInvite = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (!room.matchStarted) throw new Error("Start the match before creating a TV viewing link.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    const viewerToken = newToken();
    const expiresAt = now() + 24 * 60 * 60 * 1000;
    await ctx.db.patch(room._id, { viewerInviteTokenHash: await hashToken(viewerToken), viewerInviteExpiresAt: expiresAt });
    return { token: viewerToken, expiresAt: new Date(expiresAt).toISOString() };
  },
});

export const spectate = mutation({
  args: { code: v.string(), displayName: v.string(), viewerToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const inviteMatches = args.viewerToken && room.viewerInviteTokenHash === await hashToken(args.viewerToken)
      && room.viewerInviteExpiresAt !== undefined && room.viewerInviteExpiresAt > now();
    if (room.privacy === "private" && !inviteMatches) throw new Error("This room is private and needs its TV viewing link.");
    const session = await addParticipant(ctx, room, args.displayName || "Spectator", "spectator");
    await ctx.db.patch(room._id, { lastActivityAt: now(), updatedAt: now() });
    const participant = await ctx.db.query("participants").withIndex("by_external_id", (q) => q.eq("externalId", session.externalId)).unique();
    return { room: await loadRoomView(ctx, room, participant), participantId: session.externalId, token: session.token };
  },
});

export const read = query({
  args: { code: v.string(), tokenHash: v.string(), afterVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase())).unique();
    if (!room || (room.status !== "completed" && now() - room.lastActivityAt >= IDLE_TIMEOUT_MS)) throw new Error("Room not found or expired.");
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    const participants = await getParticipants(ctx, room.externalId);
    const events = await ctx.db.query("events").withIndex("by_room_version", (q) => q.eq("roomId", room.externalId)).order("desc").take(RETAINED_EVENTS);
    return {
      ...projectRoom(room, participants, participant),
      events: events.filter((event) => event.version > (args.afterVersion ?? 0)).reverse().map((event) => ({
        id: event.externalId, roomId: event.roomId, version: event.version, actorId: event.actorId,
        type: event.type, controlSource: event.controlSource, payload: event.payload,
        createdAt: new Date(event.createdAt).toISOString(),
      })),
    };
  },
});

export const reconnect = mutation({
  args: { code: v.string(), token: v.string(), connectionId: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    const timestamp = now();
    await ctx.db.patch(participant._id, { connectedAt: timestamp, lastSeenAt: timestamp, disconnectedAt: undefined, botControlled: false, connectionId: args.connectionId });
    const participants = (await getParticipants(ctx, room.externalId)).map((item: any) => item._id === participant._id ? { ...item, connectedAt: timestamp, disconnectedAt: undefined, botControlled: false } : item);
    const status = refreshStatus({ ...room, lastActivityAt: timestamp }, participants);
    await ctx.db.patch(room._id, { status, lastActivityAt: timestamp, updatedAt: timestamp });
    await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId });
    const updated = { ...participant, connectedAt: timestamp, disconnectedAt: undefined, botControlled: false, connectionId: args.connectionId };
    return loadRoomView(ctx, { ...room, status, lastActivityAt: timestamp }, updated);
  },
});

export const disconnect = mutation({
  args: { code: v.string(), token: v.string(), connectionId: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    if (participant.connectionId && participant.connectionId !== args.connectionId) return loadRoomView(ctx, room, participant);
    const timestamp = now();
    await ctx.db.patch(participant._id, { connectedAt: undefined, disconnectedAt: timestamp, lastSeenAt: timestamp });
    const participants = (await getParticipants(ctx, room.externalId)).map((item: any) => item._id === participant._id ? { ...item, connectedAt: undefined, disconnectedAt: timestamp } : item);
    const players = participants.filter((item: any) => item.role === "player");
    const status = room.status === "active" && players.length > 0 && players.every((item: any) => item.connectedAt === undefined && !item.botControlled) ? "abandoned" : room.status;
    await ctx.db.patch(room._id, { status, lastActivityAt: timestamp, updatedAt: timestamp });
    const updated = { ...participant, connectedAt: undefined, disconnectedAt: timestamp, lastSeenAt: timestamp };
    return loadRoomView(ctx, { ...room, status, lastActivityAt: timestamp }, updated);
  },
});

export const heartbeat = mutation({
  args: { code: v.string(), token: v.string(), connectionId: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    if (participant.connectionId !== args.connectionId || participant.botControlled) throw new Error("This room connection has been replaced. Reconnect to continue.");
    const timestamp = now();
    await ctx.db.patch(participant._id, { connectedAt: timestamp, lastSeenAt: timestamp });
    return { ok: true, at: timestamp };
  },
});

export const rotateSession = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    const replacement = newToken();
    const timestamp = now();
    await ctx.db.patch(participant._id, { tokenHash: await hashToken(replacement), sessionExpiresAt: timestamp + SESSION_TTL_MS, connectedAt: undefined, connectionId: undefined, disconnectedAt: timestamp });
    const updated = { ...participant, tokenHash: "", sessionExpiresAt: timestamp + SESSION_TTL_MS, connectedAt: undefined, connectionId: undefined, disconnectedAt: timestamp };
    return { room: await loadRoomView(ctx, room, updated), participantId: participant.externalId, token: replacement };
  },
});

export const publicRooms = query({
  args: {},
  handler: async (ctx) => {
    const rooms = (await Promise.all((["waiting", "active"] as const).map((status) => ctx.db.query("rooms")
      .withIndex("by_privacy_status_activity", (q) => q.eq("privacy", "public").eq("status", status))
      .order("desc").take(20)))).flat().sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 20);
    const result = [];
    for (const room of rooms) {
      const participants = await getParticipants(ctx, room.externalId);
      result.push({
        code: room.code, status: room.status, maxPlayers: room.maxPlayers,
        playerCount: participants.filter((participant: any) => participant.role === "player").length,
        spectatorCount: participants.filter((participant: any) => participant.role === "spectator").length,
      });
    }
    return result;
  },
});

export const start = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const starter = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!starter || starter.roomId !== room.externalId || starter.sessionExpiresAt <= now() || starter.role !== "player" || starter.playerIndex === undefined || starter.connectedAt === undefined) throw new Error("Only a connected player can start the match.");
    if (room.status !== "waiting" || room.matchStarted) throw new Error("This room has already started.");
    const players = (await getParticipants(ctx, room.externalId)).filter((participant: any) => participant.role === "player");
    if (players.length !== room.maxPlayers || players.some((player: any) => player.connectedAt === undefined && !player.botControlled)) throw new Error("Wait until every player has joined and is connected.");
    const timestamp = now();
    await ctx.db.patch(room._id, { matchStarted: true, lastActivityAt: timestamp, updatedAt: timestamp });
    if (players.some((player: any) => player.botControlled)) await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId });
    return loadRoomView(ctx, { ...room, matchStarted: true, lastActivityAt: timestamp }, starter);
  },
});

export const claimAccountSeat = internalMutation({
  args: { code: v.string(), token: v.string(), userId: v.string(), username: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.status === "completed" || room.status === "expired") throw new Error("Only an active match seat can be linked to an account.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.role !== "player" || participant.sessionExpiresAt <= now()) throw new Error("Only a player seat can be linked to an account.");
    if (participant.userId && participant.userId !== args.userId) throw new Error("This seat is already linked to another account.");
    const replacement = newToken();
    const timestamp = now();
    await ctx.db.patch(participant._id, {
      userId: args.userId, displayName: args.username, tokenHash: await hashToken(replacement), sessionExpiresAt: timestamp + SESSION_TTL_MS,
      connectedAt: undefined, disconnectedAt: timestamp, botControlled: false, connectionId: undefined,
    });
    const updated = { ...participant, userId: args.userId, displayName: args.username, sessionExpiresAt: timestamp + SESSION_TTL_MS, connectedAt: undefined, disconnectedAt: timestamp, botControlled: false, connectionId: undefined };
    return { room: await loadRoomView(ctx, room, updated), participantId: participant.externalId, token: replacement, accountLinked: true };
  },
});

export const resumeAccountGame = internalMutation({
  args: { roomId: v.string(), userId: v.string(), username: v.string() },
  handler: async (ctx, args) => {
    const participant = await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", args.roomId).eq("userId", args.userId)).unique();
    if (!participant || participant.role !== "player") throw new Error("You do not have a player seat in this match.");
    const room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", args.roomId)).unique();
    if (!room) throw new Error("You do not have a player seat in this match.");
    const replacement = newToken();
    const timestamp = now();
    await ctx.db.patch(participant._id, { tokenHash: await hashToken(replacement), sessionExpiresAt: timestamp + SESSION_TTL_MS, connectedAt: undefined, disconnectedAt: timestamp, botControlled: false, displayName: args.username, connectionId: undefined });
    const updated = { ...participant, sessionExpiresAt: timestamp + SESSION_TTL_MS, connectedAt: undefined, disconnectedAt: timestamp, botControlled: false, displayName: args.username, connectionId: undefined };
    return { room: await loadRoomView(ctx, room, updated), participantId: participant.externalId, token: replacement, accountLinked: true };
  },
});

export const ready = mutation({
  args: { code: v.string(), token: v.string(), ready: v.boolean() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (!room.matchStarted) throw new Error("Start the match before players can ready up.");
    if (room.status !== "waiting") throw new Error("Readiness can only change while a room is waiting.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player") throw new Error("Only players can change readiness.");
    if (participant.connectedAt === undefined) throw new Error("Reconnect before changing readiness.");
    await ctx.db.patch(participant._id, { ready: args.ready });
    const participants = (await getParticipants(ctx, room.externalId)).map((item: any) => item._id === participant._id ? { ...item, ready: args.ready } : item);
    const nextStatus = refreshStatus({ ...room, lastActivityAt: now() }, participants);
    const patch: Record<string, unknown> = { status: nextStatus, lastActivityAt: now(), updatedAt: now() };
    if (nextStatus === "active" && room.state.setupState?.phase === "complete" && !room.state.setupApplied) {
      const state = applyCompletedSetup(room.state as GameState);
      patch.state = state;
      patch.version = room.version + 1;
    }
    await ctx.db.patch(room._id, patch);
    if (patch.state) await insertEvent(ctx, room, participant.externalId, room.version + 1, "match.started", { phase: (patch.state as GameState).phase, currentPlayer: (patch.state as GameState).currentPlayer }, { kind: "start" });
    if (nextStatus === "active") await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId });
    const nextRoom = { ...room, ...patch };
    const nextParticipants = participants;
      return loadRoomView(ctx, nextRoom, participant).then((view) => ({ ...view, participants: nextParticipants.map((item: any) => ({ id: item.externalId, displayName: item.displayName, role: item.role, ...(item.playerIndex === undefined ? {} : { playerIndex: item.playerIndex }), connected: item.connectedAt !== undefined, ready: item.ready, botControlled: item.botControlled, botAssisted: item.botAssisted })) }));
  },
});

export const setup = mutation({
  args: { code: v.string(), token: v.string(), expectedRevision: v.number(), action: v.any() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (!room.matchStarted) throw new Error("This match has not been started yet.");
    if (room.version !== args.expectedRevision) throw new Error(`Expected revision ${args.expectedRevision}, current revision is ${room.version}.`);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player" || participant.playerIndex === undefined) throw new Error("Only seated players can complete setup.");
    if (!room.state.setupState) throw new Error("This room has no setup state.");
    const nextSetup = applySetupAction(room.state.setupState, participant.playerIndex, args.action as SetupAction);
    const state = { ...room.state, setupState: nextSetup, ...(nextSetup.phase === "complete" ? { setupAssignments: nextSetup.seats } : {}) };
    const version = room.version + 1;
    const timestamp = now();
    await ctx.db.patch(room._id, { state, version, lastActivityAt: timestamp, updatedAt: timestamp });
    await insertEvent(ctx, room, participant.externalId, version, "setup.updated", { phase: nextSetup.phase, action: (args.action as SetupAction).type }, { kind: "setup", playerIndex: participant.playerIndex, action: args.action });
    // A human setup choice can hand the next pick to a bot before setup is complete.
    // Wake the bot runner after every accepted setup action; it exits if a human is next.
    const participants = await getParticipants(ctx, room.externalId);
    if (participants.some((candidate: any) => candidate.role === "player" && candidate.botControlled)) {
      await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId });
    }
    const updatedRoom = { ...room, state, version, lastActivityAt: timestamp };
    return loadRoomView(ctx, updatedRoom, participant);
  },
});

export const submit = mutation({
  args: { code: v.string(), token: v.string(), envelope: v.any() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (!room.matchStarted) throw new Error("This match has not been started yet.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player") throw new Error("Spectators cannot submit game actions.");
    if (participant.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    const envelope = args.envelope as GameCommandEnvelope;
    if (envelope.actorId !== participant.externalId) throw new Error("Command actor does not match the room participant.");
    const prior = await ctx.db.query("commandReceipts").withIndex("by_room_action", (q) => q.eq("roomId", room.externalId).eq("actionId", envelope.actionId)).unique();
    const participants = await getParticipants(ctx, room.externalId);
    if (prior) return loadRoomView(ctx, room, participant);
    if (room.status !== "active") throw new Error("This room is not ready for gameplay.");
    const state = room.state as GameState;
    const decision = state.pendingDecision;
    const required = requiredPlayer(state, envelope);
    if (participant.playerIndex !== required) throw new Error("It is not your turn.");
    const result = applyCommandEnvelope(state, envelope, room.version);
    const counters = updateMatchCounters(state, result.state, room.playerStats, participant.playerIndex ?? 0);
    const version = room.version + 1;
    const timestamp = now();
    const terminal = result.state.phase === "game-over";
    await ctx.db.patch(room._id, {
      state: result.state, playerStats: counters, version, lastActivityAt: timestamp, updatedAt: timestamp,
      ...(terminal ? { status: "completed", completedAt: timestamp } : {}),
    });
    await insertEvent(ctx, room, participant.externalId, version, result.eventType, { ...result.eventPayload, receipt: result.receipt }, { kind: "command", playerIndex: participant.playerIndex ?? 0, command: envelope.command });
    await ctx.db.insert("commandReceipts", { roomId: room.externalId, actionId: envelope.actionId, actorId: participant.externalId, version, eventType: result.eventType, createdAt: timestamp });
    if (terminal) {
      const linked = participants.filter((item: any) => item.role === "player" && item.userId && item.playerIndex !== undefined);
      const identities = [];
      for (const item of linked) {
        const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", item.userId)).unique();
        if (user) identities.push({ participantId: item.externalId, userId: user.externalId, username: user.username, playerIndex: item.playerIndex, botAssisted: item.botAssisted });
      }
      for (const row of completedMatchRows(room.externalId, result.state, counters, identities)) {
        await ctx.db.insert("playerMatchStats", { externalId: crypto.randomUUID(), ...row, completedAt: timestamp });
      }
      const winner = participants.find((item: any) => item.role === "player" && item.playerIndex === result.state.winnerPlayer);
      await ctx.db.insert("gameResults", {
        externalId: crypto.randomUUID(), roomId: room.externalId,
        ...(winner ? { winnerId: winner.externalId, winnerName: winner.displayName } : {}),
        summary: {
          winnerPlayer: result.state.winnerPlayer, victoryType: result.state.victoryType,
          rulesetVersion: result.state.rulesetVersion, durationRounds: result.state.round,
          terminalEvent: { type: result.eventType, version },
          finalStandings: result.state.monsters.map((monster, playerIndex) => ({
            playerIndex, playerId: result.state.players[playerIndex]?.id, monsterId: monster.id,
            monsterName: monster.name, health: monster.health, infamy: monster.infamy,
            location: monster.location, winner: playerIndex === result.state.winnerPlayer,
          })),
        }, createdAt: timestamp,
      });
    }
    if (!terminal && participants.some((candidate: any) => candidate.role === "player" && candidate.botControlled)) {
      await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId });
    }
    return loadRoomView(ctx, { ...room, state: result.state, playerStats: counters, version, status: terminal ? "completed" : room.status, lastActivityAt: timestamp }, participant);
  },
});

function nextSetupPlayer(setup: NonNullable<GameState["setupState"]>) {
  if (setup.phase === "unused-branch-placement") return setup.definition.playerCount - 1;
  const field = setup.phase === "monster-selection" ? "monsterId" : setup.phase === "branch-selection" ? "branch" : setup.phase === "lair-selection" ? "lair" : "startingChoice";
  const seats = [...setup.seats].sort((left, right) => setup.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
  return seats.find((seat) => (seat as any)[field] === undefined)?.playerIndex ?? -1;
}

export const processStaleParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = now();
    const stale = await ctx.db.query("participants")
      .withIndex("by_presence", (q) => q.lte("lastSeenAt", timestamp - 45_000))
      .collect();
    const affected = new Set<string>();
    for (const participant of stale) {
      if (participant.connectedAt !== undefined) {
        const disconnectedAt = participant.lastSeenAt ?? timestamp;
        await ctx.db.patch(participant._id, { connectedAt: undefined, disconnectedAt });
      }
      if (participant.role === "player") affected.add(participant.roomId);
    }
    for (const roomId of affected) {
      const room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
      if (!room || (room.status !== "waiting" && room.status !== "active")) continue;
      const players = (await ctx.db.query("participants").withIndex("by_room_role", (q) => q.eq("roomId", roomId).eq("role", "player")).collect());
      const allDisconnected = players.length > 0 && players.every((participant) => participant.connectedAt === undefined && !participant.botControlled);
      if (room.status === "active" && allDisconnected) {
        await ctx.db.patch(room._id, { status: "abandoned" });
        continue;
      }
      let botStarted = false;
      for (const participant of players) {
        if (!participant.botControlled && participant.connectedAt === undefined && participant.disconnectedAt !== undefined && timestamp - participant.disconnectedAt >= 4 * 60_000) {
          await ctx.db.patch(participant._id, { botControlled: true, botAssisted: true });
          botStarted = true;
        }
      }
      if (botStarted) await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId });
    }
  },
});

export const expireIdleRooms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = now() - IDLE_TIMEOUT_MS;
    const candidates = await Promise.all(([["waiting", "abandoned"], ["active"]] as const).map(async (statuses) => {
      const rows = [];
      for (const status of statuses) {
        rows.push(...await ctx.db.query("rooms").withIndex("by_status_activity", (q) => q.eq("status", status).lte("lastActivityAt", cutoff)).take(100));
      }
      return rows;
    }));
    for (const room of candidates.flat()) {
      if (room.status === "active") {
        const linkedPlayers = (await ctx.db.query("participants").withIndex("by_room_role", (q) => q.eq("roomId", room.externalId).eq("role", "player")).collect()).some((participant) => participant.userId);
        if (linkedPlayers) continue;
      }
      await ctx.db.patch(room._id, { status: "expired" });
    }
  },
});

export const runBotStep = internalMutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
    if (!room || !room.matchStarted || (room.status !== "waiting" && room.status !== "active")) return;
    const participants = await getParticipants(ctx, roomId);
    const bots = participants.filter((participant: any) => participant.role === "player" && participant.botControlled && participant.playerIndex !== undefined);
    if (!bots.length) return;
    const state = room.state as GameState;
    if (state.setupState && state.setupState.phase !== "complete") {
      const playerIndex = nextSetupPlayer(state.setupState);
      const actor = bots.find((participant: any) => participant.playerIndex === playerIndex);
      if (!actor) return;
      const { setup, action } = chooseBotSetupActionWithRecord(state, state.setupState, playerIndex);
      if (setup === state.setupState) return;
      if (!action) throw new Error("The room bot produced a setup transition without a replayable action.");
      const seat = setup.seats.find((candidate) => candidate.playerIndex === playerIndex);
      if (seat?.startingChoice?.kind === "deploy") {
        setupDeploymentState({ ...state, setupState: setup }, playerIndex, "placements" in seat.startingChoice ? seat.startingChoice.placements : [seat.startingChoice]);
      }
      const nextState = { ...state, setupState: setup, ...(setup.phase === "complete" ? { setupAssignments: setup.seats } : {}) };
      const timestamp = now();
      let version = room.version + 1;
      await ctx.db.patch(actor._id, { ready: Boolean(seat?.startingChoice) });
      const patch: Record<string, unknown> = { state: nextState, version, lastActivityAt: timestamp, updatedAt: timestamp };
      const updatedParticipants = participants.map((item: any) => item._id === actor._id ? { ...item, ready: Boolean(seat?.startingChoice) } : item);
      const nextStatus = refreshStatus({ ...room, state: nextState, lastActivityAt: timestamp }, updatedParticipants);
      patch.status = nextStatus;
      if (nextStatus === "active" && nextState.setupState?.phase === "complete" && !nextState.setupApplied) {
        const started = applyCompletedSetup(nextState as GameState);
        version += 1;
        patch.state = started;
        patch.version = version;
      }
      await ctx.db.patch(room._id, patch);
      await insertEvent(ctx, room, actor.externalId, room.version + 1, "setup.updated", { phase: setup.phase, automated: true }, { kind: "setup", playerIndex, action }, "bot");
      if (version > room.version + 1) await insertEvent(ctx, { ...room, externalId: roomId }, actor.externalId, version, "match.started", { phase: (patch.state as GameState).phase, currentPlayer: (patch.state as GameState).currentPlayer }, { kind: "start" }, "bot");
      await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId });
      return;
    }

    const roomWithStatus = { ...room, status: refreshStatus(room, participants) };
    if (roomWithStatus.status !== "active" || state.phase === "game-over") return;
    const botIndices = new Set<number>(bots.map((participant: any) => participant.playerIndex));
    const command = chooseBotCommand(state, botIndices);
    if (!command) return;
    const envelope: GameCommandEnvelope = { actionId: crypto.randomUUID(), actorId: "bot-probe", expectedRevision: room.version, protocolVersion: 1, command };
    const playerIndex = requiredPlayer(state, envelope);
    const actor = bots.find((participant: any) => participant.playerIndex === playerIndex);
    if (!actor) return;
    envelope.actorId = actor.externalId;
    const applied = applyCommandEnvelope(state, envelope, room.version);
    const counters = updateMatchCounters(state, applied.state, room.playerStats, playerIndex);
    const version = room.version + 1;
    const timestamp = now();
    const terminal = applied.state.phase === "game-over";
    await ctx.db.patch(room._id, { state: applied.state, playerStats: counters, version, lastActivityAt: timestamp, updatedAt: timestamp, ...(terminal ? { status: "completed", completedAt: timestamp } : {}) });
    await insertEvent(ctx, room, actor.externalId, version, applied.eventType, { ...applied.eventPayload, receipt: applied.receipt }, { kind: "command", playerIndex, command }, "bot");
    await ctx.db.insert("commandReceipts", { roomId, actionId: envelope.actionId, actorId: actor.externalId, version, eventType: applied.eventType, createdAt: timestamp });
    if (terminal) {
      const identities = [];
      for (const participant of participants.filter((item: any) => item.role === "player" && item.userId && item.playerIndex !== undefined)) {
        const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", participant.userId)).unique();
        if (user) identities.push({ participantId: participant.externalId, userId: user.externalId, username: user.username, playerIndex: participant.playerIndex, botAssisted: participant.botAssisted || participant._id === actor._id });
      }
      for (const row of completedMatchRows(roomId, applied.state, counters, identities)) await ctx.db.insert("playerMatchStats", { externalId: crypto.randomUUID(), ...row, completedAt: timestamp });
      const winner = participants.find((participant: any) => participant.role === "player" && participant.playerIndex === applied.state.winnerPlayer);
      await ctx.db.insert("gameResults", { externalId: crypto.randomUUID(), roomId, ...(winner ? { winnerId: winner.externalId, winnerName: winner.displayName } : {}), summary: { winnerPlayer: applied.state.winnerPlayer, victoryType: applied.state.victoryType, rulesetVersion: applied.state.rulesetVersion, durationRounds: applied.state.round, terminalEvent: { type: applied.eventType, version } }, createdAt: timestamp });
      return;
    }
    await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId });
  },
});
