import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDisplayHexLayout,
  DISPLAY_BOARD_LEFT_PERCENT,
  DISPLAY_BOARD_ASPECT_RATIO,
  DISPLAY_BOARD_TOP_PERCENT,
  DISPLAY_BOARD_TOP_SPAN_PERCENT,
  DISPLAY_TILE_ASPECT_RATIO,
  DISPLAY_TILE_STEP_PERCENT,
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
    assert.equal(Number((centers[index]! - centers[index - 1]!).toFixed(2)), DISPLAY_TILE_STEP_PERCENT, `row ${row} has a horizontal center step that does not match the layout step`);
  }
}

const evenStart = rows.get(0)![0]!.left;
const oddStart = rows.get(1)![0]!.left;
assert.ok(Math.abs(oddStart - evenStart - DISPLAY_TILE_STEP_PERCENT / 2) < 0.001, "odd rows must be offset by half a layout step");
assert.ok(layout.every((entry) => entry.left >= DISPLAY_BOARD_LEFT_PERCENT && entry.left <= 95), "horizontal centers must remain inside the board");
assert.ok(layout.every((entry) => entry.top >= DISPLAY_BOARD_TOP_PERCENT && entry.top <= DISPLAY_BOARD_TOP_PERCENT + DISPLAY_BOARD_TOP_SPAN_PERCENT), "vertical centers must remain inside the board");

const tileHeight = DISPLAY_TILE_WIDTH_PERCENT / DISPLAY_TILE_ASPECT_RATIO;
const rowStep = DISPLAY_BOARD_TOP_SPAN_PERCENT / 12;
assert.ok(DISPLAY_TILE_ASPECT_RATIO > 1, "flat-top landscape tiles must be wider than they are tall");
assert.ok(Math.abs(rowStep - tileHeight * DISPLAY_BOARD_ASPECT_RATIO) < 0.01, `row step ${rowStep.toFixed(2)} must match the canvas-scaled tile height ${(tileHeight * DISPLAY_BOARD_ASPECT_RATIO).toFixed(2)} for shared horizontal edges`);
assert.ok(Math.abs(DISPLAY_TILE_STEP_PERCENT - DISPLAY_TILE_WIDTH_PERCENT) < 0.01, "flat-top row pitch must equal tile width to prevent polygon overlap");
assert.ok(DISPLAY_BOARD_LEFT_PERCENT - DISPLAY_TILE_WIDTH_PERCENT / 2 > 0, "left tile bounds must remain inside the map");
assert.ok(layout.find((entry) => entry.row === 0 && entry.column === 19)!.left + DISPLAY_TILE_WIDTH_PERCENT / 2 < 100, "rightmost tile bounds must remain inside the map");

type Point = readonly [number, number];

function hexPolygon(left: number, top: number): readonly Point[] {
  const halfWidth = DISPLAY_TILE_WIDTH_PERCENT / 2;
  const halfHeight = tileHeight / 2;
  return [
    [left - halfWidth, top],
    [left - halfWidth / 2, top - halfHeight],
    [left + halfWidth / 2, top - halfHeight],
    [left + halfWidth, top],
    [left + halfWidth / 2, top + halfHeight],
    [left - halfWidth / 2, top + halfHeight],
  ];
}

function polygonAxes(polygon: readonly Point[]): readonly Point[] {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return [-(next[1] - point[1]), next[0] - point[0]] as const;
  });
}

function project(polygon: readonly Point[], axis: Point): readonly [number, number] {
  const values = polygon.map(([x, y]) => x * axis[0] + y * axis[1]);
  return [Math.min(...values), Math.max(...values)];
}

function hasInteriorIntersection(first: readonly Point[], second: readonly Point[]): boolean {
  for (const axis of [...polygonAxes(first), ...polygonAxes(second)]) {
    const [firstMin, firstMax] = project(first, axis);
    const [secondMin, secondMax] = project(second, axis);
    if (Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin) <= 0.000001) return false;
  }
  return true;
}

const polygons = layout.map((entry) => ({ entry, polygon: hexPolygon(entry.left, entry.top) }));
for (let firstIndex = 0; firstIndex < polygons.length; firstIndex += 1) {
  const first = polygons[firstIndex]!;
  for (let secondIndex = firstIndex + 1; secondIndex < polygons.length; secondIndex += 1) {
    const second = polygons[secondIndex]!;
    assert.equal(
      hasInteriorIntersection(first.polygon, second.polygon),
      false,
      `hex polygons ${first.entry.hex.key} and ${second.entry.hex.key} must not overlap`,
    );
  }
}

const styles = readFileSync(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const renderedHexStyles = [...styles.matchAll(/\.hex-tile\{[^}]+\}/g)];
const renderedHexStyle = renderedHexStyles.at(-1)?.[0] ?? "";
assert.match(renderedHexStyle, /width:4\.45%/,
  "rendered candidate faces must use the canonical layout width so neighbouring faces remain separated");
assert.match(renderedHexStyle, /aspect-ratio:1\.1547005/,
  "rendered candidate faces must retain the flat-top landscape aspect ratio");
const developmentFixtureStyles = [...styles.matchAll(/\.hex-tile\.development-fixture\{[^}]+\}/g)];
const developmentFixtureStyle = developmentFixtureStyles.at(-1)?.[0] ?? "";
assert.match(developmentFixtureStyle, /aspect-ratio:1\.1547005/,
  "development fixture tiles must retain the landscape hex aspect ratio");
assert.match(developmentFixtureStyle, /clip-path:polygon\(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%\)/,
  "development fixture tiles must render as flat-top hexagons");
assert.doesNotMatch(developmentFixtureStyle, /clip-path:circle/,
  "development fixture tiles must not regress to circular markers");

const unresolvedFaceStyle = [...styles.matchAll(/\.hex-tile\.unresolved\{[^}]+\}/g)].at(-1)?.[0] ?? "";
assert.match(unresolvedFaceStyle, /background:linear-gradient\(145deg,#eee7cb,#cfc5a2\)/,
  "unresolved full-board review faces must use the separated cream treatment");
assert.match(unresolvedFaceStyle, /border:1px solid #fff7d8/,
  "unresolved full-board review faces must retain a visible cream seam");
const unresolvedSeamStyle = [...styles.matchAll(/\.hex-tile\.unresolved::before\{[^}]+\}/g)].at(-1)?.[0] ?? "";
assert.match(unresolvedSeamStyle, /border-color:#fff9df/,
  "unresolved full-board review faces must retain an inset face seam");

console.log(`Verified 254-cell flat-top landscape honeycomb display layout with staggered rows, ${tileHeight.toFixed(2)}% canvas-width tile height, and shared hex edges.`);
