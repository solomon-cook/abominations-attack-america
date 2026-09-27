import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "@abominations/game-engine";
import { completedMatchRows, emptyMatchCounters, sumPlayerStats, updateMatchCounters } from "./player-stats.js";

test("authoritative counter deltas count real Health, stomps, raw dice, and ties", () => {
  const before = {
    players: [{}, {}],
    monsters: [{ health: 4 }, { health: 9 }],
    currentPlayer: 0,
    stompedLocations: [],
    dieRollHistory: [],
  } as unknown as GameState;
  const after = {
    ...before,
    monsters: [{ health: 7 }, { health: 6 }],
    stompedLocations: ["10,10"],
    dieRollHistory: [1, 6],
  } as unknown as GameState;
  const counters = updateMatchCounters(before, after, emptyMatchCounters(2), 1);
  assert.equal(counters[0]?.healthGained, 3);
  assert.equal(counters[1]?.damageTaken, 3);
  assert.equal(counters[1]?.stompedTiles, 1);
  assert.equal(counters[1]?.luckRolls, 2);
  assert.equal(counters[1]?.luckTotal, 0);

  const state = {
    players: [{ id: "p1" }, { id: "p2" }],
    monsters: [{ id: "m1", name: "Konk" }, { id: "m2", name: "Zorb" }],
    setupAssignments: [{ playerIndex: 0, branch: "Army" }, { playerIndex: 1, branch: "Navy" }],
    winnerPlayer: undefined,
    round: 3,
  } as unknown as GameState;
  const rows = completedMatchRows("room-1", state, counters, [
    { participantId: "seat-1", userId: "user-1", username: "one", playerIndex: 0, botAssisted: false },
    { participantId: "seat-2", userId: "user-2", username: "two", playerIndex: 1, botAssisted: true },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.outcome, "tie");
  assert.equal(rows[1]?.outcome, "tie");
  assert.equal(rows[1]?.botAssisted, true);
  const stats = sumPlayerStats([rows[1]!], "two");
  assert.equal(stats.gamesPlayed, 1);
  assert.equal(stats.wins, 0);
  assert.equal(stats.losses, 0);
  assert.equal(stats.ties, 1);
  assert.equal(stats.luckAverage, 0);
  assert.equal(stats.mostChosenMonster, "Zorb");
  assert.equal(stats.mostChosenBranch, "Navy");
});

test("luck is null until a player has at least one recorded roll", () => {
  const stats = sumPlayerStats([], "new-player");
  assert.equal(stats.luckRolls, 0);
  assert.equal(stats.luckAverage, null);
});
