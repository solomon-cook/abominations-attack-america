import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { PrismaRoomStore } from "./prisma-store.js";
import { persistentAdapter } from "./test-adapter.js";

type ContractFixture = { store: RoomStore; code: string; token: string; participantId: string };

async function memoryFixture(): Promise<ContractFixture> {
  const store = new MemoryRoomStore(true);
  const host = await store.createRoom(2);
  const guest = await store.joinRoom(host.room.code, "Guest");
  let revision = host.room.version;
  for (const [playerIndex, monsterId] of [[0, "monster-1"], [1, "monster-2"]] as const) {
    revision = (await store.setupAction(host.room.code, [host, guest][playerIndex]!.token, { type: "choose-monster", monsterId }, revision)).version;
  }
  for (const [playerIndex, branch] of [[1, "Navy"], [0, "Army"]] as const) {
    revision = (await store.setupAction(host.room.code, [host, guest][playerIndex]!.token, { type: "choose-branch", branch }, revision)).version;
  }
  for (const [playerIndex, lair] of [[0, "los-angeles"], [1, "chicago"]] as const) {
    revision = (await store.setupAction(host.room.code, [host, guest][playerIndex]!.token, { type: "choose-lair", lair }, revision)).version;
  }
  for (const player of [host, guest]) revision = (await store.setupAction(host.room.code, player.token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }, revision)).version;
  await store.setReady(host.room.code, host.token, true);
  await store.setReady(host.room.code, guest.token, true);
  return { store, code: host.room.code, token: host.token, participantId: host.participantId };
}

async function runRoomStoreContract(label: string, fixture: ContractFixture): Promise<void> {
  const initial = await fixture.store.getRoom(fixture.code, fixture.token);
  assert.equal(initial.state.boardId, "development-nine-location", `${label}: board id`);
  assert.equal(initial.state.boardContentHash.startsWith("fnv1a:"), true, `${label}: board hash`);
  assert.deepEqual(initial.state.decks.mutation.order, [], `${label}: mutation order redacted`);
  assert.deepEqual(initial.state.decks.research.order, [], `${label}: research order redacted`);
  await assert.rejects(() => fixture.store.submitAction(fixture.code, fixture.token, {
    actionId: `${label}-stale`, actorId: fixture.participantId, expectedRevision: initial.version - 1, protocolVersion: 1,
    command: { type: "pass-move" },
  }), /Expected revision/);
  const envelope = {
    actionId: `${label}-idempotent`, actorId: fixture.participantId, expectedRevision: initial.version, protocolVersion: 1 as const,
    command: { type: "pass-move" as const },
  };
  const first = await fixture.store.submitAction(fixture.code, fixture.token, envelope);
  const retry = await fixture.store.submitAction(fixture.code, fixture.token, envelope);
  assert.equal(first.version, initial.version + 1, `${label}: revision increments once`);
  assert.equal(retry.version, first.version, `${label}: duplicate retry does not increment`);
  assert.deepEqual(retry.state, first.state, `${label}: duplicate retry returns same state`);
}

test("MemoryRoomStore and PrismaRoomStore satisfy the same public room contract", async () => {
  await runRoomStoreContract("memory", await memoryFixture());
  const prisma = persistentAdapter();
  await runRoomStoreContract("prisma", { store: new PrismaRoomStore(prisma.adapter), code: prisma.room.code, token: "token", participantId: "player-1" });
});
