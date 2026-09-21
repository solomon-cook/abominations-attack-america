import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createGame, legalUnitPaths, shortestLegalUnitPaths, type GameState } from "./index.js";
import { AUDITED_BOARD, auditedCellKey } from "./audited-board.js";

function fixture(movement: GameState["units"][number]["movement"], move = 3): GameState {
  const state = createGame(2, 42);
  state.phase = "move";
  state.boardId = AUDITED_BOARD.id;
  state.boardVersion = AUDITED_BOARD.version;
  state.boardContentHash = AUDITED_BOARD.contentHash;
  state.units[0] = { ...state.units[0], id: "moving-unit", ownerPlayer: state.currentPlayer, location: auditedCellKey(4, 15), movement, move };
  state.monsters[0].location = auditedCellKey(4, 14);
  state.monsters[1].location = auditedCellKey(5, 15);
  return state;
}

for (const movement of ["land-only", "land-lake", "fly", "sea-seacoast-only"] as const) {
  test(`shortest unit routes preserve destinations and minimum costs: ${movement}`, () => {
    const state = fixture(movement);
    if (movement === "sea-seacoast-only") state.units[0].location = auditedCellKey(0, 0);
    const all = legalUnitPaths(state, "moving-unit");
    const shortest = shortestLegalUnitPaths(state, "moving-unit");
    const costs = new Map<string, number>();
    for (const path of all) costs.set(path.at(-1)!, Math.min(costs.get(path.at(-1)!) ?? Infinity, path.length));
    assert.deepEqual(shortest.map(path => path.at(-1)).sort(), [...costs.keys()].sort());
    for (const path of shortest) {
      assert.equal(path.length, costs.get(path.at(-1)!));
      assert.ok(all.some(candidate => candidate.join() === path.join()));
    }
    state.movedPieceIds.push("moving-unit");
    assert.deepEqual(shortestLegalUnitPaths(state, "moving-unit"), []);
  });
}

test("fast flying units return at most one route per board cell", () => {
  const state = fixture("fly", 8);
  const paths = shortestLegalUnitPaths(state, "moving-unit");
  assert.ok(paths.length > 100);
  assert.ok(paths.length < Object.keys(AUDITED_BOARD.hexes).length);
  assert.equal(new Set(paths.map(path => path.at(-1))).size, paths.length);
  assert.ok(paths.every(path => path.length <= 9));
});

test("shortest preview routes can be confirmed and held units become unavailable", () => {
  const state = fixture("fly", 6);
  const path = shortestLegalUnitPaths(state, "moving-unit").at(-1)!;
  const moved = applyCommand(state, { type: "move-unit", unitId: "moving-unit", path }).state;
  assert.equal(moved.units[0].location, path.at(-1));
  assert.deepEqual(shortestLegalUnitPaths(moved, "moving-unit"), []);
  const stayed = applyCommand(state, { type: "stay-piece", pieceId: "moving-unit" }).state;
  assert.deepEqual(shortestLegalUnitPaths(stayed, "moving-unit"), []);
});
