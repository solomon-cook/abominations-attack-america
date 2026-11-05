import assert from "node:assert/strict";
import test from "node:test";
import { preferRoomSnapshot } from "../apps/web/src/room-snapshot.ts";

test("room snapshots never replace a newer version for the same room", () => {
  const current = { code: "ROOM1", version: 12, phase: "fight" };
  const delayed = { code: "ROOM1", version: 10, phase: "move" };
  assert.equal(preferRoomSnapshot(current, delayed), current);
});

test("same-version snapshots can refresh participant presence", () => {
  const current = { code: "ROOM1", version: 12, online: false };
  const incoming = { code: "ROOM1", version: 12, online: true };
  assert.equal(preferRoomSnapshot(current, incoming), incoming);
});

test("a different room can replace the current room even at a lower version", () => {
  const current = { code: "ROOM1", version: 12 };
  const incoming = { code: "ROOM2", version: 0 };
  assert.equal(preferRoomSnapshot(current, incoming), incoming);
});
