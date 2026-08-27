import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROVISIONAL_AUTHORITATIVE_BOARD as board, type BoardFeature, type BoardHex } from "../packages/game-engine/src/board.ts";

const width = 1600;
const height = 900;
const source = "../references/monsters-menace-america/components/source-photos-2026-08-26/full-board-setup.JPG";
const radius = 32.5;
const faceHeight = radius * Math.sqrt(3);

function position(hex: BoardHex): readonly [number, number] {
  const column = hex.coord.q + Math.floor(hex.coord.r / 2);
  return [220 + radius * 1.5 * column, 65 + faceHeight * (hex.coord.r + (column % 2 ? 0.5 : 0))];
}

function points(cx: number, cy: number): string {
  const halfHeight = radius * Math.sqrt(3) / 2;
  return [[cx - radius / 2, cy - halfHeight], [cx + radius / 2, cy - halfHeight], [cx + radius, cy], [cx + radius / 2, cy + halfHeight], [cx - radius / 2, cy + halfHeight], [cx - radius, cy]]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function featureCode(feature: BoardFeature): string {
  if (feature.kind === "city") return "CITY";
  if (feature.kind === "military-base") return feature.branch === "Air Force" ? "AF" : feature.branch === "Marines" ? "MAR" : feature.branch === "Navy" ? "NAV" : "ARM";
  if (feature.kind === "infamy-site") return "INF";
  if (feature.kind === "mutation-site") return "MUT";
  if (feature.kind === "challenge-site") return "CHL";
  if (feature.kind === "lair") return "LAIR";
  return "LA";
}

const hexes = Object.values(board.hexes).map((hex) => {
  const [cx, cy] = position(hex);
  const column = hex.coord.q + Math.floor(hex.coord.r / 2);
  const rowColumn = `${hex.coord.r}/${column}`;
  const features = hex.features.map(featureCode).join("+");
  const water = hex.waterClass.toUpperCase();
  return `<g class="audit-cell"><polygon class="water-${hex.waterClass}" points="${points(cx, cy)}"/><text class="face-id" x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}">${rowColumn}</text>${features ? `<text class="feature-code" x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}">${features}</text>` : ""}<title>${rowColumn} · ${water}${hex.label ? ` · ${hex.label}` : ""}${features ? ` · ${features}` : ""}</title></g>`;
}).join("\n");

const vertices = (centre: readonly [number, number]): readonly (readonly [number, number])[] => {
  const [cx, cy] = centre;
  const halfHeight = radius * Math.sqrt(3) / 2;
  return [[cx - radius / 2, cy - halfHeight], [cx + radius / 2, cy - halfHeight], [cx + radius, cy], [cx + radius / 2, cy + halfHeight], [cx - radius / 2, cy + halfHeight], [cx - radius, cy]];
};
const barrierLines = board.edges.filter((edge) => edge.from < edge.to && edge.barrier !== "none").map((edge) => {
  const from = vertices(position(board.hexes[edge.from]!));
  const to = vertices(position(board.hexes[edge.to]!));
  const shared = from.filter(([x, y]) => to.some(([ox, oy]) => Math.hypot(x - ox, y - oy) < 0.1));
  if (shared.length !== 2) return "";
  return `<line class="barrier-${edge.barrier}" x1="${shared[0]![0].toFixed(1)}" y1="${shared[0]![1].toFixed(1)}" x2="${shared[1]![0].toFixed(1)}" y2="${shared[1]![1].toFixed(1)}"/>`;
}).join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">Provisional 336-cell physical-board feature and barrier audit overlay</title>
  <desc id="description">Candidate feature, water, and thick-blue-barrier annotations over the authority photograph. All annotations remain provisional until physical-board sign-off.</desc>
  <image href="${source}" x="0" y="0" width="900" height="1600" transform="translate(0 900) rotate(-90)" preserveAspectRatio="none" opacity="0.88"/>
  <g class="barriers">${barrierLines}</g>
  <g class="cells">${hexes}</g>
  <g class="legend"><rect x="20" y="805" width="1500" height="77" rx="6"/><text x="40" y="827">PROVISIONAL FEATURE / WATER / BARRIER AUDIT · 336 flat-top faces · 24 columns × 14 rows</text><text x="40" y="844">CITY · base branch code · INF Infamy · MUT Mutation · LAIR · LA Los Angeles</text><text x="40" y="861">Blue lines: candidate sea/lake transitions matching the thick printed water-barrier boundary</text><text x="40" y="878">Candidate data only: unreadable or fold-obscured content must remain unresolved until sign-off.</text></g>
  <style>
    .audit-cell polygon { stroke: #fff0b8; stroke-width: .8; }
    .water-sea { fill: #176f9b55; }
    .water-lake { fill: #58bde055; stroke: #8feaff; }
    .water-seacoast { fill: #1f8caf22; }
    .water-land { fill: #173d4d22; }
    .face-id,.feature-code { fill: #fff7d0; font: 10px ui-monospace, monospace; text-anchor: middle; paint-order: stroke; stroke: #14242a; stroke-width: 3px; }
    .feature-code { fill: #ffd36a; font-weight: 700; }
    .barrier-sea { stroke: #08b8f5; stroke-width: 4; opacity: .9; }
    .barrier-lake { stroke: #a6f2ff; stroke-width: 3; stroke-dasharray: 5 2; opacity: .95; }
    .legend rect { fill: #17201ee6; stroke: #f0c878; }
    .legend text { fill: #fff3c8; font: 7px ui-sans-serif, sans-serif; }
  </style>
</svg>`;

const output = resolve("docs/board-feature-audit-overlay.svg");
mkdirSync(resolve("docs"), { recursive: true });
writeFileSync(output, svg);
console.log(`Generated ${output} with ${Object.keys(board.hexes).length} faces and ${(svg.match(/class="barrier-(?:sea|lake)"/g) ?? []).length} rendered candidate barriers.`);
