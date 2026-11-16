import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 120;
const RETENTION_MS = 60 * 60 * 1000;

export const consumeHttpRequest = internalMutation({
  args: { keyHash: v.string(), at: v.number() },
  handler: async (ctx, { keyHash, at }) => {
    const bucket = await ctx.db.query("httpRateLimitBuckets").withIndex("by_key", (q) => q.eq("keyHash", keyHash)).unique();
    if (!bucket || at - bucket.windowStartedAt >= WINDOW_MS || at < bucket.windowStartedAt) {
      const expiresAt = at + WINDOW_MS + RETENTION_MS;
      if (bucket) {
        await ctx.db.patch(bucket._id, { windowStartedAt: at, count: 1, expiresAt });
        if (!bucket.expiryJobId) {
          const expiryJobId = await ctx.scheduler.runAfter(expiresAt - Date.now(), internal.requestLimits.deleteExpired, { bucketId: bucket._id });
          await ctx.db.patch(bucket._id, { expiryJobId });
        }
      } else {
        const bucketId = await ctx.db.insert("httpRateLimitBuckets", { keyHash, windowStartedAt: at, count: 1, expiresAt });
        const expiryJobId = await ctx.scheduler.runAfter(expiresAt - Date.now(), internal.requestLimits.deleteExpired, { bucketId });
        await ctx.db.patch(bucketId, { expiryJobId });
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - at) / 1000));
    if (bucket.count >= REQUESTS_PER_WINDOW) return { allowed: false, retryAfterSeconds };
    await ctx.db.patch(bucket._id, { count: bucket.count + 1, expiresAt: bucket.windowStartedAt + WINDOW_MS + RETENTION_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

export const deleteExpired = internalMutation({
  args: { bucketId: v.id("httpRateLimitBuckets") },
  handler: async (ctx, { bucketId }) => {
    const bucket = await ctx.db.get(bucketId);
    if (!bucket) return;
    const delay = bucket.expiresAt - Date.now();
    if (delay > 0) {
      const expiryJobId = await ctx.scheduler.runAfter(delay, internal.requestLimits.deleteExpired, { bucketId });
      await ctx.db.patch(bucketId, { expiryJobId });
      return;
    }
    await ctx.db.delete(bucketId);
  },
});

export const bootstrapExpiryJobs = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("httpRateLimitBuckets").order("asc").paginate({ numItems: 100, cursor: cursor ?? null });
    for (const bucket of page.page) {
      if (bucket.expiryJobId) continue;
      const expiryJobId = await ctx.scheduler.runAfter(
        Math.max(0, bucket.expiresAt - Date.now()),
        internal.requestLimits.deleteExpired,
        { bucketId: bucket._id },
      );
      await ctx.db.patch(bucket._id, { expiryJobId });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.requestLimits.bootstrapExpiryJobs, { cursor: page.continueCursor });
    return { scheduled: page.page.filter((bucket) => !bucket.expiryJobId).length, done: page.isDone };
  },
});
