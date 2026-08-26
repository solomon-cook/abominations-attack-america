import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, type BoardHex } from "../packages/game-engine/src/board.ts";

const width = 753;
const height = 623;
const source = "../references/monsters-menace-america/components/board/full-board-top-down.jpg";
// Approximate corners of the printed board surface in this independent source.
// This overlay is a visual cross-check only; it is intentionally not used to
// promote terrain, labels, features, or edges into the authoritative board.
const corners = {
  topLeft: [57, 31],
  topRight: [717, 29],
  bottomRight: [724, 542],
  bottomLeft: [57, 543],
} as const;

function rows(): BoardHex[][] {
  return Array.from({ length: 13 }, (_, row) => Object.values(FULL_HONEYCOMB_BOARD.hexes)
    .filter((hex) => hex.coord.r === row)
    .sort((a, b) => a.coord.q - b.coord.q));
}

function mapPoint(u: number, v: number): readonly [number, number] {
  const topX = corners.topLeft[0] + (corners.topRight[0] - corners.topLeft[0]) * u;
  const topY = corners.topLeft[1] + (corners.topRight[1] - corners.topLeft[1]) * u;
  const bottomX = corners.bottomLeft[0] + (corners.bottomRight[0] - corners.bottomLeft[0]) * u;
  const bottomY = corners.bottomLeft[1] + (corners.bottomRight[1] - corners.bottomLeft[1]) * u;
  return [topX + (bottomX - topX) * v, topY + (bottomY - topY) * v];
}

function polygon(cx: number, cy: number, radiusX: number, radiusY: number): string {
  return [
    [cx - radiusX * 0.5, cy - radiusY], [cx + radiusX * 0.5, cy - radiusY],
    [cx + radiusX, cy], [cx + radiusX * 0.5, cy + radiusY],
    [cx - radiusX * 0.5, cy + radiusY], [cx - radiusX, cy],
  ].map(([u, v]) => mapPoint(u, v).map((value) => value.toFixed(1)).join(",")).join(" ");
}

const cellOverlays = rows().flatMap((row, rowIndex) => row.map((hex, columnIndex) => {
  const cx = (columnIndex + 0.5 + (rowIndex % 2 ? 0.5 : 0)) / 20;
  const cy = (rowIndex + 0.5) / 13;
  const points = polygon(cx, cy, 0.48 / 20, 0.45 / 13);
  const [textX, textY] = mapPoint(cx, cy);
  return `<g class="review-cell" data-hex-key="${hex.key}"><polygon points="${points}"/><text x="${textX.toFixed(1)}" y="${(textY + 1).toFixed(1)}">${hex.key}</text></g>`;
})).join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">254-cell honeycomb cross-check overlay over independent top-down photograph</title>
  <desc id="description">An approximate coordinate review grid over an independent top-down board photograph. This is a transcription aid and does not assert printed board rule data.</desc>
  <image href="${source}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.88"/>
  <g class="review-grid">${cellOverlays}</g>
  <g class="legend"><rect x="12" y="568" width="530" height="44" rx="4"/><text x="22" y="586">254-cell review aid · approximate alignment to 753 × 623 top-down source</text><text x="22" y="601">Not authoritative: labels, features, water, barriers, and edges require sign-off.</text></g>
  <style>
    .review-cell polygon { fill: #173d4d33; stroke: #ffe8a8; stroke-width: 0.35; }
    .review-cell text { fill: #fff7d0; font: 3.2px ui-monospace, monospace; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: #14242a; stroke-width: 0.8px; }
    .legend rect { fill: #17201ee6; stroke: #f0c878; stroke-width: 0.7; }
    .legend text { fill: #fff3c8; font: 4.6px ui-sans-serif, sans-serif; }
  </style>
</svg>
`;

const output = resolve("docs/board-top-down-overlay.svg");
mkdirSync(resolve("docs"), { recursive: true });
writeFileSync(output, svg);
console.log(`Generated ${output} for ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length} review cells.`);
