import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { chromePath } from "./chrome-path.mjs";

const ownsServer = !process.env.BROWSER_TEST_URL;
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      probe.close();
      reject(new Error("Could not determine an ephemeral browser-test port."));
      return;
    }
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_LOCAL_PORT ?? (ownsServer ? await freePort() : 5177));
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = ownsServer
  ? spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const viewportWidth = Number(process.env.BROWSER_TEST_WIDTH ?? 1280);
const viewportHeight = Number(process.env.BROWSER_TEST_HEIGHT ?? 720);
const viewport = `${viewportWidth}x${viewportHeight}`;
const screenshotPath = process.env.BROWSER_TEST_SCREENSHOT_PATH;
const debugPort = Number(process.env.BROWSER_DEBUG_PORT ?? await freePort());
const profile = await mkdtemp(join(tmpdir(), "abominations-browser-"));
// The Ubuntu Edge package in CI can expose DevTools reliably with the legacy
// headless switch, while Chromium/Chrome use the newer implementation.
const headlessFlag = process.env.BROWSER_BINARY === "microsoft-edge" ? "--headless" : "--headless=new";
const chrome = spawn(chromePath, [
  headlessFlag, "--disable-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage", "--disable-features=UseDBus", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*", "--remote-debugging-address=127.0.0.1", `--window-size=${viewport}`,
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
let chromeOutput = "";
chrome.stdout?.on("data", (chunk) => { chromeOutput += chunk.toString(); });
chrome.stderr?.on("data", (chunk) => { chromeOutput += chunk.toString(); });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      if (server.exitCode !== null) break;
      await wait(100);
    }
  }
  if (!ready) {
    server.kill("SIGTERM");
    throw new Error(`Vite did not become ready at ${url}; the child may have exited or failed to bind.\n${serverOutput}`);
  }
}
const debugUrl = `http://127.0.0.1:${debugPort}/json/list`;
let page;
// Edge can take longer than the default Linux Chromium startup window to
// expose its first DevTools page on a shared CI runner. Keep the browser
// assertions unchanged, but allow a bounded 60-second discovery period.
for (let attempt = 0; attempt < 600; attempt += 1) {
  try {
    const response = await fetch(debugUrl);
    const pages = await response.json();
    page = pages.find((candidate) => candidate.type === "page");
    if (page) break;
  } catch {
    // Chrome is still starting.
  }
  await wait(100);
}
if (!page?.webSocketDebuggerUrl) {
  chrome.kill("SIGKILL");
  if (server?.exitCode === null) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  throw new Error(`Chrome debugging page did not become available (exit ${chrome.exitCode ?? "running"}).\n${chromeOutput.trim()}`);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === "Page.javascriptDialogOpening") void command("Page.handleJavaScriptDialog", { accept: true });
});
await command("Page.enable");
await command("Runtime.enable");
if (process.env.BROWSER_TEST_REDUCED_MOTION === "1") {
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
}
await command("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 600 });
await command("Page.navigate", { url });
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const clickButton = async (label) => evaluate(`(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`);
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? document.querySelector(".setup-panel h2")?.textContent?.trim() ?? ""`);

try {
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start development playtest")`, "home screen");
  if (!await clickButton("Play provisional honeycomb")) throw new Error("Home screen did not expose the provisional honeycomb playtest.");
  await waitFor(`document.querySelectorAll(".hex-tile").length === 254`, "provisional honeycomb playtest board");
  const provisionalBoardIdentity = await evaluate(`(() => { const board = document.querySelector("main.game-screen"); return { id: board?.dataset.boardId ?? "", version: board?.dataset.boardVersion ?? "", hash: board?.dataset.boardContentHash ?? "" }; })()`);
  if (provisionalBoardIdentity?.id !== "provisional-authoritative-honeycomb-board" || !provisionalBoardIdentity.version || !provisionalBoardIdentity.hash) {
    throw new Error(`Provisional playtest did not expose its pinned board identity: ${JSON.stringify(provisionalBoardIdentity)}`);
  }
  const provisionalNotice = await evaluate(`document.querySelector(".development-notice .label")?.textContent?.trim() ?? ""`);
  if (!/PROVISIONAL HONEYCOMB PLAYTEST/i.test(provisionalNotice)) throw new Error(`Provisional playtest did not expose its source-status notice: ${provisionalNotice}`);
  const provisionalSurface = await evaluate(`(() => ({ cityLabels: [...document.querySelectorAll(".hex-tile .tile-name")].filter((node) => /Provisional/i.test(node.textContent ?? "")).length, featureLabels: document.querySelectorAll(".hex-tile .provisional-feature-kind").length, unresolvedLabels: [...document.querySelectorAll(".hex-tile .tile-name")].filter((node) => /Unresolved/i.test(node.textContent ?? "")).length }))()`);
  if (provisionalSurface?.cityLabels !== 12 || provisionalSurface.featureLabels !== 23 || provisionalSurface.unresolvedLabels !== 0) throw new Error(`Provisional feature labels were not rendered safely: ${JSON.stringify(provisionalSurface)}`);
  const provisionalContext = await evaluate(`(() => { const tray = document.querySelector(".board-context-tray"); return { visible: Boolean(tray && tray.getBoundingClientRect().width > 0), text: tray?.textContent ?? "" }; })()`);
  if (!provisionalContext?.visible || !/provisional|source-gated/i.test(provisionalContext.text) || !/health|infamy|move/i.test(provisionalContext.text)) throw new Error(`Provisional active-hex context did not disclose its review status or monster details: ${JSON.stringify(provisionalContext)}`);
  if (!await clickButton("Development playtest")) throw new Error("Could not return from provisional playtest to the development fixture.");
  await waitFor(`!!document.querySelector(".setup-panel")`, "development setup");

  for (let attempt = 0; attempt < 30 && await evaluate("!!document.querySelector('.setup-panel')"); attempt += 1) {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll(".setup-options button")].find((candidate) => !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error("Setup presented no enabled choice.");
    await wait(80);
  }
  await waitFor(`!document.querySelector(".setup-panel")`, "completed local setup");
  const setupPhase = await phase();
  if (!/move/i.test(setupPhase)) throw new Error(`Expected Move after setup, got ${setupPhase || "no phase"}.`);
  const closedPanelDecision = await evaluate(`(() => {
    const shell = document.querySelector(".game-screen.game-panel-closed");
    const decision = document.querySelector(".game-screen.game-panel-closed .action-card");
    const rect = decision?.getBoundingClientRect();
    return { closed: Boolean(shell), decisionVisible: Boolean(rect && rect.width > 0 && rect.height > 0) };
  })()`);
  if (!closedPanelDecision?.closed || !closedPanelDecision.decisionVisible) {
    throw new Error(`Closed board view hid the authoritative decision tray: ${JSON.stringify(closedPanelDecision)}`);
  }
  const boardSurface = await evaluate(`(() => ({
    totalHexes: document.querySelectorAll(".hex-tile").length,
    developmentHexes: document.querySelectorAll(".hex-tile.development-fixture").length,
    unresolvedShellHexes: document.querySelectorAll(".hex-tile.unresolved").length,
    unresolvedNodes: document.querySelectorAll(".hex-tile.unresolved .node").length,
    visibleUnresolvedLabels: [...document.querySelectorAll(".hex-tile.unresolved .tile-name")].filter((node) => node.textContent?.trim()).length,
    decorativeMapOverlays: document.querySelectorAll(".map-copy, .region-label").length,
    canonicalAdjacentHexes: document.querySelectorAll(".hex-tile.adjacent").length,
  }))()`);
  const developmentBoardIdentity = await evaluate(`(() => { const board = document.querySelector("main.game-screen"); return { id: board?.dataset.boardId ?? "", version: board?.dataset.boardVersion ?? "", hash: board?.dataset.boardContentHash ?? "" }; })()`);
  if (developmentBoardIdentity?.id !== "development-nine-location" || !developmentBoardIdentity.version || !developmentBoardIdentity.hash) {
    throw new Error(`Development playtest did not expose its pinned board identity: ${JSON.stringify(developmentBoardIdentity)}`);
  }
  const developmentContext = await evaluate(`(() => { const tray = document.querySelector(".board-context-tray"); return { visible: Boolean(tray && tray.getBoundingClientRect().width > 0), text: tray?.textContent ?? "" }; })()`);
  if (!developmentContext?.visible || !/ACTIVE HEX|recorded neighbours/i.test(developmentContext.text) || !/health|infamy|move/i.test(developmentContext.text)) throw new Error(`Development active-hex context tray was not visible, named, or detailed: ${JSON.stringify(developmentContext)}`);
  if (boardSurface?.totalHexes !== 261 || boardSurface?.developmentHexes !== 9 || boardSurface?.unresolvedShellHexes !== 252 || boardSurface?.unresolvedNodes !== 0 || boardSurface?.visibleUnresolvedLabels !== 0 || boardSurface?.decorativeMapOverlays !== 0 || boardSurface?.canonicalAdjacentHexes < 1) {
    throw new Error(`Local browser smoke found an unexpected candidate board surface: ${JSON.stringify(boardSurface)}`);
  }
  const boardGeometry = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(".hex-tile.unresolved")].map((tile) => {
      const rect = tile.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
    });
    const rows = [];
    for (const tile of tiles.sort((a, b) => a.top - b.top || a.left - b.left)) {
      const row = rows.find((candidate) => Math.abs(candidate.top - tile.top) < 2);
      if (row) row.tiles.push(tile);
      else rows.push({ top: tile.top, tiles: [tile] });
    }
    const horizontalGaps = rows.flatMap((row) => row.tiles.sort((a, b) => a.left - b.left).slice(1).map((tile, index) => tile.left - row.tiles[index].right));
    return { rows: rows.length, minimumHorizontalGap: Math.min(...horizontalGaps) };
  })()`, { returnByValue: true });
  if (boardGeometry?.rows !== 13 || Number(boardGeometry.minimumHorizontalGap) < -0.5) {
    throw new Error(`Local browser smoke found overlapping candidate faces: ${JSON.stringify(boardGeometry)}`);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await evaluate('document.querySelector("button[aria-label=\'Zoom board out\']")?.click()');
    await wait(25);
  }
  const minimumZoom = await evaluate('document.querySelector(".map-zoom")?.textContent?.trim()');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await evaluate('document.querySelector("button[aria-label=\'Zoom board in\']")?.click()');
    await wait(25);
  }
  const maximumZoom = await evaluate('document.querySelector(".map-zoom")?.textContent?.trim()');
  if (minimumZoom !== "90%" || maximumZoom !== "175%") {
    throw new Error(`Local browser smoke found incorrect camera bounds: ${JSON.stringify({ minimumZoom, maximumZoom })}`);
  }
  await evaluate('document.querySelector(".map-reset")?.click()');
  if (screenshotPath) {
    // Capture only after accepted-action feedback and its finite transition
    // have settled; otherwise identical runs can hash different animation
    // frames instead of detecting a real visual regression.
    await wait(850);
    await evaluate("window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0");
    await evaluate("document.fonts?.ready");
    await evaluate("Promise.all([...document.images].filter((image) => { const rect = image.getBoundingClientRect(); return rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth; }).map((image) => image.complete ? true : new Promise((resolve) => { const settle = () => resolve(true); image.addEventListener('load', settle, { once: true }); image.addEventListener('error', settle, { once: true }); setTimeout(settle, 1000); })))");
    await wait(50);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  const accessibleControls = await evaluate(`(() => {
    const controls = [...document.querySelectorAll("button, input, select, textarea")];
    const named = controls.every((control) => Boolean(control.textContent?.trim() || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || control.getAttribute("placeholder")));
    return Boolean(document.querySelector("main")) && named;
  })()`);
  if (!accessibleControls) throw new Error("Local browser smoke found an unnamed gameplay control or missing main landmark.");
  const touchTargets = await evaluate(`(() => {
    const selector = ".map-controls button, .game-panel-toggle, .game-screen header .ghost, .action-dock button, .path-controls button, .battle-choice button, .retreat-choice button";
    const controls = [...document.querySelectorAll(selector)].filter((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return controls.length > 0 && controls.every((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    });
  })()`);
  if (!touchTargets) throw new Error("Local browser smoke found a visible gameplay control below the 44px touch-target contract.");

  const invalidAction = await evaluate(`(() => {
    const tile = document.querySelector(".hex-tile.unreachable:disabled");
    if (!tile) return false;
    tile.click();
    return true;
  })()`);
  if (!invalidAction) throw new Error("Local browser smoke found no disabled unreachable destination for invalid-action coverage.");
  await wait(80);
  if (await evaluate(`Boolean(document.querySelector(".path-controls"))`)) throw new Error("An unreachable destination opened movement controls.");
  if (!/^Move$/i.test(await phase())) throw new Error("An unreachable destination changed the Move phase.");

  await waitFor(`document.querySelectorAll(".hex-tile.legal:not(:disabled)").length > 0`, "legal movement destination");
  const selected = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")];
    const tile = tiles.find((candidate) => candidate.getAttribute("data-location-name") === "Denver") ?? tiles[0];
    tile?.click();
    return Boolean(tile);
  })()`);
  if (!selected) throw new Error("No legal movement tile could be selected.");
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "path confirmation controls");
  await clickButton("Cancel");
  if (await evaluate(`!!document.querySelector(".path-controls")`)) throw new Error("Cancel did not clear the movement path.");
  await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")];
    (tiles.find((candidate) => candidate.getAttribute("data-location-name") === "Denver") ?? tiles[0])?.click();
  })()`);
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "path confirmation after cancel");
  await clickButton("Confirm path");
  await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Waiting for server…"`, "pending-action loading state");
  await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "movement result");
  await wait(40);
  const actionFeedback = await evaluate(`(() => { const node = document.querySelector(".action-resolution-feedback"); const animation = document.querySelector(".accepted-arrival, .accepted-path"); return { feedback: Boolean(node && /accepted|authoritative/i.test(node.textContent ?? "")), animation: Boolean(animation) }; })()`);
  if (!actionFeedback?.feedback && !actionFeedback?.animation) throw new Error(`Accepted movement did not expose temporary explanatory feedback: ${JSON.stringify(actionFeedback)}`);
  const afterMove = await phase();
  if (!afterMove) throw new Error("No phase prompt remained after confirming movement.");

  let fight = "not-reached";
  let encounter = "not-reached";
  let deployment = "not-reached";
  let settledPhase = afterMove;
  let finalPhase = settledPhase;
  if (afterMove === "Fight") {
    fight = "verified";
    for (let attempt = 0; attempt < 8 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Fight"`); attempt += 1) {
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button")].filter((button) => !button.disabled);
        const preferred = buttons.find((button) => button.textContent.trim() === "Confirm retreat")
          ?? buttons.find((button) => /^Attack /.test(button.textContent.trim()))
          ?? buttons.find((button) => /^(Resolve fight|Resolve without spending Infamy|Spend 1 Infamy)/.test(button.textContent.trim()))
          ?? buttons.find((button) => button.closest(".retreat-unit"));
        if (!preferred) return false;
        preferred.click();
        return true;
      })()`);
      if (!clicked) throw new Error("Fight exposed no enabled decision control.");
      await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "Fight result");
    }
    if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Fight"`)) throw new Error("Fight did not resolve within the supported decision steps.");
    settledPhase = await phase();
  }
  if (settledPhase === "Encounter") {
    encounter = "verified";
    for (let attempt = 0; attempt < 4 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`); attempt += 1) {
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll(".action-card button")].filter((button) => !button.disabled);
        const preferred = buttons.find((button) => /^(Resolve encounter|Take the city Health benefit|Take 2 Infamy instead|Take )/.test(button.textContent.trim()));
        const button = preferred ?? buttons[0];
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error("Encounter exposed no enabled decision control.");
      await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "Encounter result");
    }
    if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`)) throw new Error("Encounter did not resolve within the supported decision steps.");
  }
  if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy"`)) {
    if (!await clickButton("Pass deployment")) throw new Error("Deploy exposed no pass control after Encounter.");
    deployment = "verified";
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "next Move phase after Deploy");
    finalPhase = await phase();
  }
  if (finalPhase !== "Move") throw new Error(`Expected the development turn to return to Move before terminal-state coverage, got ${finalPhase || "no phase"}.`);
  if (!await clickButton("Concede match")) throw new Error("Local browser smoke exposed no Concede match control.");
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "concession terminal phase");
  const concessionTerminal = await evaluate(`Boolean(document.querySelector(".victory-summary")) && Boolean([...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start another local playtest"))`);
  if (!concessionTerminal) throw new Error("Concession did not expose the terminal victory summary and restart control.");

  console.log(JSON.stringify({ ok: true, url, viewport, setup: "complete", accessibleControls: "verified", touchTargets: "verified", invalidAction: "disabled-unreachable-destination", loadingState: "verified", pathCancel: "verified", pathConfirmation: "verified", fight, encounter, deployment, concessionTerminal: "verified", nextPhase: finalPhase }));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once("exit", resolve));
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
