import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";

const tables = [
  "rooms", "participants", "events", "commandReceipts", "gameResults", "userAccounts",
  "accountSessions", "accountTokens", "friendInvitations", "friendInviteLinks", "friendships",
  "savedOpponents", "playerMatchStats", "errorReportAggregates",
] as const;
const modules = {
  "./_generated/server.ts": () => import("./_generated/server.js"),
  "./_generated/api.ts": () => import("./_generated/api.js"),
  "./_generated/dataModel.ts": () => import("./_generated/dataModel.js"),
  "./migration.ts": () => import("./migration.js"),
  "./requestLimits.ts": () => import("./requestLimits.js"),
  "./errorReports.ts": () => import("./errorReports.js"),
  "./accounts.ts": () => import("./accounts.js"),
  "./accountAuth.ts": () => import("./accountAuth.js"),
  "./accountData.ts": () => import("./accountData.js"),
  "./rooms.ts": () => import("./rooms.js"),
  "./replays.ts": () => import("./replays.js"),
  "./crons.ts": () => import("./crons.js"),
  "./http.ts": () => import("./http.js"),
};
const counts = (overrides: Partial<Record<(typeof tables)[number], number>> = {}) =>
  Object.fromEntries(tables.map((table) => [table, overrides[table] ?? 0]));

test("migration batches are validated, idempotent, and count-checked", async () => {
  const t = convexTest(schema, modules);
  const expectedCounts = counts({ userAccounts: 1 });
  const runId = "00000000-0000-4000-8000-000000000001";
  const batch = {
    runId,
    table: "userAccounts" as const,
    batchNumber: 0,
    sha256: "a".repeat(64),
    rows: [{
      externalId: "legacy-account-1",
      email: "old-account@example.com",
      passwordHash: "existing-password-hash",
      username: "OldPlayer",
      publicStatsEnabled: false,
      presenceEnabled: false,
      createdAt: 1,
      updatedAt: 2,
    }],
  };

  assert.equal((await t.mutation(internal.migration.begin, { runId, expectedCounts })).status, "started");
  assert.deepEqual(await t.mutation(internal.migration.importBatch, batch), { inserted: 1, replayed: false });
  assert.deepEqual(await t.mutation(internal.migration.importBatch, batch), { inserted: 0, replayed: true });
  const account = await t.run((ctx) => ctx.db.query("userAccounts").withIndex("by_external_id", (q) => q.eq("externalId", "legacy-account-1")).unique());
  assert.equal(account?.email, "old-account@example.com");
  assert.deepEqual((await t.mutation(internal.migration.finish, { runId })).importedCounts, expectedCounts);
  assert.equal((await t.mutation(internal.migration.begin, { runId, expectedCounts })).status, "completed");
});

test("migration cannot start against tables with existing application data", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("userAccounts", {
    externalId: "already-here", email: "existing@example.com", passwordHash: "hash", username: "Existing",
    publicStatsEnabled: false, presenceEnabled: false, createdAt: 1, updatedAt: 1,
  }));
  await assert.rejects(() => t.mutation(internal.migration.begin, {
    runId: "00000000-0000-4000-8000-000000000002",
    expectedCounts: counts(),
  }), /not empty/);
});

test("migration HTTP interface hides itself without the temporary bearer token", async () => {
  const t = convexTest(schema, modules);
  const previous = process.env.CONVEX_MIGRATION_TOKEN;
  process.env.CONVEX_MIGRATION_TOKEN = "migration-test-secret-that-is-long-enough";
  try {
    const headers = { "content-type": "application/json" };
    const body = JSON.stringify({ runId: "00000000-0000-4000-8000-000000000003", expectedCounts: counts() });
    assert.equal((await t.fetch("/internal/migration/begin", { method: "POST", headers, body })).status, 404);
    assert.equal((await t.fetch("/internal/migration/begin", {
      method: "POST", headers: { ...headers, authorization: "Bearer wrong-token" }, body,
    })).status, 404);
    const authorized = await t.fetch("/internal/migration/begin", {
      method: "POST", headers: { ...headers, authorization: `Bearer ${process.env.CONVEX_MIGRATION_TOKEN}` }, body,
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json() as { status: string }).status, "started");
  } finally {
    if (previous === undefined) delete process.env.CONVEX_MIGRATION_TOKEN;
    else process.env.CONVEX_MIGRATION_TOKEN = previous;
  }
});

test("production migration route requires explicit migration mode and a bearer token", async () => {
  const t = convexTest(schema, modules);
  const previousToken = process.env.CONVEX_MIGRATION_TOKEN;
  const previousEnvironment = process.env.APP_ENV;
  const previousDeployment = process.env.CONVEX_DEPLOYMENT;
  process.env.CONVEX_MIGRATION_TOKEN = "migration-test-secret-that-is-long-enough";
  process.env.APP_ENV = "production";
  process.env.CONVEX_DEPLOYMENT = "prod:unit-test";
  const headers = { "content-type": "application/json", authorization: `Bearer ${process.env.CONVEX_MIGRATION_TOKEN}` };
  const body = JSON.stringify({ runId: "00000000-0000-4000-8000-000000000004", expectedCounts: counts() });
  try {
    assert.equal((await t.fetch("/internal/migration/begin", { method: "POST", headers, body })).status, 404);
    process.env.APP_ENV = "migration";
    assert.equal((await t.fetch("/internal/migration/begin", { method: "POST", headers, body })).status, 200);
    process.env.APP_ENV = "production";
    assert.equal((await t.fetch("/internal/migration/begin", { method: "POST", headers, body })).status, 404);
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_MIGRATION_TOKEN;
    else process.env.CONVEX_MIGRATION_TOKEN = previousToken;
    if (previousEnvironment === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnvironment;
    if (previousDeployment === undefined) delete process.env.CONVEX_DEPLOYMENT;
    else process.env.CONVEX_DEPLOYMENT = previousDeployment;
  }
});
