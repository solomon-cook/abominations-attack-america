import assert from "node:assert/strict";
import test from "node:test";
import { chooseBranch, chooseLair, chooseMonster, chooseStartingChoice, createSetup, validateSetup } from "./setup.js";

const definition = {
  playerCount: 3 as const,
  monsterIds: ["monster-a", "monster-b", "monster-c", "monster-d"],
  eligibleBranches: ["Army", "Navy", "Air Force"] as const,
  lairsByMonster: {
    "monster-a": ["lair-a-1", "lair-a-2", "lair-a-3"],
    "monster-b": ["lair-b-1", "lair-b-2", "lair-b-3"],
    "monster-c": ["lair-c-1", "lair-c-2", "lair-c-3"]
  }
};

test("setup enforces ordered monster selection and reverse branch selection", () => {
  let state = createSetup(definition);
  state = chooseMonster(state, 0, "monster-a");
  state = chooseMonster(state, 1, "monster-b");
  state = chooseMonster(state, 2, "monster-c");
  assert.equal(state.phase, "branch-selection");
  assert.throws(() => chooseBranch(state, 0, "Army"), /reverse seat order/);
  state = chooseBranch(state, 2, "Army");
  state = chooseBranch(state, 1, "Navy");
  state = chooseBranch(state, 0, "Air Force");
  assert.equal(state.phase, "lair-selection");
});

test("setup rejects duplicate assignments and invalid lairs", () => {
  let state = createSetup({ ...definition, playerCount: 2, monsterIds: ["monster-a", "monster-b"], eligibleBranches: ["Army", "Navy"] });
  state = chooseMonster(state, 0, "monster-a");
  assert.throws(() => chooseMonster(state, 1, "monster-a"), /already been claimed/);
  state = chooseMonster(state, 1, "monster-b");
  state = chooseBranch(state, 1, "Army");
  state = chooseBranch(state, 0, "Navy");
  assert.throws(() => chooseLair(state, 0, "lair-b-1"), /not valid/);
});

test("a complete setup requires distinct lairs and a starting choice for every player", () => {
  let state = createSetup(definition);
  state = chooseMonster(state, 0, "monster-a");
  state = chooseMonster(state, 1, "monster-b");
  state = chooseMonster(state, 2, "monster-c");
  state = chooseBranch(state, 2, "Army");
  state = chooseBranch(state, 1, "Navy");
  state = chooseBranch(state, 0, "Air Force");
  state = chooseLair(state, 0, "lair-a-1");
  state = chooseLair(state, 1, "lair-b-1");
  state = chooseLair(state, 2, "lair-c-1");
  state = chooseStartingChoice(state, 0, { kind: "research" });
  state = chooseStartingChoice(state, 1, { kind: "deploy", unitId: "fixture-unit-1", destination: "fixture-base" });
  state = chooseStartingChoice(state, 2, { kind: "research" });
  validateSetup(state);
  assert.equal(state.phase, "complete");
});

test("the setup model accepts a complete four-seat fixture", () => {
  const four = {
    playerCount: 4 as const,
    monsterIds: ["a", "b", "c", "d"],
    eligibleBranches: ["Army", "Navy", "Air Force", "Marines"] as const,
    lairsByMonster: { a: ["a-lair-1", "a-lair-2", "a-lair-3"], b: ["b-lair-1", "b-lair-2", "b-lair-3"], c: ["c-lair-1", "c-lair-2", "c-lair-3"], d: ["d-lair-1", "d-lair-2", "d-lair-3"] }
  };
  let state = createSetup(four);
  for (const [playerIndex, monsterId] of four.monsterIds.entries()) state = chooseMonster(state, playerIndex, monsterId);
  for (const playerIndex of [3, 2, 1, 0]) state = chooseBranch(state, playerIndex, four.eligibleBranches[playerIndex]);
  for (const playerIndex of [0, 1, 2, 3]) state = chooseLair(state, playerIndex, `${four.monsterIds[playerIndex]}-lair-1`);
  for (const playerIndex of [0, 1, 2, 3]) state = chooseStartingChoice(state, playerIndex, { kind: "research" });
  validateSetup(state);
});
