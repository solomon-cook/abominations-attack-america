import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, validateBoardDefinition } from "../packages/game-engine/src/board.ts";

const root = resolve(".");
const unresolved = readFileSync(resolve(root, "docs/unresolved-rules-inventory.md"), "utf8");
const signoff = readFileSync(resolve(root, "docs/board-promotion-signoff.md"), "utf8");
const requiredIds = ["BOARD-GEOMETRY", "MONSTER-STATS", "UNIT-STATS", "BRANCH-DEPLOYMENT", "CARD-EFFECTS", "NATIONAL-GUARD-CONTROL", "GIANT-PLACEMENT", "SPECIAL-CASES"];
for (const id of requiredIds) {
  if (!unresolved.includes(`| ${id} |`)) throw new Error(`Release-blocker inventory is missing ${id}`);
}
for (const marker of ["Status: **pending human review**", "**Decision:** pending", "Physical-board transcriber", "Independent board reviewer"]) {
  if (!signoff.includes(marker)) throw new Error(`Board promotion sign-off record is missing ${marker}`);
}
const productionErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
if (productionErrors.length === 0) throw new Error("The unresolved full honeycomb board unexpectedly passed production validation.");
if (!productionErrors.some((error) => error.includes("unresolved"))) throw new Error("Production board validation did not report unresolved board data.");
console.log(`Verified ${requiredIds.length} explicit release blockers and ${productionErrors.length} production board validation errors.`);
