import assert from "node:assert/strict";
import test from "node:test";
import { AccountService } from "./accounts.js";

function socialDatabase() {
  const users = [
    { id: "user-a", username: "alpha", email: "alpha@private.test", presenceEnabled: false, presenceExpiresAt: null },
    { id: "user-b", username: "bravo", email: "bravo@private.test", presenceEnabled: false, presenceExpiresAt: null },
    { id: "user-c", username: "charlie", email: "charlie@private.test", presenceEnabled: false, presenceExpiresAt: null },
  ];
  const invitations: any[] = [];
  const inviteLinks: any[] = [];
  const friendships: any[] = [];
  const saved: any[] = [];
  let sequence = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR && !where.OR.some((part: any) => matches(row, part))) return false;
    return Object.entries(where).every(([key, expected]: [string, any]) => {
      if (key === "OR") return true;
      if ((key === "expiresAt" || key === "presenceExpiresAt") && expected.gt) return row[key] > expected.gt;
      if ((key === "expiresAt" || key === "presenceExpiresAt") && expected.lte) return row[key] !== null && row[key] <= expected.lte;
      if (expected && typeof expected === "object" && "not" in expected) return row[key] !== expected.not;
      if (expected && typeof expected === "object" && !(expected instanceof Date)) return matches(row[key], expected);
      return row[key] === expected;
    });
  };
  const userById = (id: string) => users.find((user) => user.id === id)!;
  const db: any = {
    userAccount: {
      findUnique: async ({ where, select }: any) => {
        const user = users.find((candidate) => matches(candidate, where));
        if (!user) return null;
        return select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, user[key as keyof typeof user]])) : { ...user };
      },
      update: async ({ where, data }: any) => {
        const user = userById(where.id);
        Object.assign(user, data);
        return user;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const user of users) if (matches(user, where)) { Object.assign(user, data); count += 1; }
        return { count };
      },
    },
    friendInvitation: {
      findFirst: async ({ where }: any) => invitations.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, include, orderBy }: any) => {
        const rows = invitations.filter((row) => matches(row, where)).slice();
        if (orderBy?.createdAt === "desc") rows.reverse();
        return rows.map((row) => ({ ...row, ...(include?.sender ? { sender: { username: userById(row.senderId).username } } : {}), ...(include?.recipient ? { recipient: { username: userById(row.recipientId).username } } : {}) }));
      },
      create: async ({ data }: any) => {
        const row = { id: `invite-${++sequence}`, createdAt: new Date(), acceptedAt: null, declinedAt: null, revokedAt: null, ...data };
        invitations.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of invitations) if (matches(row, where)) { Object.assign(row, data); count += 1; }
        return { count };
      },
    },
    friendInviteLink: {
      findUnique: async ({ where }: any) => inviteLinks.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, select }: any) => inviteLinks.filter((row) => matches(row, where)).map((row) => select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]])) : row),
      create: async ({ data }: any) => { const row = { id: `friend-link-${++sequence}`, acceptedAt: null, revokedAt: null, createdAt: new Date(), ...data }; inviteLinks.push(row); return row; },
      count: async ({ where }: any) => inviteLinks.filter((row) => matches(row, where)).length,
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of inviteLinks) if (matches(row, where)) { Object.assign(row, data); count += 1; } return { count }; },
      deleteMany: async ({ where }: any) => { let count = 0; for (let index = inviteLinks.length - 1; index >= 0; index -= 1) if (matches(inviteLinks[index], where)) { inviteLinks.splice(index, 1); count += 1; } return { count }; },
    },
    friendship: {
      findUnique: async ({ where }: any) => friendships.find((row) => matches(row, where.userAId_userBId)) ?? null,
      findMany: async ({ where }: any) => friendships.filter((row) => matches(row, where)).map((row) => ({ ...row, userA: { ...userById(row.userAId) }, userB: { ...userById(row.userBId) } })),
      create: async ({ data }: any) => {
        if (friendships.some((row) => row.userAId === data.userAId && row.userBId === data.userBId)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const row = { id: `friend-${++sequence}`, createdAt: new Date(), ...data };
        friendships.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const index = friendships.findIndex((row) => matches(row, where));
        if (index < 0) return { count: 0 };
        friendships.splice(index, 1);
        return { count: 1 };
      },
    },
    savedOpponent: {
      findMany: async ({ where, include }: any) => saved.filter((row) => matches(row, where)).map((row) => ({ ...row, ...(include?.opponent ? { opponent: { username: userById(row.opponentId).username } } : {}) })),
      upsert: async ({ where, create }: any) => {
        const key = where.ownerId_opponentId;
        let row = saved.find((candidate) => candidate.ownerId === key.ownerId && candidate.opponentId === key.opponentId);
        if (!row) { row = { createdAt: new Date(), ...create }; saved.push(row); }
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const index = saved.findIndex((row) => matches(row, where));
        if (index < 0) return { count: 0 };
        saved.splice(index, 1);
        return { count: 1 };
      },
    },
    $transaction: async (operation: any) => typeof operation === "function" ? operation(db) : Promise.all(operation),
  };
  return { db, users, invitations, inviteLinks, friendships, saved };
}

test("friend invitations are recipient-owned, accept into mutual friends, and expire", async () => {
  const fixture = socialDatabase();
  let now = new Date("2026-10-10T10:00:00.000Z");
  const service = new AccountService(fixture.db, async () => {}, () => now, false);
  await service.sendFriendInvitation("user-a", "BRAVO");
  await service.sendFriendInvitation("user-a", "bravo");
  assert.equal(fixture.invitations.length, 1);
  const invite = (await service.socialSummary("user-b")).incoming[0]!;
  assert.equal(invite.username, "alpha");
  assert.equal(JSON.stringify(await service.socialSummary("user-b")).includes("@private.test"), false);
  await assert.rejects(() => service.acceptFriendInvitation("user-a", invite.id), /no longer available/);
  await service.acceptFriendInvitation("user-b", invite.id);
  assert.equal(fixture.friendships.length, 1);
  assert.equal((await service.socialSummary("user-a")).friends[0]?.username, "bravo");
  await assert.rejects(() => service.acceptFriendInvitation("user-b", invite.id), /no longer available/);

  await service.sendFriendInvitation("user-a", "charlie");
  now = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  assert.equal((await service.socialSummary("user-c")).incoming.length, 0);
});

test("friend invitations reject self-invites and do not disclose unknown accounts", async () => {
  const fixture = socialDatabase();
  const service = new AccountService(fixture.db, async () => {}, () => new Date("2026-10-10T10:00:00.000Z"), false);
  await assert.rejects(() => service.sendFriendInvitation("user-a", "alpha"), /cannot be invited/);
  await assert.rejects(() => service.sendFriendInvitation("user-a", "not-a-player"), /cannot be invited/);
  assert.equal(fixture.invitations.length, 0);
});

test("reciprocal friend requests accept once and friend presence is opt-in and expires", async () => {
  const fixture = socialDatabase();
  let now = new Date("2026-10-10T10:00:00.000Z");
  const service = new AccountService(fixture.db, async () => {}, () => now, false);
  await service.sendFriendInvitation("user-a", "bravo");
  await service.sendFriendInvitation("user-b", "alpha");
  assert.equal(fixture.friendships.length, 1);
  assert.ok(fixture.invitations[0]?.acceptedAt instanceof Date);
  await service.sendFriendInvitation("user-a", "bravo");
  assert.equal(fixture.friendships.length, 1);

  assert.equal((await service.socialSummary("user-a")).friends[0]?.online, false);
  await service.setPresence("user-b", true);
  assert.equal((await service.socialSummary("user-a")).friends[0]?.online, true);
  now = new Date(now.getTime() + 91_000);
  assert.equal((await service.socialSummary("user-a")).friends[0]?.online, false);
  await service.setPresence("user-b", false);
  assert.equal(fixture.users[1]?.presenceExpiresAt, null);
});

test("presence heartbeats cap database refreshes at one write per fifteen seconds per account", async () => {
  const fixture = socialDatabase();
  let now = new Date("2026-10-10T10:00:00.000Z");
  const service = new AccountService(fixture.db, async () => {}, () => now, false);
  await service.setPresence("user-b", true);
  const initialExpiry = fixture.users[1]?.presenceExpiresAt;

  await service.refreshPresence("user-b");
  assert.equal(fixture.users[1]?.presenceExpiresAt, initialExpiry, "immediate duplicate heartbeat does not write");

  now = new Date(now.getTime() + 14_999);
  await service.refreshPresence("user-b");
  assert.equal(fixture.users[1]?.presenceExpiresAt, initialExpiry, "heartbeat before the cooldown does not write");

  now = new Date(now.getTime() + 1);
  await service.refreshPresence("user-b");
  assert.equal((fixture.users[1]?.presenceExpiresAt as Date | null)?.getTime(), now.getTime() + 90_000, "heartbeat after the cooldown extends presence");

  await service.setPresence("user-c", false);
  await service.refreshPresence("user-c");
  assert.equal(fixture.users[2]?.presenceExpiresAt, null, "disabled presence is not refreshed");
});

test("saved opponents are private to the owner and can be removed", async () => {
  const fixture = socialDatabase();
  const service = new AccountService(fixture.db, async () => {}, () => new Date("2026-10-10T10:00:00.000Z"), false);
  await service.saveOpponent("user-a", "charlie");
  await service.saveOpponent("user-a", "CHARLIE");
  await service.saveOpponent("user-b", "charlie");
  assert.deepEqual((await service.socialSummary("user-a")).savedOpponents, ["charlie"]);
  assert.deepEqual((await service.socialSummary("user-b")).savedOpponents, ["charlie"]);
  await assert.rejects(() => service.saveOpponent("user-a", "alpha"), /cannot be saved/);
  await service.removeSavedOpponent("user-a", "charlie");
  assert.deepEqual((await service.socialSummary("user-a")).savedOpponents, []);
  assert.deepEqual((await service.socialSummary("user-b")).savedOpponents, ["charlie"]);
});

test("invitation decline and revoke permissions are enforced", async () => {
  const fixture = socialDatabase();
  const service = new AccountService(fixture.db, async () => {}, () => new Date("2026-10-10T10:00:00.000Z"), false);
  await service.sendFriendInvitation("user-a", "bravo");
  const invite = (await service.socialSummary("user-b")).incoming[0]!;
  await assert.rejects(() => service.revokeFriendInvitation("user-b", invite.id), /no longer available/);
  await service.revokeFriendInvitation("user-a", invite.id);
  await assert.rejects(() => service.acceptFriendInvitation("user-b", invite.id), /no longer available/);

  await service.sendFriendInvitation("user-a", "bravo");
  const nextInvite = (await service.socialSummary("user-b")).incoming[0]!;
  await service.declineFriendInvitation("user-b", nextInvite.id);
  await assert.rejects(() => service.acceptFriendInvitation("user-b", nextInvite.id), /no longer available/);
});

test("friend invite links store only token hashes and accept once", async () => {
  const fixture = socialDatabase();
  const service = new AccountService(fixture.db, async () => {}, () => new Date("2026-10-10T10:00:00.000Z"), false);
  const link = await service.createFriendInviteLink("user-a");
  const inviteUrl = new URL(link.url);
  const token = new URLSearchParams(inviteUrl.hash.slice(1)).get("friend-invite")!;
  assert.ok(token.length >= 32);
  assert.equal(inviteUrl.search, "");
  assert.notEqual(fixture.inviteLinks[0]?.tokenHash, token);
  assert.equal((await service.socialSummary("user-a")).inviteLinks[0]?.id, link.id);
  await assert.rejects(() => service.acceptFriendInviteLink("user-a", token), /unavailable/);
  await service.acceptFriendInviteLink("user-b", token);
  assert.equal(fixture.friendships.length, 1);
  assert.ok(fixture.inviteLinks[0]?.acceptedAt instanceof Date);
  await assert.rejects(() => service.acceptFriendInviteLink("user-c", token), /unavailable/);
});

test("friend invite links can be revoked, expire, and are capped per sender", async () => {
  const fixture = socialDatabase();
  let now = new Date("2026-10-10T10:00:00.000Z");
  const service = new AccountService(fixture.db, async () => {}, () => now, false);
  const revoked = await service.createFriendInviteLink("user-a");
  await assert.rejects(() => service.revokeFriendInviteLink("user-b", revoked.id), /unavailable/);
  await service.revokeFriendInviteLink("user-a", revoked.id);
  const revokedToken = new URLSearchParams(new URL(revoked.url).hash.slice(1)).get("friend-invite")!;
  await assert.rejects(() => service.acceptFriendInviteLink("user-b", revokedToken), /unavailable/);

  const expiring = await service.createFriendInviteLink("user-a");
  const expiringToken = new URLSearchParams(new URL(expiring.url).hash.slice(1)).get("friend-invite")!;
  now = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  await assert.rejects(() => service.acceptFriendInviteLink("user-b", expiringToken), /unavailable/);

  for (let index = 0; index < 10; index += 1) await service.createFriendInviteLink("user-c");
  await assert.rejects(() => service.createFriendInviteLink("user-c"), /Revoke an active friend link/);
});
