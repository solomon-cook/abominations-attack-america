import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationIntegrity } from "./convex-migration-integrity.js";

const validRows = () => new Map<string, Record<string, any>[]>([
  ["rooms", [{ externalId: "room-1", code: "ABC123" }]],
  ["participants", [
    { externalId: "participant-1", roomId: "room-1", role: "player", playerIndex: 0, userId: "user-1", tokenHash: "room-token" },
  ]],
  ["events", [{ externalId: "event-1", roomId: "room-1", version: 1 }]],
  ["commandReceipts", [{ roomId: "room-1", actionId: "action-1" }]],
  ["gameResults", []],
  ["userAccounts", [{ externalId: "user-1", email: "one@example.test", username: "one" }]],
  ["accountSessions", [{ externalId: "session-1", userId: "user-1", tokenHash: "session-token" }]],
  ["accountTokens", []],
  ["friendInvitations", []],
  ["friendInviteLinks", []],
  ["friendships", []],
  ["savedOpponents", []],
  ["playerMatchStats", []],
  ["errorReportAggregates", []],
]);

test("migration preflight accepts mapped rows with valid references", () => {
  assert.doesNotThrow(() => assertMigrationIntegrity(validRows()));
});

test("migration preflight rejects duplicate room codes", () => {
  const rows = validRows();
  rows.get("rooms")!.push({ externalId: "room-2", code: "ABC123" });
  assert.throws(() => assertMigrationIntegrity(rows), /rooms\.code/);
});

test("migration preflight rejects dangling account relationships", () => {
  const rows = validRows();
  rows.get("accountSessions")![0]!.userId = "missing-user";
  assert.throws(() => assertMigrationIntegrity(rows), /accountSessions\.userId/);
});
