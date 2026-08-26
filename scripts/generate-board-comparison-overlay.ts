import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, type BoardHex } from "../packages/game-engine/src/board.ts";

const width = 2840;
const height = 1752;
const source = "../references/monsters-menace-america/components/board/full-game-setup.jpg";
// Corners of the printed map area in the 2840 x 1752 source photograph. The
// board is photographed with mild perspective, so every overlay point is
// bilinearly mapped instead of being placed in a rectangular screenshot grid.
const corners = {
  topLeft: [555, 382],
  topRight: [2218, 382],
  bottomRight: [2220, 1480],
  bottomLeft: [548, 1480],
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
  return `<g class="review-cell" data-hex-key="${hex.key}"><polygon points="${points}"/><text x="${textX.toFixed(1)}" y="${(textY + 2).toFixed(1)}">${hex.key}</text></g>`;
})).join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">254-cell honeycomb board comparison overlay</title>
  <desc id="description">A coordinate review grid over the source board photograph. This is a transcription aid and does not assert any printed board rule data.</desc>
  <image href="${source}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.88"/>
  <g class="review-grid">${cellOverlays}</g>
  <g class="legend"><rect x="20" y="1650" width="920" height="62" rx="6"/><text x="40" y="1675">254-cell coordinate review aid · perspective-mapped 2840 × 1752 source photograph</text><text x="40" y="1698">Not authoritative: labels, features, water, barriers, and edges require sign-off.</text></g>
  <style>
    .review-cell polygon { fill: #173d4d33; stroke: #ffe8a8; stroke-width: 0.8; }
    .review-cell text { fill: #fff7d0; font: 12px ui-monospace, monospace; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: #14242a; stroke-width: 3px; }
    .legend rect { fill: #17201ee6; stroke: #f0c878; }
    .legend text { fill: #fff3c8; font: 7px ui-sans-serif, sans-serif; }
  </style>
</svg>
`;

const output = resolve("docs/board-comparison-overlay.svg");
mkdirSync(resolve("docs"), { recursive: true });
writeFileSync(output, svg);
console.log(`Generated ${output} for ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length} review cells.`);
