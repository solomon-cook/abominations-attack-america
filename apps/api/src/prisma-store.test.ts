import assert from "node:assert/strict";
import test from "node:test";
import { createRoomGame } from "@abominations/game-engine";
import { PrismaRoomStore } from "./prisma-store.js";
import { persistentAdapter } from "./test-adapter.js";

test("durable receipt makes the same action idempotent across store instances", async () => {
  const { adapter, room, receipts } = persistentAdapter();
  const firstStore = new PrismaRoomStore(adapter);
  const secondStore = new PrismaRoomStore(adapter);
  const envelope = { actionId: "restart-safe", actorId: "player-1", expectedRevision: 0, protocolVersion: 1 as const, command: { type: "move" as const, path: ["los-angeles", "denver"] } };
  const first = await firstStore.submitAction(room.code, "token", envelope);
  const second = await secondStore.submitAction(room.code, "token", envelope);
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(receipts.size, 1);
  assert.equal(second.events.length, 1);
});

test("production Prisma room creation rejects the unresolved MVP board", async () => {
  const { adapter } = persistentAdapter();
  await assert.rejects(() => new PrismaRoomStore(adapter).createRoom(2), /MVP board is not ready/);
});

test("Prisma store health proves the database adapter is reachable", async () => {
  const { adapter } = persistentAdapter();
  assert.deepEqual(await new PrismaRoomStore(adapter).health(), { persistence: "prisma" });
});

test("terminal command persists completed room status and winner result atomically", async () => {
  const { adapter, room, results } = persistentAdapter();
  room.state.stompMarkers = 1;
  const store = new PrismaRoomStore(adapter);
  const command = async (actionId: string, expectedRevision: number, command: any) => store.submitAction(room.code, "token", { actionId, actorId: "player-1", expectedRevision, protocolVersion: 1, command });
  await command("finish-move", 0, { type: "move", path: ["los-angeles", "san-francisco"] });
  const result = await command("finish-encounter", 1, { type: "resolve-encounter", choice: "health" });
  assert.equal(room.status, "COMPLETED");
  assert.equal(result.status, "completed");
  assert.equal((results.get(room.id) as any).winnerId, "player-1");
  assert.deepEqual((results.get(room.id) as any).summary, {
    winnerPlayer: 0,
    victoryType: "development-stomp-exhaustion",
    rulesetVersion: "prototype-0.1",
    durationRounds: 1,
    terminalEvent: { type: "encounter.resolved", version: 2 },
    finalStandings: room.state.monsters.map((monster: any, playerIndex: number) => ({
      playerIndex,
      playerId: room.state.players[playerIndex].id,
      monsterId: monster.id,
      monsterName: monster.name,
      health: monster.health,
      infamy: monster.infamy,
      location: monster.location,
      winner: playerIndex === 0,
    })),
  });
});

test("Prisma setup actions persist the shared state and reject stale revisions", async () => {
  const { adapter, room } = persistentAdapter();
  room.state = createRoomGame(2);
  const store = new PrismaRoomStore(adapter);
  const first = await store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-1" }, 0);
  assert.equal(first.version, 1);
  assert.equal((first.state.setupState as any).seats[0].monsterId, "monster-1");
  await assert.rejects(() => store.setupAction(room.code, "token", { type: "choose-monster", monsterId: "monster-2" }, 0), /Expected revision/);
});
