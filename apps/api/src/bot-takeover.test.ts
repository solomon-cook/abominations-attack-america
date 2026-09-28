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
  const principal = await store.consumeSocketTicket(host.room.code, ticket.ticket);
  assert.equal(principal.participantId, host.participantId);
  await assert.rejects(() => store.consumeSocketTicket(host.room.code, ticket.ticket), /invalid or expired/);

  const replacement = await store.rotateSession(host.room.code, host.token);
  const staleTicket = await store.createSocketTicket(host.room.code, replacement.token);
  const stalePrincipal = await store.consumeSocketTicket(host.room.code, staleTicket.ticket);
  const rotatedAgain = await store.rotateSession(host.room.code, replacement.token);
  await assert.rejects(() => store.connectParticipant(host.room.code, host.participantId, "old-socket", stalePrincipal.sessionHash), /replaced/);
  const newSocketTicket = await store.createSocketTicket(host.room.code, rotatedAgain.token);
  const newSocketPrincipal = await store.consumeSocketTicket(host.room.code, newSocketTicket.ticket);
  await store.connectParticipant(host.room.code, host.participantId, newSocketPrincipal.connectionId, newSocketPrincipal.sessionHash);
  await assert.rejects(() => store.submitActionForParticipant(host.room.code, host.participantId, "old-socket", stalePrincipal.sessionHash, {
    actionId: "old-socket-action", actorId: host.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" },
  }), /replaced/);
});

test("socket projections follow only the newest connected lease and revoked session", async () => {
  const store = new MemoryRoomStore();
  const host = await store.createRoom(2);
  const delayedTicket = await store.createSocketTicket(host.room.code, host.token);
  const delayed = await store.consumeSocketTicket(host.room.code, delayedTicket.ticket);
  await store.connectParticipant(host.room.code, delayed.participantId, delayed.connectionId, delayed.sessionHash);
  assert.ok(await store.getRoomForConnection(host.room.code, delayed.participantId, delayed.connectionId, delayed.sessionHash));

  const currentTicket = await store.createSocketTicket(host.room.code, host.token, delayedTicket.connectionId);
  await assert.rejects(() => store.createSocketTicket(host.room.code, host.token, delayedTicket.connectionId), /connection was replaced/);
  assert.equal(await store.getRoomForConnection(host.room.code, delayed.participantId, delayed.connectionId, delayed.sessionHash), undefined);
  await assert.rejects(() => store.connectParticipant(host.room.code, delayed.participantId, delayed.connectionId, delayed.sessionHash), /replaced/);
  await assert.rejects(() => store.submitActionForParticipant(host.room.code, delayed.participantId, delayed.connectionId, delayed.sessionHash, {
    actionId: "delayed-socket-action", actorId: host.participantId, expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" },
  }), /replaced/);
  await store.disconnectParticipant(host.room.code, delayed.participantId, delayed.connectionId);
  assert.equal((await store.getRoom(host.room.code, host.token)).participants.find((participant) => participant.id === host.participantId)?.connected, false);

  const current = await store.consumeSocketTicket(host.room.code, currentTicket.ticket);
  assert.equal(current.connectionId, currentTicket.connectionId);
  await store.connectParticipant(host.room.code, current.participantId, current.connectionId, current.sessionHash);
  assert.ok(await store.getRoomForConnection(host.room.code, current.participantId, current.connectionId, current.sessionHash));

  await store.reconnect(host.room.code, host.token, current.connectionId, "polling-lease");
  assert.equal(await store.getRoomForConnection(host.room.code, current.participantId, current.connectionId, current.sessionHash), undefined);
  assert.ok(await store.getRoomForConnection(host.room.code, current.participantId, "polling-lease", current.sessionHash));

  const rotated = await store.rotateSession(host.room.code, host.token);
  assert.equal(await store.getRoomForConnection(host.room.code, current.participantId, "polling-lease", current.sessionHash), undefined);
  assert.ok(rotated.token);
});
