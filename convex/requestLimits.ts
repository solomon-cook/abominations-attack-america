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
      const next = { keyHash, windowStartedAt: at, count: 1, expiresAt: at + WINDOW_MS + RETENTION_MS };
      if (bucket) await ctx.db.patch(bucket._id, next);
      else await ctx.db.insert("httpRateLimitBuckets", next);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - at) / 1000));
    if (bucket.count >= REQUESTS_PER_WINDOW) return { allowed: false, retryAfterSeconds };
    await ctx.db.patch(bucket._id, { count: bucket.count + 1, expiresAt: bucket.windowStartedAt + WINDOW_MS + RETENTION_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

export const deleteExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("httpRateLimitBuckets").withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now())).take(500);
    await Promise.all(expired.map((bucket) => ctx.db.delete(bucket._id)));
    if (expired.length === 500) await ctx.scheduler.runAfter(0, internal.requestLimits.deleteExpired, {});
  },
});
