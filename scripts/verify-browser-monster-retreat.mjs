import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = join(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a monster retreat acceptance verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/monster-retreat-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stateOf = (page) => page.locator("#monster-retreat-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const setupOf = (page) => page.locator("#monster-retreat-fixture").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const rectOf = (locator) => locator.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
});
const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
const server = spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: join(cwd, "apps/web"),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const stopServer = async () => {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), wait(2000).then(() => server.kill("SIGKILL"))]);
};

const report = {
  started: new Date().toISOString(),
  scope: "Fixture-level Chromium evidence for a real applyCommand move and Fight resolution generating pendingRetreat.monsterId, then feeding that generated state to production PhaseActions, HexGrid, and BoardViewport. PhaseActions presents the monster-retreat instruction; the engine's legal options drive board highlights and immediate destination commands. Controlled combat stats bound the scenario. It checks default and expanded panel preferences while the production route temporarily clears the board only for the canAct seat, confirms the phase status stays readable and the panel preference returns after resolution, and tests every legal destination. A separate read-only projection checks that panel and single-monster camera focus stay unchanged for waiting users. It does not establish an engine path for the distinct multi-unit retreat-choice box, a full main-route flow, persisted-service behavior, physical-edition rules, or accessibility conformance.",
  browser: "Chromium via Playwright",
  scenarios: {},
  runtimeErrors: [],
};
let browser;
try {
  mkdirSync(artifactDirectory, { recursive: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) break; } catch { /* wait for Vite */ }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  report.browserVersion = browser.version();

  const viewports = [
    { name: "desktopPointer", width: 1280, height: 900, input: "pointer" },
    { name: "phoneTouch", width: 390, height: 844, input: "touch" },
    { name: "compactTouch", width: 320, height: 740, input: "touch" },
  ];

  const newContext = (viewport) => viewport.input === "touch"
    ? browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    : browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const visibleCellMetrics = (page) => page.locator(".hex-tile.retreat-legal").evaluateAll((nodes) => {
    const mapRect = document.querySelector(".board-viewport")?.getBoundingClientRect();
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const topmost = document.elementFromPoint(x, y);
      return {
        key: node.getAttribute("data-hex-key"),
        bounds: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        centerVisibleAndUnobscured: rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0
          && x <= innerWidth && y <= innerHeight && (topmost === node || node.contains(topmost)),
        centerHitTarget: topmost ? { tag: topmost.tagName, className: typeof topmost.className === "string" ? topmost.className : "", id: topmost.id } : null,
        fullyVisibleInViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        fullyVisibleInBoard: Boolean(mapRect && rect.left >= mapRect.left && rect.top >= mapRect.top && rect.right <= mapRect.right && rect.bottom <= mapRect.bottom),
        touchTargetAtLeast44px: rect.width >= 44 && rect.height >= 44,
      };
    });
  });

  const auditPanelPreference = async (viewport, preference) => {
    const context = await newContext(viewport);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => report.runtimeErrors.push(`${viewport.name}-${preference}: ${error.message}`));
    await page.goto(`${url}?panel=${preference}`, { waitUntil: "domcontentloaded" });

    const initial = await stateOf(page);
    const setup = await setupOf(page);
    assert.equal(initial.phase, "fight");
    assert.equal(initial.pendingDecision?.type, "retreat");
    assert.equal(initial.pendingRetreat?.monsterId, initial.monster?.id);
    const phaseActions = page.locator('.retreat-choice[aria-label="Choose monster retreat destination"]');
    await phaseActions.waitFor({ state: "attached" });
    const phaseActionsLabel = await phaseActions.locator("strong").evaluate((node) => node.textContent?.trim());
    const phaseActionsInstruction = await phaseActions.locator("span").evaluate((node) => node.textContent?.trim());
    assert.equal(phaseActionsLabel, `${initial.monster.name} must retreat.`,
      "production PhaseActions receives the engine-generated retreat state and identifies its monster");
    assert.equal(phaseActionsInstruction, "Select a glowing adjacent hex on the board.",
      "production PhaseActions tells the active player how to apply the legal options shown on the board");
    assert.equal(initial.panelPreferenceOpen, preference === "open");
    assert.equal(initial.panelVisible, false, "the status panel is temporarily closed while immediate retreat cells are active");
    assert.ok(setup.setupCommands.some((command) => command.type === "move"), "the fixture first uses a real move command");
    assert.ok(setup.setupFightEvents.includes("fight.resolved"), "applyCommand fight resolution must generate the pending monster retreat");
    assert.ok(initial.pendingRetreat.options[initial.pendingRetreat.monsterId].length > 0);

    const legalKeys = [...initial.pendingRetreat.options[initial.pendingRetreat.monsterId]].sort();
    const highlights = await page.locator(".hex-tile.retreat-legal").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-hex-key")).sort());
    assert.deepEqual(highlights, legalKeys, "HexGrid highlights exactly the engine-generated monster retreat destinations");
    for (const key of legalKeys) {
      assert.equal(await page.locator(`.hex-tile[data-hex-key="${key}"]`).evaluate((node) => node.classList.contains("retreat-legal")), true,
        `engine legal destination ${key} is highlighted by the production HexGrid`);
    }

    const boardPrompt = page.getByRole("status", { name: "Board retreat prompt" });
    const statusMessage = page.locator(".retreat-phase-status .retreat-phase-indicator");
    await boardPrompt.waitFor({ state: "visible" });
    await statusMessage.waitFor({ state: "visible" });
    assert.match(await boardPrompt.innerText(), /retreats.*glowing adjacent hex/i);
    assert.equal(await statusMessage.innerText(), "Choose retreat", "the production phase status stays readable during the temporary panel collapse");
    const promptBounds = await rectOf(boardPrompt);
    const statusBounds = await rectOf(statusMessage);
    assert.equal(overlaps(promptBounds, statusBounds), false,
      `${viewport.width}px retreat prompt and phase-status message must not overlap: ${JSON.stringify({ promptBounds, statusBounds })}`);
    assert.ok(promptBounds.x >= -1 && promptBounds.right <= viewport.width + 1, "inline retreat prompt fits viewport width");
    assert.ok(statusBounds.x >= -1 && statusBounds.right <= viewport.width + 1, "phase-status message fits viewport width");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "retreat presentation has no horizontal overflow");
    const toggle = preference === "open"
      ? page.getByRole("button", { name: "Keep turn panel minimized after retreat" })
      : page.getByRole("button", { name: "Expand turn panel after retreat" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false", "aria-expanded reflects the visibly collapsed presentation");

    const visibleLegalCells = await visibleCellMetrics(page);
    assert.deepEqual(visibleLegalCells.map((cell) => cell.key).sort(), legalKeys);
    assert.ok(visibleLegalCells.every((cell) => cell.centerVisibleAndUnobscured && cell.fullyVisibleInViewport && cell.fullyVisibleInBoard),
      `every legal retreat destination must be fully visible and unobscured at ${viewport.width}px with ${preference} panel preference: ${JSON.stringify(visibleLegalCells)}`);
    if (viewport.width <= 700) {
      assert.ok(visibleLegalCells.every((cell) => cell.touchTargetAtLeast44px),
        `every phone/compact retreat target must be at least 44×44 CSS pixels: ${JSON.stringify(visibleLegalCells)}`);
    }

    const selectionResults = [];
    for (const [index, destination] of legalKeys.entries()) {
      let selectionPage = page;
      let selectionContext;
      if (index > 0) {
        selectionContext = await newContext(viewport);
        selectionPage = await selectionContext.newPage();
        selectionPage.setDefaultTimeout(10000);
        selectionPage.on("pageerror", (error) => report.runtimeErrors.push(`${viewport.name}-${preference}-${destination}: ${error.message}`));
        await selectionPage.goto(`${url}?panel=${preference}`, { waitUntil: "domcontentloaded" });
      }
      const beforeSelection = await stateOf(selectionPage);
      assert.equal(beforeSelection.pendingRetreat?.monsterId, initial.monster.id);
      const legalTarget = selectionPage.locator(`.hex-tile.retreat-legal[data-hex-key="${destination}"]`);
      assert.equal(await legalTarget.count(), 1, `${destination} is a rendered legal choice`);
      if (viewport.input === "touch") await legalTarget.tap();
      else await legalTarget.click();
      await selectionPage.waitForFunction(() => JSON.parse(document.querySelector("#monster-retreat-state")?.textContent ?? "{}").pendingRetreat === undefined);

      const resolved = await stateOf(selectionPage);
      assert.equal(resolved.submittedCommands.length, 1, `${destination}: selecting this legal cell submits exactly one retreat command`);
      assert.deepEqual(resolved.submittedCommands[0], { type: "retreat", destinations: { [initial.monster.id]: destination } });
      assert.equal(resolved.lastEventAction, "retreat.resolved");
      assert.equal(resolved.eventCount, beforeSelection.eventCount + 1, `${destination}: retreat selection appends exactly one resolution event`);
      assert.deepEqual(resolved.lastEventDetail?.destinations, { [initial.monster.id]: destination });
      assert.equal(resolved.monster.location, destination, "the production applyCommand result moves the monster to the selected cell");
      assert.equal(resolved.pendingRetreat, undefined, "the retreat decision clears after resolution");
      assert.equal(resolved.panelPreferenceOpen, preference === "open", "retreat resolution preserves the pre-existing panel preference");
      assert.equal(resolved.panelVisible, preference === "open", "the expanded panel returns after retreat resolution when it was previously open");
      assert.equal(await selectionPage.locator(".layout").evaluate((node) => node.classList.contains("panel-open")), preference === "open");
      assert.equal(await selectionPage.locator(".hex-tile.retreat-legal").count(), 0, "the old retreat highlights clear after the command");
      selectionResults.push({
        destination,
        input: viewport.input,
        commandCount: resolved.submittedCommands.length,
        eventAction: resolved.lastEventAction,
        eventCountDelta: resolved.eventCount - beforeSelection.eventCount,
        finalMonsterLocation: resolved.monster.location,
        pendingRetreatCleared: resolved.pendingRetreat === undefined,
        panelPreferenceRestored: resolved.panelVisible === (preference === "open"),
      });
      if (selectionContext) await selectionContext.close();
    }

    const result = {
      status: "passed",
      viewport: { width: viewport.width, height: viewport.height },
      input: viewport.input,
      initialPanelPreference: preference,
      panelTemporarilyCollapsed: true,
      fixture: {
        seed: 8,
        moveCommand: setup.setupCommands.find((command) => command.type === "move"),
        battleFightEvents: setup.setupFightEvents,
        combatStatsControlled: setup.combatStatsControlled,
        generatedPendingMonsterId: initial.pendingRetreat.monsterId,
        battleId: initial.pendingRetreat.battleId,
      },
      phaseActions: {
        status: "passed",
        generatedPendingRetreatConsumed: true,
        renderedInHiddenTurnPanelDuringImmediateChoice: !(await phaseActions.isVisible()),
        label: phaseActionsLabel,
        instruction: phaseActionsInstruction,
        destinationControls: "production HexGrid legal highlights; one immediate retreat command per selected hex",
      },
      legalHighlights: legalKeys,
      visibleLegalCells,
      selectionResults,
      promptBounds,
      statusMessageBounds: statusBounds,
      promptStatusOverlap: false,
      noHorizontalOverflow: true,
    };
    await context.close();
    return result;
  };

  for (const viewport of viewports) {
    report.scenarios[viewport.name] = await auditPanelPreference(viewport, "closed");
    report.scenarios[`${viewport.name}ExpandedPreference`] = await auditPanelPreference(viewport, "open");
  }

  const waitingViewport = viewports.find(({ name }) => name === "phoneTouch");
  const waitingContext = await newContext(waitingViewport);
  const waitingPage = await waitingContext.newPage();
  waitingPage.setDefaultTimeout(10000);
  waitingPage.on("pageerror", (error) => report.runtimeErrors.push(`waiting-readonly: ${error.message}`));
  await waitingPage.goto(`${url}?panel=open&role=waiting`, { waitUntil: "domcontentloaded" });
  const waiting = await stateOf(waitingPage);
  assert.equal(waiting.canChoose, false);
  assert.equal(waiting.pendingRetreat?.monsterId, waiting.monster?.id);
  assert.equal(waiting.panelPreferenceOpen, true);
  assert.equal(waiting.panelVisible, true, "read-only users keep their expanded panel presentation during another player's retreat");
  assert.deepEqual(waiting.cameraFocusKeys, [], "read-only projection does not focus the active player's destination set");
  assert.equal(waiting.cameraSingleFocusKey, waiting.monster.location, "read-only camera retains its prior single-monster focus");
  assert.equal(await waitingPage.locator(".layout").evaluate((node) => node.classList.contains("panel-open")), true);
  assert.equal(await waitingPage.locator(".game-side-panel").isVisible(), true);
  assert.equal(await waitingPage.locator(".hex-tile.retreat-legal").count(), 0, "read-only role receives no actionable retreat highlights");
  const waitingToggle = waitingPage.getByRole("button", { name: "Minimize turn panel" });
  assert.equal(await waitingToggle.getAttribute("aria-expanded"), "true");
  report.readOnlyProjection = {
    status: "passed",
    viewport: { width: waitingViewport.width, height: waitingViewport.height },
    panelVisible: waiting.panelVisible,
    panelPreferenceOpen: waiting.panelPreferenceOpen,
    focusedLegalDestinationKeys: waiting.cameraFocusKeys,
    retainedSingleFocusKey: waiting.cameraSingleFocusKey,
    actionableRetreatHighlights: 0,
    toggleExpanded: true,
  };
  await waitingContext.close();

  assert.deepEqual(report.runtimeErrors, [], "monster retreat browser flows complete without uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `monster-retreat-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Monster retreat board browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `monster-retreat-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
