import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = resolve(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a Challenge arena verifier port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/challenge-arena-harness.html`;
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
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
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    wait(2000).then(() => server.kill("SIGKILL")),
  ]);
};
const stateOf = (page) => page.locator("#challenge-arena-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const inside = (bounds, width, height) => Boolean(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
const report = {
  started: new Date().toISOString(),
  fixture: "createGame(3, 2841) with an active challenge-opponent decision; owner action goes through applyCommand",
  coveredSlice: "select one eligible monster opponent; complete duel resolution is outside this slice",
  scenarios: {},
  runtimeErrors: [],
};
let browser;

try {
  await mkdir(artifactDirectory, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* wait for Vite */ }
    await wait(100);
  }
  if (!ready) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  ownerPage.setDefaultTimeout(8000);
  ownerPage.on("pageerror", (error) => report.runtimeErrors.push(`active-owner: ${error.message}`));
  await ownerPage.emulateMedia({ reducedMotion: "reduce" });
  await ownerPage.goto(url, { waitUntil: "domcontentloaded" });
  const ownerDialog = ownerPage.locator("dialog.resolution-challenge[open]");
  await ownerDialog.waitFor({ state: "visible" });
  await ownerPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
  const ownerBefore = await stateOf(ownerPage);
  assert.equal(ownerBefore.role, "active-owner");
  assert.equal(ownerBefore.currentPlayer, 0);
  assert.equal(ownerBefore.pendingDecision?.type, "challenge-opponent");
  assert.deepEqual(ownerBefore.submittedCommands, []);
  const emptyMutationText = await ownerDialog.locator(".challenge-live-side .mutation-strip").evaluate((node) => {
    const label = node.querySelector(":scope > small");
    const empty = node.querySelector(":scope > span");
    if (!label || !empty) throw new Error("Expected the empty Monster Mutation strip label and explanation.");
    const bounds = (element) => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const labelBounds = bounds(label);
    const emptyBounds = bounds(empty);
    const overlaps = labelBounds.x < emptyBounds.right && emptyBounds.x < labelBounds.right
      && labelBounds.y < emptyBounds.bottom && emptyBounds.y < labelBounds.bottom;
    return { label: label.textContent?.trim(), explanation: empty.textContent?.trim(), labelBounds, explanationBounds: emptyBounds, overlaps };
  });
  assert.equal(emptyMutationText.label, "MUTATIONS · 0");
  assert.equal(emptyMutationText.explanation, "No revealed mutations");
  assert.ok(emptyMutationText.labelBounds.width > 0 && emptyMutationText.labelBounds.height > 0
    && emptyMutationText.explanationBounds.width > 0 && emptyMutationText.explanationBounds.height > 0,
  `the empty MutationStrip text should have readable rendered bounds: ${JSON.stringify(emptyMutationText)}`);
  assert.equal(emptyMutationText.overlaps, false,
    `the empty MutationStrip label and explanation must not overlap on mobile: ${JSON.stringify(emptyMutationText)}`);
  const viewport = { width: await ownerPage.evaluate(() => innerWidth), height: await ownerPage.evaluate(() => innerHeight) };
  assert.deepEqual(viewport, { width: 390, height: 844 }, `the mobile browser must use the compact 390×844 viewport: ${JSON.stringify(viewport)}`);

  const ownerBounds = await ownerDialog.boundingBox();
  assert.ok(inside(ownerBounds, viewport.width, viewport.height), `the live Challenge arena fits the compact viewport: ${JSON.stringify(ownerBounds)}`);
  const ownerLayoutBefore = await ownerDialog.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
  assert.equal(ownerLayoutBefore.overflowY, "auto", "the full-screen arena retains its vertical scroll container");
  assert.ok(ownerLayoutBefore.scrollWidth <= ownerLayoutBefore.width + 1,
    `the Challenge dialog content must not create horizontal overflow at 390px: ${JSON.stringify(ownerLayoutBefore)}`);
  const documentWidths = await ownerPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(documentWidths.document <= documentWidths.viewport + 1 && documentWidths.body <= documentWidths.viewport + 1,
    `the compact Challenge arena must not create page-level horizontal overflow: ${JSON.stringify(documentWidths)}`);
  await ownerPage.screenshot({ path: join(artifactDirectory, `challenge-arena-active-mobile-${date}.png`), fullPage: true });

  const options = ownerDialog.locator(".challenge-opponents button");
  assert.equal(await options.count(), 2, "the deterministic three-monster fixture offers both eligible opponents");
  const chosenButton = options.first();
  const chosenLabel = (await chosenButton.locator("strong").innerText()).trim();
  const chosenButtonBefore = await chosenButton.boundingBox();
  await chosenButton.scrollIntoViewIfNeeded();
  const chosenButtonAfterScroll = await chosenButton.boundingBox();
  assert.ok(inside(chosenButtonAfterScroll, viewport.width, viewport.height),
    `the opponent choice can be brought into the compact viewport: ${JSON.stringify(chosenButtonAfterScroll)}`);
  await ownerPage.keyboard.press("Tab");
  assert.equal(await chosenButton.evaluate((node) => node === document.activeElement), true,
    "Tab from the arena Board control reaches the first opponent choice");
  await ownerPage.keyboard.press("Enter");
  await ownerPage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#challenge-arena-state")?.textContent ?? "{}");
    return state.latestEvent?.action === "challenge.opponent.selected";
  });
  const ownerAfter = await stateOf(ownerPage);
  assert.equal(ownerAfter.submittedCommands.length, 1, "keyboard activation submits exactly one engine command");
  assert.deepEqual(ownerAfter.submittedCommands[0], { type: "challenge-opponent", opponentMonsterId: "monster-2" });
  assert.equal(ownerAfter.selectedOpponentMonsterId, ownerAfter.submittedCommands[0].opponentMonsterId);
  assert.equal(ownerAfter.latestEvent.action, "challenge.opponent.selected");
  assert.equal(ownerAfter.latestEvent.detail.challengerMonsterId, "monster-1");
  assert.equal(ownerAfter.latestEvent.detail.opponentMonsterId, ownerAfter.selectedOpponentMonsterId);
  assert.equal(ownerAfter.pendingDecision?.type, "challenge-resolution");
  assert.equal(ownerAfter.challenge.turn.round, 1);
  assert.equal(ownerAfter.challenge.turn.attackerId, "monster-1");
  const ownerAfterLayout = await ownerDialog.evaluate((node) => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  const ownerAfterWidths = await ownerPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(ownerAfterWidths.document <= ownerAfterWidths.viewport + 1 && ownerAfterWidths.body <= ownerAfterWidths.viewport + 1,
    `the selected opponent arena remains free of horizontal overflow: ${JSON.stringify(ownerAfterWidths)}`);
  await ownerPage.screenshot({ path: join(artifactDirectory, `challenge-arena-selected-mobile-${date}.png`), fullPage: true });
  report.scenarios.activeOwner = {
    status: "passed",
    viewport,
    dialogBounds: ownerBounds,
    emptyMutationText,
    initialDialogScroll: ownerLayoutBefore,
    choiceBoundsBeforeScroll: chosenButtonBefore,
    choiceBoundsAfterScroll: chosenButtonAfterScroll,
    selectedOpponent: chosenLabel,
    keyboard: "Tab to first opponent; Enter selects it",
    submittedCommands: ownerAfter.submittedCommands,
    event: ownerAfter.latestEvent,
    nextDecision: ownerAfter.pendingDecision.type,
    postSelectionDialogScroll: ownerAfterLayout,
    pageWidths: { before: documentWidths, after: ownerAfterWidths },
    screenshots: [`challenge-arena-active-mobile-${date}.png`, `challenge-arena-selected-mobile-${date}.png`],
  };
  await ownerPage.close();

  const shortPage = await browser.newPage({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  shortPage.setDefaultTimeout(8000);
  shortPage.on("pageerror", (error) => report.runtimeErrors.push(`short-mobile: ${error.message}`));
  await shortPage.emulateMedia({ reducedMotion: "reduce" });
  await shortPage.goto(url, { waitUntil: "domcontentloaded" });
  const shortDialog = shortPage.locator("dialog.resolution-challenge[open]");
  await shortDialog.waitFor({ state: "visible" });
  const shortBounds = await shortDialog.boundingBox();
  assert.ok(inside(shortBounds, 390, 600), `the arena remains inside a short mobile viewport: ${JSON.stringify(shortBounds)}`);
  const shortBeforeScroll = await shortDialog.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }));
  assert.equal(shortBeforeScroll.overflowY, "auto");
  assert.ok(shortBeforeScroll.scrollHeight > shortBeforeScroll.clientHeight,
    `short-height mobile content should use the arena's vertical scroll container: ${JSON.stringify(shortBeforeScroll)}`);
  const battleRules = shortDialog.locator(".battle-history > summary");
  await battleRules.scrollIntoViewIfNeeded();
  const shortAfterScroll = await shortDialog.evaluate((node) => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  assert.ok(shortAfterScroll.scrollTop > 0, `scrolling to battle rules should move the Challenge arena: ${JSON.stringify(shortAfterScroll)}`);
  const battleRulesBounds = await battleRules.boundingBox();
  assert.ok(inside(battleRulesBounds, 390, 600), `battle rules remain reachable after vertical scroll: ${JSON.stringify(battleRulesBounds)}`);
  const shortWidths = await shortPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(shortWidths.document <= shortWidths.viewport + 1 && shortWidths.body <= shortWidths.viewport + 1,
    `the vertically scrolled arena must not introduce horizontal overflow: ${JSON.stringify(shortWidths)}`);
  await shortPage.screenshot({ path: join(artifactDirectory, `challenge-arena-scroll-mobile-${date}.png`), fullPage: true });
  report.scenarios.shortViewportScroll = {
    status: "passed",
    viewport: { width: 390, height: 600 },
    dialogBounds: shortBounds,
    before: shortBeforeScroll,
    after: shortAfterScroll,
    battleRulesBounds,
    pageWidths: shortWidths,
    screenshot: `challenge-arena-scroll-mobile-${date}.png`,
  };
  await shortPage.close();

  const spectatorPage = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  spectatorPage.setDefaultTimeout(8000);
  spectatorPage.on("pageerror", (error) => report.runtimeErrors.push(`spectator: ${error.message}`));
  await spectatorPage.emulateMedia({ reducedMotion: "reduce" });
  await spectatorPage.goto(`${url}?role=spectator`, { waitUntil: "domcontentloaded" });
  const spectatorDialog = spectatorPage.locator("dialog.resolution-challenge[open]");
  await spectatorDialog.waitFor({ state: "visible" });
  const spectatorBefore = await stateOf(spectatorPage);
  assert.equal(spectatorBefore.role, "spectator");
  assert.equal(spectatorBefore.pendingDecision.type, "challenge-opponent");
  assert.deepEqual(spectatorBefore.submittedCommands, []);
  const spectatorOptions = spectatorDialog.locator(".challenge-opponents button");
  assert.equal(await spectatorOptions.count(), 2);
  assert.equal(await spectatorOptions.first().isDisabled(), true, "spectator opponent choices are visibly disabled");
  await spectatorOptions.first().evaluate((node) => node.click());
  await spectatorPage.waitForTimeout(50);
  const spectatorAfter = await stateOf(spectatorPage);
  assert.deepEqual(spectatorAfter.submittedCommands, [], "a spectator view cannot submit a challenge command");
  assert.deepEqual(spectatorAfter.latestEvent, null, "the spectator click does not add an engine event");
  assert.equal(spectatorAfter.selectedOpponentMonsterId, null);
  const spectatorBounds = await spectatorDialog.boundingBox();
  assert.ok(inside(spectatorBounds, 1280, 720), `the spectator Challenge arena fits desktop viewport: ${JSON.stringify(spectatorBounds)}`);
  await spectatorPage.screenshot({ path: join(artifactDirectory, `challenge-arena-spectator-desktop-${date}.png`), fullPage: true });
  report.scenarios.spectator = {
    status: "passed",
    viewport: { width: 1280, height: 720 },
    dialogBounds: spectatorBounds,
    opponentChoiceButtons: await spectatorOptions.count(),
    disabledButtons: true,
    submittedCommands: spectatorAfter.submittedCommands.length,
    engineEvents: spectatorAfter.latestEvent,
    screenshot: `challenge-arena-spectator-desktop-${date}.png`,
  };

  assert.deepEqual(report.runtimeErrors, [], "the Challenge arena scenarios complete without uncaught browser errors");
  report.finished = new Date().toISOString();
  report.status = "passed";
  await mkdir(artifactDirectory, { recursive: true });
  const artifact = join(artifactDirectory, `challenge-arena-${date}.json`);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, artifact }, null, 2));
  await spectatorPage.close();
} finally {
  await browser?.close();
  await stopServer();
}
