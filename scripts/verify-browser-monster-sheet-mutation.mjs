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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a Monster Sheet Mutation verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/monster-sheet-mutation-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stateOf = (page) => page.locator("#monster-sheet-mutation-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const viewportBounds = (page, locator) => locator.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
});
const insideViewport = (bounds) => bounds.width > 0 && bounds.height > 0 && bounds.x >= -1 && bounds.y >= -1
  && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1;
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
  scope: "one Berserk Mutation action from the production modal Monster Sheet component; fixture-level applyCommand, not full CARD-LEAF-02 coverage or physical-rule parity",
  scenarios: {},
  runtimeErrors: [],
};
let browser;
try {
  await mkdirSync(artifactDirectory, { recursive: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) break; } catch { /* wait for Vite */ }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const owner = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  owner.setDefaultTimeout(8000);
  owner.on("pageerror", (error) => report.runtimeErrors.push(`owner: ${error.message}`));
  await owner.goto(`${url}?role=owner`, { waitUntil: "domcontentloaded" });
  const ownerBefore = await stateOf(owner);
  assert.equal(ownerBefore.phase, "fight");
  assert.equal(ownerBefore.canAct, true);
  assert.deepEqual(ownerBefore.mutationCardIds, ["Berserk"]);
  const ownerOpener = owner.locator(".player-sheet-peeks").getByRole("button", { name: "Open Zorb monster sheet", exact: true });
  assert.equal(await ownerOpener.count(), 1, "the fixture reaches the same PlayerStatusControls Monster Sheet entry point used in the game");
  await ownerOpener.focus();
  assert.equal(await ownerOpener.evaluate((node) => node === document.activeElement), true);
  await owner.keyboard.press("Enter");
  const ownerDialog = owner.getByRole("dialog", { name: "Zorb" });
  await ownerDialog.waitFor({ state: "visible" });
  const ownerClose = ownerDialog.getByRole("button", { name: "Close", exact: true });
  await owner.waitForFunction(() => document.activeElement?.classList.contains("military-sheet-close"));
  assert.equal(await ownerClose.evaluate((node) => node === document.activeElement), true, "opening by keyboard moves focus into the Monster Sheet");
  const playBerserk = ownerDialog.getByRole("button", { name: "Play Berserk", exact: true });
  assert.equal(await playBerserk.count(), 1, "Berserk exposes its real battle-window action from the modal card");
  let keyboardTabs = 0;
  while (!await playBerserk.evaluate((node) => node === document.activeElement) && keyboardTabs < 6) {
    await owner.keyboard.press("Tab");
    keyboardTabs += 1;
  }
  assert.equal(await playBerserk.evaluate((node) => node === document.activeElement), true, "Tab reaches the Mutation action from the modal's initial focus");
  const desktopDialogBounds = await viewportBounds(owner, ownerDialog);
  assert.ok(insideViewport(desktopDialogBounds), `desktop Monster Sheet fits its viewport: ${JSON.stringify(desktopDialogBounds)}`);
  await owner.screenshot({ path: join(artifactDirectory, `monster-sheet-mutation-desktop-${date}.png`) });
  await owner.keyboard.press("Enter");
  await ownerDialog.waitFor({ state: "detached" });
  await owner.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open Zorb monster sheet");
  const ownerAfter = await stateOf(owner);
  assert.deepEqual(ownerAfter.mutationCardIds, [], "playing Berserk spends it from the Monster's hand");
  assert.ok(ownerAfter.mutationDiscard.includes("Berserk"), "Berserk enters the Mutation discard pile");
  assert.equal(ownerAfter.pendingBattle.bonusMonsterAttacks, 5, "the actual Fight battle receives five bonus monster attacks");
  assert.equal(ownerAfter.latestEvent?.action, "mutation.used");
  assert.equal(ownerAfter.latestEvent?.detail.extraAttacks, 5);
  assert.equal(await ownerOpener.evaluate((node) => node === document.activeElement), true, "closing after the card unmounts restores focus to the sheet opener");
  report.scenarios.ownerKeyboard = {
    status: "passed",
    activation: "Enter opened sheet; Tab reached Berserk; Enter played it",
    tabStepsToAction: keyboardTabs,
    action: ownerAfter.latestEvent.action,
    extraAttacks: ownerAfter.pendingBattle.bonusMonsterAttacks,
    cardSpentAndDiscarded: ownerAfter.mutationDiscard.includes("Berserk") && !ownerAfter.mutationCardIds.includes("Berserk"),
    dialogBounds: desktopDialogBounds,
    focusAfterCardUnmount: "Open Zorb monster sheet trigger",
  };
  await owner.close();

  const waiting = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  waiting.setDefaultTimeout(8000);
  waiting.on("pageerror", (error) => report.runtimeErrors.push(`waiting: ${error.message}`));
  await waiting.goto(`${url}?role=waiting`, { waitUntil: "domcontentloaded" });
  const waitingBefore = await stateOf(waiting);
  assert.equal(waitingBefore.canAct, false);
  const waitingOpener = waiting.locator(".player-sheet-peeks").getByRole("button", { name: "Open Zorb monster sheet", exact: true });
  await waitingOpener.focus();
  await waiting.keyboard.press("Enter");
  const waitingDialog = waiting.getByRole("dialog", { name: "Zorb" });
  await waitingDialog.waitFor({ state: "visible" });
  assert.equal(await waitingDialog.getByRole("button", { name: "Play Berserk", exact: true }).count(), 0, "a waiting role sees no available command control");
  assert.match(await waitingDialog.locator(".sheet-held-card[aria-label^='Berserk'] .digital-card-status").innerText(), /Play on your turn/);
  const waitingAfter = await stateOf(waiting);
  assert.deepEqual(waitingAfter.mutationCardIds, ["Berserk"], "the waiting view has not spent the Mutation");
  assert.equal(waitingAfter.latestEvent, null, "the waiting view has not dispatched a game command");
  await waiting.keyboard.press("Escape");
  await waitingDialog.waitFor({ state: "detached" });
  await waiting.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open Zorb monster sheet");
  assert.equal(await waitingOpener.evaluate((node) => node === document.activeElement), true, "Escape closes the modal and restores focus to its opener");
  report.scenarios.waitingRole = { status: "passed", canAct: false, actionButtons: 0, mutationRemainsHeld: true, escapeRestoresFocus: true };
  await waiting.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobile.setDefaultTimeout(8000);
  mobile.on("pageerror", (error) => report.runtimeErrors.push(`mobile: ${error.message}`));
  await mobile.goto(`${url}?role=owner`, { waitUntil: "domcontentloaded" });
  const mobileOpener = mobile.locator(".player-sheet-peeks").getByRole("button", { name: "Open Zorb monster sheet", exact: true });
  await mobileOpener.tap();
  const mobileDialog = mobile.getByRole("dialog", { name: "Zorb" });
  await mobileDialog.waitFor({ state: "visible" });
  await mobileDialog.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const mobileBounds = await viewportBounds(mobile, mobileDialog);
  assert.ok(insideViewport(mobileBounds), `the Monster Sheet modal fits the 390x844 viewport: ${JSON.stringify(mobileBounds)}`);
  const mobileWidths = await mobile.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(mobileWidths.document <= mobileWidths.viewport + 1 && mobileWidths.body <= mobileWidths.viewport + 1,
    `the open modal does not cause page-level horizontal overflow: ${JSON.stringify(mobileWidths)}`);
  const mobileAction = mobileDialog.getByRole("button", { name: "Play Berserk", exact: true });
  await mobileAction.scrollIntoViewIfNeeded();
  const actionBounds = await viewportBounds(mobile, mobileAction);
  assert.ok(actionBounds.width > 0 && actionBounds.height > 0 && actionBounds.x >= -1 && actionBounds.y >= -1 && actionBounds.right <= 391 && actionBounds.bottom <= 845,
    `the action remains reachable within the phone viewport: ${JSON.stringify(actionBounds)}`);
  await mobile.screenshot({ path: join(artifactDirectory, `monster-sheet-mutation-mobile-${date}.png`) });
  report.scenarios.mobileBounds = { status: "passed", viewport: "390x844 touch emulation", dialogBounds: mobileBounds, actionBounds, pageWidths: mobileWidths };
  await mobile.close();

  assert.deepEqual(report.runtimeErrors, [], "browser fixtures should not produce uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `monster-sheet-mutation-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Monster Sheet Mutation action browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `monster-sheet-mutation-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
