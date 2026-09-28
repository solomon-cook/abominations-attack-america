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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a retreat acceptance verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/retreat-choice-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stateOf = (page) => page.locator("#retreat-choice-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const viewportBounds = async (page, selector) => page.locator(selector).evaluate((node) => {
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
  scope: "Fixture-level browser acceptance of the production PhaseActions multi-unit retreat chooser and applyCommand retreat resolution. The pending retreat options are seeded deterministically; this does not exercise resolve-fight generation, a full match, persisted service, or physical-edition rules.",
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

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  desktop.setDefaultTimeout(8000);
  desktop.on("pageerror", (error) => report.runtimeErrors.push(`desktop-keyboard: ${error.message}`));
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  const desktopBox = desktop.locator('.retreat-choice[aria-label="Choose retreat destinations"]');
  await desktopBox.waitFor({ state: "visible" });
  const initial = await stateOf(desktop);
  assert.equal(initial.phase, "fight");
  assert.equal(initial.pendingDecision?.type, "retreat");
  assert.deepEqual(initial.pendingRetreat?.unitIds, ["0-0", "0-1", "2-0"]);
  const chicagoKey = initial.pendingRetreat.options["0-0"][0];
  const dallasKey = initial.pendingRetreat.options["0-0"][1];
  const losAngelesKey = initial.pendingRetreat.options["0-1"][0];
  assert.equal(await desktop.getByText("Forced disappearance", { exact: true }).count(), 1,
    "the unit with no legal options is explicitly labeled Forced disappearance");
  const confirm = desktop.getByRole("button", { name: "Confirm retreat", exact: true });
  assert.equal(await confirm.isDisabled(), true, "confirmation begins disabled while legal destinations remain unchosen");

  const chicago = desktop.getByRole("button", { name: "Chicago", exact: true });
  await chicago.focus();
  await desktop.keyboard.press("Enter");
  assert.equal((await stateOf(desktop)).retreatChoices["0-0"], chicagoKey, "keyboard activation selects a destination for the first unit");
  assert.equal(await confirm.isDisabled(), true, "one selected unit does not unlock confirmation while another required choice is missing");

  const dallas = desktop.getByRole("button", { name: "Dallas", exact: true });
  await dallas.focus();
  await desktop.keyboard.press("Enter");
  assert.equal((await stateOf(desktop)).retreatChoices["0-0"], dallasKey, "a unit's selected destination can be changed before confirmation");
  const losAngeles = desktop.getByRole("button", { name: "Los Angeles", exact: true });
  await losAngeles.focus();
  await desktop.keyboard.press("Enter");
  assert.equal((await stateOf(desktop)).retreatChoices["0-1"], losAngelesKey);
  assert.equal(await confirm.isEnabled(), true, "confirmation unlocks when every unit with legal options has a destination");
  await desktop.keyboard.press("Tab");
  assert.equal(await confirm.evaluate((node) => node === document.activeElement), true,
    "keyboard tab order reaches confirmation immediately after the last destination option");
  await desktop.keyboard.press("Enter");
  await desktop.waitForFunction(() => JSON.parse(document.querySelector("#retreat-choice-state")?.textContent ?? "{}").lastEventAction === "retreat.resolved");
  const resolved = await stateOf(desktop);
  assert.equal(resolved.submittedCommands.length, 1, "one confirmation dispatches one retreat command");
  assert.deepEqual(resolved.submittedCommands[0], {
    type: "retreat",
    destinations: { "0-0": dallasKey, "0-1": losAngelesKey, "2-0": "disappeared" },
  }, "the forced-disappearance unit is included in the command without an invented destination control");
  assert.deepEqual(Object.fromEntries(resolved.units.map((unit) => [unit.id, unit.location])), {
    "0-0": dallasKey, "0-1": losAngelesKey, "2-0": "disappeared",
  }, "production applyCommand resolves the selected destinations and forced disappearance");
  assert.equal(resolved.lastEventAction, "retreat.resolved");
  assert.equal(resolved.eventCount, initial.eventCount + 1, "the resolution appends exactly one event");
  assert.deepEqual(resolved.lastEventDetail?.disappearedUnitIds, ["2-0"]);
  assert.equal(resolved.pendingRetreat, undefined, "the pending retreat is cleared after resolution");
  report.scenarios.desktopKeyboard = {
    status: "passed",
    viewport: { width: 1280, height: 900 },
    role: "active decision maker",
    selection: { initialConfirmDisabled: true, remainsDisabledAfterFirstRequiredChoice: true, selectedDestinationCanBeChanged: true, forcedDisappearanceIsShown: true },
    confirmation: { enabledOnlyAfterAllRequiredDestinations: true, keyboardTabAndEnter: true },
    resolution: { commandCount: resolved.submittedCommands.length, eventAction: resolved.lastEventAction, eventCountDelta: resolved.eventCount - initial.eventCount, destinations: resolved.lastEventDetail?.destinations, disappearedUnitIds: resolved.lastEventDetail?.disappearedUnitIds },
  };
  await desktop.close();

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const phone = await phoneContext.newPage();
  phone.setDefaultTimeout(8000);
  phone.on("pageerror", (error) => report.runtimeErrors.push(`phone-touch: ${error.message}`));
  await phone.goto(url, { waitUntil: "domcontentloaded" });
  const phoneBox = phone.locator('.retreat-choice[aria-label="Choose retreat destinations"]');
  await phoneBox.waitFor({ state: "visible" });
  const phoneInitial = await stateOf(phone);
  assert.equal(await phone.getByText("canAct=true · retreat decision", { exact: true }).count(), 1,
    "phone fixture keeps the active decision maker's controls enabled");
  const phoneConfirm = phone.getByRole("button", { name: "Confirm retreat", exact: true });
  await phone.getByRole("button", { name: "Chicago", exact: true }).tap();
  assert.equal(await phoneConfirm.isDisabled(), true);
  await phone.getByRole("button", { name: "Los Angeles", exact: true }).tap();
  assert.equal(await phoneConfirm.isEnabled(), true);
  const bounds = await viewportBounds(phone, ".retreat-choice");
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1,
    `retreat controls fit the phone viewport: ${JSON.stringify(bounds)}`);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone retreat flow introduces no horizontal overflow");
  await phoneConfirm.tap();
  const phoneResolved = await stateOf(phone);
  const phoneDestinations = {
    "0-0": phoneInitial.pendingRetreat.options["0-0"][0],
    "0-1": phoneInitial.pendingRetreat.options["0-1"][0],
    "2-0": "disappeared",
  };
  assert.equal(phoneResolved.submittedCommands.length, 1, "one touch confirmation submits exactly one retreat command");
  assert.deepEqual(phoneResolved.submittedCommands[0], { type: "retreat", destinations: phoneDestinations });
  assert.equal(phoneResolved.lastEventAction, "retreat.resolved");
  assert.equal(phoneResolved.eventCount, phoneInitial.eventCount + 1, "touch confirmation appends exactly one retreat event");
  assert.deepEqual(Object.fromEntries(phoneResolved.units.map((unit) => [unit.id, unit.location])), phoneDestinations,
    "touch resolution persists both selected destinations and forced disappearance");
  assert.deepEqual(phoneResolved.lastEventDetail?.disappearedUnitIds, ["2-0"]);
  assert.equal(phoneResolved.pendingRetreat, undefined, "touch resolution clears the pending retreat");
  report.scenarios.phoneTouch = {
    status: "passed",
    viewport: { width: 390, height: 844 },
    input: "touch taps",
    requiredChoicesGateConfirmation: true,
    forcedDisappearanceIncluded: true,
    commandCount: phoneResolved.submittedCommands.length,
    eventCountDelta: phoneResolved.eventCount - phoneInitial.eventCount,
    finalPositions: Object.fromEntries(phoneResolved.units.map((unit) => [unit.id, unit.location])),
    pendingRetreatCleared: phoneResolved.pendingRetreat === undefined,
    noHorizontalOverflow: true,
    choiceBounds: bounds,
    eventAction: phoneResolved.lastEventAction,
  };
  await phoneContext.close();

  const waitingContext = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const waiting = await waitingContext.newPage();
  waiting.setDefaultTimeout(8000);
  waiting.on("pageerror", (error) => report.runtimeErrors.push(`canAct-false: ${error.message}`));
  await waiting.goto(`${url}?canAct=false`, { waitUntil: "domcontentloaded" });
  const waitingBox = waiting.locator('.retreat-choice[aria-label="Choose retreat destinations"]');
  await waitingBox.waitFor({ state: "visible" });
  const waitingControls = await waitingBox.getByRole("button").evaluateAll((nodes) => nodes.map((node) => ({ label: node.textContent?.trim(), disabled: (node).disabled })));
  assert.equal(await waiting.getByText("canAct=false · actions unavailable", { exact: true }).count(), 1,
    "the fixture labels the 320px case as a canAct=false presentation rather than an online role");
  assert.ok(waitingControls.length >= 4, "the canAct=false presentation includes destination choices and confirmation");
  assert.ok(waitingControls.every((control) => control.disabled), "all retreat-changing controls are disabled when canAct is false");
  assert.equal(await waiting.getByText("Forced disappearance", { exact: true }).count(), 1);
  assert.deepEqual((await stateOf(waiting)).submittedCommands, [], "the canAct=false presentation does not submit commands");
  const waitingBounds = await viewportBounds(waiting, ".retreat-choice");
  assert.ok(waitingBounds.x >= -1 && waitingBounds.y >= -1 && waitingBounds.right <= waitingBounds.viewportWidth + 1 && waitingBounds.bottom <= waitingBounds.viewportHeight + 1,
    `retreat controls fit the 320px compact viewport: ${JSON.stringify(waitingBounds)}`);
  assert.ok(await waiting.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "320px canAct=false presentation has no horizontal overflow");
  report.scenarios.canActFalseCompact = {
    status: "passed",
    viewport: { width: 320, height: 740 },
    canAct: false,
    onlineRoleProjection: "not tested; the fixture only gates PhaseActions with canAct",
    allChoiceAndConfirmControlsDisabled: true,
    forcedDisappearanceVisible: true,
    noCommandSubmitted: true,
    noHorizontalOverflow: true,
    choiceBounds: waitingBounds,
  };
  await waitingContext.close();

  assert.deepEqual(report.runtimeErrors, [], "retreat fixture browser flows complete without uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `retreat-choice-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Retreat choice browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `retreat-choice-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
