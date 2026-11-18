import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

export const userByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => ctx.db.query("userAccounts").withIndex("by_email", (q) => q.eq("email", email)).unique(),
});

export const userByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => ctx.db.query("userAccounts").withIndex("by_username", (q) => q.eq("username", username)).unique(),
});

export const userBySessionHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("accountSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.revokedAt || session.expiresAt <= Date.now()) return null;
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", session.userId)).unique();
    return user ?? null;
  },
});

export const actionToken = internalQuery({
  args: { tokenHash: v.string(), purpose: v.union(v.literal("EMAIL_VERIFICATION"), v.literal("PASSWORD_RESET")) },
  handler: async (ctx, { tokenHash, purpose }) => {
    const token = await ctx.db.query("accountTokens").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!token || token.purpose !== purpose || token.consumedAt || token.expiresAt <= Date.now()) return null;
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", token.userId)).unique();
    return user ? { token, user } : null;
  },
});

export const createUser = internalMutation({
  args: { email: v.optional(v.string()), passwordHash: v.string(), username: v.string(), tokenHash: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (args.email && await ctx.db.query("userAccounts").withIndex("by_email", (q) => q.eq("email", args.email)).unique()) throw new Error("An account with that email already exists.");
    if (await ctx.db.query("userAccounts").withIndex("by_username", (q) => q.eq("username", args.username)).unique()) throw new Error("That username is already in use.");
    const timestamp = Date.now();
    const externalId = crypto.randomUUID();
    await ctx.db.insert("userAccounts", {
      externalId, ...(args.email ? { email: args.email } : {}), passwordHash: args.passwordHash, username: args.username,
      publicStatsEnabled: true, presenceEnabled: false,
      createdAt: timestamp, updatedAt: timestamp,
    });
    if (args.tokenHash && args.tokenExpiresAt) await ctx.db.insert("accountTokens", { externalId: crypto.randomUUID(), userId: externalId, tokenHash: args.tokenHash, purpose: "EMAIL_VERIFICATION", expiresAt: args.tokenExpiresAt, createdAt: timestamp });
    return { id: externalId, username: args.username, ...(args.email ? { email: args.email } : {}) };
  },
});

export const issueSession = internalMutation({
  args: { userId: v.string(), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("accountSessions", { externalId: crypto.randomUUID(), userId: args.userId, tokenHash: args.tokenHash, expiresAt: args.expiresAt, createdAt: Date.now() });
  },
});

export const createActionToken = internalMutation({
  args: { userId: v.string(), tokenHash: v.string(), purpose: v.union(v.literal("EMAIL_VERIFICATION"), v.literal("PASSWORD_RESET")), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("accountTokens", { externalId: crypto.randomUUID(), ...args, createdAt: Date.now() });
  },
});

export const verifyToken = internalMutation({
  args: { externalId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db.query("accountTokens").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique();
    if (!token || token.consumedAt || token.expiresAt <= Date.now()) throw new Error("This verification link is expired or has already been used.");
    await ctx.db.patch(token._id, { consumedAt: Date.now() });
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", args.userId)).unique();
    if (!user) throw new Error("Account not found.");
    await ctx.db.patch(user._id, { emailVerifiedAt: Date.now(), updatedAt: Date.now() });
    return { id: user.externalId, username: user.username };
  },
});

export const resetPassword = internalMutation({
  args: { externalId: v.string(), userId: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db.query("accountTokens").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique();
    if (!token || token.consumedAt || token.expiresAt <= Date.now()) throw new Error("This reset link is expired or has already been used.");
    await ctx.db.patch(token._id, { consumedAt: Date.now() });
    const user = await ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", args.userId)).unique();
    if (!user) throw new Error("Account not found.");
    await ctx.db.patch(user._id, { passwordHash: args.passwordHash, updatedAt: Date.now() });
    const sessions = await ctx.db.query("accountSessions").withIndex("by_user_expiry", (q) => q.eq("userId", args.userId)).collect();
    await Promise.all(sessions.filter((session) => !session.revokedAt).map((session) => ctx.db.patch(session._id, { revokedAt: Date.now() })));
  },
});

export const logout = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("accountSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (session && !session.revokedAt) await ctx.db.patch(session._id, { revokedAt: Date.now() });
  },
});
