import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
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
const port = Number(process.env.BROWSER_SUPPORT_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const ownsServer = !process.env.BROWSER_TEST_URL;
const artifactDirectory = resolve(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const server = ownsServer
  ? spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(cwd, "apps/web"), stdio: ["ignore", "pipe", "pipe"],
  })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  await context.addInitScript(() => {
    Object.defineProperty(window.CSS, "supports", { configurable: true, value: () => false });
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const fallback = page.locator("main.unsupported-browser");
  await fallback.waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => CSS.supports("height", "100dvh")), false, "the test should exercise the unsupported-browser branch through the required feature predicate");
  assert.equal(await fallback.getAttribute("role"), "main", "the fallback should expose a main landmark");
  const heading = fallback.getByRole("heading", { level: 1 });
  assert.equal(await heading.innerText(), "This browser cannot run the playtest", "the fallback should name the support problem first in reading order");
  assert.match(await fallback.innerText(), /Use a current Chrome, Edge, Firefox, or Safari browser, then reload\./, "the fallback should explain how to continue");
  assert.match(await fallback.innerText(), /No match state has been started\./, "the fallback should state that no match was created");
  assert.equal(await page.locator(".home-screen, .game-screen, .setup-panel, .board-review-screen").count(), 0, "unsupported mode should not render Home, gameplay, setup, or board-review controls");
  assert.deepEqual(runtimeErrors, [], "the unsupported-browser page should render without runtime errors");

  await page.setViewportSize({ width: 320, height: 568 });
  const mobileBounds = await page.evaluate(() => {
    const main = document.querySelector("main.unsupported-browser");
    const heading = main?.querySelector("h1");
    const instructions = main?.querySelector(".lede");
    const bounds = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
      main: bounds(main), heading: bounds(heading), instructions: bounds(instructions),
    };
  });
  assert.ok(mobileBounds.main && mobileBounds.heading && mobileBounds.instructions, "mobile fallback content should remain rendered");
  assert.ok(mobileBounds.document.scrollWidth <= mobileBounds.viewport.width, `the fallback should not cause horizontal scrolling at 320px: ${JSON.stringify(mobileBounds)}`);
  assert.ok(mobileBounds.heading.x >= 0 && mobileBounds.heading.x + mobileBounds.heading.width <= mobileBounds.viewport.width,
    `the mobile heading should stay within the viewport: ${JSON.stringify(mobileBounds)}`);
  assert.ok(mobileBounds.instructions.x >= 0 && mobileBounds.instructions.x + mobileBounds.instructions.width <= mobileBounds.viewport.width,
    `the reload guidance should stay within the viewport: ${JSON.stringify(mobileBounds)}`);
  await mkdir(artifactDirectory, { recursive: true });
  const screenshot = resolve(artifactDirectory, `unsupported-browser-mobile-${date}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const artifact = resolve(artifactDirectory, `unsupported-browser-${date}.json`);
  await writeFile(artifact, `${JSON.stringify({
    ok: true,
    mode: "unsupported-browser",
    desktop: { viewport: "1280x720", checks: "support predicate, main landmark, heading, reload guidance, no-match message, no app/game controls, no runtime errors" },
    mobile: { viewport: "320x568", checks: "no horizontal overflow; heading and reload guidance remain within viewport", bounds: mobileBounds, screenshot },
    runtimeErrors,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    mode: "unsupported-browser",
    viewports: ["1280x720", "320x568"],
    check: "required feature predicate, fallback content and app-control absence, 320px mobile bounds and overflow verified",
    artifact,
  }));
  await context.close();
} finally {
  await browser?.close().catch(() => undefined);
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
