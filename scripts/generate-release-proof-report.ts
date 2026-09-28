import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDITED_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, validateBoardDefinition } from "@abominations/game-engine";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const boardErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
const provisionalErrors = validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true });
const runtimeBoardErrors = validateBoardDefinition(AUDITED_BOARD, { production: true });
const boardCellCount = Object.keys(FULL_HONEYCOMB_BOARD.hexes).length;
const report = `# Release proof report

This deterministic report separates proof levels. This generator runs board-definition validation only; it does not execute the test suite, static-contract checks, or application builds. It does not claim a deployed service or a source-data sign-off.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Current local/room board initializer | ${Object.keys(AUDITED_BOARD.hexes).length}-cell board ${AUDITED_BOARD.id}@${AUDITED_BOARD.version} passes the engine's structural validation (${runtimeBoardErrors.length} errors); flags do not prove physical-source review | PLAYTEST CANDIDATE; SOURCE APPROVAL BLOCKED |
| Separate provisional-board gate | ${Object.keys(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).length}-cell board ${PROVISIONAL_AUTHORITATIVE_BOARD.id}@${PROVISIONAL_AUTHORITATIVE_BOARD.version} passes its explicit provisional gate (${provisionalErrors.length} errors); it is not the current local/room initializer | PROVISIONAL GATE ONLY |
| Full-honeycomb shell | The strict ${boardCellCount}-cell candidate has ${boardErrors.length} validation errors | NOT PLAYABLE |
| Engine and API tests | Run \`npm test\` against the current checkout; deterministic engine/store/property/fuzz/contract coverage | NOT CHECKED BY THIS REPORT |
| Static contracts and build | Run \`npm run verify\` against the current checkout; API release work also requires \`npm run build:api\` | NOT CHECKED BY THIS REPORT |
| Dependency security | \`npm audit --omit=dev\` reports four affected package records across three underlying advisories (two high and one moderate) in the checked-in lock/install; no compatible remediation is committed | BLOCKED |
| Deployed service health | \`/health\`, \`/metrics\`, Prisma persistence, WSS proxy, backups, and external alerts | NOT RUN: no deployment configured |
| Browser QA | Local development playtest evidence in \`docs/first-playable-browser-evidence.md\`; generated decorative map background and ${boardCellCount}-cell overlay are source/render checks | PARTIAL |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Promotion condition

The current local/room initializer uses the pinned ${AUDITED_BOARD.id}@${AUDITED_BOARD.version} board candidate, and every match records its board ID, version, content hash, and ruleset pin. Structural validation and internal transcription flags are not physical-edition verification. Source-faithful promotion and release approval remain blocked until the user's physical edition has been checked, disputed cells and edges are resolved, implementation and fixtures match the recorded evidence, and the required human sign-off is complete. Preserve the existing board identity for saved-match compatibility while that review is pending.
`;

async function main() {
  const reportPath = resolve(root, "docs/release-proof-report.md");
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = await readFile(reportPath, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (current !== report) throw new Error("docs/release-proof-report.md is stale; run `npm run release-report:generate` and review the generated diff.");
    console.log("Verified docs/release-proof-report.md matches the current board-proof inputs.");
    return;
  }
  await writeFile(reportPath, report);
  console.log("Generated docs/release-proof-report.md");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
