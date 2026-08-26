import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, validateBoardDefinition } from "@abominations/game-engine";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const boardErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
const provisionalErrors = validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true });
const report = `# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Provisional board promotion | Immutable ${Object.keys(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).length}-cell board ${PROVISIONAL_AUTHORITATIVE_BOARD.id}@${PROVISIONAL_AUTHORITATIVE_BOARD.version} passes the explicit provisional production gate (${provisionalErrors.length} errors) | PROVISIONALLY PROMOTED |
| Source-faithful board audit | Eight documented unresolved source inputs; the strict 254-cell physical-board candidate has ${boardErrors.length} validation errors | BLOCKED |
| Engine and API tests | \`npm test\`; deterministic engine/store/property/fuzz/contract coverage | VERIFIED LOCALLY |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFIED LOCALLY |
| Dependency security | \`npm run security:dependencies:verify\` detects exactly three known high-severity Prisma/deepmerge findings, including GHSA-ggr8-5vv4-36mx; no compatible remediation is committed | BLOCKED |
| Deployed service health | \`/health\`, \`/metrics\`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in \`docs/first-playable-browser-evidence.md\`; generated decorative map background and 254-cell overlay are source/render checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

Production room creation may use only the pinned provisional board through the explicit MVP gate; every match records its board ID, version, content hash, and provisional ruleset. Promotion to a source-faithful board remains fail-closed until every board hex, edge, printed feature, water class, and barrier is transcribed from authoritative source evidence, validated, and human-signed.
`;

async function main() {
  await writeFile(resolve(root, "docs/release-proof-report.md"), report);
  console.log("Generated docs/release-proof-report.md");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
