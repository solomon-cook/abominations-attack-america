import assert from "node:assert/strict";
import test from "node:test";
import { resolveAllowedOrigin } from "./runtime-config.js";

test("development origin defaults remain usable for local fixtures", () => {
  assert.equal(resolveAllowedOrigin("development", undefined), "*");
  assert.equal(resolveAllowedOrigin("development", "https://example.test"), "https://example.test");
});

test("production requires one explicit HTTPS origin", () => {
  assert.equal(resolveAllowedOrigin("production", "https://play.example.test"), "https://play.example.test");
  for (const origin of [undefined, "", "*", "http://play.example.test", "https://play.example.test/room", "https://play.example.test/"]) {
    assert.throws(() => resolveAllowedOrigin("production", origin), /explicit HTTPS origin/);
  }
});
