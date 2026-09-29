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
const root = process.cwd();
const webRoot = join(root, "apps/web");
const viteBin = join(root, "node_modules/vite/bin/vite.js");
const defaultViewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([^=]+)=(.*)$/);
  if (match) return [match[1], match[2]];
  if (argument.startsWith("--")) return [argument.slice(2), true];
  throw new Error(`Unexpected argument: ${argument}`);
}));

if (options.help) {
  console.log("Usage: node scripts/verify-browser-performance-ab.mjs --a=dist-A --b=dist-B [--pairs=7] [--seed=12345] [--viewports=1280x720,390x844] [--output=path]");
  process.exit(0);
}

assert.ok(options.a && options.b, "--a and --b must point to prebuilt production dist directories");
const builds = {
  A: { label: String(options["a-label"] ?? "A"), path: resolve(root, String(options.a)) },
  B: { label: String(options["b-label"] ?? "B"), path: resolve(root, String(options.b)) },
};
const pairsPerViewport = Number(options.pairs ?? 7);
assert.ok(Number.isInteger(pairsPerViewport) && pairsPerViewport >= 1 && pairsPerViewport <= 30, "--pairs must be an integer from 1 to 30");
const seedInput = Number(options.seed ?? 20260929);
assert.ok(Number.isInteger(seedInput) && seedInput >= 0 && seedInput <= 0xffffffff, "--seed must be an unsigned 32-bit integer");
const seed = seedInput === 0 ? 0x9e3779b9 : seedInput >>> 0;
const outputPath = resolve(root, String(options.output ?? `output/performance/browser-performance-ab-${new Date().toISOString().replaceAll(":", "-")}.json`));
const viewportOptions = String(options.viewports ?? "1280x720,390x844").split(",").map((entry) => {
  const match = entry.trim().match(/^(\d+)x(\d+)$/);
  assert.ok(match, `Invalid viewport '${entry}'; use WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
});
assert.ok(viewportOptions.length > 0, "At least one viewport is required");
assert.equal(new Set(viewportOptions.map(({ width, height }) => `${width}x${height}`)).size, viewportOptions.length, "Viewports must be unique");

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
  const mainAssets = [];
  for (const path of files) {
    const bytes = await readFile(path);
    const name = relative(directory, path).split("\\").join("/");
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

const observerInit = () => {
  const state = { supported: PerformanceObserver.supportedEntryTypes ?? [], paint: [], lcp: [], longtask: [] };
  window.__browserBenchmarkAB = state;
  for (const [type, key] of [["paint", "paint"], ["largest-contentful-paint", "lcp"], ["longtask", "longtask"]]) {
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
      observer.observe({ type, buffered: true });
    } catch {
      // Observer availability is retained with the sample; unsupported entries stay null.
    }
  }
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
    if (!image.complete) await new Promise((resolveLoad, reject) => {
      image.addEventListener("load", resolveLoad, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    if (image.decode) await image.decode();
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
};

const captureHome = async ({ browser, viewport, variant, pairIndex, sampleIndex, orderIndex, url, build }) => {
  const sampleStartedAt = new Date().toISOString();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
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
  await page.addInitScript(() => {
    // In some Chrome builds a blocked native register() resolves without a
    // registration. Keep the intentionally service-worker-free preview inert
    // while avoiding a test-runner-only undefined-registration rejection.
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      addEventListener() {},
      removeEventListener() {},
      async register() { return { waiting: null, installing: null, addEventListener() {}, removeEventListener() {} }; },
      async getRegistration() { return undefined; },
    } });
  });
  await page.addInitScript(observerInit);
  await fulfillHomeApi(page, new URL(url).origin);
  try {
    await collectHomeReadiness(page, url);
    const metrics = await page.evaluate(({ pageOrigin, viewport: measuredViewport }) => {
      const observed = window.__browserBenchmarkAB;
      const resources = performance.getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).origin === pageOrigin && entry.initiatorType !== "navigation")
        .map((entry) => ({
          name: new URL(entry.name).pathname,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          durationMs: entry.duration,
        }));
      const totals = { js: 0, css: 0, images: 0, other: 0, total: 0 };
      for (const resource of resources) {
        const lower = resource.name.toLowerCase();
        const type = resource.initiatorType === "script" || /\.m?js$/.test(lower)
          ? "js"
          : resource.initiatorType === "css" || lower.endsWith(".css")
            ? "css"
            : resource.initiatorType === "img" || /\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(lower)
              ? "images"
              : "other";
        totals[type] += resource.transferSize;
        totals.total += resource.transferSize;
      }
      const fcp = observed.paint.find((entry) => entry.name === "first-contentful-paint");
      const lcp = observed.lcp.at(-1);
      return {
        fcpMs: fcp?.startTime ?? null,
        lcpMs: lcp?.renderTime || lcp?.loadTime || lcp?.startTime || null,
        lcpElement: lcp?.element ?? null,
        longTaskTotalMs: observed.longtask.reduce((total, entry) => total + entry.duration, 0),
        longTasks: observed.longtask,
        observerSupport: observed.supported,
        resources,
        transferBytes: totals,
        viewport: measuredViewport,
      };
    }, { pageOrigin: new URL(url).origin, viewport });
    assert.ok(metrics.fcpMs !== null, `FCP was not observed for ${viewport.width}x${viewport.height}`);
    assert.ok(metrics.lcpMs !== null, `LCP was not observed for ${viewport.width}x${viewport.height}`);
    if (pageErrors.length) {
      const serviceWorkerState = await page.evaluate(() => ({ propertyPresent: "serviceWorker" in navigator, containerDefined: navigator.serviceWorker != null }));
      assert.deepEqual(pageErrors, [], `${variant.key} pair ${pairIndex} at ${viewport.width}x${viewport.height} logged page errors; blocked-context service-worker state: ${JSON.stringify(serviceWorkerState)}`);
    }
    return {
      sampleIndex,
      orderIndex,
      pairIndex,
      variant: variant.key,
      buildSha256: build.sha256,
      previewUrl: url,
      scenario: "cold-home",
      startedAt: sampleStartedAt,
      completedAt: new Date().toISOString(),
      pageErrors,
      cacheDisabled: true,
      serviceWorkersBlocked: true,
      coldContext: true,
      cpuThrottleRate: 4,
      network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
      ...metrics,
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

const med = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const getPairedSummary = (samples, schedule) => {
  const completedPairs = schedule.flatMap(({ viewport, pairIndex, order }) => {
    const viewportKey = `${viewport.width}x${viewport.height}`;
    const sampleFor = (variant) => samples.find((sample) => sample.variant === variant && sample.pairIndex === pairIndex && `${sample.viewport.width}x${sample.viewport.height}` === viewportKey);
    const a = sampleFor("A");
    const b = sampleFor("B");
    if (!a || !b) return [];
    return [{ viewport, pairIndex, order: [...order], sampleIndices: { A: a.sampleIndex, B: b.sampleIndex }, deltaBMinusA: {
      fcpMs: b.fcpMs - a.fcpMs,
      lcpMs: b.lcpMs - a.lcpMs,
      longTaskTotalMs: b.longTaskTotalMs - a.longTaskTotalMs,
    } }];
  });
  const viewports = Object.fromEntries(viewportOptions.map((viewport) => {
    const key = `${viewport.width}x${viewport.height}`;
    const groupA = samples.filter((sample) => sample.variant === "A" && `${sample.viewport.width}x${sample.viewport.height}` === key);
    const groupB = samples.filter((sample) => sample.variant === "B" && `${sample.viewport.width}x${sample.viewport.height}` === key);
    const pairs = completedPairs.filter((pair) => `${pair.viewport.width}x${pair.viewport.height}` === key);
    const metricStats = (field) => {
      const valuesA = groupA.map((sample) => sample[field]);
      const valuesB = groupB.map((sample) => sample[field]);
      const deltas = pairs.map((pair) => pair.deltaBMinusA[field]);
      return {
        A: { median: med(valuesA), samples: valuesA.length },
        B: { median: med(valuesB), samples: valuesB.length },
        pairedDeltaBMinusA: { median: med(deltas), values: deltas },
      };
    };
    return [key, { pairCount: pairs.length, fcpMs: metricStats("fcpMs"), lcpMs: metricStats("lcpMs"), longTaskTotalMs: metricStats("longTaskTotalMs") }];
  }));
  return { completedPairCount: completedPairs.length, pairs: completedPairs, viewports };
};

for (const variant of Object.values(builds)) {
  const info = await stat(variant.path).catch(() => null);
  assert.ok(info?.isDirectory(), `Prebuilt dist directory is missing: ${variant.path}`);
  variant.build = await digestBuild(variant.path);
}
builds.A.key = "A";
builds.B.key = "B";

const startedAt = new Date().toISOString();
const result = {
  schemaVersion: 1,
  startedAt,
  updatedAt: startedAt,
  protocol: {
    scenario: "cold Home route only; no setup or game interaction",
    coldContextPerSample: true,
    cacheDisabled: "CDP Network.setCacheDisabled(true)",
    serviceWorkers: "blocked; an init-script inert container and inert registration are supplied for the benchmark context",
    cpuThrottle: "4x",
    network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
    readiness: "load, #home-title, home hero image decoded, document.fonts.ready, then 250 ms",
    viewports: viewportOptions,
    pairsPerViewport,
    orderSeed: seed,
    orderGeneration: "seeded xorshift32; each viewport has AB/BA counts balanced within one, then all pair tasks are deterministically shuffled",
    resourceAccounting: "same-origin Resource Timing entries except navigation document; per-resource values retained",
    lcp: "latest LCP candidate observed after the readiness wait; not asserted as a formal page-final value",
    graphics: "prebuilt production output served without asset interception, source or resolution changes",
    interpretation: "Measurement evidence only; this runner makes no performance-win decision.",
  },
  builds: {
    A: { label: builds.A.label, path: builds.A.path, ...builds.A.build },
    B: { label: builds.B.label, path: builds.B.path, ...builds.B.build },
  },
  identicalBuilds: builds.A.build.sha256 === builds.B.build.sha256,
  schedule: pairSchedule.map(({ viewport, pairIndex, order }) => ({ viewport, pairIndex, order })),
  environment: { node: process.version, platform: process.platform, arch: process.arch, playwright: require("playwright/package.json").version },
  browserVersion: null,
  samples: [],
  pairedSummary: null,
};

const save = async () => {
  result.updatedAt = new Date().toISOString();
  result.pairedSummary = getPairedSummary(result.samples, pairSchedule);
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
  previews.push(await startPreview({ ...builds.A, key: "A" }));
  previews.push(await startPreview({ ...builds.B, key: "B" }));
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  result.browserVersion = await browser.version();
  await save();
  for (const task of pairSchedule) {
    const viewportKey = `${task.viewport.width}x${task.viewport.height}`;
    const pairRecord = { ...task, viewportKey };
    for (const variantKey of task.order) {
      if (interruptedSignal) break;
      const variant = builds[variantKey];
      const preview = previews[variantKey === "A" ? 0 : 1];
      const sampleIndex = result.samples.length + 1;
      const sample = await captureHome({
        browser,
        viewport: task.viewport,
        variant,
        pairIndex: task.pairIndex,
        sampleIndex,
        orderIndex: pairRecord.order.indexOf(variantKey) + 1,
        url: preview.url,
        build: variant.build,
      });
      sample.labels = { A: builds.A.label, B: builds.B.label };
      sample.pairOrder = [...task.order];
      result.samples.push(sample);
      await save();
      console.log(`${viewportKey} pair ${task.pairIndex}/${pairsPerViewport} ${task.order.join("→")} ${variantKey}: ${JSON.stringify({ fcpMs: sample.fcpMs, lcpMs: sample.lcpMs, longTaskTotalMs: sample.longTaskTotalMs, transferBytes: sample.transferBytes.total, buildSha256: sample.buildSha256 })}`);
    }
    if (interruptedSignal) break;
  }
  await save();
  console.log(`Saved ${result.samples.length} raw sample(s) and ${result.pairedSummary.completedPairCount} completed pair(s) to ${relative(root, outputPath)}.`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await Promise.all(previews.map(stopPreview));
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  await save();
  if (interruptedSignal) process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
}
