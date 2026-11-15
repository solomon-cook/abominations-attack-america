import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const tables = [
  "rooms",
  "participants",
  "events",
  "commandReceipts",
  "gameResults",
  "userAccounts",
  "accountSessions",
  "accountTokens",
  "friendInvitations",
  "friendInviteLinks",
  "friendships",
  "savedOpponents",
  "playerMatchStats",
  "errorReportAggregates",
] as const;

const importTable = v.union(
  v.literal("rooms"),
  v.literal("participants"),
  v.literal("events"),
  v.literal("commandReceipts"),
  v.literal("gameResults"),
  v.literal("userAccounts"),
  v.literal("accountSessions"),
  v.literal("accountTokens"),
  v.literal("friendInvitations"),
  v.literal("friendInviteLinks"),
  v.literal("friendships"),
  v.literal("savedOpponents"),
  v.literal("playerMatchStats"),
  v.literal("errorReportAggregates"),
);

function validCounts(value: unknown): value is Record<(typeof tables)[number], number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length === tables.length && tables.every((table) =>
    Object.hasOwn(value, table) && Number.isSafeInteger((value as Record<string, unknown>)[table])
      && Number((value as Record<string, unknown>)[table]) >= 0,
  );
}

export const begin = internalMutation({
  args: { runId: v.string(), expectedCounts: v.any() },
  returns: v.object({ status: v.union(v.literal("started"), v.literal("completed")), importedCounts: v.any() }),
  handler: async (ctx, args) => {
    if (!args.runId || args.runId.length > 128 || !validCounts(args.expectedCounts)) {
      throw new Error("Invalid migration manifest.");
    }

    const existingRun = await ctx.db.query("migrationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (existingRun) {
      if (!validCounts(existingRun.expectedCounts) || tables.some((table) => existingRun.expectedCounts[table] !== args.expectedCounts[table])) {
        throw new Error("Migration run ID already belongs to a different manifest.");
      }
      return { status: existingRun.status as "started" | "completed", importedCounts: existingRun.importedCounts };
    }

    for (const table of tables) {
      if ((await ctx.db.query(table as (typeof tables)[number]).take(1)).length > 0) {
        throw new Error(`Migration target table ${table} is not empty; use a fresh development deployment.`);
      }
    }
    const importedCounts = Object.fromEntries(tables.map((table) => [table, 0]));
    await ctx.db.insert("migrationRuns", {
      runId: args.runId,
      status: "started",
      expectedCounts: args.expectedCounts,
      importedCounts,
      createdAt: Date.now(),
    });
    return { status: "started" as const, importedCounts };
  },
});

export const importBatch = internalMutation({
  args: {
    runId: v.string(),
    table: importTable,
    batchNumber: v.number(),
    sha256: v.string(),
    rows: v.array(v.any()),
  },
  returns: v.object({ inserted: v.number(), replayed: v.boolean() }),
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.batchNumber) || args.batchNumber < 0 || !args.rows.length || args.rows.length > 400 || !/^[a-f0-9]{64}$/.test(args.sha256)) {
      throw new Error("Invalid migration batch.");
    }
    const run = await ctx.db.query("migrationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (!run) throw new Error("Migration run was not started.");
    if (run.status === "completed") throw new Error("Migration run is already complete.");

    const previous = await ctx.db.query("migrationBatches")
      .withIndex("by_run_table_batch", (q) => q.eq("runId", args.runId).eq("table", args.table).eq("batchNumber", args.batchNumber))
      .unique();
    if (previous) {
      if (previous.rowCount !== args.rows.length || previous.sha256 !== args.sha256) {
        throw new Error("Migration batch retry did not match its prior contents.");
      }
      return { inserted: 0, replayed: true };
    }

    const expectedCount = run.expectedCounts[args.table];
    const importedCount = run.importedCounts[args.table] ?? 0;
    if (importedCount + args.rows.length > expectedCount) throw new Error("Migration batch exceeds the manifest row count.");

    for (const row of args.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Migration row must be a JSON object.");
      await ctx.db.insert(args.table as any, row as any);
    }
    await ctx.db.insert("migrationBatches", {
      runId: args.runId,
      table: args.table,
      batchNumber: args.batchNumber,
      rowCount: args.rows.length,
      sha256: args.sha256,
      createdAt: Date.now(),
    });
    await ctx.db.patch(run._id, { importedCounts: { ...run.importedCounts, [args.table]: importedCount + args.rows.length } });
    return { inserted: args.rows.length, replayed: false };
  },
});

export const finish = internalMutation({
  args: { runId: v.string() },
  returns: v.object({ status: v.union(v.literal("completed")), importedCounts: v.any() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.query("migrationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (!run) throw new Error("Migration run was not started.");
    if (run.status === "completed") return { status: "completed" as const, importedCounts: run.importedCounts };
    for (const table of tables) {
      if (run.importedCounts[table] !== run.expectedCounts[table]) {
        throw new Error(`Migration is incomplete for ${table}.`);
      }
    }
    await ctx.db.patch(run._id, { status: "completed", completedAt: Date.now() });
    return { status: "completed" as const, importedCounts: run.importedCounts };
  },
});
