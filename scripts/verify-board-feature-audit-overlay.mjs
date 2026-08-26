import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../docs/board-feature-audit-overlay.svg", import.meta.url), "utf8");
const faces = svg.match(/class="audit-cell"/g) ?? [];
const seaBarriers = svg.match(/class="barrier-sea"/g) ?? [];
const lakeBarriers = svg.match(/class="barrier-lake"/g) ?? [];
if (faces.length !== 336) throw new Error(`Expected 336 audit faces, found ${faces.length}`);
if (seaBarriers.length === 0 || lakeBarriers.length === 0) throw new Error("Expected both sea and lake barrier candidates");
if (!svg.includes("rotate(-90)") || !svg.includes("24 columns × 14 rows")) throw new Error("Audit overlay registration metadata is incomplete");
console.log(`Verified feature audit overlay: ${faces.length} faces, ${seaBarriers.length} sea barriers, ${lakeBarriers.length} lake barriers.`);
