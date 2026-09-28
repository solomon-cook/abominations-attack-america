import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a full-route trophy verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const url = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const startServer = ({ args, serverCwd, env, label }) => {
  const child = spawn(process.execPath, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return {
    child,
    output: () => output,
    async ready(check) {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
        try { if (await check()) return; } catch { /* wait for startup */ }
        await wait(100);
      }
      throw new Error(`${label} did not become ready.\n${output}`);
    },
  };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.child.once("exit", resolve)), wait(2000).then(() => server.child.kill("SIGKILL"))]);
};
const report = {
  started: new Date().toISOString(),
  route: "production main.tsx route with memory API; online two-player match",
  scenario: "P1 moves Zorb from 13,4 onto the Army base at 12,4; P2 owns Army and chooses one reserve unit as trophy",
  viewports: {},
  runtimeErrors: [],
};
let webServer;
let apiServer;
let browser;

try {
  webServer = startServer({
    args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    serverCwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    label: "Vite",
  });
  await webServer.ready(async () => (await fetch(url)).ok);
  apiServer = startServer({
    args: ["--import", "tsx/esm", "src/server.ts"],
    serverCwd: join(cwd, "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
    label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const chooser = await browser.newPage({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1, hasTouch: true });
  for (const [role, page] of [["host", host], ["trophy chooser", chooser]]) {
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => report.runtimeErrors.push(`${role}: ${error.message}`));
    await page.addInitScript(() => localStorage.setItem("abominations-onboarding-seen", "1"));
    await page.route((requestUrl) => {
      const request = new URL(requestUrl);
      return request.origin === new URL(url).origin && request.pathname === "/accounts/me";
    }, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  await host.locator("details.home-online > summary").click();
  await host.getByLabel("Display name").fill("Trophy flow host");
  await host.getByLabel("Room privacy").selectOption("private");
  await host.getByRole("button", { name: "Create", exact: true }).click();
  await host.waitForFunction(() => Boolean(document.querySelector(".lobby strong")?.textContent?.trim()));
  const roomCode = (await host.locator(".lobby strong").first().textContent())?.trim();
  assert.ok(roomCode, "room creation returns its code");

  await chooser.locator("details.home-online > summary").click();
  await chooser.getByLabel("Display name").fill("Trophy flow chooser");
  await chooser.getByLabel("Room code").fill(roomCode);
  await chooser.getByRole("button", { name: "Join", exact: true }).click();
  await Promise.all([host.locator(".setup-panel").waitFor({ state: "visible" }), chooser.locator(".setup-panel").waitFor({ state: "visible" })]);

  const sessionOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "null"));
  const hostSession = await sessionOf(host);
  const chooserSession = await sessionOf(chooser);
  assert.ok(hostSession?.token && chooserSession?.token, "both main-route players have room sessions");
  const readRoom = async () => {
    const response = await fetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(hostSession.token)}`);
    assert.equal(response.status, 200, "the host session reads the match state");
    return response.json();
  };
  const postJson = async (path, token, body) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": token },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, `${path} succeeds: ${result.error ?? ""}`);
    return result;
  };

  let room = await readRoom();
  const opponentLair = room.state.setupState.definition.lairsByMonster["monster-2"].find((candidate) => candidate !== "13,4");
  assert.ok(opponentLair, "the opposing monster has a distinct legal lair");
  const setupActions = [
    [hostSession.token, { type: "choose-monster", monsterId: "monster-1" }],
    [chooserSession.token, { type: "choose-monster", monsterId: "monster-2" }],
    [chooserSession.token, { type: "choose-branch", branch: "Army" }],
    [hostSession.token, { type: "choose-branch", branch: "Navy" }],
    [hostSession.token, { type: "choose-lair", lair: "13,4" }],
    [chooserSession.token, { type: "choose-lair", lair: opponentLair }],
    [hostSession.token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [chooserSession.token, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ];
  for (const [token, action] of setupActions) {
    room = await readRoom();
    await postJson(`/rooms/${roomCode}/setup`, token, { expectedRevision: room.version, action });
  }
  for (const token of [hostSession.token, chooserSession.token]) await postJson(`/rooms/${roomCode}/ready`, token, { ready: true });
  await host.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online"
    && document.querySelector(".action-card h2")?.textContent?.trim() === "Move");
  await chooser.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online");

  room = await readRoom();
  assert.equal(room.state.phase, "move");
  assert.equal(room.state.monsters[0].location, "13,4");
  const actorId = hostSession.participantId;
  const submitCommand = async (command) => {
    room = await readRoom();
    return postJson(`/rooms/${roomCode}/actions`, hostSession.token, {
      envelope: {
        actionId: crypto.randomUUID(),
        actorId,
        expectedRevision: room.version,
        protocolVersion: 1,
        command,
      },
    });
  };
  await submitCommand({ type: "move", path: ["13,4", "12,4"] });
  room = await readRoom();
  assert.equal(room.state.phase, "encounter", "moving onto the unoccupied Army base reaches Encounter");
  assert.equal(room.state.monsters[0].location, "12,4");
  await submitCommand({ type: "resolve-encounter" });
  room = await readRoom();
  assert.equal(room.state.pendingDecision?.type, "encounter-choice", "Austin's city benefit is chosen before its Army-base trophy");
  await submitCommand({ type: "resolve-encounter", choice: "health" });
  room = await readRoom();
  assert.equal(room.state.pendingDecision?.type, "trophy-choice", "the live API creates the pending branch-owner decision");
  assert.equal(room.state.pendingDecision.playerIndex, 1, "Army's player owns the trophy choice");
  await chooser.waitForFunction(() => document.querySelector(".deployment-prompt.trophy-prompt")?.textContent?.includes("Player 2")
    && document.querySelectorAll(".bottom-context-dock button[aria-label$='as trophy']").length > 0);

  const pendingUnitIds = room.state.pendingDecision.unitIds;
  const selectedId = pendingUnitIds.find((id) => room.state.units.some((unit) => unit.id === id && unit.location === "record-tile"));
  assert.ok(selectedId, "the pending choice includes a unit still in reserve");
  const selectedUnit = room.state.units.find((unit) => unit.id === selectedId);
  assert.ok(selectedUnit, "the selected pending unit exists in the live game state");
  const eligibleSameTypeIndex = pendingUnitIds
    .filter((id) => room.state.units.find((unit) => unit.id === id)?.unitTypeId === selectedUnit.unitTypeId)
    .indexOf(selectedId);
  assert.ok(eligibleSameTypeIndex >= 0, "the selected reserve unit maps to the production reference slot");

  const inspectChooser = async (name, width, height, screenshotName) => {
    await chooser.setViewportSize({ width, height });
    await chooser.waitForTimeout(100);
    const panel = chooser.locator(".bottom-context-dock .sheet-reference");
    const action = chooser.getByRole("button", { name: `Choose ${selectedUnit.unitTypeId.replaceAll("-", " ")} from military record as trophy`, exact: true }).nth(eligibleSameTypeIndex);
    assert.equal(await panel.count(), 1, `${name} renders the production military reference in the main game route`);
    assert.equal(await action.isVisible(), true, `${name} exposes the branch owner's trophy action`);
    await action.scrollIntoViewIfNeeded();
    const [panelBox, actionBox, documentWidths, scrollState] = await Promise.all([
      panel.boundingBox(), action.boundingBox(),
      chooser.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })),
      chooser.locator(".command-station").evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, dockScrollHeight: node.querySelector(".bottom-context-dock")?.scrollHeight, dockClientHeight: node.querySelector(".bottom-context-dock")?.clientHeight })),
    ]);
    assert.ok(actionBox && actionBox.width > 0 && actionBox.height > 0, `${name} selected unit action has a hit target`);
    assert.ok(documentWidths.document <= width + 1 && documentWidths.body <= width + 1, `${name} full route has no horizontal overflow: ${JSON.stringify(documentWidths)}`);
    assert.ok(scrollState.dockClientHeight > 0, `${name} command dock remains mounted and scrollable`);
    const trayOverlay = await chooser.locator(".deployment-tray-shortcut").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        centerHit: hit?.tagName ?? null,
        centerHitClass: typeof hit?.className === "string" ? hit.className : "",
        centerHitIsButton: hit === button || button.contains(hit),
      };
    });
    assert.ok(trayOverlay.centerHitIsButton, `${name} tray shortcut remains hit-testable above or beside the pending trophy panel: ${JSON.stringify(trayOverlay)}`);
    if (screenshotName) await chooser.screenshot({ path: join(cwd, "output/ui-review", screenshotName), fullPage: false });
    return { viewport: `${width}x${height}`, trophyActionBounds: actionBox, referencePanelBounds: panelBox, documentWidths, dockScroll: scrollState, trayShortcutHitTest: trayOverlay };
  };

  await mkdir(join(cwd, "output/ui-review"), { recursive: true });
  report.viewports.portrait = await inspectChooser("tablet portrait", 834, 1112, "full-route-trophy-tablet-portrait-pending-2026-09-28.png");
  const trayLabelBefore = await chooser.locator(".deployment-tray-shortcut").getAttribute("aria-label");
  assert.match(trayLabelBefore ?? "", /\d+ deployed, \d+ in reserve$/);

  report.viewports.landscape = await inspectChooser("tablet landscape", 1024, 768, "full-route-trophy-tablet-landscape-pending-2026-09-28.png");
  const currentTrophyAction = chooser.getByRole("button", { name: `Choose ${selectedUnit.unitTypeId.replaceAll("-", " ")} from military record as trophy`, exact: true }).nth(eligibleSameTypeIndex);
  await currentTrophyAction.click();
  await host.waitForFunction(async ({ service, code, token }) => {
    const response = await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(token)}`);
    const current = await response.json();
    return current.state?.eventLog?.at(-1)?.action === "trophy.chosen";
  }, { service: apiUrl, code: roomCode, token: hostSession.token });
  room = await readRoom();
  const removed = room.state.units.find((unit) => unit.id === selectedId);
  assert.equal(room.state.eventLog.at(-1)?.action, "trophy.chosen");
  assert.equal(room.state.eventLog.at(-1)?.detail.unitId, selectedId, "the visible military-record action submits the intended pending piece");
  assert.equal(removed?.location, "permanently-removed", "the reserve trophy leaves play permanently");
  assert.ok(room.state.removedUnitIds.includes(selectedId), "permanent removal is indexed in the match state");
  assert.equal(room.state.pendingDecision?.type, "deployment", "the completed trophy decision advances the match to Deploy");
  await chooser.waitForFunction(() => document.querySelector(".top-turn-summary h2")?.textContent?.trim() === "Deploy");
  const trayLabelAfter = await chooser.locator(".deployment-tray-shortcut").getAttribute("aria-label");
  const trophyBadge = host.locator(`.opponent-player-card[aria-label*='${room.state.monsters[0].name}'] .opponent-trophy-badge`);
  await trophyBadge.waitFor({ state: "visible" });
  assert.notEqual(trayLabelAfter, trayLabelBefore, "the persistent Army tray immediately reflects the permanently removed reserve unit");
  assert.equal(await chooser.locator(".bottom-context-dock button[aria-label$='as trophy']").count(), 0, "the resolved decision removes stale trophy controls");
  await chooser.screenshot({ path: join(cwd, "output/ui-review", "full-route-trophy-tablet-landscape-resolved-2026-09-28.png"), fullPage: false });
  report.result = {
    selectedUnitId: selectedId,
    unitTypeId: selectedUnit.unitTypeId,
    removedLocation: removed?.location,
    removedUnitIndexed: room.state.removedUnitIds.includes(selectedId),
    pendingDecisionAfterChoice: room.state.pendingDecision?.type,
    trayBefore: trayLabelBefore,
    trayAfter: trayLabelAfter,
    takingPlayerTrophyBadgeVisible: true,
    trayShortcutCenterHitIsButtonAtPortrait: report.viewports.portrait.trayShortcutHitTest.centerHitIsButton,
    repeatedTrophyActionsAfterResolution: 0,
  };
  assert.deepEqual(report.runtimeErrors, [], "the full route should have no uncaught browser errors");
  report.completed = new Date().toISOString();
  const artifactPath = join(cwd, "output/ui-review", "full-route-trophy-tablet-2026-09-28.json");
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, artifactPath, result: report.result, viewports: report.viewports, runtimeErrors: report.runtimeErrors }, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.serverOutput = { web: webServer?.output(), api: apiServer?.output() };
  await mkdir(join(cwd, "output/ui-review"), { recursive: true });
  const artifactPath = join(cwd, "output/ui-review", "full-route-trophy-tablet-2026-09-28.json");
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
