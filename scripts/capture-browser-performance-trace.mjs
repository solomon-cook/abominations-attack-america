import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd();
const webRoot = join(root, "apps/web");
const distRoot = join(webRoot, "dist");
const viewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([^=]+)=(.*)$/);
  if (match) return [match[1], match[2]];
  if (argument.startsWith("--")) return [argument.slice(2), true];
  throw new Error(`Unexpected argument: ${argument}`);
}));
if (options.help) {
  console.log("Usage: node scripts/capture-browser-performance-trace.mjs [--scenario=all|home|first-selection|camera] [--output-prefix=output/performance/chrome-trace]");
  process.exit(0);
}
const scenarioOption = String(options.scenario ?? "all");
assert.ok(["all", "home", "first-selection", "camera"].includes(scenarioOption), "--scenario must be all, home, first-selection, or camera");
const scenarios = scenarioOption === "all" ? ["home", "first-selection"] : [scenarioOption];
const outputPrefix = resolve(root, String(options["output-prefix"] ?? "output/performance/chrome-trace"));
const categories = [
  "toplevel",
  "blink.user_timing",
  "blink.console",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-v8.compile",
  "v8",
  "loading",
  "netlog",
  "cc",
].join(",");

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a preview port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat().sort();
};

const digestBuild = async () => {
  const files = await listFiles(distRoot);
  const hash = createHash("sha256");
  let totalBytes = 0;
  const mainAssets = [];
  for (const path of files) {
    const bytes = await readFile(path);
    const name = relative(distRoot, path).split("\\").join("/");
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    totalBytes += bytes.length;
    if (name === "index.html" || /^assets\/index-[^/]+\.(?:js|css)$/.test(name) || /^assets\/BoardReview-[^/]+\.js$/.test(name)) {
      mainAssets.push({ path: name, bytes: bytes.length });
    }
  }
  return { sha256: hash.digest("hex"), fileCount: files.length, totalBytes, mainAssets };
};

const waitForServer = async (url, server, readOutput) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      if (server.exitCode !== null) throw new Error(`Vite preview exited before ready.\n${readOutput()}`);
    }
    if (attempt === 119) throw new Error(`Vite preview did not become ready at ${url}.\n${readOutput()}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
};

const setupSignature = (panel) => {
  if (!panel) return "detached";
  return JSON.stringify({
    text: panel.innerText,
    buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
    detailsOpen: [...panel.querySelectorAll("details")].map((details) => details.open),
    busy: panel.getAttribute("aria-busy"),
  });
};

const fulfillHomeApi = async (page, origin) => {
  await page.route("http://localhost:8787/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-room-token",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "GET" && url.pathname === "/accounts/me") return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify({ account: null }) });
    if (request.method() === "GET" && url.pathname === "/leaderboard") return route.fulfill({ status: 200, headers, contentType: "application/json", body: "[]" });
    if (request.method() === "GET" && url.pathname === "/rooms/public") return route.fulfill({ status: 200, headers, contentType: "application/json", body: "[]" });
    return route.fulfill({ status: 404, headers, contentType: "application/json", body: JSON.stringify({ error: `Unexpected trace API request: ${request.method()} ${url.pathname}` }) });
  });
};

const collectHomeReadiness = async (page, url) => {
  await page.goto(url, { waitUntil: "load" });
  await page.locator("#home-title").waitFor({ state: "visible" });
  await page.locator(".home-monster img").evaluate(async (image) => {
    if (!image.complete) await new Promise((resolveLoad, rejectLoad) => {
      image.addEventListener("load", resolveLoad, { once: true });
      image.addEventListener("error", rejectLoad, { once: true });
    });
    if (image.decode) await image.decode();
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    performance.mark("audit-home-ready");
    return {
      timeOrigin: performance.timeOrigin,
      readyMarkMs: performance.getEntriesByName("audit-home-ready").at(-1)?.startTime ?? null,
    };
  });
};

const completeLocalSetup = async (page) => {
  await page.getByRole("combobox", { name: "Number of players" }).selectOption("2");
  await page.evaluate(() => performance.mark("audit-setup-start"));
  await page.getByRole("button", { name: /Start local game/ }).click();
  const panel = page.locator(".setup-panel");
  await panel.waitFor({ state: "visible" });
  for (let choiceIndex = 0; choiceIndex < 18; choiceIndex += 1) {
    if (!(await panel.count())) break;
    const details = panel.locator("details");
    if (await details.count() && !(await details.first().evaluate((node) => node.open))) {
      await details.first().locator("summary").click();
    }
    const choice = panel.locator(".setup-options button:visible:not(:disabled)").first();
    await choice.waitFor({ state: "visible" });
    const before = await panel.evaluate(setupSignature);
    await choice.click();
    await page.waitForFunction((previous) => {
      const current = document.querySelector(".setup-panel");
      return !current || current.getAttribute("aria-busy") !== "true" && JSON.stringify({
        text: current.innerText,
        buttons: [...current.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
        detailsOpen: [...current.querySelectorAll("details")].map((details) => details.open),
        busy: current.getAttribute("aria-busy"),
      }) !== previous;
    }, before, { polling: "raf" });
  }
  await panel.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
};

const selectFirstLegalDestination = async (page, viewport) => {
  const legalTile = page.locator(".hex-tile.legal:not(:disabled)");
  await legalTile.first().waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].some((tile) => {
    const rect = tile.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
  }));
  const destination = await legalTile.evaluateAll((tiles) => tiles.map((tile) => {
    const rect = tile.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    const hit = visible && document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
    return { key: tile.getAttribute("data-hex-key"), x, y, visible, hit, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) };
  }).filter((tile) => tile.visible && tile.hit).sort((a, b) => a.distance - b.distance)[0] ?? null);
  assert.ok(destination, `No visible, hit-testable legal destination at ${viewport.width}x${viewport.height}`);
  return destination;
};

const captureBoardCameraGestures = async ({ page, session, viewport }) => {
  const map = page.locator(".board-viewport");
  await map.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const counts = { canvasStyleMutations: 0, cameraAttributeMutations: 0, terrainSourceMutations: 0 };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (!(target instanceof Element)) continue;
        if (target.matches(".map-canvas") && record.attributeName === "style") counts.canvasStyleMutations += 1;
        else if (target.matches(".board-viewport") && record.attributeName?.startsWith("data-camera-")) counts.cameraAttributeMutations += 1;
        else if (target.matches("img.audited-terrain") && record.attributeName === "src") counts.terrainSourceMutations += 1;
      }
    });
    const board = document.querySelector(".board-viewport");
    if (board) observer.observe(board, { subtree: true, attributes: true, attributeFilter: ["style", "src", "data-camera-zoom", "data-camera-scale"] });
    window.__boardCameraProfile = { counts, observer };
  });
  const bounds = await map.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, "board camera has a measurable viewport");
  const findUnobstructedPoint = () => map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (const yFraction of [.5, .25, .75, .1, .9]) for (const xFraction of [.5, .25, .75, .1, .9]) {
      const x = rect.left + rect.width * xFraction;
      const y = rect.top + rect.height * yFraction;
      const hit = document.elementFromPoint(x, y);
      if (hit && element.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  });
  const start = await findUnobstructedPoint();
  assert.ok(start, `board camera has an unobstructed hit point at ${viewport.width}x${viewport.height}`);
  const panEnd = { x: Math.round(start.x + Math.min(110, bounds.width * .18)), y: Math.round(start.y + Math.min(45, bounds.height * .1)) };
  const initialTerrainReady = await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll("img.audited-terrain")].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  assert.equal(initialTerrainReady, true, `visible initial terrain must be decoded before profiling at ${viewport.width}x${viewport.height}`);
  const terrainAtCameraStart = await page.evaluate(() => {
    const images = [...document.querySelectorAll("img.audited-terrain")];
    const visible = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    return { visibleImages: visible.length, decodedVisibleImages: visible.filter((image) => image.complete && image.naturalWidth > 0).length };
  });
  const beforePan = await page.evaluate(() => ({ zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")), scale: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-scale")) }));
  phaseMark(page, "audit-camera-pan-start");
  if (viewport.width <= 600) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    for (let step = 1; step <= 20; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (panEnd.x - start.x) * step / 20, y: start.y + (panEnd.y - start.y) * step / 20, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(start.x + (panEnd.x - start.x) * step / 20, start.y + (panEnd.y - start.y) * step / 20);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  phaseMark(page, "audit-camera-pan-end");
  const afterPan = await page.evaluate(() => ({ zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")), scale: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-scale")) }));
  assert.equal(afterPan.zoom, beforePan.zoom, "single-pointer drag pans without changing zoom");

  const zoomStart = await findUnobstructedPoint();
  assert.ok(zoomStart, `board camera retains an unobstructed zoom point at ${viewport.width}x${viewport.height}`);
  const zoomBefore = afterPan.zoom;
  phaseMark(page, "audit-camera-zoom-start");
  if (viewport.width <= 600) {
    const initialSeparation = 28;
    const finalSeparation = 108;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
      { x: zoomStart.x - initialSeparation, y: zoomStart.y, id: 2 },
      { x: zoomStart.x + initialSeparation, y: zoomStart.y, id: 3 },
    ] });
    for (let step = 1; step <= 16; step += 1) {
      const separation = initialSeparation + (finalSeparation - initialSeparation) * step / 16;
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
        { x: zoomStart.x - separation, y: zoomStart.y, id: 2 },
        { x: zoomStart.x + separation, y: zoomStart.y, id: 3 },
      ] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(zoomStart.x, zoomStart.y);
    for (let step = 0; step < 10; step += 1) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(16);
    }
  }
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  phaseMark(page, "audit-camera-zoom-gesture-end");
  const afterZoomGesture = await page.evaluate(() => ({ zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")), scale: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-scale")) }));
  assert.ok(afterZoomGesture.zoom > zoomBefore, "wheel or pinch input zooms the board camera");
  const highResolutionTerrainLoaded = await page.waitForFunction(() => [...document.querySelectorAll("img.audited-terrain")].some((image) => {
    const rect = image.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    return visible && /\/(?:512|1024)\//.test(image.currentSrc || image.src) && image.complete && image.naturalWidth > 0;
  }), null, { timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(250);
  phaseMark(page, "audit-camera-zoom-settled");
  const finalState = await page.evaluate(() => {
    const board = document.querySelector(".board-viewport");
    const images = [...document.querySelectorAll("img.audited-terrain")];
    const withinNearbyMargin = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      // TerrainArt's IntersectionObserver uses the viewport with rootMargin: 300px.
      return rect.width > 0 && rect.height > 0 && rect.right > -300 && rect.bottom > -300 && rect.left < innerWidth + 300 && rect.top < innerHeight + 300;
    }).length;
    const visible = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    const profile = window.__boardCameraProfile;
    profile?.observer.disconnect();
    return {
      zoom: Number(board?.getAttribute("data-camera-zoom")),
      scale: Number(board?.getAttribute("data-camera-scale")),
      devicePixelRatio,
      terrainElements: images.length,
      terrainElementsWithinNearbyMargin: withinNearbyMargin,
      terrainElementsOutsideNearbyMargin: images.length - withinNearbyMargin,
      visibleTerrainImages: visible.length,
      visibleTerrainDecoded: visible.filter((image) => image.complete && image.naturalWidth > 0).length,
      visibleHighResolutionDecoded: visible.filter((image) => /\/(?:512|1024)\//.test(image.currentSrc || image.src) && image.complete && image.naturalWidth > 0).length,
      visibleVariantCounts: visible.reduce((counts, image) => {
        const match = (image.currentSrc || image.src).match(/\/(256|512|1024)\//);
        if (match) counts[match[1]] += 1;
        return counts;
      }, { 256: 0, 512: 0, 1024: 0 }),
      counts: profile?.counts ?? null,
    };
  });
  assert.ok(finalState.visibleTerrainImages > 0, "camera zoom keeps terrain tiles in the viewport");
  return { terrainAtCameraStart, beforePan, afterPan, afterZoomGesture, finalState, highResolutionTerrainLoadedWithin8Seconds: highResolutionTerrainLoaded, input: viewport.width <= 600 ? "touch drag and two-finger pinch" : "mouse drag and wheel zoom" };
};

const phaseMark = (page, name) => page.evaluate((label) => {
  performance.mark(label);
  return { timeOrigin: performance.timeOrigin, markMs: performance.getEntriesByName(label).at(-1)?.startTime ?? null };
}, name);

const summarizeTrace = (trace, phaseMarkers) => {
  const events = trace.traceEvents ?? [];
  const threadNames = new Map();
  for (const event of events) {
    if (event.name === "thread_name" && event.ph === "M" && event.args?.name) {
      threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
    }
  }
  const mainThreadKeys = [...threadNames]
    .filter(([, name]) => /(?:CrRendererMain|RendererMain)/i.test(name))
    .map(([key]) => key);
  const mainEvents = events.filter((event) => mainThreadKeys.includes(`${event.pid}:${event.tid}`) && event.ph === "X" && Number.isFinite(event.dur));
  const toMs = (durationUs) => durationUs / 1000;
  const markerEvents = events.filter((event) => typeof event.name === "string" && event.name.startsWith("audit-"));
  const markersByName = new Map(markerEvents.map((event) => [event.name, event.ts]));
  const markers = markerEvents.map((event) => ({ label: event.name, startMsFromTraceStart: toMs(event.ts - trace.traceStartTs), name: event.name, category: event.cat }));

  const summarizeRange = (startName, endName) => {
    const startTs = markersByName.get(startName);
    const endTs = markersByName.get(endName);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return null;
    const inRange = (event) => event.ts <= endTs && event.ts + (Number.isFinite(event.dur) ? event.dur : 0) >= startTs;
    const rangeMainEvents = mainEvents.filter(inRange);
    const longTasks = rangeMainEvents
      .filter((event) => ["RunTask", "Task"].includes(event.name) && event.dur >= 50_000)
      .map((event) => ({ startMsFromPhaseStart: toMs(event.ts - startTs), durationMs: toMs(event.dur), thread: threadNames.get(`${event.pid}:${event.tid}`) }));
    const scriptPattern = /^(?:V8\.(?:ParseProgram|ParseFunction|CompileCode|Compile|CompileIgnition|CollectSourcePositions)|v8\.(?:parseOnBackground|evaluateModule|callFunction)|EvaluateScript|CompileScript|CompileModule)$/;
    const scriptEvents = events.filter((event) => event.ph === "X" && Number.isFinite(event.dur) && scriptPattern.test(event.name) && inRange(event));
    const workByNameThread = new Map();
    for (const event of scriptEvents) {
      const thread = threadNames.get(`${event.pid}:${event.tid}`) ?? "unknown";
      const key = `${event.name} · ${thread}`;
      const group = workByNameThread.get(key) ?? { count: 0, summedDurationMsInclusiveAndPotentiallyOverlapping: 0, maxDurationMs: 0 };
      const durationMs = toMs(event.dur);
      group.count += 1;
      group.summedDurationMsInclusiveAndPotentiallyOverlapping += durationMs;
      group.maxDurationMs = Math.max(group.maxDurationMs, durationMs);
      workByNameThread.set(key, group);
    }
    const imagePattern = /^(?:ImageDecodeTask|Decode Image|Decode LazyPixelRef|GpuImageDecodeTaskImpl::RunOnWorkerThread|GpuImageDecodeCache::DecodeImage|ImageUploadTask|ImageUploadTaskImpl::RunOnWorkerThread|GpuImageDecodeCache::UploadImage)$/;
    const imageEvents = events.filter((event) => event.ph === "X" && Number.isFinite(event.dur) && imagePattern.test(event.name) && inRange(event))
      .map((event) => ({ name: event.name, startMsFromPhaseStart: toMs(event.ts - startTs), durationMs: toMs(event.dur), thread: threadNames.get(`${event.pid}:${event.tid}`) ?? null, args: event.args?.data ?? event.args ?? null }));
    const networkByRequest = new Map();
    for (const event of events) {
      const data = event.args?.data;
      if (!data?.requestId || !["ResourceSendRequest", "ResourceReceiveResponse", "ResourceReceivedData", "ResourceFinish"].includes(event.name)) continue;
      const key = `${event.pid}:${data.requestId}`;
      const request = networkByRequest.get(key) ?? { requestId: data.requestId, startTs: null, finishTs: null, url: null, resourceType: null, priority: null, mimeType: null, statusCode: null, receivedEncodedBytes: 0, encodedDataLength: null, decodedBodyLength: null, didFail: null };
      if (event.name === "ResourceSendRequest") {
        request.startTs = event.ts;
        request.url = data.url ?? null;
        request.resourceType = data.resourceType ?? null;
        request.priority = data.priority ?? null;
      } else if (event.name === "ResourceReceiveResponse") {
        request.mimeType = data.mimeType ?? null;
        request.statusCode = data.statusCode ?? null;
      } else if (event.name === "ResourceReceivedData") {
        request.receivedEncodedBytes += data.encodedDataLength ?? 0;
      } else if (event.name === "ResourceFinish") {
        request.finishTs = event.ts;
        request.encodedDataLength = data.encodedDataLength ?? null;
        request.decodedBodyLength = data.decodedBodyLength ?? null;
        request.didFail = data.didFail ?? null;
      }
      networkByRequest.set(key, request);
    }
    const requests = [...networkByRequest.values()].filter((request) => request.startTs !== null && request.startTs <= endTs && (
      request.startTs >= startTs - 100_000 || (request.finishTs !== null && request.finishTs >= startTs)
    ))
      .map((request) => ({
        url: request.url,
        resourceType: request.resourceType,
        priority: request.priority,
        mimeType: request.mimeType,
        statusCode: request.statusCode,
        startMsFromPhaseStart: toMs(request.startTs - startTs),
        durationMs: request.finishTs === null ? null : toMs(request.finishTs - request.startTs),
        receivedEncodedBytes: request.receivedEncodedBytes,
        encodedDataLength: request.encodedDataLength,
        decodedBodyLength: request.decodedBodyLength,
        didFail: request.didFail,
      })).sort((a, b) => a.startMsFromPhaseStart - b.startMsFromPhaseStart);
    const rasterEvents = events.filter((event) => event.ph === "X" && Number.isFinite(event.dur) && ["RasterTask", "RasterizerTaskImpl::RunOnWorkerThread"].includes(event.name) && inRange(event));
    const renderingNames = new Set(["UpdateLayoutTree", "InvalidateLayout", "Layout", "PrePaint", "Paint", "CompositeLayers", "AnimationFrame::StyleAndLayout", "AnimationFrame::Render"]);
    const renderingEventsByName = new Map();
    for (const event of rangeMainEvents.filter((entry) => renderingNames.has(entry.name))) {
      const group = renderingEventsByName.get(event.name) ?? { count: 0, summedDurationMsInclusiveAndPotentiallyOverlapping: 0, maxDurationMs: 0 };
      const durationMs = toMs(event.dur);
      group.count += 1;
      group.summedDurationMsInclusiveAndPotentiallyOverlapping += durationMs;
      group.maxDurationMs = Math.max(group.maxDurationMs, durationMs);
      renderingEventsByName.set(event.name, group);
    }
    const framePresentationEvents = events.filter((event) => event.name === "FramePresented" && event.ts >= startTs && event.ts <= endTs).sort((a, b) => a.ts - b.ts);
    const drawFrameEvents = events.filter((event) => event.name === "DrawFrame" && event.ts >= startTs && event.ts <= endTs).sort((a, b) => a.ts - b.ts);
    const drawFrameIntervalsMs = drawFrameEvents.slice(1).map((event, index) => toMs(event.ts - drawFrameEvents[index].ts)).filter((value) => value > 0);
    const orderedFrameIntervals = [...drawFrameIntervalsMs].sort((a, b) => a - b);
    const percentile = (values, proportion) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * proportion))] : null;
    return {
      intervalMs: toMs(endTs - startTs),
      mainThreadLongTasksAtLeast50Ms: longTasks,
      mainThreadLongTaskCount: longTasks.length,
      mainThreadLongTaskTotalMs: longTasks.reduce((sum, event) => sum + event.durationMs, 0),
      scriptParseCompileEvaluateEvents: Object.fromEntries(workByNameThread),
      mainThreadStyleLayoutPaintEvents: Object.fromEntries(renderingEventsByName),
      compositorFramePresentation: {
        framePresentedMarkers: framePresentationEvents.length,
        drawFrameCount: drawFrameEvents.length,
        drawFrameIntervalCount: drawFrameIntervalsMs.length,
        medianIntervalMs: percentile(orderedFrameIntervals, .5),
        p95IntervalMs: percentile(orderedFrameIntervals, .95),
        maxIntervalMs: orderedFrameIntervals.length ? orderedFrameIntervals.at(-1) : null,
        droppedFrameMarkers: events.filter((event) => event.name === "DroppedFrame" && event.ts >= startTs && event.ts <= endTs).length,
      },
      imageDecodeUploadEvents: imageEvents,
      rasterTaskCountAcrossThreads: rasterEvents.length,
      rasterTaskTotalMsAcrossThreads: rasterEvents.reduce((sum, event) => sum + toMs(event.dur), 0),
      networkRequests: requests,
    };
  };

  return {
    phaseMarkers,
    rendererMainThreads: mainThreadKeys.map((key) => ({ key, name: threadNames.get(key) })),
    userTimingMarkers: markers,
    phases: {
      coldHomeStartup: summarizeRange("audit-document-start", "audit-home-ready"),
      localSetup: summarizeRange("audit-setup-start", "audit-first-selection-start"),
      firstLegalSelection: summarizeRange("audit-first-selection-start", "audit-confirm-visible"),
      boardCameraPan: summarizeRange("audit-camera-pan-start", "audit-camera-pan-end"),
      boardCameraZoomGesture: summarizeRange("audit-camera-zoom-start", "audit-camera-zoom-gesture-end"),
      boardCameraZoomAndTerrainUpgrade: summarizeRange("audit-camera-zoom-gesture-end", "audit-camera-zoom-settled"),
    },
    traceEventCount: events.length,
  };
};

const build = await digestBuild();
const port = await reservePort();
const url = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] });
let previewOutput = "";
preview.stdout.on("data", (chunk) => { previewOutput += chunk.toString(); });
preview.stderr.on("data", (chunk) => { previewOutput += chunk.toString(); });
let browser;
let stopPreviewPromise;
const stopPreview = () => {
  if (stopPreviewPromise) return stopPreviewPromise;
  stopPreviewPromise = new Promise((resolveStop) => {
    if (preview.exitCode !== null || preview.signalCode !== null) return resolveStop();
    const onExit = () => resolveStop();
    preview.once("exit", onExit);
    if (preview.exitCode !== null || preview.signalCode !== null) {
      preview.off("exit", onExit);
      resolveStop();
      return;
    }
    preview.kill("SIGTERM");
    const forceTimer = setTimeout(() => {
      if (preview.exitCode === null && preview.signalCode === null) preview.kill("SIGKILL");
    }, 2000);
    forceTimer.unref();
  });
  return stopPreviewPromise;
};
let interruptedSignal;
const onSignal = (signal) => {
  interruptedSignal = signal;
  void stopPreview();
  if (browser) void browser.close();
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

const captureCase = async ({ viewport, scenario }) => {
  const deviceScaleFactor = scenario === "camera" && viewport.width <= 600 ? 2 : 1;
  const context = await browser.newContext({ viewport, deviceScaleFactor, isMobile: viewport.width <= 600, hasTouch: viewport.width <= 600, serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.setBypassServiceWorker", { bypass: true });
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular3g" });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => performance.mark("audit-document-start"));
  await fulfillHomeApi(page, new URL(url).origin);

  const traceCompleted = new Promise((resolveTrace, rejectTrace) => {
    const timeout = setTimeout(() => rejectTrace(new Error("Chrome tracing did not finish within 60 seconds.")), 60_000);
    session.once("Tracing.tracingComplete", (result) => { clearTimeout(timeout); resolveTrace(result); });
  });
  await session.send("Tracing.start", { categories, transferMode: "ReturnAsStream", streamFormat: "json", streamCompression: "none", bufferUsageReportingInterval: 1000 });
  let phaseMarkers;
  try {
    const home = await collectHomeReadiness(page, url);
    phaseMarkers = { home, selectionStart: null, confirmVisible: null };
    if (scenario === "first-selection") {
      await completeLocalSetup(page);
      const destination = await selectFirstLegalDestination(page, viewport);
      phaseMarkers.destination = destination.key;
      phaseMarkers.selectionStart = await page.evaluate(() => {
        performance.mark("audit-first-selection-start");
        return { timeOrigin: performance.timeOrigin, markMs: performance.getEntriesByName("audit-first-selection-start").at(-1)?.startTime ?? null };
      });
      const inputMethod = viewport.width <= 600 ? "touch" : "mouse";
      if (inputMethod === "touch") await page.touchscreen.tap(destination.x, destination.y);
      else await page.mouse.click(destination.x, destination.y);
      const confirm = page.getByRole("button", { name: "Confirm move", exact: true });
      await confirm.waitFor({ state: "visible" });
      phaseMarkers.confirmVisible = await page.evaluate(() => {
        performance.mark("audit-confirm-visible");
        return { timeOrigin: performance.timeOrigin, markMs: performance.getEntriesByName("audit-confirm-visible").at(-1)?.startTime ?? null };
      });
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      phaseMarkers.clickToConfirmMs = phaseMarkers.confirmVisible.markMs - phaseMarkers.selectionStart.markMs;
    } else if (scenario === "camera") {
      await completeLocalSetup(page);
      await page.waitForTimeout(300);
      phaseMarkers.camera = await captureBoardCameraGestures({ page, session, viewport });
      const visualPath = `${outputPrefix}-visual-${viewport.width}x${viewport.height}.png`;
      await mkdir(dirname(visualPath), { recursive: true });
      await page.locator(".board-viewport").screenshot({ path: visualPath, animations: "disabled" });
      phaseMarkers.camera.visualScreenshot = relative(root, visualPath);
    }
    assert.deepEqual(pageErrors, [], `${scenario} ${viewport.width}x${viewport.height} logged page errors`);
  } finally {
    await session.send("Tracing.end");
  }

  const { stream } = await traceCompleted;
  const traceChunks = [];
  let eof = false;
  try {
    while (!eof) {
      const result = await session.send("IO.read", { handle: stream, size: 1_048_576 });
      traceChunks.push(Buffer.from(result.data, result.base64Encoded ? "base64" : "utf8"));
      eof = result.eof;
    }
  } finally {
    await session.send("IO.close", { handle: stream }).catch(() => undefined);
  }
  const traceBytes = Buffer.concat(traceChunks);
  const trace = JSON.parse(traceBytes.toString("utf8"));
  const traceStartTs = (trace.traceEvents ?? []).reduce((minimum, event) => Number.isFinite(event.ts) && event.ts > 0 ? Math.min(minimum, event.ts) : minimum, Number.POSITIVE_INFINITY);
  trace.traceStartTs = traceStartTs;
  const summary = summarizeTrace(trace, phaseMarkers);
  const name = `${scenario}-${viewport.width}x${viewport.height}`;
  const tracePath = `${outputPrefix}-${name}.json.gz`;
  const traceObject = { ...trace };
  delete traceObject.traceStartTs;
  const raw = Buffer.from(JSON.stringify(traceObject));
  const compressed = gzipSync(raw, { level: 9 });
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, compressed);
  const result = {
    name,
    scenario,
    viewport,
    deviceScaleFactor,
    tracePath: relative(root, tracePath),
    traceEvents: trace.traceEvents?.length ?? 0,
    rawTraceBytes: raw.length,
    compressedTraceBytes: compressed.length,
    rawTraceSha256: createHash("sha256").update(raw).digest("hex"),
    compressedTraceSha256: createHash("sha256").update(compressed).digest("hex"),
    ...summary,
  };
  await context.close();
  return result;
};

try {
  await waitForServer(url, preview, () => previewOutput);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const traces = [];
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const trace = await captureCase({ viewport, scenario });
      traces.push(trace);
      if (scenario === "camera") console.log(`Captured board pan/zoom at ${viewport.width}x${viewport.height}: zoom ${trace.phaseMarkers.camera.beforePan.zoom}→${trace.phaseMarkers.camera.finalState.zoom}, 512/1024px terrain decoded within 8s=${trace.phaseMarkers.camera.highResolutionTerrainLoadedWithin8Seconds}.`);
    }
  }
  const summary = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    build,
    browser: await browser.version(),
    chromeExecutable: chromePath,
    preview: "Vite production preview from apps/web/dist on loopback and an ephemeral strict port",
    protocol: {
      freshContextPerTrace: true,
      cacheDisabled: true,
      serviceWorkers: "blocked",
      cpuThrottle: "4x",
      network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
      categories: categories.split(","),
      coldHomeWait: "load, #home-title, Megaclaw hero image decode, document.fonts.ready, then 250 ms",
      firstSelection: "2-player local setup through visible UI choices; nearest visible legal tile passing center-point hit test; mouse at desktop, touch at phone; stop at Confirm move visible",
      boardCamera: "after local setup, wait until all currently visible terrain images decode, then run a 20-step mouse/touch drag pan; apply 10 desktop wheel zoom steps or a 16-step two-finger phone pinch; step waits request 16 ms but measured gesture intervals vary substantially; traces event, render, raster, image decode, and network intervals, then waits up to 8 seconds for one visible 512/1024 terrain image to decode; phone device scale factor 2, desktop 1",
      boardCameraMutationCounts: "records map-canvas style attributes, board camera data attributes, terrain image src changes, and terrain element bounds within the existing 300 px observer margin; these are DOM/geometry proxies, not React Profiler commit counts",
      graphics: "production images and rendering resources served unchanged; no screenshots or image interception",
      traceFormat: "Chrome DevTools Protocol Tracing stream JSON, compressed with gzip level 9; each trace includes navigation through the named endpoint",
    },
    traces,
  };
  const summaryPath = `${outputPrefix}-summary.json`;
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Build ${build.sha256}; summary ${relative(root, summaryPath)}`);
  for (const trace of traces) {
    const homeTaskCount = trace.phases.coldHomeStartup?.mainThreadLongTaskCount ?? 0;
    const selectionTaskCount = trace.phases.firstLegalSelection?.mainThreadLongTaskCount;
    const panTasks = trace.phases.boardCameraPan?.mainThreadLongTaskCount;
    const zoomTasks = trace.phases.boardCameraZoomGesture?.mainThreadLongTaskCount;
    console.log(`${trace.name}: ${trace.traceEvents} events, ${trace.rawTraceBytes} B raw / ${trace.compressedTraceBytes} B gzipped; ${homeTaskCount} cold-Home, ${selectionTaskCount ?? "n/a"} selection, ${panTasks ?? "n/a"} pan, and ${zoomTasks ?? "n/a"} zoom main-thread long tasks >=50 ms.`);
  }
} finally {
  if (browser) await browser.close();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
  await stopPreview();
}
