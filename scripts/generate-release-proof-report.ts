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
const databaseObservation = hostingObservation.database;
const knownSecurityEntries = securityBaseline.knownProductionAdvisories.length;
const dependencySecurityEvidence = knownSecurityEntries === 0
  ? "No known high-severity production advisories remain; the dependency audit gate must pass before release"
  : `${knownSecurityEntries} known high-severity vulnerable production package entries remain in \`config/production-audit-baseline.json\``;
const dependencySecurityStatus = knownSecurityEntries === 0 ? "NO KNOWN VULNERABILITIES; DEPLOYMENT REVIEW OPEN" : "BLOCKED";
const latestReadiness = hostingObservation.production.latestCurrentReadiness;
const postMergeDeployment = hostingObservation.production.postMergeDeploymentCheck;
const latestProductionHealthSequence = hostingObservation.production.latestProductionHealthSequence;
const latestHealthCheck = hostingObservation.production.latestHealthCheck;
const latestHealthResponse = latestProductionHealthSequence?.probes?.at(-1)
  ?? latestReadiness?.healthProbeSequence?.filter((probe: { status?: number }) => typeof probe.status === "number").at(-1);
const latestHealthSequenceCheckedAt = latestProductionHealthSequence?.checkedAt ?? latestReadiness?.checkedAt ?? "";
const latestHealthCheckIsNewer = Boolean(latestHealthCheck?.checkedAt && latestHealthCheck.checkedAt > latestHealthSequenceCheckedAt);
const productionHealthStatus = latestHealthCheckIsNewer
  ? latestHealthCheck.httpStatus
  : latestHealthResponse?.status ?? hostingObservation.production.apiHealth?.status ?? hostingObservation.production.routes?.["/api/health"] ?? "not checked";
const latestHealthSequenceHasFailure = Boolean(latestProductionHealthSequence?.statuses?.some((status: number) => status !== 200));
const latestHealthSequenceRecoveryStatus = latestProductionHealthSequence?.statuses?.at(-1);
const displayedProductionHealthStatus = latestHealthSequenceHasFailure
  ? `HTTP ${latestHealthSequenceRecoveryStatus} after a prior ${latestProductionHealthSequence.statuses.find((status: number) => status !== 200)}`
  : `HTTP ${productionHealthStatus}`;
const productionMetricsStatus = latestReadiness?.metrics?.status ?? hostingObservation.production.metrics?.status ?? hostingObservation.production.routes?.["/api/metrics"] ?? "not checked";
const productionClient = hostingObservation.production.asset?.containsLocalhost
  ? "served client bundle still contains a localhost API URL"
  : "served client bundle has no recorded localhost API URL";
const productionDeployment = hostingObservation.production.productionDeployment ?? hostingObservation.vercelEnvironmentMetadata?.productionDeployment;
const productionDeploymentEvidence = productionDeployment?.status === "READY"
  ? `Deployment ${productionDeployment.deploymentId} from commit ${productionDeployment.commit} was READY on the canonical alias at ${productionDeployment.checkedAt ?? productionDeployment.deploymentCheckedAt}${postMergeDeployment ? `; latest docs-only Production deployment ${postMergeDeployment.deploymentId} from ${postMergeDeployment.deploymentCommit} was READY` : latestReadiness ? `; latest docs-only Production deployment ${latestReadiness.deploymentId} from ${latestReadiness.deploymentCommit} was READY` : ""}`
  : "no ready Production deployment recorded";
const preview = hostingObservation.preview;
const previewEvidence = preview
  ? `; latest evidence-branch Preview ${preview.latestEvidenceDeployment?.deploymentId ?? preview.deploymentId} reports HTTP ${preview.latestEvidenceDeployment?.apiHealth?.status ?? preview.apiHealth.status} health and HTTP ${preview.latestEvidenceDeployment?.metrics?.status ?? "not checked"} metrics with ${preview.latestEvidenceDeployment?.apiHealth?.body?.persistence ?? preview.apiHealth.body.persistence} persistence and ${preview.latestEvidenceDeployment?.apiHealth?.body?.realtimeFanout?.mode ?? preview.apiHealth.body.realtimeFanout.mode}; earlier browser QA deployment ${preview.deploymentId} reported HTTP ${preview.apiHealth.status}`
  : "";
const regionPreview = hostingObservation.regionCheckPreview;
const regionPreviewEvidence = regionPreview
  ? `; protected Preview ${regionPreview.deploymentId} used function region ${regionPreview.deploymentRegions.join(", ")} and passed its three-profile core flow through legal move revision ${regionPreview.browserVerification.legalMoveAcceptedRevision} plus peer/spectator sync and refresh recovery`
  : "";
const workspaceUsageEvidence = databaseObservation?.workspaceOperations.isDirectWorkspaceMeter === false
  ? `${databaseObservation.workspaceOperations.stale ? "stale " : ""}summed per-database usage estimate ${databaseObservation.workspaceOperations.used}/${databaseObservation.workspaceOperations.included} across ${databaseObservation.workspaceOperations.databasesEnumerated} listed databases (last checked ${databaseObservation.workspaceOperations.checkedAt})`
  : `workspace meter ${databaseObservation?.workspaceOperations.used ?? "not measured"}/${databaseObservation?.workspaceOperations.included ?? "unknown"}, ${databaseObservation?.workspaceOperations.remainingAtObservation ?? "unknown"} remaining${databaseObservation?.workspaceOperations.averageDailyOperationsDisplayed ? `, ${databaseObservation.workspaceOperations.averageDailyOperationsDisplayed.toLocaleString()} recent operations/day` : ""}`;
const databaseEvidence = databaseObservation
  ? `Prisma ${databaseObservation.plan} at ${databaseObservation.workspaceInvoice} with a fixed 200,000 monthly operation cap; ${workspaceUsageEvidence}; Production database usage ${databaseObservation.productionDatabase?.usage.operations ?? "not measured"} operations at ${databaseObservation.productionDatabase?.usage.operationsMeasuredAt ?? databaseObservation.productionDatabase?.usage.measuredAt ?? "an unknown time"}; ${databaseObservation.backupRestore.status}, but Free has no automatic backups or recurring schedule`
  : "Database plan, metered usage, and backup/restore remain unverified";
const workspaceMeterFreshness = databaseObservation?.workspaceOperations.isDirectWorkspaceMeter === false
  ? `This is a ${databaseObservation.workspaceOperations.stale ? "stale " : ""}database-usage sum, not a direct Console workspace meter (last checked ${databaseObservation.workspaceOperations.checkedAt}); the plan and invoice were last confirmed ${databaseObservation.planLastConfirmedAt}.`
  : databaseObservation?.workspaceOperations.stale ? "The latest workspace operation meter is stale." : "The latest workspace operation meter is current as of its recorded check time.";
const configuredPollMs = hostingObservation.vercelEnvironmentMetadata?.productionPollIntervalValue;
const configuredPollCheckedAt = hostingObservation.vercelEnvironmentMetadata?.productionPollIntervalCheckedAt;
const pollingVolumeEvidence = Number.isFinite(configuredPollMs) && configuredPollMs > 0
  ? `The last recorded Production room-poll interval was ${configuredPollMs / 1000} seconds (checked ${configuredPollCheckedAt}); at one Prisma operation per successful poll, two continuously open player tabs imply about ${Math.round(2 * 30 * 24 * 60 * 60 * 1000 / configuredPollMs).toLocaleString()} polls per 30-day month. The source fallback is 5 seconds if the deployment variable is absent, which would imply 1,036,800 monthly polls for two tabs; these are estimates, not measured load.`
  : "The deployed room-poll interval has not been confirmed; source-based query volume estimates are not measured load.";
const latestFullMatchAttempt = hostingObservation.production.latestFullMatchAttempt;
const latestFullMatchAttemptEvidence = latestFullMatchAttempt
  ? `Latest automated full-match attempt on ${latestFullMatchAttempt.deploymentId} failed before room creation: POST /api/rooms returned HTTP ${latestFullMatchAttempt.httpStatus} after ${latestFullMatchAttempt.durationMs} ms with Prisma ${latestFullMatchAttempt.timeoutKind} at ${latestFullMatchAttempt.databaseStep}; no game actions ran and full-match/spectator acceptance remains unverified.`
  : "No recent automated full-match Production attempt is recorded.";
const recentRuntimeErrors = hostingObservation.production.runtimeErrorsRecent;
const runtimeLogRetention = hostingObservation.production.runtimeLogRetention;
const latestProductionErrorLogCheck = hostingObservation.production.latestProductionErrorLogCheck;
const environmentVariableMetadataAudit = hostingObservation.production.environmentVariableMetadataAudit;
const latestTimeout = hostingObservation.production.runtimeErrorCheck;
const latestProductionAttempt = hostingObservation.production.latestProductionAttempt;
const latestProductionFailure = hostingObservation.production.latestProductionFailure;
const latestProductionBrowserRecord = hostingObservation.production.latestProductionBrowserVerification;
const latestProductionBrowserAttempt = hostingObservation.production.latestProductionBrowserAttempt;
const latestProductionAttemptAfterBrowserPass = Boolean(latestProductionBrowserRecord && latestProductionBrowserAttempt && latestProductionBrowserAttempt.checkedAt > latestProductionBrowserRecord.checkedAt && latestProductionBrowserAttempt.roomCreateHttpStatus !== 201);
const latestAttemptSummary = latestProductionFailure
  ? `A prior Production room-create failure on deployment ${latestProductionFailure.deploymentId} returned HTTP ${latestProductionFailure.httpStatus} after ${latestProductionFailure.durationMs} ms (${latestProductionFailure.timeoutKind ?? "database timeout"}); ${latestProductionFailure.databaseStep} took ${latestProductionFailure.databaseStepDurationMs} ms with pool total/idle/waiting all zero${latestProductionFailure.functionLogRequestId ? ` (request ${latestProductionFailure.functionLogRequestId})` : ""}${latestProductionAttempt?.roomCreated && latestProductionAttempt.checkedAt > latestProductionFailure.checkedAt ? `; a later core browser run created room ${latestProductionAttempt.roomCode}, completed setup, accepted a legal move at revision ${latestProductionAttempt.legalMoveAcceptedRevision}, synchronized its peer, and recovered after refresh. The earlier failure still leaves repeat reliability unresolved` : latestProductionFailure.subsequentRoomCreated ? `; a later retry created room ${latestProductionFailure.subsequentRoomCreated.roomCode}, but setup completion and reconnect were not verified` : "; no later successful room-create evidence is recorded and the root cause remains unknown"}`
  : "";
const latestHealthFailure = hostingObservation.production.latestHealthFailure;
const latestMetricsCheck = latestReadiness?.metrics ?? hostingObservation.production.latestMetricsCheck;
const latestHealthClientTimeout = hostingObservation.production.latestHealthClientTimeout;
const latestProbeFailure = latestReadiness?.healthProbeSequence?.find((probe: { timeoutKind?: string }) => probe.timeoutKind);
const latestProbeEvidence = latestProductionHealthSequence
  ? ` The latest bounded Production health sequence ran ${latestProductionHealthSequence.probeCount} times from ${latestProductionHealthSequence.startedAt} to ${latestProductionHealthSequence.checkedAt}; statuses were ${latestProductionHealthSequence.statuses.join(", ")} (${latestProductionHealthSequence.statuses.filter((status: number) => status === 200).length} returned HTTP 200 and ${latestProductionHealthSequence.statuses.filter((status: number) => status !== 200).length} failed); response durations were ${latestProductionHealthSequence.durationsMs.some((duration: number) => typeof duration === "number") ? latestProductionHealthSequence.durationsMs.filter((duration: number) => typeof duration === "number").map((duration: number) => `${duration} ms`).join(", ") : "not measured"}. The request IDs do not prove a shared function instance; this is not a soak. ${latestProductionHealthSequence.timeoutRuntimeLog?.timeoutKind ? `Vercel logs confirmed a Prisma ${latestProductionHealthSequence.timeoutRuntimeLog.timeoutKind} (${latestProductionHealthSequence.timeoutRuntimeLog.requestId}) with pool total/idle/waiting all zero; later requests recovered, but the cause remains unknown.` : latestProductionHealthSequence.statuses.every((status: number) => status === 200) ? "This later all-success sample does not undo the earlier server-side timeout or identify its cause." : "The health failures remain unresolved."}`
  : latestProbeFailure?.runtimeLog
  ? ` The latest health request timed out after 20 seconds; Vercel logs confirm a Prisma ${latestProbeFailure.timeoutKind} (${latestProbeFailure.runtimeLog.requestId}) with pool total/idle/waiting all zero. The immediate retry returned HTTP ${productionHealthStatus}; the reason the pool had no available client remains unknown.`
  : latestReadiness
  ? ` The latest client health-probe sequence timed out once after 20 seconds without response headers, then returned HTTP ${productionHealthStatus}; no matching runtime log is recorded.`
  : "";
const boundaryProbeEvidence = latestProductionHealthSequence
  ? `A bounded Production health sequence from ${latestProductionHealthSequence.startedAt} to ${latestProductionHealthSequence.checkedAt} returned statuses ${latestProductionHealthSequence.statuses.join(", ")}; ${latestProductionHealthSequence.statuses.filter((status: number) => status === 200).length} returned HTTP 200 and ${latestProductionHealthSequence.statuses.filter((status: number) => status !== 200).length} failed. The request IDs do not prove same-instance behavior or a soak; the earlier intermittent database timeout remains unexplained.`
  : latestReadiness
  ? "The latest docs-only Production deployment returned a successful health response after one client-side request timed out at 20 seconds; Vercel logs confirmed a Prisma query-read-timeout with pool total/idle/waiting all zero, but the reason no client was available remains unknown."
  : "One later client health request on the current deployment timed out without a matching server log, then health recovered.";
const timeoutEvidence = `${latestTimeout?.note ? ` ${latestTimeout.note}` : ""}${latestAttemptSummary ? ` ${latestAttemptSummary}.` : ""}${latestHealthFailure ? ` Latest server-side health failure: HTTP ${latestHealthFailure.httpStatus}${latestHealthFailure.durationMs == null ? "" : ` after ${latestHealthFailure.durationMs} ms`}; a later check returned ${latestHealthFailure.recovery.httpStatus}${latestHealthFailure.recovery.elapsedMs == null ? "" : ` in ${latestHealthFailure.recovery.elapsedMs} ms`}.` : ""}${latestHealthClientTimeout ? ` One earlier client health request on ${latestHealthClientTimeout.deploymentId} returned no response after ${latestHealthClientTimeout.clientTimeoutMs} ms and has no matching Vercel request record or timeout log; the following health check returned HTTP ${latestHealthClientTimeout.subsequentCheck.httpStatus} in ${latestHealthClientTimeout.subsequentCheck.elapsedMs} ms.` : ""}${latestProbeEvidence}`;
const latestMetricCounters = latestMetricsCheck?.counters ?? latestMetricsCheck?.sample;
const latestHealthCheckEvidence = latestHealthCheckIsNewer
  ? ` A direct canonical /api/health request at ${latestHealthCheck.checkedAt} returned HTTP ${latestHealthCheck.httpStatus} and reported ${latestHealthCheck.health.persistence} persistence with ${latestHealthCheck.health.realtimeFanout.mode} ready${latestHealthCheck.durationMs == null ? "; its duration was not measured" : ` in ${latestHealthCheck.durationMs} ms`}.`
  : "";
const environmentVariableMetadataEvidence = environmentVariableMetadataAudit
  ? `Vercel Production variable names and hidden-value metadata checked ${environmentVariableMetadataAudit.checkedAt}: ${environmentVariableMetadataAudit.variables.map((variable: { name: string; displayedAge: string }) => `${variable.name} (${variable.displayedAge})`).join(", ")}. ${environmentVariableMetadataAudit.runtimeSelection} ${environmentVariableMetadataAudit.limitation}`
  : "Production database environment variable metadata has not been audited.";
const hostingEvidence = `Production homepage ${hostingObservation.production.url} returns HTTP ${hostingObservation.production.status}; ${productionClient}; production /api/health ${displayedProductionHealthStatus}, /health HTTP ${hostingObservation.production.routes?.["/health"] ?? "not checked"} (static HTML fallback), and /api/metrics returns HTTP ${productionMetricsStatus}${previewEvidence}${regionPreviewEvidence}. ${databaseEvidence}. ${workspaceMeterFreshness} ${environmentVariableMetadataEvidence} ${pollingVolumeEvidence} ${latestFullMatchAttemptEvidence}${recentRuntimeErrors ? ` Vercel reported ${recentRuntimeErrors.errorCount} runtime errors on ${recentRuntimeErrors.routes.join(" and ")} in the ${recentRuntimeErrors.lookback} ending ${recentRuntimeErrors.checkedAt}; this is not soak evidence.` : ""}${latestMetricsCheck?.note ? ` Latest instance-local metrics: ${latestMetricCounters?.requestFailures ?? "unknown"} request failures, ${latestMetricCounters?.serverErrors ?? "unknown"} server errors. ${latestMetricsCheck.note}` : ""}${runtimeLogRetention ? ` Hobby runtime logs retain ${runtimeLogRetention.retention}; expired timeout logs cannot be recovered.` : ""}${latestProductionErrorLogCheck ? ` ${latestProductionErrorLogCheck.summary} ${latestProductionErrorLogCheck.limitation}` : ""}${latestHealthCheckEvidence}${timeoutEvidence}`;
const currentSequenceHasFailure = Boolean(latestProductionHealthSequence?.statuses?.some((status: number) => status !== 200));
const roomCreateTimedOutAfterHealthSequence = Boolean(latestProductionBrowserAttempt?.timeoutKind === "query-read-timeout" && latestProductionBrowserAttempt.checkedAt > (latestProductionHealthSequence?.checkedAt ?? ""));
const hostingStatus = roomCreateTimedOutAfterHealthSequence
  ? "API/DB DEPLOYED; LATEST ROOM CREATE TIMED OUT AFTER HEALTH PROBES PASSED; PRODUCTION GATE OPEN"
  : productionHealthStatus === 200 && (latestHealthFailure || currentSequenceHasFailure)
  ? "API/DB DEPLOYED; CURRENT HEALTH PROBE PASSED AFTER PRIOR TIMEOUTS; PRODUCTION GATE OPEN"
  : latestHealthFailure ? "API/DB DEPLOYED; INTERMITTENT HEALTH; PRODUCTION GATE OPEN"
  : productionHealthStatus === 200 ? "API/DB DEPLOYED; PRODUCTION READINESS GATE OPEN" : "PRODUCTION API/DB RELEASE GATE OPEN";
const browser = JSON.parse(await readFile(resolve(root, "output/board-art/browser-verification.json"), "utf8"));
const passedViewports = browser.viewports.filter((viewport: { passed: boolean }) => viewport.passed).length;
const browserEvidence = `${passedViewports}/${browser.viewports.length} audited-board browser viewports pass`;
const productionSmoke = productionDeployment?.twoProfileSmoke;
const observedProductionBrowser = hostingObservation.production.browserVerification;
const latestProductionBrowser = hostingObservation.production.latestProductionBrowserVerification;
const productionBrowserCoreRuns = (hostingObservation.production.productionBrowserCoreRuns ?? []).filter((run: { deploymentId: string }) => run.deploymentId === latestProductionBrowser?.deploymentId);
const spectatorCoverage = latestProductionBrowser?.spectatorReadOnlyThroughMovePhase
  ? "a spectator joined and remained read-only through Move"
  : "spectator synchronization was not checked";
const productionSmokeEvidence = latestProductionBrowser && latestProductionAttemptAfterBrowserPass
  ? `An earlier three-profile Production core flow on ${latestProductionBrowser.deploymentId} passed through legal move, peer sync, and refresh recovery; the later browser attempt at ${hostingObservation.production.latestProductionBrowserAttempt?.checkedAt} on ${hostingObservation.production.latestProductionBrowserAttempt?.deploymentId} failed before room creation with HTTP ${hostingObservation.production.latestProductionBrowserAttempt?.httpStatus} after ${hostingObservation.production.latestProductionBrowserAttempt?.durationMs} ms (${hostingObservation.production.latestProductionBrowserAttempt?.timeoutKind}); no room or game actions occurred and the root cause remains unknown`
  : latestProductionBrowser
  ? `Production deployment ${latestProductionBrowser.deploymentId} passed an automated ${latestProductionBrowser.isolatedChromeProfiles}-profile two-player browser core flow; room ${latestProductionBrowser.roomCode} completed the waiting-room start and ${latestProductionBrowser.setupActions} setup actions, accepted legal move revision ${latestProductionBrowser.legalMove.acceptedRevision} with peer synchronization, and recovered after refresh. The earlier Production room-create timeout remains unresolved; repeat reliability, timeout diagnosis, ${spectatorCoverage}, and full human-match acceptance remain open`
  : productionSmoke
  ? `${productionSmoke}${latestAttemptSummary ? `; ${latestAttemptSummary}` : ""}`
  : observedProductionBrowser?.latestAttempt && observedProductionBrowser?.priorAttemptFailure
    ? `Production deployment ${observedProductionBrowser.deploymentId} later passed a three-profile core browser flow in room ${observedProductionBrowser.latestAttempt.roomCode}, accepting revision ${observedProductionBrowser.latestAttempt.acceptedRevision} with peer synchronization and refresh recovery; an earlier room create on the same deployment timed out after ${observedProductionBrowser.priorAttemptFailure.durationMs} ms with no pg pool connection, so repeat/idle reliability remains open`
  : observedProductionBrowser?.status?.startsWith("intermittent-core-flow")
    ? `Production deployment ${observedProductionBrowser.deploymentId} passed one three-profile core browser flow in room ${observedProductionBrowser.roomCode}, accepting revision ${observedProductionBrowser.acceptedRevision} and recovering the same state on refresh; a second room create timed out after 20.156 seconds, so repeat/idle reliability remains open`
  : observedProductionBrowser?.status?.startsWith("passed-core-flow")
    ? `Production deployment ${observedProductionBrowser.deploymentId} passed one three-profile core browser flow in room ${observedProductionBrowser.roomCode}, accepting revision ${observedProductionBrowser.acceptedRevision} and recovering the same state on refresh; earlier timeout evidence and repeat/idle reliability remain open`
  : observedProductionBrowser?.status === "observed-core-flow-repeatability-open"
    ? `one Production core browser flow on ${observedProductionBrowser.deploymentId} accepted revision ${observedProductionBrowser.acceptedRevision} and recovered on refresh; repeatability failed on a later create-room timeout`
  : "no Production two-browser smoke recorded";
const browserAcceptanceGaps = latestProductionBrowser
  ? "full human match, post-Move spectator gameplay, assistive-technology, and manual touch acceptance remain open"
  : "full human match, spectator, assistive-technology, and manual touch acceptance remain open";
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
| Deployed service health | ${productionDeploymentEvidence}; ${hostingEvidence} The database-specific count is not a workspace total. | ${hostingStatus} |
| Browser QA | ${browserEvidence}; ${onlineEvidence}; ${productionSmokeEvidence}; ${browserAcceptanceGaps} | ${latestProductionHealthSequence?.statuses?.some((status: number) => status !== 200) ? "CORE BROWSER FLOW PASSED; INTERMITTENT HEALTH; RELIABILITY GATE OPEN" : latestProductionBrowser && latestProductionAttemptAfterBrowserPass ? "LATEST ROOM CREATE FAILED; RELIABILITY GATE OPEN" : latestProductionBrowser ? "CORE BROWSER FLOW PASSED; RELIABILITY GATE OPEN" : observedProductionBrowser?.status === "current-deployment-core-incomplete" ? "PRODUCTION CORE FLOW INCOMPLETE; CREATE/WAITING ROOM INTERMITTENT" : latestProductionAttempt ? (latestProductionAttempt.subsequentRoomCreated ? "CREATE RETRY PASSED; SETUP INCOMPLETE" : "PRIOR CREATE FAILED; REPEATABILITY OPEN") : productionSmoke ? "PRODUCTION MULTIPLAYER SMOKE VERIFIED" : passedViewports === browser.viewports.length && passedViewports > 0 ? onlineStatus : "PARTIAL"} |
| Production release | Complete human match, spectator acceptance, sustained capacity evidence, routine backup/restore ownership, open rules and board review, accessibility/content/privacy/security sign-offs, rollback rehearsal, and release approvals | BLOCKED |

## Current release boundary

New MVP room creation pins the human-audited board ID, version, ruleset version, and content hash. ${latestProductionBrowser && latestProductionAttemptAfterBrowserPass ? `An earlier ${latestProductionBrowser.isolatedChromeProfiles}-profile browser core flow on ${latestProductionBrowser.deploymentId} passed room create/join/start/setup/legal move/peer sync/refresh recovery, but the latest ${hostingObservation.production.latestProductionBrowserAttempt?.isolatedChromeProfiles}-profile attempt on ${hostingObservation.production.latestProductionBrowserAttempt?.deploymentId} failed before room creation with HTTP ${hostingObservation.production.latestProductionBrowserAttempt?.httpStatus} after ${hostingObservation.production.latestProductionBrowserAttempt?.durationMs} ms (${hostingObservation.production.latestProductionBrowserAttempt?.timeoutKind}). No room or game actions occurred. The deployment’s root cause, repeatability, and full human-match acceptance remain open.` : latestProductionBrowser ? `${productionBrowserCoreRuns.length + 1} separate ${latestProductionBrowser.isolatedChromeProfiles}-profile browser core flows passed on current Production deployment ${latestProductionBrowser.deploymentId} through room create/join/start/setup/legal move/peer sync/refresh recovery. Spectator synchronization was not checked on this deployment. The preceding deployment had repeated room-create and health query timeouts. ${boundaryProbeEvidence} Extended reliability, timeout diagnosis, and full human-match acceptance remain open.` : observedProductionBrowser?.status === "current-deployment-core-incomplete" ? "Current Production acceptance remains incomplete: one run reached authoritative setup completion but did not test legal action or refresh recovery; another showed a stale host waiting-room view after a successful join; a later create attempt timed out. A 20-second health failure then recovered on one retry. The database/connection cause and repeatable core flow remain unresolved." : latestProductionAttempt ? (latestProductionAttempt.subsequentRoomCreated ? "On the current Production deployment, one create attempt returned a classified query-read timeout after 20 seconds; a later retry created a room, but setup completion and reconnect were not verified. Repeatability and full core-flow acceptance remain open." : "A prior Production multiplayer browser flow passed through a legal move and refresh recovery, but a later create attempt on a previous deployment timed out; repeatability and timeout diagnosis remain open.") : productionSmoke ? "Production multiplayer has passed a synthetic two-browser test through a legal move and refresh recovery." : observedProductionBrowser?.status?.startsWith("intermittent-core-flow") ? "One current-deployment Production core browser flow passed, then a second room creation timed out; repeat/idle reliability, timeout diagnosis, full human-match acceptance, and release gates remain open." : observedProductionBrowser?.status?.startsWith("passed-core-flow") ? "One current-deployment Production core browser flow passed, but repeat/idle reliability, timeout diagnosis, full human-match acceptance, and release gates remain open." : observedProductionBrowser?.status === "observed-core-flow-repeatability-open" ? "One core Production browser flow has been observed, but repeatable current-deployment create/join/action/reconnect acceptance remains open after a database timeout." : "Production two-browser multiplayer evidence remains open."} The user-authorized board-data sign-off is recorded; independent review, hosted restart/soak, shared operation-cap headroom, routine tested backups and restore ownership, complete human match, source-gated rules, security/credential rotation, rollback rehearsal, and full release approvals remain open. Production has not been designated production-ready. Existing provisional matches retain their immutable pins.
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
