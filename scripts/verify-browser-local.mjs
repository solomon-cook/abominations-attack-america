import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const freePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_LOCAL_PORT ?? await freePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const ownsServer = !process.env.BROWSER_TEST_URL;
const server = ownsServer
  ? spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const contrastRatio = (first, second) => {
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

if (server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if (await (await fetch(url)).ok) break;
    } catch {
      if (server.exitCode !== null) throw new Error(`Vite exited before ready.\n${serverOutput}`);
    }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const failures = [];
const checkSetup = async (page) => {
  await page.getByRole("button", { name: /Start local game/ }).click();
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  const abilities = await page.locator(".monster-choice-ability span").evaluateAll((nodes) => nodes.map((node) => {
    const text = node;
    const ability = text.closest(".monster-choice-ability");
    const card = text.closest(".monster-choice");
    const style = getComputedStyle(text);
    return {
      text: text.textContent?.trim(),
      visible: Boolean(text.getClientRects().length && card?.getClientRects().length),
      lineClamp: style.webkitLineClamp,
      textOverflow: style.overflow,
      textClipped: text.scrollHeight > text.clientHeight + 1,
      abilityClipped: ability ? ability.scrollHeight > ability.clientHeight + 1 : true,
    };
  }));
  assert.ok(abilities.length >= 6, "monster selection should show every monster ability");
  assert.ok(abilities.every((ability) => ability.visible && (ability.lineClamp === "none" || ability.lineClamp === "0") && ability.textOverflow === "visible" && !ability.textClipped && !ability.abilityClipped), `all monster ability text should remain readable without hover: ${JSON.stringify(abilities)}`);
  const { width, height } = page.viewportSize();
  await page.screenshot({ path: `output/board-art/setup-monsters-${width}x${height}.png` });
  for (let attempt = 0; attempt < 16 && await page.locator(".setup-panel").count(); attempt += 1) {
    const list = page.locator(".lair-selection-prompt details");
    if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
    const choices = page.locator(".setup-panel .setup-options button:visible:not(:disabled)");
    await choices.first().waitFor({ state: "visible" });
    await choices.first().click();
    await page.waitForTimeout(80);
  }
  await page.locator(".setup-panel").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
  const identity = await page.locator("main.game-screen").evaluate((node) => ({
    board: node.dataset.boardId,
    renderedBoard: node.dataset.renderedBoardId,
    hash: node.dataset.boardContentHash,
    renderedHash: node.dataset.renderedBoardContentHash,
    cells: node.querySelectorAll(".hex-tile").length,
  }));
  assert.deepEqual(identity, {
    board: "human-audited-north-america",
    renderedBoard: "human-audited-north-america",
    hash: identity.hash,
    renderedHash: identity.hash,
    cells: 336,
  });
  assert.ok(identity.hash, "the current local match must expose its board content hash");
};

const inspectLayout = async (page, width, height) => page.evaluate(({ width, height }) => {
  const visible = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), visible: getComputedStyle(element).display !== "none" && rect.width > 0 && rect.height > 0 };
  };
  return {
    viewport: { width, height },
    documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
    record: visible(".persistent-record"),
    portraitRail: visible(".opponent-portrait-rail"),
    command: visible(".command-station"),
    queue: visible(".movement-checklist"),
    minimap: visible(".board-minimap"),
    controls: [...document.querySelectorAll(".map-controls button")].filter((button) => getComputedStyle(button).display !== "none").map((button) => {
      const rect = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label"), x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
    }),
  };
}, { width, height });

const inspectTrophyBadge = async (page) => page.evaluate(() => {
  const card = document.querySelector(".opponent-player-card");
  if (!(card instanceof HTMLButtonElement)) throw new Error("The player portrait rail should be visible during a local game.");
  card.classList.add("has-trophies");
  const badge = document.createElement("span");
  badge.className = "opponent-trophy-badge";
  badge.innerHTML = '<span class="opponent-trophy-icons"><img src="/assets/military/army-tank.webp" alt=""><img src="/assets/military/army-tank.webp" alt=""></span><b>×2</b>';
  card.append(badge);
  const rect = (element) => {
    const { x, y, width, height, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, bottom };
  };
  return {
    display: getComputedStyle(badge).display,
    badge: rect(badge),
    card: rect(card),
    reservedIdentityBottom: Math.max(...[...card.querySelectorAll(".opponent-health-badge, .opponent-player-number")].map((element) => rect(element).bottom)),
  };
});

try {
  for (const [width, height] of [[1280, 720], [390, 844], [320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width <= 600, hasTouch: width <= 600 });
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(`${width}x${height}: ${error.message}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkSetup(page);
    if (width > 700) {
      for (const [testWidth, testHeight] of width === 1280 ? [[1280, 720], [768, 1024]] : [[width, height]]) {
        if (testWidth !== width || testHeight !== height) await page.setViewportSize({ width: testWidth, height: testHeight });
        const badge = await inspectTrophyBadge(page);
        assert.equal(badge.display, "flex", `${testWidth}px portrait rails should show the compact trophy count`);
        assert.ok(badge.badge.width >= 37 && badge.badge.height >= 15, `${testWidth}px trophy count should remain legible: ${JSON.stringify(badge)}`);
        assert.ok(badge.badge.y >= badge.reservedIdentityBottom, `${testWidth}px trophy marker should clear portrait health and player-number badges: ${JSON.stringify(badge)}`);
        assert.ok(badge.badge.bottom <= badge.card.bottom + 7, `${testWidth}px trophy marker should stay within its small reserved rail gap: ${JSON.stringify(badge)}`);
        await page.locator(".opponent-trophy-badge").evaluate((node) => node.remove());
        await page.locator(".opponent-player-card").first().evaluate((node) => node.classList.remove("has-trophies"));
      }
      if (width === 1280) await page.setViewportSize({ width, height });
    } else {
      const badge = await inspectTrophyBadge(page);
      assert.equal(badge.display, "none", `${width}px phones should hide the trophy strip`);
      assert.ok(badge.card.height <= (width <= 360 ? 60 : 64) + 1, `${width}px trophy state should not enlarge the phone rail: ${JSON.stringify(badge)}`);
      await page.locator(".opponent-trophy-badge").evaluate((node) => node.remove());
      await page.locator(".opponent-player-card").first().evaluate((node) => node.classList.remove("has-trophies"));
    }
    const mapControls = page.locator(".board-map-controls");
    assert.equal(await mapControls.evaluate((node) => node.open), false, "map controls should start collapsed into a board-edge button");
    await mapControls.locator("summary").click();
    let layout = await inspectLayout(page, width, height);
    assert.equal(layout.documentOverflow, false, `${width}x${height} should fit the viewport`);
    assert.ok(layout.controls.length >= (width <= 360 ? 2 : 3), `${width}x${height} should expose the expected map controls`);
    if (width > 700) {
      assert.ok(await page.locator(".movement-piece").first().isVisible(), "desktop order cards should be visible");
      const queue = await page.locator(".movement-checklist").boundingBox();
      assert.ok(queue && Math.abs(queue.x + queue.width / 2 - width / 2) <= 2, `desktop orders should be horizontally centered: ${JSON.stringify(queue)}`);
      assert.ok(queue.width < 360, `short rosters should not leave a wide empty order panel: ${JSON.stringify(queue)}`);
      if (width === 1280) {
        await page.setViewportSize({ width: 2048, height: 400 });
        const panoramicQueue = await page.locator(".movement-checklist").boundingBox();
        const panoramicCommand = await page.locator(".command-station").boundingBox();
        assert.ok(panoramicQueue && Math.abs(panoramicQueue.y + panoramicQueue.height - 384) <= 2, `short panoramic desktop orders should align with the bottom HUD row: ${JSON.stringify(panoramicQueue)}`);
        assert.ok(panoramicQueue && panoramicCommand && (panoramicQueue.x + panoramicQueue.width <= panoramicCommand.x || panoramicCommand.x + panoramicCommand.width <= panoramicQueue.x || panoramicQueue.y + panoramicQueue.height <= panoramicCommand.y || panoramicCommand.y + panoramicCommand.height <= panoramicQueue.y), `short panoramic desktop orders should clear the action dock: queue=${JSON.stringify(panoramicQueue)} command=${JSON.stringify(panoramicCommand)}`);
        await page.setViewportSize({ width, height });
      }
    }

    if (width > 700) {
      assert.equal(layout.minimap?.visible, false, "the overview minimap is opt-in");
      await page.locator(".persistent-record .mobile-record-toggle").click();
      await page.getByRole("tab", { name: "Monster" }).click();
      const monsterRecord = await page.locator("#record-panel").innerText();
      assert.match(monsterRecord, /♥\s*\d+\/\d+/);
      assert.match(monsterRecord, /★\s*\d+/);
      assert.match(await page.locator(".record-medallion").first().evaluate((node) => getComputedStyle(node).backgroundImage), /conic-gradient/);
      await page.getByRole("tab", { name: "Military" }).click();
      assert.match(await page.locator("#record-panel").innerText(), /Military Record|Research cards/i);
      await page.getByRole("button", { name: /Open .* military sheet/i }).click();
      const militaryDialog = page.locator(".military-drawer[role=dialog]");
      await militaryDialog.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const drawer = document.querySelector(".military-drawer[role=dialog]");
        if (!drawer) return false;
        const rect = drawer.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      });
      const dialogBounds = await militaryDialog.boundingBox();
      assert.ok(dialogBounds && dialogBounds.x >= 0 && dialogBounds.y >= 0 && dialogBounds.x + dialogBounds.width <= width + 1 && dialogBounds.y + dialogBounds.height <= height + 1, `${width}x${height} military inspector ${JSON.stringify(dialogBounds)} should stay within the viewport`);
      assert.ok(await page.locator(".persistent-record").isVisible(), "opening a military inspector must leave the quick-access record mounted beneath it");
      if (width <= 360) {
        const rosterScroll = page.locator(".military-drawer .physical-military-sheet");
        const beforeScroll = await rosterScroll.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }));
        assert.equal(beforeScroll.overflowY, "auto", "narrow military roster should expose an internal scroll region");
        assert.ok(beforeScroll.scrollHeight > beforeScroll.clientHeight, `narrow military roster should exercise long-content scrolling: ${JSON.stringify(beforeScroll)}`);
        await rosterScroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
        assert.ok(await rosterScroll.evaluate((node) => node.scrollTop > 0), "narrow military roster should scroll internally");
        await rosterScroll.evaluate((node) => { node.scrollTop = 0; });
      }
      await page.keyboard.press("Escape");
      await militaryDialog.waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "Map" }).click();
      await page.getByRole("button", { name: "Board overview. Click to move camera; arrow keys pan." }).waitFor({ state: "visible" });
      layout = await inspectLayout(page, width, height);
      assert.equal(layout.minimap?.visible, true);
      const overlaps = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlaps(layout.minimap, layout.queue), false, `${width}x${height} minimap overlaps movement queue`);
      assert.equal(overlaps(layout.minimap, layout.command), false, `${width}x${height} minimap overlaps command sheet`);
      await page.screenshot({ path: `output/board-art/ui-minimap-${width}x${height}.png` });
      await page.getByRole("button", { name: "Minimize monster, military and map record" }).click();
      layout = await inspectLayout(page, width, height);
      assert.equal(layout.minimap?.visible, false, "closing the record hides the minimap");
    } else {
      await page.locator(".mobile-command-toggle").click();
      await page.waitForFunction(() => document.querySelector(".mobile-command-toggle")?.getAttribute("aria-expanded") === "true");
      const tabs = page.getByRole("tablist", { name: "Record view" });
      await tabs.waitFor({ state: "visible" });
      const mobileOrder = page.locator(".movement-piece").first();
      assert.ok(await mobileOrder.isVisible(), "expanded mobile command sheet should show its order cards");
      const mobileOrderBounds = await mobileOrder.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const list = node.parentElement.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { item: { x: box.x, y: box.y, width: box.width, height: box.height }, list: { x: list.x, y: list.y, width: list.width, height: list.height }, text: node.innerText, display: style.display, visibility: style.visibility, opacity: style.opacity, color: style.color, background: style.backgroundColor };
      });
      assert.ok(mobileOrderBounds.item.x >= Math.max(0, mobileOrderBounds.list.x) - 1 && mobileOrderBounds.item.x + mobileOrderBounds.item.width <= Math.min(width, mobileOrderBounds.list.x + mobileOrderBounds.list.width) + 1 && mobileOrderBounds.item.y >= mobileOrderBounds.list.y - 1 && mobileOrderBounds.item.y + mobileOrderBounds.item.height <= mobileOrderBounds.list.y + mobileOrderBounds.list.height + 1, `mobile order card should be fully inside the visible horizontal list: ${JSON.stringify(mobileOrderBounds)}`);
      await page.getByRole("tab", { name: "Monster" }).click();
      const monsterRecord = await page.locator("#record-panel").innerText();
      assert.match(monsterRecord, /♥\s*\d+\/\d+/);
      assert.match(monsterRecord, /★\s*\d+/);
      assert.match(await page.locator(".record-medallion").first().evaluate((node) => getComputedStyle(node).backgroundImage), /conic-gradient/);
      await page.getByRole("tab", { name: "Military" }).click();
      assert.match(await page.locator("#record-panel").innerText(), /Military Record|Research cards/i);
      for (const tab of await page.getByRole("tab").all()) {
        const box = await tab.boundingBox();
        assert.ok(box && box.height >= 43.5 && box.width >= 43.5, `${width}x${height} record tab needs a 44px target within subpixel layout tolerance; got ${JSON.stringify(box)}`);
      }
      await page.getByRole("tab", { name: "Map" }).click();
      await page.getByRole("button", { name: "Board overview. Click to move camera; arrow keys pan." }).waitFor({ state: "visible" });
      layout = await inspectLayout(page, width, height);
      assert.equal(layout.documentOverflow, false);
      const command = layout.command;
      assert.ok(command?.visible && command.y + command.height <= height + 1, `${width}x${height} expanded command sheet must remain on screen`);
      assert.equal(layout.minimap?.visible, true);
      assert.ok(layout.minimap.y + layout.minimap.height < command.y + 1, `${width}x${height} minimap ${JSON.stringify(layout.minimap)} must clear command sheet ${JSON.stringify(command)}`);
      const overlaps = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      assert.equal(overlaps(layout.minimap, layout.portraitRail), false, `${width}x${height} minimap overlaps player portraits`);
      for (const control of layout.controls) assert.equal(overlaps(layout.minimap, control), false, `${width}x${height} minimap overlaps ${control.name}`);
      await page.screenshot({ path: `output/board-art/ui-minimap-${width}x${height}.png` });
      await page.locator(".mobile-command-toggle").click();
      await page.waitForFunction(() => document.querySelector(".mobile-command-toggle")?.getAttribute("aria-expanded") === "false");
      layout = await inspectLayout(page, width, height);
      assert.equal(layout.minimap?.visible, false, "collapsing the sheet hides the minimap");
    }

    const activeAction = page.locator(".action-dock > button").filter({ visible: true }).first();
    assert.ok(await activeAction.count(), `${width}x${height} should retain the primary action`);
    const errors = failures.splice(0);
    assert.deepEqual(errors, [], "the browser should not report runtime errors");
    console.log(JSON.stringify({ ok: true, viewport: `${width}x${height}`, board: "human-audited-north-america", cells: 336, mapControls: layout.controls.length, minimap: "hidden-by-default" }));
    await context.close();
  }

  const soloContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const soloPage = await soloContext.newPage();
  soloPage.setDefaultTimeout(10000);
  soloPage.on("pageerror", (error) => failures.push(`solo: ${error.message}`));
  await soloPage.addInitScript(() => {
    const nativeGetRandomValues = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (array) => {
      if (array instanceof Uint32Array && array.length === 1) { array[0] = 1; return array; }
      return nativeGetRandomValues(array);
    } });
  });
  await soloPage.goto(url, { waitUntil: "domcontentloaded" });
  await soloPage.getByRole("button", { name: "Play solo vs bots", exact: true }).click();
  await soloPage.locator(".setup-panel").waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 16 && await soloPage.locator(".setup-panel").count(); attempt += 1) {
    const list = soloPage.locator(".lair-selection-prompt details");
    if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
    const konk = soloPage.getByRole("button", { name: /^Choose Konk\./ });
    if (await konk.count()) { await konk.click(); continue; }
    const choices = soloPage.locator(".setup-panel .setup-options button:visible:not(:disabled)");
    await choices.first().waitFor({ state: "visible" });
    await choices.first().click();
    await soloPage.waitForTimeout(80);
  }
  await soloPage.locator(".setup-panel").waitFor({ state: "detached" });
  await soloPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));

  const playerOneName = (await soloPage.locator(".persistent-record .record-preview strong").textContent())?.trim();
  assert.ok(playerOneName, "the solo player's monster record should be present before the first turn");
  assert.equal(playerOneName, "Konk", "the city-stomp fixture should use a monster without a forced city choice");
  const legalCity = soloPage.locator(".hex-tile.legal[aria-label*='city,']").first();
  assert.ok(await legalCity.count(), "Konk should be able to reach a city from the selected audited-board lair");
  await legalCity.click();
  await soloPage.getByRole("button", { name: "Confirm move", exact: true }).first().click();
  const continueFromMove = soloPage.getByRole("button", { name: "Continue to Fight", exact: true });
  if (await continueFromMove.isVisible().catch(() => false)) await continueFromMove.click();
  await soloPage.waitForFunction(() => document.querySelector(".top-turn-summary")?.textContent?.includes("Encounter"));
  const routineStompButton = soloPage.locator(".board-event-playback.is-interactive .board-event-roll-all");
  await routineStompButton.waitFor({ state: "visible" });
  assert.match((await routineStompButton.textContent()) ?? "", /Roll all 2 dice/, "the two-die San Francisco benefit should offer one all-dice action");
  assert.equal(await soloPage.locator(".board-action-bar .action-dock > button").isVisible().catch(() => false), false, "the compact city popup should replace the duplicate bottom action dock");
  assert.equal(await soloPage.locator("#phase-command-context").isVisible().catch(() => false), false, "routine city stomps should not leave the Encounter options panel on screen");
  await routineStompButton.click();
  const encounterPresentation = await soloPage.waitForFunction(() => {
    if (document.querySelector(".resolution-stage[open]")) return "overlay";
    return document.querySelector('.board-event-playback[data-event-action="encounter.resolved"]') ? "board" : false;
  });
  if (await encounterPresentation.jsonValue() === "board") {
    await soloPage.waitForFunction(() => document.querySelector('.board-event-playback[data-event-action="encounter.resolved"]')?.dataset.outcomeVisible === "true");
    assert.equal(await soloPage.locator(".resolution-stage[open]").count(), 0, "a routine city stomp should resolve in board playback instead of opening the Encounter panel");
  } else {
    await soloPage.getByRole("button", { name: "Reveal encounter", exact: true }).click();
    for (let step = 0; step < 12; step += 1) {
      const revealRolls = soloPage.getByRole("button", { name: "Reveal remaining rolls", exact: true });
      if (await revealRolls.isVisible().catch(() => false)) { await revealRolls.click(); continue; }
      const revealCard = soloPage.getByRole("button", { name: "Reveal card", exact: true });
      if (await revealCard.isVisible().catch(() => false)) { await revealCard.click(); continue; }
      const reward = soloPage.locator(".resolution-encounter .cinema-choice button:visible").first();
      if (await reward.isVisible().catch(() => false)) { await reward.click(); continue; }
      const returnToBoard = soloPage.locator(".resolution-encounter .cinema-primary").filter({ hasText: "Return to board" }).last();
      if (await returnToBoard.isVisible().catch(() => false)) { await returnToBoard.click(); break; }
      await soloPage.waitForTimeout(100);
    }
  }
  await soloPage.waitForFunction(() => document.querySelector(".top-turn-summary")?.textContent?.includes("Deploy"));
  await soloPage.locator(".board-action-bar .action-dock > button").click();
  await soloPage.getByRole("button", { name: /Military research/ }).last().click();
  await soloPage.getByRole("button", { name: "Draw a Military Research card instead of deploying a unit" }).click();
  await soloPage.locator("dialog.resolution-research").waitFor({ state: "visible" });
  await soloPage.locator("dialog.resolution-research .resolution-close").click();
  const humanCamera = await soloPage.locator(".map-canvas").getAttribute("style");
  const militaryClose = soloPage.locator(".military-drawer .military-sheet-close").last();
  if (await militaryClose.isVisible().catch(() => false)) await militaryClose.click();

  await soloPage.waitForFunction(() => document.querySelector(".top-turn-summary")?.textContent?.includes("BOT TURN"));
  const botCamera = await soloPage.locator(".map-canvas").getAttribute("style");
  assert.equal(botCamera, humanCamera, "a solo bot turn should leave the camera on the player's board view");
  const followBot = soloPage.getByRole("button", { name: "Follow bot", exact: true });
  await followBot.waitFor({ state: "visible" });
  const ownRecordToggle = soloPage.locator(".persistent-record .mobile-record-toggle");
  await ownRecordToggle.click();
  await soloPage.getByRole("tab", { name: "Monster", exact: true }).waitFor({ state: "visible" });
  const ownRecord = await soloPage.locator("#record-panel").innerText();
  assert.match(ownRecord, /PLAYER 1/i, "the solo record should remain assigned to Player 1 during a bot turn");
  assert.ok(ownRecord.toLocaleLowerCase().includes(playerOneName.toLocaleLowerCase()), `the persistent record should still show ${playerOneName} while bots act`);
  await ownRecordToggle.click();
  await soloPage.setViewportSize({ width: 390, height: 844 });
  const mobileRecordToggle = soloPage.locator(".mobile-command-toggle");
  await mobileRecordToggle.waitFor({ state: "visible" });
  assert.ok((await mobileRecordToggle.getAttribute("aria-label"))?.toLocaleLowerCase().includes(playerOneName.toLocaleLowerCase()), "the phone medallion should still identify the solo player's monster during a bot turn");
  await mobileRecordToggle.click();
  await soloPage.waitForFunction(() => document.querySelector(".mobile-command-toggle")?.getAttribute("aria-expanded") === "true");
  const mobileOwnRecord = await soloPage.locator("#record-panel").innerText();
  assert.match(mobileOwnRecord, /PLAYER 1/i);
  assert.ok(mobileOwnRecord.toLocaleLowerCase().includes(playerOneName.toLocaleLowerCase()), "the phone record should stay interactive during a bot turn");
  await mobileRecordToggle.click();
  const cameraBeforeFollowing = await soloPage.locator(".map-canvas").getAttribute("style");
  await followBot.click();
  assert.equal(await soloPage.locator(".board-action-bar .action-dock > button").getAttribute("aria-pressed"), "true", "following a bot should expose a pressed toggle state");
  await soloPage.waitForFunction((before) => document.querySelector(".map-canvas")?.getAttribute("style") !== before, cameraBeforeFollowing);
  await soloPage.waitForFunction(() => {
    const button = document.querySelector(".board-action-bar .action-dock > button");
    return button && getComputedStyle(button).backgroundColor === "rgb(150, 80, 34)";
  });
  const followColors = await soloPage.locator(".board-action-bar .action-dock > button").evaluate((node) => {
    const style = getComputedStyle(node);
    return { foreground: style.color, background: style.backgroundColor };
  });
  assert.ok(contrastRatio(followColors.foreground, followColors.background) >= 4.5, `the selected follow control should retain AA text contrast: ${JSON.stringify(followColors)}`);
  assert.deepEqual(failures.splice(0), [], "the solo browser flow should not report runtime errors");
  console.log(JSON.stringify({ ok: true, mode: "solo", check: "routine city dice play inline; player record stays interactive; camera follow is opt-in" }));
  await soloContext.close();
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
