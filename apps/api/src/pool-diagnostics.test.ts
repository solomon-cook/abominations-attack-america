import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "pg";
import { observePoolLifecycle } from "./pool-diagnostics.js";

test("pool lifecycle diagnostics count only safe connection events", () => {
  const pool = new EventEmitter() as unknown as Pool;
  const snapshot = observePoolLifecycle(pool);
  pool.emit("connect", { connectionString: "must-not-be-recorded" });
  pool.emit("acquire", { password: "must-not-be-recorded" });
  pool.emit("release", { token: "must-not-be-recorded" });
  pool.emit("remove", { secret: "must-not-be-recorded" });
  pool.emit("error", Object.assign(new Error("must-not-be-recorded"), { code: "SECRET_CODE" }));

  assert.deepEqual(snapshot(), {
    clientsCreated: 1,
    clientsAcquired: 1,
    clientsReleased: 1,
    clientsRemoved: 1,
    idleClientErrors: 1,
    idleClientErrorsByCode: { unknown: 1 },
  });
  assert.doesNotMatch(JSON.stringify(snapshot()), /must-not-be-recorded/);
});

test("pool lifecycle diagnostics retain only sanitized PostgreSQL error codes", () => {
  const pool = new EventEmitter() as unknown as Pool;
  const snapshot = observePoolLifecycle(pool);
  pool.emit("error", Object.assign(new Error("connection details must not be retained"), { code: "ECONNRESET" }));
  pool.emit("error", Object.assign(new Error("bad code"), { code: "password=secret" }));

  pool.emit("error", Object.assign(new Error("connection idle"), { code: "57P01" }));

  assert.deepEqual(snapshot().idleClientErrorsByCode, { ECONNRESET: 1, unknown: 1, "57P01": 1 });
  assert.doesNotMatch(JSON.stringify(snapshot()), /connection details|password|secret/);
});
