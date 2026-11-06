import assert from "node:assert/strict";
import test from "node:test";
import { resolveAllowedOrigin, resolveDatabaseConnections, resolveErrorAlertUrl, validateRuntimeConfig } from "./runtime-config.js";

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

test("Prisma Postgres uses pooled runtime queries and a direct room-notification and migration connection", () => {
  const pooledUrl = "postgresql://user:password@pooled.db.prisma.io:5432/app?sslmode=require";
  const directUrl = "postgresql://user:password@db.prisma.io:5432/app?sslmode=require";
  assert.deepEqual(resolveDatabaseConnections({ DATABASE_URL_POOLED: pooledUrl, DATABASE_URL: directUrl, DIRECT_URL: directUrl }), {
    databaseUrl: pooledUrl,
    directUrl,
    roomNotificationsUrl: directUrl,
  });
  assert.deepEqual(resolveDatabaseConnections({ DATABASE_URL: pooledUrl, DIRECT_URL: directUrl }), {
    databaseUrl: pooledUrl,
    directUrl,
    roomNotificationsUrl: directUrl,
  });
  assert.deepEqual(resolveDatabaseConnections({ DATABASE_URL: "postgresql://db.example/app" }), {
    databaseUrl: "postgresql://db.example/app",
    roomNotificationsUrl: "postgresql://db.example/app",
  });
  assert.throws(() => validateRuntimeConfig({ NODE_ENV: "production", ALLOWED_ORIGIN: "https://play.example.test", DATABASE_URL: pooledUrl }), /requires DIRECT_URL/);
  assert.throws(() => validateRuntimeConfig({ NODE_ENV: "production", ALLOWED_ORIGIN: "https://play.example.test", DATABASE_URL_POOLED: pooledUrl }), /requires DIRECT_URL/);
  assert.throws(() => validateRuntimeConfig({ NODE_ENV: "production", ALLOWED_ORIGIN: "https://play.example.test", DATABASE_URL: pooledUrl, DIRECT_URL: "postgresql://localhost/app" }), /loopback database URL/);
});

test("optional error-alert destinations require credential-free HTTPS URLs", () => {
  assert.equal(resolveErrorAlertUrl(undefined), undefined);
  assert.equal(resolveErrorAlertUrl("  "), undefined);
  assert.equal(resolveErrorAlertUrl("https://alerts.example.test/webhook?key=secret"), "https://alerts.example.test/webhook?key=secret");
  for (const endpoint of ["not a URL", "http://alerts.example.test/hook", "https://user:password@alerts.example.test/hook", "https://alerts.example.test/hook#fragment"]) {
    assert.throws(() => resolveErrorAlertUrl(endpoint), /HTTPS URL without embedded credentials/);
  }
  assert.deepEqual(validateRuntimeConfig({ NODE_ENV: "development", ERROR_ALERT_URL: "https://alerts.example.test/hook" }), {
    nodeEnvironment: "development",
    allowedOrigin: "*",
    persistence: "memory",
    errorAlertUrl: "https://alerts.example.test/hook",
  });
});
