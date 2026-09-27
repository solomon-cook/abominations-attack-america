import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "./accounts.js";

function accountDatabase() {
  const users = new Map<string, any>();
  const tokens = new Map<string, any>();
  const sessions = new Map<string, any>();
  const participants = new Map<string, any>([["seat-1", { id: "seat-1", roomId: "room-1", userId: "user-1", displayName: "public-name", connectedAt: new Date(), botControlled: false, botAssisted: false }]]);
  const stats = new Map<string, any>([["stat-1", { id: "stat-1", userId: "user-1", roomId: "room-1" }]]);
  const results = new Map<string, any>([["result-1", { winnerName: "public-name" }]]);
  let sequence = 0;
  const duplicate = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const db: any = {
    userAccount: {
      create: async ({ data }: any) => {
        if ([...users.values()].some((user) => user.email === data.email || user.username === data.username)) throw duplicate();
        const user = { id: `user-${++sequence}`, createdAt: new Date(), ...data };
        users.set(user.id, user);
        return user;
      },
      findUnique: async ({ where, select }: any) => {
        const user = [...users.values()].find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        if (!user) return null;
        return select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, user[key]])) : { ...user };
      },
      update: async ({ where, data }: any) => {
        const user = users.get(where.id);
        if (!user) throw new Error("Account not found.");
        if (data.username && [...users.values()].some((other) => other.id !== user.id && other.username === data.username)) throw duplicate();
        Object.assign(user, data);
        return user;
      },
      delete: async ({ where }: any) => { const user = users.get(where.id); users.delete(where.id); for (const [id, row] of stats) if (row.userId === where.id) stats.delete(id); return user; },
    },
    accountToken: {
      create: async ({ data }: any) => { const row = { id: `token-${++sequence}`, consumedAt: null, ...data }; tokens.set(row.tokenHash, row); return row; },
      findUnique: async ({ where }: any) => { const row = tokens.get(where.tokenHash); return row ? { ...row, user: users.get(row.userId) } : null; },
      updateMany: async ({ where, data }: any) => { const row = [...tokens.values()].find((item) => item.id === where.id && item.consumedAt === where.consumedAt && item.expiresAt > where.expiresAt.gt); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
    accountSession: {
      create: async ({ data }: any) => { const row = { id: `session-${++sequence}`, revokedAt: null, ...data }; sessions.set(row.tokenHash, row); return row; },
      findUnique: async ({ where }: any) => { const row = sessions.get(where.tokenHash); const user = row && users.get(row.userId); return row ? { ...row, user } : null; },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of sessions.values()) if (row.userId === where.userId || row.tokenHash === where.tokenHash) { if (where.revokedAt !== undefined && row.revokedAt !== where.revokedAt) continue; Object.assign(row, data); count += 1; } return { count }; },
    },
    participant: {
      findMany: async ({ where }: any) => [...participants.values()].filter((row) => row.userId === where.userId),
      update: async ({ where, data }: any) => { const row = participants.get(where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of participants.values()) if (row.userId === where.userId) { Object.assign(row, data); count += 1; } return { count }; },
    },
    playerMatchStat: {
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of stats.values()) if (row.userId === where.userId) { Object.assign(row, data); count += 1; } return { count }; },
    },
    gameResult: { updateMany: async ({ where, data }: any) => { let count = 0; for (const row of results.values()) if (row.winnerName === where.winnerName) { Object.assign(row, data); count += 1; } return { count }; } },
    $transaction: async (operation: any) => typeof operation === "function" ? operation(db) : Promise.all(operation),
  };
  return { db, users, sessions, participants, stats, results };
}

test("account credentials stay private while verification, reset, username, logout, and deletion work", async () => {
  const fixture = accountDatabase();
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  let now = new Date("2026-09-27T10:00:00Z");
  const service = new AccountService(fixture.db, async (email) => { sent.push(email); }, () => now, false);
  const email = "private@example.test";
  const password = "correct horse battery staple";
  const registration = await service.register(email, password);
  assert.ok(registration.account?.username.startsWith("player-"));
  assert.equal(JSON.stringify(registration).includes(email), false);
  assert.equal(JSON.stringify(registration).includes(password), false);
  const storedUser = [...fixture.users.values()][0]!;
  fixture.results.get("result-1")!.winnerName = storedUser.username;
  assert.match(storedUser.passwordHash, /^scrypt\$32768\$/);
  assert.notEqual(storedUser.passwordHash, password);
  assert.equal(sent[0]?.to, email);

  await assert.rejects(() => service.login(email, password), /Verify your email/);
  const verificationToken = new URL(registration.developmentLink!).searchParams.get("verify-email")!;
  const verified = await service.verifyEmail(verificationToken);
  assert.equal(verified.account?.emailVerified, true);
  assert.ok(await service.authenticate(verified.sessionToken!));
  await assert.rejects(() => service.verifyEmail(verificationToken), /expired or has already been used/);

  const login = await service.login(email, password);
  assert.equal(login.account?.emailVerified, true);
  assert.equal(JSON.stringify(login.account).includes(email), false);
  await assert.rejects(() => service.login(email, "wrong password"), /Email or password is incorrect/);

  await service.register("another@example.test", "another correct horse battery");
  const secondUser = [...fixture.users.values()].find((user) => user.email === "another@example.test")!;
  await service.updateUsername(secondUser.id, "other-public-name");
  await assert.rejects(() => service.updateUsername(storedUser.id, "other-public-name"), /already in use/);
  const renamed = await service.updateUsername(storedUser.id, "new_public_name");
  assert.equal(renamed.username, "new_public_name");
  assert.equal(fixture.participants.get("seat-1")?.displayName, "new_public_name");
  assert.equal(fixture.results.get("result-1")?.winnerName, "new_public_name");

  const reset = await service.requestPasswordReset(email);
  const resetToken = new URL(reset.developmentLink!).searchParams.get("reset-password")!;
  await service.completePasswordReset(resetToken, "a newer safer password");
  assert.equal(await service.authenticate(login.sessionToken!), null);
  assert.ok((await service.login(email, "a newer safer password")).sessionToken);

  await service.logout(verified.sessionToken!);
  assert.equal(await service.authenticate(verified.sessionToken!), null);
  await service.deleteAccount(storedUser);
  assert.equal(fixture.users.has(storedUser.id), false);
  assert.equal(fixture.stats.size, 0);
  assert.equal(fixture.participants.get("seat-1")?.userId, null);
  assert.equal(fixture.participants.get("seat-1")?.botControlled, true);
  assert.equal(fixture.results.get("result-1")?.winnerName, "Deleted player");
  now = new Date("2026-09-28T10:00:00Z");
});
