export interface RateBucket {
  startedAt: number;
  count: number;
}

export const MAX_RATE_LIMIT_BUCKETS = 4_096;
const BUCKET_CLEANUP_INTERVAL_MS = 10_000;
const lastCleanupAt = new WeakMap<Map<string, RateBucket>, number>();

function cleanExpiredBuckets(bucket: Map<string, RateBucket>, now: number, windowMs: number): void {
  const lastCleanup = lastCleanupAt.get(bucket);
  if (lastCleanup !== undefined && now - lastCleanup < Math.min(windowMs, BUCKET_CLEANUP_INTERVAL_MS)) return;

  for (const [key, value] of bucket) {
    if (now - value.startedAt >= windowMs) bucket.delete(key);
  }
  lastCleanupAt.set(bucket, now);
}

export function withinRate(
  bucket: Map<string, RateBucket>,
  key: string,
  now: number,
  windowMs: number,
  limit: number,
): boolean {
  cleanExpiredBuckets(bucket, now, windowMs);
  const current = bucket.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    if (current) bucket.delete(key);
    // Preserve every active client's window. When the cap is full, fail closed
    // for new keys until the next expired bucket is cleaned.
    if (bucket.size >= MAX_RATE_LIMIT_BUCKETS) return false;
    bucket.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
