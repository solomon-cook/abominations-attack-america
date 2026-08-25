import assert from "node:assert/strict";
import test from "node:test";
import { withinRate, type RateBucket } from "./rate-limit.js";

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
