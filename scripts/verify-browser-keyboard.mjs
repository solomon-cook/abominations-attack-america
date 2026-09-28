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
const openSettings = async () => {
  const menu = page.locator(".hud-menu > summary");
  await activateByKeyboard(menu, "game menu");
  assert.equal(await page.locator(".hud-menu").evaluate((node) => node.open), true);
  const settings = page.locator(".hud-menu .settings-action");
  await activateByKeyboard(settings, "Settings");
  await page.locator(".settings-panel").waitFor({ state: "visible" });
  return { menu, settings };
};
const auditSettingsBounds = async ({ width, height }) => {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(80);
  const measurements = await page.evaluate(() => {
    const panel = document.querySelector(".settings-panel");
    if (!panel) throw new Error("Settings panel is not rendered.");
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return {
      panel: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      panelClientWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
      overflowY: style.overflowY,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const { panel } = measurements;
  assert.ok(panel.width > 0 && panel.height > 0, `${width}x${height}: Settings has non-zero bounds`);
  assert.ok(panel.x >= -1 && panel.right <= width + 1, `${width}x${height}: Settings stays inside horizontal viewport bounds: ${JSON.stringify(panel)}`);
  assert.ok(panel.y >= -1 && panel.bottom <= height + 1, `${width}x${height}: Settings stays inside vertical viewport bounds: ${JSON.stringify(panel)}`);
  assert.ok(measurements.documentWidth <= width + 1, `${width}x${height}: document has no horizontal overflow (${measurements.documentWidth}px)`);
  assert.ok(measurements.panelScrollWidth <= measurements.panelClientWidth + 1, `${width}x${height}: Settings content has no horizontal overflow`);
  assert.match(measurements.overflowY, /auto|scroll/, `${width}x${height}: Settings can scroll vertically when its content is taller than the available panel`);
  const settingsPanel = page.locator(".settings-panel");
  await settingsPanel.evaluate((node) => { node.scrollTop = 0; });
  await page.getByRole("slider", { name: "Music" }).focus();
  const lastControl = await page.getByRole("slider", { name: "Music" }).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const panelRect = node.closest(".settings-panel").getBoundingClientRect();
    const panel = node.closest(".settings-panel");
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, scrollTop: panel.scrollTop, panel: { x: panelRect.x, y: panelRect.y, right: panelRect.right, bottom: panelRect.bottom, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight } };
  });
  assert.ok(lastControl.x >= lastControl.panel.x && lastControl.right <= lastControl.panel.right + 1, `${width}x${height}: focused final audio control remains within Settings width`);
  assert.ok(lastControl.y >= lastControl.panel.y && lastControl.bottom <= lastControl.panel.bottom + 1, `${width}x${height}: keyboard focus scrolls final audio control into the Settings viewport`);
  const hasVerticalOverflow = measurements.panelScrollHeight > measurements.panelClientHeight;
  let observedScrollTop = lastControl.scrollTop;
  if (hasVerticalOverflow) {
    await settingsPanel.evaluate((node) => { node.scrollTop = 0; });
    const bounds = await settingsPanel.boundingBox();
    assert.ok(bounds, `${width}x${height}: overflowing Settings panel has measurable bounds`);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, Math.max(40, Math.round(bounds.height / 2)));
    await page.waitForFunction(() => (document.querySelector(".settings-panel")?.scrollTop ?? 0) > 0);
    observedScrollTop = await settingsPanel.evaluate((node) => node.scrollTop);
    assert.ok(observedScrollTop > 0, `${width}x${height}: wheel input should move genuinely overflowing Settings content`);
  }
  return { width, height, panelWidth: Math.round(panel.width), panelHeight: Math.round(panel.height), overflowY: measurements.overflowY, contentOverflowsVertically: hasVerticalOverflow, observedScrollTop, documentWidth: measurements.documentWidth };
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: /Start local game/ });
  await activateByKeyboard(start, "Start local game");
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  // Setup has several meaningful choices; enter the real local audited-board
  // match, then exercise the interaction-heavy gameplay controls by keyboard.
  await completeSetup();

  const { menu, settings } = await openSettings();
  const preferenceCases = [
    { label: "Larger text", key: "abominations-large-text", before: false, after: true, className: "large-text", classAfter: true },
    { label: "Show board labels", key: "abominations-board-labels", before: true, after: false, className: "board-labels-hidden", classAfter: true },
    { label: "Reduce motion", key: "abominations-reduced-motion", before: false, after: true, className: "manual-reduced-motion", classAfter: true },
    { label: "Confirm leave, concede, or disappear", key: "abominations-confirm-irreversible", before: true, after: false },
    { label: "Mute all feedback", key: "abominations-audio-muted", before: false, after: true },
  ];
  for (const preference of preferenceCases) {
    const checkbox = page.getByRole("checkbox", { name: preference.label });
    assert.equal(await checkbox.isChecked(), preference.before, `${preference.label} starts at its documented default when no preference is stored`);
    await tabTo(checkbox, `${preference.label} preference`);
    await page.keyboard.press("Space");
    assert.equal(await checkbox.isChecked(), preference.after, `${preference.label} toggles by keyboard`);
    await page.waitForFunction(({ key, value }) => localStorage.getItem(key) === value, { key: preference.key, value: preference.after ? "1" : "0" });
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), preference.key), preference.after ? "1" : "0", `${preference.label} persists its new value`);
    if (preference.className) {
      assert.equal(await page.locator(".game-screen").evaluate((node, className) => node.classList.contains(className), preference.className), preference.classAfter, `${preference.label} updates its game-screen class`);
    }
  }

  const sliderCases = [
    { label: "Master", key: "abominations-master-volume", defaultValue: 1, direction: "ArrowLeft", expectedValue: 0.95 },
    { label: "Effects", key: "abominations-effects-volume", defaultValue: 0.7, direction: "ArrowRight", expectedValue: 0.75 },
    { label: "Music", key: "abominations-music-volume", defaultValue: 0, direction: "ArrowRight", expectedValue: 0.05 },
  ];
  for (const sliderCase of sliderCases) {
    const slider = page.getByRole("slider", { name: sliderCase.label });
    assert.equal(Number(await slider.inputValue()), sliderCase.defaultValue, `the ${sliderCase.label} slider uses its configured default when no preference is stored`);
    await tabTo(slider, `${sliderCase.label} audio level`);
    await page.keyboard.press(sliderCase.direction);
    await page.waitForFunction(({ key, value }) => localStorage.getItem(key) === String(value), { key: sliderCase.key, value: sliderCase.expectedValue });
    assert.equal(Number(await slider.inputValue()), sliderCase.expectedValue, `the ${sliderCase.label} slider responds to keyboard arrows`);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), sliderCase.key), String(sliderCase.expectedValue), `the ${sliderCase.label} slider persists its keyboard-adjusted value`);
  }

  const settingsViewports = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 768, height: 900 }, { width: 320, height: 740 }]) {
    settingsViewports.push(await auditSettingsBounds(viewport));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Escape");
  await page.locator(".settings-panel").waitFor({ state: "detached" });
  await page.waitForTimeout(80);
  const firstCloseFocus = await page.evaluate(() => {
    const opener = document.querySelector(".hud-menu .settings-action");
    const active = document.activeElement;
    return { restored: opener === active, activeTag: active?.tagName, activeText: active?.textContent?.trim(), openerConnected: opener?.isConnected, menuOpen: document.querySelector(".hud-menu")?.open };
  });
  assert.equal(firstCloseFocus.restored, true, `closing Settings restores focus to its opener: ${JSON.stringify(firstCloseFocus)}`);
  assert.equal(await settings.evaluate((node) => node === document.activeElement), true, "the restored Settings opener is the original button");
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".hud-menu")?.open);

  // A reload proves these controls are initialized from saved preferences, not
  // merely updating the current React state and localStorage in one session.
  await page.reload({ waitUntil: "domcontentloaded" });
  const startAgain = page.getByRole("button", { name: /Start local game/ });
  await activateByKeyboard(startAgain, "Start local game after saved-settings reload");
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  await completeSetup();
  await openSettings();
  for (const preference of preferenceCases) {
    assert.equal(await page.getByRole("checkbox", { name: preference.label }).isChecked(), preference.after, `${preference.label} restores from storage after reload`);
    if (preference.className) {
      assert.equal(await page.locator(".game-screen").evaluate((node, className) => node.classList.contains(className), preference.className), preference.classAfter, `${preference.label} class restores after reload`);
    }
  }
  for (const sliderCase of sliderCases) {
    assert.equal(Number(await page.getByRole("slider", { name: sliderCase.label }).inputValue()), sliderCase.expectedValue, `${sliderCase.label} restores from storage after reload`);
  }
  const settingsButtonAfterReload = page.locator(".hud-menu .settings-action");
  await page.keyboard.press("Escape");
  await page.locator(".settings-panel").waitFor({ state: "detached" });
  await page.waitForTimeout(80);
  assert.equal(await settingsButtonAfterReload.evaluate((node) => node === document.activeElement), true, "closing Settings after reload restores focus to its opener");
  const menuAfterReload = page.locator(".hud-menu > summary");
  await menuAfterReload.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".hud-menu")?.open);

  const recordToggle = page.getByRole("button", { name: /^Open .* health \d+, infamy \d+$/ }).first();
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
  const confirm = page.getByRole("button", { name: /^Confirm (?:unit )?move$/ });
  await confirm.waitFor({ state: "visible" });
  await activateByKeyboard(confirm, "Confirm move or unit move");
  await page.waitForFunction(() => {
    const button = document.querySelector(".action-dock > button");
    return button && button.textContent?.trim() !== "Confirm move" && !button.disabled;
  });
  const actionLabel = await page.locator(".action-dock > button").innerText();
  assert.match(actionLabel, /Hold|Next piece|Continue to Fight|End movement/i);
  assert.deepEqual(errors, [], "keyboard interactions should not produce runtime errors");
  console.log(JSON.stringify({ ok: true, viewport: "1280x720", settings: { checkboxes: preferenceCases.map(({ label }) => label), sliders: sliderCases.map(({ label }) => label), persistedAfterReload: true, bounds: settingsViewports }, keyboard: ["start local game", "menu and settings", "all preference checkboxes", "all audio sliders", "record tab navigation", "minimap pan", "select and confirm move"], nextAction: actionLabel.trim() }));
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
