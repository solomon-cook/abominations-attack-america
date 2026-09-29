import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_HOME_ENTRY_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const ownsServer = !process.env.BROWSER_TEST_URL;
const server = ownsServer
  ? spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(cwd, "apps/web"), stdio: ["ignore", "pipe", "pipe"],
  })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const viewports = [[1280, 720], [768, 1024], [390, 844], [320, 740]];
const requests = [];
const runtimeErrors = [];
const unexpectedApiRequests = [];
let releaseHeldCreateFailure;
const heldCreateFailure = new Promise((resolve) => { releaseHeldCreateFailure = resolve; });
const json = (data, origin) => ({
  status: 200,
  contentType: "application/json",
  headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
  body: JSON.stringify(data),
});
async function completeSoloSetup(page, setup, runtimeErrors) {
  const choices = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!(await setup.count())) break;
    const inLairSelection = await setup.evaluate((panel) => panel.classList.contains("lair-selection-prompt"));
    if (inLairSelection) {
      await page.waitForFunction(() => [...document.querySelectorAll(".hex-tile.deployment-legal:not(:disabled)")].some((tile) => {
        const rect = tile.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".hex-tile") === tile;
      }));
      const destination = await page.locator(".hex-tile.deployment-legal:not(:disabled)").evaluateAll((tiles) => tiles.map((tile) => {
        const rect = tile.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = rect.width > 0 && rect.height > 0 && document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
        return { key: tile.getAttribute("data-hex-key"), x, y, hit, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) };
      }).filter((tile) => tile.hit).sort((a, b) => a.distance - b.distance)[0] ?? null);
      assert.ok(destination, "solo setup should expose a clickable legal lair");
      choices.push(`Lair ${destination.key}`);
      const before = await setup.evaluate((panel) => JSON.stringify({ text: panel.innerText, buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]) }));
      await page.mouse.click(destination.x, destination.y);
      await page.waitForFunction((previous) => {
        const panel = document.querySelector(".setup-panel");
        if (!panel) return true;
        const current = JSON.stringify({ text: panel.innerText, buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]) });
        return current !== previous;
      }, before, { polling: "raf" });
      continue;
    }
    const choice = setup.locator(".setup-options button:visible:not(:disabled)").first();
    try {
      await choice.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      const panelText = await setup.innerText().catch(() => "setup panel detached");
      const buttons = await setup.locator(".setup-options button").evaluateAll((nodes) => nodes.map((button) => ({ text: button.innerText, disabled: button.disabled, visible: button.getBoundingClientRect().width > 0 })));
      throw new Error(`Solo setup stopped before completion: ${JSON.stringify({ choices, panelText, buttons, errors: runtimeErrors })}`);
    }
    const before = await setup.evaluate((panel) => JSON.stringify({
      text: panel.innerText,
      buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
      detailsOpen: [...panel.querySelectorAll("details")].map((details) => details.open),
    }));
    choices.push((await choice.innerText()).trim());
    await choice.click();
    await page.waitForFunction((previous) => {
      const panel = document.querySelector(".setup-panel");
      if (!panel) return true;
      const current = JSON.stringify({
        text: panel.innerText,
        buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
        detailsOpen: [...panel.querySelectorAll("details")].map((details) => details.open),
      });
      return panel.getAttribute("aria-busy") !== "true" && current !== previous;
    }, before, { polling: "raf" });
  }
  return choices;
}

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) { ready = true; break; }
    } catch {
      if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(`Vite exited before ready.\n${serverOutput}`);
    }
    if (attempt < 119) await wait(100);
  }
  if (!ready) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const appOrigin = new URL(url).origin;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const isApiPath = /^\/(?:accounts|leaderboard|rooms|players)(?:\/|$)/.test(path);
    if (!isApiPath && requestUrl.origin === appOrigin) return route.continue();
    if (!isApiPath && requestUrl.origin !== appOrigin) {
      unexpectedApiRequests.push({ method: request.method(), origin: requestUrl.origin, path });
      return route.abort();
    }
    requests.push({ method: request.method(), path });
    const origin = appOrigin;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-room-token",
      } });
      return;
    }
    if (request.method() === "GET" && path === "/accounts/me") return route.fulfill(json({ account: null }, origin));
    if (request.method() === "GET" && path === "/leaderboard") return route.fulfill(json([], origin));
    if (request.method() === "GET" && path === "/rooms/public") return route.fulfill(json([
      { code: "PUB123", status: "waiting", maxPlayers: 4, playerCount: 1, spectatorCount: 0 },
    ], origin));
    if (request.method() === "POST" && path === "/rooms") {
      await heldCreateFailure;
      return route.fulfill({ ...json({ error: "Room creation is unavailable in this Home fixture." }, origin), status: 503 });
    }
    unexpectedApiRequests.push({ method: request.method(), path });
    return route.fulfill(json({ error: `Unexpected Home funnel API request: ${request.method()} ${path}` }, origin));
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".home-screen").waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));

  const onlineDisclosure = page.locator("details.home-online");
  await onlineDisclosure.locator(":scope > summary").click();
  await page.getByRole("button", { name: "Find public rooms" }).click();
  const publicRoomCandidate = page.locator(".public-room").filter({ hasText: "PUB123" });
  await publicRoomCandidate.waitFor({ state: "visible" });
  const roomCodeInput = page.getByRole("textbox", { name: "Room code" });
  await roomCodeInput.fill("ABC123");
  const createRoomButton = page.getByRole("button", { name: "Create", exact: true });
  await createRoomButton.evaluate((button) => { button.click(); button.click(); });
  const roomCreationStatus = page.getByRole("status").filter({ hasText: "Creating room…" });
  await roomCreationStatus.waitFor({ state: "visible" });
  assert.equal(await onlineDisclosure.locator(".lobby-actions").getAttribute("aria-busy"), "true", "Home room controls should report a pending request");
  const homeDestinationButtons = {
    local: page.getByRole("button", { name: /Start local game/ }),
    solo: page.getByRole("button", { name: /Play solo vs bots/ }),
  };
  const playtestToolsDisclosure = page.locator("details.home-tools");
  await playtestToolsDisclosure.locator(":scope > summary").click();
  const playtestActionButtons = [
    page.getByRole("button", { name: "Play audited board" }),
    page.getByRole("button", { name: "Review full board" }),
    page.getByRole("button", { name: "Victory test" }),
  ];
  const readHomeControlDisabledState = async () => ({
    homePlayerCount: await page.getByRole("combobox", { name: "Number of players" }).isDisabled(),
    displayName: await page.getByRole("textbox", { name: "Display name" }).isDisabled(),
    lobbyPlayerCount: await page.getByRole("combobox", { name: "Player count" }).isDisabled(),
    roomPrivacy: await page.getByRole("combobox", { name: "Room privacy" }).isDisabled(),
    roomCode: await page.getByRole("textbox", { name: "Room code" }).isDisabled(),
    create: await createRoomButton.isDisabled(),
    join: await page.getByRole("button", { name: "Join", exact: true }).isDisabled(),
    spectate: await page.getByRole("button", { name: "Spectate", exact: true }).isDisabled(),
    publicRoomRefresh: await page.getByRole("button", { name: "Find public rooms" }).isDisabled(),
    publicRoomCandidate: await publicRoomCandidate.isDisabled(),
    localStart: await homeDestinationButtons.local.isDisabled(),
    soloStart: await homeDestinationButtons.solo.isDisabled(),
    playAuditedBoard: await playtestActionButtons[0].isDisabled(),
    reviewFullBoard: await playtestActionButtons[1].isDisabled(),
    victoryTest: await playtestActionButtons[2].isDisabled(),
  });
  const homePendingDisabledControls = await readHomeControlDisabledState();
  assert.deepEqual(homePendingDisabledControls, Object.fromEntries(Object.keys(homePendingDisabledControls).map((control) => [control, true])), "Home room fields, room actions, local actions, and Playtest Tools routes should all be disabled while a room request is pending");
  const roomCodeBeforeCandidateClick = await roomCodeInput.inputValue();
  await publicRoomCandidate.evaluate((button) => button.click());
  const roomCodeAfterCandidateClick = await roomCodeInput.inputValue();
  assert.equal(roomCodeAfterCandidateClick, roomCodeBeforeCandidateClick, "a public-room candidate must not replace the room code while Create is pending");
  await playtestActionButtons[0].evaluate((button) => button.click());
  assert.equal(await page.locator(".home-screen").count(), 1, "an attempted Play audited board action must leave the pending Home room request in place");
  assert.equal(await page.locator(".setup-panel, .board-review-screen, .victory-summary").count(), 0, "a competing Playtest Tools action must not replace Home while room creation is pending");
  assert.equal(await roomCreationStatus.isVisible(), true, "the room pending state should remain active after the competing action is attempted");
  assert.deepEqual(requests.filter((request) => request.method === "POST" && request.path === "/rooms").length, 1, "the pending Home action should issue exactly one create request");
  const createFailureResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/rooms" && response.request().method() === "POST");
  releaseHeldCreateFailure();
  const createFailureResponse = await createFailureResponsePromise;
  assert.equal(createFailureResponse.status(), 503, "the Home failure fixture should return its controlled 503 response");
  const roomCreationError = page.getByRole("alert").filter({ hasText: "Room creation is unavailable in this Home fixture." });
  await roomCreationError.waitFor({ state: "visible" });
  const roomCreationErrorMessage = (await roomCreationError.innerText()).trim();
  const homeRecoveredDisabledControls = await readHomeControlDisabledState();
  const homeAriaBusyAfterFailure = await onlineDisclosure.locator(".lobby-actions").getAttribute("aria-busy");
  assert.deepEqual(homeRecoveredDisabledControls, Object.fromEntries(Object.keys(homeRecoveredDisabledControls).map((control) => [control, false])), "all Home room fields, room actions, local actions, and Playtest Tools routes should be enabled after the request fails");
  assert.equal(homeAriaBusyAfterFailure, "false", "Home room controls should clear aria-busy after the request fails");
  assert.equal(await roomCreationStatus.count(), 0, "the pending status should clear after the request fails");
  await playtestToolsDisclosure.locator(":scope > summary").click();
  await onlineDisclosure.locator(":scope > summary").click();

  const toggleDisclosureByKeyboard = async (selector, key, label) => {
    const details = page.locator(selector);
    const summary = details.locator(":scope > summary");
    await summary.waitFor({ state: "visible" });
    assert.equal(await summary.evaluate((node) => node.tabIndex), 0, `${label} summary should be keyboard focusable`);
    await summary.focus();
    assert.equal(await summary.evaluate((node) => node === document.activeElement), true, `${label} summary should receive keyboard focus`);
    await page.keyboard.press(key);
    await page.waitForFunction((target) => document.querySelector(target)?.open === true, selector);
    await summary.focus();
    await page.keyboard.press(key === "Enter" ? "Space" : "Enter");
    await page.waitForFunction((target) => document.querySelector(target)?.open === false, selector);
  };

  const howToPlay = page.getByRole("button", { name: /How to play/ });
  await howToPlay.focus();
  await page.keyboard.press("Enter");
  await page.locator("#home-rules").waitFor({ state: "visible" });
  assert.equal(await howToPlay.getAttribute("aria-expanded"), "true", "How to play should expose its expanded state");
  await page.getByRole("button", { name: "Close rules" }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#home-rules").waitFor({ state: "detached" });
  assert.equal(await howToPlay.getAttribute("aria-expanded"), "false", "closing Quick Rules should update the How to play control");

  await toggleDisclosureByKeyboard("details.home-online", "Enter", "Play online");
  await toggleDisclosureByKeyboard("details.solo-strategy-guide", "Space", "Monster and military tactics");
  const playtestSummary = page.locator("details.home-tools > summary");
  await playtestSummary.scrollIntoViewIfNeeded();
  await toggleDisclosureByKeyboard("details.home-tools", "Enter", "Playtest tools");

  const overflowReports = [];
  const checkOverflow = async (width, height, state) => {
    const report = await page.evaluate(({ width, height, state }) => {
      const html = document.documentElement;
      const body = document.body;
      const overflowers = [...document.querySelectorAll("body *")].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { tag: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : "", x: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), display: style.display };
      }).filter((item) => item.display !== "none" && item.width > 0 && (item.x < -1 || item.right > innerWidth + 1)).slice(0, 8);
      return {
        viewport: `${width}x${height}`,
        state,
        innerWidth,
        documentWidth: html.scrollWidth,
        bodyWidth: body.scrollWidth,
        overflowers,
      };
    }, { width, height, state });
    overflowReports.push(report);
    assert.ok(report.documentWidth <= width + 1 && report.bodyWidth <= width + 1, `${width}x${height} Home should not overflow horizontally (${state}): ${JSON.stringify(report)}`);
    assert.deepEqual(report.overflowers, [], `${width}x${height} should have no children positioned outside the viewport (${state}): ${JSON.stringify(report)}`);
  };

  // The closed and expanded Home states both matter. The expanded measurement
  // keeps all the disclosure surfaces visible so narrow-width issues are not hidden.
  await playtestSummary.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("details.home-tools")?.open === true);
  const onlineSummary = page.locator("details.home-online > summary");
  await onlineSummary.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("details.home-online")?.open === true);
  const tacticsSummary = page.locator("details.solo-strategy-guide > summary");
  await tacticsSummary.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("details.solo-strategy-guide")?.open === true);
  await howToPlay.focus();
  await page.keyboard.press("Enter");
  await page.locator("#home-rules").waitFor({ state: "visible" });
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await checkOverflow(width, height, "all disclosures expanded");
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#home-rules") === null);
  for (const selector of ["details.home-online", "details.solo-strategy-guide", "details.home-tools"]) {
    await page.locator(`${selector} > summary`).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction((target) => document.querySelector(target)?.open === false, selector);
  }
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await checkOverflow(width, height, "default Home state");
  }

  const setupSeats = [];
  for (const count of [2, 3, 4]) {
    const setupPage = await context.newPage();
    setupPage.on("pageerror", (error) => runtimeErrors.push(error.message));
    await setupPage.goto(url, { waitUntil: "domcontentloaded" });
    await setupPage.locator(".home-screen").waitFor({ state: "visible" });
    const playerCount = setupPage.getByRole("combobox", { name: "Number of players" });
    await playerCount.selectOption(String(count));
    assert.equal(await playerCount.inputValue(), String(count), `Home should retain the selected ${count}-player count`);
    await setupPage.getByRole("button", { name: /Start local game/ }).click();
    const setup = setupPage.locator(".setup-panel");
    await setup.waitFor({ state: "visible" });
    const progress = setup.locator(".setup-progress").first();
    await progress.waitFor({ state: "visible" });
    const renderedProgress = (await progress.innerText()).trim();
    assert.match(renderedProgress, new RegExp(`^0/${count} starting choices confirmed$`), `local setup should render exactly ${count} seats: ${renderedProgress}`);
    assert.match((await setup.locator(".setup-turn").innerText()).trim(), /^Choosing for Player 1$/, "the first setup seat should be available to the local player");
    setupSeats.push({ players: count, rendered: renderedProgress });
    await setupPage.close();
  }

  const toolPage = await context.newPage();
  toolPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await toolPage.goto(url, { waitUntil: "domcontentloaded" });
  await toolPage.locator(".home-screen").waitFor({ state: "visible" });
  await toolPage.locator("details.home-tools").evaluate((details) => { details.open = true; });
  await toolPage.getByRole("button", { name: "Play audited board" }).click();
  await toolPage.locator(".setup-panel").waitFor({ state: "visible" });
  const auditedPlaytestDestination = await toolPage.locator(".game-screen").getAttribute("data-board-id");
  assert.ok(auditedPlaytestDestination, "Play audited board should enter local setup with a pinned board candidate");
  assert.equal(await toolPage.locator(".home-screen").count(), 0, "Play audited board should leave Home for the local setup flow");
  await toolPage.close();

  const soloPage = await context.newPage();
  soloPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await soloPage.goto(url, { waitUntil: "domcontentloaded" });
  await soloPage.locator(".home-screen").waitFor({ state: "visible" });
  await soloPage.getByRole("button", { name: /Play solo vs bots/ }).click();
  const soloSetup = soloPage.locator(".setup-panel");
  await soloSetup.waitFor({ state: "visible" });
  const firstRunGuide = soloPage.locator(".onboarding");
  assert.equal(await firstRunGuide.count(), 0, "the first-match guide should stay out of the way during setup");
  await soloPage.waitForFunction(() => {
    const panel = document.querySelector(".setup-panel");
    return panel?.querySelector(".setup-turn")?.textContent?.trim() === "Choosing for Player 1"
      && panel.querySelector(".monster-choice:not(:disabled)");
  });
  const enabledMonsterChoices = await soloSetup.locator(".monster-choice:not(:disabled)").count();
  assert.ok(enabledMonsterChoices > 0, "solo vs bots should expose an enabled monster choice for Player 1");
  assert.match((await soloSetup.locator(".setup-progress").first().innerText()).trim(), /^\d+\/\d+ starting choices confirmed$/, "solo should render a usable setup seat count");

  const soloSetupChoices = await completeSoloSetup(soloPage, soloSetup, runtimeErrors);
  await soloSetup.waitFor({ state: "detached" });
  await soloPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
  await soloPage.locator(".hex-tile.legal:not(:disabled)").first().waitFor({ state: "visible" });
  await soloPage.getByRole("button", { name: /^Player 2:/ }).waitFor({ state: "visible" });
  await firstRunGuide.waitFor({ state: "visible" });
  assert.equal(await firstRunGuide.getAttribute("aria-label"), "First match guide", "a fresh profile should open the first-match guide at the first playable turn");
  const guideDismissButton = firstRunGuide.getByRole("button", { name: "Got it · hide guide" });
  assert.equal(await guideDismissButton.evaluate((node) => node === document.activeElement), true, "auto-show should move keyboard focus into the guide when it becomes visible");
  const guideBounds = await firstRunGuide.boundingBox();
  assert.ok(guideBounds && guideBounds.x >= 0 && guideBounds.y >= 0 && guideBounds.x + guideBounds.width <= 1281 && guideBounds.y + guideBounds.height <= 721,
    `the first-match guide should fit its desktop viewport: ${JSON.stringify(guideBounds)}`);
  await guideDismissButton.click();
  await firstRunGuide.waitFor({ state: "detached" });
  const focusAfterGuideDismiss = await soloPage.evaluate(() => ({
    active: document.activeElement?.outerHTML?.slice(0, 240),
    heading: document.activeElement?.outerHTML,
    same: document.activeElement?.matches('h2[tabindex="-1"]') && document.activeElement.textContent?.includes("Move"),
  }));
  assert.equal(focusAfterGuideDismiss.same, true, `dismissing the auto-show guide should focus the current game action heading: ${JSON.stringify(focusAfterGuideDismiss)}`);
  assert.equal(await soloPage.evaluate(() => localStorage.getItem("abominations-onboarding-seen")), "1", "dismissing the guide should persist for this browser profile");

  const gameMenuSummary = soloPage.locator("details.hud-menu > summary");
  await gameMenuSummary.focus();
  await soloPage.keyboard.press("Enter");
  const inGameHowToPlay = soloPage.locator(".hud-menu .how-to-play-action");
  await inGameHowToPlay.waitFor({ state: "visible" });
  await inGameHowToPlay.click();
  await firstRunGuide.waitFor({ state: "visible" });
  const guideViewportChecks = [];
  for (const [width, height] of [[390, 844], [320, 740], [834, 1112], [1024, 768]]) {
    await soloPage.setViewportSize({ width, height });
    const bounds = await firstRunGuide.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1,
      `${width}x${height} first-match guide should stay within the viewport: ${JSON.stringify(bounds)}`);
    const dismissButton = firstRunGuide.getByRole("button", { name: "Got it · hide guide" });
    const dismissBounds = await dismissButton.boundingBox();
    assert.ok(dismissBounds && dismissBounds.width >= 1 && dismissBounds.height >= 1
      && dismissBounds.x >= 0 && dismissBounds.y >= 0
      && dismissBounds.x + dismissBounds.width <= width + 1
      && dismissBounds.y + dismissBounds.height <= height + 1,
    `${width}x${height} first-match guide dismiss action should remain in bounds: ${JSON.stringify(dismissBounds)}`);
    const dismissHitTarget = await dismissButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === button || button.contains(hit);
    });
    assert.equal(dismissHitTarget, true, `${width}x${height} first-match guide dismiss action should receive pointer input`);
    const menuClosed = await gameMenuSummary.evaluate((summary) => !(summary.parentElement instanceof HTMLDetailsElement && summary.parentElement.open));
    assert.equal(menuClosed, true, `${width}x${height} opening the guide should close its source menu`);
    const headingHitTarget = await firstRunGuide.locator("h2").evaluate((heading) => {
      const rect = heading.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".onboarding") === heading.closest(".onboarding");
    });
    assert.equal(headingHitTarget, true, `${width}x${height} game menu should not cover the guide heading`);
    const screenshot = `first-match-guide-${width}x${height}-2026-09-29.png`;
    await soloPage.screenshot({ path: join(cwd, "output", "ui-review", screenshot) });
    guideViewportChecks.push({ viewport: `${width}x${height}`, bounds, dismissBounds, dismissHitTarget, menuClosed, headingHitTarget, screenshot });
    if (width === 834 || width === 1024) {
      await dismissButton.focus();
      await soloPage.keyboard.press("Enter");
      await firstRunGuide.waitFor({ state: "detached" });
      assert.equal(await gameMenuSummary.evaluate((node) => node === document.activeElement), true,
        `${width}x${height} guide dismissal should return keyboard focus to the now-closed menu summary`);
      await gameMenuSummary.press("Enter");
      await inGameHowToPlay.waitFor({ state: "visible" });
      await inGameHowToPlay.press("Enter");
      await firstRunGuide.waitFor({ state: "visible" });
    }
  }
  await soloPage.keyboard.press("Escape");
  await firstRunGuide.waitFor({ state: "detached" });
  assert.equal(await gameMenuSummary.evaluate((node) => node === document.activeElement), true, "Escape should close the guide and return focus to its closed menu summary");

  await soloPage.reload({ waitUntil: "domcontentloaded" });
  await soloPage.locator(".home-screen").waitFor({ state: "visible" });
  await soloPage.getByRole("button", { name: /Play solo vs bots/ }).click();
  const returningSetup = soloPage.locator(".setup-panel");
  await returningSetup.waitFor({ state: "visible" });
  assert.equal(await firstRunGuide.count(), 0, "a returning profile should not see the auto-show guide during setup");
  const returningSetupChoices = await completeSoloSetup(soloPage, returningSetup, runtimeErrors);
  await returningSetup.waitFor({ state: "detached" });
  await soloPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
  assert.equal(await firstRunGuide.count(), 0, "a returning profile should keep the guide dismissed at the first playable turn");

  const allowedHomeRequests = ["/accounts/me", "/leaderboard", "/rooms/public", "/rooms"];
  const unexpectedRequests = requests.filter((request) => !allowedHomeRequests.includes(request.path));
  assert.deepEqual(unexpectedApiRequests, [], "Home funnel should only make the expected API requests");
  assert.deepEqual(unexpectedRequests, [], "the browser test should not issue unhandled API requests");
  assert.deepEqual(runtimeErrors, [], "Home funnel flows should not produce browser runtime errors");
  const report = {
    ok: true,
    evidence: {
      date: "2026-09-29",
      scenario: "Home room creation held pending, then returned a controlled 503",
      httpStatus: createFailureResponse.status(),
      pendingStatus: "Creating room…",
      ariaBusy: true,
      disabledControls: homePendingDisabledControls,
      ariaBusyAfterFailure: homeAriaBusyAfterFailure,
      recoveredDisabledControls: homeRecoveredDisabledControls,
      sameTaskRepeatClicksIssuedRequests: requests.filter((request) => request.method === "POST" && request.path === "/rooms").length,
      publicRoomCandidateDisabled: homePendingDisabledControls.publicRoomCandidate,
      roomCodeBeforeCandidateClick,
      roomCodeAfterCandidateClick,
      failureRenderedAsAlert: roomCreationErrorMessage,
    },
    checked: {
      howToPlay: "keyboard open and close",
      disclosures: ["online", "tactics", "playtest tools"].map((name) => `${name}: keyboard open and close`),
      homeRoomLoadingAndError: { pendingStatus: "Creating room…", disabledControls: homePendingDisabledControls, rapidRepeatSubmissionsPrevented: true, fixtureFailureShownAsAlert: true },
      localSetupSeatCounts: setupSeats,
      playAuditedBoard: { destination: "local setup", boardId: auditedPlaytestDestination },
      soloSetup: { setupChoices: soloSetupChoices, phase: "Move", legalMoveVisible: true, opponentCardVisible: true },
      firstMatchGuide: { freshProfileShowsGuide: true, dismissalPersisted: true, menuReopens: true, escapeRetainsFocus: true, returningProfileSuppressesAutoShow: true, returningSetupChoices, viewportChecks: [{ viewport: "1280x720", bounds: guideBounds }, ...guideViewportChecks] },
      horizontalOverflow: overflowReports,
      apiFixtureRequests: requests,
    },
  };
  const artifactPath = join(cwd, "output", "ui-review", "home-entry-and-first-match-guide-2026-09-29.json");
  await mkdir(join(cwd, "output", "ui-review"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  await context.close();
} finally {
  await browser?.close().catch(() => undefined);
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
