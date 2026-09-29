import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let sharp = null;
try { sharp = require("sharp"); } catch { /* Pixel comparison is reported as unavailable. */ }

const root = process.cwd();
const webRoot = join(root, "apps/web");
const viteBin = join(root, "node_modules/vite/bin/vite.js");
const viewportOptions = [
  { width: 1280, height: 720, deviceScaleFactor: 1, name: "desktop" },
  { width: 390, height: 844, deviceScaleFactor: 2, name: "phone" },
];
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([^=]+)=(.*)$/);
  if (match) return [match[1], match[2]];
  if (argument.startsWith("--")) return [argument.slice(2), true];
  throw new Error(`Unexpected argument: ${argument}`);
}));

if (options.help) {
  console.log("Usage: node scripts/verify-terrain-priority-ab.mjs [--a=dist-A] [--b=dist-B] [--pairs=7] [--seed=12345] [--output=path]");
  process.exit(0);
}

const builds = {
  A: { key: "A", label: String(options["a-label"] ?? "A (baseline)"), path: resolve(root, String(options.a ?? "output/performance/terrain-priority-baseline-dist")) },
  B: { key: "B", label: String(options["b-label"] ?? "B (candidate)"), path: resolve(root, String(options.b ?? "apps/web/dist")) },
};
const pairsPerViewport = Number(options.pairs ?? 7);
assert.ok(Number.isInteger(pairsPerViewport) && pairsPerViewport >= 1 && pairsPerViewport <= 30, "--pairs must be an integer from 1 to 30");
const seedInput = Number(options.seed ?? 20260929);
assert.ok(Number.isInteger(seedInput) && seedInput >= 0 && seedInput <= 0xffffffff, "--seed must be an unsigned 32-bit integer");
const seed = seedInput === 0 ? 0x9e3779b9 : seedInput >>> 0;
const outputPath = resolve(root, String(options.output ?? `output/performance/terrain-priority-ab-${new Date().toISOString().replaceAll(":", "-")}.json`));
const artifactDirectory = outputPath.endsWith(".json") ? outputPath.slice(0, -5) + "-artifacts" : outputPath + "-artifacts";

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat().sort();
};

const digestBuild = async (directory) => {
  const files = await listFiles(directory);
  assert.ok(files.some((path) => relative(directory, path).split("\\").join("/") === "index.html"), `${directory} has no index.html`);
  const hash = createHash("sha256");
  let totalBytes = 0;
  const terrainAssetHashes = {};
  const mainAssets = [];
  for (const path of files) {
    const bytes = await readFile(path);
    const name = relative(directory, path).split("\\").join("/");
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    totalBytes += bytes.length;
    if (name.startsWith("assets/board/audited/")) terrainAssetHashes[`/${name}`] = createHash("sha256").update(bytes).digest("hex");
    if (name === "index.html" || /^assets\/index-[^/]+\.(?:js|css)$/.test(name) || /^assets\/BoardReview-[^/]+\.js$/.test(name)) {
      mainAssets.push({ path: name, bytes: bytes.length });
    }
  }
  return { sha256: hash.digest("hex"), fileCount: files.length, totalBytes, mainAssets, terrainAssetHashes };
};

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a preview port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const startPreview = async (variant) => {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}/`;
  const preview = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", variant.path], {
    cwd: webRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  preview.stdout.on("data", (chunk) => { output += chunk.toString(); });
  preview.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return { preview, url, output: () => output };
    } catch {
      if (preview.exitCode !== null) throw new Error(`Vite preview ${variant.key} exited before ready.\n${output}`);
    }
    if (attempt === 119) throw new Error(`Vite preview ${variant.key} did not become ready at ${url}.\n${output}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Vite preview ${variant.key} did not start.`);
};

const stopPreview = async (handle) => {
  if (!handle?.preview || handle.preview.exitCode !== null || handle.preview.signalCode !== null) return;
  await new Promise((done) => {
    const timer = setTimeout(() => {
      if (handle.preview.exitCode === null && handle.preview.signalCode === null) handle.preview.kill("SIGKILL");
    }, 2000);
    timer.unref();
    handle.preview.once("exit", () => { clearTimeout(timer); done(); });
    handle.preview.kill("SIGTERM");
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
    return route.fulfill({ status: 404, headers, contentType: "application/json", body: JSON.stringify({ error: `Unexpected terrain benchmark API request: ${request.method()} ${url.pathname}` }) });
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

const completeLocalSetup = async (page) => {
  await page.getByRole("combobox", { name: "Number of players" }).selectOption("2");
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
  const legalTiles = page.locator(".hex-tile.legal:not(:disabled)");
  await legalTiles.first().waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].some((tile) => {
    const rect = tile.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
  }));
  const destination = await legalTiles.evaluateAll((tiles) => tiles.map((tile) => {
    const rect = tile.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    const hit = visible && document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
    return { key: tile.getAttribute("data-hex-key"), x, y, visible, hit, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) };
  }).filter((tile) => tile.visible && tile.hit).sort((left, right) => left.distance - right.distance)[0] ?? null);
  assert.ok(destination, `No visible, hit-testable legal destination at ${viewport.width}x${viewport.height}`);
  return destination;
};

const mark = (page, name) => page.evaluate((label) => {
  performance.mark(label);
  return { timeOrigin: performance.timeOrigin, markMs: performance.getEntriesByName(label).at(-1)?.startTime ?? null, wallTimeMs: Date.now() };
}, name);

const waitForTerrainDecodeStable = async (page, label, timeout = 60000) => {
  const handle = await page.waitForFunction(() => {
    const audit = window.__terrainPriorityAudit;
    const expectedSize = audit?.desiredSize;
    if (!expectedSize) return false;
    const visible = [...document.querySelectorAll("img.audited-terrain")].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    if (!visible.length) {
      audit.readiness = null;
      return false;
    }
    const pathOf = (image) => new URL(image.currentSrc || image.src, location.href).pathname;
    if (visible.some((image) => !pathOf(image).includes(`/audited/${expectedSize}/`) || !image.complete || image.naturalWidth <= 0)) {
      audit.readiness = null;
      return false;
    }
    const signature = visible.map((image) => `${image.dataset.artCell}:${pathOf(image)}`).sort().join("\n");
    const readiness = audit.readiness ??= { signature: null, stableSince: 0, decodedSignature: null, decodedNodes: [], decodingSignature: null, completionScheduled: false, completedAt: null };
    if (readiness.signature !== signature) {
      readiness.signature = signature;
      readiness.stableSince = performance.now();
      readiness.decodedSignature = null;
      readiness.decodedNodes = [];
      readiness.decodingSignature = null;
      readiness.completionScheduled = false;
      readiness.completedAt = null;
      return false;
    }
    if (readiness.decodingSignature !== signature && readiness.decodedSignature !== signature) {
      const nodes = [...visible];
      const sources = nodes.map(pathOf);
      readiness.decodingSignature = signature;
      Promise.all(nodes.map((image) => image.decode())).then(() => {
        if (nodes.some((image, index) => pathOf(image) !== sources[index])) {
          readiness.signature = null;
          readiness.stableSince = 0;
          readiness.decodedSignature = null;
          readiness.decodedNodes = [];
          readiness.completionScheduled = false;
          readiness.completedAt = null;
        } else {
          readiness.decodedSignature = signature;
          readiness.decodedNodes = nodes;
        }
        readiness.decodingSignature = null;
      }).catch(() => {
        readiness.signature = null;
        readiness.stableSince = 0;
        readiness.decodedSignature = null;
        readiness.decodedNodes = [];
        readiness.decodingSignature = null;
        readiness.completionScheduled = false;
        readiness.completedAt = null;
      });
    }
    const sameDecodedNodes = readiness.decodedSignature === signature
      && readiness.decodedNodes.length === visible.length
      && visible.every((image) => readiness.decodedNodes.includes(image));
    if (!sameDecodedNodes || performance.now() - readiness.stableSince < 300) return false;
    if (readiness.completedAt !== null) return { signature, imageCount: visible.length, expectedSize, decodedNodes: readiness.decodedNodes.length, atMs: readiness.completedAt };
    if (!readiness.completionScheduled) {
      readiness.completionScheduled = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (readiness.signature === signature && readiness.decodedSignature === signature) readiness.completedAt = performance.now();
      }));
    }
    return false;
  }, null, { polling: "raf", timeout });
  const decoded = await handle.jsonValue();
  const afterFrames = await page.evaluate(() => window.__terrainPriorityAudit.snapshot());
  assert.equal(afterFrames.desiredSize, decoded.expectedSize, `${label}: desired terrain size remains stable after decode frames`);
  assert.equal(afterFrames.visibleCount, decoded.imageCount, `${label}: visible terrain node count stays stable after decode frames`);
  assert.equal(afterFrames.targetResolutionCount, decoded.imageCount, `${label}: all visible terrain remains at requested resolution after decode frames`);
  const afterSignature = afterFrames.visibleSources.map(({ cellId, path }) => `${cellId}:${path}`).sort().join("\n");
  assert.equal(afterSignature, decoded.signature, `${label}: visible cell/source signature remains stable after decode frames`);
  return { decoded, afterFrames, finalSignature: afterFrames.visibleSources.map(({ cellId, path }) => ({ cellId, path })) };
};

const findUnobstructedPoint = (map) => map.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  for (const yFraction of [.5, .25, .75, .1, .9]) for (const xFraction of [.5, .25, .75, .1, .9]) {
    const x = rect.left + rect.width * xFraction;
    const y = rect.top + rect.height * yFraction;
    const hit = document.elementFromPoint(x, y);
    if (hit && element.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
});

const drag = async ({ page, session, start, end, viewport, steps = 20 }) => {
  if (viewport.width <= 600) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    for (let step = 1; step <= steps; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / steps, y: start.y + (end.y - start.y) * step / steps, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(start.x + (end.x - start.x) * step / steps, start.y + (end.y - start.y) * step / steps);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
};

const runCameraFlow = async ({ page, session, viewport, scenarioSeed, screenshotPath }) => {
  await completeLocalSetup(page);
  const destination = await selectFirstLegalDestination(page, viewport);
  const selectionStart = await mark(page, "audit-terrain-first-selection-start");
  if (viewport.width <= 600) await page.touchscreen.tap(destination.x, destination.y);
  else await page.mouse.click(destination.x, destination.y);
  const confirm = page.getByRole("button", { name: "Confirm move", exact: true });
  const confirmVisibleHandle = await page.waitForFunction(() => {
    const button = document.querySelector('.action-dock button[aria-label="Confirm move"]');
    const rect = button?.getBoundingClientRect();
    if (!button || !rect || rect.width <= 0 || rect.height <= 0 || button.disabled) return false;
    if (!performance.getEntriesByName("audit-terrain-confirm-visible").length) performance.mark("audit-terrain-confirm-visible");
    return { timeOrigin: performance.timeOrigin, markMs: performance.getEntriesByName("audit-terrain-confirm-visible").at(-1)?.startTime ?? null, wallTimeMs: Date.now() };
  }, null, { polling: "raf" });
  const confirmVisible = await confirmVisibleHandle.jsonValue();
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const firstSelection = {
    destination: destination.key,
    input: viewport.width <= 600 ? "touch" : "mouse",
    selectionStart,
    confirmVisible,
    clickToConfirmMs: confirmVisible.markMs - selectionStart.markMs,
  };
  // This is teardown after the measured endpoint. Invoke the real cancel
  // control's click handler directly because the mobile command sheet is
  // intentionally collapsed and should remain in its original state.
  const routeCanceled = await page.evaluate(() => {
    const button = [...document.querySelectorAll(".piece-context-options button")].find((candidate) => candidate.textContent?.trim() === "Cancel route");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  assert.equal(routeCanceled, true, "first-selection route teardown finds an enabled Cancel route control");
  await confirm.waitFor({ state: "hidden" });
  await page.waitForTimeout(300);
  const map = page.locator(".board-viewport");
  await map.waitFor({ state: "visible" });
  const initialReady = await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll("img.audited-terrain")].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
  }, null, { polling: "raf", timeout: 30000 }).then(() => true).catch(() => false);
  assert.equal(initialReady, true, `visible initial terrain must be decoded before camera gestures at ${viewport.width}x${viewport.height}`);
  const initialSnapshot = await page.evaluate(() => window.__terrainPriorityAudit.snapshot());
  const initialCameraState = await page.evaluate(() => ({
    zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")),
    scale: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-scale")),
  }));
  const bounds = await map.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100, "board camera has a measurable viewport");
  const start = await findUnobstructedPoint(map);
  assert.ok(start, `board camera has an unobstructed hit point at ${viewport.width}x${viewport.height}`);

  // Fixed zoom-first then pan sequence. Both builds use the same local-game seed,
  // viewport/DPR, camera gesture coordinates and input steps.
  const zoomStart = await findUnobstructedPoint(map);
  assert.ok(zoomStart, "board camera retains an unobstructed zoom point");
  const zoomStartState = await page.evaluate(() => ({ zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")) }));
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
  const zoomGestureEnd = await mark(page, "audit-terrain-zoom-gesture-end");
  const zoomState = await page.evaluate(() => ({
    zoom: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")),
    scale: Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-scale")),
    requestedSize: window.__terrainPriorityAudit?.desiredSize ?? null,
    snapshot: window.__terrainPriorityAudit.snapshot(),
  }));
  assert.ok(zoomState.zoom > zoomStartState.zoom, "wheel or pinch input zooms the board camera");
  assert.ok(zoomState.requestedSize >= 512, `camera zoom requests a high-resolution variant, observed ${zoomState.requestedSize}`);
  const zoomDecode = await waitForTerrainDecodeStable(page, `${viewport.width}x${viewport.height} zoom-upgrade`);
  const zoomSettled = { markMs: zoomDecode.decoded.atMs };
  await page.locator(".board-viewport").screenshot({ path: screenshotPath, animations: "disabled" });

  // Move quickly into new terrain after high resolution is active and record
  // target-resolution coverage at fixed +1s/+2s checkpoints.
  const panPoint = await findUnobstructedPoint(map);
  assert.ok(panPoint, "board camera retains an unobstructed point for the fast pan");
  const panEnd = { x: Math.round(panPoint.x + Math.min(110, bounds.width * .18)), y: Math.round(panPoint.y + Math.min(45, bounds.height * .1)) };
  const panBefore = await page.evaluate(() => Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")));
  await drag({ page, session, start: panPoint, end: panEnd, viewport });
  const panGestureEnd = await mark(page, "audit-terrain-fast-pan-end");
  const panAfterPromise = page.evaluate(() => Number(document.querySelector(".board-viewport")?.getAttribute("data-camera-zoom")));
  const panSnapshotsPromise = page.evaluate(async (panStartMs) => {
    const snapshots = [];
    for (const targetMs of [1000, 2000]) {
      const delay = Math.max(0, panStartMs + targetMs - performance.now());
      await new Promise((done) => setTimeout(done, delay));
      snapshots.push({ targetOffsetMs: targetMs, observedOffsetMs: performance.now() - panStartMs, ...window.__terrainPriorityAudit.snapshot() });
    }
    return snapshots;
  }, panGestureEnd.markMs);
  const panDecodePromise = waitForTerrainDecodeStable(page, `${viewport.width}x${viewport.height} post-pan upgrade`);
  const [panAfter, panSnapshots, panDecode] = await Promise.all([panAfterPromise, panSnapshotsPromise, panDecodePromise]);
  assert.equal(panAfter, panBefore, "single-pointer drag pans without changing zoom");
  const finalState = await page.evaluate(() => {
    const board = document.querySelector(".board-viewport");
    const images = [...document.querySelectorAll("img.audited-terrain")];
    const visible = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    });
    return {
      zoom: Number(board?.getAttribute("data-camera-zoom")),
      scale: Number(board?.getAttribute("data-camera-scale")),
      devicePixelRatio,
      desiredSize: window.__terrainPriorityAudit?.desiredSize ?? null,
      visibleCount: visible.length,
      visibleAtRequestedResolution: visible.filter((image) => new URL(image.currentSrc || image.src, location.href).pathname.includes(`/audited/${window.__terrainPriorityAudit.desiredSize}/`)).length,
      visibleDecodedAtRequestedResolution: visible.filter((image) => {
        const path = new URL(image.currentSrc || image.src, location.href).pathname;
        return path.includes(`/audited/${window.__terrainPriorityAudit.desiredSize}/`) && image.complete && image.naturalWidth > 0;
      }).length,
      sourceSignature: visible.map((image) => ({ cellId: image.dataset.artCell ?? null, path: new URL(image.currentSrc || image.src, location.href).pathname })).sort((left, right) => String(left.cellId).localeCompare(String(right.cellId))),
      visibleVariantCounts: visible.reduce((counts, image) => {
        const match = (image.currentSrc || image.src).match(/\/(256|512|1024)\//);
        if (match) counts[match[1]] += 1;
        return counts;
      }, { 256: 0, 512: 0, 1024: 0 }),
      terrainElementCount: images.length,
    };
  });
  assert.ok(finalState.visibleCount > 0, "fast pan leaves terrain visible");
  assert.equal(finalState.visibleAtRequestedResolution, finalState.visibleCount, "all final visible terrain uses requested resolution");
  assert.equal(finalState.visibleDecodedAtRequestedResolution, finalState.visibleCount, "all final visible terrain at requested resolution is decoded");
  const primaryMs = zoomDecode.decoded.atMs - zoomGestureEnd.markMs;
  const postPanMs = panDecode.decoded.atMs - panGestureEnd.markMs;
  assert.ok(Number.isFinite(primaryMs) && primaryMs >= 0, "zoom decode latency has valid marks");
  assert.ok(Number.isFinite(postPanMs) && postPanMs >= 0, "post-pan decode latency has valid marks");
  return {
    scenarioSeed,
    firstSelection,
    initialSnapshot,
    initialCameraState,
    zoom: {
      startZoom: zoomStartState.zoom,
      endZoom: zoomState.zoom,
      scale: zoomState.scale,
      input: viewport.width <= 600 ? "two-finger pinch, 16 fixed steps" : "mouse wheel, 10 fixed steps",
      gestureEnd: zoomGestureEnd,
      gestureEndSnapshot: zoomState.snapshot,
      decodeStable: zoomDecode.decoded,
      settled: zoomSettled,
      gestureEndToRequestedVisibleDecodeStableMs: primaryMs,
      visibleCellSourceSignature: zoomDecode.finalSignature,
    },
    fastPan: {
      end: panGestureEnd,
      input: viewport.width <= 600 ? "touch drag, 20 fixed steps" : "mouse drag, 20 fixed steps",
      snapshots: panSnapshots,
      postPanDecodeStableMs: postPanMs,
      decodeStable: panDecode.decoded,
    },
    finalState,
  };
};

const isTerrainUrl = (rawUrl) => {
  try { return /\/assets\/board\/audited\/(?:256|512|1024)\/[^/?]+\.webp(?:\?|$)/.test(new URL(rawUrl).pathname); } catch { return false; }
};

const installNetworkAccounting = (session) => {
  const requests = new Map();
  session.on("Network.requestWillBeSent", (event) => {
    if (!isTerrainUrl(event.request.url)) return;
    const prior = requests.get(event.requestId);
    const request = prior ?? { requestId: event.requestId, url: event.request.url, initialPriority: event.request.initialPriority ?? null, priorityChanges: [], startedAt: event.wallTime ? event.wallTime * 1000 : null, cdpStartTimestamp: event.timestamp, response: null, encodedDataLength: null, failed: null };
    if (prior && prior.url !== event.request.url) request.redirects = [...(request.redirects ?? []), { url: prior.url, status: prior.response?.status ?? null }];
    request.url = event.request.url;
    request.initialPriority = request.initialPriority ?? event.request.initialPriority ?? null;
    request.startedAt ??= event.wallTime ? event.wallTime * 1000 : null;
    request.cdpStartTimestamp ??= event.timestamp;
    requests.set(event.requestId, request);
  });
  session.on("Network.resourceChangedPriority", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.priorityChanges.push({ timestamp: event.timestamp ?? null, newPriority: event.newPriority ?? null });
  });
  session.on("Network.responseReceived", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.response = { status: event.response.status, mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache ?? false, fromServiceWorker: event.response.fromServiceWorker ?? false, encodedDataLengthAtResponse: event.response.encodedDataLength ?? null };
  });
  session.on("Network.loadingFinished", (event) => {
    const request = requests.get(event.requestId);
    if (request) {
      request.encodedDataLength = event.encodedDataLength ?? null;
      request.finishedAtTimestamp = event.timestamp ?? null;
    }
  });
  session.on("Network.loadingFailed", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.failed = { errorText: event.errorText, canceled: event.canceled ?? false };
  });
  return (zoomGestureEnd) => {
    const phaseWallTime = zoomGestureEnd.timeOrigin + zoomGestureEnd.markMs;
    return [...requests.values()].map((request) => ({
      ...request,
      path: new URL(request.url).pathname,
      startOffsetFromZoomGestureEndMs: request.startedAt === null ? null : request.startedAt - phaseWallTime,
    })).sort((left, right) => (left.cdpStartTimestamp ?? 0) - (right.cdpStartTimestamp ?? 0));
  };
};

const captureSample = async ({ browser, viewport, variant, pairIndex, sampleIndex, orderIndex, url, scenarioSeed, build }) => {
  const startedAt = new Date().toISOString();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.width <= 600,
    hasTouch: viewport.width <= 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.setBypassServiceWorker", { bypass: true });
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular3g" });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const terrainRequests = installNetworkAccounting(session);
  await page.addInitScript((fixedSeed) => {
    const original = window.crypto.getRandomValues.bind(window.crypto);
    Object.defineProperty(window.crypto, "getRandomValues", {
      configurable: true,
      value(array) {
        // randomGameSeed() requests exactly one Uint32; preserve other crypto
        // behavior while making the local game state identical within a pair.
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = fixedSeed >>> 0;
          return array;
        }
        return original(array);
      },
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      addEventListener() {},
      removeEventListener() {},
      async register() { return { waiting: null, installing: null, addEventListener() {}, removeEventListener() {} }; },
      async getRegistration() { return undefined; },
    } });
    const snapshot = () => {
      const visible = [...document.querySelectorAll("img.audited-terrain")].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      });
      const desiredSize = window.__terrainPriorityAudit?.desiredSize ?? null;
      const sourceOf = (image) => new URL(image.currentSrc || image.src, location.href).pathname;
      const atTarget = visible.filter((image) => sourceOf(image).includes(`/audited/${desiredSize}/`));
      return {
        atMs: performance.now(),
        desiredSize,
        visibleCount: visible.length,
        targetResolutionCount: atTarget.length,
        targetDecodedCount: atTarget.filter((image) => image.complete && image.naturalWidth > 0).length,
        visibleSources: visible.map((image) => ({ cellId: image.dataset.artCell ?? null, path: sourceOf(image), decoded: image.complete && image.naturalWidth > 0 })).sort((left, right) => String(left.cellId).localeCompare(String(right.cellId))),
      };
    };
    window.__terrainPriorityAudit = { desiredSize: 256, readiness: null, snapshot };
    window.addEventListener("board-camera-change", (event) => {
      const pixels = event.detail.tilePixels * (window.devicePixelRatio || 1) * 2;
      window.__terrainPriorityAudit.desiredSize = pixels > 512 ? 1024 : pixels > 256 ? 512 : 256;
    });
  }, scenarioSeed);
  await fulfillHomeApi(page, new URL(url).origin);
  const screenshotPath = join(artifactDirectory, `${viewport.name}-pair-${String(pairIndex).padStart(2, "0")}-${variant.key}.png`);
  await mkdir(artifactDirectory, { recursive: true });
  try {
    await collectHomeReadiness(page, url);
    const camera = await runCameraFlow({ page, session, viewport, scenarioSeed, screenshotPath });
    assert.deepEqual(pageErrors, [], `${variant.key} pair ${pairIndex} at ${viewport.width}x${viewport.height} logged page errors`);
    const requests = terrainRequests(camera.zoom.gestureEnd);
    const terrainRequestsAtOrAfterZoom = requests.filter((request) => request.startOffsetFromZoomGestureEndMs >= 0);
    return {
      sampleIndex,
      pairIndex,
      orderIndex,
      variant: variant.key,
      buildSha256: build.sha256,
      previewUrl: url,
      scenario: "local-game camera terrain-upgrade and fast-pan follow-in",
      startedAt,
      completedAt: new Date().toISOString(),
      pageErrors,
      cacheDisabled: true,
      serviceWorkersBlocked: true,
      coldContext: true,
      cpuThrottleRate: 4,
      network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
      viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.width <= 600, hasTouch: viewport.width <= 600 },
      screenshot: relative(root, screenshotPath),
      camera,
      terrainNetwork: {
        requests,
        requestCount: requests.length,
        completedCount: requests.filter((request) => request.encodedDataLength !== null).length,
        failedCount: requests.filter((request) => request.failed && !request.failed.canceled).length,
        canceledCount: requests.filter((request) => request.failed?.canceled || request.failed?.errorText?.includes("ERR_ABORTED")).length,
        pendingAtCaptureCount: requests.filter((request) => request.encodedDataLength === null && !request.failed).length,
        requestsStartedAtOrAfterZoomGestureEnd: terrainRequestsAtOrAfterZoom.length,
        completedEncodedBytesTotal: requests.reduce((total, request) => total + (request.encodedDataLength ?? 0), 0),
        encodedBytesAtOrAfterZoomGestureEnd: terrainRequestsAtOrAfterZoom.reduce((total, request) => total + (request.encodedDataLength ?? 0), 0),
        actualInitialPriorities: requests.reduce((counts, request) => { const key = request.initialPriority ?? "unknown"; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
        actualPriorityChanges: requests.flatMap((request) => request.priorityChanges.map((change) => ({ path: request.path, ...change }))),
        failedRequests: requests.filter((request) => request.failed),
      },
      firstSelection: camera.firstSelection,
    };
  } finally {
    await context.close();
  }
};

let randomState = seed;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0x100000000;
};
const shuffle = (items) => {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
};

const pairSchedule = [];
for (const viewport of viewportOptions) {
  const abCount = random() < 0.5 ? Math.ceil(pairsPerViewport / 2) : Math.floor(pairsPerViewport / 2);
  const orientations = shuffle([
    ...Array.from({ length: abCount }, () => ["A", "B"]),
    ...Array.from({ length: pairsPerViewport - abCount }, () => ["B", "A"]),
  ]);
  orientations.forEach((order, index) => pairSchedule.push({ viewport, pairIndex: index + 1, order }));
}
shuffle(pairSchedule);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, proportion) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1)];
};

const pairedSummary = (samples) => {
  const completedPairs = pairSchedule.flatMap(({ viewport, pairIndex, order }) => {
    const a = samples.find((sample) => sample.variant === "A" && sample.pairIndex === pairIndex && sample.viewport.width === viewport.width && sample.viewport.height === viewport.height);
    const b = samples.find((sample) => sample.variant === "B" && sample.pairIndex === pairIndex && sample.viewport.width === viewport.width && sample.viewport.height === viewport.height);
    if (!a || !b) return [];
    const finalSourcesEqual = JSON.stringify(a.camera.finalState.sourceSignature) === JSON.stringify(b.camera.finalState.sourceSignature);
    const finalTerrainAssetsEqual = JSON.stringify(a.finalTerrainAssetHashes ?? {}) === JSON.stringify(b.finalTerrainAssetHashes ?? {});
    const initialSourcesEqual = JSON.stringify(a.camera.initialSnapshot.visibleSources) === JSON.stringify(b.camera.initialSnapshot.visibleSources);
    const initialCameraEqual = a.camera.initialCameraState.zoom === b.camera.initialCameraState.zoom
      && a.camera.initialCameraState.scale === b.camera.initialCameraState.scale;
    return [{
      viewport: `${viewport.width}x${viewport.height}`,
      pairIndex,
      order: [...order],
      sampleIndices: { A: a.sampleIndex, B: b.sampleIndex },
      deltaBMinusA: {
        gestureEndToRequestedVisibleDecodeStableMs: b.camera.zoom.gestureEndToRequestedVisibleDecodeStableMs - a.camera.zoom.gestureEndToRequestedVisibleDecodeStableMs,
        postPanDecodeStableMs: b.camera.fastPan.postPanDecodeStableMs - a.camera.fastPan.postPanDecodeStableMs,
        firstSelectionMs: b.camera.firstSelection.clickToConfirmMs - a.camera.firstSelection.clickToConfirmMs,
      },
      firstSelectionPercentBMinusA: 100 * (b.camera.firstSelection.clickToConfirmMs - a.camera.firstSelection.clickToConfirmMs) / a.camera.firstSelection.clickToConfirmMs,
      finalSourcesEqual,
      finalTerrainAssetsEqual,
      initialSourcesEqual,
      initialCameraEqual,
      screenshotPixelDiff: a.pixelDiffAgainstPairedSample ?? null,
    }];
  });
  const viewports = Object.fromEntries(viewportOptions.map((viewport) => {
    const key = `${viewport.width}x${viewport.height}`;
    const pairs = completedPairs.filter((pair) => pair.viewport === key);
    const samplesFor = (variant) => samples.filter((sample) => sample.variant === variant && sample.viewport.width === viewport.width && sample.viewport.height === viewport.height);
    const metricStats = (field) => {
      const aValues = samplesFor("A").map((sample) => sample.camera.zoom[field]);
      const bValues = samplesFor("B").map((sample) => sample.camera.zoom[field]);
      const deltas = pairs.map((pair) => pair.deltaBMinusA[field]);
      return { A: { median: median(aValues), values: aValues }, B: { median: median(bValues), values: bValues }, pairedDeltaBMinusA: { median: median(deltas), p90: percentile(deltas, .9), values: deltas } };
    };
    const selectionPercentChanges = pairs.map((pair) => pair.firstSelectionPercentBMinusA);
    return [key, {
      pairCount: pairs.length,
      gestureEndToRequestedVisibleDecodeStableMs: metricStats("gestureEndToRequestedVisibleDecodeStableMs"),
      postPanDecodeStableMs: {
        A: { median: median(samplesFor("A").map((sample) => sample.camera.fastPan.postPanDecodeStableMs)) },
        B: { median: median(samplesFor("B").map((sample) => sample.camera.fastPan.postPanDecodeStableMs)) },
        pairedDeltaBMinusA: { median: median(pairs.map((pair) => pair.deltaBMinusA.postPanDecodeStableMs)), values: pairs.map((pair) => pair.deltaBMinusA.postPanDecodeStableMs) },
      },
      firstSelectionClickToConfirmMs: {
        A: { median: median(samplesFor("A").map((sample) => sample.camera.firstSelection.clickToConfirmMs)) },
        B: { median: median(samplesFor("B").map((sample) => sample.camera.firstSelection.clickToConfirmMs)) },
        pairedDeltaBMinusA: { median: median(pairs.map((pair) => pair.deltaBMinusA.firstSelectionMs)), values: pairs.map((pair) => pair.deltaBMinusA.firstSelectionMs) },
        pairedPercentChangeBMinusA: { median: median(selectionPercentChanges), p90: percentile(selectionPercentChanges, .9), values: selectionPercentChanges },
      },
      fastPanCheckpoints: Object.fromEntries([1000, 2000].map((checkpointMs) => [checkpointMs, Object.fromEntries(["A", "B"].map((variant) => {
        const checkpointRows = samplesFor(variant).flatMap((sample) => sample.camera.fastPan.snapshots.filter((snapshot) => snapshot.targetOffsetMs === checkpointMs));
        return [variant, { sampleCount: checkpointRows.length, averageVisibleCount: checkpointRows.length ? checkpointRows.reduce((sum, row) => sum + row.visibleCount, 0) / checkpointRows.length : null, averageAtRequestedResolution: checkpointRows.length ? checkpointRows.reduce((sum, row) => sum + row.targetResolutionCount, 0) / checkpointRows.length : null, averageDecodedAtRequestedResolution: checkpointRows.length ? checkpointRows.reduce((sum, row) => sum + row.targetDecodedCount, 0) / checkpointRows.length : null }];
      }))])),
      finalSourceEqualityPairs: pairs.filter((pair) => pair.finalSourcesEqual).length,
      finalTerrainAssetEqualityPairs: pairs.filter((pair) => pair.finalTerrainAssetsEqual).length,
      initialSourceEqualityPairs: pairs.filter((pair) => pair.initialSourcesEqual).length,
      initialCameraEqualityPairs: pairs.filter((pair) => pair.initialCameraEqual).length,
      screenshotPixelDiff: pairs.map((pair) => pair.screenshotPixelDiff),
    }];
  }));
  const allTerrainPairsComplete = completedPairs.length === pairSchedule.length;
  const minPairsForDecision = 7;
  const hasRepeatedPairs = viewportOptions.every((viewport) => viewports[`${viewport.width}x${viewport.height}`].pairCount >= minPairsForDecision);
  const desktop = viewports["1280x720"];
  const phone = viewports["390x844"];
  const desktopZoomReductionPercent = desktop.gestureEndToRequestedVisibleDecodeStableMs.A.median && desktop.gestureEndToRequestedVisibleDecodeStableMs.B.median !== null
    ? 100 * (1 - desktop.gestureEndToRequestedVisibleDecodeStableMs.B.median / desktop.gestureEndToRequestedVisibleDecodeStableMs.A.median)
    : null;
  const phoneZoomP90RegressionPercent = phone.gestureEndToRequestedVisibleDecodeStableMs.pairedDeltaBMinusA.values.length
    ? percentile(completedPairs.filter((pair) => pair.viewport === "390x844").map((pair) => {
      const a = samples.find((sample) => sample.sampleIndex === pair.sampleIndices.A);
      return 100 * pair.deltaBMinusA.gestureEndToRequestedVisibleDecodeStableMs / a.camera.zoom.gestureEndToRequestedVisibleDecodeStableMs;
    }), .9)
    : null;
  const selectionRegressionPercent = Object.fromEntries(Object.entries(viewports).map(([viewport, summary]) => [viewport, summary.firstSelectionClickToConfirmMs.pairedPercentChangeBMinusA.median]));
  const thresholds = {
    desktopZoomMedianReductionPercent: { targetAtLeast: 15, observed: desktopZoomReductionPercent, passed: desktopZoomReductionPercent !== null && desktopZoomReductionPercent >= 15 },
    phoneZoomPairedP90RegressionPercent: { targetAtMost: 5, observed: phoneZoomP90RegressionPercent, passed: phoneZoomP90RegressionPercent !== null && phoneZoomP90RegressionPercent <= 5 },
    firstSelectionPairedMedianRegressionPercentByViewport: Object.fromEntries(Object.entries(selectionRegressionPercent).map(([viewport, observed]) => [viewport, { targetAtMost: 5, observed, passed: observed !== null && observed <= 5 }])),
  };
  const latencyThresholdsPassed = thresholds.desktopZoomMedianReductionPercent.passed
    && thresholds.phoneZoomPairedP90RegressionPercent.passed
    && Object.values(thresholds.firstSelectionPairedMedianRegressionPercentByViewport).every((check) => check.passed);
  const sourceAndAssetParityPassed = builds.A.build.terrainAssetHashes && builds.B.build.terrainAssetHashes
    && JSON.stringify(builds.A.build.terrainAssetHashes) === JSON.stringify(builds.B.build.terrainAssetHashes)
    && completedPairs.length > 0
    && completedPairs.every((pair) => pair.initialCameraEqual && pair.initialSourcesEqual && pair.finalSourcesEqual && pair.finalTerrainAssetsEqual);
  const acceptanceStatus = !allTerrainPairsComplete
    ? "incomplete: paired camera runs remain"
    : !hasRepeatedPairs
      ? `incomplete: need at least ${minPairsForDecision} complete A/B pairs per viewport for a decision`
      : !sourceAndAssetParityPassed
        ? "incomplete: viewport/source/asset parity invariant failed; inspect setup and final visual evidence before interpreting latency"
      : latencyThresholdsPassed
        ? "latency guardrails met; screenshot and fast-pan follow-in evidence still require review, and API/interface starvation remains unmeasured"
        : "registered latency guardrails not met; retain no performance claim and reject this optimization unless follow-up evidence explains the failure";
  return {
    completedPairCount: completedPairs.length,
    requestedPairCount: pairSchedule.length,
    pairs: completedPairs,
    viewports,
    firstSelection: { measured: true, status: "paired click-to-Confirm samples captured before camera interaction" },
    minimumPairsForDecision: minPairsForDecision,
    thresholds,
    latencyThresholdsPassed,
    sourceAndAssetParityPassed,
    repeatedPairsSufficient: hasRepeatedPairs,
    terrainPriorityMeasurementComplete: allTerrainPairsComplete,
    acceptanceStatus,
  };
};

const hashFinalTerrainAssets = async (sample, variant) => {
  const hashes = {};
  for (const { path } of sample.camera.finalState.sourceSignature) {
    const relativePath = path.replace(/^\//, "");
    const bytes = await readFile(join(variant.path, relativePath));
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
};

const createPixelDiff = async (a, b, outputPathForDiff) => {
  if (!sharp) return { available: false, reason: "sharp dependency is unavailable" };
  const [imageA, imageB] = await Promise.all([
    sharp(await readFile(join(root, a.screenshot))).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(await readFile(join(root, b.screenshot))).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (imageA.info.width !== imageB.info.width || imageA.info.height !== imageB.info.height || imageA.info.channels !== imageB.info.channels) {
    return { available: true, comparable: false, reason: "screenshot dimensions/channels differ", A: imageA.info, B: imageB.info };
  }
  const diff = Buffer.alloc(imageA.data.length);
  let differentPixels = 0;
  let absoluteChannelDelta = 0;
  let maximumChannelDelta = 0;
  const channels = imageA.info.channels;
  for (let offset = 0; offset < diff.length; offset += channels) {
    let pixelDiffers = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const delta = Math.abs(imageA.data[offset + channel] - imageB.data[offset + channel]);
      diff[offset + channel] = delta;
      absoluteChannelDelta += delta;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      if (delta !== 0) pixelDiffers = true;
    }
    if (pixelDiffers) differentPixels += 1;
  }
  await sharp(diff, { raw: { width: imageA.info.width, height: imageA.info.height, channels } }).png().toFile(outputPathForDiff);
  const pixelCount = imageA.info.width * imageA.info.height;
  return {
    available: true,
    comparable: true,
    width: imageA.info.width,
    height: imageA.info.height,
    differentPixels,
    differentPixelFraction: pixelCount ? differentPixels / pixelCount : 0,
    meanAbsoluteChannelDelta: diff.length ? absoluteChannelDelta / diff.length : 0,
    maximumChannelDelta,
    differenceImage: relative(root, outputPathForDiff),
  };
};

for (const variant of Object.values(builds)) {
  const info = await stat(variant.path).catch(() => null);
  assert.ok(info?.isDirectory(), `Prebuilt dist directory is missing: ${variant.path}`);
  variant.build = await digestBuild(variant.path);
}
const startedAt = new Date().toISOString();
const result = {
  schemaVersion: 1,
  startedAt,
  updatedAt: startedAt,
  protocol: {
    scenario: "local game, zoom terrain resolution upgrade, then fast pan-follow-in",
    pairsPerViewport,
    viewports: viewportOptions.map(({ width, height, deviceScaleFactor, name }) => ({ name, width, height, deviceScaleFactor })),
    camera: "fixed 10-step desktop wheel zoom or 16-step phone pinch; then 20-step desktop/touch fast pan; identical local game seed and first available setup choices within every A/B pair",
    coldContextPerSample: true,
    cacheDisabled: "CDP Network.setCacheDisabled(true)",
    serviceWorkers: "blocked; benchmark context uses an inert container and inert register/getRegistration methods",
    cpuThrottle: "4x",
    network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
    primaryMetric: "zoom gesture-end to every visible image using the requested resolution and completing decode() on the same DOM nodes/source signature; source set stable for at least 300 ms plus two animation frames",
    rapidPan: "counts visible tiles at the requested resolution and decoded at +1s/+2s after the fast pan; then records post-pan same-node/source decode-stable latency",
    networkAccounting: "CDP Network.requestWillBeSent initialPriority, resourceChangedPriority events, response status/cache metadata, loadingFinished encodedDataLength for audited terrain WebP requests",
    screenshot: "board viewport PNG after requested-resolution zoom decode; A/B raw pixel difference reported when sharp is available; pixel diff does not gate the run",
    graphics: "production dist and terrain images are served without request interception, image replacement, resampling, or resolution-policy changes; final cell-to-path signatures and exact final asset hashes are recorded for pairwise comparison",
    firstSelection: "measured in each cold sample after the same UI-driven setup choices: first hit-testable legal tile to Confirm move visible; route then canceled before camera gestures",
    registeredThresholds: { desktopZoomMedianReductionPercentAtLeast: 15, phoneZoomPairedP90RegressionPercentAtMost: 5, firstSelectionPairedMedianRegressionPercentAtMostByViewport: 5, minimumCompletePairsPerViewport: 7 },
    interpretation: "Evidence capture only. Acceptance remains incomplete until the repeated paired run is complete and latency, fast-pan, source/asset, and screenshot evidence are reviewed.",
  },
  builds: {
    A: { label: builds.A.label, path: builds.A.path, ...builds.A.build },
    B: { label: builds.B.label, path: builds.B.path, ...builds.B.build },
  },
  identicalBuilds: builds.A.build.sha256 === builds.B.build.sha256,
  terrainAssetManifestsIdentical: JSON.stringify(builds.A.build.terrainAssetHashes) === JSON.stringify(builds.B.build.terrainAssetHashes),
  schedule: pairSchedule.map(({ viewport, pairIndex, order }) => ({ viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor }, pairIndex, order })),
  environment: { node: process.version, platform: process.platform, arch: process.arch, playwright: require("playwright/package.json").version, sharpAvailable: Boolean(sharp) },
  browserVersion: null,
  samples: [],
  pairedSummary: null,
};

const save = async () => {
  result.updatedAt = new Date().toISOString();
  result.pairedSummary = pairedSummary(result.samples);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`);
  await rename(temporaryPath, outputPath);
};

let previews = [];
let browser;
let interruptedSignal;
const onSignal = (signal) => {
  interruptedSignal = signal;
  if (browser) void browser.close();
  for (const preview of previews) void stopPreview(preview);
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

try {
  previews.push(await startPreview(builds.A));
  previews.push(await startPreview(builds.B));
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  result.browserVersion = await browser.version();
  await save();
  for (const task of pairSchedule) {
    if (interruptedSignal) break;
    const variantSamples = {};
    for (const variantKey of task.order) {
      if (interruptedSignal) break;
      const variant = builds[variantKey];
      const preview = previews[variantKey === "A" ? 0 : 1];
      const sampleIndex = result.samples.length + 1;
      const viewportSeed = (seed ^ (task.pairIndex * 0x45d9f3b) ^ (task.viewport.width << 7) ^ task.viewport.height) >>> 0 || 1;
      const sample = await captureSample({
        browser,
        viewport: task.viewport,
        variant,
        pairIndex: task.pairIndex,
        sampleIndex,
        orderIndex: task.order.indexOf(variantKey) + 1,
        url: preview.url,
        scenarioSeed: viewportSeed,
        build: variant.build,
      });
      sample.labels = { A: builds.A.label, B: builds.B.label };
      sample.pairOrder = [...task.order];
      sample.finalTerrainAssetHashes = await hashFinalTerrainAssets(sample, variant);
      result.samples.push(sample);
      variantSamples[variantKey] = sample;
      await save();
      console.log(`${task.viewport.width}x${task.viewport.height} pair ${task.pairIndex}/${pairsPerViewport} ${task.order.join("→")} ${variantKey}: ${JSON.stringify({ firstSelectionMs: sample.camera.firstSelection.clickToConfirmMs, zoomDecodeMs: sample.camera.zoom.gestureEndToRequestedVisibleDecodeStableMs, panDecodeMs: sample.camera.fastPan.postPanDecodeStableMs, targetAtGestureEnd: sample.camera.zoom.gestureEndSnapshot.targetResolutionCount, finalVisible: sample.camera.finalState.visibleCount, completedEncodedBytes: sample.terrainNetwork.completedEncodedBytesTotal, requests: { total: sample.terrainNetwork.requestCount, complete: sample.terrainNetwork.completedCount, canceled: sample.terrainNetwork.canceledCount, pending: sample.terrainNetwork.pendingAtCaptureCount }, initialPriorities: sample.terrainNetwork.actualInitialPriorities, seed: sample.camera.scenarioSeed })}`);
    }
    if (variantSamples.A && variantSamples.B) {
      const differencePath = join(artifactDirectory, `${task.viewport.name}-pair-${String(task.pairIndex).padStart(2, "0")}-pixel-diff.png`);
      const diff = await createPixelDiff(variantSamples.A, variantSamples.B, differencePath);
      variantSamples.A.pixelDiffAgainstPairedSample = diff;
      variantSamples.B.pixelDiffAgainstPairedSample = diff;
      await save();
    }
  }
  await save();
  console.log(`Saved ${result.samples.length} raw sample(s) and ${result.pairedSummary.completedPairCount} completed pair(s) to ${relative(root, outputPath)}. Acceptance: ${result.pairedSummary.acceptanceStatus}.`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await Promise.all(previews.map(stopPreview));
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  await save();
  if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}
