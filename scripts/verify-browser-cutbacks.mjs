import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a Cutbacks verifier port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/cutbacks-harness.html`;
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const startServer = () => {
  const child = spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(cwd, "apps/web"),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return {
    child,
    output: () => output,
    async ready() {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${output}`);
        try { if ((await fetch(url)).ok) return; } catch { /* wait for Vite */ }
        await wait(100);
      }
      throw new Error(`Vite did not become ready.\n${output}`);
    },
  };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => server.child.once("exit", resolveExit)), wait(2000).then(() => server.child.kill("SIGKILL"))]);
};
const stateOf = (page) => page.locator("#cutbacks-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const boxWithin = (box, width, height) => Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
const report = { started: new Date().toISOString(), fixture: "deterministic Move UI fixture; no physical rules claim", scenarios: {}, runtimeErrors: [] };
let server;
let browser;

try {
  await mkdir(artifactDirectory, { recursive: true });
  server = startServer();
  await server.ready();
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const activePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  activePage.setDefaultTimeout(8000);
  activePage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  await activePage.goto(`${url}?viewer=0`, { waitUntil: "domcontentloaded" });
  const activeBefore = await stateOf(activePage);
  assert.equal(activeBefore.phase, "move");
  assert.equal(activeBefore.currentPlayer, 0);
  assert.equal(activeBefore.canAct, true);
  assert.equal(activeBefore.pendingDecision.type, "monster-movement");
  assert.deepEqual(activeBefore.publicResearch, [
    { playerIndex: 0, cardId: "Cutbacks" },
    { playerIndex: 1, cardId: "Guard Commander" },
  ], "the viewer projection contains the player's Cutbacks and only the public opponent Guard Commander");

  const activeDrawer = activePage.locator(".military-drawer");
  await activeDrawer.waitFor({ state: "visible" });
  await activeDrawer.getByRole("button", { name: /Military research/ }).click();
  const cutbacksCard = activeDrawer.locator('.sheet-held-card[aria-label="Cutbacks Military Research card"]');
  await cutbacksCard.waitFor({ state: "visible" });
  const targetButton = activePage.getByRole("button", { name: "Remove Player 2's Guard Commander from play", exact: true });
  assert.equal(await targetButton.count(), 1, "the only target action is the opponent's public Guard Commander");
  assert.equal(await activePage.getByRole("button", { name: /Molecular Cannon/ }).count(), 0, "the hidden opponent Research card never becomes an action");
  assert.equal(await activeDrawer.getByRole("combobox", { name: "Cutbacks target or outcome" }).count(), 0, "a single eligible target is not padded with a hidden choice");
  const activeDrawerText = await activeDrawer.innerText();
  assert.equal(activeDrawerText.includes("Molecular Cannon"), false, "the redacted opponent card does not appear in drawer content");
  const activeTargetBounds = await targetButton.boundingBox();
  await activePage.screenshot({ path: join(artifactDirectory, `cutbacks-active-desktop-${date}.png`), fullPage: true });
  await targetButton.click();
  await activePage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#cutbacks-state")?.textContent ?? "{}");
    return state.latestEvent?.action === "research.used" && state.removedResearchCardIds.includes("Guard Commander");
  });
  const activeAfter = await stateOf(activePage);
  assert.equal(activeAfter.phase, "move", "Cutbacks leaves the deterministic Move state live");
  assert.equal(activeAfter.canAct, true);
  assert.deepEqual(activeAfter.removedResearchCardIds, ["Guard Commander"], "the selected public card is removed from play");
  assert.equal(activeAfter.publicTargetStillInHand, false);
  assert.equal(activeAfter.cutbacksStillInHand, false, "Cutbacks is spent from the active player's hand");
  assert.equal(activeAfter.cutbacksDiscarded, true, "the spent Cutbacks card enters the Research discard pile");
  assert.equal(activeAfter.hiddenResearchRemains, true, "the hidden Research card remains held and was not selected");
  assert.deepEqual(activeAfter.researchCounts, [0, 1]);
  assert.equal(activeAfter.latestEvent.detail.removedResearchCardId, "Guard Commander");
  assert.equal(await activeDrawer.isVisible(), true, "the Military drawer remains open after the selected card unmounts");
  const researchHeading = activeDrawer.locator(".sheet-held-cards h3");
  await activePage.waitForFunction(() => {
    const heading = document.querySelector(".military-drawer .sheet-held-cards h3");
    return heading === document.activeElement;
  });
  assert.equal(await researchHeading.evaluate((heading) => heading.textContent?.includes("· 0")), true, "focus returns to the live Military Research heading after the card unmounts");
  report.scenarios.activePlayer = {
    status: "passed",
    phaseBefore: activeBefore.phase,
    eligibleTarget: "Player 2's public Guard Commander",
    hiddenResearchTargetable: false,
    command: activeAfter.latestEvent.action,
    removedResearchCardIds: activeAfter.removedResearchCardIds,
    cutbacksSpent: !activeAfter.cutbacksStillInHand && activeAfter.cutbacksDiscarded,
    hiddenResearchRemains: activeAfter.hiddenResearchRemains,
    drawerOpenAfterPlay: true,
    focusAfterUnmount: "Military Research · 0 heading",
    targetBounds: activeTargetBounds,
  };
  await activePage.close();

  const waitingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  waitingPage.setDefaultTimeout(8000);
  waitingPage.on("pageerror", (error) => report.runtimeErrors.push(`waiting: ${error.message}`));
  await waitingPage.goto(`${url}?viewer=1`, { waitUntil: "domcontentloaded" });
  const waitingBefore = await stateOf(waitingPage);
  assert.equal(waitingBefore.phase, "move");
  assert.equal(waitingBefore.currentPlayer, 0);
  assert.equal(waitingBefore.viewerPlayer, 1);
  assert.equal(waitingBefore.canAct, false);
  const waitingDrawer = waitingPage.locator(".military-drawer");
  await waitingDrawer.waitFor({ state: "visible" });
  await waitingDrawer.getByRole("button", { name: /Military research/ }).click();
  const waitingCutbacks = waitingDrawer.locator('.sheet-held-card[aria-label="Cutbacks Military Research card"]');
  await waitingCutbacks.waitFor({ state: "visible" });
  assert.equal(await waitingPage.getByRole("button", { name: /Remove Player/ }).count(), 0, "the waiting player has no Cutbacks target control");
  assert.equal(await waitingPage.getByRole("combobox", { name: "Cutbacks target or outcome" }).count(), 0);
  assert.equal(await waitingCutbacks.locator(".digital-card-status").innerText().then((text) => text.includes("Play on your turn")), true, "the waiting player's Cutbacks is shown as unavailable until their turn");
  const waitingAfter = await stateOf(waitingPage);
  assert.equal(waitingAfter.latestEvent, null, "the read-only UI has not applied a command");
  assert.deepEqual(waitingAfter.removedResearchCardIds, []);
  report.scenarios.waitingPlayer = { status: "passed", currentPlayer: 0, viewerPlayer: 1, canAct: false, cutbacksVisible: true, targetControls: 0, commandsApplied: 0 };
  await waitingPage.close();

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobilePage.setDefaultTimeout(8000);
  mobilePage.on("pageerror", (error) => report.runtimeErrors.push(`mobile: ${error.message}`));
  await mobilePage.goto(`${url}?viewer=0`, { waitUntil: "domcontentloaded" });
  const mobileDrawer = mobilePage.locator(".military-drawer");
  await mobileDrawer.waitFor({ state: "visible" });
  await mobileDrawer.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const drawerBounds = await mobileDrawer.boundingBox();
  assert.ok(boxWithin(drawerBounds, 390, 844), `the drawer fits the 390×844 viewport: ${JSON.stringify(drawerBounds)}`);
  const mobileResearchTab = mobileDrawer.getByRole("button", { name: /Military research/ });
  const researchTabBounds = await mobileResearchTab.boundingBox();
  assert.ok(boxWithin(researchTabBounds, 390, 844), `the research tab fits the touch viewport: ${JSON.stringify(researchTabBounds)}`);
  await mobilePage.touchscreen.tap(researchTabBounds.x + researchTabBounds.width / 2, researchTabBounds.y + researchTabBounds.height / 2);
  const mobileTarget = mobilePage.getByRole("button", { name: "Remove Player 2's Guard Commander from play", exact: true });
  await mobileTarget.waitFor({ state: "visible" });
  await mobileTarget.scrollIntoViewIfNeeded();
  const mobileTargetBounds = await mobileTarget.boundingBox();
  assert.ok(boxWithin(mobileTargetBounds, 390, 844), `the Cutbacks target fits the touch viewport: ${JSON.stringify(mobileTargetBounds)}`);
  assert.equal(await mobilePage.getByRole("button", { name: /Molecular Cannon/ }).count(), 0);
  await mobilePage.screenshot({ path: join(artifactDirectory, `cutbacks-active-mobile-${date}.png`), fullPage: true });
  await mobilePage.touchscreen.tap(mobileTargetBounds.x + mobileTargetBounds.width / 2, mobileTargetBounds.y + mobileTargetBounds.height / 2);
  await mobilePage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#cutbacks-state")?.textContent ?? "{}");
    return state.removedResearchCardIds.includes("Guard Commander") && !state.cutbacksStillInHand;
  });
  const mobileAfter = await stateOf(mobilePage);
  const mobileWidths = await mobilePage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(mobileWidths.document <= mobileWidths.viewport + 1 && mobileWidths.body <= mobileWidths.viewport + 1, `Cutbacks should not create horizontal overflow: ${JSON.stringify(mobileWidths)}`);
  assert.equal(await mobileDrawer.isVisible(), true, "the touch play leaves the drawer mounted");
  assert.equal(await mobilePage.locator(".military-drawer .sheet-held-cards h3").evaluate((heading) => heading === document.activeElement), true, "touch play also returns focus to the surviving Military Research heading");
  report.scenarios.mobileTouch = {
    status: "passed",
    viewport: "390x844 touch emulation",
    drawerBounds,
    researchTabBounds,
    targetBounds: mobileTargetBounds,
    targetRemoved: mobileAfter.removedResearchCardIds.includes("Guard Commander"),
    cutbacksSpent: !mobileAfter.cutbacksStillInHand && mobileAfter.cutbacksDiscarded,
    focusAfterUnmount: "Military Research heading",
    horizontalWidths: mobileWidths,
  };
  await mobilePage.close();

  assert.deepEqual(report.runtimeErrors, [], "browser pages should not produce runtime errors");
  report.completed = new Date().toISOString();
  const artifactPath = join(artifactDirectory, `cutbacks-${date}.json`);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Cutbacks browser acceptance passed. Evidence: ${artifactPath}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.runtimeErrors = [...report.runtimeErrors];
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(join(artifactDirectory, `cutbacks-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer(server);
}
