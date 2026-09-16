import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AUDITED_BOARD, AUDITED_CELLS, AUDIT_SOURCE_SHA256, AUDITED_ONE_SIDED_BARRIERS, auditedCellKey as key, auditedCoordinate, auditedRowColumn, AUDITED_EDGE_DIRECTIONS } from "./audited-board.js";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, hexDistance, validateBoardDefinition } from "./board.js";
import { applyCommand, applyCompletedSetup, auditedSetupDefinition, boardForState, createMvpRoomGame, createProvisionalPlaytestGame, migrateGameState, monsters, movementPathAllowed } from "./index.js";
import { chooseBranch, chooseLair, chooseMonster, chooseStartingChoice } from "./setup.js";

test("audited board matches all source cells and survives strict production validation", () => {
  const source = readFileSync(new URL("../../../docs/authoritative-board-human-audit.md", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), AUDIT_SOURCE_SHA256);
  assert.equal(AUDITED_CELLS.length, 336);
  assert.equal(Object.keys(AUDITED_BOARD.hexes).length, 336);
  assert.deepEqual(validateBoardDefinition(AUDITED_BOARD, { production: true }), []);
  const counts: Record<string, number> = {};
  for (const cell of AUDITED_CELLS) {
    const hex = AUDITED_BOARD.hexes[key(cell.row, cell.column)];
    assert.deepEqual(hex.audit, { row: cell.row, column: cell.column });
    assert.equal(hex.sourceRefs[0], cell.sourceRef);
    counts[hex.waterClass] = (counts[hex.waterClass] ?? 0) + 1;
  }
  assert.deepEqual(counts, { sea: 81, seacoast: 49, land: 187, lakeshore: 19 });
});

test("flat-top geometry makes every displayed neighbor exactly one engine step", () => {
  for (const cell of AUDITED_CELLS) {
    const coord = auditedCoordinate(cell.row, cell.column);
    assert.deepEqual(auditedRowColumn(coord), { row: cell.row, column: cell.column });
    const odd = cell.column % 2;
    const neighbors = [
      [cell.row - 1, cell.column], [cell.row - 1 + odd, cell.column + 1],
      [cell.row + odd, cell.column + 1], [cell.row + 1, cell.column],
      [cell.row + odd, cell.column - 1], [cell.row - 1 + odd, cell.column - 1],
    ].filter(([row, column]) => row >= 0 && row < 14 && column >= 0 && column < 24);
    const actual = AUDITED_BOARD.edges.filter((edge) => edge.from === key(cell.row, cell.column));
    assert.deepEqual(actual.map((edge) => edge.to).sort(), neighbors.map(([row, column]) => key(row, column)).sort());
    for (const edge of actual) assert.equal(hexDistance(coord, AUDITED_BOARD.hexes[edge.to].coord), 1);
  }
  assert.equal(AUDITED_EDGE_DIRECTIONS.length, 6);
});

test("audited edge marks are unioned reciprocally, including one-sided lake and sea lines", () => {
  assert.equal(AUDITED_ONE_SIDED_BARRIERS.length, 14);
  for (const edge of AUDITED_BOARD.edges) {
    const reverse = AUDITED_BOARD.edges.find((candidate) => candidate.from === edge.to && candidate.to === edge.from);
    assert.equal(reverse?.barrier, edge.barrier);
    assert.equal(reverse?.enabled, true);
  }
  assert.equal(AUDITED_BOARD.edges.find((edge) => edge.from === key(4, 18) && edge.to === key(5, 18))?.barrier, "lake");
  assert.equal(AUDITED_BOARD.edges.find((edge) => edge.from === key(5, 22) && edge.to === key(4, 22))?.barrier, "sea");
});

test("Chicago remains land-accessible while lake crossings and naval eligibility use distinct gates", () => {
  const chicago = key(4, 15);
  assert.equal(AUDITED_BOARD.hexes[chicago].label, "Chicago");
  assert.equal(movementPathAllowed(AUDITED_BOARD, [key(4, 14), chicago], "land-only"), true);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago, key(4, 16)], "land-only"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago, key(4, 16)], "land-lake"), true);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago], "sea-seacoast-only"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [chicago], "sea-seacoast-or-fly"), false);
  assert.equal(movementPathAllowed(AUDITED_BOARD, [key(3, 15)], "land-only"), true);
});

test("all six source monsters receive three audited lairs, including confirmed Tomanagi", () => {
  const setup = auditedSetupDefinition(2);
  assert.equal(setup.monsterIds.length, 6);
  for (const monster of monsters) {
    const lairs = setup.lairsByMonster[monster.id];
    assert.equal(lairs.length, 3);
    assert.equal(new Set(lairs).size, 3);
    for (const lair of lairs) assert.equal(AUDITED_BOARD.hexes[lair as keyof typeof AUDITED_BOARD.hexes].features.some((feature) => feature.kind === "lair" && feature.monsterId === monster.name.toLowerCase()), true);
  }
  assert.ok(setup.lairsByMonster["monster-2"].includes(key(10, 2)));
});

test("new rooms use audited pins and materialize selected monsters on their actual lairs", () => {
  const state = createMvpRoomGame(2, 77);
  assert.equal(boardForState(state), AUDITED_BOARD);
  let setup = state.setupState!;
  setup = chooseMonster(setup, 0, "monster-6");
  setup = chooseMonster(setup, 1, "monster-5");
  setup = chooseBranch(setup, 1, "Navy");
  setup = chooseBranch(setup, 0, "Army");
  setup = chooseLair(setup, 0, setup.definition.lairsByMonster["monster-6"][0]);
  setup = chooseLair(setup, 1, setup.definition.lairsByMonster["monster-5"][0]);
  setup = chooseStartingChoice(setup, 0, { kind: "research" });
  setup = chooseStartingChoice(setup, 1, { kind: "research" });
  const ready = applyCompletedSetup({ ...state, setupState: setup });
  assert.deepEqual(ready.monsters.map((monster) => monster.name), ["Gargantis", "Toxicor"]);
  assert.equal(ready.monsters[0].location, setup.seats[0].lair);
  assert.equal(ready.monsters[1].location, setup.seats[1].lair);
  assert.equal(ready.setupApplied, true);
  assert.equal(boardForState(migrateGameState(JSON.parse(JSON.stringify(ready)))), AUDITED_BOARD);
});

test("legacy match board identities stay available and reject mismatched pins", () => {
  for (const board of [DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD]) {
    assert.equal(boardForState({ boardId: board.id, boardVersion: board.version, boardContentHash: board.contentHash }), board);
  }
  const state = createProvisionalPlaytestGame(2);
  assert.equal(boardForState(migrateGameState(JSON.parse(JSON.stringify(state)))), PROVISIONAL_AUTHORITATIVE_BOARD);
  assert.throws(() => boardForState({ ...state, boardContentHash: AUDITED_BOARD.contentHash }), /unavailable/);
});


test("off-board recovery returns to the audited lair or audited Los Angeles", () => {
  for (const position of ["disappeared", "hollywood"] as const) {
    const state = createMvpRoomGame(2, 9);
    state.setupState = undefined;
    state.setupAssignments = state.monsters.map((monster, playerIndex) => ({ playerIndex, monsterId: monster.id, lair: auditedSetupDefinition(2).lairsByMonster[monster.id][0], ready: true }));
    state.currentPlayer = 1;
    state.phase = "deploy";
    state.monsters[0].location = position;
    state.monsters[0].health = 8;
    const returned = applyCommand(state, { type: "pass-deploy" }).state;
    assert.equal(returned.currentPlayer, 0);
    assert.equal(returned.monsters[0].location, position === "hollywood" ? key(8, 2) : state.setupAssignments[0].lair);
    assert.ok(AUDITED_BOARD.hexes[returned.monsters[0].location as keyof typeof AUDITED_BOARD.hexes]);
  }
});
