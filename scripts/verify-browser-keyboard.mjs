import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const reservePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_KEYBOARD_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = process.env.BROWSER_TEST_URL ? undefined : spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] });
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const tabTo = async (locator, label) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard Tab could not reach ${label}.`);
};
const activateByKeyboard = async (locator, label) => {
  await tabTo(locator, label);
  await page.keyboard.press("Enter");
};
const completeSetup = async () => {
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 16 && await page.locator(".setup-panel").count(); attempt += 1) {
    const list = page.locator(".lair-selection-prompt details");
    if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
    const choice = page.locator(".setup-panel .setup-options button:visible:not(:disabled)").first();
    await choice.waitFor({ state: "visible" });
    await choice.click();
    await page.waitForTimeout(80);
  }
  await page.locator(".setup-panel").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: /Start local game/ });
  await activateByKeyboard(start, "Start local game");
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  // Setup has several meaningful choices; enter the real local audited-board
  // match, then exercise the interaction-heavy gameplay controls by keyboard.
  await completeSetup();

  const menu = page.locator(".hud-menu > summary");
  await activateByKeyboard(menu, "game menu");
  assert.equal(await page.locator(".hud-menu").evaluate((node) => node.open), true);
  const settings = page.locator(".hud-menu .settings-action");
  await activateByKeyboard(settings, "Settings");
  await page.locator(".settings-panel").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator(".settings-panel").waitFor({ state: "detached" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".hud-menu")?.open);

  const recordToggle = page.getByRole("button", { name: "Open monster, military and map record" });
  await activateByKeyboard(recordToggle, "player record");
  const monsterTab = page.getByRole("tab", { name: "Monster" });
  await monsterTab.waitFor({ state: "visible" });
  await monsterTab.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Military" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Map" }).getAttribute("aria-selected"), "true");
  const overview = page.getByRole("button", { name: "Board overview. Click to move camera; arrow keys pan." });
  await overview.waitFor({ state: "visible" });
  const beforePan = await page.locator(".map-canvas").getAttribute("style");
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.locator(".map-canvas").getAttribute("style"), beforePan, "the overview keyboard arrows pan the board");
  await page.getByRole("button", { name: "Minimize monster, military and map record" }).click();

  const legalTile = page.locator(".hex-tile.legal:not(:disabled)").first();
  await legalTile.waitFor({ state: "visible" });
  await legalTile.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("button", { name: "Confirm move", exact: true });
  await confirm.waitFor({ state: "visible" });
  await activateByKeyboard(confirm, "Confirm move");
  await page.waitForFunction(() => {
    const button = document.querySelector(".action-dock > button");
    return button && button.textContent?.trim() !== "Confirm move" && !button.disabled;
  });
  const actionLabel = await page.locator(".action-dock > button").innerText();
  assert.match(actionLabel, /Hold|Next piece|Continue to Fight|End movement/i);
  assert.deepEqual(errors, [], "keyboard interactions should not produce runtime errors");
  console.log(JSON.stringify({ ok: true, viewport: "1280x720", keyboard: ["start local game", "menu and settings", "record tab navigation", "minimap pan", "select and confirm move"], nextAction: actionLabel.trim() }));
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
