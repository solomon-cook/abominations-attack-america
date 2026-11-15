"use node";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 60 * 60 * 1000;
const isProduction = () => process.env.APP_ENV === "production" || process.env.NODE_ENV === "production" || process.env.CONVEX_DEPLOYMENT?.startsWith("prod:") === true;
const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const passwordHash = (password: string) => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
};
const passwordMatches = (password: string, encoded: string) => {
  const [algorithm, n, r, p, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !keyText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
};

async function sendActionEmail(to: string, subject: string, link: string, expiresAt: number) {
  const endpoint = process.env.ACCOUNT_EMAIL_DELIVERY_URL;
  if (!endpoint) {
    if (isProduction()) throw new Error("Account email delivery is not configured.");
    return;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ACCOUNT_EMAIL_DELIVERY_TOKEN ? { authorization: `Bearer ${process.env.ACCOUNT_EMAIL_DELIVERY_TOKEN}` } : {}) },
    body: JSON.stringify({ to, subject, text: `Use this link to continue: ${link}\n\nThis link expires at ${new Date(expiresAt).toISOString()}.` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Account email could not be delivered.");
}

async function createAndSendToken(ctx: any, user: any, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
  const raw = token();
  const expiresAt = Date.now() + (purpose === "EMAIL_VERIFICATION" ? VERIFY_TTL : RESET_TTL);
  await ctx.runMutation(internal.accounts.createActionToken, { userId: user.externalId, tokenHash: hash(raw), purpose, expiresAt });
  const path = purpose === "EMAIL_VERIFICATION" ? "verify-email" : "reset-password";
  const base = process.env.WEB_APP_URL ?? process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
  const link = `${base.replace(/\/$/, "")}/?${path}=${encodeURIComponent(raw)}`;
  if (!user.email) throw new Error("An email address is required for this account link.");
  await sendActionEmail(user.email, purpose === "EMAIL_VERIFICATION" ? "Verify your Abominations Attack America account" : "Reset your Abominations Attack America password", link, expiresAt);
  return isProduction() ? undefined : link;
}

export const register = internalAction({
  args: { usernameInput: v.optional(v.string()), emailInput: v.optional(v.string()), password: v.string() },
  handler: async (ctx, { usernameInput, emailInput, password }): Promise<{ account: { id: string; username: string; emailVerified: boolean }; sessionToken?: string; message: string; developmentLink?: string }> => {
    if (password.length < 12 || password.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    const legacyEmail = usernameInput === undefined;
    let email: string | undefined;
    let username: string;
    if (legacyEmail) {
      email = (emailInput ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
      if (await ctx.runQuery(internal.accounts.userByEmail, { email })) throw new Error("An account with that email already exists.");
      username = `player-${randomBytes(4).toString("hex")}`;
    } else {
      username = (usernameInput ?? "").trim().toLowerCase();
      if (!/^[a-z0-9_-]{3,24}$/.test(username)) throw new Error("Username must be 3–24 letters, numbers, hyphens, or underscores.");
      if (await ctx.runQuery(internal.accounts.userByUsername, { username })) throw new Error("That username is already in use.");
    }
    const verificationToken = legacyEmail ? token() : undefined;
    const expiresAt = Date.now() + VERIFY_TTL;
    const user = await ctx.runMutation(internal.accounts.createUser, { ...(email ? { email } : {}), passwordHash: passwordHash(password), username, ...(verificationToken ? { tokenHash: hash(verificationToken), tokenExpiresAt: expiresAt } : {}) });
    if (legacyEmail && email && verificationToken) {
      const base = process.env.WEB_APP_URL ?? process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
      const link = `${base.replace(/\/$/, "")}/?verify-email=${encodeURIComponent(verificationToken)}`;
      await sendActionEmail(email, "Verify your Abominations Attack America account", link, expiresAt);
      return { account: { id: user.id, username: user.username, emailVerified: false }, message: "Check your email for a verification link.", ...(isProduction() ? {} : { developmentLink: link }) };
    }
    const sessionToken = token();
    await ctx.runMutation(internal.accounts.issueSession, { userId: user.id, tokenHash: hash(sessionToken), expiresAt: Date.now() + SESSION_TTL });
    return { account: { id: user.id, username: user.username, emailVerified: false }, sessionToken, message: "Account created and signed in." };
  },
});

export const login = internalAction({
  args: { usernameInput: v.optional(v.string()), emailInput: v.optional(v.string()), password: v.string() },
  handler: async (ctx, { usernameInput, emailInput, password }): Promise<{ account: { id: string; username: string; emailVerified: boolean }; sessionToken: string; message: string }> => {
    const loginInput = (usernameInput ?? emailInput ?? "").trim().toLowerCase();
    const user = await ctx.runQuery(internal.accounts.userByUsername, { username: loginInput }) ?? await ctx.runQuery(internal.accounts.userByEmail, { email: loginInput });
    if (!user || !passwordMatches(password, user.passwordHash)) throw new Error("Username or password is incorrect.");
    const sessionToken = token();
    await ctx.runMutation(internal.accounts.issueSession, { userId: user.externalId, tokenHash: hash(sessionToken), expiresAt: Date.now() + SESSION_TTL });
    return { account: { id: user.externalId, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) }, sessionToken, message: "Signed in." };
  },
});

export const verifyEmail = internalAction({
  args: { value: v.string() },
  handler: async (ctx, { value }): Promise<{ account: { id: string; username: string; emailVerified: true }; sessionToken: string; message: string }> => {
    if (!value || value.length > 160) throw new Error("This account link is invalid.");
    const record = await ctx.runQuery(internal.accounts.actionToken, { tokenHash: hash(value), purpose: "EMAIL_VERIFICATION" });
    if (!record) throw new Error("This verification link is expired or has already been used.");
    const user = await ctx.runMutation(internal.accounts.verifyToken, { externalId: record.token.externalId, userId: record.user.externalId });
    const sessionToken = token();
    await ctx.runMutation(internal.accounts.issueSession, { userId: user.id, tokenHash: hash(sessionToken), expiresAt: Date.now() + SESSION_TTL });
    return { account: { ...user, emailVerified: true }, sessionToken, message: "Email verified." };
  },
});

export const resendVerification = internalAction({
  args: { emailInput: v.string() },
  handler: async (ctx, { emailInput }) => {
    const user = await ctx.runQuery(internal.accounts.userByEmail, { email: emailInput.trim().toLowerCase() });
    let developmentLink: string | undefined;
    if (user && !user.emailVerifiedAt) developmentLink = await createAndSendToken(ctx, user, "EMAIL_VERIFICATION");
    return { message: "If the account needs verification, a link has been sent.", ...(developmentLink ? { developmentLink } : {}) };
  },
});

export const requestPasswordReset = internalAction({
  args: { emailInput: v.string() },
  handler: async (ctx, { emailInput }) => {
    const user = await ctx.runQuery(internal.accounts.userByEmail, { email: emailInput.trim().toLowerCase() });
    let developmentLink: string | undefined;
    if (user) developmentLink = await createAndSendToken(ctx, user, "PASSWORD_RESET");
    return { message: "If an account exists for that email, a reset link has been sent.", ...(developmentLink ? { developmentLink } : {}) };
  },
});

export const completePasswordReset = internalAction({
  args: { value: v.string(), password: v.string() },
  handler: async (ctx, { value, password }) => {
    if (password.length < 12 || password.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    if (!value || value.length > 160) throw new Error("This account link is invalid.");
    const record = await ctx.runQuery(internal.accounts.actionToken, { tokenHash: hash(value), purpose: "PASSWORD_RESET" });
    if (!record) throw new Error("This reset link is expired or has already been used.");
    await ctx.runMutation(internal.accounts.resetPassword, { externalId: record.token.externalId, userId: record.user.externalId, passwordHash: passwordHash(password) });
    return { message: "Password reset. Sign in with your new password." };
  },
});

export const logout = internalAction({
  args: { value: v.string() },
  handler: async (ctx, { value }): Promise<any> => {
    if (value) await ctx.runMutation(internal.accounts.logout, { tokenHash: hash(value) });
  },
});

export const authenticate = internalAction({
  args: { value: v.string() },
  handler: async (ctx, { value }): Promise<any> => {
    if (!value) return null;
    return await ctx.runQuery(internal.accounts.userBySessionHash, { tokenHash: hash(value) });
  },
});
