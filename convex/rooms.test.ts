import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { decodeGameState, encodeGameState } from "./gameStateStorage.js";
import { applyCompletedSetup, chooseBotCommand, chooseBotSetupActionWithRecord, setupDeploymentState, type GameState } from "../packages/game-engine/src/index.js";

const modules = {
  "./_generated/server.ts": () => import("./_generated/server.js"),
  "./_generated/api.ts": () => import("./_generated/api.js"),
  "./_generated/dataModel.ts": () => import("./_generated/dataModel.js"),
  "./rooms.ts": () => import("./rooms.js"),
  "./replays.ts": () => import("./replays.js"),
  "./crons.ts": () => import("./crons.js"),
  "./requestLimits.ts": () => import("./requestLimits.js"),
  "./errorReports.ts": () => import("./errorReports.js"),
  "./accounts.ts": () => import("./accounts.js"),
  "./accountAuth.ts": () => import("./accountAuth.js"),
  "./accountData.ts": () => import("./accountData.js"),
  "./http.ts": () => import("./http.js"),
};
async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("account registration, email verification, and imported password hashes support session continuity", async () => {
  const t = convexTest(schema, modules);
  const registered = await t.action(internal.accountAuth.register, { emailInput: " Test@Example.com ", password: "a-long-test-password" });
  assert.equal(registered.account.emailVerified, false);
  assert.ok(registered.developmentLink);
  assert.match(registered.developmentLink, /verify-email=/);
  const verificationToken = new URL(registered.developmentLink).searchParams.get("verify-email")!;
  const verified = await t.action(internal.accountAuth.verifyEmail, { value: verificationToken });
  const login = await t.action(internal.accountAuth.login, { emailInput: "test@example.com", password: "a-long-test-password" });
  assert.equal(login.account.id, verified.account.id);
  assert.equal((await t.action(internal.accountAuth.authenticate, { value: login.sessionToken })).externalId, verified.account.id);
  const room = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Returning player", privacy: "private" });
  const linked = await t.mutation(internal.rooms.claimAccountSeat, { code: room.room.code, token: room.token, userId: login.account.id, username: login.account.username });
  assert.equal(linked.accountLinked, true);
  assert.equal((await t.query(api.rooms.read, { code: room.room.code, tokenHash: await tokenHash(linked.token) })).participants[0]?.displayName, login.account.username);
  assert.equal((await t.query(internal.accountData.games, { userId: login.account.id })).length, 1);
  const resumed = await t.mutation(internal.rooms.resumeAccountGame, { roomId: room.room.id, userId: login.account.id, username: login.account.username });
  assert.equal((await t.query(api.rooms.read, { code: room.room.code, tokenHash: await tokenHash(resumed.token) })).id, room.room.id);
  await t.mutation(internal.accountData.updatePrivacy, { userId: login.account.id, publicStatsEnabled: true });
  assert.equal((await t.query(internal.accountData.privacy, { userId: login.account.id })).publicStatsEnabled, true);
  const registeredFriend = await t.action(internal.accountAuth.register, { emailInput: "friend@example.com", password: "another-long-password" });
  assert.ok(registeredFriend.developmentLink);
  const friendToken = new URL(registeredFriend.developmentLink).searchParams.get("verify-email")!;
  await t.action(internal.accountAuth.verifyEmail, { value: friendToken });
  await t.mutation(internal.accountData.sendFriendInvitation, { userId: login.account.id, usernameInput: registeredFriend.account.username });
  const senderSocial = await t.query(internal.accountData.socialSummary, { userId: login.account.id });
  assert.equal(senderSocial.outgoing.length, 1);
  const friendSocial = await t.query(internal.accountData.socialSummary, { userId: registeredFriend.account.id });
  assert.equal(friendSocial.incoming.length, 1);
  await t.mutation(internal.accountData.respondFriendInvitation, { userId: registeredFriend.account.id, invitationId: friendSocial.incoming[0]!.id, action: "accept" });
  await t.mutation(internal.accountData.saveOpponent, { userId: login.account.id, usernameInput: registeredFriend.account.username, remove: false });
  await t.mutation(internal.accountData.setPresence, { userId: registeredFriend.account.id, enabled: true });
  const linkedSocial = await t.query(internal.accountData.socialSummary, { userId: login.account.id });
  assert.equal(linkedSocial.friends[0]?.online, true);
  assert.deepEqual(linkedSocial.savedOpponents, [registeredFriend.account.username]);
  const renamed = await t.mutation(internal.accountData.updateUsername, { userId: login.account.id, usernameInput: "Test_Renamed" });
  assert.equal(renamed.username, "test_renamed");
  assert.equal((await t.mutation(internal.accountData.publicProfile, { usernameInput: renamed.username })).username, renamed.username);
  const friendLink = await t.mutation(internal.accountData.createFriendLink, { userId: login.account.id });
  const inviteToken = new URL(friendLink.url).hash.slice(1).split("=")[1];
  await t.mutation(internal.accountData.acceptFriendLink, { userId: registeredFriend.account.id, value: decodeURIComponent(inviteToken!) });
  await t.action(internal.accountAuth.logout, { value: login.sessionToken });
  assert.equal(await t.action(internal.accountAuth.authenticate, { value: login.sessionToken }), null);
  await t.mutation(internal.accountData.deleteAccount, { userId: login.account.id });
  assert.equal(await t.query(internal.accounts.userByEmail, { email: "test@example.com" }), null);
  assert.equal((await t.query(internal.accountData.socialSummary, { userId: registeredFriend.account.id })).friends.length, 0);
});

test("account HTTP routes set, authenticate, and clear the first-party session cookie", async () => {
  const t = convexTest(schema, modules);
  const headers = { "content-type": "application/json", origin: "http://localhost:5173" };
  const registerResponse = await t.fetch("/accounts/register", { method: "POST", headers, body: JSON.stringify({ email: "http-route@example.com", password: "http-test-long-password" }) });
  assert.equal(registerResponse.status, 201);
  const registration = await registerResponse.json() as any;
  const verificationToken = new URL(registration.developmentLink).searchParams.get("verify-email")!;
  const verifyResponse = await t.fetch("/accounts/verify-email", { method: "POST", headers, body: JSON.stringify({ token: verificationToken }) });
  assert.equal(verifyResponse.status, 200);
  const setCookie = verifyResponse.headers.get("set-cookie");
  assert.match(setCookie ?? "", /^aaa_account=.*HttpOnly.*SameSite=Lax/);
  const cookie = setCookie!.split(";")[0]!;
  const meResponse = await t.fetch("/accounts/me", { headers: { ...headers, cookie } });
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json() as any).account.emailVerified, true);
  const logoutResponse = await t.fetch("/accounts/logout", { method: "POST", headers: { ...headers, cookie }, body: "{}" });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await t.fetch("/accounts/me", { headers: { ...headers, cookie } })).status, 401);
});

test("account HTTP routes preserve privacy choices, social ownership, password reset, and deletion", async () => {
  const t = convexTest(schema, modules);
  const baseHeaders = { "content-type": "application/json", origin: "http://localhost:5173" };
  async function createVerifiedAccount(email: string, password: string) {
    const registrationResponse = await t.fetch("/accounts/register", { method: "POST", headers: baseHeaders, body: JSON.stringify({ email, password }) });
    assert.equal(registrationResponse.status, 201);
    const registration = await registrationResponse.json() as { developmentLink: string };
    const token = new URL(registration.developmentLink).searchParams.get("verify-email")!;
    const verificationResponse = await t.fetch("/accounts/verify-email", { method: "POST", headers: baseHeaders, body: JSON.stringify({ token }) });
    assert.equal(verificationResponse.status, 200);
    const verified = await verificationResponse.json() as { account: { id: string; username: string; emailVerified: boolean } };
    const cookie = verificationResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return { account: verified.account, cookie: cookie! };
  }

  const alice = await createVerifiedAccount("privacy-owner@example.com", "a-long-privacy-password");
  const bob = await createVerifiedAccount("privacy-friend@example.com", "another-long-privacy-password");
  const aliceHeaders = { ...baseHeaders, cookie: alice.cookie };
  const bobHeaders = { ...baseHeaders, cookie: bob.cookie };

  const initialPrivacy = await t.fetch("/accounts/me/privacy", { headers: aliceHeaders }).then((response) => response.json()) as { publicStatsEnabled: boolean };
  assert.equal(initialPrivacy.publicStatsEnabled, true);
  const privatePrivacy = await t.fetch("/accounts/me/privacy", { method: "PATCH", headers: aliceHeaders, body: JSON.stringify({ publicStatsEnabled: false }) }).then((response) => response.json()) as { publicStatsEnabled: boolean };
  assert.equal(privatePrivacy.publicStatsEnabled, false);
  assert.equal((await t.fetch(`/players/${encodeURIComponent(alice.account.username)}`, { headers: baseHeaders })).status, 404);
  const privateLeaderboard = await t.fetch("/leaderboard?category=wins", { headers: baseHeaders }).then((response) => response.json()) as Array<{ username: string }>;
  assert.equal(privateLeaderboard.some((entry) => entry.username === alice.account.username), false);

  await t.fetch("/accounts/me/privacy", { method: "PATCH", headers: aliceHeaders, body: JSON.stringify({ publicStatsEnabled: true }) });
  const publicProfileResponse = await t.fetch(`/players/${encodeURIComponent(alice.account.username)}`, { headers: baseHeaders });
  assert.equal(publicProfileResponse.status, 200);
  const publicProfile = await publicProfileResponse.json() as Record<string, unknown>;
  assert.equal(publicProfile.username, alice.account.username);
  assert.equal(JSON.stringify(publicProfile).includes("privacy-owner@example.com"), false);
  const publicLeaderboard = await t.fetch("/leaderboard?category=wins", { headers: baseHeaders }).then((response) => response.json()) as Array<{ username: string }>;
  assert.equal(publicLeaderboard.some((entry) => entry.username === alice.account.username), true);
  assert.equal(JSON.stringify(publicLeaderboard).includes("privacy-owner@example.com"), false);

  await t.fetch("/accounts/me/friends/invitations", { method: "POST", headers: aliceHeaders, body: JSON.stringify({ username: bob.account.username }) });
  const bobSocialResponse = await t.fetch("/accounts/me/social", { headers: bobHeaders });
  assert.equal(bobSocialResponse.status, 200);
  const bobSocial = await bobSocialResponse.json() as { incoming: Array<{ id: string; username: string }>; friends: Array<{ username: string; online: boolean }> };
  assert.equal(bobSocial.incoming.length, 1);
  assert.equal(bobSocial.incoming[0]?.username, alice.account.username);
  assert.equal(JSON.stringify(bobSocial).includes("privacy-owner@example.com"), false);

  const acceptResponse = await t.fetch(`/accounts/me/friends/invitations/${encodeURIComponent(bobSocial.incoming[0]!.id)}/accept`, { method: "POST", headers: bobHeaders, body: "{}" });
  assert.equal(acceptResponse.status, 200);
  const aliceSocialResponse = await t.fetch("/accounts/me/social", { headers: aliceHeaders });
  const aliceSocial = await aliceSocialResponse.json() as { friends: Array<{ username: string }> };
  assert.deepEqual(aliceSocial.friends.map((friend) => friend.username), [bob.account.username]);

  const resetResponse = await t.fetch("/accounts/password-reset", { method: "POST", headers: baseHeaders, body: JSON.stringify({ email: "privacy-owner@example.com" }) });
  const reset = await resetResponse.json() as { developmentLink: string };
  const resetToken = new URL(reset.developmentLink).searchParams.get("reset-password")!;
  const completeReset = await t.fetch("/accounts/password-reset/complete", { method: "POST", headers: baseHeaders, body: JSON.stringify({ token: resetToken, password: "a-new-privacy-password" }) });
  assert.equal(completeReset.status, 200);
  assert.equal((await t.fetch("/accounts/me", { headers: aliceHeaders })).status, 401);
  const loginResponse = await t.fetch("/accounts/login", { method: "POST", headers: baseHeaders, body: JSON.stringify({ email: "privacy-owner@example.com", password: "a-new-privacy-password" }) });
  assert.equal(loginResponse.status, 200);
  const loginCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(loginCookie);

  const deleteResponse = await t.fetch("/accounts/me", { method: "DELETE", headers: { ...baseHeaders, cookie: loginCookie! } });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await t.fetch("/accounts/me", { headers: { ...baseHeaders, cookie: loginCookie! } })).status, 401);
  const bobAfterDeletion = await t.fetch("/accounts/me/social", { headers: bobHeaders }).then((response) => response.json()) as { friends: Array<{ username: string }> };
  assert.deepEqual(bobAfterDeletion.friends, []);
});

test("Convex HTTP adapter enforces a shared per-address request limit", async () => {
  const t = convexTest(schema, modules);
  const headers = { "x-forwarded-for": "203.0.113.44" };
  for (let request = 0; request < 120; request += 1) {
    assert.equal((await t.fetch("/health", { headers })).status, 200);
  }
  const limited = await t.fetch("/health", { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal((await t.fetch("/health", { headers: { "x-forwarded-for": "203.0.113.45" } })).status, 200);
});

test("Convex HTTP errors persist only daily category aggregates", async () => {
  const t = convexTest(schema, modules);
  const headers = { "x-forwarded-for": "203.0.113.46" };
  assert.equal((await t.fetch("/rooms/NOPE/state?token=invalid", { headers })).status, 400);
  assert.equal((await t.fetch("/rooms/NOPE/actions", { method: "POST", headers, body: "{}" })).status, 400);
  const aggregates = await t.run((ctx) => ctx.db.query("errorReportAggregates").collect());
  assert.deepEqual(aggregates.map(({ category, count }) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category)), [
    { category: "command", count: 1 },
    { category: "http", count: 1 },
  ]);
  assert.equal("message" in aggregates[0]!, false);
});

test("room creation, guest authorization, and public listing preserve room privacy", async () => {
  const t = convexTest(schema, modules);
  const privateSession = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Private host", privacy: "private" });
  const publicSession = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Public host", privacy: "public" });

  assert.equal(privateSession.room.status, "waiting");
  assert.equal(privateSession.room.participants[0]?.displayName, "Private host");
  assert.equal("tokenHash" in (privateSession.room.participants[0] ?? {}), false);
  assert.deepEqual(await t.query(api.rooms.publicRooms, {}), [{
    code: publicSession.room.code,
    status: "waiting",
    maxPlayers: 2,
    playerCount: 1,
    spectatorCount: 0,
  }]);

  const restored = await t.query(api.rooms.read, {
    code: privateSession.room.code,
    tokenHash: await tokenHash(privateSession.token),
  });
  assert.equal(restored.id, privateSession.room.id);
  assert.equal(restored.state.rng.seed, 0);
  assert.equal(restored.state.rng.cursor, 0);
});

test("joining assigns the open seat and rejects a full room", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "First", privacy: "private" });
  const second = await t.mutation(api.rooms.join, { code: first.room.code, displayName: "Second" });
  assert.equal(second.room.participants.length, 2);
  assert.deepEqual(second.room.participants.map((participant: any) => participant.playerIndex), [0, 1]);
  await assert.rejects(
    t.mutation(api.rooms.join, { code: first.room.code, displayName: "Third" }),
    /full/i,
  );
});

test("matches require an explicit connected-player start before readiness and setup", async () => {
  const t = convexTest(schema, modules);
  const host = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Host", privacy: "private" });
  const guest = await t.mutation(api.rooms.join, { code: host.room.code, displayName: "Guest" });
  assert.equal(host.room.matchStarted, false);
  await assert.rejects(t.mutation(api.rooms.ready, { code: host.room.code, token: host.token, ready: true }), /start the match/i);
  const started = await t.mutation(api.rooms.start, { code: host.room.code, token: host.token });
  assert.equal(started.matchStarted, true);
  await assert.rejects(t.mutation(api.rooms.start, { code: host.room.code, token: guest.token }), /already started/i);
  const ready = await t.mutation(api.rooms.ready, { code: host.room.code, token: host.token, ready: true });
  assert.equal(ready.matchStarted, true);
});

test("commands commit one revision and retry idempotently", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "First", privacy: "private" });
  const second = await t.mutation(api.rooms.join, { code: first.room.code, displayName: "Second" });
  let state = first.room.state as GameState;
  let setup = state.setupState!;
  for (let step = 0; setup.phase !== "complete" && step < 30; step += 1) {
    const field = setup.phase === "monster-selection" ? "monsterId" : setup.phase === "branch-selection" ? "branch" : setup.phase === "lair-selection" ? "lair" : "startingChoice";
    const order = [...setup.seats].sort((left, right) => setup.phase === "branch-selection" ? right.playerIndex - left.playerIndex : left.playerIndex - right.playerIndex);
    const playerIndex = setup.phase === "unused-branch-placement" ? setup.definition.playerCount - 1 : order.find((seat) => (seat as any)[field] === undefined)?.playerIndex ?? -1;
    const result = chooseBotSetupActionWithRecord(state, setup, playerIndex);
    assert.ok(result.action, `setup action ${step} should be replayable`);
    setup = result.setup;
    if (setup.seats[playerIndex]?.startingChoice?.kind === "deploy") {
      const choice = setup.seats[playerIndex]!.startingChoice!;
      setupDeploymentState({ ...state, setupState: setup }, playerIndex, "placements" in choice ? choice.placements : [choice]);
    }
    state = { ...state, setupState: setup, ...(setup.phase === "complete" ? { setupAssignments: setup.seats } : {}) };
  }
  assert.equal(setup.phase, "complete");
  state = applyCompletedSetup(state);
  const command = chooseBotCommand(state, new Set([state.currentPlayer]));
  assert.ok(command, "current player should have a legal bot command");
  const seats = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", first.room.code)).unique();
    assert.ok(room);
    await ctx.db.patch(room._id, { state, status: "active", matchStarted: true });
    const participants = await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", room.externalId)).collect();
    for (const participant of participants) await ctx.db.patch(participant._id, { ready: true });
    return participants.sort((a, b) => (a.playerIndex ?? 0) - (b.playerIndex ?? 0)).map((participant) => ({ id: participant.externalId, hash: participant.tokenHash }));
  });
  const actorIndex = state.currentPlayer;
  const actor = actorIndex === 0 ? first : second;
  const actorId = seats[actorIndex]!.id;
  const envelope = { actionId: "command-once", actorId, expectedRevision: 0, protocolVersion: 1, command };
  const committed = await t.mutation(api.rooms.submit, { code: first.room.code, token: actor.token, envelope });
  const retry = await t.mutation(api.rooms.submit, { code: first.room.code, token: actor.token, envelope });
  assert.equal(committed.version, 1);
  assert.equal(retry.version, 1);
  await assert.rejects(
    t.mutation(api.rooms.submit, { code: first.room.code, token: actor.token, envelope: { ...envelope, actionId: "stale-command" } }),
    /revision/i,
  );
  const receiptCount = await t.run((ctx) => ctx.db.query("commandReceipts").collect());
  assert.equal(receiptCount.length, 0);
});

test("private spectator links and connection leases enforce room access", async () => {
  const t = convexTest(schema, modules);
  const host = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Host", privacy: "private" });
  await t.mutation(api.rooms.join, { code: host.room.code, displayName: "Guest" });
  await assert.rejects(t.mutation(api.rooms.spectate, { code: host.room.code, displayName: "TV" }), /private/i);
  await assert.rejects(t.mutation(api.rooms.createViewerInvite, { code: host.room.code, token: host.token }), /start the match/i);
  await t.mutation(api.rooms.start, { code: host.room.code, token: host.token });
  const invite = await t.mutation(api.rooms.createViewerInvite, { code: host.room.code, token: host.token });
  const viewer = await t.mutation(api.rooms.spectate, { code: host.room.code, displayName: "TV", viewerToken: invite.token });
  assert.equal(viewer.room.participants.at(-1)?.role, "spectator");

  await t.mutation(api.rooms.reconnect, { code: host.room.code, token: host.token, connectionId: "new-tab" });
  await t.mutation(api.rooms.disconnect, { code: host.room.code, token: host.token, connectionId: "old-tab" });
  const restored = await t.query(api.rooms.read, { code: host.room.code, tokenHash: await tokenHash(host.token) });
  assert.equal(restored.participants[0]?.connected, true);
});

test("a room abandons when every player disconnects and resumes after all ready players return", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "First", privacy: "private" });
  const second = await t.mutation(api.rooms.join, { code: first.room.code, displayName: "Second" });
  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", first.room.code)).unique();
    assert.ok(room);
    const state = decodeGameState(room.state);
    await ctx.db.patch(room._id, { status: "active", state: encodeGameState({ ...state, setupState: { ...state.setupState!, phase: "complete" } }) });
    const participants = await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", room.externalId)).collect();
    for (const participant of participants) await ctx.db.patch(participant._id, { ready: true });
  });
  await t.mutation(api.rooms.disconnect, { code: first.room.code, token: first.token, connectionId: "first" });
  const oneLeft = await t.query(api.rooms.read, { code: first.room.code, tokenHash: await tokenHash(second.token) });
  assert.equal(oneLeft.status, "active");
  await t.mutation(api.rooms.disconnect, { code: first.room.code, token: second.token, connectionId: "second" });
  const abandoned = await t.query(api.rooms.read, { code: first.room.code, tokenHash: await tokenHash(second.token) });
  assert.equal(abandoned.status, "abandoned");
  const partiallyRestored = await t.mutation(api.rooms.reconnect, { code: first.room.code, token: first.token, connectionId: "first-new" });
  assert.equal(partiallyRestored.status, "abandoned");
  const resumed = await t.mutation(api.rooms.reconnect, { code: first.room.code, token: second.token, connectionId: "second-new" });
  assert.equal(resumed.status, "active");
});

test("stale guest seats become bot controlled after the takeover grace period", async () => {
  const t = convexTest(schema, modules);
  const host = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Host", privacy: "private" });
  await t.mutation(api.rooms.join, { code: host.room.code, displayName: "Second" });
  const generation = await t.run(async (ctx) => {
    const participant = await ctx.db.query("participants").withIndex("by_external_id", (q) => q.eq("externalId", host.participantId)).unique();
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", host.room.code)).unique();
    assert.ok(participant);
    assert.ok(room);
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    await ctx.db.patch(participant._id, { connectedAt: fiveMinutesAgo, lastSeenAt: fiveMinutesAgo });
    if (participant.presenceId) await ctx.db.patch(participant.presenceId, { lastSeenAt: fiveMinutesAgo });
    await ctx.db.patch(room._id, { status: "active", matchStarted: true });
    const runtime = await ctx.db.query("roomRuntime").withIndex("by_room", (q) => q.eq("roomId", room.externalId)).unique();
    return runtime?.presenceCheckGeneration ?? 0;
  });
  await t.mutation(internal.rooms.checkRoomPresence, { roomId: host.room.id, generation });
  const participant = await t.run((ctx) => ctx.db.query("participants").withIndex("by_external_id", (q) => q.eq("externalId", host.participantId)).unique());
  assert.equal(participant?.connectedAt, undefined);
  assert.equal(participant?.botControlled, true);
  assert.equal(participant?.botAssisted, true);
});

test("replay actions expose only completed public rooms and return redacted frames", async () => {
  const t = convexTest(schema, modules);
  const privateRoom = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Private", privacy: "private" });
  const publicRoom = await t.mutation(api.rooms.create, { maxPlayers: 2, displayName: "Public", privacy: "public" });
  const denied = await t.action(api.replays.exportAll, { code: privateRoom.room.code });
  assert.deepEqual(denied, { replayable: false, reason: "not-found" });
  const unfinished = await t.action(api.replays.page, { code: publicRoom.room.code, fromVersion: 0, limit: 8 });
  assert.deepEqual(unfinished, { replayable: false, reason: "not-completed" });
  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", publicRoom.room.code)).unique();
    assert.ok(room);
    const state = { ...room.state, phase: "game-over" };
    await ctx.db.patch(room._id, { state, initialReplayState: state, status: "completed", completedAt: Date.now() });
  });
  const replay = await t.action(api.replays.exportAll, { code: publicRoom.room.code });
  assert.equal(replay.replayable, true);
  if (replay.replayable) {
    assert.equal(replay.frames.length, 1);
    assert.equal(replay.frames[0]?.state.rng.seed, 0);
    assert.deepEqual(replay.frames[0]?.state.eventLog, []);
  }
});

test("HTTP adapter routes room operations to Convex functions and applies CORS", async () => {
  const t = convexTest(schema, modules);
  const createdResponse = await t.fetch("/rooms", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ maxPlayers: 2, displayName: "HTTP host", privacy: "public" }),
  });
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const created = await createdResponse.json() as any;
  const listedResponse = await t.fetch("/rooms/public", { headers: { origin: "http://localhost:5173" } });
  assert.equal(listedResponse.status, 200);
  assert.equal(((await listedResponse.json()) as any[])[0]?.code, created.room.code);
  const denied = await t.fetch("/rooms/public", { headers: { origin: "https://untrusted.example" } });
  assert.equal(denied.status, 403);
});
