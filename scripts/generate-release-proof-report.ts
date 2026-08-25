import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_HONEYCOMB_BOARD, validateBoardDefinition } from "@abominations/game-engine";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const boardErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
const report = `# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Source and board audit | Eight documented unresolved source inputs; the 254-cell photographed board candidate has ${boardErrors.length} production validation errors | BLOCKED |
| Engine and API tests | \`npm test\`; deterministic engine/store/property/fuzz/contract coverage | VERIFIED LOCALLY |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFIED LOCALLY |
| Deployed service health | \`/health\`, \`/metrics\`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in \`docs/first-playable-browser-evidence.md\`; source photograph backdrop and 254-cell overlay are visual checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

Production room creation must remain fail-closed until every board hex, edge, printed feature, water class, and barrier is transcribed from authoritative source evidence, validated, and human-signed. The current development fixture is not sufficient evidence for first-playable MVP promotion.
`;

async function main() {
  await writeFile(resolve(root, "docs/release-proof-report.md"), report);
  console.log("Generated docs/release-proof-report.md");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
