import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, validateBoardDefinition } from "../packages/game-engine/src/board.ts";
import { AUDITED_BOARD } from "../packages/game-engine/src/audited-board.ts";

const root = resolve(".");
const unresolved = readFileSync(resolve(root, "docs/unresolved-rules-inventory.md"), "utf8");
const signoff = readFileSync(resolve(root, "docs/board-promotion-signoff.md"), "utf8");
const requiredIds = ["CARD-EFFECTS", "GIANT-PLACEMENT"];
const sourceGatedRuleGroups = [...unresolved.matchAll(/^\| [A-Z-]+ \| open-source-gated \|/gm)].length;
if (!unresolved.includes("| SPECIAL-CASES | resolved |")) throw new Error("The component exception register is not marked resolved in the source inventory.");
if (!unresolved.includes("| MONSTER-STATS | resolved |")) throw new Error("Resolved monster data is missing its evidence record.");
if (!unresolved.includes("| BRANCH-DEPLOYMENT | resolved |")) throw new Error("Resolved branch deployment data is missing its evidence record.");
if (!unresolved.includes("| UNIT-STATS | resolved |")) throw new Error("Resolved unit records and abilities are missing their evidence record.");
if (!unresolved.includes("| NATIONAL-GUARD-CONTROL | resolved |")) throw new Error("Resolved National Guard control is missing its evidence record.");
for (const id of requiredIds) {
  if (!unresolved.includes(`| ${id} |`)) throw new Error(`Release-blocker inventory is missing ${id}`);
}
if (!unresolved.includes("| CARD-EFFECTS | open-source-gated |")) throw new Error("The remaining card interaction gate must stay explicit.");
if (!unresolved.includes("| GIANT-PLACEMENT | resolved |")) throw new Error("The sourced giant-placement boundary is missing its resolution record.");
for (const marker of ["Status: **board-data and project-owner visual reviews approved; full release sign-off pending**", "**Decision:** pending", "Physical-board data reviewer", "Independent board reviewer"]) {
  if (!signoff.includes(marker)) throw new Error(`Board promotion sign-off record is missing ${marker}`);
}
if (!unresolved.includes("| BOARD-GEOMETRY | open-review |")) throw new Error("Audited board review status is missing from the unresolved-rules inventory.");
const auditedErrors = validateBoardDefinition(AUDITED_BOARD, { production: true });
if (auditedErrors.length > 0) throw new Error(`The human-audited production board is invalid: ${auditedErrors.join("; ")}`);
const productionErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
if (productionErrors.length === 0) throw new Error("The unresolved full honeycomb board unexpectedly passed production validation.");
if (!productionErrors.some((error) => error.includes("unresolved"))) throw new Error("Production board validation did not report unresolved board data.");
const provisional = validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true });
if (provisional.length > 0) throw new Error(`The legacy provisional playtest board failed its explicit provisional gate: ${provisional.length} errors.`);
console.log(`Verified the audited 336-cell production board, the legacy provisional gate, and ${sourceGatedRuleGroups} remaining source-gated rules group${sourceGatedRuleGroups === 1 ? "" : "s"}; ${productionErrors.length} unresolved-shell errors remain isolated to FULL_HONEYCOMB_BOARD.`);
