import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomStore } from "./store.js";

test("players can create, join, and read a room", async () => {
  const store = new MemoryRoomStore();
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  assert.equal(guest.room.status, "active");
  const state = await store.getRoom(host.room.code, host.token);
  assert.equal(state.participants.length, 2);
});

test("spectators can read but cannot act", async () => {
  const store = new MemoryRoomStore();
  const host = await store.createRoom(2);
  const spectator = await store.spectateRoom(host.room.code, "Watch-only");
  await assert.rejects(() => store.submitAction(host.room.code, spectator.token, "a1", { type: "move", destination: "denver" }), /Spectators/);
});

test("repeated action ids are idempotent", async () => {
  const store = new MemoryRoomStore();
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  const first = await store.submitAction(host.room.code, host.token, "a1", { type: "move", destination: "denver" });
  const second = await store.submitAction(host.room.code, host.token, "a1", { type: "move", destination: "denver" });
  assert.equal(first.version, second.version);
  assert.equal(guest.room.participants.length, 2);
});
