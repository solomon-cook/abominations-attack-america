import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, validateBoardDefinition } from "@abominations/game-engine";
import { AUDITED_BOARD } from "../packages/game-engine/src/audited-board.ts";

async function main() {
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const boardErrors = validateBoardDefinition(AUDITED_BOARD, { production: true });
const shellErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
const provisionalErrors = validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true });
const boardCellCount = Object.keys(AUDITED_BOARD.hexes).length;
const unresolved = await readFile(resolve(root, "docs/unresolved-rules-inventory.md"), "utf8");
const openRuleGroups = [...unresolved.matchAll(/^\| [A-Z-]+ \| open-source-gated \|/gm)].length;
const securityBaseline = JSON.parse(await readFile(resolve(root, "config/production-audit-baseline.json"), "utf8"));
const hostingObservation = JSON.parse(await readFile(resolve(root, "config/hosting-observation.json"), "utf8"));
const knownSecurityEntries = securityBaseline.knownProductionAdvisories.length;
const dependencySecurityEvidence = knownSecurityEntries === 0
  ? "No known high-severity production advisories remain; the dependency audit gate must pass before release"
  : `${knownSecurityEntries} known high-severity vulnerable production package entries remain in \`config/production-audit-baseline.json\``;
const dependencySecurityStatus = knownSecurityEntries === 0 ? "NO KNOWN VULNERABILITIES; DEPLOYMENT REVIEW OPEN" : "BLOCKED";
const hostingEvidence = `${hostingObservation.frontend.provider} frontend ${hostingObservation.frontend.project} returns HTTP ${hostingObservation.frontend.productionHttpStatus} from ${hostingObservation.frontend.productionUrl}; the served client targets ${hostingObservation.frontend.compiledApiBase}, while /health and /metrics return HTTP ${hostingObservation.api.healthHttpStatus} and ${hostingObservation.api.metricsHttpStatus}. Database variable names are present, but their values were not read and database health, WebSocket fanout, and backup/restore are unverified`;
const hostingStatus = hostingObservation.api.configuredPublicEndpoint ? "API ENDPOINT PRESENT; SERVICE PROBES OPEN" : "FRONTEND ONLY; API/DB RELEASE GATE OPEN";
const browser = JSON.parse(await readFile(resolve(root, "output/board-art/browser-verification.json"), "utf8"));
const passedViewports = browser.viewports.filter((viewport: { passed: boolean }) => viewport.passed).length;
const browserEvidence = `${passedViewports}/${browser.viewports.length} audited-board browser viewports pass`;
let onlineEvidence = "no current audited-board online run recorded";
let onlineStatus = "PARTIAL";
try {
  const online = JSON.parse(await readFile(resolve(root, "output/board-art/browser-online-verification.json"), "utf8"));
  if (online.ok && online.boardIdentity === "shared-pinned-human-audit" && online.boardCells === 336) {
    onlineEvidence = `audited-board online room, shared identity, reconnect, ${online.onlineFight === "verified" ? "Fight, " : ""}Encounter, Deploy, and terminal flow pass`;
    onlineStatus = "ONLINE SMOKE VERIFIED";
  }
} catch {
  // Online smoke evidence is optional until the current board identity is exercised.
}
const report = `# Release proof report

This deterministic report separates proof levels. It is generated from the current checkout and distinguishes approved board transcription from remaining release sign-offs.

| Proof level | Current evidence | Status |
| --- | --- | --- |
| Human-audited MVP board | ${boardCellCount}-cell board ${AUDITED_BOARD.id}@${AUDITED_BOARD.version} passes strict production validation (${boardErrors.length} errors); user-authorized cell-data sign-off is recorded | DATA VERIFIED; RELEASE REVIEW OPEN |
| Unresolved coordinate shell | ${Object.keys(FULL_HONEYCOMB_BOARD.hexes).length}-cell shell remains fail-closed with ${shellErrors.length} validation errors; the separate legacy provisional board gate has ${provisionalErrors.length} errors | ISOLATED FROM NEW MVP MATCHES |
| Remaining source-gated rules | ${openRuleGroups} documented source-gated rules group${openRuleGroups === 1 ? " remains" : "s remain"} in \`docs/unresolved-rules-inventory.md\` | BLOCKED |
| Engine and API tests | \`npm test\`; deterministic engine/store/property/fuzz/contract coverage | VERIFY IN CURRENT CHECKOUT |
| Static contracts and build | Catalogue, traceability, source audit, docs, asset, accessibility, JSON contracts, typechecks, and Vite build | VERIFY IN CURRENT CHECKOUT |
| Dependency security | ${dependencySecurityEvidence} | ${dependencySecurityStatus} |
| Deployed service health | ${hostingEvidence} | ${hostingStatus} |
| Browser QA | ${browserEvidence}; ${onlineEvidence}; full-rules victory, assistive-technology, and manual touch acceptance remain separate | ${passedViewports === browser.viewports.length && passedViewports > 0 ? onlineStatus : "PARTIAL"} |
| Production release | Full board/rules/accessibility/content/IP/privacy/security sign-offs and real online smoke test | BLOCKED |

## Current release boundary

New MVP room creation pins the human-audited board ID, version, ruleset version, and content hash. The user-authorized board-data sign-off is recorded; independent review, same-scale visual acceptance, durable database persistence, source-gated rules, security, and full release sign-offs remain open. Existing provisional matches retain their immutable pins.
`;

  const outputPath = resolve(root, "docs/release-proof-report.md");
  if (process.argv.includes("--check")) {
    let existing: string;
    try {
      existing = await readFile(outputPath, "utf8");
    } catch {
      console.error("Release proof report is missing; run npm run release-report:generate.");
      process.exitCode = 1;
      return;
    }
    if (existing !== report) {
      console.error("Release proof report is stale; run npm run release-report:generate.");
      process.exitCode = 1;
      return;
    }
    console.log("Release proof report is current and deterministic.");
    return;
  }

  await writeFile(outputPath, report);
  console.log("Generated docs/release-proof-report.md");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
