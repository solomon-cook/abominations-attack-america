export interface RateBucket {
  startedAt: number;
  count: number;
}

export function withinRate(
  bucket: Map<string, RateBucket>,
  key: string,
  now: number,
  windowMs: number,
  limit: number,
): boolean {
  const current = bucket.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    bucket.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
