import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomStore } from "./store.js";

async function readyTwoPlayerRoom() {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2, "Host");
  const guest = await store.joinRoom(host.room.code, "Guest");
  const sessions = [host, guest];
  let revision = host.room.version;
  for (const [playerIndex, monsterId] of [[0, "monster-1"], [1, "monster-2"]] as const) revision = (await store.setupAction(host.room.code, sessions[playerIndex]!.token, { type: "choose-monster", monsterId }, revision)).version;
  for (const [playerIndex, branch] of [[1, "Navy"], [0, "Army"]] as const) revision = (await store.setupAction(host.room.code, sessions[playerIndex]!.token, { type: "choose-branch", branch }, revision)).version;
  for (const [playerIndex, lair] of [[0, "los-angeles"], [1, "chicago"]] as const) revision = (await store.setupAction(host.room.code, sessions[playerIndex]!.token, { type: "choose-lair", lair }, revision)).version;
  for (const player of sessions) revision = (await store.setupAction(host.room.code, player.token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }, revision)).version;
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  return { store, host, guest };
}

test("four-minute takeover is cancelled by reconnect and bot actions remain after reclaim", async () => {
  const { store, host, guest } = await readyTwoPlayerRoom();
  const disconnectedAt = Date.now();
  await store.disconnect(host.room.code, host.token);
  assert.deepEqual(await store.processBotTakeovers(disconnectedAt + 239_999), []);
  let room = await store.getRoom(host.room.code, guest.token);
  assert.equal(room.participants.find((seat) => seat.id === host.participantId)?.botControlled, false);

  await store.reconnect(host.room.code, host.token);
  assert.deepEqual(await store.processBotTakeovers(disconnectedAt + 300_000), []);
  room = await store.getRoom(host.room.code, guest.token);
  assert.equal(room.participants.find((seat) => seat.id === host.participantId)?.botControlled, false);

  await store.disconnect(host.room.code, host.token);
  await store.disconnect(guest.room.code, guest.token);
  const before = await store.getRoom(host.room.code, host.token);
  const changed = await store.processBotTakeovers(Date.now() + 5 * 60_000);
  assert.deepEqual(changed, [host.room.code]);
  room = await store.getRoom(host.room.code, host.token);
  assert.equal(room.participants.every((seat) => seat.botControlled), true);
  assert.ok(room.events.some((event) => event.controlSource === "bot"));
  assert.ok(room.version > before.version);

  const committedVersion = room.version;
  await store.reconnect(host.room.code, host.token);
  room = await store.getRoom(host.room.code, host.token);
  assert.equal(room.participants.find((seat) => seat.id === host.participantId)?.botControlled, false);
  assert.ok(room.version >= committedVersion);
  assert.ok(room.events.some((event) => event.controlSource === "bot"), "committed bot decisions stay in room history after reclaim");
});

test("WebSocket tickets are one-use and tied to the room session that issued them", async () => {
  const store = new MemoryRoomStore();
  const host = await store.createRoom(2);
  const ticket = await store.createSocketTicket(host.room.code, host.token);
  const principal = await store.consumeSocketTicket(host.room.code, ticket);
  assert.equal(principal.participantId, host.participantId);
  await assert.rejects(() => store.consumeSocketTicket(host.room.code, ticket), /invalid or expired/);

  const replacement = await store.rotateSession(host.room.code, host.token);
  const staleTicket = await store.createSocketTicket(host.room.code, replacement.token);
  const stalePrincipal = await store.consumeSocketTicket(host.room.code, staleTicket);
  const rotatedAgain = await store.rotateSession(host.room.code, replacement.token);
  await assert.rejects(() => store.connectParticipant(host.room.code, host.participantId, "old-socket", stalePrincipal.sessionHash), /replaced/);
  await store.connectParticipant(host.room.code, host.participantId, "new-socket", (await store.createSocketTicket(host.room.code, rotatedAgain.token).then((value) => store.consumeSocketTicket(host.room.code, value))).sessionHash);
  await assert.rejects(() => store.submitActionForParticipant(host.room.code, host.participantId, "old-socket", stalePrincipal.sessionHash, {
    actionId: "old-socket-action", actorId: host.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" },
  }), /replaced/);
});
