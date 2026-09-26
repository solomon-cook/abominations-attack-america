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

try {
  for (const [width, height] of [[1280, 720], [390, 844], [320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width <= 600, hasTouch: width <= 600 });
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(`${width}x${height}: ${error.message}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkSetup(page);
    let layout = await inspectLayout(page, width, height);
    assert.equal(layout.documentOverflow, false, `${width}x${height} should fit the viewport`);
    assert.ok(layout.controls.length >= (width <= 360 ? 2 : 3), `${width}x${height} should expose the expected map controls`);

    if (width > 700) {
      assert.equal(layout.minimap?.visible, false, "the overview minimap is opt-in");
      await page.getByRole("button", { name: "Open monster, military and map record" }).click();
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
      await page.getByRole("tab", { name: "Monster" }).click();
      const monsterRecord = await page.locator("#record-panel").innerText();
      assert.match(monsterRecord, /♥\s*\d+\/\d+/);
      assert.match(monsterRecord, /★\s*\d+/);
      assert.match(await page.locator(".record-medallion").first().evaluate((node) => getComputedStyle(node).backgroundImage), /conic-gradient/);
      await page.getByRole("tab", { name: "Military" }).click();
      assert.match(await page.locator("#record-panel").innerText(), /Military Record|Research cards/i);
      for (const tab of await page.getByRole("tab").all()) {
        const box = await tab.boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44, `${width}x${height} record tab needs a 44px target; got ${JSON.stringify(box)}`);
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
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
