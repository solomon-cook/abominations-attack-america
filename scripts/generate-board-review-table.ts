import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, buildBoardIndex, diagnoseBoard } from "../packages/game-engine/src/board.ts";

const outputPath = resolve("docs/board-review-table.md");
const index = buildBoardIndex(FULL_HONEYCOMB_BOARD);
const diagnostics = diagnoseBoard(FULL_HONEYCOMB_BOARD);
const featureText = (features: readonly { kind: string; branch?: string; siteId?: string; monsterId?: string }[]) =>
  features.map((feature) => [feature.kind, feature.branch, feature.siteId, feature.monsterId].filter(Boolean).join(":"))
    .join(", ") || "—";

const lines = [
  "# Board review table",
  "",
  "Generated from `FULL_HONEYCOMB_BOARD` for human comparison against the physical board reference. This is a review artifact for the unresolved 336-hex full 24-by-14 coordinate shell, not production board data.",
  "",
  `- Board ID: \`${FULL_HONEYCOMB_BOARD.id}\``,
  `- Version: \`${FULL_HONEYCOMB_BOARD.version}\``,
  `- Ruleset: \`${FULL_HONEYCOMB_BOARD.rulesetVersion}\``,
  `- Content hash: \`${FULL_HONEYCOMB_BOARD.contentHash}\``,
  `- Hexes: ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length}; enabled directed edges: ${FULL_HONEYCOMB_BOARD.edges.filter((edge) => edge.enabled).length}`,
  `- Diagnostics: ${diagnostics.connectedComponents.length} connected component(s); isolated: ${diagnostics.isolatedHexes.length}; disabled-only: ${diagnostics.disabledOnlyHexes.length}; duplicate labels: ${diagnostics.duplicateLabels.length}; duplicate coordinates: ${diagnostics.duplicateCoordinates.length}`,
  `- Feature counts: ${Object.entries(diagnostics.featureCounts).filter(([, count]) => count > 0).map(([kind, count]) => `${kind}=${count}`).join(", ") || "none"}`,
  "",
  "| Hex key | Label | Axial coordinate | Water | Features | Neighbours | Verification | Source refs |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...Object.values(FULL_HONEYCOMB_BOARD.hexes).sort((a, b) => a.key.localeCompare(b.key)).map((hex) =>
    `| \`${hex.key}\` | ${hex.label ?? "—"} | (${hex.coord.q}, ${hex.coord.r}) | ${hex.waterClass} | ${featureText(hex.features)} | ${index.neighbours[hex.key].map((key) => `\`${key}\``).join(", ") || "—"} | ${hex.verification} | ${hex.sourceRefs.join(", ")} |`
  ),
  "",
  "## Edge review",
  "",
  "| From | To | Barrier | Enabled | Exceptional | Source ref |",
  "| --- | --- | --- | --- | --- | --- |",
  ...FULL_HONEYCOMB_BOARD.edges.map((edge) => `| \`${edge.from}\` | \`${edge.to}\` | ${edge.barrier} | ${edge.enabled ? "yes" : "no"} | ${edge.exceptional ? "yes" : "no"} | ${edge.sourceRef} |`),
  "",
  "## Review status",
  "",
  "Every row currently carries the photographed-board source reference and unresolved verification. Replace this coordinate-shell table with reviewed feature, water, label, and barrier data only after the physical board has been transcribed and independently reviewed.",
  ""
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Generated ${outputPath}`);
