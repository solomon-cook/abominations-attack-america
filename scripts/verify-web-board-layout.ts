import assert from "node:assert/strict";
import { buildDisplayHexLayout } from "../apps/web/src/board-layout.js";

const layout = buildDisplayHexLayout();
assert.equal(layout.length, 254, "display layout must contain every candidate hex");
assert.equal(new Set(layout.map((entry) => entry.hex.key)).size, 254, "display keys must be unique");

const rows = new Map<number, typeof layout>();
for (const entry of layout) rows.set(entry.row, [...(rows.get(entry.row) ?? []), entry]);
assert.equal(rows.size, 13, "display layout must contain 13 rows");
for (let row = 0; row < 13; row += 1) {
  const cells = rows.get(row) ?? [];
  assert.equal(cells.length, row % 2 === 0 ? 20 : 19, `row ${row} has the wrong cell count`);
  assert.equal(new Set(cells.map((entry) => entry.left)).size, cells.length, `row ${row} has duplicate centers`);
  assert.equal(new Set(cells.map((entry) => entry.top)).size, 1, `row ${row} is not level`);
}

const evenStart = rows.get(0)![0]!.left;
const oddStart = rows.get(1)![0]!.left;
assert.equal(Number((oddStart - evenStart).toFixed(2)), 2.3, "odd rows must be offset by half a tile");
assert.ok(layout.every((entry) => entry.left >= 5.5 && entry.left <= 95), "horizontal centers must remain inside the board");
assert.ok(layout.every((entry) => entry.top >= 10 && entry.top <= 90), "vertical centers must remain inside the board");

console.log("Verified 254-cell pointy-top honeycomb display layout with staggered landscape rows.");
