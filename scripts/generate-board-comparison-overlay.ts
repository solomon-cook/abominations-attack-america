import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, type BoardHex } from "../packages/game-engine/src/board.ts";

const width = 1600;
const height = 900;
const source = "../references/monsters-menace-america/components/source-photos-2026-08-26/full-board-setup.JPG";
// The supplied authority photo is portrait-oriented on disk and is rotated
// clockwise into this 1600 x 900 landscape view. The printed board uses
// flat-top hexes: the horizontal axis is the complete 24-column rectangle and
// the alternating vertical offsets create the honeycomb. Edge cells remain
// present even when the photograph crops them or shows them as empty/sea.

function displayColumns(): BoardHex[][] {
  return Array.from({ length: 24 }, (_, column) => Object.values(FULL_HONEYCOMB_BOARD.hexes)
    .filter((hex) => hex.coord.q + Math.floor(hex.coord.r / 2) === column)
    .sort((a, b) => a.coord.r - b.coord.r));
}

function displayPosition(hex: BoardHex): readonly [number, number] {
  const column = hex.coord.q + Math.floor(hex.coord.r / 2);
  const row = displayColumns()[column]!.findIndex((candidate) => candidate.key === hex.key);
  return [row, column];
}

function cellCenter(row: number, column: number): readonly [number, number] {
  // Flat-top hex geometry: width = 2r, height = sqrt(3)r, horizontal
  // centre pitch = 3r/2, and alternate rows are half a face-height lower.
  // These registration values are intentionally kept in one place so they
  // can be fitted against the authority photograph without changing IDs.
  // Calibrated against the repeated printed seams in the upright authority
  // photo. The first visible face is deliberately offset from the image
  // edge; the shell has cropped faces at its perimeter.
  const radius = 32.5;
  const faceHeight = radius * Math.sqrt(3);
  return [220 + radius * 1.5 * column, 65 + faceHeight * (row + (column % 2 ? 0.5 : 0))];
}

function polygon(cx: number, cy: number, radiusX: number, radiusY: number): string {
  return [
    [cx - radiusX * 0.5, cy - radiusY], [cx + radiusX * 0.5, cy - radiusY],
    [cx + radiusX, cy], [cx + radiusX * 0.5, cy + radiusY],
    [cx - radiusX * 0.5, cy + radiusY], [cx - radiusX, cy],
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

const cellOverlays = displayColumns().flatMap((column, columnIndex) => column.map((hex) => {
  const [rowIndex, displayColumn] = displayPosition(hex);
  const [cx, cy] = cellCenter(rowIndex, displayColumn);
  const points = polygon(cx, cy, 32.5, 32.5 * Math.sqrt(3) / 2);
  const rowColumn = `${rowIndex}/${displayColumn}`;
  return `<g class="review-cell" data-hex-key="${hex.key}" data-row-column="${rowColumn}"><polygon points="${points}"/><text x="${cx.toFixed(1)}" y="${(cy + 2).toFixed(1)}">${rowColumn}</text></g>`;
})).join("\n");

// The feature layer is intentionally empty while the physical transcription
// is restarted against this corrected mesh.
const featureOverlays = "";

function centreForKey(key: string): readonly [number, number] | undefined {
  const hex = FULL_HONEYCOMB_BOARD.hexes[key];
  if (!hex) return undefined;
  const [row, column] = displayPosition(hex);
  return cellCenter(row, column);
}

function verticesForCentre([cx, cy]: readonly [number, number]): readonly (readonly [number, number])[] {
  return [
    [cx - 16.25, cy - 32.5 * Math.sqrt(3) / 2], [cx + 16.25, cy - 32.5 * Math.sqrt(3) / 2], [cx + 32.5, cy],
    [cx + 16.25, cy + 32.5 * Math.sqrt(3) / 2], [cx - 16.25, cy + 32.5 * Math.sqrt(3) / 2], [cx - 32.5, cy],
  ];
}

function sharedEdge(from: readonly [number, number], to: readonly [number, number]): readonly [readonly [number, number], readonly [number, number]] | undefined {
  const fromVertices = verticesForCentre(from);
  const toVertices = verticesForCentre(to);
  const shared = fromVertices.filter(([x, y]) => toVertices.some(([otherX, otherY]) => Math.hypot(x - otherX, y - otherY) < 0.1));
  return shared.length === 2 ? [shared[0]!, shared[1]!] : undefined;
}

const barrierOverlays = "";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">336-cell flat-top honeycomb board comparison overlay</title>
  <desc id="description">A cell-centred flat-top hex review overlay over the source board photograph. Labels identify the face they are drawn inside; they are not printed-board labels and do not assert any printed board rule data. The overlay has 14 rendered rows with 24 faces each and 24 full columns with 14 faces each.</desc>
  <image href="${source}" x="0" y="0" width="900" height="1600" transform="translate(0 900) rotate(-90)" preserveAspectRatio="none" opacity="0.88"/>
  <g class="barrier-audit">${barrierOverlays}</g>
  <g class="review-grid">${cellOverlays}</g>
  <g class="feature-audit">${featureOverlays}</g>
  <g class="legend"><rect x="20" y="805" width="1500" height="77" rx="6"/><text x="40" y="827">336-cell flat-top hex review aid · labels are centred inside faces, not at shared vertices</text><text x="40" y="844">Rows: 14 total · 24 faces in every row · 336 faces total</text><text x="40" y="861">Columns: 24 total · 14 faces in every column · full rectangular shell</text><text x="40" y="878">Feature and barrier annotations cleared for the corrected from-scratch transcription pass.</text></g>
  <style>
    .review-cell polygon { fill: #173d4d33; stroke: #ffe8a8; stroke-width: 0.8; }
    .review-cell text { fill: #fff7d0; font: 12px ui-monospace, monospace; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: #14242a; stroke-width: 3px; }
    .feature-code { fill: #ff9bd3; font: 7px ui-monospace, monospace; font-weight: 700; text-anchor: middle; paint-order: stroke; stroke: #35172d; stroke-width: 2px; }
    .barrier-edge { stroke: #25b8ef; stroke-width: 3; opacity: .72; stroke-linecap: round; }
    .barrier-lake { stroke: #72e6ff; stroke-dasharray: 4 2; }
    .legend rect { fill: #17201ee6; stroke: #f0c878; }
    .legend text { fill: #fff3c8; font: 7px ui-sans-serif, sans-serif; }
  </style>
</svg>
`;

const output = resolve("docs/board-comparison-overlay.svg");
mkdirSync(resolve("docs"), { recursive: true });
writeFileSync(output, svg);
console.log(`Generated ${output} for ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length} review cells.`);
