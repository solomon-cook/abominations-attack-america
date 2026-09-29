import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a public-room verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const url = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

function startServer({ command, args, serverCwd, env, label }) {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = async (check) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
      try { if (await check()) return; } catch { /* Wait for the local service. */ }
      await wait(100);
    }
    throw new Error(`${label} did not become ready.\n${output}`);
  };
  return { child, ready };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    wait(2000).then(() => server.child.kill("SIGKILL")),
  ]);
}

let webServer;
let apiServer;
let browser;
const runtimeErrors = [];
const viewportEvidence = [];

try {
  const evidenceDir = join(cwd, "output", "ui-review");
  await mkdir(evidenceDir, { recursive: true });

  webServer = startServer({
    command: process.execPath,
    args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    serverCwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    label: "Vite",
  });
  await webServer.ready(async () => (await fetch(url)).ok);

  apiServer = startServer({
    command: process.execPath,
    args: ["--import", "tsx/esm", "src/server.ts"],
    serverCwd: join(cwd, "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
    label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const width of [390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => runtimeErrors.push({ viewport: width, message: error.message }));
    let publicRoomRequests = 0;
    let releaseInitialEmpty;
    const initialEmpty = new Promise((resolve) => { releaseInitialEmpty = resolve; });
    await page.route(`${apiUrl}/rooms/public`, async (route) => {
      const requestIndex = publicRoomRequests++;
      if (requestIndex === 0) {
        await initialEmpty;
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      } else if (requestIndex === 1) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
          { code: "PUB123", status: "waiting", maxPlayers: 4, playerCount: 1, spectatorCount: 0 },
        ]) });
      } else if (requestIndex === 2) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Room discovery is temporarily unavailable." }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
          { code: "PUB456", status: "active", maxPlayers: 4, playerCount: 2, spectatorCount: 1 },
        ]) });
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    const disclosure = page.locator("details.home-online");
    if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator(":scope > summary").tap();
    const findRooms = page.locator('.lobby-actions button[aria-controls="public-room-results"]');
    assert.equal(await findRooms.innerText(), "Find public rooms", `${width}px: discovery should start in the idle state`);
    await findRooms.tap();
    const loadingStatus = page.getByRole("status").filter({ hasText: "Loading public rooms…" });
    await loadingStatus.waitFor({ state: "visible" });
    assert.equal(await findRooms.isDisabled(), true, `${width}px: refresh should be disabled while discovery is pending`);
    assert.equal(await findRooms.getAttribute("aria-busy"), "true", `${width}px: refresh should expose its busy state`);
    await findRooms.evaluate((button) => button.click());
    await wait(100);
    assert.equal(publicRoomRequests, 1, `${width}px: a repeated click must not start an overlapping public-room request`);

    releaseInitialEmpty();
    const emptyStatus = page.getByRole("status").filter({ hasText: "No public rooms are open right now." });
    await emptyStatus.waitFor({ state: "visible" });
    assert.equal(await findRooms.isDisabled(), false, `${width}px: refresh should be available after the empty response`);
    assert.equal(await page.getByRole("region", { name: "Public rooms" }).count(), 0, `${width}px: an empty response should not render a stale candidate list`);

    await findRooms.tap();
    const firstRoom = page.locator(".public-room").filter({ hasText: "PUB123" });
    await firstRoom.waitFor({ state: "visible" });
    assert.match(await page.getByRole("status").innerText(), /1 public room found\./, `${width}px: successful results should be announced`);
    await firstRoom.tap();
    assert.equal(await page.getByRole("textbox", { name: "Room code" }).inputValue(), "PUB123", `${width}px: selecting a candidate should fill the room code`);

    await page.getByRole("button", { name: "Find public rooms", exact: true }).tap();
    const discoveryError = page.getByRole("alert").filter({ hasText: "Room discovery is temporarily unavailable." });
    await discoveryError.waitFor({ state: "visible" });
    const retryRooms = page.getByRole("button", { name: "Retry public rooms", exact: true });
    assert.equal(await retryRooms.isDisabled(), false, `${width}px: retry should be available after failure`);
    assert.equal(await page.locator(".public-room").count(), 0, `${width}px: a failed refresh should clear stale candidates`);

    await retryRooms.tap();
    const recoveredRoom = page.locator(".public-room").filter({ hasText: "PUB456" });
    await recoveredRoom.waitFor({ state: "visible" });
    assert.equal(await page.getByRole("alert").count(), 0, `${width}px: successful retry should clear the previous error`);
    assert.match(await page.getByRole("status").innerText(), /1 public room found\./, `${width}px: recovered results should be announced`);

    const layout = await page.evaluate(() => {
      const viewportWidth = innerWidth;
      const documentWidth = document.documentElement.scrollWidth;
      const bodyWidth = document.body.scrollWidth;
      const elements = [
        document.querySelector(".home-online"),
        document.querySelector(".lobby"),
        document.querySelector(".lobby-discovery-status"),
        document.querySelector(".public-room"),
      ].filter(Boolean);
      const bounds = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { className: element.className, x: Math.round(rect.x), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) };
      });
      return { viewportWidth, documentWidth, bodyWidth, bounds };
    });
    assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1, `${width}px: Home discovery must not cause horizontal overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.bounds.every((bounds) => bounds.x >= -1 && bounds.right <= width + 1), `${width}px: discovery feedback and candidates must stay within the viewport: ${JSON.stringify(layout)}`);

    const screenshot = `public-room-discovery-${width}-${width === 390 ? 844 : 740}-2026-09-29.png`;
    await page.screenshot({ path: join(evidenceDir, screenshot), fullPage: true });
    viewportEvidence.push({
      viewport: `${width}x${width === 390 ? 844 : 740}`,
      requestCount: publicRoomRequests,
      pendingAnnounced: true,
      duplicateRefreshPrevented: true,
      emptyStateAnnounced: true,
      nonemptyStateAnnounced: true,
      candidateSelectionFillsRoomCode: true,
      failureAnnouncedAndRetryable: true,
      retryRecoversAndClearsError: true,
      layout,
      screenshot,
    });
    await page.close();
  }

  assert.deepEqual(runtimeErrors, [], `public-room route should have no browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
  const evidence = {
    generatedAt: new Date().toISOString(),
    route: "Home production UI against local memory API; public-room discovery responses intercepted by browser fixture",
    coverage: "390x844 and 320x740 delayed load, duplicate-click suppression, empty response, nonempty retry, 503 failure, successful recovery, and bounds",
    viewportEvidence,
    runtimeErrors,
    serviceEvidenceLimit: "The API route is a browser fixture for UI states; this does not prove production service availability or persistence behavior.",
  };
  const reportPath = join(cwd, "output", "ui-review", "public-room-discovery-2026-09-29.json");
  await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, evidence, reportPath }, null, 2)}\n`);
} finally {
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
