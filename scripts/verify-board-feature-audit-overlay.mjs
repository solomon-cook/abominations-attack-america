import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../docs/board-feature-audit-overlay.svg", import.meta.url), "utf8");
const faces = svg.match(/class="audit-cell"/g) ?? [];
const seaBarriers = svg.match(/class="barrier-sea"/g) ?? [];
const lakeBarriers = svg.match(/class="barrier-lake"/g) ?? [];
const featureTexts = [...svg.matchAll(/class="feature-code"[^>]*>([^<]+)</g)].flatMap((match) => match[1].split("+"));
const featureCounts = featureTexts.reduce((counts, feature) => {
  counts[feature] = (counts[feature] ?? 0) + 1;
  return counts;
}, {});
if (faces.length !== 336) throw new Error(`Expected 336 audit faces, found ${faces.length}`);
if (seaBarriers.length === 0 || lakeBarriers.length === 0) throw new Error("Expected both sea and lake barrier candidates");
if (!svg.includes("rotate(-90)") || !svg.includes("24 columns × 14 rows")) throw new Error("Audit overlay registration metadata is incomplete");
for (const [feature, expected] of [["CITY", 45], ["INF", 15], ["MUT", 4], ["LAIR", 6], ["LA", 1]]) {
  if (featureCounts[feature] !== expected) throw new Error(`Expected ${expected} ${feature} features, found ${featureCounts[feature] ?? 0}`);
}
const baseCount = ["AF", "MAR", "NAV", "ARM"].reduce((total, feature) => total + (featureCounts[feature] ?? 0), 0);
if (baseCount !== 35) throw new Error(`Expected 35 military-base candidates, found ${baseCount}`);
for (const marker of [
  "4/22 · SEACOAST · Provisional Boston · CITY+NAV",
  "6/20 · SEACOAST · Provisional Baltimore · CITY+MAR",
  "7/19 · LAND · Provisional Richmond · CITY+ARM",
  "8/16 · LAND · Provisional Nashville · CITY+ARM",
  "9/11 · LAND · Provisional Birmingham · CITY+AF",
  "6/13 · LAND · Provisional Kansas City · CITY+AF",
  "10/12 · LAND · Provisional Austin · CITY+ARM",
  "10/19 · SEACOAST · INF+NAV",
  "6/21 · SEACOAST · AF+NAV",
  "7/4 · LAND · INF+AF",
  "9/6 · LAND · INF+AF",
  "10/11 · LAND · INF+AF",
]) {
  if (!svg.includes(`<title>${marker}</title>`)) throw new Error(`Expected exact co-location marker in overlay: ${marker}`);
}
console.log(`Verified feature audit overlay: ${faces.length} faces, ${featureCounts.CITY} cities, ${baseCount} bases, ${featureCounts.INF} Infamy, ${featureCounts.MUT} Mutation, ${featureCounts.LAIR} lairs, ${seaBarriers.length} sea barriers, ${lakeBarriers.length} lake barriers.`);
