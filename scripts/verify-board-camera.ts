import assert from "node:assert/strict";
import { AUDITED_BOARD, buildBoardIndex } from "../packages/game-engine/src/index.js";
import { AUDITED_BOARD_WORLD, AUDITED_TILE_WIDTH_PERCENT, buildDisplayHexLayout } from "../apps/web/src/board-layout.js";
import { cameraScale, cameraView, clampCamera, panCamera, resetCamera, screenToWorld, zoomCamera } from "../apps/web/src/board-camera.js";

const world = AUDITED_BOARD_WORLD;
const sizes = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }, { width: 2560, height: 1080 }];
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} versus ${expected}`);
for (const size of sizes) {
  let camera = resetCamera(size, world);
  for (const zoom of [.1, 1, 1.3, 2, 4, 100]) {
    camera = zoomCamera(camera, zoom, { x: size.width * .23, y: size.height * .71 }, size, world);
    assert.ok(camera.zoom >= 1 && camera.zoom <= 4);
    for (const delta of [{ x: 1e6, y: 1e6 }, { x: -1e6, y: -1e6 }, { x: 1e6, y: -1e6 }, { x: -1e6, y: 1e6 }]) {
      camera = panCamera(camera, delta, size, world);
      const view = cameraView(camera, size, world);
      assert.ok(view.x >= -1e-7 && view.y >= -1e-7, "camera cannot expose left/top off-map space");
      assert.ok(view.x + view.width <= world.width + 1e-7 && view.y + view.height <= world.height + 1e-7, "camera cannot expose right/bottom off-map space");
      for (const resized of sizes) {
        const nextView = cameraView(clampCamera(camera, resized, world), resized, world);
        assert.ok(nextView.x >= -1e-7 && nextView.y >= -1e-7);
        assert.ok(nextView.x + nextView.width <= world.width + 1e-7 && nextView.y + nextView.height <= world.height + 1e-7);
      }
    }
  }
  const centered = { ...resetCamera(size, world), zoom: 2 };
  const anchor = { x: size.width * .4, y: size.height * .45 };
  const before = screenToWorld(anchor, centered, size, world);
  const after = screenToWorld(anchor, zoomCamera(centered, 2.5, anchor, size, world), size, world);
  near(after.x, before.x, "zoom keeps pointer world X");
  near(after.y, before.y, "zoom keeps pointer world Y");
  near(cameraScale(resetCamera(size, world), size, world), Math.max(size.width / world.width, size.height / world.height), "reset uses strict cover");
}

const layout = buildDisplayHexLayout(AUDITED_BOARD);
assert.equal(layout.length, 336);
const centers = new Map(layout.map(({ hex, left, top }) => [hex.key, { x: left / 100 * world.width, y: top / 100 * world.height }]));
const tileWidth = AUDITED_TILE_WIDTH_PERCENT / 100 * world.width;
const tileHeight = tileWidth * Math.sqrt(3) / 2;
const index = buildBoardIndex(AUDITED_BOARD);
for (const [key, neighbors] of Object.entries(index.neighbours)) {
  for (const neighbor of neighbors) {
    const first = centers.get(key as keyof typeof AUDITED_BOARD.hexes)!;
    const second = centers.get(neighbor)!;
    assert.ok(Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - tileHeight) < .00001, `${key} and ${neighbor} must share a rendered edge`);
  }
}
console.log("Verified strict cover bounds, 1–4× zoom, pointer anchoring, resize clamping and audited neighbor geometry.");
