import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd();
const webRoot = join(root, "apps/web");
const distRoot = join(webRoot, "dist");
const defaultViewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([^=]+)=(.*)$/);
  if (match) return [match[1], match[2]];
  if (argument.startsWith("--")) return [argument.slice(2), true];
  throw new Error(`Unexpected argument: ${argument}`);
}));

if (options.help) {
  console.log("Usage: node scripts/verify-browser-performance.mjs [--runs=3] [--output=path] [--scenario=all|home|first-selection]");
  process.exit(0);
}

const runs = Number(options.runs ?? 3);
const scenario = String(options.scenario ?? "all");
const outputPath = join(root, String(options.output ?? "output/performance/browser-benchmark.json"));
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 20, "--runs must be an integer from 1 to 20");
assert.ok(["all", "home", "first-selection"].includes(scenario), "--scenario must be all, home, or first-selection");

const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a preview port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const observerInit = () => {
  const state = { supported: PerformanceObserver.supportedEntryTypes ?? [], paint: [], lcp: [], longtask: [], event: [] };
  window.__browserBenchmark = state;
  for (const [type, key] of [["paint", "paint"], ["largest-contentful-paint", "lcp"], ["longtask", "longtask"], ["event", "event"]]) {
    if (!state.supported.includes(type)) continue;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state[key].push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            renderTime: entry.renderTime ?? null,
            loadTime: entry.loadTime ?? null,
          processingStart: entry.processingStart ?? null,
          processingEnd: entry.processingEnd ?? null,
          size: entry.size ?? null,
          element: entry.element ? {
            tagName: entry.element.tagName,
            id: entry.element.id,
            className: typeof entry.element.className === "string" ? entry.element.className : "",
            src: entry.element.currentSrc ?? entry.element.src ?? null,
          } : null,
        });
        }
      });
      observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) });
    } catch {
      // Unsupported observer options are recorded in `supported` and omitted from measurements.
    }
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
    return route.fulfill({ status: 404, headers, contentType: "application/json", body: JSON.stringify({ error: `Unexpected benchmark API request: ${request.method()} ${url.pathname}` }) });
  });
};

const collectHomeReadiness = async (page, url) => {
  await page.goto(url, { waitUntil: "load" });
  await page.locator("#home-title").waitFor({ state: "visible" });
  await page.locator(".home-monster img").evaluate(async (image) => {
    if (!image.complete) await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    if (image.decode) await image.decode();
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
};

const runHomeScenario = async ({ page, viewport, origin, sample }) => {
  await collectHomeReadiness(page, url);
  const metrics = await page.evaluate(({ pageOrigin, viewport }) => {
    const observed = window.__browserBenchmark;
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).origin === pageOrigin && entry.initiatorType !== "navigation")
      .map((entry) => ({ name: new URL(entry.name).pathname, type: (() => {
        const pathname = new URL(entry.name).pathname.toLowerCase();
        if (entry.initiatorType === "script" || /\.m?js$/.test(pathname)) return "js";
        if (entry.initiatorType === "css" || pathname.endsWith(".css")) return "css";
        if (entry.initiatorType === "img" || /\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(pathname)) return "images";
        return "other";
      })(), transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize }));
    const totals = { js: 0, css: 0, images: 0, other: 0, total: 0 };
    for (const resource of resources) { totals[resource.type] += resource.transferSize; totals.total += resource.transferSize; }
    const paint = observed.paint.find((entry) => entry.name === "first-contentful-paint");
    const lcp = observed.lcp.at(-1);
    return {
      fcpMs: paint?.startTime ?? null,
      lcpMs: lcp?.renderTime || lcp?.loadTime || lcp?.startTime || null,
      lcpElement: lcp?.element ?? null,
      longTaskTotalMs: observed.longtask.reduce((total, entry) => total + entry.duration, 0),
      longTasks: observed.longtask,
      observerSupport: observed.supported,
      resources,
      transferBytes: totals,
      viewport,
    };
  }, { pageOrigin: origin, viewport });
  assert.ok(metrics.fcpMs !== null, `FCP was not observed for ${viewport.width}x${viewport.height}`);
  assert.ok(metrics.lcpMs !== null, `LCP was not observed for ${viewport.width}x${viewport.height}`);
  return { scenario: "home", viewport, sample, ...metrics };
};

const completeLocalSetup = async (page) => {
  await page.getByRole("combobox", { name: "Number of players" }).selectOption("2");
  await page.evaluate(() => performance.mark("benchmark-setup-start"));
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

const runFirstSelectionScenario = async ({ page, viewport, origin, sample }) => {
  await collectHomeReadiness(page, url);
  await completeLocalSetup(page);
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
  const scenarioStart = await page.evaluate(() => performance.getEntriesByName("benchmark-setup-start", "mark")[0]?.startTime ?? 0);
  await page.evaluate(() => performance.mark("benchmark-selection-start"));
  const selectionStartedAt = await page.evaluate(() => performance.now());
  const inputMethod = viewport.width <= 600 ? "touch" : "mouse";
  if (inputMethod === "touch") await page.touchscreen.tap(destination.x, destination.y);
  else await page.mouse.click(destination.x, destination.y);
  const confirm = page.getByRole("button", { name: "Confirm move", exact: true });
  await confirm.waitFor({ state: "visible" });
  const clickToConfirmMs = await page.evaluate((startedAt) => performance.now() - startedAt, selectionStartedAt);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const eventTimingSupported = await page.evaluate(() => window.__browserBenchmark.supported.includes("event"));
  if (eventTimingSupported) {
    await page.waitForFunction((interactionAt) => window.__browserBenchmark.event.some((entry) => entry.startTime >= interactionAt && entry.name === "click"), selectionStartedAt, { timeout: 2000 });
  }
  const measurements = await page.evaluate(({ pageOrigin, startAt, interactionAt }) => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => entry.startTime >= startAt && new URL(entry.name).origin === pageOrigin && entry.initiatorType !== "navigation")
      .map((entry) => ({ name: new URL(entry.name).pathname, initiatorType: entry.initiatorType, transferSize: entry.transferSize, startTime: entry.startTime, duration: entry.duration }));
    const events = window.__browserBenchmark.event.filter((entry) => entry.startTime >= interactionAt && /^(click|pointerdown)$/i.test(entry.name)).map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      inputDelayMs: entry.processingStart === null ? null : entry.processingStart - entry.startTime,
      processingMs: entry.processingStart === null || entry.processingEnd === null ? null : entry.processingEnd - entry.processingStart,
    }));
    return { resources, transferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0), eventTimings: events, observerSupport: window.__browserBenchmark.supported };
  }, { pageOrigin: origin, startAt: scenarioStart, interactionAt: selectionStartedAt });
  return {
    scenario: "first-selection",
    viewport,
    sample,
    setupStartedAtMs: scenarioStart,
    selectionStartedAtMs: selectionStartedAt,
    selectedHex: destination.key,
    inputMethod,
    clickToConfirmMs,
    eventTimingSupported,
    ...measurements,
  };
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const summarize = (samples) => {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.scenario} ${sample.viewport.width}x${sample.viewport.height}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups].map(([key, group]) => {
    const fields = group[0].scenario === "home" ? ["fcpMs", "lcpMs", "longTaskTotalMs"] : ["clickToConfirmMs"];
    return [key, Object.fromEntries(fields.map((field) => {
      const values = group.map((entry) => entry[field]).filter(Number.isFinite);
      return [field, { median: median(values), min: Math.min(...values), max: Math.max(...values), samples: values.length }];
    }))];
  }));
};

const distStat = await stat(distRoot).catch(() => null);
assert.ok(distStat?.isDirectory(), "apps/web/dist is missing. Run `npm run build` before measuring the production preview.");
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
  stopPreviewPromise = new Promise((resolve) => {
    if (preview.exitCode !== null || preview.signalCode !== null) return resolve();
    const onExit = () => resolve();
    preview.once("exit", onExit);
    if (preview.exitCode !== null || preview.signalCode !== null) {
      preview.off("exit", onExit);
      resolve();
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
const samples = [];
const startedAt = new Date().toISOString();
const protocol = {
  preview: "Vite production preview from apps/web/dist on loopback and an ephemeral strict port",
  freshContextPerSample: true,
  cacheDisabled: "CDP Network.setCacheDisabled(true)",
  serviceWorkers: "blocked",
  cpuThrottle: "4x",
  network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
  homeWait: "load, #home-title, hero image decode, document.fonts.ready, then 250 ms",
  viewports: defaultViewports,
  runs,
  firstSelection: "2-player local setup through visible UI choices; nearest visible legal hex passing center-point hit test; stop when Confirm move appears; command not committed",
  resourceAccounting: "same-origin Resource Timing entries started during setup/selection and completed by confirmation, using transferSize; navigation document excluded; requests still in flight when Confirm appears are not counted",
  selectionInput: "mouse at desktop viewport; touchscreen tap at phone viewport",
  lcp: "latest Largest Contentful Paint candidate observed after the documented readiness wait, not a formally frozen page-final value",
  graphics: "existing production assets served unchanged; no images or rendering resources intercepted",
};

const save = async () => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, startedAt, updatedAt: new Date().toISOString(), url, environment: { node: process.version, platform: process.platform, arch: process.arch, playwright: require("playwright/package.json").version, browser: browser ? await browser.version() : null, build }, protocol, samples, summary: summarize(samples) }, null, 2)}\n`);
};

try {
  await waitForServer(url, preview, () => previewOutput);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const viewport of defaultViewports) {
    for (const runScenario of scenario === "all" ? ["home", "first-selection"] : [scenario]) {
      for (let sample = 1; sample <= runs; sample += 1) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width <= 600, hasTouch: viewport.width <= 600, serviceWorkers: "block" });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const session = await context.newCDPSession(page);
        await session.send("Network.enable");
        await session.send("Network.setCacheDisabled", { cacheDisabled: true });
        await session.send("Network.setBypassServiceWorker", { bypass: true });
        await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular3g" });
        await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.addInitScript(observerInit);
        await fulfillHomeApi(page, new URL(url).origin);
        try {
          const common = { page, viewport, origin: new URL(url).origin, sample };
          const result = runScenario === "home" ? await runHomeScenario(common) : await runFirstSelectionScenario(common);
          assert.deepEqual(pageErrors, [], `${runScenario} sample ${sample} at ${viewport.width}x${viewport.height} logged page errors`);
          result.pageErrors = pageErrors;
          result.cacheDisabled = true;
          result.serviceWorkersBlocked = true;
          samples.push(result);
          await save();
          console.log(`${runScenario} ${viewport.width}x${viewport.height} sample ${sample}/${runs}: ${JSON.stringify(runScenario === "home" ? { fcpMs: result.fcpMs, lcpMs: result.lcpMs, longTaskTotalMs: result.longTaskTotalMs, transferBytes: result.transferBytes } : { clickToConfirmMs: result.clickToConfirmMs, eventTimings: result.eventTimings, transferBytes: result.transferBytes })}`);
        } finally {
          await context.close();
        }
      }
    }
  }
  await save();
  console.log(`Saved raw measurements to ${relative(root, outputPath)}\nSummary: ${JSON.stringify(summarize(samples))}`);
} finally {
  if (browser) await browser.close();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
  await stopPreview();
}
