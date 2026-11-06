import assert from "node:assert/strict";
import test from "node:test";
import { classifyApiError } from "./api-errors.js";

test("database query timeouts are reported as temporary service failures", () => {
  assert.deepEqual(classifyApiError(new Error("Query read timeout")), {
    status: 503,
    message: "The game service is temporarily unavailable. Please try again.",
    category: "database-timeout",
    timeoutKind: "query-read-timeout",
    errorName: "Error",
    errorCode: undefined,
  });
});

test("database connection timeouts are distinguished without logging connection details", () => {
  assert.equal(classifyApiError(new Error("Connection terminated due to connection timeout")).timeoutKind, "connection-timeout");
  assert.equal(classifyApiError(Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" })).timeoutKind, "network-etimedout");
});

test("explicit client status codes remain intact", () => {
  assert.equal(classifyApiError(Object.assign(new Error("Room not found."), { status: 404 })).status, 404);
});

test("application validation errors preserve the existing client-error response", () => {
  assert.equal(classifyApiError(new Error("Illegal move.")).status, 400);
});
