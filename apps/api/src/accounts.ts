import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AccountGameSummary, AccountSummary, LeaderboardCategory, LeaderboardEntry, PlayerStats } from "@abominations/shared";
import type { RoomPrivacy as PrismaRoomPrivacy, RoomStatus as PrismaRoomStatus } from "../generated/prisma/enums.js";
import type { AccountToken, Prisma, PrismaClient, UserAccount } from "../generated/prisma/client.js";
import { sumPlayerStats } from "./player-stats.js";

type AccountDatabase = Pick<PrismaClient,
  "userAccount" | "accountSession" | "accountToken" | "participant" | "playerMatchStat" | "gameResult" | "$transaction"
>;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
const emailFrom = (value: string) => value.trim().toLowerCase();
const usernameFrom = () => `player-${randomBytes(4).toString("hex")}`;

const roomStatusToWire: Record<PrismaRoomStatus, AccountGameSummary["status"]> = {
  WAITING: "waiting",
  ACTIVE: "active",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
  EXPIRED: "expired",
};
const roomPrivacyToWire: Record<PrismaRoomPrivacy, AccountGameSummary["privacy"]> = {
  PRIVATE: "private",
  PUBLIC: "public",
};

function hasWinnerPlayer(summary: Prisma.JsonValue): boolean {
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) return false;
  const winnerPlayer = summary.winnerPlayer;
  return winnerPlayer !== undefined && winnerPlayer !== null;
}

function accountGameOutcome(participantId: string, winnerId: string | null, summary: Prisma.JsonValue): AccountGameSummary["outcome"] {
  if (!hasWinnerPlayer(summary)) return "tie";
  return winnerId === participantId ? "win" : "loss";
}

export interface AccountEmail {
  to: string;
  subject: string;
  text: string;
}

export interface AccountActionResult {
  account?: AccountSummary;
  sessionToken?: string;
  message: string;
  developmentLink?: string;
}

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function passwordMatches(password: string, encoded: string): boolean {
  const [algorithm, n, r, p, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !keyText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function publicAccount(user: Pick<UserAccount, "id" | "username" | "emailVerifiedAt">): AccountSummary {
  return { id: user.id, username: user.username, emailVerified: Boolean(user.emailVerifiedAt) };
}

export class AccountService {
  constructor(
    private readonly prisma: AccountDatabase,
    private readonly sendEmail: (message: AccountEmail) => Promise<void> = deliverAccountEmail,
    private readonly now: () => Date = () => new Date(),
    private readonly production = process.env.NODE_ENV === "production",
  ) {}

  async register(emailInput: string, password: string): Promise<AccountActionResult> {
    const email = emailFrom(emailInput);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
    if (password.length < 12 || password.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    let user: UserAccount | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        user = await this.prisma.userAccount.create({ data: { email, passwordHash: passwordHash(password), username: usernameFrom() } });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        const exists = await this.prisma.userAccount.findUnique({ where: { email } });
        if (exists) throw new Error("An account with that email already exists.");
      }
    }
    if (!user) throw new Error("Could not create an account. Try again.");
    const link = await this.createActionToken(user, "EMAIL_VERIFICATION", VERIFY_TTL_MS, "Verify your Abominations Attack America account", "verify-email");
    return { account: publicAccount(user), message: "Check your email for a verification link.", ...(link ? { developmentLink: link } : {}) };
  }

  async login(emailInput: string, password: string): Promise<AccountActionResult> {
    const email = emailFrom(emailInput);
    const user = await this.prisma.userAccount.findUnique({ where: { email } });
    if (!user || !passwordMatches(password, user.passwordHash)) throw new Error("Email or password is incorrect.");
    if (!user.emailVerifiedAt) throw new Error("Verify your email before signing in.");
    return { account: publicAccount(user), sessionToken: await this.issueSession(user.id), message: "Signed in." };
  }

  async verifyEmail(rawToken: string): Promise<AccountActionResult> {
    const record = await this.findActionToken(rawToken, "EMAIL_VERIFICATION");
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const consumed = await tx.accountToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: this.now() } }, data: { consumedAt: this.now() } });
      if (consumed.count !== 1) throw new Error("This verification link is expired or has already been used.");
      await tx.userAccount.update({ where: { id: record.userId }, data: { emailVerifiedAt: this.now() } });
    });
    return { account: publicAccount({ ...record.user, emailVerifiedAt: this.now() }), sessionToken: await this.issueSession(record.userId), message: "Email verified." };
  }

  async resendVerification(emailInput: string): Promise<AccountActionResult> {
    const email = emailFrom(emailInput);
    const user = await this.prisma.userAccount.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const link = await this.createActionToken(user, "EMAIL_VERIFICATION", VERIFY_TTL_MS, "Verify your Abominations Attack America account", "verify-email");
      return { message: "If the account needs verification, a link has been sent.", ...(link ? { developmentLink: link } : {}) };
    }
    return { message: "If the account needs verification, a link has been sent." };
  }

  async requestPasswordReset(emailInput: string): Promise<AccountActionResult> {
    const user = await this.prisma.userAccount.findUnique({ where: { email: emailFrom(emailInput) } });
    if (user) {
      const link = await this.createActionToken(user, "PASSWORD_RESET", RESET_TTL_MS, "Reset your Abominations Attack America password", "reset-password");
      return { message: "If an account exists for that email, a reset link has been sent.", ...(link ? { developmentLink: link } : {}) };
    }
    return { message: "If an account exists for that email, a reset link has been sent." };
  }

  async completePasswordReset(rawToken: string, newPassword: string): Promise<AccountActionResult> {
    if (newPassword.length < 12 || newPassword.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    const record = await this.findActionToken(rawToken, "PASSWORD_RESET");
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const consumed = await tx.accountToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: this.now() } }, data: { consumedAt: this.now() } });
      if (consumed.count !== 1) throw new Error("This reset link is expired or has already been used.");
      await tx.userAccount.update({ where: { id: record.userId }, data: { passwordHash: passwordHash(newPassword) } });
      await tx.accountSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: this.now() } });
    });
    return { message: "Password reset. Sign in with your new password." };
  }

  async authenticate(sessionToken: string): Promise<UserAccount | null> {
    if (!sessionToken) return null;
    const session = await this.prisma.accountSession.findUnique({ where: { tokenHash: hash(sessionToken) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= this.now() || !session.user.emailVerifiedAt) return null;
    return session.user;
  }

  async logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    await this.prisma.accountSession.updateMany({ where: { tokenHash: hash(sessionToken), revokedAt: null }, data: { revokedAt: this.now() } });
  }

  async updateUsername(userId: string, usernameInput: string): Promise<AccountSummary> {
    const username = usernameInput.trim().toLowerCase();
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) throw new Error("Username must be 3–24 letters, numbers, hyphens, or underscores.");
    try {
      const user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.userAccount.findUnique({ where: { id: userId }, select: { username: true } });
        if (!current) throw new Error("Account not found.");
        const updated = await tx.userAccount.update({ where: { id: userId }, data: { username } });
        await tx.participant.updateMany({ where: { userId }, data: { displayName: username } });
        await tx.playerMatchStat.updateMany({ where: { userId }, data: { username } });
        await tx.gameResult.updateMany({ where: { winnerName: current.username }, data: { winnerName: username } });
        return updated;
      });
      return publicAccount(user);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new Error("That username is already in use.");
      throw error;
    }
  }

  async deleteAccount(user: Pick<UserAccount, "id" | "username">): Promise<void> {
    const linked = await this.prisma.participant.findMany({ where: { userId: user.id }, select: { id: true, roomId: true } });
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const participant of linked) {
        await tx.participant.update({ where: { id: participant.id }, data: {
          userId: null,
          displayName: "Deleted player",
          connectedAt: null,
          connectionId: null,
          disconnectedAt: this.now(),
          botControlled: true,
          botAssisted: true,
          tokenHash: hash(randomToken()),
          sessionExpiresAt: this.now(),
        } });
      }
      await tx.gameResult.updateMany({ where: { winnerName: user.username }, data: { winnerName: "Deleted player" } });
      await tx.userAccount.delete({ where: { id: user.id } });
    });
  }

  async listGames(userId: string): Promise<AccountGameSummary[]> {
    const participants = await this.prisma.participant.findMany({
      where: { userId, role: "PLAYER", room: { isTest: false } },
      include: { room: { include: { result: true } } },
      orderBy: { createdAt: "desc" },
    });
    return participants.map((participant) => ({
      roomId: participant.roomId,
      code: participant.room.code,
      status: roomStatusToWire[participant.room.status],
      privacy: roomPrivacyToWire[participant.room.privacy],
      playerIndex: participant.playerIndex ?? 0,
      displayName: participant.displayName,
      botControlled: participant.botControlled,
      botAssisted: participant.botAssisted,
      ...(participant.room.completedAt ? { completedAt: participant.room.completedAt.toISOString() } : {}),
      ...(participant.room.result ? { outcome: accountGameOutcome(participant.id, participant.room.result.winnerId, participant.room.result.summary) } : {}),
    }));
  }

  async getStats(userId: string): Promise<PlayerStats> {
    const user = await this.prisma.userAccount.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user) throw new Error("Account not found.");
    const rows = await this.prisma.playerMatchStat.findMany({ where: { userId }, orderBy: { completedAt: "desc" } });
    return sumPlayerStats(rows, user.username);
  }

  async publicProfile(usernameInput: string) {
    const username = usernameInput.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({ where: { username }, select: { id: true, username: true } });
    if (!user) throw new Error("Player not found.");
    const rows = await this.prisma.playerMatchStat.findMany({ where: { userId: user.id }, orderBy: { completedAt: "desc" } });
    return { ...sumPlayerStats(rows, user.username), botAssistedMatches: rows.filter((row) => row.botAssisted).length };
  }

  async leaderboard(category: LeaderboardCategory): Promise<LeaderboardEntry[]> {
    const users = await this.prisma.userAccount.findMany({ include: { matchStats: true } });
    const entries: Array<LeaderboardEntry & { categoryValue: number }> = [];
    for (const user of users) {
      const stats = sumPlayerStats(user.matchStats, user.username);
      if (category === "win-rate" && stats.gamesPlayed < 5) continue;
      if (category === "luck" && stats.luckRolls < 20) continue;
      const value = category === "wins" ? stats.wins
        : category === "win-rate" ? stats.winRate
          : category === "stomped-tiles" ? stats.stompedTiles
            : category === "damage-taken" ? stats.damageTaken
              : category === "health-gained" ? stats.healthGained
                : stats.luckAverage ?? 0;
      entries.push({ ...stats, rank: 0, value, categoryValue: value });
    }
    entries.sort((left, right) => right.categoryValue - left.categoryValue || right.wins - left.wins || left.username.localeCompare(right.username));
    return entries.slice(0, 100).map(({ categoryValue: _categoryValue, ...entry }, index) => ({ ...entry, rank: index + 1 }));
  }

  private async issueSession(userId: string): Promise<string> {
    const sessionToken = randomToken();
    await this.prisma.accountSession.create({ data: { userId, tokenHash: hash(sessionToken), expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS) } });
    return sessionToken;
  }

  private async createActionToken(user: Pick<UserAccount, "id" | "email">, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttl: number, subject: string, path: string): Promise<string | undefined> {
    const value = randomToken();
    const expiresAt = new Date(this.now().getTime() + ttl);
    await this.prisma.accountToken.create({ data: { userId: user.id, tokenHash: hash(value), purpose, expiresAt } });
    const base = process.env.WEB_APP_URL ?? process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
    const link = `${base.replace(/\/$/, "")}/?${path}=${encodeURIComponent(value)}`;
    await this.sendEmail({ to: user.email, subject, text: `Use this link to continue: ${link}\n\nThis link expires at ${expiresAt.toISOString()}.` });
    return this.production ? undefined : link;
  }

  private async findActionToken(value: string, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET"): Promise<AccountToken & { user: UserAccount }> {
    if (!value || value.length > 160) throw new Error("This account link is invalid.");
    const record = await this.prisma.accountToken.findUnique({ where: { tokenHash: hash(value) }, include: { user: true } });
    if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt <= this.now()) throw new Error("This account link is expired or has already been used.");
    return record;
  }
}

export async function deliverAccountEmail(message: AccountEmail): Promise<void> {
  const endpoint = process.env.ACCOUNT_EMAIL_DELIVERY_URL;
  if (!endpoint) {
    if (process.env.NODE_ENV === "production") throw new Error("Account email delivery is not configured.");
    return;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ACCOUNT_EMAIL_DELIVERY_TOKEN ? { authorization: `Bearer ${process.env.ACCOUNT_EMAIL_DELIVERY_TOKEN}` } : {}) },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Account email could not be delivered.");
}

export const accountSessionCookie = (token: string, secure = process.env.NODE_ENV === "production") => `aaa_account=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
export const clearAccountSessionCookie = (secure = process.env.NODE_ENV === "production") => `aaa_account=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
export const sessionFromCookie = (header = "") => header.split(";").map((part) => part.trim()).find((part) => part.startsWith("aaa_account="))?.slice("aaa_account=".length) ?? "";
