import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, type BoardHex } from "../packages/game-engine/src/board.ts";

const width = 753;
const height = 623;
const boardLeft = 77;
const boardTop = 32;
const boardWidth = 646;
const boardHeight = 377;
const rowHeight = boardHeight / 13;
const cellWidth = boardWidth / 20;

function rows(): BoardHex[][] {
  return Array.from({ length: 13 }, (_, row) => Object.values(FULL_HONEYCOMB_BOARD.hexes)
    .filter((hex) => hex.coord.r === row)
    .sort((a, b) => a.coord.q - b.coord.q));
}

function polygon(cx: number, cy: number, radiusX: number, radiusY: number): string {
  return [
    [cx - radiusX * 0.5, cy - radiusY], [cx + radiusX * 0.5, cy - radiusY],
    [cx + radiusX, cy], [cx + radiusX * 0.5, cy + radiusY],
    [cx - radiusX * 0.5, cy + radiusY], [cx - radiusX, cy],
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

const cellOverlays = rows().flatMap((row, rowIndex) => row.map((hex, columnIndex) => {
  const cx = boardLeft + (columnIndex + 0.5) * cellWidth + (rowIndex % 2 ? cellWidth / 2 : 0);
  const cy = boardTop + (rowIndex + 0.5) * rowHeight;
  return `<g class="review-cell" data-hex-key="${hex.key}"><polygon points="${polygon(cx, cy, cellWidth * 0.48, rowHeight * 0.45)}"/><text x="${cx.toFixed(1)}" y="${(cy + 2).toFixed(1)}">${hex.key}</text></g>`;
})).join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">254-cell honeycomb board comparison overlay</title>
  <desc id="description">A coordinate review grid over the source board photograph. This is a transcription aid and does not assert any printed board rule data.</desc>
  <image href="../references/monsters-menace-america/components/board/full-board-top-down.jpg" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.88"/>
  <g class="review-grid">${cellOverlays}</g>
  <g class="legend"><rect x="10" y="570" width="430" height="40" rx="4"/><text x="20" y="587">254-cell coordinate review aid · source photo underneath</text><text x="20" y="602">Not authoritative: labels, features, water, barriers, and edges require sign-off.</text></g>
  <style>
    .review-cell polygon { fill: #173d4d33; stroke: #ffe8a8; stroke-width: 0.8; }
    .review-cell text { fill: #fff7d0; font: 4.8px ui-monospace, monospace; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: #14242a; stroke-width: 1.3px; }
    .legend rect { fill: #17201ee6; stroke: #f0c878; }
    .legend text { fill: #fff3c8; font: 7px ui-sans-serif, sans-serif; }
  </style>
</svg>
`;

const output = resolve("docs/board-comparison-overlay.svg");
mkdirSync(resolve("docs"), { recursive: true });
writeFileSync(output, svg);
console.log(`Generated ${output} for ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length} review cells.`);
