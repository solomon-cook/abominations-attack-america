import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 120;
const RETENTION_MS = 60 * 60 * 1000;

export const consumeHttpRequest = internalMutation({
  args: { keyHash: v.string(), at: v.number() },
  handler: async (ctx, { keyHash, at }) => {
    const expired = await ctx.db.query("httpRateLimitBuckets")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", at))
      .take(10);
    await Promise.all(expired.map((item) => ctx.db.delete(item._id)));
    const bucket = await ctx.db.query("httpRateLimitBuckets").withIndex("by_key", (q) => q.eq("keyHash", keyHash)).unique();
    if (!bucket || at - bucket.windowStartedAt >= WINDOW_MS || at < bucket.windowStartedAt) {
      const expiresAt = at + WINDOW_MS + RETENTION_MS;
      if (bucket) {
        await ctx.db.patch(bucket._id, { windowStartedAt: at, count: 1, expiresAt, expiryJobId: undefined });
      } else {
        await ctx.db.insert("httpRateLimitBuckets", { keyHash, windowStartedAt: at, count: 1, expiresAt });
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - at) / 1000));
    if (bucket.count >= REQUESTS_PER_WINDOW) return { allowed: false, retryAfterSeconds };
    await ctx.db.patch(bucket._id, { count: bucket.count + 1, expiresAt: bucket.windowStartedAt + WINDOW_MS + RETENTION_MS, expiryJobId: undefined });
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

export const cancelExpiryJobs = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("httpRateLimitBuckets").order("asc").paginate({ numItems: 100, cursor: cursor ?? null });
    for (const bucket of page.page) {
      const scheduledExpiry = bucket.expiryJobId;
      if (!scheduledExpiry) continue;
      try { await ctx.scheduler.cancel(scheduledExpiry); } catch { /* already completed or canceled */ }
      await ctx.db.patch(bucket._id, { expiryJobId: undefined });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.requestLimits.cancelExpiryJobs, { cursor: page.continueCursor });
    return { canceled: page.page.filter((bucket) => Boolean(bucket.expiryJobId)).length, done: page.isDone };
  },
});
