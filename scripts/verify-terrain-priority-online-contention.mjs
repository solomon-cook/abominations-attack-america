import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd();
const apiRoot = join(root, "apps/api");
const viteBin = join(root, "node_modules/vite/bin/vite.js");
const apiEntry = join(apiRoot, "src/server.ts");
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([^=]+)=(.*)$/);
  if (match) return [match[1], match[2]];
  if (argument.startsWith("--")) return [argument.slice(2), true];
  throw new Error(`Unexpected argument: ${argument}`);
}));

if (options.help) {
  console.log("Usage: node scripts/verify-terrain-priority-online-contention.mjs [--a=baseline-dist] [--b=candidate-dist] [--pairs=7] [--output=output/performance/terrain-priority-online-contention.json]");
  process.exit(0);
}

const builds = {
  A: { key: "A", label: String(options["a-label"] ?? "A (baseline)"), path: resolve(root, String(options.a ?? "output/performance/terrain-priority-baseline-dist")) },
  B: { key: "B", label: String(options["b-label"] ?? "B (visible priority)"), path: resolve(root, String(options.b ?? "apps/web/dist")) },
};
const pairs = Number(options.pairs ?? 1);
assert.ok(Number.isInteger(pairs) && pairs >= 1 && pairs <= 12, "--pairs must be an integer from 1 to 12");
const outputPath = resolve(root, String(options.output ?? "output/performance/terrain-priority-online-contention.json"));
const viewportOptions = [
  { name: "desktop", width: 1280, height: 720, dpr: 1 },
  { name: "phone", width: 390, height: 844, dpr: 2 },
];
const webPort = 4173;
const apiPort = 8787;
const webUrl = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://localhost:${apiPort}`;
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a local port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }))).flat().sort();
};

const digestBuild = async (directory) => {
  const hash = createHash("sha256");
  const terrainHash = createHash("sha256");
  let terrainFiles = 0;
  const files = await listFiles(directory);
  for (const path of files) {
    const name = relative(directory, path).split("\\").join("/");
    const bytes = await readFile(path);
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    if (name.startsWith("assets/board/audited/")) {
      terrainHash.update(name);
      terrainHash.update("\0");
      terrainHash.update(bytes);
      terrainFiles += 1;
    }
  }
  return { sha256: hash.digest("hex"), terrainAssetTreeSha256: terrainHash.digest("hex"), terrainAssetFiles: terrainFiles, fileCount: files.length };
};

const startProcess = async ({ command, args, cwd, env, label, ready }) => {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited early (${child.exitCode}).\n${output}`);
    try {
      if (await ready()) return { child, output: () => output };
    } catch { /* still starting */ }
    await wait(100);
  }
  throw new Error(`${label} failed to become ready.\n${output}`);
};

const stopProcess = async (handle) => {
  if (!handle?.child || handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((done) => handle.child.once("exit", done)),
    wait(2500).then(() => handle.child.kill("SIGKILL")),
  ]);
};

const startPreview = async (build) => startProcess({
  command: process.execPath,
  args: [viteBin, "preview", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort", "--outDir", build.path],
  cwd: join(root, "apps/web"),
  env: process.env,
  label: `Vite preview ${build.key}`,
  ready: async () => (await fetch(webUrl)).ok,
});

const createPagePair = async ({ browser, viewport }) => {
  const contextOptions = {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: viewport.width <= 600,
    hasTouch: viewport.width <= 600,
    serviceWorkers: "block",
  };
  const context = await browser.newContext(contextOptions);
  const opponentContext = await browser.newContext(contextOptions);
  const first = await context.newPage();
  const second = await opponentContext.newPage();
  first.setDefaultTimeout(15000);
  second.setDefaultTimeout(15000);
  const pageErrors = [];
  first.on("pageerror", (error) => pageErrors.push(error.message));
  second.on("pageerror", (error) => pageErrors.push(error.message));
  for (const page of [first, second]) {
    await page.route((requestUrl) => {
      const url = new URL(requestUrl);
      return url.origin === apiUrl && url.pathname === "/accounts/me";
    }, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
        addEventListener() {}, removeEventListener() {}, async register() { return { waiting: null, addEventListener() {}, removeEventListener() {} }; }, async getRegistration() { return undefined; },
      } });
      const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
      const observerStatus = {};
      const observedEntries = { event: [], longtask: [], "long-animation-frame": [] };
      const serializeAttribution = (item) => ({
        name: item.name ?? null,
        containerType: item.containerType ?? null,
        containerName: item.containerName ?? null,
        containerId: item.containerId ?? null,
        containerSrc: item.containerSrc ?? null,
      });
      const serializeEntry = (type, entry) => {
        const common = { name: entry.name, startTime: entry.startTime, duration: entry.duration };
        if (type === "event") {
          const processingStart = Number.isFinite(entry.processingStart) ? entry.processingStart : null;
          const processingEnd = Number.isFinite(entry.processingEnd) ? entry.processingEnd : null;
          return {
            ...common,
            interactionId: entry.interactionId ?? 0,
            cancelable: entry.cancelable ?? null,
            processingStart,
            processingEnd,
            inputDelayMs: processingStart === null ? null : Math.max(0, processingStart - entry.startTime),
            handlerProcessingMs: processingStart === null || processingEnd === null ? null : Math.max(0, processingEnd - processingStart),
            presentationDelayMs: processingEnd === null ? null : entry.duration - (processingEnd - entry.startTime),
            phaseTimingConsistent: processingEnd === null ? null : entry.duration >= processingEnd - entry.startTime,
          };
        }
        if (type === "longtask") {
          return { ...common, attribution: [...(entry.attribution ?? [])].map(serializeAttribution) };
        }
        return {
          ...common,
          renderStart: entry.renderStart ?? null,
          styleAndLayoutStart: entry.styleAndLayoutStart ?? null,
          firstUIEventTimestamp: entry.firstUIEventTimestamp ?? null,
          blockingDuration: entry.blockingDuration ?? null,
          scripts: [...(entry.scripts ?? [])].map((script) => ({
            invoker: script.invoker ?? null,
            invokerType: script.invokerType ?? null,
            sourceURL: script.sourceURL ?? null,
            sourceFunctionName: script.sourceFunctionName ?? null,
            executionStart: script.executionStart ?? null,
            duration: script.duration ?? null,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? null,
          })),
        };
      };
      for (const [type, options] of [
        ["event", { type: "event", buffered: true, durationThreshold: 16 }],
        ["longtask", { type: "longtask", buffered: true }],
        ["long-animation-frame", { type: "long-animation-frame", buffered: true }],
      ]) {
        if (!supportedEntryTypes.includes(type)) {
          observerStatus[type] = { supported: false, observing: false, error: null };
          continue;
        }
        try {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries().map((entry) => serializeEntry(type, entry));
            observedEntries[type].push(...entries);
            if (observedEntries[type].length > 2000) observedEntries[type].splice(0, observedEntries[type].length - 2000);
          });
          observer.observe(options);
          observerStatus[type] = { supported: true, observing: true, error: null };
        } catch (error) {
          observerStatus[type] = { supported: true, observing: false, error: String(error) };
        }
      }
      window.__terrainPerformanceObservers = {
        supportedEntryTypes: [...supportedEntryTypes],
        observerStatus,
        observedEntries,
      };

      const terrainSnapshotNodes = new Map();
      const terrainSnapshotTimes = new Map();
      window.__captureVisibleTerrainSnapshot = (label) => {
        const startedAt = performance.now();
        const images = [...document.querySelectorAll("img.audited-terrain")].map((image) => {
          const rect = image.getBoundingClientRect();
          const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
          const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
          if (!visibleWidth || !visibleHeight) return null;
          const source = image.currentSrc || image.src;
          const path = new URL(source, location.href).pathname;
          const match = path.match(/\/assets\/board\/audited\/(256|512|1024)\//);
          return {
            element: image,
            cell: image.dataset.artCell ?? null,
            path,
            requestedVariant: match ? Number(match[1]) : null,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            loadedAtRequestedVariant: Boolean(match && image.complete && image.naturalWidth >= Number(match[1])),
            visibleWidth,
            visibleHeight,
          };
        }).filter(Boolean);
        terrainSnapshotTimes.set(label, startedAt);
        terrainSnapshotNodes.set(label, images.map(({ element, path, cell, requestedVariant }) => ({ element, path, cell, requestedVariant })));
        const byVariant = {};
        for (const variant of [256, 512, 1024, "unknown"]) {
          const matching = images.filter((image) => (image.requestedVariant ?? "unknown") === variant);
          if (matching.length) byVariant[variant] = {
            count: matching.length,
            loadedCount: matching.filter((image) => image.complete && image.naturalWidth > 0).length,
            loadedAtRequestedVariantCount: matching.filter((image) => image.loadedAtRequestedVariant).length,
          };
        }
        return {
          label,
          capturedAt: startedAt,
          imageDecodeInterpretation: "complete and naturalWidth are passive loaded-image signals; HTMLImageElement does not expose decode-ready state synchronously",
          visibleImageCount: images.length,
          byRequestedVariant: byVariant,
          images: images.map(({ element: _element, ...image }) => image),
        };
      };
      window.__verifyVisibleTerrainDecodeAfterConfirm = async () => {
        const images = terrainSnapshotNodes.get("confirm") ?? [];
        const probeStartedAt = performance.now();
        const imageResults = await Promise.all(images.map(async ({ element, path, cell, requestedVariant }) => {
          if (new URL(element.currentSrc || element.src, location.href).pathname !== path) {
            return { cell, path, requestedVariant, status: "source-changed-after-confirm", waitMs: null };
          }
          try {
            await element.decode();
            return { cell, path, requestedVariant, status: "decoded-after-confirm", waitMs: performance.now() - probeStartedAt };
          } catch (error) {
            return { cell, path, requestedVariant, status: "decode-rejected-after-confirm", error: String(error), waitMs: performance.now() - probeStartedAt };
          }
        }));
        return {
          probeStartedAt,
          delayAfterConfirmSnapshotMs: probeStartedAt - (terrainSnapshotTimes.get("confirm") ?? probeStartedAt),
          interpretation: "decode() is invoked only after the Confirm endpoint has been recorded; this verifies readiness after the endpoint and does not represent decoded state at the endpoint",
          images: imageResults,
        };
      };
      window.addEventListener("board-camera-change", (event) => {
        const requestedPx = event.detail.tilePixels * (window.devicePixelRatio || 1) * 2;
        const targetSize = requestedPx > 512 ? 1024 : requestedPx > 256 ? 512 : 256;
        const config = window.__terrainApiContentionConfig;
        if (!config || targetSize < 512 || window.__terrainApiProbe) return;
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const startedAt = performance.now();
        window.__terrainApiProbeStarted = { timeOrigin: performance.timeOrigin, startedAt, startedWallTime: Date.now(), targetSize };
        performance.mark("terrain-api-probe-start");
        window.__terrainApiProbe = fetch(`${config.api}/rooms/${config.roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`, { cache: "no-store" }).then(async (response) => {
          const body = await response.json();
          const endedAt = performance.now();
          performance.mark("terrain-api-probe-end");
          window.__terrainApiProbeResult = { status: response.status, body, durationMs: endedAt - startedAt, startedAt, endedAt, startedWallTime: window.__terrainApiProbeStarted.startedWallTime, endedWallTime: Date.now() };
          return window.__terrainApiProbeResult;
        });
      });
    });
  }
  const session = await context.newCDPSession(first);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.setBypassServiceWorker", { bypass: true });
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular3g" });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const networkState = new Map();
  let wallMonoOffset = null;
  const classify = (url) => new URL(url).pathname.match(/\/assets\/board\/audited\/(256|512|1024)\/.*\.webp$/)?.[1] ?? null;
  session.on("Network.requestWillBeSent", (event) => {
    if (wallMonoOffset === null && event.wallTime !== undefined) wallMonoOffset = event.wallTime - event.timestamp;
    const path = new URL(event.request.url).pathname;
    const variant = classify(event.request.url);
    if (variant) networkState.set(event.requestId, {
      requestId: event.requestId,
      path,
      variant: Number(variant),
      startMonotonicSec: event.timestamp,
      priority: event.request.initialPriority ?? null,
      receivedBytes: 0,
      receivedChunks: [],
      encodedBytes: null,
      failed: null,
    });
  });
  session.on("Network.resourceChangedPriority", (event) => {
    const request = networkState.get(event.requestId);
    if (request) (request.priorityChanges ??= []).push({ timestampSec: event.timestamp, newPriority: event.newPriority });
  });
  session.on("Network.dataReceived", (event) => {
    const request = networkState.get(event.requestId);
    if (request) {
      const encodedBytes = event.encodedDataLength ?? 0;
      request.receivedBytes += encodedBytes;
      request.receivedChunks.push({ timestampSec: event.timestamp, encodedBytes });
    }
  });
  session.on("Network.loadingFinished", (event) => {
    const request = networkState.get(event.requestId);
    if (request) {
      request.endMonotonicSec = event.timestamp;
      request.encodedBytes = event.encodedDataLength ?? null;
    }
  });
  session.on("Network.loadingFailed", (event) => {
    const request = networkState.get(event.requestId);
    if (request) {
      request.endMonotonicSec = event.timestamp;
      request.failed = { errorText: event.errorText, canceled: event.canceled ?? false };
    }
  });
  return { context, opponentContext, first, second, session, networkState, pageErrors, getWallMonoOffset: () => wallMonoOffset };
};

const requestState = async (page, code) => page.evaluate(async ({ api, roomCode }) => {
  const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
  const response = await fetch(`${api}/rooms/${roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`);
  return { status: response.status, body: await response.json() };
}, { api: apiUrl, roomCode: code });

const performSetupAction = async (page, code, action) => page.evaluate(async ({ api, roomCode, setupAction }) => {
  const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
  const currentResponse = await fetch(`${api}/rooms/${roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`);
  const current = await currentResponse.json();
  const response = await fetch(`${api}/rooms/${roomCode}/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
    body: JSON.stringify({ expectedRevision: current.version, action: setupAction }),
  });
  const body = await response.json();
  return { status: response.status, error: body.error };
}, { api: apiUrl, roomCode: code, setupAction: action });

const prepareOnlineGame = async ({ first, second }) => {
  await Promise.all([first.goto(webUrl, { waitUntil: "domcontentloaded" }), second.goto(webUrl, { waitUntil: "domcontentloaded" })]);
  await first.locator("details.home-online > summary").click();
  await first.getByLabel("Display name").fill("Terrain contention player one");
  await first.getByLabel("Room privacy").selectOption("private");
  await first.getByRole("button", { name: "Create", exact: true }).click();
  await first.waitForFunction(() => document.querySelector(".lobby strong")?.textContent?.trim().length > 0);
  const roomCode = (await first.locator(".lobby strong").first().textContent())?.trim();
  assert.ok(roomCode, "online game UI exposes its newly created room code");
  await second.locator("details.home-online > summary").click();
  await second.getByLabel("Display name").fill("Terrain contention player two");
  await second.getByLabel("Room code").fill(roomCode);
  await second.getByRole("button", { name: "Join", exact: true }).click();
  await Promise.all([first.locator(".setup-panel").waitFor({ state: "visible" }), second.locator(".setup-panel").waitFor({ state: "visible" })]);
  const initial = await requestState(first, roomCode);
  assert.equal(initial.status, 200, "memory API exposes the setup definition to the player session");
  const lairOne = initial.body.state.setupState?.definition?.lairsByMonster?.["monster-1"]?.[0];
  const lairTwo = initial.body.state.setupState?.definition?.lairsByMonster?.["monster-2"]?.find((lair) => lair !== lairOne);
  assert.ok(lairOne && lairTwo, "development setup contains two non-conflicting monster lairs");
  const choices = [
    [first, { type: "choose-monster", monsterId: "monster-1" }],
    [second, { type: "choose-monster", monsterId: "monster-2" }],
    [second, { type: "choose-branch", branch: "Army" }],
    [first, { type: "choose-branch", branch: "Navy" }],
    [first, { type: "choose-lair", lair: lairOne }],
    [second, { type: "choose-lair", lair: lairTwo }],
    [first, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [second, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ];
  for (const [page, action] of choices) {
    const result = await performSetupAction(page, roomCode, action);
    assert.equal(result.status, 200, `memory API accepts ${action.type}: ${result.error ?? ""}`);
  }
  for (const [page, label] of [[first, "first player"], [second, "second player"]]) {
    const result = await page.evaluate(async ({ api, code }) => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(`${api}/rooms/${code}/ready`, {
        method: "POST", headers: { "content-type": "application/json", "x-room-token": session.token ?? "" }, body: JSON.stringify({ ready: true }),
      });
      return { status: response.status, body: await response.json() };
    }, { api: apiUrl, code: roomCode });
    assert.equal(result.status, 200, `${label} enters Ready state through the local memory API`);
  }
  await first.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online" && document.querySelector(".action-card h2")?.textContent?.trim() === "Move", null, { timeout: 20000 });
  await second.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online", null, { timeout: 20000 });
  if (await first.locator(".onboarding").isVisible()) await first.getByRole("button", { name: /Got it.*hide guide/ }).click();
  await second.context().close();
  const current = await requestState(first, roomCode);
  assert.equal(current.status, 200, "the active UI is backed by an authenticated memory API room");
  return { roomCode, stateVersion: current.body.version, activePlayer: current.body.state.currentPlayer };
};

const visibleDecodedInitialTerrain = async (page) => page.waitForFunction(() => {
  const visible = [...document.querySelectorAll("img.audited-terrain")].filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  });
  return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
}, null, { polling: "raf", timeout: 45000 });

const unobstructedPoint = async (page) => page.locator(".board-viewport").evaluate((element) => {
  const rect = element.getBoundingClientRect();
  for (const y of [.5, .25, .75, .1, .9]) for (const x of [.5, .25, .75, .1, .9]) {
    const px = rect.left + rect.width * x;
    const py = rect.top + rect.height * y;
    const hit = document.elementFromPoint(px, py);
    if (hit && element.contains(hit)) return { x: Math.round(px), y: Math.round(py) };
  }
  return null;
});

const zoomBoard = async ({ page, session, viewport }) => {
  await visibleDecodedInitialTerrain(page);
  const point = await unobstructedPoint(page);
  assert.ok(point, "online board camera has an unobstructed zoom point");
  const before = await page.locator(".board-viewport").getAttribute("data-camera-zoom");
  if (viewport.width <= 600) {
    const near = 28;
    const far = 108;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x - near, y: point.y, id: 2 }, { x: point.x + near, y: point.y, id: 3 }] });
    for (let step = 1; step <= 16; step += 1) {
      const separation = near + (far - near) * step / 16;
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x - separation, y: point.y, id: 2 }, { x: point.x + separation, y: point.y, id: 3 }] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(point.x, point.y);
    for (let step = 0; step < 10; step += 1) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(16);
    }
  }
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const after = await page.locator(".board-viewport").getAttribute("data-camera-zoom");
  assert.ok(Number(after) > Number(before), "online board camera zoom gesture increases zoom");
  const probeStartedHandle = await page.waitForFunction(() => window.__terrainApiProbeStarted ?? false, null, { polling: "raf", timeout: 5000 });
  const probeStarted = await probeStartedHandle.jsonValue();
  const desired = await page.evaluate(() => {
    const sources = [...document.querySelectorAll("img.audited-terrain")].map((image) => new URL(image.currentSrc || image.src, location.href).pathname);
    return Math.max(0, ...sources.map((path) => Number(path.match(/\/audited\/(256|512|1024)\//)?.[1] ?? 0)));
  });
  assert.ok(desired >= 512, `zoom starts terrain upgrades to at least 512 px; max observed ${desired}`);
  return { beforeZoom: Number(before), afterZoom: Number(after), targetSize: desired, apiProbeStartedDuringGesture: probeStarted, gestureCompletedAt: await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now(), wallTime: Date.now() })) };
};

const findVisibleLegalDestination = async (page) => page.waitForFunction(() => {
  const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")];
  return tiles.some((tile) => {
    const rect = tile.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return document.elementFromPoint(point.x, point.y)?.closest(".hex-tile") === tile;
  });
}, null, { polling: "raf", timeout: 12000 });

const runInteractionAndApiProbe = async ({ page, networkState, wallMonoOffset, isPhone }) => {
  await findVisibleLegalDestination(page);
  const probeStarted = await page.evaluate(() => window.__terrainApiProbeStarted);
  assert.ok(probeStarted, "the API probe starts automatically when the camera first requests upgraded terrain");
  const pendingAt = (performanceMs) => {
    const moment = probeStarted.timeOrigin / 1000 + performanceMs / 1000;
    const monotonicMoment = moment - (wallMonoOffset ?? 0);
    return [...networkState.values()].filter((request) => request.variant >= 512
      && request.startMonotonicSec <= monotonicMoment
      && (request.endMonotonicSec === undefined || request.endMonotonicSec > monotonicMoment));
  };
  const activeRequestSnapshotAt = (performanceMs, label) => {
    const moment = probeStarted.timeOrigin / 1000 + performanceMs / 1000;
    const monotonicMoment = moment - (wallMonoOffset ?? 0);
    const requests = pendingAt(performanceMs).map((request) => ({
      requestId: request.requestId,
      path: request.path,
      variant: request.variant,
      priority: request.priorityChanges?.filter((change) => change.timestampSec <= monotonicMoment).at(-1)?.newPriority ?? request.priority,
      initialPriority: request.priority,
      startedAgoMs: Math.max(0, (monotonicMoment - request.startMonotonicSec) * 1000),
      encodedBytesReceived: request.receivedChunks.filter((chunk) => chunk.timestampSec <= monotonicMoment).reduce((sum, chunk) => sum + chunk.encodedBytes, 0),
    }));
    const byVariant = {};
    for (const request of requests) {
      const key = String(request.variant);
      const summary = byVariant[key] ??= { count: 0, encodedBytesReceived: 0, priorities: {} };
      summary.count += 1;
      summary.encodedBytesReceived += request.encodedBytesReceived;
      const priority = request.priority ?? "unknown";
      summary.priorities[priority] = (summary.priorities[priority] ?? 0) + 1;
    }
    return {
      label,
      timeOrigin: probeStarted.timeOrigin,
      performanceTime: performanceMs,
      activeCount: requests.length,
      activeEncodedBytesReceived: requests.reduce((sum, request) => sum + request.encodedBytesReceived, 0),
      byVariant,
      requests,
    };
  };
  const upgradesAtApiStart = pendingAt(probeStarted.startedAt);
  const destination = await page.locator(".hex-tile.legal:not(:disabled)").evaluateAll((tiles) => tiles.map((tile) => {
    const rect = tile.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    return { tile, x, y, visible, hit: visible && document.elementFromPoint(x, y)?.closest(".hex-tile") === tile, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) };
  }).filter((entry) => entry.hit).sort((a, b) => a.distance - b.distance).map(({ tile, x, y }) => ({ key: tile.getAttribute("data-hex-key"), x, y }))[0] ?? null);
  assert.ok(destination, "the post-zoom online game has a visible hit-testable legal tile");
  const selectionStarted = await page.evaluate(() => {
    const visibleTerrain = window.__captureVisibleTerrainSnapshot?.("tap") ?? null;
    const now = performance.now();
    performance.mark("terrain-ui-selection-start");
    return { timeOrigin: performance.timeOrigin, now, wallTime: Date.now(), visibleTerrain };
  });
  if (isPhone) await page.touchscreen.tap(destination.x, destination.y);
  else await page.mouse.click(destination.x, destination.y);
  const confirmation = await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === "Confirm move" || candidate.textContent.trim() === "Confirm move");
    if (!button || button.disabled) return false;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const visibleTerrain = window.__captureVisibleTerrainSnapshot?.("confirm") ?? null;
    const confirmVisibleAt = performance.now();
    performance.mark("terrain-ui-confirm-visible");
    return { confirmVisibleAt, wallTime: Date.now(), visibleTerrain };
  }, null, { polling: "raf", timeout: 12000 }).then((handle) => handle.jsonValue());
  const browserPerformance = await page.evaluate(async ({ startTime, endTime }) => {
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    await new Promise((resolveTask) => setTimeout(resolveTask, 0));
    const state = window.__terrainPerformanceObservers;
    if (!state) return { available: false, unsupportedObserverTypes: ["event", "longtask", "long-animation-frame"] };
    const entries = Object.fromEntries(Object.entries(state.observedEntries).map(([type, records]) => [
      type,
      records.filter((entry) => type === "event"
        ? entry.startTime >= startTime && entry.startTime <= endTime
        : entry.startTime <= endTime && entry.startTime + entry.duration >= startTime),
    ]));
    return {
      available: true,
      timeOrigin: performance.timeOrigin,
      selectionWindow: { startTime, endTime, durationMs: endTime - startTime },
      supportedEntryTypes: state.supportedEntryTypes,
      observerStatus: state.observerStatus,
      unsupportedObserverTypes: Object.entries(state.observerStatus).filter(([, value]) => !value.supported || !value.observing).map(([type]) => type),
      entries,
    };
  }, { startTime: selectionStarted.now, endTime: confirmation.confirmVisibleAt });
  const decodeVerificationAfterConfirm = await page.evaluate(() => window.__verifyVisibleTerrainDecodeAfterConfirm?.() ?? []);
  const api = await page.evaluate(() => window.__terrainApiProbeResult ?? window.__terrainApiProbe);
  assert.equal(api.status, 200, "online authenticated room-state API probe succeeds during upgrades");
  assert.ok(api.body.state?.phase === "move", "API probe returns the authoritative unchanged Move state");
  const upgradesAtApiEnd = pendingAt(api.endedAt);
  const upgradesAtSelectionStart = pendingAt(selectionStarted.now);
  const upgradesAtConfirmation = pendingAt(confirmation.confirmVisibleAt);
  return {
    api: {
      status: api.status,
      phase: api.body.state.phase,
      version: api.body.version,
      durationMs: api.durationMs,
      start: probeStarted,
      response: { timeOrigin: probeStarted.timeOrigin, endedAt: api.endedAt, endedWallTime: api.endedWallTime },
      priorityUpgradeRequestsInflightAtStart: upgradesAtApiStart.length,
      priorityUpgradeBytesCompletedAtStart: [...networkState.values()].filter((request) => request.variant >= 512 && request.encodedBytes !== null && request.endMonotonicSec <= probeStarted.timeOrigin / 1000 + probeStarted.startedAt / 1000 - (wallMonoOffset ?? 0)).reduce((sum, request) => sum + request.encodedBytes, 0),
      priorityUpgradeRequestsInflightAtResponse: upgradesAtApiEnd.length,
      priorityUpgradeRequestsInflightAtSelectionStart: upgradesAtSelectionStart.length,
      priorityUpgradeRequestsInflightAtConfirmVisible: upgradesAtConfirmation.length,
      activeUpgradeRequestSnapshotAtTap: activeRequestSnapshotAt(selectionStarted.now, "tap"),
      activeUpgradeRequestSnapshotAtConfirm: activeRequestSnapshotAt(confirmation.confirmVisibleAt, "confirm"),
    },
    interaction: {
      destination: destination.key,
      selectionStarted,
      confirmVisible: confirmation,
      clickToConfirmMs: confirmation.confirmVisibleAt - selectionStarted.now,
      decodeVerificationAfterConfirm,
    },
    browserPerformance,
  };
};

const buildDigests = {};
for (const build of Object.values(builds)) buildDigests[build.key] = await digestBuild(build.path);
assert.equal(buildDigests.A.terrainAssetTreeSha256, buildDigests.B.terrainAssetTreeSha256, "baseline and candidate terrain art bytes are identical");

let api;
let activePreview;
let browser;
const samples = [];
try {
  await fetch(`${apiUrl}/health`).then((response) => { if (response.ok) throw new Error(`${apiUrl} is already serving another API; this runner requires an isolated memory API.`); }).catch((error) => {
    if (error.message.includes("already serving")) throw error;
  });
  api = await startProcess({
    command: process.execPath,
    args: ["--import", "tsx/esm", apiEntry],
    cwd: apiRoot,
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(webUrl).origin },
    label: "local in-memory MVP API",
    ready: async () => (await fetch(`${apiUrl}/health`)).ok,
  });
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const schedule = [];
  for (const viewport of viewportOptions) {
    const orders = Array.from({ length: pairs }, (_, index) => index % 2 === 0 ? ["A", "B"] : ["B", "A"]);
    for (let pairIndex = 0; pairIndex < pairs; pairIndex += 1) for (const key of orders[pairIndex]) schedule.push({ viewport, pair: pairIndex + 1, key });
  }
  for (const item of schedule) {
    const build = builds[item.key];
    activePreview = await startPreview(build);
    const harness = await createPagePair({ browser, viewport: item.viewport });
    try {
      const onlineSetup = await prepareOnlineGame(harness);
      await harness.first.evaluate((config) => { window.__terrainApiContentionConfig = config; }, { api: apiUrl, roomCode: onlineSetup.roomCode });
      const zoom = await zoomBoard({ page: harness.first, session: harness.session, viewport: item.viewport });
      const contention = await runInteractionAndApiProbe({
        page: harness.first,
        networkState: harness.networkState,
        wallMonoOffset: harness.getWallMonoOffset(),
        isPhone: item.viewport.width <= 600,
      });
      const allUpgradeRequests = [...harness.networkState.values()].filter((request) => request.variant >= 512);
      const sample = {
        variant: item.key,
        label: build.label,
        pair: item.pair,
        viewport: { name: item.viewport.name, width: item.viewport.width, height: item.viewport.height, deviceScaleFactor: item.viewport.dpr },
        build: buildDigests[item.key],
        onlineFlow: { localApi: "PERSISTENCE=memory", roomCode: onlineSetup.roomCode, initialVersion: onlineSetup.stateVersion, activePlayer: onlineSetup.activePlayer },
        profile: { coldBrowserContext: true, cacheDisabled: true, serviceWorkersBlocked: true, cpuThrottleRate: 4, networkRttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
        zoom,
        contention,
        terrainRequests: {
          countAtEnd: allUpgradeRequests.length,
          initialPriorityCounts: allUpgradeRequests.reduce((counts, request) => { const key = request.priority ?? "unknown"; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
          completedBeforeApiProbeStartBytes: contention.api.priorityUpgradeBytesCompletedAtStart,
          completedByCaptureBytes: allUpgradeRequests.reduce((sum, request) => sum + (request.encodedBytes ?? 0), 0),
          pendingAtCapture: allUpgradeRequests.filter((request) => request.endMonotonicSec === undefined && !request.failed).length,
          failedOrCanceledAtCapture: allUpgradeRequests.filter((request) => request.failed).length,
        },
        pageErrors: harness.pageErrors,
      };
      assert.deepEqual(harness.pageErrors, [], `${item.key} pair ${item.pair} ${item.viewport.name} has no page errors`);
      samples.push(sample);
      console.log(`${item.key} pair ${item.pair} ${item.viewport.name}: API ${contention.api.durationMs.toFixed(1)} ms (${contention.api.priorityUpgradeRequestsInflightAtStart} upgrades in flight); click→Confirm ${contention.interaction.clickToConfirmMs.toFixed(1)} ms`);
      await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: "in-progress", scope: "local memory API and production-build online UI contention experiment", buildDigests, samples }, null, 2)}\n`);
    } finally {
      await harness.context.close();
      await harness.opponentContext.close();
      await stopProcess(activePreview);
      activePreview = undefined;
    }
  }
} finally {
  await browser?.close();
  await stopProcess(activePreview);
  await stopProcess(api);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const paired = viewportOptions.map((viewport) => {
  const rows = Array.from({ length: pairs }, (_, index) => {
    const a = samples.find((sample) => sample.variant === "A" && sample.pair === index + 1 && sample.viewport.name === viewport.name);
    const b = samples.find((sample) => sample.variant === "B" && sample.pair === index + 1 && sample.viewport.name === viewport.name);
    assert.ok(a && b, `pair ${index + 1} is complete for ${viewport.name}`);
    return {
      pair: index + 1,
      apiDeltaMs: b.contention.api.durationMs - a.contention.api.durationMs,
      interactionDeltaMs: b.contention.interaction.clickToConfirmMs - a.contention.interaction.clickToConfirmMs,
      apiInflightUpgrades: { baseline: a.contention.api.priorityUpgradeRequestsInflightAtStart, candidate: b.contention.api.priorityUpgradeRequestsInflightAtStart },
      apiStartStatus: { baseline: a.contention.api.status, candidate: b.contention.api.status },
      apiUpgradeRequestsInFlightAtResponse: { baseline: a.contention.api.priorityUpgradeRequestsInflightAtResponse, candidate: b.contention.api.priorityUpgradeRequestsInflightAtResponse },
      uiUpgradeRequestsInFlightAtSelection: { baseline: a.contention.api.priorityUpgradeRequestsInflightAtSelectionStart, candidate: b.contention.api.priorityUpgradeRequestsInflightAtSelectionStart },
    };
  });
  const aSamples = samples.filter((sample) => sample.variant === "A" && sample.viewport.name === viewport.name);
  const bSamples = samples.filter((sample) => sample.variant === "B" && sample.viewport.name === viewport.name);
  return {
    viewport: viewport.name,
    sampleCountPerBuild: pairs,
    apiMedianMs: { baseline: median(aSamples.map((sample) => sample.contention.api.durationMs)), candidate: median(bSamples.map((sample) => sample.contention.api.durationMs)) },
    interactionMedianMs: { baseline: median(aSamples.map((sample) => sample.contention.interaction.clickToConfirmMs)), candidate: median(bSamples.map((sample) => sample.contention.interaction.clickToConfirmMs)) },
    pairedDeltas: rows,
    allProbesReturned200: [...aSamples, ...bSamples].every((sample) => sample.contention.api.status === 200),
    allApiResponsesOverlappedTerrainUpgrades: [...aSamples, ...bSamples].every((sample) => sample.contention.api.priorityUpgradeRequestsInflightAtResponse > 0),
    allUiSelectionsStartedDuringTerrainUpgrades: [...aSamples, ...bSamples].every((sample) => sample.contention.api.priorityUpgradeRequestsInflightAtSelectionStart > 0),
  };
});
const result = {
  generatedAt: new Date().toISOString(),
  status: paired.every((entry) => entry.allProbesReturned200 && entry.allApiResponsesOverlappedTerrainUpgrades && entry.allUiSelectionsStartedDuringTerrainUpgrades) ? "measured-local-contention" : "contention-overlap-incomplete",
  purpose: "Check whether visible terrain upgrades interfere with one authenticated online room-state API response and a legal-destination UI selection while upgrades are active.",
  interpretation: "Local browser evidence only. It does not model hosted API compute, CDN routing, production database load, other users, or target devices.",
  order: "Per viewport, samples alternate AB then BA; each sample uses a fresh cache-disabled context and newly created in-memory room.",
  api: "Node MVP API on loopback with PERSISTENCE=memory, reached through the same API URL compiled into both production builds.",
  profile: { cpuThrottleRate: 4, networkRttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
  pairsPerViewport: pairs,
  webOrigin: webUrl,
  apiOrigin: apiUrl,
  builds: buildDigests,
  paired,
  samples,
  limitations: [
    "This isolates a room-state GET from the active online player session; game mutations use the existing WebSocket command channel and are not timed by this scenario.",
    "Only the legal-tile selection and its Confirm control are timed on the interface; this does not cover every submenu, text/image resource, or production telemetry.",
    "Results are a local in-memory API/load-shaping experiment, not proof of hosted API response time or behavior under production server contention.",
  ],
};
await mkdir(join(root, "output/performance"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Saved ${outputPath}`);
console.log(JSON.stringify({ status: result.status, paired }, null, 2));
