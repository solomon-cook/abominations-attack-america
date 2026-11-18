import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { decodeGameState, encodeGameState } from "./gameStateStorage.js";
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
const PRESENCE_TIMEOUT_MS = 6 * 60 * 1000;
const PRESENCE_CHECK_INTERVAL_MS = 180 * 1000;
const roomViewValidator = v.object({
  id: v.string(), code: v.string(), status: v.union(v.literal("waiting"), v.literal("active"), v.literal("completed"), v.literal("abandoned"), v.literal("expired")),
  matchStarted: v.boolean(), maxPlayers: v.number(), privacy: v.union(v.literal("private"), v.literal("public")), version: v.number(), state: v.any(),
  participants: v.array(v.object({
    id: v.string(), displayName: v.string(), username: v.optional(v.string()),
    role: v.union(v.literal("player"), v.literal("spectator")), playerIndex: v.optional(v.number()),
    connected: v.boolean(), ready: v.boolean(), botControlled: v.boolean(), botAssisted: v.boolean(),
  })),
  events: v.array(v.any()),
});
const roomActionResultValidator = v.object({
  state: v.any(), version: v.number(),
  status: v.union(v.literal("waiting"), v.literal("active"), v.literal("completed"), v.literal("abandoned"), v.literal("expired")),
});
const roomLiveStateValidator = v.object({
  id: v.string(), code: v.string(), status: v.union(v.literal("waiting"), v.literal("active"), v.literal("completed"), v.literal("abandoned"), v.literal("expired")),
  matchStarted: v.boolean(), maxPlayers: v.number(), privacy: v.union(v.literal("private"), v.literal("public")), version: v.number(), state: v.any(),
});
const roomParticipantValidator = v.object({
  id: v.string(), displayName: v.string(), username: v.optional(v.string()),
  role: v.union(v.literal("player"), v.literal("spectator")), playerIndex: v.optional(v.number()),
  connected: v.boolean(), ready: v.boolean(), botControlled: v.boolean(), botAssisted: v.boolean(),
});
const now = () => Date.now();
const randomHex = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function touchPresence(ctx: any, participant: any, roomId: string, timestamp: number) {
  if (participant.presenceId) {
    await ctx.db.patch(participant.presenceId, { lastSeenAt: timestamp });
    return participant.presenceId;
  }
  const presenceId = await ctx.db.insert("roomPresence", { participantId: participant.externalId, roomId, lastSeenAt: timestamp });
  await ctx.db.patch(participant._id, { presenceId, lastSeenAt: timestamp });
  return presenceId;
}

async function readPresence(ctx: any, participant: any) {
  return participant.presenceId ? ctx.db.get(participant.presenceId) : null;
}

async function roomRuntime(ctx: any, room: any) {
  const existing = await ctx.db.query("roomRuntime").withIndex("by_room", (q: any) => q.eq("roomId", room.externalId)).unique();
  if (existing) return existing;
  const value = {
    roomId: room.externalId,
    presenceCheckScheduled: room.presenceCheckScheduled ?? false,
    presenceCheckGeneration: room.presenceCheckGeneration ?? 0,
    ...(room.presenceCheckId ? { presenceCheckId: room.presenceCheckId } : {}),
  };
  const id = await ctx.db.insert("roomRuntime", value);
  return { _id: id, ...value };
}
const newToken = () => randomHex(32);
const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const roomCode = () => randomHex(3).toUpperCase();

async function roomByCode(ctx: any, code: string) {
  const room = await ctx.db.query("rooms").withIndex("by_code", (q: any) => q.eq("code", code.toUpperCase())).unique();
  if (!room) throw new Error("Room not found.");
  if (room.status === "deleting") throw new Error("This room is being removed.");
  if (room.status !== "completed" && now() - room.lastActivityAt >= IDLE_TIMEOUT_MS) {
    throw new Error("This room has expired.");
  }
  return { ...room, state: decodeGameState(room.state) };
}

async function scheduleRoomPurge(ctx: any, room: any) {
  if (room.status === "deleting") return;
  const runtime = await roomRuntime(ctx, room);
  if (runtime.presenceCheckId) {
    try { await ctx.scheduler.cancel(runtime.presenceCheckId); } catch { /* already running */ }
  }
  await ctx.db.patch(runtime._id, { presenceCheckScheduled: false, presenceCheckGeneration: (runtime.presenceCheckGeneration ?? 0) + 1, presenceCheckId: undefined });
  await ctx.db.patch(room._id, { status: "deleting", updatedAt: now() });
  await ctx.scheduler.runAfter(0, internal.rooms.purgeRoomBatch, { roomId: room.externalId });
}

async function schedulePresenceCheck(ctx: any, room: any, delayMs: number, knownRuntime?: any) {
  if (["completed", "deleting"].includes(room.status)) return;
  const runtime = knownRuntime ?? await roomRuntime(ctx, room);
  if (runtime.presenceCheckScheduled) return;
  const generation = (runtime.presenceCheckGeneration ?? 0) + 1;
  const id = await ctx.scheduler.runAfter(Math.max(0, delayMs), internal.rooms.checkRoomPresence, { roomId: room.externalId, generation });
  await ctx.db.patch(runtime._id, { presenceCheckScheduled: true, presenceCheckGeneration: generation, presenceCheckId: id });
}

async function scheduleBotStep(ctx: any, room: any, markHasBots = false) {
  if (room.botStepScheduled) {
    if (markHasBots && room.hasBots !== true) await ctx.db.patch(room._id, { hasBots: true });
    return;
  }
  const generation = (room.botStepGeneration ?? 0) + 1;
  await ctx.db.patch(room._id, { botStepScheduled: true, botStepGeneration: generation, ...(markHasBots ? { hasBots: true } : {}) });
  await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId: room.externalId, generation });
}

async function getPlayers(ctx: any, roomId: string) {
  return ctx.db.query("participants")
    .withIndex("by_room_role", (q: any) => q.eq("roomId", roomId).eq("role", "player"))
    .take(4);
}

async function getRoomViewParticipants(ctx: any, roomId: string, viewer: any) {
  const players = await getPlayers(ctx, roomId);
  return viewer.role === "player" ? players : [...players, viewer];
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

function projectRoom(room: any, participants: any[], viewer: any) {
  const audience: StateAudience = viewer.role === "player" ? "player" : "spectator";
  return {
    id: room.externalId,
    code: room.code,
    status: room.status,
    matchStarted: Boolean(room.matchStarted),
    maxPlayers: room.maxPlayers,
    privacy: room.privacy,
    version: room.version,
    state: projectState(decodeGameState(room.state), audience, viewer.playerIndex),
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
  };
}

async function addParticipant(ctx: any, room: any, displayName: string, role: "player" | "spectator", playerIndex?: number) {
  const token = newToken();
  const timestamp = now();
  const externalId = crypto.randomUUID();
  const participant = {
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
  };
  const participantDocId = await ctx.db.insert("participants", participant);
  const presenceId = await ctx.db.insert("roomPresence", { participantId: externalId, roomId: room.externalId, lastSeenAt: timestamp });
  await ctx.db.patch(participantDocId, { presenceId });
  await schedulePresenceCheck(ctx, room, PRESENCE_CHECK_INTERVAL_MS);
  return { token, externalId, participant: { ...participant, _id: participantDocId, presenceId } };
}

async function loadRoomView(ctx: any, room: any, participant: any) {
  const participants = await participantsWithUsernames(ctx, await getRoomViewParticipants(ctx, room.externalId, participant));
  const result = projectRoom(room, participants, participant);
  return { ...result, events: [] };
}

async function participantsWithUsernames(ctx: any, roomParticipants: any[]) {
  return Promise.all(roomParticipants.map(async (item: any) => {
    if (!item.userId) return item;
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", item.userId)).unique();
    return user ? { ...item, username: user.username } : item;
  }));
}

async function insertEvent(ctx: any, room: any, actorId: string, version: number, type: string, payload: unknown, replayCommand?: unknown, controlSource: "human" | "bot" = "human") {
  await ctx.db.insert("events", {
    externalId: crypto.randomUUID(), roomId: room.externalId, version, actorId,
    type, controlSource, payload,
    ...(replayCommand === undefined ? {} : { replayCommand }), createdAt: now(),
  });
}

async function updateStatsSummary(ctx: any, identity: any, row: any) {
  const summary = identity.statsSummary;
  if (!summary) return;
  const monsterChoices = { ...(summary.monsterChoices as Record<string, number>) };
  const branchChoices = { ...(summary.branchChoices as Record<string, number>) };
  monsterChoices[row.monsterName] = (monsterChoices[row.monsterName] ?? 0) + 1;
  branchChoices[row.branch] = (branchChoices[row.branch] ?? 0) + 1;
  identity.statsSummary = {
    gamesPlayed: summary.gamesPlayed + 1,
    wins: summary.wins + Number(row.outcome === "win"),
    losses: summary.losses + Number(row.outcome === "loss"),
    ties: summary.ties + Number(row.outcome === "tie"),
    stompedTiles: summary.stompedTiles + row.stompedTiles,
    damageTaken: summary.damageTaken + row.damageTaken,
    healthGained: summary.healthGained + row.healthGained,
    luckTotal: summary.luckTotal + row.luckTotal,
    luckRolls: summary.luckRolls + row.luckRolls,
    botAssistedMatches: summary.botAssistedMatches + Number(row.botAssisted),
    monsterChoices,
    branchChoices,
    updatedAt: row.completedAt,
  };
  await ctx.db.patch(identity._id, { statsSummary: identity.statsSummary });
}

async function migrateLegacyReplaySeed(ctx: any, room: any) {
  if (!room.initialReplayState) return false;
  const existing = await ctx.db.query("roomReplaySeeds").withIndex("by_room", (q: any) => q.eq("roomId", room.externalId)).unique();
  if (!existing) {
    await ctx.db.insert("roomReplaySeeds", {
      roomId: room.externalId,
      initialState: encodeGameState(decodeGameState(room.initialReplayState)),
    });
  }
  return true;
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
      maxPlayers: args.maxPlayers, version: 0, state: encodeGameState(state), hasBots: false,
      createdAt: timestamp,
      updatedAt: timestamp, lastActivityAt: timestamp,
      playerStats: emptyMatchCounters(args.maxPlayers),
    });
    await ctx.db.insert("roomReplaySeeds", { roomId: id, initialState: encodeGameState(state) });
    const room = {
      _id: roomId, externalId: id, code, status: "waiting", matchStarted: false,
      privacy: args.privacy, maxPlayers: args.maxPlayers, version: 0, state, hasBots: false,
      lastActivityAt: timestamp,
    };
    const session = await addParticipant(ctx, room, args.displayName || "Player 1", "player", 0);
    return { room: await loadRoomView(ctx, room, session.participant), participantId: session.externalId, token: session.token };
  },
});

export const join = mutation({
  args: { code: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.matchStarted) throw new Error("This match has already started.");
    const players = await getPlayers(ctx, room.externalId);
    if (players.length >= room.maxPlayers) throw new Error("This room is full.");
    const playerIndex = Array.from({ length: room.maxPlayers }, (_, index) => index).find((index) => !players.some((player: any) => player.playerIndex === index));
    if (playerIndex === undefined) throw new Error("This room is full.");
    const session = await addParticipant(ctx, room, args.displayName || "Player", "player", playerIndex);
    await ctx.db.patch(room._id, { lastActivityAt: now(), updatedAt: now() });
    const refreshed = { ...room, lastActivityAt: now() };
    return { room: await loadRoomView(ctx, refreshed, session.participant), participantId: session.externalId, token: session.token };
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
    const players = await getPlayers(ctx, room.externalId);
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
    await ctx.db.patch(room._id, { lastActivityAt: timestamp, updatedAt: timestamp, hasBots: true });
    const refreshed = { ...room, lastActivityAt: timestamp };
    return loadRoomView(ctx, refreshed, requester);
  },
});

export const fillWithBots = mutation({
  args: { code: v.string(), token: v.string() },
  returns: roomViewValidator,
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.status !== "waiting" || room.matchStarted) throw new Error("Bots can only be added while the room is waiting.");
    const tokenHash = await hashToken(args.token);
    const requester = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!requester || requester.roomId !== room.externalId || requester.sessionExpiresAt <= now() || requester.role !== "player" || requester.botControlled) throw new Error("Only a human player can add bots.");

    const players = await getPlayers(ctx, room.externalId);
    const occupied = new Set(players.map((player: any) => player.playerIndex));
    const openSeats = Array.from({ length: room.maxPlayers }, (_, index) => index).filter((index) => !occupied.has(index));
    const timestamp = now();
    const addedBots = [];
    for (const playerIndex of openSeats) {
      const bot = {
        externalId: crypto.randomUUID(), roomId: room.externalId,
        displayName: `Bot ${playerIndex + 1}`, role: "player" as const, playerIndex,
        tokenHash: await hashToken(newToken()), sessionExpiresAt: timestamp + SESSION_TTL_MS,
        ready: true, botControlled: true, botAssisted: false, createdAt: timestamp,
      };
      const id = await ctx.db.insert("participants", bot);
      addedBots.push({ ...bot, _id: id });
    }
    if (addedBots.length) await ctx.db.patch(room._id, { lastActivityAt: timestamp, updatedAt: timestamp, hasBots: true });
    const refreshed = addedBots.length ? { ...room, lastActivityAt: timestamp } : room;
    const allParticipants = await participantsWithUsernames(ctx, await getRoomViewParticipants(ctx, room.externalId, requester));
    return projectRoom(refreshed, allParticipants, requester);
  },
});

export const setPrivacy = mutation({
  args: { code: v.string(), token: v.string(), privacy: v.union(v.literal("private"), v.literal("public")) },
  returns: roomViewValidator,
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.status !== "waiting" || room.matchStarted) throw new Error("Room privacy can only be changed before the match starts.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player" || participant.playerIndex !== 0) {
      throw new Error("Only the room creator can change privacy.");
    }
    const timestamp = now();
    await ctx.db.patch(room._id, { privacy: args.privacy, lastActivityAt: timestamp, updatedAt: timestamp });
    const participants = await getRoomViewParticipants(ctx, room.externalId, participant);
    return projectRoom({ ...room, privacy: args.privacy, lastActivityAt: timestamp }, participants, participant);
  },
});

export const takeOverWithBot = mutation({
  args: { code: v.string(), token: v.string() },
  returns: roomViewValidator,
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (room.status !== "active" || !room.matchStarted) throw new Error("Bot takeover is only available during an active match.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player" || participant.playerIndex === undefined) {
      throw new Error("Only a player can hand their seat to a bot.");
    }
    const timestamp = now();
    await ctx.db.patch(participant._id, { connectedAt: undefined, disconnectedAt: timestamp, botControlled: true, botAssisted: true, connectionId: undefined });
    await ctx.db.patch(room._id, { lastActivityAt: timestamp, updatedAt: timestamp, hasBots: true });
    await scheduleBotStep(ctx, room);
    const participants = (await getPlayers(ctx, room.externalId)).map((item: any) => item._id === participant._id
      ? { ...item, connectedAt: undefined, disconnectedAt: timestamp, botControlled: true, botAssisted: true, connectionId: undefined }
      : item);
    return projectRoom({ ...room, lastActivityAt: timestamp }, participants, participant);
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
    return { room: await loadRoomView(ctx, room, session.participant), participantId: session.externalId, token: session.token };
  },
});

export const read = query({
  args: { code: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase())).unique();
    if (!room || room.status === "deleting" || (room.status !== "completed" && now() - room.lastActivityAt >= IDLE_TIMEOUT_MS)) throw new Error("Room not found or expired.");
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    const participants = await getRoomViewParticipants(ctx, room.externalId, participant);
    return {
      ...projectRoom(room, participants, participant),
      events: [],
    };
  },
});

// Keep the high-churn game-state subscription separate from participant rows.
// Convex tracks table documents read by a live query; combining this list with
// the game snapshot makes every move reread all participants as the room doc
// changes. The participant subscription only reruns when room membership or
// presence metadata changes.
export const readLiveState = query({
  args: { code: v.string(), tokenHash: v.string() },
  returns: roomLiveStateValidator,
  handler: async (ctx, args) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase())).unique();
    if (!room || room.status === "deleting" || (room.status !== "completed" && now() - room.lastActivityAt >= IDLE_TIMEOUT_MS)) throw new Error("Room not found or expired.");
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    return {
      id: room.externalId, code: room.code, status: room.status, matchStarted: Boolean(room.matchStarted),
      maxPlayers: room.maxPlayers, privacy: room.privacy, version: room.version,
      state: projectState(decodeGameState(room.state), participant.role === "player" ? "player" : "spectator", participant.playerIndex),
    };
  },
});

export const readParticipants = query({
  args: { tokenHash: v.string() },
  returns: v.array(roomParticipantValidator),
  handler: async (ctx, { tokenHash }) => {
    const viewer = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!viewer || viewer.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    const participants = await getRoomViewParticipants(ctx, viewer.roomId, viewer);
    return Promise.all(participants.map(async (participant: any) => {
      const user = participant.userId
        ? await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", participant.userId)).unique()
        : null;
      return {
        id: participant.externalId,
        displayName: participant.displayName,
        ...(user?.username ? { username: user.username } : {}),
        role: participant.role,
        ...(participant.playerIndex === undefined ? {} : { playerIndex: participant.playerIndex }),
        connected: participant.connectedAt !== undefined,
        ready: participant.ready,
        botControlled: participant.botControlled,
        botAssisted: participant.botAssisted,
      };
    }));
  },
});

export const deleteRoom = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    if (participant.role !== "player" || participant.playerIndex !== 0) throw new Error("Only the room creator can delete it.");
    if (!["waiting", "abandoned", "expired"].includes(room.status)) throw new Error("Only a waiting or abandoned room can be deleted.");
    await scheduleRoomPurge(ctx, room);
    return { ok: true as const };
  },
});

export const purgeRoomBatch = internalMutation({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
    if (!room || room.status !== "deleting") return;
    const [participants, presence, events, receipts, runtime, replaySeed] = await Promise.all([
      ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(100),
      ctx.db.query("roomPresence").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(100),
      ctx.db.query("events").withIndex("by_room_version", (q) => q.eq("roomId", roomId)).take(100),
      ctx.db.query("commandReceipts").withIndex("by_room_action", (q) => q.eq("roomId", roomId)).take(100),
      ctx.db.query("roomRuntime").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique(),
      ctx.db.query("roomReplaySeeds").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique(),
    ]);
    for (const row of participants) await ctx.db.delete(row._id);
    for (const row of presence) await ctx.db.delete(row._id);
    for (const row of events) await ctx.db.delete(row._id);
    for (const row of receipts) await ctx.db.delete(row._id);
    if (runtime) await ctx.db.delete(runtime._id);
    if (replaySeed) await ctx.db.delete(replaySeed._id);
    if (participants.length || presence.length || events.length || receipts.length) {
      await ctx.scheduler.runAfter(0, internal.rooms.purgeRoomBatch, { roomId });
      return;
    }
    await ctx.db.delete(room._id);
  },
});

export const reconnect = mutation({
  args: { code: v.string(), token: v.string(), connectionId: v.string() },
  returns: v.object({
    ok: v.literal(true),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("completed"), v.literal("abandoned"), v.literal("expired")),
  }),
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    if (participant.connectionId === args.connectionId && participant.connectedAt !== undefined && !participant.botControlled) return { ok: true as const, status: room.status };
    const timestamp = now();
    await ctx.db.patch(participant._id, { connectedAt: timestamp, disconnectedAt: undefined, botControlled: false, connectionId: args.connectionId });
    await touchPresence(ctx, participant, room.externalId, timestamp);
    let status = room.status;
    if (room.status !== "active" && room.status !== "completed") {
      const participants = (await getPlayers(ctx, room.externalId)).map((item: any) => item._id === participant._id ? { ...item, connectedAt: timestamp, disconnectedAt: undefined, botControlled: false } : item);
      status = refreshStatus({ ...room, lastActivityAt: timestamp }, participants);
      await ctx.db.patch(room._id, { status, lastActivityAt: timestamp, updatedAt: timestamp });
    }
    if (room.status !== "completed") await scheduleBotStep(ctx, room);
    return { ok: true as const, status };
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
    await touchPresence(ctx, participant, room.externalId, timestamp);
    const players = await getPlayers(ctx, room.externalId);
    const updated = { ...participant, connectedAt: undefined, disconnectedAt: timestamp, lastSeenAt: timestamp };
    const updatedPlayers = players.map((item: any) => item._id === participant._id ? updated : item);
    const status = room.status === "active" && updatedPlayers.length > 0 && updatedPlayers.every((item: any) => item.connectedAt === undefined && !item.botControlled) ? "abandoned" : room.status;
    await ctx.db.patch(room._id, { status, lastActivityAt: timestamp, updatedAt: timestamp });
    const participants = participant.role === "player" ? updatedPlayers : [...players, updated];
    return projectRoom({ ...room, status, lastActivityAt: timestamp }, participants, updated);
  },
});

export const heartbeat = mutation({
  args: { code: v.string(), token: v.string(), connectionId: v.string() },
  handler: async (ctx, args) => {
    // The room code is retained in the client contract, but the unguessable
    // session token identifies the participant and its room without rereading
    // and decompressing the room snapshot on every heartbeat.
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.sessionExpiresAt <= now()) throw new Error("Invalid or expired room token.");
    if (participant.connectionId !== args.connectionId || participant.botControlled) throw new Error("This room connection has been replaced. Reconnect to continue.");
    const timestamp = now();
    await touchPresence(ctx, participant, participant.roomId, timestamp);
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
      const [players, spectators] = await Promise.all([
        getPlayers(ctx, room.externalId),
        ctx.db.query("participants")
          .withIndex("by_room_role", (q) => q.eq("roomId", room.externalId).eq("role", "spectator"))
          .take(21),
      ]);
      result.push({
        code: room.code, status: room.status, maxPlayers: room.maxPlayers,
        playerCount: players.length,
        spectatorCount: spectators.length,
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
    const players = await getPlayers(ctx, room.externalId);
    if (players.length !== room.maxPlayers || players.some((player: any) => player.connectedAt === undefined && !player.botControlled)) throw new Error("Wait until every player has joined and is connected.");
    const timestamp = now();
    await ctx.db.patch(room._id, { matchStarted: true, lastActivityAt: timestamp, updatedAt: timestamp });
    if (players.some((player: any) => player.botControlled)) await scheduleBotStep(ctx, room);
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
    const participants = (await getPlayers(ctx, room.externalId)).map((item: any) => item._id === participant._id ? { ...item, ready: args.ready } : item);
    const nextStatus = refreshStatus({ ...room, lastActivityAt: now() }, participants);
    const patch: Record<string, unknown> = { status: nextStatus, lastActivityAt: now(), updatedAt: now() };
    let nextState: GameState | undefined;
    if (nextStatus === "active" && room.state.setupState?.phase === "complete" && !room.state.setupApplied) {
      nextState = applyCompletedSetup(room.state as GameState);
      patch.state = encodeGameState(nextState);
      patch.version = room.version + 1;
    }
    if (await migrateLegacyReplaySeed(ctx, room)) patch.initialReplayState = undefined;
    await ctx.db.patch(room._id, patch);
    if (nextState) await insertEvent(ctx, room, participant.externalId, room.version + 1, "match.started", { phase: nextState.phase, currentPlayer: nextState.currentPlayer }, { kind: "start" });
    if (nextStatus === "active") await scheduleBotStep(ctx, room);
    const nextRoom = { ...room, ...patch, ...(nextState ? { state: nextState } : {}) };
    const nextParticipants = participants;
      return projectRoom(nextRoom, nextParticipants, participant);
  },
});

export const setup = mutation({
  args: { code: v.string(), token: v.string(), expectedRevision: v.number(), action: v.any() },
  returns: roomActionResultValidator,
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
    let hasBots = room.hasBots;
    if (hasBots === undefined) {
      const existingParticipants = await getPlayers(ctx, room.externalId);
      hasBots = existingParticipants.some((candidate: any) => candidate.role === "player" && candidate.botControlled);
    }
    const replaySeedMigrated = await migrateLegacyReplaySeed(ctx, room);
    await ctx.db.patch(room._id, {
      state: encodeGameState(state as GameState), version, lastActivityAt: timestamp, updatedAt: timestamp,
      ...(replaySeedMigrated ? { initialReplayState: undefined } : {}),
      ...(room.hasBots === undefined ? { hasBots: Boolean(hasBots) } : {}),
    });
    await insertEvent(ctx, room, participant.externalId, version, "setup.updated", { phase: nextSetup.phase, action: (args.action as SetupAction).type }, { kind: "setup", playerIndex: participant.playerIndex, action: args.action });
    // A human setup choice can hand the next pick to a bot before setup is complete.
    // Wake the bot runner after every accepted setup action; it exits if a human is next.
    if (hasBots) await scheduleBotStep(ctx, room);
    return { state: projectState(state as GameState, "player", participant.playerIndex), version, status: room.status };
  },
});

export const submit = mutation({
  args: { code: v.string(), token: v.string(), envelope: v.any() },
  returns: roomActionResultValidator,
  handler: async (ctx, args) => {
    const room = await roomByCode(ctx, args.code);
    if (!room.matchStarted) throw new Error("This match has not been started yet.");
    const tokenHash = await hashToken(args.token);
    const participant = await ctx.db.query("participants").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!participant || participant.roomId !== room.externalId || participant.sessionExpiresAt <= now() || participant.role !== "player") throw new Error("Spectators cannot submit game actions.");
    if (participant.botControlled) throw new Error("This seat is currently being controlled by the room bot. Reconnect to take control.");
    const envelope = args.envelope as GameCommandEnvelope;
    if (envelope.actorId !== participant.externalId) throw new Error("Command actor does not match the room participant.");
    if (envelope.expectedRevision < room.version) {
      const priorEvent = await ctx.db.query("events")
        .withIndex("by_room_version", (q) => q.eq("roomId", room.externalId).eq("version", envelope.expectedRevision + 1))
        .unique();
      const receipt = priorEvent?.payload?.receipt;
      if (receipt?.actionId === envelope.actionId && receipt?.actorId === participant.externalId) {
        return {
          state: projectState(room.state as GameState, "player", participant.playerIndex),
          version: room.version,
          status: room.status,
        };
      }
    }
    if (room.status !== "active") throw new Error("This room is not ready for gameplay.");
    let participants: any[] | undefined;
    let hasBots = room.hasBots;
    if (hasBots === undefined) {
      const existingParticipants = await getPlayers(ctx, room.externalId);
      participants = existingParticipants;
      hasBots = existingParticipants.some((item: any) => item.role === "player" && item.botControlled);
    }
    const state = room.state as GameState;
    const decision = state.pendingDecision;
    const required = requiredPlayer(state, envelope);
    if (participant.playerIndex !== required) throw new Error("It is not your turn.");
    const result = applyCommandEnvelope(state, envelope, room.version);
    const counters = updateMatchCounters(state, result.state, room.playerStats, participant.playerIndex ?? 0);
    const version = room.version + 1;
    const timestamp = now();
    const terminal = result.state.phase === "game-over";
    if (terminal && !participants) participants = await getPlayers(ctx, room.externalId);
    const replaySeedMigrated = await migrateLegacyReplaySeed(ctx, room);
    await ctx.db.patch(room._id, {
      state: encodeGameState(result.state), playerStats: counters, version, lastActivityAt: timestamp, updatedAt: timestamp,
      ...(replaySeedMigrated ? { initialReplayState: undefined } : {}),
      ...(room.hasBots === undefined ? { hasBots: Boolean(hasBots) } : {}),
      ...(terminal ? { status: "completed", completedAt: timestamp } : {}),
    });
    await insertEvent(ctx, room, participant.externalId, version, result.eventType, { receipt: result.receipt }, { kind: "command", playerIndex: participant.playerIndex ?? 0, command: envelope.command });
    if (terminal) {
      const linked = participants!.filter((item: any) => item.role === "player" && item.userId && item.playerIndex !== undefined);
      const identities = [];
      for (const item of linked) {
        const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", item.userId)).unique();
        if (user) identities.push({ _id: user._id, participantId: item.externalId, userId: user.externalId, username: user.username, playerIndex: item.playerIndex, botAssisted: item.botAssisted, statsSummary: user.statsSummary, statsSummaryEnabled: user.statsSummaryEnabled });
      }
      for (const row of completedMatchRows(room.externalId, result.state, counters, identities)) {
        await ctx.db.insert("playerMatchStats", { externalId: crypto.randomUUID(), ...row, completedAt: timestamp });
        const identity = identities.find((item) => item.userId === row.userId);
        if (identity?.statsSummaryEnabled) await updateStatsSummary(ctx, identity, { ...row, completedAt: timestamp });
      }
      const winner = participants!.find((item: any) => item.role === "player" && item.playerIndex === result.state.winnerPlayer);
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
    if (!terminal && hasBots) {
      await scheduleBotStep(ctx, room);
    }
    return {
      state: projectState(result.state, "player", participant.playerIndex),
      version,
      status: terminal ? "completed" as const : room.status,
    };
  },
});

function nextSetupPlayer(setup: NonNullable<GameState["setupState"]>) {
  if (setup.phase === "unused-branch-placement") return setup.definition.playerCount - 1;
  const field = setup.phase === "monster-selection" ? "monsterId" : setup.phase === "branch-selection" ? "branch" : setup.phase === "lair-selection" ? "lair" : "startingChoice";
  const seats = [...setup.seats].sort((left, right) => setup.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
  return seats.find((seat) => (seat as any)[field] === undefined)?.playerIndex ?? -1;
}

export const checkRoomPresence = internalMutation({
  args: { roomId: v.string(), generation: v.number() },
  handler: async (ctx, { roomId, generation }) => {
    let room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
    if (!room) return;
    room = { ...room, state: decodeGameState(room.state) };
    const storedRuntime = await roomRuntime(ctx, room);
    if (storedRuntime.presenceCheckGeneration !== generation || !storedRuntime.presenceCheckScheduled) return;
    const runtime = { ...storedRuntime, presenceCheckScheduled: false, presenceCheckId: undefined };
    if (["completed", "deleting"].includes(room.status)) return;

    const timestamp = now();
    const players = await ctx.db.query("participants").withIndex("by_room_role", (q) => q.eq("roomId", roomId).eq("role", "player")).take(4);
    const presenceRows = await Promise.all(players.map((player: any) => readPresence(ctx, player)));
    const lastSeenByParticipant = new Map(players.map((player: any, index: number) => [player.externalId, presenceRows[index]?.lastSeenAt ?? player.lastSeenAt]));
    const staleCutoff = timestamp - PRESENCE_TIMEOUT_MS;
    let connectedHuman = false;
    let botStarted = false;
    let nextDelay = Number.POSITIVE_INFINITY;
    const disconnected: typeof players = [];
    for (const player of players) {
      if (player.botControlled) continue;
      const lastSeenAt = lastSeenByParticipant.get(player.externalId) ?? 0;
      if (player.connectedAt !== undefined && lastSeenAt > staleCutoff) {
        connectedHuman = true;
        nextDelay = Math.min(nextDelay, lastSeenAt + PRESENCE_TIMEOUT_MS - timestamp + 1_000);
        continue;
      }
      if (player.connectedAt !== undefined) {
        const disconnectedAt = lastSeenAt || timestamp;
        await ctx.db.patch(player._id, { connectedAt: undefined, disconnectedAt });
        disconnected.push({ ...player, connectedAt: undefined, disconnectedAt });
      } else disconnected.push(player);
    }
    for (const player of disconnected) {
      const disconnectedAt = player.disconnectedAt ?? lastSeenByParticipant.get(player.externalId) ?? room.lastActivityAt;
      const takeoverAt = disconnectedAt + 4 * 60_000;
      if (connectedHuman && room.matchStarted && timestamp >= takeoverAt) {
        await ctx.db.patch(player._id, { botControlled: true, botAssisted: true });
        botStarted = true;
      } else if (connectedHuman && room.matchStarted) {
        nextDelay = Math.min(nextDelay, Math.max(1_000, takeoverAt - timestamp + 1_000));
      }
    }

    if (!connectedHuman) {
      const latestDisconnect = Math.max(room.lastActivityAt, ...players.map((p) => p.disconnectedAt ?? lastSeenByParticipant.get(p.externalId) ?? room.lastActivityAt));
      const purgeAt = latestDisconnect + 45_000;
      if (timestamp >= purgeAt) {
        await scheduleRoomPurge(ctx, room);
        return;
      }
      if (room.status === "active") await ctx.db.patch(room._id, { status: "abandoned", updatedAt: timestamp });
      await schedulePresenceCheck(ctx, room, purgeAt - timestamp, runtime);
      return;
    }

    if (timestamp - room.lastActivityAt >= IDLE_TIMEOUT_MS) {
      if (room.status === "active" && players.some((p) => p.userId)) {
        await ctx.db.patch(room._id, { status: "expired", updatedAt: timestamp });
        nextDelay = Math.min(nextDelay, PRESENCE_CHECK_INTERVAL_MS);
      } else {
        await scheduleRoomPurge(ctx, room);
        return;
      }
    } else {
      nextDelay = Math.min(nextDelay, room.lastActivityAt + IDLE_TIMEOUT_MS - timestamp + 1_000);
    }
    if (botStarted) await scheduleBotStep(ctx, room, true);
    await schedulePresenceCheck(ctx, room, Math.max(1_000, nextDelay), runtime);
  },
});

export const bootstrapPresenceChecks = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("rooms").order("asc").paginate({ numItems: 100, cursor: cursor ?? null });
    for (const room of page.page) {
      if (["waiting", "active", "abandoned", "expired"].includes(room.status)) {
        await schedulePresenceCheck(ctx, room, PRESENCE_CHECK_INTERVAL_MS);
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.rooms.bootstrapPresenceChecks, { cursor: page.continueCursor });
    return { scheduled: page.page.filter((room) => ["waiting", "active", "abandoned", "expired"].includes(room.status)).length, done: page.isDone };
  },
});

export const runBotStep = internalMutation({
  args: { roomId: v.string(), generation: v.optional(v.number()) },
  handler: async (ctx, { roomId, generation }) => {
    let room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
    if (!room) return;
    room = { ...room, state: decodeGameState(room.state) };
    if (generation !== undefined) {
      if (!room.botStepScheduled || room.botStepGeneration !== generation) return;
      await ctx.db.patch(room._id, { botStepScheduled: false });
      room = { ...room, botStepScheduled: false };
    } else if (room.botStepScheduled) {
      // Ignore legacy queued jobs while a generation-tracked job is pending.
      return;
    }
    if (!room || !room.matchStarted || (room.status !== "waiting" && room.status !== "active")) return;
    const participants = await getPlayers(ctx, roomId);
    const connectedHumans = participants.filter((participant: any) => !participant.botControlled && participant.connectedAt !== undefined);
    const livePresenceRows = await Promise.all(connectedHumans.map((participant: any) => readPresence(ctx, participant)));
    const hasLiveHuman = connectedHumans.some((participant: any, index: number) =>
      (livePresenceRows[index]?.lastSeenAt ?? participant.lastSeenAt ?? 0) > now() - PRESENCE_TIMEOUT_MS,
    );
    if (!hasLiveHuman) return;
    const bots = participants.filter((participant: any) => participant.botControlled && participant.playerIndex !== undefined);
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
      const replaySeedMigrated = await migrateLegacyReplaySeed(ctx, room);
      let finalState = nextState as GameState;
      const patch: Record<string, unknown> = { state: encodeGameState(finalState), version, lastActivityAt: timestamp, updatedAt: timestamp, ...(replaySeedMigrated ? { initialReplayState: undefined } : {}) };
      const updatedParticipants = participants.map((item: any) => item._id === actor._id ? { ...item, ready: Boolean(seat?.startingChoice) } : item);
      const nextStatus = refreshStatus({ ...room, state: nextState, lastActivityAt: timestamp }, updatedParticipants);
      patch.status = nextStatus;
      if (nextStatus === "active" && nextState.setupState?.phase === "complete" && !nextState.setupApplied) {
        const started = applyCompletedSetup(nextState as GameState);
        version += 1;
        finalState = started;
        patch.state = encodeGameState(started);
        patch.version = version;
      }
      await ctx.db.patch(room._id, patch);
      await insertEvent(ctx, room, actor.externalId, room.version + 1, "setup.updated", { phase: setup.phase, automated: true }, { kind: "setup", playerIndex, action }, "bot");
      if (version > room.version + 1) await insertEvent(ctx, { ...room, externalId: roomId }, actor.externalId, version, "match.started", { phase: finalState.phase, currentPlayer: finalState.currentPlayer }, { kind: "start" }, "bot");
      await scheduleBotStep(ctx, { ...room, botStepScheduled: false });
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
    const replaySeedMigrated = await migrateLegacyReplaySeed(ctx, room);
    await ctx.db.patch(room._id, { state: encodeGameState(applied.state), playerStats: counters, version, lastActivityAt: timestamp, updatedAt: timestamp, ...(replaySeedMigrated ? { initialReplayState: undefined } : {}), ...(terminal ? { status: "completed", completedAt: timestamp } : {}) });
    await insertEvent(ctx, room, actor.externalId, version, applied.eventType, { receipt: applied.receipt }, { kind: "command", playerIndex, command }, "bot");
    if (terminal) {
      const identities = [];
      for (const participant of participants.filter((item: any) => item.role === "player" && item.userId && item.playerIndex !== undefined)) {
        const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", participant.userId)).unique();
        if (user) identities.push({ _id: user._id, participantId: participant.externalId, userId: user.externalId, username: user.username, playerIndex: participant.playerIndex, botAssisted: participant.botAssisted || participant._id === actor._id, statsSummary: user.statsSummary, statsSummaryEnabled: user.statsSummaryEnabled });
      }
      for (const row of completedMatchRows(roomId, applied.state, counters, identities)) {
        await ctx.db.insert("playerMatchStats", { externalId: crypto.randomUUID(), ...row, completedAt: timestamp });
        const identity = identities.find((item) => item.userId === row.userId);
        if (identity?.statsSummaryEnabled) await updateStatsSummary(ctx, identity, { ...row, completedAt: timestamp });
      }
      const winner = participants.find((participant: any) => participant.role === "player" && participant.playerIndex === applied.state.winnerPlayer);
      await ctx.db.insert("gameResults", { externalId: crypto.randomUUID(), roomId, ...(winner ? { winnerId: winner.externalId, winnerName: winner.displayName } : {}), summary: { winnerPlayer: applied.state.winnerPlayer, victoryType: applied.state.victoryType, rulesetVersion: applied.state.rulesetVersion, durationRounds: applied.state.round, terminalEvent: { type: applied.eventType, version } }, createdAt: timestamp });
      return;
    }
    await scheduleBotStep(ctx, { ...room, botStepScheduled: false });
  },
});
