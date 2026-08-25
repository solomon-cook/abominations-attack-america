import assert from "node:assert/strict";
import {
  buildDisplayHexLayout,
  DISPLAY_BOARD_LEFT_PERCENT,
  DISPLAY_BOARD_TOP_PERCENT,
  DISPLAY_BOARD_TOP_SPAN_PERCENT,
  DISPLAY_TILE_ASPECT_RATIO,
  DISPLAY_TILE_WIDTH_PERCENT,
} from "../apps/web/src/board-layout.js";

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
  const centers = cells.map((entry) => entry.left).sort((a, b) => a - b);
  for (let index = 1; index < centers.length; index += 1) {
    assert.equal(Number((centers[index]! - centers[index - 1]!).toFixed(2)), DISPLAY_TILE_WIDTH_PERCENT, `row ${row} has a horizontal center gap that does not match the tile width`);
  }
}

const evenStart = rows.get(0)![0]!.left;
const oddStart = rows.get(1)![0]!.left;
assert.equal(Number((oddStart - evenStart).toFixed(2)), 2.3, "odd rows must be offset by half a tile");
assert.ok(layout.every((entry) => entry.left >= DISPLAY_BOARD_LEFT_PERCENT && entry.left <= 95), "horizontal centers must remain inside the board");
assert.ok(layout.every((entry) => entry.top >= DISPLAY_BOARD_TOP_PERCENT && entry.top <= DISPLAY_BOARD_TOP_PERCENT + DISPLAY_BOARD_TOP_SPAN_PERCENT), "vertical centers must remain inside the board");

const tileHeight = DISPLAY_TILE_WIDTH_PERCENT / DISPLAY_TILE_ASPECT_RATIO;
const rowStep = DISPLAY_BOARD_TOP_SPAN_PERCENT / 12;
assert.ok(DISPLAY_TILE_ASPECT_RATIO > 0 && DISPLAY_TILE_ASPECT_RATIO < 1, "pointy-top tiles must be taller than they are wide");
assert.ok(rowStep > tileHeight, `row step ${rowStep.toFixed(2)} must exceed tile height ${tileHeight.toFixed(2)} to leave a visible vertical gap`);
assert.ok(DISPLAY_BOARD_LEFT_PERCENT - DISPLAY_TILE_WIDTH_PERCENT / 2 > 0, "left tile bounds must remain inside the map");
assert.ok(layout.find((entry) => entry.row === 0 && entry.column === 19)!.left + DISPLAY_TILE_WIDTH_PERCENT / 2 < 100, "rightmost tile bounds must remain inside the map");

console.log(`Verified 254-cell pointy-top honeycomb display layout with staggered landscape rows, ${tileHeight.toFixed(2)}% tile height, and non-overlapping bounds.`);
