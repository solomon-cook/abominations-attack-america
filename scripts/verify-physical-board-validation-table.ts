import { readFileSync } from "node:fs";
import { PROVISIONAL_AUTHORITATIVE_BOARD } from "../packages/game-engine/src/board.ts";

const path = "docs/physical-board-validation-table.md";
const document = readFileSync(path, "utf8");
const featureSection = document.slice(
  document.indexOf("## Gameplay-feature faces"),
  document.indexOf("## Sites and overlays needing separate checks"),
);
const tableRows = [...featureSection.matchAll(/^\| (\d+) \/ (\d+) \|/gm)].map((match) => `${match[1]}/${match[2]}`);
const expectedRows = Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes)
  .filter((hex) => hex.features.length > 0)
  .map((hex) => `${hex.coord.r}/${hex.coord.q + Math.floor(hex.coord.r / 2)}`);
const expected = new Set(expectedRows);
const actual = new Set(tableRows);
const missing = [...expected].filter((row) => !actual.has(row));
const extra = [...actual].filter((row) => !expected.has(row));
if (actual.size !== expected.size || missing.length > 0 || extra.length > 0) {
  throw new Error(`Physical-board validation table drifted: expected ${expected.size} populated faces, found ${actual.size}; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}
if (!featureSection.includes("Your correction / confirmation") || !featureSection.includes("Decision")) {
  throw new Error("Physical-board validation table must retain editable correction and decision columns.");
}
console.log(`Verified physical-board validation table coverage: ${actual.size} populated candidate faces with editable correction columns.`);
