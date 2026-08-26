import assert from "node:assert/strict";
import test from "node:test";
import { resolveAllowedOrigin, validateRuntimeConfig } from "./runtime-config.js";

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

test("production configuration requires durable non-loopback persistence", () => {
  assert.deepEqual(validateRuntimeConfig({ NODE_ENV: "production", ALLOWED_ORIGIN: "https://play.example.test", DATABASE_URL: "postgresql://db.example/app" }), {
    nodeEnvironment: "production",
    allowedOrigin: "https://play.example.test",
    persistence: "prisma",
  });
  for (const databaseUrl of [undefined, "", "postgresql://localhost/app", "postgresql://127.0.0.1/app", "postgresql://[::1]/app"]) {
    assert.throws(() => validateRuntimeConfig({ NODE_ENV: "production", ALLOWED_ORIGIN: "https://play.example.test", DATABASE_URL: databaseUrl }), /production API/);
  }
});
