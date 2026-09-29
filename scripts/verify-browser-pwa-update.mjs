import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const projectRoot = process.cwd();
const buildRoot = resolve(projectRoot, "apps/web/dist");
const baseWorker = await readFile(resolve(projectRoot, "apps/web/public/sw.js"), "utf8");
const artifactDirectory = resolve(projectRoot, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const portServer = createServer();
const port = await new Promise((resolvePort, reject) => {
  portServer.once("error", reject);
  portServer.listen(0, "127.0.0.1", () => {
    const address = portServer.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a PWA verifier port."));
    const reservedPort = address.port;
    portServer.close((error) => error ? reject(error) : resolvePort(reservedPort));
  });
});

let workerVersion = 1;
const servedPaths = [];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
]);
const workerSource = () => {
  const versioned = workerVersion === 1
    ? baseWorker
    : baseWorker.replace("abominations-shell-audited-v3", "abominations-shell-audited-v4");
  return `const __PWA_TEST_VERSION__ = ${workerVersion};\n${versioned}\nself.addEventListener("message", (event) => { if (event.data?.type === "__PWA_TEST_VERSION__") event.ports[0]?.postMessage(__PWA_TEST_VERSION__); });\n`;
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  servedPaths.push(`${request.method ?? "GET"} ${url.pathname}${url.search}`);
  if (url.pathname === "/__test/release-worker") {
    workerVersion = Number(url.searchParams.get("version")) === 2 ? 2 : 1;
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(`worker v${workerVersion} is ready`);
    return;
  }
  if (url.pathname === "/sw.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", "service-worker-allowed": "/" });
    response.end(workerSource());
    return;
  }
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }

  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = resolve(buildRoot, `.${requested}`);
  if (file !== buildRoot && !file.startsWith(`${buildRoot}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const report = {
  started: new Date().toISOString(),
  environment: "production web build served over loopback with real browser service-worker lifecycle",
  coverage: "first install, Home update prompt, safe deferral during a phone match with usable Move action, phone layout and keyboard activation, offline fallback",
  scenarios: {},
  runtimeErrors: [],
};
let browser;
let gameContext;
try {
  await mkdir(artifactDirectory, { recursive: true });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const url = `http://127.0.0.1:${port}/`;
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "allow" });
  await context.route("http://localhost:8787/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: pathname === "/leaderboard" ? "[]" : JSON.stringify({ account: null }),
    });
  });
  await context.addInitScript(() => {
    const key = "pwa-update-test-document-loads";
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + 1));
    const originalAddEventListener = window.addEventListener.bind(window);
    window.__pwaLoadFired = false;
    window.__pwaLoadListenerAddedAfterLoad = false;
    window.addEventListener = (type, listener, options) => {
      if (type === "load" && window.__pwaLoadFired) {
        window.__pwaLoadListenerAddedAfterLoad = true;
      }
      originalAddEventListener(type, listener, options);
    };
    originalAddEventListener("load", () => { window.__pwaLoadFired = true; }, { once: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.runtimeErrors.push(message.text()); });
  page.on("requestfailed", (request) => report.runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Start local game" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => Number(sessionStorage.getItem("pwa-update-test-document-loads") ?? "0") >= 2, undefined, { timeout: 12000 });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && navigator.serviceWorker.controller);
  });
  report.scenarios.bootstrap = await page.evaluate(() => ({
    secureContext: isSecureContext,
    serviceWorkerSupported: "serviceWorker" in navigator,
    documentReadyState: document.readyState,
    loadEventFired: Boolean(window.__pwaLoadFired),
    loadListenerAddedAfterLoad: Boolean(window.__pwaLoadListenerAddedAfterLoad),
  }));
  await page.waitForTimeout(300);
  const initial = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      serviceWorkerSupported: "serviceWorker" in navigator,
      secureContext: isSecureContext,
      activeState: registration?.active?.state ?? null,
      waiting: Boolean(registration?.waiting),
      controlled: Boolean(navigator.serviceWorker.controller),
      documentLoads: Number(sessionStorage.getItem("pwa-update-test-document-loads") ?? "0"),
    };
  });
  assert.equal(initial.activeState, "activated", "the first service worker activates normally");
  assert.equal(initial.waiting, false, "a first install should not leave a waiting update");
  assert.ok(initial.controlled, "the first install should control the current page");

  gameContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  await gameContext.route("http://localhost:8787/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: pathname === "/leaderboard" ? "[]" : JSON.stringify({ account: null }),
    });
  });
  await gameContext.addInitScript(() => localStorage.setItem("abominations-onboarding-seen", "1"));
  const gamePage = await gameContext.newPage();
  gamePage.setDefaultTimeout(12000);
  gamePage.on("pageerror", (error) => report.runtimeErrors.push(error.message));
  gamePage.on("console", (message) => { if (message.type() === "error") report.runtimeErrors.push(message.text()); });
  gamePage.on("requestfailed", (request) => report.runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
  await gamePage.goto(url, { waitUntil: "domcontentloaded" });
  await gamePage.getByRole("button", { name: "Start local game" }).waitFor({ state: "visible" });
  await gamePage.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && navigator.serviceWorker.controller);
  });
  await gamePage.getByRole("button", { name: "Start local game" }).click();
  await gamePage.locator(".setup-panel").waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await gamePage.locator(".setup-panel").count())) break;
    const lairs = gamePage.locator(".lair-selection-prompt details");
    if (await lairs.count() && !(await lairs.evaluate((element) => element.open))) await lairs.locator("summary").click();
    const choice = gamePage.locator(".setup-panel .setup-options button:visible:not(:disabled)").first();
    await choice.waitFor({ state: "visible" });
    await choice.click();
    await gamePage.waitForTimeout(100);
  }
  await gamePage.locator(".setup-panel").waitFor({ state: "detached", timeout: 30000 });
  await gamePage.waitForFunction(() => document.querySelector(".game-screen") && document.querySelector(".action-card h2")?.textContent?.trim().includes("Move"));
  const gameInitialWorker = await gamePage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { activeState: registration?.active?.state ?? null, waiting: Boolean(registration?.waiting) };
  });
  assert.equal(gameInitialWorker.activeState, "activated", "the phone match starts under an active service worker");
  assert.equal(gameInitialWorker.waiting, false, "the phone match has no update waiting before release");
  report.scenarios.phoneMatchBootstrap = {
    status: "passed",
    viewport: "390x844",
    phase: await gamePage.locator(".action-card h2").innerText(),
    gameScreen: true,
    serviceWorkerControlled: true,
  };

  const focusTarget = page.getByRole("button", { name: "Start local game" });
  await focusTarget.focus();
  const focusBeforeUpdate = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.textContent?.trim() }));
  const releaseResponse = await page.evaluate(async () => (await fetch("/__test/release-worker?version=2")).text());
  assert.equal(releaseResponse, "worker v2 is ready");
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  const updatePrompt = page.getByRole("complementary", { name: "Update available" });
  await updatePrompt.waitFor({ state: "visible" });
  const promptButton = page.getByRole("button", { name: "Reload and update" });
  const focusAfterPrompt = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.textContent?.trim() }));
  assert.deepEqual(focusAfterPrompt, focusBeforeUpdate, "showing the nonmodal update notice does not steal focus");
  const promptBounds = await updatePrompt.boundingBox();
  assert.ok(promptBounds && promptBounds.x >= 0 && promptBounds.y >= 0 && promptBounds.x + promptBounds.width <= 1281 && promptBounds.y + promptBounds.height <= 721,
    `the update notice should fit the desktop viewport: ${JSON.stringify(promptBounds)}`);
  await page.screenshot({ path: resolve(artifactDirectory, `pwa-update-prompt-${date}.png`), fullPage: true });
  const waiting = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { hasWaitingWorker: Boolean(registration?.waiting), activeState: registration?.active?.state ?? null };
  });
  assert.equal(waiting.hasWaitingWorker, true, "a new version waits until the player chooses to reload");
  assert.equal(waiting.activeState, "activated", "the current version remains active while the update waits");

  await gamePage.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  await gamePage.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  await gamePage.waitForTimeout(150);
  assert.equal(await gamePage.locator(".pwa-update-prompt").count(), 0, "the update notice is deferred while the fullscreen match is active");
  const gameUpdateState = await gamePage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      gameScreenVisible: Boolean(document.querySelector(".game-screen")),
      phase: document.querySelector(".action-card h2")?.textContent?.trim() ?? null,
      waitingUpdate: Boolean(registration?.waiting),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.ok(gameUpdateState.gameScreenVisible && /Move/.test(gameUpdateState.phase ?? ""), `the phone match remains in Move: ${JSON.stringify(gameUpdateState)}`);
  assert.equal(gameUpdateState.waitingUpdate, true, "the new worker waits safely while the match remains open");
  assert.ok(gameUpdateState.scrollWidth <= gameUpdateState.viewport.width, `the live match should not overflow horizontally: ${JSON.stringify(gameUpdateState)}`);
  const gameAction = gamePage.locator(".board-action-bar .action-dock > button");
  await gameAction.waitFor({ state: "visible" });
  assert.equal(await gameAction.isEnabled(), true, "the current Move action stays enabled with an update waiting");
  const gameActionHit = await gamePage.evaluate(() => {
    const button = document.querySelector(".board-action-bar .action-dock > button");
    const rect = button?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    return {
      button: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      visible: Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth),
      receivesHit: Boolean(button && hit && (hit === button || button.contains(hit))),
    };
  });
  assert.ok(gameActionHit.visible && gameActionHit.receivesHit,
    `the phone Move action remains visible and receives taps during the pending update: ${JSON.stringify(gameActionHit)}`);
  await gamePage.screenshot({ path: resolve(artifactDirectory, `pwa-update-live-game-mobile-${date}.png`), fullPage: true });
  const movePhaseBeforeAction = gameUpdateState.phase;
  const gameActionLabel = await gameAction.getAttribute("aria-label");
  await gameAction.click();
  await gamePage.waitForTimeout(150);
  assert.equal(await gamePage.locator(".game-screen").isVisible(), true, "the game remains mounted after the Move action receives a tap");
  assert.equal(await gameAction.isVisible(), true, "the Move action remains present after its click handler runs");
  assert.equal(await gamePage.locator(".pwa-update-prompt").count(), 0, "the prompt remains deferred after using a game action");
  report.scenarios.liveGameMobile = {
    status: "passed",
    viewport: "390x844",
    updateWorkerWaiting: gameUpdateState.waitingUpdate,
    promptDeferred: true,
    phaseBeforeAction: movePhaseBeforeAction,
    actionLabel: gameActionLabel,
    actionBounds: gameActionHit.button,
    actionVisible: gameActionHit.visible,
    actionReceivesPointer: gameActionHit.receivesHit,
    actionClicked: true,
    screenshot: `pwa-update-live-game-mobile-${date}.png`,
  };
  await gameContext.close();
  gameContext = undefined;

  await page.setViewportSize({ width: 320, height: 568 });
  const mobilePromptBounds = await updatePrompt.boundingBox();
  const mobileButtonBounds = await promptButton.boundingBox();
  const homeAction = page.getByRole("button", { name: "Start local game" });
  const homeActionBounds = await homeAction.boundingBox();
  const mobileDocument = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(mobilePromptBounds && mobilePromptBounds.x >= 0 && mobilePromptBounds.y >= 0
    && mobilePromptBounds.x + mobilePromptBounds.width <= mobileDocument.width
    && mobilePromptBounds.y + mobilePromptBounds.height <= mobileDocument.height,
  `the update notice should fit a 320x568 phone viewport: ${JSON.stringify({ mobileDocument, mobilePromptBounds })}`);
  assert.ok(mobileButtonBounds && mobileButtonBounds.x >= mobilePromptBounds.x
    && mobileButtonBounds.x + mobileButtonBounds.width <= mobilePromptBounds.x + mobilePromptBounds.width
    && mobileButtonBounds.height >= 44,
  `the update action should remain fully visible with a 44px touch target: ${JSON.stringify({ mobilePromptBounds, mobileButtonBounds })}`);
  assert.ok(mobileDocument.scrollWidth <= mobileDocument.width,
    `the update notice should not introduce horizontal overflow on mobile: ${JSON.stringify(mobileDocument)}`);
  assert.ok(homeActionBounds && (homeActionBounds.y >= mobilePromptBounds.y + mobilePromptBounds.height
    || mobilePromptBounds.y >= homeActionBounds.y + homeActionBounds.height),
  `the update notice should not cover the Home screen start action: ${JSON.stringify({ mobilePromptBounds, homeActionBounds })}`);
  await page.screenshot({ path: resolve(artifactDirectory, `pwa-update-prompt-mobile-${date}.png`), fullPage: true });
  await homeAction.scrollIntoViewIfNeeded();
  const homeActionHitTarget = await page.evaluate(() => {
    const button = document.querySelector("button.home-start");
    const rect = button?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    return {
      buttonBounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      buttonVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight),
      hitIsStartAction: Boolean(button && hit && (hit === button || button.contains(hit))),
    };
  });
  assert.ok(homeActionHitTarget.buttonVisible && homeActionHitTarget.hitIsStartAction,
    `the Home start action should receive a mobile pointer hit: ${JSON.stringify(homeActionHitTarget)}`);
  report.scenarios.mobilePrompt = {
    status: "passed",
    viewport: "320x568",
    document: mobileDocument,
    promptBounds: mobilePromptBounds,
    buttonBounds: mobileButtonBounds,
    homeActionBounds: homeActionBounds,
    homeActionHitTarget,
    screenshot: `pwa-update-prompt-mobile-${date}.png`,
  };

  const documentLoadsBeforeUpdate = await page.evaluate(() => Number(sessionStorage.getItem("pwa-update-test-document-loads") ?? "0"));
  await promptButton.focus();
  assert.equal(await promptButton.evaluate((button) => document.activeElement === button), true, "the mobile update action should accept keyboard focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction((before) => Number(sessionStorage.getItem("pwa-update-test-document-loads") ?? "0") > before, documentLoadsBeforeUpdate);
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === "activated" && !registration.waiting && Boolean(navigator.serviceWorker.controller);
  });
  const activeVersion = await page.evaluate(() => new Promise((resolveVersion, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolveVersion(event.data);
    channel.port1.onmessageerror = () => reject(new Error("Could not read the active worker version."));
    navigator.serviceWorker.controller?.postMessage({ type: "__PWA_TEST_VERSION__" }, [channel.port2]);
    window.setTimeout(() => reject(new Error("Active service worker did not answer its version probe.")), 3000);
  }));
  assert.equal(activeVersion, 2, "Reload and update activates the waiting version before reloading");
  const updateAfter = await page.evaluate(() => ({
    documentLoads: Number(sessionStorage.getItem("pwa-update-test-document-loads") ?? "0"),
    promptPresent: Boolean(document.querySelector(".pwa-update-prompt")),
  }));
  assert.equal(updateAfter.promptPresent, false, "the update prompt clears after the new worker takes control");
  report.scenarios.activation = {
    status: "passed",
    input: "Enter key while the update action is focused at 320x568",
    documentReloaded: updateAfter.documentLoads > documentLoadsBeforeUpdate,
    activeWorkerVersion: activeVersion,
    promptCleared: true,
  };

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Connection paused" }).waitFor({ state: "visible" });
  const offlineText = await page.locator("body").innerText();
  assert.match(offlineText, /offline playtest reference/i);
  await page.screenshot({ path: resolve(artifactDirectory, `pwa-offline-fallback-${date}.png`), fullPage: true });
  report.scenarios.offlineFallback = { status: "passed", heading: "Connection paused", pageContainsReference: /offline playtest reference/i.test(offlineText) };
  await context.close();
  assert.deepEqual(report.runtimeErrors, [], "PWA update scenarios complete without browser runtime errors");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  report.finished = new Date().toISOString();
  report.servedPaths = servedPaths;
  const artifact = resolve(artifactDirectory, `pwa-update-${date}.json`);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  await gameContext?.close().catch(() => undefined);
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  console.log(JSON.stringify({ ...report, artifact }, null, 2));
}
