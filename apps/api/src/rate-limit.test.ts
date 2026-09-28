import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RATE_LIMIT_BUCKETS, withinRate, type RateBucket } from "./rate-limit.js";

test("rate limiter allows a bounded burst and rejects only the excess", () => {
  const bucket = new Map<string, RateBucket>();
  assert.equal(withinRate(bucket, "client", 1000, 60_000, 2), true);
  assert.equal(withinRate(bucket, "client", 1001, 60_000, 2), true);
  assert.equal(withinRate(bucket, "client", 1002, 60_000, 2), false);
  assert.equal(bucket.get("client")?.count, 2);
});

test("rate limiter resets after the window and isolates clients", () => {
  const bucket = new Map<string, RateBucket>();
  assert.equal(withinRate(bucket, "first", 1000, 60_000, 1), true);
  assert.equal(withinRate(bucket, "first", 61_000, 60_000, 1), true);
  assert.equal(withinRate(bucket, "second", 1001, 60_000, 1), true);
});

test("rate limiter bounds address churn and cleans expired keys without evicting active clients", () => {
  const bucket = new Map<string, RateBucket>();
  for (let index = 0; index < MAX_RATE_LIMIT_BUCKETS; index += 1) {
    assert.equal(withinRate(bucket, `client-${index}`, 1000, 60_000, 1), true);
  }

  assert.equal(bucket.size, MAX_RATE_LIMIT_BUCKETS);
  assert.equal(withinRate(bucket, "overflow-client", 1001, 60_000, 1), false);
  assert.equal(bucket.size, MAX_RATE_LIMIT_BUCKETS);
  assert.equal(withinRate(bucket, "client-0", 1002, 60_000, 1), false);

  assert.equal(withinRate(bucket, "new-window-client", 61_000, 60_000, 1), true);
  assert.equal(bucket.size, 1);
});
