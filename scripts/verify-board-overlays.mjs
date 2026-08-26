import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const comparison = await readFile(new URL("../docs/board-comparison-overlay.svg", import.meta.url), "utf8");
const topDown = await readFile(new URL("../docs/board-top-down-overlay.svg", import.meta.url), "utf8");
const faceIds = [...comparison.matchAll(/data-row-column="([^"]+)"/g)].map((match) => match[1]);
assert.equal(faceIds.length, 336, "comparison overlay must contain every shell face");
assert.equal(new Set(faceIds).size, 336, "comparison overlay face labels must be unique");
assert.equal((topDown.match(/data-row-column="[^"]+"/g) ?? []).length, 336, "top-down overlay must contain every shell face");
assert.match(comparison, /source-photos-2026-08-26\/full-board-setup\.JPG/);
assert.match(comparison, /translate\(0 900\) rotate\(-90\)/, "authority photo must be in the registered orientation");
assert.match(comparison, /14 rendered rows with 24 faces each/);
assert.match(comparison, /24 full columns with 14 faces each/);
assert.match(comparison, /polygon points="[0-9.-]+,[0-9.-]+ [0-9.-]+,[0-9.-]+ [0-9.-]+,[0-9.-]+ [0-9.-]+,[0-9.-]+ [0-9.-]+,[0-9.-]+ [0-9.-]+,[0-9.-]+"/);
assert.equal((comparison.match(/class="barrier-edge/g) ?? []).length, 0, "from-scratch comparison overlay must not retain stale provisional barriers");
assert.match(topDown, /flat-top hex review overlay/);
console.log("Verified both 336-face flat-top overlays, registered authority orientation, and a clean from-scratch feature/barrier audit surface.");
