import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { sumPlayerStats } from "../apps/api/src/player-stats.js";

const ACCOUNT_PRESENCE_TTL_MS = 6 * 60 * 1000;
const ACCOUNT_PRESENCE_REFRESH_THRESHOLD_MS = 90 * 1000;

async function userById(ctx: any, userId: string) {
  const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", userId)).unique();
  if (!user) throw new Error("Account not found.");
  return user;
}
async function statsForUser(ctx: any, userId: string) {
  return ctx.db.query("playerMatchStats").withIndex("by_user_completed", (q: any) => q.eq("userId", userId)).order("desc").collect();
}
function summarizeRows(userId: string, rows: any[], username: string) {
  const stats = sumPlayerStats(rows, username);
  return {
    userId,
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    ties: stats.ties,
    stompedTiles: stats.stompedTiles,
    damageTaken: stats.damageTaken,
    healthGained: stats.healthGained,
    luckTotal: stats.luckTotal,
    luckRolls: stats.luckRolls,
    botAssistedMatches: rows.filter((row) => row.botAssisted).length,
    monsterChoices: stats.monsterChoices,
    branchChoices: stats.branchChoices,
    updatedAt: Date.now(),
  };
}
function statsFromSummary(summary: any, username: string) {
  const mostChosen = (choices: Record<string, number>) => Object.entries(choices)
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName))[0]?.[0];
  return {
    username,
    gamesPlayed: summary.gamesPlayed,
    wins: summary.wins,
    losses: summary.losses,
    ties: summary.ties,
    winRate: summary.gamesPlayed ? summary.wins / summary.gamesPlayed : 0,
    stompedTiles: summary.stompedTiles,
    damageTaken: summary.damageTaken,
    healthGained: summary.healthGained,
    luckTotal: summary.luckTotal,
    luckRolls: summary.luckRolls,
    luckAverage: summary.luckRolls ? summary.luckTotal / summary.luckRolls : null,
    monsterChoices: summary.monsterChoices as Record<string, number>,
    branchChoices: summary.branchChoices as Record<string, number>,
    mostChosenMonster: mostChosen(summary.monsterChoices),
    mostChosenBranch: mostChosen(summary.branchChoices),
  };
}
async function ensureStatsSummary(ctx: any, user: any) {
  let summary = user.statsSummary;
  if (!summary) {
    summary = summarizeRows(user.externalId, await statsForUser(ctx, user.externalId), user.username);
    await ctx.db.patch(user._id, { statsSummary: summary, statsSummaryEnabled: true });
  } else if (!user.statsSummaryEnabled) {
    await ctx.db.patch(user._id, { statsSummaryEnabled: true });
  }
  return summary;
}
const digestToken = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};
async function userByUsername(ctx: any, usernameInput: string) {
  return ctx.db.query("userAccounts").withIndex("by_username", (q: any) => q.eq("username", usernameInput.trim().toLowerCase())).unique();
}
async function createFriendship(ctx: any, firstId: string, secondId: string) {
  const [userAId, userBId] = [firstId, secondId].sort();
  const existing = await ctx.db.query("friendships").withIndex("by_pair", (q: any) => q.eq("userAId", userAId).eq("userBId", userBId)).unique();
  if (!existing) await ctx.db.insert("friendships", { externalId: crypto.randomUUID(), userAId, userBId, createdAt: Date.now() });
}

async function gamesForUser(ctx: any, userId: string) {
  const participants = await ctx.db.query("participants").withIndex("by_user_role_created", (q: any) => q.eq("userId", userId).eq("role", "player")).order("desc").take(20);
  const result = [];
  for (const participant of participants) {
    const room = await ctx.db.query("rooms").withIndex("by_external_id", (q: any) => q.eq("externalId", participant.roomId)).unique();
    if (!room || room.isTest) continue;
    const matchStats = await ctx.db.query("playerMatchStats").withIndex("by_room_participant", (q: any) => q.eq("roomId", room.externalId).eq("participantId", participant.externalId)).unique();
    result.push({
      roomId: room.externalId, code: room.code, status: room.status, privacy: room.privacy,
      playerIndex: participant.playerIndex ?? 0, displayName: participant.displayName,
      botControlled: participant.botControlled, botAssisted: participant.botAssisted,
      ...(room.completedAt ? { completedAt: new Date(room.completedAt).toISOString() } : {}),
      ...(matchStats ? { outcome: matchStats.outcome } : {}),
    });
  }
  return result;
}

export const stats = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const user = await userById(ctx, userId);
    const summary = user.statsSummary;
    return summary ? statsFromSummary(summary, user.username) : sumPlayerStats(await statsForUser(ctx, userId), user.username);
  },
});

export const games = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => gamesForUser(ctx, userId),
});

export const privacy = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => ({ publicStatsEnabled: Boolean((await userById(ctx, userId)).publicStatsEnabled) }),
});

export const updatePrivacy = internalMutation({
  args: { userId: v.string(), publicStatsEnabled: v.boolean() },
  handler: async (ctx, { userId, publicStatsEnabled }) => {
    const user = await userById(ctx, userId);
    await ctx.db.patch(user._id, { publicStatsEnabled, updatedAt: Date.now() });
    return { publicStatsEnabled };
  },
});

export const updateUsername = internalMutation({
  args: { userId: v.string(), usernameInput: v.string() },
  handler: async (ctx, { userId, usernameInput }) => {
    const username = usernameInput.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,24}$/.test(username)) throw new Error("Username must be 3–24 letters, numbers, hyphens, or underscores.");
    const user = await userById(ctx, userId);
    const duplicate = await ctx.db.query("userAccounts").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (duplicate && duplicate.externalId !== userId) throw new Error("That username is already in use.");
    await ctx.db.patch(user._id, { username, updatedAt: Date.now() });
    for (const participant of await ctx.db.query("participants").withIndex("by_user_role", (q) => q.eq("userId", userId)).collect()) await ctx.db.patch(participant._id, { displayName: username });
    return { id: userId, username, emailVerified: Boolean(user.emailVerifiedAt) };
  },
});

export const publicProfile = internalMutation({
  args: { usernameInput: v.string() },
  handler: async (ctx, { usernameInput }) => {
    const username = usernameInput.trim().toLowerCase();
    const user = await ctx.db.query("userAccounts").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!user?.publicStatsEnabled) throw new Error("Player not found.");
    const summary = await ensureStatsSummary(ctx, user);
    return { ...statsFromSummary(summary, username), botAssistedMatches: summary.botAssistedMatches };
  },
});

export const leaderboard = internalQuery({
  args: { category: v.string() },
  handler: async (ctx, { category }) => {
    const valid = new Set(["wins", "win-rate", "stomped-tiles", "damage-taken", "health-gained", "luck"]);
    if (!valid.has(category)) throw new Error("Unknown leaderboard category.");
    const users = await ctx.db.query("userAccounts").collect();
    const entries: Array<Record<string, any>> = [];
    for (const user of users.filter((row) => row.publicStatsEnabled)) {
    const summary = user.statsSummary;
    const stats = summary ? statsFromSummary(summary, user.username) : sumPlayerStats(await statsForUser(ctx, user.externalId), user.username);
      if (category === "win-rate" && stats.gamesPlayed < 5) continue;
      if (category === "luck" && stats.luckRolls < 20) continue;
      const value = category === "wins" ? stats.wins : category === "win-rate" ? stats.winRate : category === "stomped-tiles" ? stats.stompedTiles : category === "damage-taken" ? stats.damageTaken : category === "health-gained" ? stats.healthGained : stats.luckAverage ?? 0;
      entries.push({ ...stats, rank: 0, value, categoryValue: value });
    }
    entries.sort((a, b) => b.categoryValue - a.categoryValue || b.wins - a.wins || a.username.localeCompare(b.username));
    return entries.slice(0, 100).map(({ categoryValue: _categoryValue, ...entry }, index) => ({ ...entry, rank: index + 1 }));
  },
});

async function socialSummaryForUser(ctx: any, userId: string, user: any) {
  const [asA, asB, incomingRows, outgoingRows, linkRows, savedRows] = await Promise.all([
    ctx.db.query("friendships").withIndex("by_user_a_created", (q: any) => q.eq("userAId", userId)).collect(),
    ctx.db.query("friendships").withIndex("by_user_b_created", (q: any) => q.eq("userBId", userId)).collect(),
    ctx.db.query("friendInvitations").withIndex("by_recipient_state", (q: any) => q.eq("recipientId", userId)).collect(),
    ctx.db.query("friendInvitations").withIndex("by_sender_created", (q: any) => q.eq("senderId", userId)).collect(),
    ctx.db.query("friendInviteLinks").withIndex("by_sender_created", (q: any) => q.eq("senderId", userId)).collect(),
    ctx.db.query("savedOpponents").withIndex("by_owner_opponent", (q: any) => q.eq("ownerId", userId)).collect(),
  ]);
  const timestamp = Date.now();
  const friends = [];
  for (const relation of [...asA, ...asB].sort((a, b) => a.createdAt - b.createdAt)) {
    const id = relation.userAId === userId ? relation.userBId : relation.userAId;
    const friend = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", id)).unique();
    if (friend) friends.push({ username: friend.username, online: Boolean(friend.presenceEnabled && friend.presenceExpiresAt && friend.presenceExpiresAt > timestamp) });
  }
  const incoming = [];
  for (const row of incomingRows.filter((item: any) => !item.acceptedAt && !item.declinedAt && !item.revokedAt && item.expiresAt > timestamp).sort((a: any, b: any) => b.createdAt - a.createdAt)) {
    const sender = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", row.senderId)).unique();
    if (sender) incoming.push({ id: row.externalId, username: sender.username, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() });
  }
  const outgoing = [];
  for (const row of outgoingRows.filter((item: any) => !item.acceptedAt && !item.declinedAt && !item.revokedAt && item.expiresAt > timestamp).sort((a: any, b: any) => b.createdAt - a.createdAt)) {
    const recipient = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", row.recipientId)).unique();
    if (recipient) outgoing.push({ id: row.externalId, username: recipient.username, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() });
  }
  const inviteLinks = linkRows.filter((item: any) => !item.acceptedAt && !item.revokedAt && item.expiresAt > timestamp).sort((a: any, b: any) => b.createdAt - a.createdAt).map((item: any) => ({ id: item.externalId, createdAt: new Date(item.createdAt).toISOString(), expiresAt: new Date(item.expiresAt).toISOString() }));
  const savedOpponents = [];
  for (const row of savedRows.sort((a: any, b: any) => a.createdAt - b.createdAt)) {
    const opponent = await ctx.db.query("userAccounts").withIndex("by_external_id", (q: any) => q.eq("externalId", row.opponentId)).unique();
    if (opponent) savedOpponents.push(opponent.username);
  }
  return { presenceEnabled: Boolean(user.presenceEnabled), friends, incoming, outgoing, inviteLinks, savedOpponents };
}

export const socialSummary = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => socialSummaryForUser(ctx, userId, await userById(ctx, userId)),
});

export const dashboard = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("accountSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) return null;
    const userId = session.userId;
    const user = await userById(ctx, userId);
    const [games, summary, social] = await Promise.all([
      gamesForUser(ctx, userId),
      ensureStatsSummary(ctx, user),
      socialSummaryForUser(ctx, userId, user),
    ]);
    return {
      account: { id: user.externalId, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) },
      games,
      stats: statsFromSummary(summary, user.username),
      social,
      privacy: { publicStatsEnabled: Boolean(user.publicStatsEnabled) },
    };
  },
});

export const setPresence = internalMutation({
  args: { userId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { userId, enabled }) => {
    const user = await userById(ctx, userId);
    const timestamp = Date.now();
    await ctx.db.patch(user._id, { presenceEnabled: enabled, presenceExpiresAt: enabled ? timestamp + ACCOUNT_PRESENCE_TTL_MS : undefined, updatedAt: timestamp });
  },
});

export const refreshPresence = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const user = await userById(ctx, userId);
    const timestamp = Date.now();
    if (user.presenceEnabled && (!user.presenceExpiresAt || user.presenceExpiresAt <= timestamp + ACCOUNT_PRESENCE_REFRESH_THRESHOLD_MS)) {
      await ctx.db.patch(user._id, { presenceExpiresAt: timestamp + ACCOUNT_PRESENCE_TTL_MS });
    }
  },
});

export const sendFriendInvitation = internalMutation({
  args: { userId: v.string(), usernameInput: v.string() },
  handler: async (ctx, { userId, usernameInput }) => {
    const recipient = await userByUsername(ctx, usernameInput);
    if (!recipient || recipient.externalId === userId) throw new Error("That player cannot be invited.");
    const [userAId, userBId] = [userId, recipient.externalId].sort();
    if (await ctx.db.query("friendships").withIndex("by_pair", (q) => q.eq("userAId", userAId).eq("userBId", userBId)).unique()) return;
    const now = Date.now();
    const recipientInvites = await ctx.db.query("friendInvitations").withIndex("by_recipient_state", (q) => q.eq("recipientId", userId)).collect();
    const reverse = recipientInvites.find((item) => item.senderId === recipient.externalId && !item.acceptedAt && !item.declinedAt && !item.revokedAt && item.expiresAt > now);
    if (reverse) {
      await ctx.db.patch(reverse._id, { acceptedAt: now });
      await createFriendship(ctx, userId, recipient.externalId);
      return;
    }
    const outgoing = await ctx.db.query("friendInvitations").withIndex("by_sender_created", (q) => q.eq("senderId", userId)).collect();
    if (outgoing.some((item) => item.recipientId === recipient.externalId && !item.acceptedAt && !item.declinedAt && !item.revokedAt && item.expiresAt > now)) return;
    await ctx.db.insert("friendInvitations", { externalId: crypto.randomUUID(), senderId: userId, recipientId: recipient.externalId, expiresAt: now + 14 * 24 * 60 * 60 * 1000, createdAt: now });
  },
});

export const respondFriendInvitation = internalMutation({
  args: { userId: v.string(), invitationId: v.string(), action: v.union(v.literal("accept"), v.literal("decline"), v.literal("revoke")) },
  handler: async (ctx, { userId, invitationId, action }) => {
    const invite = await ctx.db.query("friendInvitations").withIndex("by_external_id", (q) => q.eq("externalId", invitationId)).unique();
    if (!invite || invite.expiresAt <= Date.now() || invite.acceptedAt || invite.declinedAt || invite.revokedAt || (action === "revoke" ? invite.senderId !== userId : invite.recipientId !== userId)) throw new Error("That invitation is no longer available.");
    const timestamp = Date.now();
    if (action === "accept") {
      await ctx.db.patch(invite._id, { acceptedAt: timestamp });
      await createFriendship(ctx, invite.senderId, invite.recipientId);
    } else if (action === "decline") await ctx.db.patch(invite._id, { declinedAt: timestamp });
    else await ctx.db.patch(invite._id, { revokedAt: timestamp });
  },
});

export const removeFriend = internalMutation({
  args: { userId: v.string(), usernameInput: v.string() },
  handler: async (ctx, { userId, usernameInput }) => {
    const other = await userByUsername(ctx, usernameInput);
    if (!other || other.externalId === userId) throw new Error("Friend not found.");
    const [userAId, userBId] = [userId, other.externalId].sort();
    const relation = await ctx.db.query("friendships").withIndex("by_pair", (q) => q.eq("userAId", userAId).eq("userBId", userBId)).unique();
    if (!relation) throw new Error("Friend not found.");
    await ctx.db.delete(relation._id);
  },
});

export const saveOpponent = internalMutation({
  args: { userId: v.string(), usernameInput: v.string(), remove: v.boolean() },
  handler: async (ctx, { userId, usernameInput, remove }) => {
    const other = await userByUsername(ctx, usernameInput);
    if (!other || other.externalId === userId) {
      if (remove) return;
      throw new Error("That player cannot be saved.");
    }
    const existing = await ctx.db.query("savedOpponents").withIndex("by_owner_opponent", (q) => q.eq("ownerId", userId).eq("opponentId", other.externalId)).unique();
    if (remove) { if (existing) await ctx.db.delete(existing._id); return; }
    if (!existing) await ctx.db.insert("savedOpponents", { externalId: crypto.randomUUID(), ownerId: userId, opponentId: other.externalId, createdAt: Date.now() });
  },
});

export const createFriendLink = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const rows = await ctx.db.query("friendInviteLinks").withIndex("by_sender_created", (q) => q.eq("senderId", userId)).collect();
    for (const row of rows.filter((item) => item.acceptedAt || item.revokedAt || item.expiresAt <= now)) await ctx.db.delete(row._id);
    const active = rows.filter((item) => !item.acceptedAt && !item.revokedAt && item.expiresAt > now);
    if (active.length >= 10) throw new Error("Revoke an active friend link before creating another.");
    const raw = randomToken();
    const externalId = crypto.randomUUID();
    const expiresAt = now + 14 * 24 * 60 * 60 * 1000;
    await ctx.db.insert("friendInviteLinks", { externalId, senderId: userId, tokenHash: await digestToken(raw), expiresAt, createdAt: now });
    const configuredBase = process.env.WEB_APP_URL ?? process.env.ALLOWED_ORIGIN;
    const base = configuredBase && configuredBase !== "*" ? configuredBase : "http://localhost:5173";
    const url = new URL("/", base);
    const production = process.env.NODE_ENV === "production" || process.env.CONVEX_DEPLOYMENT?.startsWith("prod:") === true;
    if (!new Set(["http:", "https:"]).has(url.protocol) || (production && url.protocol !== "https:")) throw new Error("A secure application URL is required for friend links.");
    url.hash = new URLSearchParams({ "friend-invite": raw }).toString();
    return { id: externalId, url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
  },
});

export const acceptFriendLink = internalMutation({
  args: { userId: v.string(), value: v.string() },
  handler: async (ctx, { userId, value }) => {
    if (value.length < 32 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("That invitation link is unavailable.");
    const tokenHash = await digestToken(value);
    const link = await ctx.db.query("friendInviteLinks").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!link || link.senderId === userId || link.acceptedAt || link.revokedAt || link.expiresAt <= Date.now()) throw new Error("That invitation link is unavailable.");
    await ctx.db.patch(link._id, { acceptedAt: Date.now() });
    await createFriendship(ctx, link.senderId, userId);
  },
});

export const revokeFriendLink = internalMutation({
  args: { userId: v.string(), linkId: v.string() },
  handler: async (ctx, { userId, linkId }) => {
    const link = await ctx.db.query("friendInviteLinks").withIndex("by_external_id", (q) => q.eq("externalId", linkId)).unique();
    if (!link || link.senderId !== userId || link.acceptedAt || link.revokedAt || link.expiresAt <= Date.now()) throw new Error("That invitation link is unavailable.");
    await ctx.db.patch(link._id, { revokedAt: Date.now() });
  },
});

export const deleteAccount = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const user = await userById(ctx, userId);
    const now = Date.now();
    const participants = await ctx.db.query("participants").withIndex("by_user_role", (q) => q.eq("userId", userId)).collect();
    for (const participant of participants) {
      const invalidatedHash = await digestToken(randomToken());
      await ctx.db.patch(participant._id, { userId: undefined, displayName: "Deleted player", connectedAt: undefined, connectionId: undefined, disconnectedAt: now, botControlled: true, botAssisted: true, tokenHash: invalidatedHash, sessionExpiresAt: now });
    }
    for (const roomId of new Set(participants.map((participant: any) => participant.roomId))) {
      const room = await ctx.db.query("rooms").withIndex("by_external_id", (q) => q.eq("externalId", roomId)).unique();
      if (room && (room.status === "waiting" || room.status === "active") && !room.botStepScheduled) {
        const generation = (room.botStepGeneration ?? 0) + 1;
        await ctx.db.patch(room._id, { botStepScheduled: true, botStepGeneration: generation });
        await ctx.scheduler.runAfter(0, internal.rooms.runBotStep, { roomId, generation });
      }
    }
    for (const result of await ctx.db.query("gameResults").withIndex("by_winner_name", (q) => q.eq("winnerName", user.username)).collect()) await ctx.db.patch(result._id, { winnerName: "Deleted player" });
    const [sessions, tokens, stats, links, sent, incoming, asA, asB, savedOwner, savedOpponent] = await Promise.all([
      ctx.db.query("accountSessions").withIndex("by_user_expiry", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("accountTokens").withIndex("by_user_purpose_expiry", (q) => q.eq("userId", userId)).collect(),
      statsForUser(ctx, userId),
      ctx.db.query("friendInviteLinks").withIndex("by_sender_created", (q) => q.eq("senderId", userId)).collect(),
      ctx.db.query("friendInvitations").withIndex("by_sender_created", (q) => q.eq("senderId", userId)).collect(),
      ctx.db.query("friendInvitations").withIndex("by_recipient_state", (q) => q.eq("recipientId", userId)).collect(),
      ctx.db.query("friendships").withIndex("by_user_a_created", (q) => q.eq("userAId", userId)).collect(),
      ctx.db.query("friendships").withIndex("by_user_b_created", (q) => q.eq("userBId", userId)).collect(),
      ctx.db.query("savedOpponents").withIndex("by_owner_opponent", (q) => q.eq("ownerId", userId)).collect(),
      ctx.db.query("savedOpponents").withIndex("by_opponent", (q) => q.eq("opponentId", userId)).collect(),
    ]);
    for (const row of [...sessions, ...tokens, ...stats, ...links, ...sent, ...incoming, ...asA, ...asB, ...savedOwner, ...savedOpponent]) await ctx.db.delete(row._id);
    await ctx.db.delete(user._id);
  },
});
