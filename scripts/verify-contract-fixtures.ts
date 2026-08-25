import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCommandEnvelope, createGame, DEVELOPMENT_BOARD, projectState, type GameCommandEnvelope } from "@abominations/game-engine";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (name: string) => JSON.parse(await readFile(resolve(root, "contracts/development", name), "utf8")) as Record<string, any>;

async function verify(): Promise<void> {
  const board = await read("board.json");
  const command = await read("command.json") as unknown as GameCommandEnvelope;
  const event = await read("event.json");
  const error = await read("error.json");
  const projection = await read("projection.json");
  const snapshot = await read("snapshot.json");

assert.equal(board.boardId, DEVELOPMENT_BOARD.id);
assert.equal(board.boardVersion, DEVELOPMENT_BOARD.version);
assert.equal(board.contentHash, DEVELOPMENT_BOARD.contentHash);
assert.deepEqual(board.hexKeys, Object.keys(DEVELOPMENT_BOARD.hexes).sort());
assert.equal(board.productionReady, false);
assert.deepEqual(Object.values(error).sort(), ["ILLEGAL_COMMAND", "INVALID_COMMAND_ENVELOPE", "STALE_REVISION", "UNSUPPORTED_PROTOCOL"]);

const initial = createGame(2);
const result = applyCommandEnvelope(initial, command, 0);
assert.equal(result.eventType, event.eventType);
assert.deepEqual(result.eventPayload, event.eventPayload);
assert.deepEqual(result.receipt, event.receipt);

const spectator = projectState(result.state, "spectator");
assert.equal(spectator.decks.mutation.order.length, 0);
assert.equal(spectator.decks.research.order.length, 0);
assert.equal(spectator.boardId, board.boardId);
assert.equal(spectator.boardContentHash, board.contentHash);
assert.equal(spectator.pendingDecision?.type, "encounter-resolution");
assert.equal(projection.redactedDeckOrder, true);
assert.equal(projection.redactedPrivateCards, true);
assert.equal(snapshot.schemaVersion, initial.schemaVersion);
assert.equal(snapshot.boardId, initial.boardId);
assert.equal(snapshot.boardContentHash, initial.boardContentHash);
assert.equal(snapshot.phase, initial.phase);
assert.equal(snapshot.round, initial.round);
assert.equal(snapshot.currentPlayer, initial.currentPlayer);
  console.log("Verified development JSON contract fixtures for board, command, event, error, projection, and snapshot boundaries.");
}

verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
