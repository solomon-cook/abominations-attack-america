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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve an encounter choice verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}/phase-encounter-choice-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stateOf = (page) => page.locator("#phase-encounter-choice-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const boundsOf = (page, selector) => page.locator(selector).evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
});
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
  scope: "Fixture-level browser acceptance of the production phase-context disclosure and PhaseActions encounter resolution/reward choices using real applyCommand. Active fixtures start with the Encounter options disclosure open and no command applied; waiting fixtures start with a separately seeded pending choice. The waiting projection is canAct=false without a live room/service. The command-handler failure is injected locally before applyCommand and does not test a service failure. The full main route is not mounted.",
  disclosureHitArea: {
    mobileMinimumTargetCssPx: 44,
    stylingChange: "min-height only, scoped to the existing max-width:700px media rule",
    preAdjustmentMeasurement: {
      browserVersion: "140.0.7339.186",
      activePhone390x844: { width: 358, height: 38, computedMinHeight: "38px" },
      waiting320x740: { width: 288, height: 38, computedMinHeight: "38px" },
    },
  },
  browser: "Chromium via Playwright",
  scenarios: {},
  runtimeErrors: [],
};
let browser;

async function openPage(context, scenario, role = "active", injectFailure = false) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const tag = `${scenario}-${role}`;
  page.on("pageerror", (error) => report.runtimeErrors.push(`${tag}: ${error.message}`));
  const params = new URLSearchParams({ scenario, role });
  if (injectFailure) params.set("injectFailure", "once");
  await page.goto(`${baseUrl}?${params}`, { waitUntil: "domcontentloaded" });
  await page.locator("#phase-encounter-choice-state").waitFor({ state: "attached" });
  const initial = await stateOf(page);
  assert.equal(initial.phase, "encounter");
  if (role === "waiting") {
    assert.equal(initial.decision.type, "encounter-choice");
    assert.equal(initial.decision.source, scenario);
    assert.equal(initial.eventCount, initial.initialEventCount, "waiting projection is separately seeded at the pending-choice state");
    await assertChoiceGroup(page, scenario, initial);
  } else {
    assert.equal(initial.decision.type, "encounter-resolution");
    assert.equal(initial.eventCount, initial.initialEventCount, "active fixture starts before Resolve encounter is activated");
    assert.equal(await page.getByRole("button", { name: "Resolve encounter", exact: true }).count(), 1,
      "the active fixture exposes PhaseActions Resolve encounter before the pending reward");
    assert.equal(await page.getByRole("group", { name: scenario === "zorb-city" ? "Choose Zorb city benefit" : "Choose Iron Stomach base reward" }).count(), 0);
  }
  return { page, initial };
}

async function assertChoiceGroup(page, scenario, choiceState) {
  assert.equal(choiceState.decision.type, "encounter-choice");
  assert.equal(choiceState.decision.source, scenario);
  assert.deepEqual(choiceState.decision.choices, ["health", "infamy"]);
  assert.equal(choiceState.lastEventAction, "encounter.choice-required");
  const expectedLabel = scenario === "zorb-city" ? "Choose Zorb city benefit" : "Choose Iron Stomach base reward";
  const group = page.getByRole("group", { name: expectedLabel });
  await group.waitFor({ state: "visible" });
  assert.equal(await page.getByRole("group", { name: expectedLabel }).count(), 1, `${scenario} choice is exposed as a named group`);
  if (scenario === "zorb-city") {
    assert.match(await group.innerText(), new RegExp(`Zorb rolled ${choiceState.decision.healthRoll} Health from the city\\.`));
    assert.equal(await group.getByRole("button", { name: `Take ${choiceState.decision.healthRoll} Health`, exact: true }).count(), 1);
    assert.equal(await group.getByRole("button", { name: "Take 2 Infamy instead", exact: true }).count(), 1);
  } else {
    assert.match(await group.innerText(), /Iron Stomach: choose 3 Health or the base’s 1 Infamy\./);
    assert.equal(await group.getByRole("button", { name: "Take 3 Health", exact: true }).count(), 1);
    assert.equal(await group.getByRole("button", { name: "Take 1 Infamy instead", exact: true }).count(), 1);
  }
  return group;
}

async function assertDisclosureToggleDoesNotChangeGame(page, before, label) {
  const after = await stateOf(page);
  assert.deepEqual(after.attemptedCommands, before.attemptedCommands, `${label}: disclosure toggle submits no command`);
  assert.deepEqual(after.appliedCommands, before.appliedCommands, `${label}: disclosure toggle applies no command`);
  assert.equal(after.eventCount, before.eventCount, `${label}: disclosure toggle appends no event`);
  assert.equal(after.lastEventAction, before.lastEventAction, `${label}: disclosure toggle leaves the latest event unchanged`);
}

async function auditPhaseContextDisclosure(page, initial, { input, role, scenario }) {
  const details = page.locator(".phase-encounter-choice-harness details.piece-context-tab");
  const summary = details.locator(":scope > summary");
  assert.equal(await details.count(), 1, `${role} fixture exposes one Encounter options disclosure`);
  assert.equal(await details.evaluate((node) => node.open), true, `${role} fixture starts with Encounter options open`);
  assert.equal(await summary.evaluate((node) => node.tabIndex), 0, `${role} disclosure summary is keyboard focusable`);
  const summaryBounds = await summary.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      computedMinHeight: getComputedStyle(node).minHeight,
    };
  });
  assert.ok(summaryBounds.x >= -1 && summaryBounds.right <= summaryBounds.viewportWidth + 1
    && summaryBounds.y >= -1 && summaryBounds.bottom <= summaryBounds.viewportHeight + 1,
  `${role} disclosure summary fits its compact viewport: ${JSON.stringify(summaryBounds)}`);
  if (input === "touch") {
    assert.ok(summaryBounds.width >= 44 && summaryBounds.height >= 44,
      `${role} disclosure summary meets the 44px mobile touch target: ${JSON.stringify(summaryBounds)}`);
  }

  let controls;
  let expectedControlCount;
  if (role === "active") {
    controls = details.locator('.path-controls[aria-label="Resolve encounter"] button');
    expectedControlCount = 1;
  } else {
    const expectedLabel = scenario === "zorb-city" ? "Choose Zorb city benefit" : "Choose Iron Stomach base reward";
    controls = details.locator(`[role="group"][aria-label="${expectedLabel}"] button`);
    expectedControlCount = 2;
  }
  assert.equal(await controls.count(), expectedControlCount, `${role} disclosure contains the expected PhaseActions controls`);
  assert.equal(await controls.first().isVisible(), true, `${role} PhaseActions controls are visible while expanded`);
  if (role === "waiting") {
    assert.ok(await controls.evaluateAll((nodes) => nodes.every((node) => node instanceof HTMLButtonElement && node.disabled)),
      "waiting-role PhaseActions controls remain disabled while the disclosure is expanded");
  }

  const before = await stateOf(page);
  assert.equal(before.eventCount, initial.eventCount, `${role} disclosure fixture begins without an event change`);
  assert.deepEqual(before.attemptedCommands, initial.attemptedCommands, `${role} disclosure fixture begins without new command attempts`);
  assert.deepEqual(before.appliedCommands, initial.appliedCommands, `${role} disclosure fixture begins without new applied commands`);
  assert.deepEqual(before.attemptedCommands, [], `${role} fixture has not submitted a command before toggling the disclosure`);
  assert.deepEqual(before.appliedCommands, [], `${role} fixture has not applied a command before toggling the disclosure`);
  const focusSnapshots = {};
  if (input === "keyboard") {
    await summary.focus();
    assert.equal(await summary.evaluate((node) => node === document.activeElement), true, "keyboard audit focuses the disclosure summary");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector(".phase-encounter-choice-harness details.piece-context-tab")?.open === false);
    assert.equal(await summary.evaluate((node) => node === document.activeElement), true, "keyboard collapse keeps focus on the disclosure summary");
    focusSnapshots.afterCollapse = true;
  } else {
    await summary.scrollIntoViewIfNeeded();
    const rect = await summary.boundingBox();
    assert.ok(rect && rect.width > 0 && rect.height > 0, `${role} summary has a touch target`);
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForFunction(() => document.querySelector(".phase-encounter-choice-harness details.piece-context-tab")?.open === false);
    focusSnapshots.afterCollapse = await summary.evaluate((node) => node === document.activeElement);
    assert.equal(focusSnapshots.afterCollapse, true, "Chromium touch collapse retains focus on the disclosure summary");
  }
  assert.equal(await controls.first().isVisible(), false, `${role} PhaseActions controls are hidden while collapsed`);
  await assertDisclosureToggleDoesNotChangeGame(page, before, `${role} disclosure collapse`);

  if (input === "keyboard") {
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".phase-encounter-choice-harness details.piece-context-tab")?.open === true);
    assert.equal(await summary.evaluate((node) => node === document.activeElement), true, "keyboard reopen keeps focus on the disclosure summary");
    focusSnapshots.afterReopen = true;
  } else {
    const rect = await summary.boundingBox();
    assert.ok(rect && rect.width > 0 && rect.height > 0, `${role} summary remains available for touch reopen`);
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForFunction(() => document.querySelector(".phase-encounter-choice-harness details.piece-context-tab")?.open === true);
    focusSnapshots.afterReopen = await summary.evaluate((node) => node === document.activeElement);
    assert.equal(focusSnapshots.afterReopen, true, "Chromium touch reopen retains focus on the disclosure summary");
  }
  assert.equal(await controls.first().isVisible(), true, `${role} PhaseActions controls are shown again after reopen`);
  if (role === "waiting") {
    assert.ok(await controls.evaluateAll((nodes) => nodes.every((node) => node instanceof HTMLButtonElement && node.disabled)),
      "waiting-role controls remain disabled after the disclosure is reopened");
  }
  await assertDisclosureToggleDoesNotChangeGame(page, before, `${role} disclosure reopen`);
  const after = await stateOf(page);
  return {
    input,
    role,
    startsExpanded: true,
    summaryKeyboardFocusable: true,
    collapses: true,
    reopens: true,
    controlsHiddenWhenCollapsed: true,
    controlsShownWhenExpanded: true,
    ...(role === "waiting" ? { controlsStayDisabled: true, summaryAvailableToWaitingRole: true } : {}),
    focusRemainsOnSummary: focusSnapshots,
    summaryBounds,
    commandsSubmitted: after.attemptedCommands.length,
    appliedCommands: after.appliedCommands.length,
    eventCountBefore: before.eventCount,
    eventCountAfterToggleCycle: after.eventCount,
    eventCountUnchanged: after.eventCount === before.eventCount,
  };
}

async function activateEncounterResolution(page, input) {
  const resolve = page.getByRole("button", { name: "Resolve encounter", exact: true });
  let traversal;
  if (input === "keyboard") {
    // The disclosure audit leaves focus on its summary; restart the documented
    // tab walk from the preceding phase heading for the Resolve action check.
    await page.locator("#phase-choice-action-heading").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".piece-context-tab > summary")), true,
      "Tab reaches the Encounter options disclosure summary first");
    await page.keyboard.press("Tab");
    assert.equal(await resolve.evaluate((node) => node === document.activeElement), true,
      "the next Tab reaches PhaseActions Resolve encounter");
    await page.keyboard.press("Enter");
    traversal = ["Encounter options", "Resolve encounter"];
  } else {
    await resolve.tap();
    traversal = ["Touch: Resolve encounter"];
  }
  await page.waitForFunction(() => JSON.parse(document.querySelector("#phase-encounter-choice-state")?.textContent ?? "{}").decision?.type === "encounter-choice");
  const state = await stateOf(page);
  const group = await assertChoiceGroup(page, state.scenario, state);
  return { state, group, traversal };
}

async function tabToChoice(page, label) {
  const traversed = [];
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      if (document.activeElement?.matches(".piece-context-tab > summary")) return "Encounter options";
      if (document.activeElement instanceof HTMLButtonElement) return document.activeElement.textContent?.trim() ?? "";
      return "";
    });
    if (active) traversed.push(active);
    if (active === label) return traversed;
  }
  assert.fail(`Tab sequence did not reach ${label}; focus traversed ${JSON.stringify(traversed)}.`);
}

function optionName(scenario, choice, healthRoll) {
  if (scenario === "iron-stomach") return choice === "health" ? "Take 3 Health" : "Take 1 Infamy instead";
  return choice === "health" ? `Take ${healthRoll} Health` : "Take 2 Infamy instead";
}

async function assertResolved(page, scenario, choice, choiceState, expectedAttempts = 2) {
  await page.waitForFunction(() => JSON.parse(document.querySelector("#phase-encounter-choice-state")?.textContent ?? "{}").phase !== "encounter");
  const resolved = await stateOf(page);
  assert.equal(resolved.phase, "deploy", "the choice resolves into the following game phase");
  assert.equal(resolved.decision?.type, "deployment");
  assert.equal(resolved.lastEventAction, "encounter.resolved");
  assert.equal(resolved.eventCount, choiceState.eventCount + 1, "one accepted choice appends exactly one resolution event");
  assert.equal(resolved.attemptedCommands.length, expectedAttempts);
  assert.equal(resolved.appliedCommands.length, 2, "Resolve encounter and exactly one reward choice were accepted");
  assert.deepEqual(resolved.appliedCommands[0], { type: "resolve-encounter" });
  assert.deepEqual(resolved.appliedCommands[1], { type: "resolve-encounter", choice });
  assert.equal(resolved.lastEventDetail?.nextPhase, "deploy");
  if (scenario === "zorb-city" && choice === "health") {
    assert.equal(resolved.monster.health, Math.min(resolved.monster.maxHealth, choiceState.monster.health + choiceState.decision.healthRoll));
    assert.equal(resolved.monster.infamy, choiceState.monster.infamy);
  } else if (scenario === "zorb-city") {
    assert.equal(resolved.monster.health, choiceState.monster.health);
    assert.equal(resolved.monster.infamy, choiceState.monster.infamy + 2);
  } else if (choice === "health") {
    assert.equal(resolved.monster.health, choiceState.monster.health + 3);
    assert.equal(resolved.monster.infamy, choiceState.monster.infamy);
  } else {
    assert.equal(resolved.monster.health, choiceState.monster.health);
    assert.equal(resolved.monster.infamy, choiceState.monster.infamy + 1);
  }
  assert.ok(resolved.lastEventDetail?.effects?.some((effect) => effect.type === "stomp"), "the real command result retains its Encounter effects");
  await page.waitForFunction(() => document.activeElement?.id === "phase-choice-action-heading");
  return resolved;
}

async function runActiveChoice(context, { scenario, choice, input, injectFailure = false, replayCheck = false }) {
  const { page, initial } = await openPage(context, scenario, "active", injectFailure);
  const disclosureAudit = await auditPhaseContextDisclosure(page, initial, { input, role: "active", scenario });
  const resolutionButtonBounds = await boundsOf(page, '.path-controls[aria-label="Resolve encounter"]');
  if (input === "touch") {
    const resolutionButton = page.getByRole("button", { name: "Resolve encounter", exact: true });
    const rect = await resolutionButton.boundingBox();
    assert.ok(rect && rect.width >= 44 && rect.height >= 44, `Resolve encounter meets the touch target: ${JSON.stringify(rect)}`);
  }
  const { state: choiceState, group, traversal: resolutionTraversal } = await activateEncounterResolution(page, input);
  assert.equal(choiceState.appliedCommands.length, 1, "the active user action applies Resolve encounter before offering a reward");
  assert.equal(choiceState.eventCount, initial.eventCount + 1, "Resolve encounter appends one choice-required event before the reward buttons appear");
  assert.deepEqual(choiceState.appliedCommands[0], { type: "resolve-encounter" });
  const label = optionName(scenario, choice, choiceState.decision.healthRoll);
  const button = group.getByRole("button", { name: label, exact: true });
  const bounds = await boundsOf(page, '[role="group"][aria-label]');
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1,
    `${scenario} choice group fits its viewport: ${JSON.stringify(bounds)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario} choice produces no horizontal overflow`);
  const buttonBounds = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  if (input === "touch") assert.ok(buttonBounds.width >= 44 && buttonBounds.height >= 44, `${label} meets the 44px touch target: ${JSON.stringify(buttonBounds)}`);

  let keyboardTraversal = [];
  if (injectFailure) {
    keyboardTraversal = await tabToChoice(page, label);
    await page.keyboard.press("Enter");
    await page.getByRole("alert").getByText("Harness-injected command-handler failure.").waitFor({ state: "visible" });
    const failed = await stateOf(page);
    assert.equal(failed.decision.type, "encounter-choice", "a failed command leaves the reward decision available");
    assert.equal(failed.eventCount, choiceState.eventCount, "handler failure appends no event");
    assert.equal(failed.attemptedCommands.length, 2, "the reveal command and failed choice handler are recorded as attempts");
    assert.equal(failed.appliedCommands.length, 1, "only Resolve encounter is accepted before the injected choice failure");
    const retryButton = page.getByRole("button", { name: label, exact: true });
    assert.ok(await retryButton.isEnabled(), "the failed choice can be retried after pending state clears");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await retryButton.evaluate((node) => node === document.activeElement), true,
      "the failed choice button regains focus as soon as it is re-enabled, without Tab recovery");
    const focusAfterFailure = await page.evaluate(() => document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent?.trim() : document.activeElement?.tagName ?? "");
    await page.keyboard.press("Enter");
    const resolved = await assertResolved(page, scenario, choice, choiceState, 3);
    assert.equal(await page.getByRole("alert").count(), 0, "successful retry clears the earlier fixture error");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "phase-choice-action-heading", "focus moves to the persistent phase heading after the choice box unmounts");

    await page.evaluate(() => (window).__phaseEncounterChoiceHarness?.replayLastAcceptedCommand());
    await page.getByRole("alert").getByText(/no advance action available in the current phase/i).waitFor({ state: "visible" });
    const repeated = await stateOf(page);
    assert.equal(repeated.appliedCommands.length, 2, "the stale repeated engine command is rejected");
    assert.equal(repeated.eventCount, resolved.eventCount, "repeated submission does not append another event");
    assert.deepEqual(repeated.monster, resolved.monster, "repeated submission does not alter the accepted reward");
    report.scenarios["tablet-zorb-health-failure-retry-repeat"] = {
      status: "passed",
      viewport: bounds && { width: bounds.viewportWidth, height: bounds.viewportHeight },
      scenario,
      role: "active chooser fixture",
      input: "keyboard Enter",
      failureHandling: { harnessInjectedCommandHandlerFailureBeforeApplyCommand: true, choiceRemainedAvailable: true, retryAccepted: true, serviceFailureNotTested: true, focusAfterFailure, retryNeededNoTabRecovery: true },
      repeatHandling: { staleAcceptedCommandRejected: true, extraEvents: 0, extraAppliedCommands: 0 },
      focusAfterResolution: "persistent phase heading",
      phaseContextDisclosure: disclosureAudit,
      resolutionTraversal,
      keyboardTraversal,
      resolutionControlBounds: resolutionButtonBounds,
      choiceBounds: bounds,
      touchTargetBounds: buttonBounds,
      finalHealth: resolved.monster.health,
      finalInfamy: resolved.monster.infamy,
      eventAction: resolved.lastEventAction,
    };
    await page.close();
    return;
  }

  if (input === "keyboard") keyboardTraversal = await tabToChoice(page, label);
  if (input === "keyboard") {
    await page.keyboard.press("Enter");
  } else if (input === "touch") {
    await button.tap();
  } else {
    await button.click();
  }
  const resolved = await assertResolved(page, scenario, choice, choiceState);
  assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, "resolved choice control unmounts after acceptance");
  let repeatResult;
  if (replayCheck) {
    await page.evaluate(() => (window).__phaseEncounterChoiceHarness?.replayLastAcceptedCommand());
    await page.getByRole("alert").getByText(/no advance action available in the current phase/i).waitFor({ state: "visible" });
    const repeated = await stateOf(page);
    assert.equal(repeated.appliedCommands.length, 2);
    assert.equal(repeated.eventCount, resolved.eventCount);
    assert.deepEqual(repeated.monster, resolved.monster);
    repeatResult = { staleAcceptedCommandRejected: true, extraEvents: 0, extraAppliedCommands: 0 };
  }
  report.scenarios[`${scenario}-${choice}-${input}-${bounds.viewportWidth}x${bounds.viewportHeight}`] = {
    status: "passed",
    viewport: { width: bounds.viewportWidth, height: bounds.viewportHeight },
    scenario,
    role: "active chooser fixture",
    input,
    appliedCommands: resolved.appliedCommands,
    finalHealth: resolved.monster.health,
    finalInfamy: resolved.monster.infamy,
    eventAction: resolved.lastEventAction,
    eventCountDelta: resolved.eventCount - initial.eventCount,
    choiceBounds: bounds,
    resolutionControlBounds: resolutionButtonBounds,
    touchTargetBounds: input === "touch" ? buttonBounds : undefined,
    focusAfterResolution: await page.evaluate(() => document.activeElement?.id),
    phaseContextDisclosure: disclosureAudit,
    resolutionTraversal,
    ...(keyboardTraversal.length ? { keyboardTraversal } : {}),
    ...(repeatResult ? { repeatHandling: repeatResult } : {}),
  };
  await page.close();
}

async function runWaitingChoice(context, scenario) {
  const { page, initial } = await openPage(context, scenario, "waiting");
  const disclosureAudit = await auditPhaseContextDisclosure(page, initial, { input: "touch", role: "waiting", scenario });
  const box = page.getByRole("group", { name: scenario === "zorb-city" ? "Choose Zorb city benefit" : "Choose Iron Stomach base reward" });
  const controls = await box.getByRole("button").evaluateAll((nodes) => nodes.map((node) => ({ name: node.textContent?.trim(), disabled: (node).disabled })));
  assert.equal(controls.length, 2, "the read-only pending reward retains both explanatory choices");
  assert.ok(controls.every((control) => control.disabled), "all reward choices are disabled in the waiting-player projection");
  assert.deepEqual((await stateOf(page)).attemptedCommands, []);
  assert.deepEqual((await stateOf(page)).appliedCommands, []);
  const bounds = await boundsOf(page, ".battle-choice");
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1,
    `${scenario} waiting choice box fits the compact viewport: ${JSON.stringify(bounds)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario} waiting choice has no horizontal overflow`);
  assert.ok(await page.getByText("Waiting player projection · controls unavailable", { exact: true }).count());
  report.scenarios[`${scenario}-waiting-320x740`] = {
    status: "passed",
    viewport: { width: bounds.viewportWidth, height: bounds.viewportHeight },
    scenario,
    role: "canAct=false waiting-player fixture; no live room/service role mounted",
    choiceControls: controls,
    commandsSubmitted: 0,
    eventCountUnchanged: (await stateOf(page)).eventCount === initial.eventCount,
    phaseContextDisclosure: disclosureAudit,
    noHorizontalOverflow: true,
    choiceBounds: bounds,
  };
  await page.close();
}

try {
  mkdirSync(artifactDirectory, { recursive: true });
  const url = `${baseUrl}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) break; } catch { /* wait for Vite */ }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  report.browserVersion = browser.version();

  const tablet = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  await runActiveChoice(tablet, { scenario: "zorb-city", choice: "health", input: "keyboard", injectFailure: true });
  await runActiveChoice(tablet, { scenario: "zorb-city", choice: "infamy", input: "keyboard", replayCheck: true });
  await runActiveChoice(tablet, { scenario: "iron-stomach", choice: "health", input: "keyboard" });
  await runActiveChoice(tablet, { scenario: "iron-stomach", choice: "infamy", input: "keyboard" });
  await tablet.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await runActiveChoice(phone, { scenario: "zorb-city", choice: "infamy", input: "touch" });
  await runActiveChoice(phone, { scenario: "iron-stomach", choice: "health", input: "touch" });
  await phone.close();

  const compact = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await runWaitingChoice(compact, "zorb-city");
  await runWaitingChoice(compact, "iron-stomach");
  await compact.close();

  assert.deepEqual(report.runtimeErrors, [], "encounter choice fixture browser flows complete without uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `phase-encounter-choice-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Encounter reward choice browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `phase-encounter-choice-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
