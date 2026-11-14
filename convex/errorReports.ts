import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;
const categoryValidator = v.union(
  v.literal("http"), v.literal("command"), v.literal("persistence"),
  v.literal("websocket"), v.literal("divergence"), v.literal("deployment"),
);

export const record = internalMutation({
  args: { category: categoryValidator, at: v.number() },
  handler: async (ctx, { category, at }) => {
    const bucketDate = new Date(at).toISOString().slice(0, 10);
    const current = await ctx.db.query("errorReportAggregates")
      .withIndex("by_date_category", (q) => q.eq("bucketDate", bucketDate).eq("category", category))
      .unique();
    if (current) await ctx.db.patch(current._id, { count: current.count + 1, updatedAt: at });
    else await ctx.db.insert("errorReportAggregates", { bucketDate, category, count: 1, updatedAt: at });

    const cutoff = new Date(at - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expired = await ctx.db.query("errorReportAggregates")
      .withIndex("by_date_category", (q) => q.lt("bucketDate", cutoff))
      .take(BATCH_SIZE);
    await Promise.all(expired.map((aggregate) => ctx.db.delete(aggregate._id)));
    if (expired.length === BATCH_SIZE) await ctx.scheduler.runAfter(0, internal.errorReports.prune, { cutoff });
  },
});

export const prune = internalMutation({
  args: { cutoff: v.string() },
  handler: async (ctx, { cutoff }) => {
    const expired = await ctx.db.query("errorReportAggregates")
      .withIndex("by_date_category", (q) => q.lt("bucketDate", cutoff))
      .take(BATCH_SIZE);
    await Promise.all(expired.map((aggregate) => ctx.db.delete(aggregate._id)));
    if (expired.length === BATCH_SIZE) await ctx.scheduler.runAfter(0, internal.errorReports.prune, { cutoff });
  },
});
