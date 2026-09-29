import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const rgbChannels = (value) => {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(match, `Expected a computed RGB color, received ${value}`);
  return match.slice(1, 4).map(Number);
};
const relativeLuminance = (color) => rgbChannels(color)
  .map((channel) => channel / 255)
  .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
const reservePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a test port."));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const webPort = Number(process.env.BROWSER_GAME_MENU_WEB_PORT ?? await reservePort());
const apiPort = Number(process.env.BROWSER_GAME_MENU_API_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${webPort}/`;
const apiUrl = process.env.BROWSER_API_URL ?? `http://127.0.0.1:${apiPort}`;
const ownWeb = !process.env.BROWSER_TEST_URL;
const ownApi = !process.env.BROWSER_API_URL;
const startServer = ({ args, cwd, env, name, ready }) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const waitReady = async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited before ready.\n${output}`);
      try { if (await ready()) return; } catch { /* startup in progress */ }
      await wait(100);
    }
    throw new Error(`${name} did not become ready.\n${output}`);
  };
  return { child, waitReady };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.child.once("exit", resolve)), wait(2500)]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
};

let webServer;
let apiServer;
let browser;
let contexts = [];
const requests = { local: [], solo: [], firstPlayer: [], secondPlayer: [], spectator: [], pollSpectator: [], reconnectSpectator: [], preferenceDisabledViewer: [] };
const socketFrames = {};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  route: "production main app route served by Vite; API is an isolated local in-memory service",
  cases: {},
  limits: [
    "This verifies the development browser route and a local memory API, not a deployed build or durable database.",
    "Role coverage is one waiting player and one spectator in a public two-player room; no signed-in account state is exercised.",
    "New local and New solo are checked from their corresponding local/solo modes; clicking those actions intentionally resets setup, so they are not selected while an online match is under inspection.",
    "Menu click counts count DOM activations; ready and leave counts count the corresponding HTTP requests. The test does not instrument private React callback invocation directly.",
  ],
};

const attachRequests = (page, key) => page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.endsWith("/ready") || url.pathname.endsWith("/disconnect") || url.pathname.endsWith("/actions") || url.pathname.endsWith("/reconnect")) {
    requests[key].push({ method: request.method(), path: url.pathname });
  }
});
const openPage = async (key, viewport = { width: 1280, height: 800 }, { touch = false } = {}) => {
  const context = await browser.newContext({ viewport, acceptDownloads: false, hasTouch: touch, isMobile: touch });
  contexts.push(context);
  await context.addInitScript(() => localStorage.setItem("abominations-onboarding-seen", "1"));
  const page = await context.newPage();
  socketFrames[key] = [];
  page.on("websocket", (socket) => socket.on("framereceived", (frame) => {
    socketFrames[key].push(typeof frame.payload === "string" ? frame.payload : Buffer.from(frame.payload).toString("utf8"));
  }));
  attachRequests(page, key);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
};
const waitFor = async (page, predicate, label) => {
  await page.waitForFunction(predicate, null, { timeout: 30000 }).catch(async (error) => {
    const details = await page.evaluate(() => ({ url: location.href, phase: document.querySelector(".action-card h2")?.textContent?.trim(), setup: document.querySelector(".setup-panel")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()) }));
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(details)}; ${error.message}`);
  });
};
const completeSetup = async (page) => {
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await page.locator(".setup-panel").count())) break;
    const list = page.locator(".lair-selection-prompt details");
    if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
    const choice = page.locator(".setup-panel .setup-options button:visible:not(:disabled)").first();
    if (!(await choice.count())) throw new Error("Setup has no enabled option for the active local player.");
    await choice.click();
    await page.waitForTimeout(100);
  }
  await page.locator(".setup-panel").waitFor({ state: "detached", timeout: 30000 });
  await waitFor(page, () => Boolean(document.querySelector(".action-card h2")?.textContent?.includes("Move")), "Move phase after setup");
};
const beginRoom = async (page, name) => {
  await page.locator(".home-online > summary").click();
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByLabel("Room privacy").selectOption("public");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.locator(".game-screen.online-game").waitFor({ state: "visible" });
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  const code = (await page.locator(".lobby strong").innerText()).trim();
  return code;
};
const enterRoom = async (page, name, code, action, { expectSetup = true } = {}) => {
  await page.locator(".home-online > summary").click();
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByRole("textbox", { name: "Room code" }).fill(code);
  await page.getByRole("button", { name: action, exact: true }).click();
  await page.locator(".game-screen.online-game").waitFor({ state: "visible" });
  if (expectSetup) await page.locator(".setup-panel").waitFor({ state: "visible" });
};
const completeOnlineSetup = async (first, second) => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    for (const page of [first, second]) {
      const list = page.locator(".lair-selection-prompt details");
      if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
    }
    const firstReady = await first.locator(".setup-panel").count() ? await first.locator(".setup-panel .setup-options button:visible:not(:disabled)").count() : 0;
    const secondReady = await second.locator(".setup-panel").count() ? await second.locator(".setup-panel .setup-options button:visible:not(:disabled)").count() : 0;
    if (!firstReady && !secondReady) break;
    const activePage = firstReady ? first : secondReady ? second : undefined;
    if (activePage) {
      const list = activePage.locator(".lair-selection-prompt details");
      if (await list.count() && !(await list.evaluate((node) => node.open))) await list.locator("summary").click();
      const choice = activePage.locator(".setup-panel .setup-options button:visible:not(:disabled)").first();
      await choice.click();
      await pageWait(first, second, 100);
    } else await pageWait(first, second, 150);
  }
  const completion = await Promise.all([first, second].map((page) => page.evaluate(() => ({
    setup: document.querySelector(".setup-panel")?.textContent?.trim(),
    phase: document.querySelector(".setup-panel h2")?.textContent?.trim(),
    enabledChoices: [...document.querySelectorAll(".setup-panel .setup-options button:enabled")].map((button) => button.textContent?.trim()),
    errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()),
    lobby: document.querySelector(".lobby")?.textContent?.trim(),
  }))));
  if (completion.some((state) => state.setup)) throw new Error(`Online setup did not finish: ${JSON.stringify(completion)}`);
  await first.locator(".setup-panel").waitFor({ state: "detached", timeout: 30000 });
  await second.locator(".setup-panel").waitFor({ state: "detached", timeout: 30000 });
  await waitFor(first, () => Boolean(document.querySelector(".hud-menu")), "first player's in-game menu");
};
const pageWait = async (first, second, ms) => { await Promise.all([first.waitForTimeout(ms), second.waitForTimeout(ms)]); };
const snapshot = async (page, code) => {
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.ok(session?.token, "online page has a room token");
  const response = await fetch(`${apiUrl}/rooms/${code}/state?afterVersion=0`, { headers: { "x-room-token": session.token } });
  assert.equal(response.status, 200, "authoritative room snapshot is readable by its participant");
  const room = await response.json();
  return { status: room.status, version: room.version, phase: room.state.phase, setupPhase: room.state.setupState?.phase ?? null, gameEventCount: room.state.eventLog?.length ?? 0, gameEventIds: (room.state.eventLog ?? []).map((event) => event.id), roomEventCount: room.events?.length ?? 0 };
};
const installMenuClickCounter = async (page) => page.evaluate(() => {
  window.__gameMenuClicks = {};
  document.querySelector(".hud-menu-items")?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (button) window.__gameMenuClicks[button.textContent.trim()] = (window.__gameMenuClicks[button.textContent.trim()] ?? 0) + 1;
  }, true);
});
const getMenuClicks = async (page, label) => page.evaluate((name) => window.__gameMenuClicks?.[name] ?? 0, label);
const waitForRoomUpdateFrame = async (key, afterFrameCount, predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const update = socketFrames[key].slice(afterFrameCount).map((payload) => {
      try { return JSON.parse(payload); } catch { return undefined; }
    }).find((message) => message?.type === "room.updated" && predicate(message.room));
    if (update) return update;
    await wait(50);
  }
  throw new Error(`No matching room.updated frame reached ${key} after the trigger.`);
};

try {
  if (ownWeb) {
    webServer = startServer({
      args: [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort)],
      cwd: join(process.cwd(), "apps/web"),
      env: { ...process.env, VITE_API_URL: apiUrl },
      name: "Vite",
      ready: async () => (await fetch(url)).ok,
    });
    await webServer.waitReady();
  }
  if (ownApi) {
    apiServer = startServer({
      args: ["--import", "tsx/esm", "src/server.ts"],
      cwd: join(process.cwd(), "apps/api"),
      env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin, ALLOW_DEVELOPMENT_FIXTURE: "true", DEVELOPMENT_API_RATE_LIMIT: "2000" },
      name: "memory API",
      ready: async () => (await fetch(`${apiUrl}/health`)).ok,
    });
    await apiServer.waitReady();
  }
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const local = await openPage("local");
  await local.getByRole("button", { name: /Start local game/ }).click();
  await local.locator(".setup-panel").waitFor({ state: "visible" });
  await completeSetup(local);
  const localMenu = local.locator(".hud-menu");
  const localMenuSummary = local.locator(".hud-menu > summary");
  const localNew = local.locator(".hud-menu-items .new-game-action");
  await localMenuSummary.focus();
  await local.keyboard.press("Enter");
  assert.equal(await localMenu.evaluate((node) => node.open), true, "local Menu opens by keyboard");
  assert.equal(await localNew.innerText(), "New local game");
  assert.equal(await local.locator(".hud-menu-items").getByRole("button", { name: "Ready", exact: true }).count(), 0);
  assert.equal(await local.locator(".hud-menu-items .leave-room-action").count(), 0);
  const localBefore = await local.evaluate(() => ({ phase: document.querySelector(".action-card h2")?.textContent?.trim(), board: document.querySelector(".game-screen")?.dataset.boardContentHash, eventRows: document.querySelectorAll(".event-log li").length }));
  const account = local.locator(".hud-menu .account-panel");
  const accountSummary = local.locator(".hud-menu .account-panel > summary");
  await accountSummary.focus();
  await local.keyboard.press("Enter");
  assert.equal(await account.evaluate((node) => node.open), true, "nested AccountPanel opens from the game Menu");
  await local.keyboard.press("Escape");
  assert.equal(await account.evaluate((node) => node.open), false, "Escape closes the nested AccountPanel first");
  assert.equal(await localMenu.evaluate((node) => node.open), true, "nested Escape leaves the parent Menu open");
  assert.equal(await accountSummary.evaluate((node) => node === document.activeElement), true, "nested Escape returns focus to AccountPanel summary");
  await local.keyboard.press("Escape");
  assert.equal(await localMenu.evaluate((node) => node.open), false, "the next Escape closes the parent Menu");
  assert.equal(await localMenuSummary.evaluate((node) => node === document.activeElement), true, "parent Escape returns focus to Menu summary");
  const localAfter = await local.evaluate(() => ({ phase: document.querySelector(".action-card h2")?.textContent?.trim(), board: document.querySelector(".game-screen")?.dataset.boardContentHash, eventRows: document.querySelectorAll(".event-log li").length }));
  assert.deepEqual(localAfter, localBefore, "opening and closing Menu and AccountPanel leaves the active local match presentation unchanged");
  report.cases.local = { visibility: { newLocalGame: true, ready: false, leaveRoom: false }, nestedAccountEscapeOrder: true, focusReturnedToAccountThenMenu: true, activeMatchPresentationPreserved: true, gamePhase: localBefore.phase };
  await installMenuClickCounter(local);
  await localMenuSummary.click();
  await localNew.click();
  await local.locator(".setup-panel").waitFor({ state: "visible" });
  assert.equal(await getMenuClicks(local, "New local game"), 1, "New local game receives one click activation");
  assert.equal(await local.locator(".game-screen").evaluate((node) => node.classList.contains("online-game")), false, "New local game stays in local route");
  assert.equal(requests.local.length, 0, "New local game submits no online ready, leave, or game command");
  report.cases.local.newLocalAction = { activationCount: await getMenuClicks(local, "New local game"), result: "returns to local setup", trackedOnlineRequests: requests.local.length };

  const solo = await openPage("solo");
  await solo.getByRole("button", { name: /Play solo vs bots/ }).click();
  await solo.locator(".setup-panel").waitFor({ state: "visible" });
  await completeSetup(solo);
  const soloMenu = solo.locator(".hud-menu");
  const soloSummary = solo.locator(".hud-menu > summary");
  const soloNew = solo.locator(".hud-menu-items .new-game-action");
  await soloSummary.click();
  assert.equal(await soloNew.innerText(), "New solo game");
  assert.equal(await solo.locator(".hud-menu-items .leave-room-action").count(), 0);
  assert.equal(await solo.locator(".hud-menu-items").getByRole("button", { name: "Ready", exact: true }).count(), 0);
  await installMenuClickCounter(solo);
  await soloNew.click();
  await solo.locator(".setup-panel").waitFor({ state: "visible" });
  assert.equal(await getMenuClicks(solo, "New solo game"), 1, "New solo game receives one click activation");
  assert.equal(await soloNew.innerText(), "New solo game", "New solo game retains solo mode after restart");
  assert.equal(requests.solo.length, 0, "New solo game submits no online ready, leave, or game command");
  report.cases.solo = { visibility: { newSoloGame: true, ready: false, leaveRoom: false }, newSoloAction: { activationCount: await getMenuClicks(solo, "New solo game"), result: "returns to solo setup", trackedOnlineRequests: requests.solo.length } };

  const first = await openPage("firstPlayer");
  const code = await beginRoom(first, "Menu Audit Player");
  const second = await openPage("secondPlayer");
  await enterRoom(second, "Menu Audit Player Two", code, "Join");
  const spectator = await openPage("spectator");
  await enterRoom(spectator, "Menu Audit Viewer", code, "Spectate");
  await completeOnlineSetup(first, second);
  await waitFor(spectator, () => !document.querySelector(".setup-panel"), "spectator setup projection completion");

  const waitingPlayerBeforeOptions = await snapshot(second, code);
  assert.equal(waitingPlayerBeforeOptions.phase, "move", "the role-specific Concede check begins in a playable phase");
  assert.equal(waitingPlayerBeforeOptions.status, "waiting", "the role-specific Concede check runs while the room awaits Ready");
  const secondViewport = { width: 390, height: 844 };
  await second.setViewportSize(secondViewport);
  const waitingTurnPanelToggle = second.locator(".turn-hud-heading button");
  if (await waitingTurnPanelToggle.getAttribute("aria-expanded") !== "true") {
    await waitingTurnPanelToggle.focus();
    await second.keyboard.press("Enter");
  }
  await second.waitForFunction(() => {
    const body = document.querySelector("#turn-hud-body");
    return Boolean(body && !body.hidden);
  });
  const waitingActionStatus = (await second.locator("#action-dock-status").innerText()).trim();
  assert.match(waitingActionStatus, /Waiting for all players to press Ready/,
    "phone action dock explains that the room is still waiting for Ready");
  const waitingMatchOptions = second.locator("#turn-hud-body .action-card > details.hud-section").filter({ hasText: "Concede match" });
  const waitingMatchOptionsSummary = waitingMatchOptions.locator(":scope > summary");
  await waitingMatchOptionsSummary.scrollIntoViewIfNeeded();
  const waitingMatchOptionsBounds = await waitingMatchOptions.boundingBox();
  assert.ok(waitingMatchOptionsBounds && waitingMatchOptionsBounds.x >= 0
    && waitingMatchOptionsBounds.x + waitingMatchOptionsBounds.width <= secondViewport.width + 1
    && waitingMatchOptionsBounds.y >= 0 && waitingMatchOptionsBounds.y + waitingMatchOptionsBounds.height <= secondViewport.height + 1,
  `waiting-player Match options should fit the phone viewport: ${JSON.stringify(waitingMatchOptionsBounds)}`);
  assert.equal(await waitingMatchOptions.evaluate((node) => node.open), false, "Match options starts collapsed for the waiting player");
  await waitingMatchOptionsSummary.focus();
  await second.keyboard.press("Enter");
  await second.waitForFunction(() => document.querySelector("#turn-hud-body .action-card > details.hud-section")?.open === true);
  assert.equal(await waitingMatchOptionsSummary.evaluate((node) => node === document.activeElement), true,
    "keyboard opening Match options keeps focus on its summary");
  const waitingConcedeButton = waitingMatchOptions.getByRole("button", { name: "Concede match", exact: true });
  assert.equal(await waitingConcedeButton.isVisible(), true, "waiting player can inspect the Concede option");
  assert.equal(await waitingConcedeButton.isDisabled(), true, "waiting player cannot submit Concede out of turn");
  const waitingConcedeStyle = await waitingConcedeButton.evaluate((node) => {
    const style = getComputedStyle(node);
    return { foreground: style.color, background: style.backgroundColor, opacity: style.opacity };
  });
  const waitingConcedeContrast = contrastRatio(waitingConcedeStyle.foreground, waitingConcedeStyle.background);
  assert.equal(waitingConcedeStyle.opacity, "1", "disabled Concede text is not faded into the panel background");
  assert.ok(waitingConcedeContrast >= 4.5,
    `disabled Concede text retains readable contrast: ${waitingConcedeContrast.toFixed(2)}:1`);
  const waitingActionsBefore = requests.secondPlayer.filter((request) => request.path.endsWith("/actions")).length;
  const waitingPlayerAfterOptions = await snapshot(second, code);
  assert.deepEqual(waitingPlayerAfterOptions, waitingPlayerBeforeOptions,
    "opening the waiting player's Match options leaves the authoritative room unchanged");
  assert.equal(requests.secondPlayer.filter((request) => request.path.endsWith("/actions")).length, waitingActionsBefore,
    "the disabled Concede control submits no game action");
  await second.screenshot({ path: join(process.cwd(), "output/ui-review/game-menu-waiting-concede-2026-09-29.png") });
  report.cases.waitingPlayerConcedeDisclosure = {
    role: "online player waiting for all participants to press Ready",
    viewport: "390x844",
    phase: waitingPlayerBeforeOptions.phase,
    actionStatus: waitingActionStatus,
    disclosureStartsCollapsed: true,
    keyboardOpensAndRetainsFocus: true,
    concedeVisibleButDisabled: true,
    disabledButtonStyle: waitingConcedeStyle,
    disabledTextContrastRatio: Number(waitingConcedeContrast.toFixed(2)),
    disclosureBounds: waitingMatchOptionsBounds,
    roomSnapshotUnchanged: true,
    gameActionsSubmitted: requests.secondPlayer.filter((request) => request.path.endsWith("/actions")).length - waitingActionsBefore,
    screenshot: "game-menu-waiting-concede-2026-09-29.png",
  };

  const playerMenu = first.locator(".hud-menu");
  const playerSummary = first.locator(".hud-menu > summary");
  const menuItems = first.locator(".hud-menu-items");
  await playerSummary.click();
  const ready = menuItems.getByRole("button", { name: "Ready", exact: true });
  const playerLeave = first.locator(".hud-menu-items .leave-room-action");
  assert.equal(await first.locator(".hud-menu-items .new-game-action").innerText(), "New local game", "online non-solo player retains New local game action");
  assert.equal(await ready.count(), 1, "waiting online player sees Ready");
  assert.equal(await playerLeave.count(), 1, "waiting online player sees Leave room");
  assert.equal(await ready.isDisabled(), false, "setup-complete waiting player can toggle Ready");
  const beforeInspection = await snapshot(first, code);
  const playerAccount = first.locator(".hud-menu .account-panel");
  const playerAccountSummary = first.locator(".hud-menu .account-panel > summary");
  await playerAccountSummary.click();
  assert.equal(await playerAccount.evaluate((node) => node.open), true, "online player can open nested AccountPanel");
  await playerAccountSummary.press("Escape");
  assert.equal(await playerAccount.evaluate((node) => node.open), false, "online AccountPanel closes on Escape");
  assert.equal(await playerMenu.evaluate((node) => node.open), true, "online AccountPanel Escape preserves parent Menu");
  assert.equal(await playerAccountSummary.evaluate((node) => node === document.activeElement), true, "online AccountPanel Escape restores summary focus");
  await playerAccountSummary.press("Escape");
  assert.equal(await playerMenu.evaluate((node) => node.open), false, "online parent Menu closes on subsequent Escape");
  assert.equal(await playerSummary.evaluate((node) => node === document.activeElement), true, "online parent Escape restores summary focus");
  const afterInspection = await snapshot(first, code);
  assert.deepEqual(afterInspection, beforeInspection, "menu/account inspection does not change authoritative room or game state");

  await first.locator(".hud-menu-items").waitFor({ state: "attached" });
  await playerSummary.click();
  await ready.click();
  await waitFor(first, () => [...document.querySelectorAll(".hud-menu-items button")].some((button) => button.textContent.trim() === "Not ready"), "Ready to become Not ready");
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/ready")).length, 1, "Ready issues exactly one /ready request");
  const afterReady = await snapshot(first, code);
  assert.equal(afterReady.phase, beforeInspection.phase, "Ready leaves active game phase unchanged");
  assert.deepEqual(afterReady.gameEventIds, beforeInspection.gameEventIds, "Ready leaves game event history unchanged");
  assert.equal(afterReady.status, "waiting", "one ready seat does not start the room while the other remains unready");
  const notReady = first.locator(".hud-menu-items").getByRole("button", { name: "Not ready", exact: true });
  await notReady.click();
  await waitFor(first, () => [...document.querySelectorAll(".hud-menu-items button")].some((button) => button.textContent.trim() === "Ready"), "Not ready to become Ready");
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/ready")).length, 2, "Not ready issues exactly one additional /ready request");
  const afterNotReady = await snapshot(first, code);
  assert.equal(afterNotReady.phase, beforeInspection.phase, "Not ready leaves active game phase unchanged");
  assert.deepEqual(afterNotReady.gameEventIds, beforeInspection.gameEventIds, "Not ready leaves game event history unchanged");

  const spectatorMenu = spectator.locator(".hud-menu");
  const spectatorSummary = spectator.locator(".hud-menu > summary");
  await spectatorSummary.click();
  assert.equal(await spectator.locator(".hud-menu-items .new-game-action").innerText(), "New local game", "online spectator also sees New local game");
  assert.equal(await spectator.locator(".hud-menu-items").getByRole("button", { name: "Ready", exact: true }).count(), 0, "spectator never sees player Ready action");
  assert.equal(await spectator.locator(".hud-menu-items .leave-room-action").count(), 1, "spectator sees Leave room");
  const spectatorSnapshot = await snapshot(spectator, code);
  const spectatorLeave = spectator.locator(".hud-menu-items .leave-room-action");
  let leaveDialogMessage = "";
  let releaseDisconnectRoute;
  let disconnectRequestObserved;
  const disconnectRequestGate = new Promise((resolve) => { disconnectRequestObserved = resolve; });
  await spectator.route(`**/rooms/${code}/disconnect`, async (route) => {
    disconnectRequestObserved();
    await new Promise((resolve) => { releaseDisconnectRoute = resolve; });
    await route.continue();
  });
  const dialogPromise = new Promise((resolve) => spectator.once("dialog", async (dialog) => {
    leaveDialogMessage = dialog.message();
    await dialog.accept();
    resolve();
  }));
  await spectatorLeave.click();
  await dialogPromise;
  await disconnectRequestGate;
  assert.match(leaveDialogMessage, /Leave this active match/);
  const spectatorFrameCountBeforeReady = socketFrames.spectator.length;
  const secondReadyResponse = second.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/ready"));
  await second.locator(".hud-menu > summary").click();
  await second.locator(".hud-menu-items").getByRole("button", { name: "Ready", exact: true }).click();
  assert.equal((await secondReadyResponse).ok(), true, "the second player's ready update succeeds");
  const roomUpdateDuringLeave = await waitForRoomUpdateFrame("spectator", spectatorFrameCountBeforeReady,
    (updatedRoom) => updatedRoom?.participants?.some((entry) => entry.role === "player" && entry.playerIndex === 1 && entry.ready));
  assert.equal(roomUpdateDuringLeave.room.version, spectatorSnapshot.version, "readiness broadcasts a fresh same-version room projection");
  await spectator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  releaseDisconnectRoute();
  await spectator.locator(".home-screen").waitFor({ state: "visible" });
  assert.equal(requests.spectator.filter((request) => request.path.endsWith("/disconnect")).length, 1, "Leave room issues exactly one disconnect request");
  const postLeave = await snapshot(first, code);
  assert.equal(postLeave.phase, spectatorSnapshot.phase, "spectator leave leaves game phase unchanged");
  assert.deepEqual(postLeave.gameEventIds, spectatorSnapshot.gameEventIds, "spectator leave leaves game event history unchanged");
  assert.equal(postLeave.status, spectatorSnapshot.status, "spectator leave does not change the room match status");
  report.cases.onlineWaitingPlayer = {
    visibility: { newLocalGame: true, ready: true, leaveRoom: true, setupComplete: true },
    accountEscapeOrder: true,
    accountMenuInspectionPreservedAuthoritativeState: true,
    ready: { httpRequestCount: requests.firstPlayer.filter((request) => request.path.endsWith("/ready")).length, transitionedToNotReady: true, roomRemainedWaiting: afterReady.status === "waiting", gameEventsUnchangedAcrossToggles: true },
    notReady: { transitionedToReady: true, httpRequestCount: requests.firstPlayer.filter((request) => request.path.endsWith("/ready")).length, gameEventsUnchanged: true },
    inspectionSnapshot: beforeInspection,
  };
  report.cases.onlineSpectator = {
    visibility: { newLocalGame: true, ready: false, leaveRoom: true },
    leaveRoom: { httpRequestCount: requests.spectator.filter((request) => request.path.endsWith("/disconnect")).length, confirmationAccepted: true, returnedToHome: true, gamePhaseAndEventHistoryUnchanged: true, roomUpdatedWhileDisconnectDelayed: true, receivedNewReadinessSnapshot: true, observedRoomVersion: roomUpdateDuringLeave.room.version },
  };

  const pollSpectator = await openPage("pollSpectator");
  let routedSocketCloseObserved = false;
  pollSpectator.on("websocket", (socket) => socket.on("close", () => { routedSocketCloseObserved = true; }));
  await pollSpectator.locator(".home-online > summary").click();
  await pollSpectator.getByRole("textbox", { name: "Display name" }).fill("Poll Audit Viewer");
  await pollSpectator.getByRole("textbox", { name: "Room code" }).fill(code);
  await pollSpectator.getByRole("button", { name: "Spectate", exact: true }).click();
  await pollSpectator.locator(".game-screen.online-game").waitFor({ state: "visible" });
  let releasePendingPoll;
  let pendingPollObserved;
  const pendingPollGate = new Promise((resolve) => { pendingPollObserved = resolve; });
  await pollSpectator.route((requestUrl) => requestUrl.pathname === `/rooms/${code}/state` && requestUrl.searchParams.get("afterVersion") !== "0", async (route) => {
    pendingPollObserved();
    await new Promise((resolve) => { releasePendingPoll = resolve; });
    await route.continue();
  });
  await pollSpectator.routeWebSocket((socketUrl) => socketUrl.pathname === "/ws", async (route) => {
    const serverSocket = route.connectToServer();
    await serverSocket.close({ code: 1000, reason: "controlled reconnect poll audit" });
  });
  await pollSpectator.reload({ waitUntil: "domcontentloaded" });
  await pollSpectator.locator(".game-screen.online-game").waitFor({ state: "visible" });
  let pendingPollTimeout;
  try {
    await Promise.race([pendingPollGate, new Promise((_, reject) => {
      pendingPollTimeout = setTimeout(() => reject(new Error("The forced socket loss did not reach a stalled reconnect state poll.")), 15000);
    })]);
  } finally {
    clearTimeout(pendingPollTimeout);
  }
  const pollMenuSummary = pollSpectator.locator(".hud-menu > summary");
  assert.equal(routedSocketCloseObserved, true, "the controlled WebSocket close reaches the production page");
  await pollMenuSummary.click();
  const pollLeave = pollSpectator.locator(".hud-menu-items .leave-room-action");
  let pollLeaveConfirmed = false;
  const pollLeaveDialog = new Promise((resolve) => pollSpectator.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Leave this active match/);
    await dialog.accept();
    pollLeaveConfirmed = true;
    resolve();
  }));
  await pollLeave.click();
  await pollLeaveDialog;
  await pollSpectator.locator(".home-screen").waitFor({ state: "visible", timeout: 5000 });
  const delayedPollResponse = pollSpectator.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === `/rooms/${code}/state` && responseUrl.searchParams.get("afterVersion") !== "0";
  });
  releasePendingPoll();
  assert.equal((await delayedPollResponse).ok(), true, "the held state poll eventually returns successfully");
  await pollSpectator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterLatePoll = await pollSpectator.evaluate(() => ({ homeVisible: Boolean(document.querySelector(".home-screen") && getComputedStyle(document.querySelector(".home-screen")).display !== "none"), gameVisible: Boolean(document.querySelector(".game-screen") && getComputedStyle(document.querySelector(".game-screen")).display !== "none"), storedSession: localStorage.getItem("abominations-session"), lobbyText: document.querySelector(".lobby")?.textContent?.trim() }));
  assert.equal(afterLatePoll.homeVisible, true, `late poll response cannot restore the departed room: ${JSON.stringify(afterLatePoll)}`);
  assert.equal(requests.pollSpectator.filter((request) => request.path.endsWith("/reconnect")).length, 0, "Leave does not reconnect from a poll already in flight");
  report.cases.onlineSpectatorPendingPoll = {
    socketLossForced: true,
    productionPageCloseEventObserved: routedSocketCloseObserved,
    statePollHeldUntilAfterLeave: true,
    confirmedLeaveReturnedWithinFiveSeconds: pollLeaveConfirmed,
    lateStateResponseReceived: true,
    latePollResponseDidNotRestoreRoom: true,
    reconnectRequestsAfterLeave: requests.pollSpectator.filter((request) => request.path.endsWith("/reconnect")).length,
    disconnectRequests: requests.pollSpectator.filter((request) => request.path.endsWith("/disconnect")).length,
  };

  const reconnectSpectator = await openPage("reconnectSpectator");
  await reconnectSpectator.locator(".home-online > summary").click();
  await reconnectSpectator.getByRole("textbox", { name: "Display name" }).fill("Reconnect Audit Viewer");
  await reconnectSpectator.getByRole("textbox", { name: "Room code" }).fill(code);
  await reconnectSpectator.getByRole("button", { name: "Spectate", exact: true }).click();
  await reconnectSpectator.locator(".game-screen.online-game").waitFor({ state: "visible" });
  let releaseReconnectResponse;
  let reconnectCommitted;
  let reconnectResponseDelivered;
  let reconnectRequestBody;
  let socketLossDisconnectSettled;
  let forceReconnectSocketClose = true;
  const socketLossDisconnectGate = new Promise((resolve) => { socketLossDisconnectSettled = resolve; });
  const leaveDisconnectBodies = [];
  const reconnectCommittedGate = new Promise((resolve) => { reconnectCommitted = resolve; });
  const reconnectResponseDeliveredGate = new Promise((resolve) => { reconnectResponseDelivered = resolve; });
  const reconnectResponseReleased = new Promise((resolve) => { releaseReconnectResponse = resolve; });
  await reconnectSpectator.route((requestUrl) => requestUrl.pathname === `/rooms/${code}/reconnect`, async (route) => {
    reconnectRequestBody = JSON.parse(route.request().postData() ?? "{}");
    const response = await route.fetch();
    if (!response.ok()) throw new Error(`The server did not commit reconnect before the response was held (HTTP ${response.status()}: ${await response.text()})`);
    reconnectCommitted();
    await reconnectResponseReleased;
    await route.fulfill({ response });
    reconnectResponseDelivered();
  });
  await reconnectSpectator.route((requestUrl) => requestUrl.pathname === `/rooms/${code}/disconnect`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    leaveDisconnectBodies.push(body);
    await route.continue();
    if (!body.pendingConnectionId) socketLossDisconnectSettled();
  });
  await reconnectSpectator.routeWebSocket((socketUrl) => socketUrl.pathname === "/ws", async (route) => {
    const serverSocket = route.connectToServer();
    if (forceReconnectSocketClose) await serverSocket.close({ code: 1000, reason: "controlled committed reconnect audit" });
  });
  await reconnectSpectator.reload({ waitUntil: "domcontentloaded" });
  await reconnectSpectator.locator(".game-screen.online-game").waitFor({ state: "visible" });
  let reconnectCommitTimeout;
  try {
    await Promise.race([reconnectCommittedGate, new Promise((_, reject) => {
      reconnectCommitTimeout = setTimeout(() => reject(new Error("The forced socket loss did not reach a reconnect request.")), 15000);
    })]);
  } finally {
    clearTimeout(reconnectCommitTimeout);
  }
  const reconnectMenuSummary = reconnectSpectator.locator(".hud-menu > summary");
  let socketLossDisconnectTimeout;
  try {
    await Promise.race([socketLossDisconnectGate, new Promise((_, reject) => {
      socketLossDisconnectTimeout = setTimeout(() => reject(new Error("The controlled socket close did not finish its initial disconnect.")), 15000);
    })]);
  } finally {
    clearTimeout(socketLossDisconnectTimeout);
  }
  const reconnectAuditSession = await reconnectSpectator.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.ok(reconnectAuditSession?.token, "the production session token is available for an authoritative post-Leave read");
  await reconnectMenuSummary.click();
  const committedReconnectLeave = reconnectSpectator.locator(".hud-menu-items .leave-room-action");
  let committedReconnectLeaveConfirmed = false;
  const committedReconnectLeaveDialog = new Promise((resolve) => reconnectSpectator.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Leave this active match/);
    await dialog.accept();
    committedReconnectLeaveConfirmed = true;
    resolve();
  }));
  await committedReconnectLeave.click();
  await committedReconnectLeaveDialog;
  await reconnectSpectator.locator(".home-screen").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(leaveDisconnectBodies.some((body) => body.pendingConnectionId === reconnectRequestBody.requestedConnectionId), true,
    "Leave sends the in-flight reconnect lease so the server can atomically cancel it");

  const afterLeaveBeforeLateResponse = await reconnectSpectator.evaluate(() => ({ homeVisible: Boolean(document.querySelector(".home-screen") && getComputedStyle(document.querySelector(".home-screen")).display !== "none"), storedSession: localStorage.getItem("abominations-session") }));
  assert.equal(afterLeaveBeforeLateResponse.homeVisible, true);
  assert.equal(afterLeaveBeforeLateResponse.storedSession, null);
  forceReconnectSocketClose = false;
  const replacementJoinPanel = reconnectSpectator.locator(".home-online");
  if (!(await replacementJoinPanel.evaluate((node) => node.open))) await replacementJoinPanel.locator("summary").click();
  await reconnectSpectator.getByRole("textbox", { name: "Display name" }).fill("Rejoined Audit Viewer");
  await reconnectSpectator.getByRole("textbox", { name: "Room code" }).fill(code);
  await reconnectSpectator.getByRole("button", { name: "Spectate", exact: true }).click();
  await reconnectSpectator.locator(".game-screen.online-game").waitFor({ state: "visible" });
  const resumedAuditSession = await reconnectSpectator.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.ok(resumedAuditSession?.token && resumedAuditSession.token !== reconnectAuditSession.token, "rejoining creates a distinct replacement session");
  await reconnectSpectator.waitForFunction(() => document.querySelector(".room-hud-menu-status")?.textContent?.includes("online"), null, { timeout: 15000 });

  releaseReconnectResponse();
  await reconnectResponseDeliveredGate;
  await reconnectSpectator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterCommittedReconnect = await reconnectSpectator.evaluate((roomCode) => ({ gameVisible: Boolean(document.querySelector(".game-screen.online-game") && getComputedStyle(document.querySelector(".game-screen")).display !== "none"), roomStatus: document.querySelector(".room-hud-menu-status")?.textContent?.trim(), storedSession: JSON.parse(localStorage.getItem("abominations-session") ?? "null"), currentLease: sessionStorage.getItem(`abominations-connection-id:${roomCode}`), pendingLease: sessionStorage.getItem(`abominations-connection-id:${roomCode}:pending`), cancelledLease: sessionStorage.getItem(`abominations-connection-id:${roomCode}:cancelled`) }), code);
  assert.equal(afterCommittedReconnect.gameVisible, true, `the replacement room remains open after the old response: ${JSON.stringify(afterCommittedReconnect)}`);
  assert.equal(afterCommittedReconnect.roomStatus?.includes("online"), true);
  assert.equal(afterCommittedReconnect.storedSession?.token, resumedAuditSession.token, "the old response does not replace the new session token");
  assert.ok(afterCommittedReconnect.currentLease, "the replacement session's fresh socket lease remains stored");
  assert.equal(afterCommittedReconnect.pendingLease, null);
  assert.equal(afterCommittedReconnect.cancelledLease, null);
  const authoritativeAfterLeave = await fetch(`${apiUrl}/rooms/${code}/state?token=${encodeURIComponent(reconnectAuditSession.token)}&afterVersion=0`);
  assert.equal(authoritativeAfterLeave.ok, true, "the old room token can read its authoritative spectator projection for audit");
  const authoritativeRoom = await authoritativeAfterLeave.json();
  assert.equal(authoritativeRoom.participants.find((participant) => participant.displayName === "Reconnect Audit Viewer")?.connected, false,
    "the participant remains disconnected after the held reconnect response is delivered");
  const authoritativeReplacement = await fetch(`${apiUrl}/rooms/${code}/state?token=${encodeURIComponent(resumedAuditSession.token)}&afterVersion=0`);
  assert.equal(authoritativeReplacement.ok, true);
  assert.equal((await authoritativeReplacement.json()).participants.find((participant) => participant.displayName === "Rejoined Audit Viewer")?.connected, true,
    "the replacement spectator remains connected after the old acknowledgement arrives");
  assert.equal(leaveDisconnectBodies.filter((body) => body.pendingConnectionId === reconnectRequestBody.requestedConnectionId).length, 1,
    "Leave uses one atomic cancellation request without a trailing duplicate disconnect");
  report.cases.onlineSpectatorCommittedReconnect = {
    forcedSocketLoss: true,
    reconnectCommittedBeforeItsResponseWasReleased: true,
    confirmedLeaveReturnedWithinFiveSeconds: committedReconnectLeaveConfirmed,
    leaveCancelledTheRequestedReconnectLease: true,
    replacementSessionSurvivedDelayedReconnectResponse: true,
    authoritativeParticipantRemainsDisconnectedAfterLateResponse: true,
    replacementSocketAndLeaseRemainActiveAfterLateAcknowledgement: true,
    cancellationDisconnectRequests: leaveDisconnectBodies.filter((body) => body.pendingConnectionId === reconnectRequestBody.requestedConnectionId).length,
  };

  const playerLeaving = first;
  const playerStaying = second;
  const playerLeaveCode = code;
  if (!(await playerLeaving.locator(".hud-menu").evaluate((node) => node.open))) await playerLeaving.locator(".hud-menu > summary").click();
  const finalReadyResponse = playerLeaving.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/ready"));
  await playerLeaving.locator(".hud-menu-items").getByRole("button", { name: "Ready", exact: true }).click();
  assert.equal((await finalReadyResponse).ok(), true, "the final ready player starts the active Leave audit match");
  let activeMatchSnapshot;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    activeMatchSnapshot = await snapshot(playerStaying, playerLeaveCode);
    if (activeMatchSnapshot.status === "active") break;
    await wait(100);
  }
  assert.equal(activeMatchSnapshot.status, "active", "both ready players activate the player-Leave audit match");

  const preferenceDisabledViewer = await openPage("preferenceDisabledViewer", { width: 390, height: 844 }, { touch: true });
  await enterRoom(preferenceDisabledViewer, "Preference Audit Viewer", playerLeaveCode, "Spectate", { expectSetup: false });
  await waitFor(preferenceDisabledViewer, () => Boolean(document.querySelector(".hud-menu")), "phone spectator game menu");
  const phoneMenu = preferenceDisabledViewer.locator(".hud-menu");
  const phoneMenuSummary = phoneMenu.locator(":scope > summary");
  await phoneMenuSummary.tap();
  const phoneMenuItems = phoneMenu.locator(".hud-menu-items");
  const phoneMenuBounds = await phoneMenuItems.boundingBox();
  assert.ok(phoneMenuBounds && phoneMenuBounds.x >= 0 && phoneMenuBounds.x + phoneMenuBounds.width <= 390,
    `phone game menu stays within horizontal viewport bounds: ${JSON.stringify(phoneMenuBounds)}`);
  const phoneSettingsButton = phoneMenu.getByRole("button", { name: "Settings", exact: true });
  await phoneSettingsButton.tap();
  const confirmationPreference = preferenceDisabledViewer.getByRole("checkbox", { name: "Confirm leave, concede, or disappear" });
  await confirmationPreference.waitFor({ state: "visible" });
  assert.equal(await confirmationPreference.isChecked(), true, "the confirmation preference starts enabled for the new phone session");
  await confirmationPreference.tap();
  await preferenceDisabledViewer.waitForFunction(() => localStorage.getItem("abominations-confirm-irreversible") === "0");
  assert.equal(await confirmationPreference.isChecked(), false, "touching the Settings checkbox disables irreversible-action confirmation");
  const settingsBounds = await preferenceDisabledViewer.locator(".settings-panel").boundingBox();
  assert.ok(settingsBounds && settingsBounds.x >= 0 && settingsBounds.y >= 0 && settingsBounds.x + settingsBounds.width <= 390 && settingsBounds.y + settingsBounds.height <= 844,
    `phone Settings panel stays within the viewport: ${JSON.stringify(settingsBounds)}`);
  const evidenceDir = join(process.cwd(), "output/ui-review");
  await mkdir(evidenceDir, { recursive: true });
  await preferenceDisabledViewer.screenshot({ path: join(evidenceDir, "game-menu-confirm-disabled-phone-2026-09-29.png") });
  await preferenceDisabledViewer.getByRole("button", { name: "Close play preferences" }).tap();
  await preferenceDisabledViewer.locator(".settings-panel").waitFor({ state: "detached" });
  assert.equal(await preferenceDisabledViewer.locator(".settings-panel").count(), 0, "touching Settings closes its panel before Leave");
  assert.equal(await phoneMenuItems.isVisible(), true, "the phone menu remains open and usable after closing Settings");
  assert.equal(await phoneSettingsButton.evaluate((node) => node === document.activeElement), true, "closing phone Settings restores focus to the Settings opener");
  await preferenceDisabledViewer.screenshot({ path: join(evidenceDir, "game-menu-open-phone-2026-09-29.png") });
  const phoneLeave = phoneMenu.locator(".leave-room-action");
  const phoneLeaveBounds = await phoneLeave.boundingBox();
  assert.ok(phoneLeaveBounds && phoneLeaveBounds.height >= 44 && phoneLeaveBounds.x >= 0 && phoneLeaveBounds.x + phoneLeaveBounds.width <= 390,
    `phone Leave target is at least 44px tall and horizontally in bounds: ${JSON.stringify(phoneLeaveBounds)}`);
  const matchBeforePreferenceDisabledLeave = await snapshot(playerStaying, playerLeaveCode);
  const phoneLeaveDialogs = [];
  preferenceDisabledViewer.on("dialog", async (dialog) => {
    phoneLeaveDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await phoneLeave.tap();
  await preferenceDisabledViewer.locator(".home-screen").waitFor({ state: "visible" });
  assert.deepEqual(phoneLeaveDialogs, [], "disabled confirmation preference leaves without opening a browser prompt");
  assert.equal(requests.preferenceDisabledViewer.filter((request) => request.path.endsWith("/disconnect")).length, 1,
    "phone Leave sends exactly one disconnect request when confirmation is disabled");
  const matchAfterPreferenceDisabledLeave = await snapshot(playerStaying, playerLeaveCode);
  assert.equal(matchAfterPreferenceDisabledLeave.status, matchBeforePreferenceDisabledLeave.status, "phone spectator Leave does not change active match status");
  assert.equal(matchAfterPreferenceDisabledLeave.phase, matchBeforePreferenceDisabledLeave.phase, "phone spectator Leave does not change game phase");
  assert.deepEqual(matchAfterPreferenceDisabledLeave.gameEventIds, matchBeforePreferenceDisabledLeave.gameEventIds, "phone spectator Leave does not change game event history");
  const disabledViewerSession = await preferenceDisabledViewer.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.equal(disabledViewerSession, null, "completed phone Leave clears the room session");
  await preferenceDisabledViewer.screenshot({ path: join(evidenceDir, "game-menu-home-after-confirm-disabled-leave-phone-2026-09-29.png") });
  report.cases.onlineSpectatorLeavePreferenceDisabled = {
    role: "spectator",
    viewport: "390x844",
    touchEnabled: true,
    preferenceChangedThroughSettings: true,
    settingsPanelInBounds: true,
    menuBounds: { x: Math.round(phoneMenuBounds.x), right: Math.round(phoneMenuBounds.x + phoneMenuBounds.width), width: Math.round(phoneMenuBounds.width) },
    leaveTargetHeight: Math.round(phoneLeaveBounds.height),
    browserConfirmationOpened: phoneLeaveDialogs.length > 0,
    disconnectRequests: requests.preferenceDisabledViewer.filter((request) => request.path.endsWith("/disconnect")).length,
    returnedHomeAndClearedSession: true,
    activeMatchStatusPhaseAndEventHistoryUnchanged: true,
    screenshots: ["game-menu-confirm-disabled-phone-2026-09-29.png", "game-menu-open-phone-2026-09-29.png", "game-menu-home-after-confirm-disabled-leave-phone-2026-09-29.png"],
  };

  const playerLeaveSession = await playerLeaving.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.ok(playerLeaveSession?.token, "the leaving player token is retained for the authoritative disconnect check");
  assert.notEqual(await playerLeaving.evaluate(() => localStorage.getItem("abominations-confirm-irreversible")), "0",
    "the player Leave path uses the enabled confirmation preference");
  const activeMatchBeforeLeave = await snapshot(playerLeaving, playerLeaveCode);
  const activeMenuSummary = playerLeaving.locator(".hud-menu > summary");
  const activeLeave = playerLeaving.locator(".hud-menu-items .leave-room-action");
  if (!(await playerLeaving.locator(".hud-menu").evaluate((node) => node.open))) await activeMenuSummary.click();
  let playerLeaveCancelled = false;
  const playerLeaveCancelDialog = new Promise((resolve) => playerLeaving.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Leave this active match/);
    await dialog.dismiss();
    playerLeaveCancelled = true;
    resolve();
  }));
  await activeLeave.click();
  await playerLeaveCancelDialog;
  assert.equal(await playerLeaving.locator(".game-screen.online-game").isVisible(), true, "cancelling Leave keeps the player in the active match");
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/disconnect")).length, 0,
    "cancelling the player prompt sends no disconnect request");
  const cancelStayedWithoutDisconnect = requests.firstPlayer.filter((request) => request.path.endsWith("/disconnect")).length === 0;
  assert.deepEqual(await snapshot(playerLeaving, playerLeaveCode), activeMatchBeforeLeave,
    "cancelling player Leave preserves the authoritative match snapshot");
  if (!(await playerLeaving.locator(".hud-menu").evaluate((node) => node.open))) await activeMenuSummary.click();
  let playerLeaveAccepted = false;
  const playerLeaveAcceptDialog = new Promise((resolve) => playerLeaving.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Leave this active match/);
    await dialog.accept();
    playerLeaveAccepted = true;
    resolve();
  }));
  await activeLeave.click();
  await playerLeaveAcceptDialog;
  await playerLeaving.locator(".home-screen").waitFor({ state: "visible" });
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/disconnect")).length, 1,
    "accepting player Leave sends exactly one disconnect request");
  const activeMatchAfterLeave = await snapshot(playerStaying, playerLeaveCode);
  assert.equal(activeMatchAfterLeave.status, activeMatchBeforeLeave.status);
  assert.equal(activeMatchAfterLeave.phase, activeMatchBeforeLeave.phase);
  assert.deepEqual(activeMatchAfterLeave.gameEventIds, activeMatchBeforeLeave.gameEventIds,
    "accepted player Leave does not modify match history");
  const departedPlayerResponse = await fetch(`${apiUrl}/rooms/${playerLeaveCode}/state?token=${encodeURIComponent(playerLeaveSession.token)}&afterVersion=0`);
  assert.equal(departedPlayerResponse.ok, true, "the departed player session remains readable for presence verification");
  const departedRoom = await departedPlayerResponse.json();
  assert.equal(departedRoom.participants.find((participant) => participant.displayName === "Menu Audit Player")?.connected, false,
    "accepted player Leave marks its seat disconnected");
  assert.equal(departedRoom.participants.find((participant) => participant.displayName === "Menu Audit Player Two")?.connected, true,
    "the other player remains connected in the active match");
  report.cases.onlinePlayerLeave = {
    activeMatch: true,
    confirmationPreferenceEnabled: true,
    cancelStayedInRoomWithoutDisconnect: playerLeaveCancelled && cancelStayedWithoutDisconnect,
    acceptReturnedHome: playerLeaveAccepted,
    disconnectRequests: requests.firstPlayer.filter((request) => request.path.endsWith("/disconnect")).length,
    matchStatusPhaseAndEventHistoryUnchanged: true,
    departedSeatDisconnected: true,
    opponentRemainedConnected: true,
  };

  const keyboardMenu = playerStaying.locator(".hud-menu");
  const keyboardMenuSummary = keyboardMenu.locator(":scope > summary");
  if (!(await keyboardMenu.evaluate((node) => node.open))) {
    await keyboardMenuSummary.focus();
    await playerStaying.keyboard.press("Enter");
  }
  const keyboardSettingsButton = keyboardMenu.getByRole("button", { name: "Settings", exact: true });
  await keyboardSettingsButton.focus();
  await playerStaying.keyboard.press("Enter");
  const keyboardConfirmationPreference = playerStaying.getByRole("checkbox", { name: "Confirm leave, concede, or disappear" });
  assert.equal(await keyboardConfirmationPreference.isChecked(), true, "the active player's confirmation preference starts enabled");
  await keyboardConfirmationPreference.focus();
  await playerStaying.keyboard.press("Space");
  await playerStaying.waitForFunction(() => localStorage.getItem("abominations-confirm-irreversible") === "0");
  assert.equal(await keyboardConfirmationPreference.isChecked(), false, "keyboard disables the confirmation preference in Settings");
  const desktopSettingsBounds = await playerStaying.locator(".settings-panel").boundingBox();
  assert.ok(desktopSettingsBounds && desktopSettingsBounds.x >= 0 && desktopSettingsBounds.y >= 0
    && desktopSettingsBounds.x + desktopSettingsBounds.width <= 1280
    && desktopSettingsBounds.y + desktopSettingsBounds.height <= 800,
  `desktop Settings panel stays within the viewport: ${JSON.stringify(desktopSettingsBounds)}`);
  await playerStaying.screenshot({ path: join(evidenceDir, "game-menu-confirm-disabled-desktop-2026-09-29.png") });
  await keyboardSettingsButton.focus();
  await playerStaying.keyboard.press("Enter");
  await playerStaying.locator(".settings-panel").waitFor({ state: "detached" });
  const keyboardLeave = keyboardMenu.locator(".leave-room-action");
  await keyboardLeave.focus();
  const keyboardLeaveBounds = await keyboardLeave.boundingBox();
  assert.ok(keyboardLeaveBounds && keyboardLeaveBounds.height > 0 && keyboardLeaveBounds.x >= 0
    && keyboardLeaveBounds.x + keyboardLeaveBounds.width <= 1280,
  `desktop Leave target is visible and in bounds: ${JSON.stringify(keyboardLeaveBounds)}`);
  const secondSession = await playerStaying.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  assert.ok(secondSession?.token, "active player session exists before keyboard Leave");
  const activeMatchBeforeDisabledPlayerLeave = await snapshot(playerStaying, playerLeaveCode);
  const keyboardLeaveDialogs = [];
  playerStaying.on("dialog", async (dialog) => {
    keyboardLeaveDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await playerStaying.keyboard.press("Enter");
  await playerStaying.locator(".home-screen").waitFor({ state: "visible" });
  assert.deepEqual(keyboardLeaveDialogs, [], "disabled confirmation preference leaves without opening a browser prompt");
  assert.equal(requests.secondPlayer.filter((request) => request.path.endsWith("/disconnect")).length, 1,
    "active player keyboard Leave sends exactly one disconnect request when confirmation is disabled");
  const activeMatchAfterDisabledPlayerLeaveResponse = await fetch(`${apiUrl}/rooms/${playerLeaveCode}/state?token=${encodeURIComponent(secondSession.token)}&afterVersion=0`);
  assert.equal(activeMatchAfterDisabledPlayerLeaveResponse.ok, true, "departed active player's token remains readable for the match-state check");
  const activeMatchAfterDisabledPlayerLeave = await activeMatchAfterDisabledPlayerLeaveResponse.json();
  assert.equal(activeMatchAfterDisabledPlayerLeave.status, "abandoned", "the room becomes abandoned when its final connected player leaves");
  assert.equal(activeMatchAfterDisabledPlayerLeave.state.phase, activeMatchBeforeDisabledPlayerLeave.phase, "disabled-confirm Leave preserves game phase");
  assert.deepEqual(activeMatchAfterDisabledPlayerLeave.state.eventLog.map((event) => event.id), activeMatchBeforeDisabledPlayerLeave.gameEventIds,
    "disabled-confirm Leave preserves game event history");
  assert.equal(activeMatchAfterDisabledPlayerLeave.participants.find((participant) => participant.displayName === "Menu Audit Player Two")?.connected, false,
    "keyboard Leave marks the active player's seat disconnected");
  report.cases.onlinePlayerLeavePreferenceDisabled = {
    activeMatch: true,
    role: "player",
    viewport: "1280x800",
    input: "keyboard",
    preferenceChangedThroughSettings: true,
    settingsPanelInBounds: true,
    leaveTargetHeight: Math.round(keyboardLeaveBounds.height),
    browserConfirmationOpened: keyboardLeaveDialogs.length > 0,
    disconnectRequests: requests.secondPlayer.filter((request) => request.path.endsWith("/disconnect")).length,
    returnedHome: true,
    lastConnectedSeatLeavingMarksRoomAbandoned: activeMatchAfterDisabledPlayerLeave.status === "abandoned",
    gamePhaseAndEventHistoryUnchanged: true,
    departedSeatDisconnected: true,
    screenshot: "game-menu-confirm-disabled-desktop-2026-09-29.png",
  };

  assert.deepEqual(requests.local, [], "local menu slice produces no online request");
  assert.deepEqual(requests.solo, [], "solo menu slice produces no online request");
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/ready")).length, 3,
    "the third readiness request is the separate active-match Leave case");
  assert.equal(requests.spectator.filter((request) => request.path.endsWith("/disconnect")).length, 1);
  assert.equal(requests.firstPlayer.filter((request) => request.path.endsWith("/disconnect")).length, 1);
  assert.equal(requests.secondPlayer.filter((request) => request.path.endsWith("/disconnect")).length, 1);
  assert.deepEqual(requests.firstPlayer.filter((request) => request.path.endsWith("/actions")), [], "menu inspection does not submit game commands");
  assert.deepEqual(requests.secondPlayer.filter((request) => request.path.endsWith("/actions")), [], "the uninspected waiting player receives no game command");
  assert.deepEqual(requests.spectator.filter((request) => request.path.endsWith("/actions")), [], "spectator menu inspection submits no game command");
  assert.deepEqual(await first.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim())), [], "menu matrix produces no visible game errors");
  const evidencePath = join(process.cwd(), "output/ui-review/game-menu-matrix-2026-09-29.json");
  report.ok = true;
  report.apiMode = "memory";
  report.browser = "Chromium via Playwright";
  report.requestCounts = Object.fromEntries(Object.entries(requests).map(([key, values]) => [key, { ready: values.filter((item) => item.path.endsWith("/ready")).length, disconnect: values.filter((item) => item.path.endsWith("/disconnect")).length, reconnect: values.filter((item) => item.path.endsWith("/reconnect")).length, actions: values.filter((item) => item.path.endsWith("/actions")).length }]));
  await mkdir(join(process.cwd(), "output/ui-review"), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, evidencePath, requestCounts: report.requestCounts, cases: Object.keys(report.cases) }));
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
