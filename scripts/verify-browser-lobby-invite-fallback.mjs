import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a lobby invite verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const url = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

function startServer({ command, args, serverCwd, env, label }) {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = async (check) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
      try { if (await check()) return; } catch { /* Wait for the local service. */ }
      await wait(100);
    }
    throw new Error(`${label} did not become ready.\n${output}`);
  };
  return { child, ready };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    wait(2000).then(() => server.child.kill("SIGKILL")),
  ]);
}

let webServer;
let apiServer;
let browser;
const runtimeErrors = [];

try {
  const evidenceDir = join(cwd, "output", "ui-review");
  await mkdir(evidenceDir, { recursive: true });

  webServer = startServer({
    command: process.execPath,
    args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    serverCwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    label: "Vite",
  });
  await webServer.ready(async () => (await fetch(url)).ok);

  apiServer = startServer({
    command: process.execPath,
    args: ["--import", "tsx/esm", "src/server.ts"],
    serverCwd: join(cwd, "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
    label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  desktop.on("pageerror", (error) => runtimeErrors.push({ page: "player", message: error.message }));
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.locator("details.home-online > summary").focus();
  await desktop.keyboard.press("Enter");
  await desktop.getByLabel("Display name").fill("Invite player");
  await desktop.getByLabel("Room privacy").selectOption("public");
  await desktop.getByRole("button", { name: "Create", exact: true }).click();
  await desktop.locator("main.game-screen").waitFor({ state: "visible" });
  const playerMenu = desktop.locator(".hud-menu");
  const playerMenuSummary = playerMenu.locator(":scope > summary");
  await playerMenuSummary.focus();
  await desktop.keyboard.press("Enter");
  assert.equal(await playerMenu.evaluate((menu) => menu.open), true, "keyboard should open the game menu");
  const roomStatus = await desktop.locator(".room-hud-menu-status").innerText();
  const roomCode = roomStatus.split(" · ")[0].trim();
  assert.ok(roomCode, "created room should expose an invite code");

  await desktop.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard permission denied"); } },
    });
  });
  await desktop.keyboard.press("Tab");
  assert.equal(await desktop.getByRole("button", { name: "Copy invite link", exact: true }).evaluate((button) => button === document.activeElement), true, "keyboard should reach Copy invite link");
  await desktop.keyboard.press("Enter");
  const playerStatus = desktop.getByRole("status").filter({ hasText: "Clipboard access failed" });
  await playerStatus.waitFor({ state: "visible" });
  const playerFallback = desktop.getByRole("textbox", { name: "Invite link to select and copy" });
  await playerFallback.waitFor({ state: "visible" });
  const expectedInvite = new URL(url);
  expectedInvite.search = `?room=${encodeURIComponent(roomCode)}`;
  assert.equal(await playerFallback.inputValue(), expectedInvite.toString(), "player fallback should expose the current room URL");
  assert.equal(await playerFallback.getAttribute("readonly"), "", "fallback should be selectable without permitting edits");
  assert.match(await playerStatus.innerText(), /select the invite link/i, "status should explain the manual copy path");

  await desktop.getByRole("button", { name: "Copy invite link", exact: true }).focus();
  await desktop.keyboard.press("Tab");
  const keyboardState = await desktop.evaluate(() => {
    const input = document.querySelector('input[aria-label="Invite link to select and copy"]');
    const header = document.querySelector("main.game-screen > header");
    const setup = document.querySelector("main.game-screen > .setup-panel");
    const rect = input?.getBoundingClientRect();
    return {
      focused: document.activeElement === input,
      selected: input instanceof HTMLInputElement && input.selectionStart === 0 && input.selectionEnd === input.value.length,
      describedBy: input?.getAttribute("aria-describedby"),
      describedStatusRole: input?.getAttribute("aria-describedby") ? document.getElementById(input.getAttribute("aria-describedby"))?.getAttribute("role") : null,
      headerZIndex: header ? getComputedStyle(header).zIndex : null,
      setupZIndex: setup ? getComputedStyle(setup).zIndex : null,
      inputReceivesPointer: Boolean(rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input),
    };
  });
  assert.equal(keyboardState.focused, true, "keyboard Tab should reach the fallback after Copy invite link");
  assert.equal(keyboardState.selected, true, "focusing the fallback should select the whole URL");
  assert.equal(keyboardState.describedStatusRole, "status", "fallback should be associated with the status region");
  assert.ok(Number(keyboardState.headerZIndex) > Number(keyboardState.setupZIndex), "open game menu should stack above the setup sheet");
  assert.equal(keyboardState.inputReceivesPointer, true, "fallback should receive pointer input instead of being covered by the setup sheet");
  await desktop.screenshot({ path: join(evidenceDir, "lobby-invite-fallback-player-2026-09-29.png") });

  await desktop.evaluate(() => {
    window.__copiedInvite = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copiedInvite = value; } },
    });
  });
  await desktop.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await desktop.getByRole("status").filter({ hasText: "Invite link copied" }).waitFor({ state: "visible" });
  assert.equal(await desktop.evaluate(() => window.__copiedInvite), expectedInvite.toString(), "successful clipboard path should write the same invite URL");
  await playerFallback.waitFor({ state: "detached" });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  phone.on("pageerror", (error) => runtimeErrors.push({ page: "spectator", message: error.message }));
  await phone.goto(`${url}?room=${encodeURIComponent(roomCode)}`, { waitUntil: "domcontentloaded" });
  await phone.getByLabel("Display name").fill("Invite spectator");
  await phone.getByLabel("Room code").fill(roomCode);
  await phone.getByRole("button", { name: "Spectate", exact: true }).tap();
  try {
    await phone.locator("main.game-screen").waitFor({ state: "visible" });
  } catch {
    throw new Error(`Spectator did not enter the online game: ${JSON.stringify({ url: phone.url(), body: await phone.locator("body").innerText(), runtimeErrors })}`);
  }
  await phone.locator(".hud-menu > summary").tap();
  assert.match(await phone.locator(".lobby").innerText(), /spectating/i, "second lobby participant should be a spectator");
  await phone.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard permission denied"); } },
    });
  });
  await phone.getByRole("button", { name: "Copy invite link", exact: true }).tap();
  await phone.getByRole("status").filter({ hasText: "Clipboard access failed" }).waitFor({ state: "visible" });
  const spectatorFallback = phone.getByRole("textbox", { name: "Invite link to select and copy" });
  await spectatorFallback.waitFor({ state: "visible" });
  assert.equal(await spectatorFallback.inputValue(), expectedInvite.toString(), "spectator fallback should expose the same room URL");
  const bounds = await spectatorFallback.boundingBox();
  const phoneLayout = await phone.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    headerZIndex: getComputedStyle(document.querySelector("main.game-screen > header")).zIndex,
    setupZIndex: getComputedStyle(document.querySelector("main.game-screen > .setup-panel")).zIndex,
    fallbackReceivesPointer: (() => {
      const input = document.querySelector('input[aria-label="Invite link to select and copy"]');
      if (!input) return false;
      const rect = input.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
    })(),
  }));
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height >= 44, `phone fallback should fit the viewport and meet the 44px target: ${JSON.stringify(bounds)}`);
  assert.ok(phoneLayout.documentWidth <= phoneLayout.width && phoneLayout.bodyWidth <= phoneLayout.width, `phone lobby should not overflow horizontally: ${JSON.stringify(phoneLayout)}`);
  assert.ok(Number(phoneLayout.headerZIndex) > Number(phoneLayout.setupZIndex), "phone game menu should stack above the setup sheet");
  assert.equal(phoneLayout.fallbackReceivesPointer, true, "phone fallback should not be covered by the setup sheet");
  await spectatorFallback.tap();
  const touchState = await spectatorFallback.evaluate((input) => ({
    focused: document.activeElement === input,
    selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
  }));
  assert.deepEqual(touchState, { focused: true, selected: true }, "touching the fallback should focus it and select the complete URL");
  await phone.screenshot({ path: join(evidenceDir, "lobby-invite-fallback-spectator-phone-2026-09-29.png") });

  assert.deepEqual(runtimeErrors, [], `browser route should have no runtime errors: ${JSON.stringify(runtimeErrors)}`);
  const evidence = {
    generatedAt: new Date().toISOString(),
    route: "Vite app route with local in-memory API",
    roomCode,
    player: {
      role: "player",
      viewport: "1280x720",
      clipboard: "stubbed writeText rejection",
      fallbackUrlCorrect: true,
      readOnly: true,
      keyboardTabReachable: keyboardState.focused,
      focusSelectsWholeUrl: keyboardState.selected,
      statusAssociatedWithField: keyboardState.describedStatusRole === "status" && Boolean(keyboardState.describedBy),
      menuStacksAboveSetup: Number(keyboardState.headerZIndex) > Number(keyboardState.setupZIndex),
      fallbackReceivesPointer: keyboardState.inputReceivesPointer,
      successfulClipboardPathRetained: true,
    },
    spectator: {
      role: "spectator",
      viewport: "390x844 touch",
      clipboard: "stubbed writeText rejection",
      fallbackUrlCorrect: true,
      tapFocusesAndSelectsWholeUrl: touchState.focused && touchState.selected,
      fallbackBounds: bounds,
      menuStacksAboveSetup: Number(phoneLayout.headerZIndex) > Number(phoneLayout.setupZIndex),
      fallbackReceivesPointer: phoneLayout.fallbackReceivesPointer,
      documentWidth: phoneLayout.documentWidth,
      bodyWidth: phoneLayout.bodyWidth,
      noHorizontalOverflow: phoneLayout.documentWidth <= phoneLayout.width && phoneLayout.bodyWidth <= phoneLayout.width,
    },
    runtimeErrors,
    screenshots: ["lobby-invite-fallback-player-2026-09-29.png", "lobby-invite-fallback-spectator-phone-2026-09-29.png"],
  };
  await writeFile(join(evidenceDir, "lobby-invite-fallback-2026-09-29.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, evidence }, null, 2)}\n`);
} finally {
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
