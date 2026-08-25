import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createGame } from "./index.js";

test("a legal move advances the game to fight", () => {
  const state = createGame(2);
  const result = applyCommand(state, { type: "move", destination: "denver" });
  assert.equal(result.state.phase, "fight");
  assert.equal(result.state.monsters[0].location, "denver");
  assert.equal(result.eventType, "monster.moved");
});

test("an illegal move is rejected", () => {
  assert.throws(() => applyCommand(createGame(2), { type: "move", destination: "new-york" }));
});

test("a complete turn returns to move for the next player", () => {
  let state = createGame(2);
  state = applyCommand(state, { type: "move", destination: "denver" }).state;
  state = applyCommand(state, { type: "advance" }).state;
  state = applyCommand(state, { type: "advance" }).state;
  state = applyCommand(state, { type: "advance" }).state;
  assert.equal(state.phase, "move");
  assert.equal(state.currentPlayer, 1);
});
