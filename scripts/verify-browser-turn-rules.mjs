import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
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
const port = Number(process.env.BROWSER_TURN_RULES_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const ownsServer = !process.env.BROWSER_TEST_URL;
const server = ownsServer
  ? spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: "http://127.0.0.1:8787" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const json = (data, origin) => ({
  status: 200,
  contentType: "application/json",
  headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
  body: JSON.stringify(data),
});
const requests = [];
const unexpectedApiRequests = [];
const runtimeErrors = [];
let browser;

async function preparePage(context, viewport) {
  const appOrigin = new URL(url).origin;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const isApiPath = /^\/(?:accounts|leaderboard|rooms|players)(?:\/|$)/.test(path);
    if (!isApiPath && requestUrl.origin === appOrigin) return route.continue();
    if (!isApiPath) {
      unexpectedApiRequests.push({ method: request.method(), origin: requestUrl.origin, path });
      return route.abort();
    }
    requests.push({ method: request.method(), path });
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": appOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-room-token",
      } });
      return;
    }
    if (request.method() === "GET" && path === "/accounts/me") return route.fulfill(json({ account: null }, appOrigin));
    if (request.method() === "GET" && path === "/leaderboard") return route.fulfill(json([], appOrigin));
    if (request.method() === "GET" && path === "/rooms/public") return route.fulfill(json([], appOrigin));
    unexpectedApiRequests.push({ method: request.method(), path });
    return route.fulfill(json({ error: `Unexpected TurnPrompt fixture request: ${request.method()} ${path}` }, appOrigin));
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(`${viewport}: ${error.message}`));
  await page.addInitScript(() => localStorage.setItem("abominations-onboarding-seen", "1"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".home-screen").waitFor({ state: "visible" });
  await page.locator("details.home-tools").locator(":scope > summary").click();
  await page.getByRole("button", { name: "Victory test" }).click();
  await page.locator(".game-screen").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Move");
  await page.getByRole("button", { name: "Expand turn panel" }).click();
  const details = page.locator(".decision-rules-help");
  await details.waitFor({ state: "visible" });
  await details.locator(":scope > summary").waitFor({ state: "visible" });
  return { page, details };
}

try {
  if (ownsServer) {
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
  }

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const { page: desktopPage, details: desktopDetails } = await preparePage(desktop, "1280x720");
  const desktopSummary = desktopDetails.locator(":scope > summary");
  const desktopBody = desktopDetails.locator("p");
  assert.equal(await desktopDetails.evaluate((node) => node.open), false, "Rules for this step should start collapsed on the Move prompt");
  assert.equal(await desktopSummary.evaluate((node) => node.tabIndex), 0, "the native disclosure summary should be keyboard focusable");
  await desktopSummary.focus();
  assert.equal(await desktopSummary.evaluate((node) => node === document.activeElement), true, "the disclosure summary should receive keyboard focus");
  await desktopPage.keyboard.press("Enter");
  await desktopPage.waitForFunction(() => document.querySelector(".decision-rules-help")?.open === true);
  assert.equal(await desktopSummary.evaluate((node) => node === document.activeElement), true, "opening with Enter should retain focus on the disclosure summary");
  const desktopDisclosureCopy = {
    title: (await desktopDetails.locator("strong").innerText()).trim(),
    body: (await desktopBody.innerText()).trim(),
  };
  assert.equal(desktopDisclosureCopy.title, "Move", "the open disclosure should label the current Move step");
  assert.match(desktopDisclosureCopy.body, /Select a highlighted monster/,
    "the Move disclosure should render its current-step guidance text");
  assert.match(desktopDisclosureCopy.body, /Pass Move/,
    "the Move disclosure should render its pass-step guidance text");
  await desktopPage.keyboard.press("Space");
  await desktopPage.waitForFunction(() => document.querySelector(".decision-rules-help")?.open === false);
  assert.equal(await desktopSummary.evaluate((node) => node === document.activeElement), true, "closing with Space should retain focus on the disclosure summary");
  const desktopBounds = await desktopSummary.boundingBox();
  assert.ok(desktopBounds && desktopBounds.x >= 0 && desktopBounds.x + desktopBounds.width <= 1281,
    `the desktop disclosure summary should fit horizontally: ${JSON.stringify(desktopBounds)}`);
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const { page: phonePage, details: phoneDetails } = await preparePage(phone, "390x844");
  const phoneSummary = phoneDetails.locator(":scope > summary");
  await phoneSummary.scrollIntoViewIfNeeded();
  const phoneSummaryBefore = await phoneSummary.boundingBox();
  assert.ok(phoneSummaryBefore && phoneSummaryBefore.x >= 0 && phoneSummaryBefore.x + phoneSummaryBefore.width <= 391,
    `the phone disclosure summary should fit horizontally before touch: ${JSON.stringify(phoneSummaryBefore)}`);
  assert.equal(await phoneDetails.evaluate((node) => node.open), false, "the phone disclosure should start collapsed");
  await phonePage.touchscreen.tap(phoneSummaryBefore.x + phoneSummaryBefore.width / 2, phoneSummaryBefore.y + phoneSummaryBefore.height / 2);
  await phonePage.waitForFunction(() => document.querySelector(".decision-rules-help")?.open === true);
  assert.equal(await phoneDetails.locator("strong").innerText(), "Move", "touch should reveal the Move step heading on phone");
  const phoneBody = phoneDetails.locator("p");
  await phoneBody.scrollIntoViewIfNeeded();
  assert.equal(await phoneBody.isVisible(), true, "the expanded Move guidance should be visible after phone scrolling");
  const phoneBodyBounds = await phoneBody.boundingBox();
  assert.ok(phoneBodyBounds && phoneBodyBounds.x >= 0 && phoneBodyBounds.x + phoneBodyBounds.width <= 391,
    `the expanded guidance should fit horizontally on phone: ${JSON.stringify(phoneBodyBounds)}`);
  const phoneWidths = await phonePage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(phoneWidths.document <= phoneWidths.viewport + 1 && phoneWidths.body <= phoneWidths.viewport + 1,
    `the expanded disclosure should not create horizontal phone overflow: ${JSON.stringify(phoneWidths)}`);
  await phoneSummary.scrollIntoViewIfNeeded();
  const phoneSummaryAfterScroll = await phoneSummary.boundingBox();
  assert.ok(phoneSummaryAfterScroll, "the disclosure summary should remain available to close by touch");
  await phonePage.touchscreen.tap(phoneSummaryAfterScroll.x + phoneSummaryAfterScroll.width / 2, phoneSummaryAfterScroll.y + phoneSummaryAfterScroll.height / 2);
  await phonePage.waitForFunction(() => document.querySelector(".decision-rules-help")?.open === false);
  assert.deepEqual(unexpectedApiRequests, [], "the focused disclosure flow should make no unexpected API requests");
  assert.deepEqual(runtimeErrors, [], "the focused disclosure flow should produce no browser runtime errors");

  const report = {
    ok: true,
    date: "2026-09-28",
    scenario: "Move-step TurnPrompt disclosure in the local Victory test fixture",
    assertions: {
      desktop1280x720: {
        startsCollapsed: true,
        summaryKeyboardFocusable: true,
        enterOpens: true,
        focusRemainsOnSummaryAfterOpen: true,
        renderedTitle: desktopDisclosureCopy.title,
        renderedGuidance: desktopDisclosureCopy.body,
        spaceCloses: true,
        focusRemainsOnSummaryAfterClose: true,
        summaryHorizontalBounds: desktopBounds,
      },
      phone390x844: {
        startsCollapsed: true,
        touchOpens: true,
        renderedTitle: "Move",
        expandedGuidanceVisibleAfterScroll: true,
        expandedGuidanceHorizontalBounds: phoneBodyBounds,
        widths: phoneWidths,
        touchCloses: true,
      },
      runtimeErrors,
      unexpectedApiRequests,
      apiRequests: requests,
    },
  };
  const outputDir = join(cwd, "output", "ui-review");
  await mkdir(outputDir, { recursive: true });
  const artifact = join(outputDir, "turn-prompt-rules-2026-09-28.json");
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  await phone.close();
} finally {
  await browser?.close().catch(() => undefined);
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
