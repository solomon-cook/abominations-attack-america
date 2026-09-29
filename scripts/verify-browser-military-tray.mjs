import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a military-tray verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/military-tray-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        try { if ((await fetch(url)).ok) return; } catch { /* wait for the local server */ }
        await wait(100);
      }
      throw new Error(`Vite did not become ready.\n${output}`);
    },
  };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.child.once("exit", resolve)), wait(2000).then(() => server.child.kill("SIGKILL"))]);
};
const stateOf = (page) => page.locator("#military-tray-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const referenceCounts = (page, selector = ".sheet-reference") => page.locator(`${selector} .record-reserve`).evaluateAll((nodes) => nodes.reduce((counts, node) => {
  const match = node.getAttribute("aria-label")?.match(/^(\d+) of (\d+) .* pieces in reserve$/);
  if (match) { counts.reserve += Number(match[1]); counts.total += Number(match[2]); }
  return counts;
}, { reserve: 0, total: 0 }));
const trayLabel = (page) => page.locator(".deployment-tray-shortcut").getAttribute("aria-label");
const dispatchTouchSwipe = async (page, start, end) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: start.x, y: start.y }] });
    for (let step = 1; step <= 8; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }],
      });
      await wait(12);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
};
const report = { started: new Date().toISOString(), scenarios: {}, runtimeErrors: [] };
let server;
let browser;

try {
  server = startServer();
  await server.ready();
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const trophyPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  trophyPage.setDefaultTimeout(8000);
  trophyPage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  await trophyPage.goto(`${url}?scenario=trophy&viewer=0`, { waitUntil: "domcontentloaded" });
  const pendingBefore = await stateOf(trophyPage);
  assert.equal(pendingBefore.phase, "encounter");
  assert.equal(pendingBefore.pendingDecision.type, "trophy-choice");
  assert.equal(pendingBefore.pendingDecision.playerIndex, 0, "the Army branch owner receives the pending trophy decision");
  assert.equal(pendingBefore.currentPlayer, 1, "the stomping monster belongs to the other player");
  const trophyUnitId = pendingBefore.pendingReserveTrophies[0]?.id;
  assert.ok(trophyUnitId, "the encounter produces at least one legal reserve trophy");
  assert.equal(pendingBefore.trackedUnitId, trophyUnitId);
  const labelBefore = await trayLabel(trophyPage);
  assert.match(labelBefore ?? "", /, \d+ deployed, \d+ in reserve$/);
  await trophyPage.locator(".deployment-tray-shortcut").click();
  const militaryDrawer = trophyPage.locator(".military-drawer");
  await militaryDrawer.waitFor({ state: "visible" });
  const militaryReference = militaryDrawer.locator(".sheet-reference");
  await militaryReference.waitFor({ state: "visible" });
  const reserveBefore = await referenceCounts(trophyPage, ".military-drawer .sheet-reference");
  assert.equal(reserveBefore.reserve, pendingBefore.trayCounts.reserve, "the opened military record and tray agree before the choice");
  const trophyUnitTypeId = pendingBefore.trackedUnitTypeId;
  const trophyButtonName = `Choose ${trophyUnitTypeId.replaceAll("-", " ")} from military record as trophy`;
  const trophyButtons = trophyPage.getByRole("button", { name: trophyButtonName, exact: true });
  const sameTypeTrophyButtonsBefore = await trophyButtons.count();
  assert.ok(sameTypeTrophyButtonsBefore > 0, "the pending authorized branch owner sees the accessible record trophy action");
  const matchingTypeIndex = pendingBefore.pendingReserveTrophies.filter((candidate) => candidate.typeId === trophyUnitTypeId).findIndex((candidate) => candidate.id === trophyUnitId);
  assert.ok(matchingTypeIndex >= 0 && matchingTypeIndex < sameTypeTrophyButtonsBefore, "the expected pending unit has a matching accessible reference slot");
  const selectedTrophyButton = trophyButtons.nth(matchingTypeIndex);
  await selectedTrophyButton.focus();
  assert.equal(await selectedTrophyButton.evaluate((button) => button === document.activeElement), true, "the trophy action can receive keyboard focus");
  await trophyPage.keyboard.press("Enter");
  await trophyPage.waitForFunction(() => JSON.parse(document.querySelector("#military-tray-state")?.textContent ?? "{}").latestEvent?.action === "trophy.chosen");
  const trophyAfter = await stateOf(trophyPage);
  assert.equal(trophyAfter.latestEvent.action, "trophy.chosen");
  assert.equal(trophyAfter.latestEvent.detail.unitId, trophyUnitId, "the clicked reference slot resolves the expected unit");
  assert.equal(trophyAfter.trackedUnitLocation, "permanently-removed");
  assert.ok(trophyAfter.removedUnitIds.includes(trophyUnitId), "the permanent-removal index records the trophy");
  assert.equal(trophyAfter.trophyTakerIndex, 1, "the trophy event attributes the removal to the monster that took it");
  assert.ok(trophyAfter.trophyIdsByPlayer[1].includes(trophyUnitId), "the public trophy record credits the taking monster's player");
  assert.equal(trophyAfter.trophyIdsByPlayer[0].includes(trophyUnitId), false, "the branch owner's choice is not mistaken for the taker's trophy attribution");
  const reserveAfter = await referenceCounts(trophyPage, ".military-drawer .sheet-reference");
  const labelAfter = await trayLabel(trophyPage);
  assert.equal(reserveAfter.reserve, reserveBefore.reserve - 1, "permanent removal removes one reserve slot from the rendered MilitaryReference");
  assert.equal(reserveAfter.total, reserveBefore.total, "the printed record quantity remains stable after removal");
  assert.equal(trophyAfter.trayCounts.deployed, pendingBefore.trayCounts.deployed);
  assert.equal(trophyAfter.trayCounts.reserve, pendingBefore.trayCounts.reserve - 1, "the persistent tray reserve count drops with permanent removal");
  assert.notEqual(labelAfter, labelBefore, "the rendered tray label updates after the choice");
  assert.match(labelAfter ?? "", new RegExp(`${trophyAfter.trayCounts.deployed} deployed, ${trophyAfter.trayCounts.reserve} in reserve$`));
  assert.equal(trophyAfter.pendingDecision?.type, "deployment", "resolving the trophy clears the pending choice");
  assert.equal(await trophyPage.getByRole("button", { name: /Choose .* from military record as trophy/ }).count(), 0, "trophy controls disappear when the pending choice resolves");
  report.scenarios.trophy = {
    status: "passed",
    decisionOwner: pendingBefore.pendingDecision.playerIndex,
    monsterPlayer: pendingBefore.currentPlayer,
    selectedUnitId: trophyUnitId,
    reserveBefore: reserveBefore.reserve,
    reserveAfter: reserveAfter.reserve,
    trayBefore: pendingBefore.trayCounts,
    trayAfter: trophyAfter.trayCounts,
    removed: trophyAfter.trackedUnitLocation === "permanently-removed" && trophyAfter.removedUnitIds.includes(trophyUnitId),
    attributedToTakingPlayer: trophyAfter.trophyIdsByPlayer[1].includes(trophyUnitId),
    keyboardActivated: true,
  };
  await trophyPage.close();

  const mobileTrophyPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobileTrophyPage.setDefaultTimeout(8000);
  mobileTrophyPage.on("pageerror", (error) => report.runtimeErrors.push(`mobile: ${error.message}`));
  await mobileTrophyPage.goto(`${url}?scenario=trophy&viewer=0`, { waitUntil: "domcontentloaded" });
  const mobileTray = mobileTrophyPage.locator(".deployment-tray-shortcut");
  const mobileTrayBounds = await mobileTray.boundingBox();
  assert.ok(mobileTrayBounds && mobileTrayBounds.x >= 0 && mobileTrayBounds.y >= 0 && mobileTrayBounds.x + mobileTrayBounds.width <= 391 && mobileTrayBounds.y + mobileTrayBounds.height <= 845,
    `the compact tray entry should fit the 390×844 viewport: ${JSON.stringify(mobileTrayBounds)}`);
  await mobileTrophyPage.touchscreen.tap(mobileTrayBounds.x + mobileTrayBounds.width / 2, mobileTrayBounds.y + mobileTrayBounds.height / 2);
  const mobileDrawer = mobileTrophyPage.locator(".military-drawer");
  await mobileDrawer.waitFor({ state: "visible" });
  await mobileDrawer.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const mobileDrawerBounds = await mobileDrawer.boundingBox();
  assert.ok(mobileDrawerBounds && mobileDrawerBounds.x >= 0 && mobileDrawerBounds.y >= 0 && mobileDrawerBounds.x + mobileDrawerBounds.width <= 391 && mobileDrawerBounds.y + mobileDrawerBounds.height <= 845,
    `the military record drawer should fit the 390×844 viewport: ${JSON.stringify(mobileDrawerBounds)}`);
  await mobileDrawer.getByRole("button", { name: "Close military sheets" }).click();
  await mobileDrawer.waitFor({ state: "detached" });
  const mobileTrophyButton = mobileTrophyPage.getByRole("button", { name: /Choose .* from military record as trophy/ }).first();
  await mobileTrophyButton.scrollIntoViewIfNeeded();
  const mobileTrophyButtonBounds = await mobileTrophyButton.boundingBox();
  assert.ok(mobileTrophyButtonBounds && mobileTrophyButtonBounds.x >= 0 && mobileTrophyButtonBounds.x + mobileTrophyButtonBounds.width <= 391,
    `the compact trophy choice should remain horizontally in bounds: ${JSON.stringify(mobileTrophyButtonBounds)}`);
  await mobileTrophyButton.focus();
  await mobileTrophyPage.keyboard.press("Enter");
  await mobileTrophyPage.waitForFunction(() => JSON.parse(document.querySelector("#military-tray-state")?.textContent ?? "{}").latestEvent?.action === "trophy.chosen");
  const mobileTrophyAfter = await stateOf(mobileTrophyPage);
  assert.equal(mobileTrophyAfter.trayCounts.reserve, 5, "the mobile tray should update after keyboard trophy activation");
  assert.equal(mobileTrophyAfter.trackedUnitLocation, "permanently-removed");
  const mobileWidths = await mobileTrophyPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(mobileWidths.document <= mobileWidths.viewport + 1 && mobileWidths.body <= mobileWidths.viewport + 1,
    `the compact trophy flow should not create horizontal page overflow: ${JSON.stringify(mobileWidths)}`);
  report.scenarios.mobileTrophy = {
    status: "passed",
    viewport: "390x844 touch emulation",
    trayBounds: mobileTrayBounds,
    drawerBounds: mobileDrawerBounds,
    trophyButtonBounds: mobileTrophyButtonBounds,
    keyboardActivated: true,
    trayAfter: mobileTrophyAfter.trayCounts,
    horizontalWidths: mobileWidths,
  };
  await mobileTrophyPage.close();

  const reserveSwipePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  reserveSwipePage.setDefaultTimeout(8000);
  reserveSwipePage.on("pageerror", (error) => report.runtimeErrors.push(`reserve swipe: ${error.message}`));
  await reserveSwipePage.goto(`${url}?scenario=redeploy&viewer=0`, { waitUntil: "domcontentloaded" });
  const reserveTray = reserveSwipePage.locator(".deployment-tray-shortcut");
  const reserveTrayBounds = await reserveTray.boundingBox();
  assert.ok(reserveTrayBounds);
  await reserveSwipePage.touchscreen.tap(reserveTrayBounds.x + reserveTrayBounds.width / 2, reserveTrayBounds.y + reserveTrayBounds.height / 2);
  const reserveDrawer = reserveSwipePage.locator(".military-drawer");
  await reserveDrawer.waitFor({ state: "visible" });
  await reserveDrawer.getByRole("button", { name: "National Guard", exact: true }).click();
  const guardScroller = reserveDrawer.locator('.record-reserve[aria-label*="national guard tank"] .record-reserve-slots').first();
  const beforeSwipe = await guardScroller.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    scrollLeft: node.scrollLeft,
    rect: (() => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; })(),
  }));
  assert.ok(beforeSwipe.scrollWidth > beforeSwipe.clientWidth + 1, `the Guard reserve row should overflow horizontally on phone: ${JSON.stringify(beforeSwipe)}`);
  assert.equal((await reserveDrawer.locator(".military-sheet-tabs button[aria-pressed='true']").innerText()).trim(), "National Guard");
  const scrollStart = { x: beforeSwipe.rect.x + beforeSwipe.rect.width - 12, y: beforeSwipe.rect.y + beforeSwipe.rect.height / 2 };
  await dispatchTouchSwipe(reserveSwipePage, scrollStart, { x: scrollStart.x - 130, y: scrollStart.y });
  await wait(120);
  const afterReserveSwipe = {
    activeSheet: (await reserveDrawer.locator(".military-sheet-tabs button[aria-pressed='true']").innerText()).trim(),
    scrollLeft: await guardScroller.evaluate((node) => node.scrollLeft),
  };
  assert.equal(afterReserveSwipe.activeSheet, "National Guard", `a reserve-row swipe should scroll pieces without paging the military sheet: ${JSON.stringify(afterReserveSwipe)}`);
  assert.ok(afterReserveSwipe.scrollLeft > 0, `the native reserve-row scroller should move horizontally: ${JSON.stringify(afterReserveSwipe)}`);

  await guardScroller.evaluate((node) => { node.scrollLeft = 0; });
  const inertInstruction = reserveDrawer.locator(".deployment-instruction");
  const inertInstructionBounds = await inertInstruction.boundingBox();
  assert.ok(inertInstructionBounds && inertInstructionBounds.width > 120, `the deployment instruction provides room for a deliberate page swipe: ${JSON.stringify(inertInstructionBounds)}`);
  const pageSwipeStart = { x: inertInstructionBounds.x + inertInstructionBounds.width - 5, y: inertInstructionBounds.y + inertInstructionBounds.height / 2 };
  await dispatchTouchSwipe(reserveSwipePage, pageSwipeStart, { x: pageSwipeStart.x - 110, y: pageSwipeStart.y });
  await reserveSwipePage.waitForFunction(() => document.querySelector(".military-sheet-tabs button[aria-pressed='true']")?.textContent?.trim() === "Army");
  report.scenarios.reserveSwipe = {
    status: "passed",
    viewport: "390x844 touch emulation",
    reserveRow: beforeSwipe,
    afterReserveSwipe,
    deliberateSheetSwipe: "National Guard → Army",
  };
  await reserveSwipePage.close();

  const unauthorizedPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  unauthorizedPage.setDefaultTimeout(8000);
  unauthorizedPage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  await unauthorizedPage.goto(`${url}?scenario=trophy&viewer=1`, { waitUntil: "domcontentloaded" });
  const unauthorizedState = await stateOf(unauthorizedPage);
  assert.equal(unauthorizedState.pendingDecision.type, "trophy-choice");
  assert.equal(unauthorizedState.canAct, false);
  assert.equal(await unauthorizedPage.locator(".sheet-reference").count(), 1, "the other player can still inspect the public branch record");
  assert.equal(await unauthorizedPage.getByRole("button", { name: /Choose .* from military record as trophy/ }).count(), 0, "the non-owner does not receive an actionable trophy control");
  report.scenarios.unauthorized = { status: "passed", pendingDecisionVisible: true, trophyControls: 0 };
  await unauthorizedPage.close();

  const nonPendingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  nonPendingPage.setDefaultTimeout(8000);
  nonPendingPage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  await nonPendingPage.goto(`${url}?scenario=nonpending&viewer=0`, { waitUntil: "domcontentloaded" });
  const nonPendingState = await stateOf(nonPendingPage);
  assert.notEqual(nonPendingState.pendingDecision?.type, "trophy-choice");
  assert.equal(await nonPendingPage.locator(".sheet-reference").count(), 0, "no trophy reference action is mounted without a pending trophy decision");
  assert.equal(await nonPendingPage.getByRole("button", { name: /Choose .* from military record as trophy/ }).count(), 0);
  report.scenarios.nonpending = { status: "passed", referenceMounted: false, trophyControls: 0 };
  await nonPendingPage.close();

  const redeployPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  redeployPage.setDefaultTimeout(8000);
  redeployPage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  await redeployPage.goto(`${url}?scenario=redeploy&viewer=0`, { waitUntil: "domcontentloaded" });
  const redeployBefore = await stateOf(redeployPage);
  assert.equal(redeployBefore.phase, "deploy");
  assert.notEqual(redeployBefore.trackedUnitLocation, "record-tile", "the tracked Army unit begins deployed from Chicago");
  const redeploySlotsBefore = await referenceCounts(redeployPage);
  const redeployTrayBefore = await trayLabel(redeployPage);
  assert.equal(redeploySlotsBefore.reserve, redeployBefore.trayCounts.reserve);
  const redeployButtons = redeployPage.getByRole("button", { name: /^Redeploy .* piece/ });
  assert.equal(await redeployButtons.count(), 1, "the deterministic fixture exposes one owned legal redeployment");
  await redeployButtons.first().click();
  const destinationButton = redeployPage.getByRole("button", { name: "Choose legal redeployment destination", exact: true });
  await destinationButton.waitFor({ state: "visible" });
  await destinationButton.click();
  await redeployPage.waitForFunction(() => JSON.parse(document.querySelector("#military-tray-state")?.textContent ?? "{}").latestEvent?.action === "unit.redeployed");
  const redeployAfter = await stateOf(redeployPage);
  const redeploySlotsAfter = await referenceCounts(redeployPage);
  const redeployTrayAfter = await trayLabel(redeployPage);
  assert.equal(redeployAfter.latestEvent.detail.unitId, redeployBefore.trackedUnitId);
  assert.notEqual(redeployAfter.trackedUnitLocation, redeployBefore.trackedUnitLocation, "the selected deployed unit changes location");
  assert.equal(redeployAfter.phase, "deploy", "the empty-base redeployment remains in Deploy");
  assert.deepEqual(redeployAfter.trayCounts, redeployBefore.trayCounts, "a legal redeployment preserves deployed/reserve tray counts");
  assert.deepEqual(redeploySlotsAfter, redeploySlotsBefore, "the MilitaryReference reserve-slot counts are invariant under redeployment");
  assert.equal(redeployTrayAfter, redeployTrayBefore, "the rendered persistent tray label is unchanged by redeployment");
  report.scenarios.redeploy = {
    status: "passed",
    unitId: redeployBefore.trackedUnitId,
    from: redeployBefore.trackedUnitLocation,
    to: redeployAfter.trackedUnitLocation,
    tray: redeployAfter.trayCounts,
    reference: redeploySlotsAfter,
  };
  await redeployPage.close();

  assert.deepEqual(report.runtimeErrors, [], "browser scenarios complete without uncaught runtime errors");
  const artifactDirectory = join(cwd, "output/ui-review");
  await mkdir(artifactDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const artifactPath = join(artifactDirectory, `military-tray-${date}.json`);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, artifactPath }, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}
