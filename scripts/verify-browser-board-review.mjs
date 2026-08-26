import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import WebSocket from "ws";
import { chromePath } from "./chrome-path.mjs";

const port = Number(process.env.BROWSER_REVIEW_PORT ?? 5177);
const ownsServer = !process.env.BROWSER_TEST_URL;
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = ownsServer
  ? spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const viewportWidth = Number(process.env.BROWSER_TEST_WIDTH ?? 1280);
const viewportHeight = Number(process.env.BROWSER_TEST_HEIGHT ?? 720);
const debugPort = Number(process.env.BROWSER_DEBUG_PORT ?? 9228);
const screenshotPath = process.env.BROWSER_TEST_SCREENSHOT_PATH;
const profile = await mkdtemp(join(tmpdir(), "abominations-board-review-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
  `--window-size=${viewportWidth},${viewportHeight}`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
let chromeOutput = "";
chrome.stdout.on("data", (chunk) => { chromeOutput += chunk.toString(); });
chrome.stderr.on("data", (chunk) => { chromeOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      await wait(100);
    }
  }
  if (!ready) {
    server.kill("SIGTERM");
    throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
  }
}
const debugUrl = `http://127.0.0.1:${debugPort}/json/list`;
let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(debugUrl);
    page = (await response.json()).find((candidate) => candidate.type === "page");
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
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 600 });
  await command("Page.navigate", { url });
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Review full board shell")`, "home board-review control");
  await evaluate(`([...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Review full board shell"))?.click()`);
  await waitFor(`document.querySelectorAll(".board-review-hex").length === 254`, "254 board-review faces");
  await waitFor(`document.querySelectorAll(".board-review-source img").length === 2 && [...document.querySelectorAll(".board-review-source img")].every((image) => image.complete && image.naturalWidth > 0)`, "reference board photographs");
  await evaluate(`document.querySelectorAll(".board-review-hex")[42]?.click()`);
  await waitFor(`document.querySelectorAll('.board-review-hex[data-selected="true"]').length === 1 && Boolean(document.querySelector(".board-review-inspector"))`, "selected-cell review inspector");
  const result = await evaluate(`(() => {
    const cells = [...document.querySelectorAll(".board-review-hex")];
    const tops = new Set(cells.map((cell) => cell.style.top));
    const style = getComputedStyle(cells[0]);
    const references = [...document.querySelectorAll(".board-review-source img")];
    const canvasRect = document.querySelector(".board-review-canvas").getBoundingClientRect();
    const visible = cells.every((cell) => { const rect = cell.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
    const contained = cells.every((cell) => { const rect = cell.getBoundingClientRect(); return rect.left >= canvasRect.left - 1 && rect.right <= canvasRect.right + 1 && rect.top >= canvasRect.top - 1 && rect.bottom <= canvasRect.bottom + 1; });
    return {
      count: cells.length,
      rows: tops.size,
      aspectRatio: style.aspectRatio,
      creamFace: style.backgroundImage.includes("linear-gradient"),
      visible,
      contained,
      selectedCells: cells.filter((cell) => cell.dataset.selected === "true").length,
      inspector: Boolean(document.querySelector(".board-review-inspector")),
      referenceImages: references.length,
      referenceImagesLoaded: references.filter((image) => image.complete && image.naturalWidth > 0).length,
      referenceOnlyCaptions: [...document.querySelectorAll(".board-review-source figcaption")].every((caption) => /reference/i.test(caption.textContent ?? "")),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      playableTiles: document.querySelectorAll(".hex-tile, .location").length,
      unresolvedLabels: [...document.querySelectorAll("[aria-label]")].filter((node) => /Unresolved/i.test(node.getAttribute("aria-label") ?? "")).length,
    };
  })()`);
  if (!result || result.count !== 254 || result.rows !== 13 || !/^1\.1547( \/ 1)?$/.test(result.aspectRatio) || !result.creamFace || !result.visible || !result.contained || result.selectedCells !== 1 || !result.inspector || result.referenceImages !== 2 || result.referenceImagesLoaded !== 2 || !result.referenceOnlyCaptions || result.horizontalOverflow || result.playableTiles !== 0 || result.unresolvedLabels !== 0) {
    throw new Error(`Board review browser contract failed: ${JSON.stringify(result)}`);
  }
  if (screenshotPath) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  console.log(JSON.stringify({ ok: true, url, viewport: `${viewportWidth}x${viewportHeight}`, ...result }));
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
