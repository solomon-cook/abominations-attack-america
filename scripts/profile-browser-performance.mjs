import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { SourceMapConsumer } = require("source-map-js");
const root = process.cwd();
const webRoot = join(root, "apps/web");
const distRoot = join(webRoot, "dist");
const viewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];
const outputPath = resolve(root, process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length)
  ?? "output/performance/browser-cpu-profile-2026-09-28.json");

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a preview port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const digestBuild = async () => {
  const files = await readdir(distRoot, { recursive: true, withFileTypes: true });
  const paths = files.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  const hash = createHash("sha256");
  const assets = [];
  for (const path of paths) {
    const name = relative(distRoot, path).split("\\").join("/");
    const bytes = await readFile(path);
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    if (/^assets\/index-[^/]+\.(?:js|css)$/.test(name) || /^assets\/BoardReview-[^/]+\.js$/.test(name)) assets.push({ path: name, bytes: bytes.length });
  }
  return { sha256: hash.digest("hex"), assets };
};

const waitForServer = async (url, server, output) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is still starting. */ }
    if (server.exitCode !== null) throw new Error(`Vite preview exited before ready.\n${output()}`);
    if (attempt === 119) throw new Error(`Vite preview did not become ready at ${url}.\n${output()}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
};

const setupSignature = (panel) => panel && JSON.stringify({
  text: panel.innerText,
  buttons: [...panel.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
  detailsOpen: [...panel.querySelectorAll("details")].map((details) => details.open),
  busy: panel.getAttribute("aria-busy"),
});

const stubHomeApi = async (page, origin) => page.route("http://localhost:8787/**", async (route) => {
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
  if (request.method() === "GET" && ["/leaderboard", "/rooms/public"].includes(url.pathname)) return route.fulfill({ status: 200, headers, contentType: "application/json", body: "[]" });
  return route.fulfill({ status: 404, headers, contentType: "application/json", body: JSON.stringify({ error: `Unexpected profile API request: ${request.method()} ${url.pathname}` }) });
});

const summarizeProfile = (profile) => {
  const parents = new Map();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const selfUs = new Map();
  const stackUs = new Map();
  const durations = profile.timeDeltas ?? [];
  for (let index = 0; index < profile.samples.length; index += 1) {
    const nodeId = profile.samples[index];
    const deltaUs = durations[index] ?? 0;
    const node = nodes.get(nodeId);
    if (!node) continue;
    const frame = node.callFrame;
    const label = `${frame.url || "<runtime>"} · ${frame.functionName || "<anonymous>"}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
    selfUs.set(label, (selfUs.get(label) ?? 0) + deltaUs);
    const stack = [];
    let cursor = nodeId;
    while (cursor !== undefined) {
      const current = nodes.get(cursor);
      if (!current) break;
      const currentFrame = current.callFrame;
      stack.push(`${currentFrame.functionName || "<anonymous>"} (${currentFrame.url || "<runtime>"}:${currentFrame.lineNumber + 1})`);
      cursor = parents.get(cursor);
    }
    stack.reverse();
    const stackLabel = stack.slice(-10).join(" <- ");
    stackUs.set(stackLabel, (stackUs.get(stackLabel) ?? 0) + deltaUs);
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([label, sampledUs]) => ({ label, sampledMs: Number((sampledUs / 1000).toFixed(2)) }));
  return {
    sampleCount: profile.samples.length,
    sampledDurationMs: Number((durations.reduce((sum, delta) => sum + delta, 0) / 1000).toFixed(2)),
    topSelfTimeFrames: sorted(selfUs),
    topSampledStacks: sorted(stackUs),
  };
};

const mapProfile = (profile, consumersByAsset) => ({
  ...profile,
  nodes: profile.nodes.map((node) => {
    const frame = node.callFrame;
    const assetName = frame.url.split("/").at(-1);
    const consumer = consumersByAsset.get(assetName);
    if (!consumer || !frame.url.includes("/assets/")) return node;
    const mapped = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: frame.columnNumber });
    if (!mapped.source) return node;
    const workspaceOffset = mapped.source.indexOf(root);
    const source = workspaceOffset >= 0 ? mapped.source.slice(workspaceOffset + root.length + 1) : mapped.source;
    return { ...node, callFrame: {
      ...frame,
      url: source,
      functionName: mapped.name || frame.functionName,
      lineNumber: (mapped.line ?? 1) - 1,
      columnNumber: (mapped.column ?? 0),
    } };
  }),
});

const runSourceMapBuild = async (outDir) => {
  const build = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--sourcemap", "--outDir", outDir], { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  build.stdout.on("data", (chunk) => { output += chunk.toString(); });
  build.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    build.once("error", rejectExit);
    build.once("exit", (code) => resolveExit(code));
  });
  assert.equal(exitCode, 0, `temporary source-map build failed:\n${output}`);
  return output;
};

const loadMatchingMaps = async (sourcemapDir, productionBuild) => {
  const generatedAssets = await readdir(join(sourcemapDir, "assets"));
  const generatedEntry = generatedAssets.find((name) => /^index-[^/]+\.js$/.test(name));
  const productionEntry = productionBuild.assets.find((asset) => /^assets\/index-[^/]+\.js$/.test(asset.path));
  assert.ok(generatedEntry && productionEntry, "production and sourcemap builds both expose the application JS entry");
  const generatedCode = await readFile(join(sourcemapDir, "assets", generatedEntry), "utf8");
  const productionCode = await readFile(join(distRoot, productionEntry.path), "utf8");
  const strippedGenerated = generatedCode.replace(/\n?\/\/# sourceMappingURL=[^\r\n]+(?:\r?\n)?$/, "");
  const consumersByAsset = new Map();
  for (const name of generatedAssets.filter((asset) => asset.endsWith(".js.map"))) {
    const assetName = name.slice(0, -4);
    consumersByAsset.set(assetName, new SourceMapConsumer(JSON.parse(await readFile(join(sourcemapDir, "assets", name), "utf8"))));
  }
  return {
    consumersByAsset,
    generatedEntry,
    productionEntry: productionEntry.path,
    exactJavaScriptMatchAfterMapCommentRemoval: strippedGenerated === productionCode,
    mappedBuildBytes: Buffer.byteLength(strippedGenerated),
    productionBuildBytes: Buffer.byteLength(productionCode),
    byteDifference: Buffer.byteLength(strippedGenerated) - Buffer.byteLength(productionCode),
  };
};

const startProfile = async (session) => {
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
};
const stopProfile = async (session) => {
  const result = await session.send("Profiler.stop");
  await session.send("Profiler.disable");
  return result.profile;
};

const build = await digestBuild();
const sourcemapDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "aaa-performance-profile-")));
const port = await reservePort();
const url = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", sourcemapDir], { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"] });
let previewOutput = "";
preview.stdout.on("data", (chunk) => { previewOutput += chunk.toString(); });
preview.stderr.on("data", (chunk) => { previewOutput += chunk.toString(); });
let browser;
try {
  await runSourceMapBuild(sourcemapDir);
  const { consumersByAsset, generatedEntry, productionEntry, exactJavaScriptMatchAfterMapCommentRemoval, mappedBuildBytes, productionBuildBytes, byteDifference } = await loadMatchingMaps(sourcemapDir, build);
  await waitForServer(url, preview, () => previewOutput);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  for (const viewport of viewports) {
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
    await page.addInitScript(() => performance.mark("profile-document-start"));
    await stubHomeApi(page, new URL(url).origin);

    await startProfile(session);
    await page.goto(url, { waitUntil: "load" });
    await page.locator("#home-title").waitFor({ state: "visible" });
    await page.locator(".home-monster img").evaluate(async (image) => {
      if (!image.complete) await new Promise((resolveLoad, rejectLoad) => { image.addEventListener("load", resolveLoad, { once: true }); image.addEventListener("error", rejectLoad, { once: true }); });
      if (image.decode) await image.decode();
      await document.fonts.ready;
    });
    await page.waitForTimeout(250);
    const homeProfile = await stopProfile(session);

    await startProfile(session);
    await page.getByRole("combobox", { name: "Number of players" }).selectOption("2");
    await page.getByRole("button", { name: /Start local game/ }).click();
    const panel = page.locator(".setup-panel");
    await panel.waitFor({ state: "visible" });
    const setupChoiceCount = { value: 0 };
    for (let choiceIndex = 0; choiceIndex < 18; choiceIndex += 1) {
      if (!(await panel.count())) break;
      const details = panel.locator("details");
      if (await details.count() && !(await details.first().evaluate((node) => node.open))) await details.first().locator("summary").click();
      const choice = panel.locator(".setup-options button:visible:not(:disabled)").first();
      await choice.waitFor({ state: "visible" });
      const before = await panel.evaluate(setupSignature);
      await choice.click();
      setupChoiceCount.value += 1;
      await page.waitForFunction((previous) => {
        const current = document.querySelector(".setup-panel");
        return !current || current.getAttribute("aria-busy") !== "true" && JSON.stringify({
          text: current.innerText,
          buttons: [...current.querySelectorAll("button")].map((button) => [button.innerText, button.disabled]),
          detailsOpen: [...current.querySelectorAll("details")].map((item) => item.open),
          busy: current.getAttribute("aria-busy"),
        }) !== previous;
      }, before, { polling: "raf" });
    }
    await panel.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
    const setupProfile = await stopProfile(session);

    await startProfile(session);
    const legalTile = page.locator(".hex-tile.legal:not(:disabled)");
    await legalTile.first().waitFor({ state: "visible" });
    const destination = await legalTile.evaluateAll((tiles) => tiles.map((tile) => {
      const rect = tile.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      const hit = visible && document.elementFromPoint(x, y)?.closest(".hex-tile") === tile;
      return { key: tile.getAttribute("data-hex-key"), x, y, visible, hit, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) };
    }).filter((tile) => tile.visible && tile.hit).sort((a, b) => a.distance - b.distance)[0] ?? null);
    assert.ok(destination, `No visible, hit-testable legal destination at ${viewport.width}x${viewport.height}`);
    if (viewport.width <= 600) await page.touchscreen.tap(destination.x, destination.y);
    else await page.mouse.click(destination.x, destination.y);
    await page.getByRole("button", { name: "Confirm move", exact: true }).waitFor({ state: "visible" });
    const selectionProfile = await stopProfile(session);
    assert.deepEqual(pageErrors, [], `profile flow at ${viewport.width}x${viewport.height} has no page errors`);
    results.push({
      viewport,
      setupChoiceCount: setupChoiceCount.value,
      firstLegalDestination: destination.key,
      phases: {
        coldHomeStartup: summarizeProfile(mapProfile(homeProfile, consumersByAsset)),
        localSetup: summarizeProfile(mapProfile(setupProfile, consumersByAsset)),
        firstLegalSelection: summarizeProfile(mapProfile(selectionProfile, consumersByAsset)),
      },
      rawProfiles: { coldHomeStartup: homeProfile, localSetup: setupProfile, firstLegalSelection: selectionProfile },
    });
    await context.close();
  }
  const record = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    build,
    sourceMapBuild: { applicationEntry: generatedEntry, productionEntry, exactJavaScriptMatchAfterMapCommentRemoval, mappedBuildBytes, productionBuildBytes, byteDifference },
    node: process.version,
    playwright: require("playwright/package.json").version,
    browser: await browser.version(),
    preview: "Production assets served by Vite preview on loopback.",
    protocol: {
      contextPerViewport: true,
      cacheDisabled: true,
      serviceWorkers: "blocked",
      cpuThrottle: "4x",
      network: { rttMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
      samplingIntervalMicroseconds: 1000,
      phases: "Cold Home through hero image decode and fonts; local setup through visible choices; first legal board selection through Confirm move visible.",
      input: "Mouse at 1280x720; touchscreen at 390x844.",
      graphics: "Production assets served unchanged; no image interception, replacement, or visual changes.",
      caveat: "This is source-stack attribution from one profiled run per phase and viewport, not a performance timing comparison. It profiles a temporary Vite source-map build of the same source tree; minification can change with source-map generation, so the exact main JavaScript byte comparison is recorded separately. CPU sampling and 4x throttling affect runtime; use the exact-build unprofiled seven-run measurements for timing comparisons.",
    },
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  const raw = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const compressedPath = `${outputPath}.gz`;
  await writeFile(compressedPath, gzipSync(raw, { level: 9 }));
  const index = {
    schemaVersion: 1,
    capturedAt: record.capturedAt,
    build: record.build,
    sourceMapBuild: record.sourceMapBuild,
    environment: { node: record.node, playwright: record.playwright, browser: record.browser },
    protocol: record.protocol,
    results: record.results.map(({ rawProfiles, ...result }) => result),
    rawProfileArtifact: relative(root, compressedPath),
    rawProfileSha256: createHash("sha256").update(raw).digest("hex"),
    rawProfileCompressedSha256: createHash("sha256").update(await readFile(compressedPath)).digest("hex"),
  };
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(JSON.stringify({ output: relative(root, outputPath), compressedProfiles: relative(root, compressedPath), build: record.build, results: index.results.map(({ viewport, setupChoiceCount, phases }) => ({ viewport, setupChoiceCount, phases: Object.fromEntries(Object.entries(phases).map(([name, summary]) => [name, { samples: summary.sampleCount, sampledMs: summary.sampledDurationMs, topFrames: summary.topSelfTimeFrames.slice(0, 8) }])) })) }, null, 2));
} finally {
  if (browser) await browser.close();
  if (preview.exitCode === null && preview.signalCode === null) {
    preview.kill("SIGTERM");
    await Promise.race([new Promise((resolveStop) => preview.once("exit", resolveStop)), new Promise((resolveStop) => setTimeout(() => { if (preview.exitCode === null) preview.kill("SIGKILL"); resolveStop(); }, 2000))]);
  }
  await rm(sourcemapDir, { recursive: true, force: true });
}
