import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = join(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const reservePort = (avoid = new Set()) => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a full-route deployment cancellation port."));
    if (avoid.has(address.port)) return server.close(() => reservePort(avoid).then(resolve, reject));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const startServer = ({ command, args, cwd: serverCwd, env, name, ready }) => {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const waitForReady = async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited before becoming ready.\n${output}`);
      try { if (await ready()) return; } catch { /* wait for startup */ }
      await wait(100);
    }
    throw new Error(`${name} did not become ready.\n${output}`);
  };
  return { child, output: () => output, waitForReady };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    wait(2500).then(() => server.child.kill("SIGKILL")),
  ]);
};
const accessibleButton = async (page, name, method = "click") => {
  const button = page.getByRole("button", { name, exact: true });
  await button.waitFor({ state: "visible" });
  if (method === "keyboard") {
    await button.focus();
    await page.keyboard.press("Enter");
  } else if (method === "touch") {
    await button.tap();
  } else {
    await button.click();
  }
};
const readSession = async (page) => page.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "{}"));
const summarizeInventory = (state) => {
  const result = {};
  for (const unit of state.units) {
    const branch = unit.branch;
    const location = unit.location === "record-tile" ? "reserve" : unit.location === "permanently-removed" ? "removed" : "deployed";
    result[branch] ??= { reserve: 0, deployed: 0, removed: 0 };
    result[branch][location] += 1;
  }
  return result;
};
const positionSnapshot = (state) => state.units
  .map(({ id, branch, unitTypeId, ownerPlayer, location }) => ({ id, branch, unitTypeId, ownerPlayer, location }))
  .sort((a, b) => a.id.localeCompare(b.id));
const eventSnapshot = (state) => state.eventLog.map(({ id, action, outcome, actorId }) => ({ id, action, outcome, actorId }));

const webPort = await reservePort();
const apiPort = await reservePort(new Set([webPort]));
const webUrl = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webServer = startServer({
  command: process.execPath,
  args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
  cwd: join(cwd, "apps/web"),
  env: { ...process.env, VITE_API_URL: apiUrl },
  name: "Vite",
  ready: async () => (await fetch(webUrl)).ok,
});
const apiServer = startServer({
  command: process.execPath,
  args: ["--import", "tsx/esm", "src/server.ts"],
  cwd: join(cwd, "apps/api"),
  env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(webUrl).origin },
  name: "Memory API",
  ready: async () => (await fetch(`${apiUrl}/health`)).ok,
});

const report = {
  started: new Date().toISOString(),
  scope: "production main.tsx route, two-player room backed by the development MemoryRoomStore, normal browser setup and live room commands; cancellation assertions use authoritative room version, event history, complete unit locations/inventory, command.submit WebSocket frames, and rendered board highlights; this is not production persistence or physical-rule evidence",
  setup: {},
  deployEntry: {},
  scenarios: {},
  runtimeErrors: [],
  commandSubmissionsAfterDeployBaseline: [],
};
let browser;
const contexts = [];
let firstPage;
let secondPage;
let roomCode;
let roomToken;

try {
  mkdirSync(artifactDirectory, { recursive: true });
  await Promise.all([webServer.waitForReady(), apiServer.waitForReady()]);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: true, hasTouch: true });
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: true, hasTouch: true });
  contexts.push(firstContext, secondContext);
  for (const context of contexts) {
    await context.addInitScript(() => {
      localStorage.setItem("abominations-confirm-irreversible", "0");
      localStorage.setItem("abominations-onboarding-seen", "1");
    });
  }
  firstPage = await firstContext.newPage();
  secondPage = await secondContext.newPage();
  for (const [name, page] of [["Player 1", firstPage], ["Player 2", secondPage]]) {
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => report.runtimeErrors.push(`${name}: ${error.message}`));
  }

  await firstPage.goto(webUrl, { waitUntil: "domcontentloaded" });
  console.log("Reached production Home route; creating room.");
  await firstPage.locator(".home-online summary").click();
  await firstPage.getByLabel("Display name").fill("Cancel Audit One");
  await firstPage.getByRole("button", { name: "Create", exact: true }).click();
  await firstPage.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem("abominations-session") ?? "null")?.room?.code));
  roomCode = (await readSession(firstPage)).room.code;
  assert.ok(roomCode, "the production Home route creates an online room");
  console.log(`Created room ${roomCode}; joining second production player.`);
  await secondPage.goto(`${webUrl}?room=${encodeURIComponent(roomCode)}`, { waitUntil: "domcontentloaded" });
  await secondPage.getByLabel("Display name").fill("Cancel Audit Two");
  await secondPage.getByRole("button", { name: "Join", exact: true }).click();
  await secondPage.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem("abominations-session") ?? "null")?.room?.code));
  await Promise.all([firstPage.locator(".setup-panel").waitFor({ state: "visible" }), secondPage.locator(".setup-panel").waitFor({ state: "visible" })]);
  console.log("Both players reached production setup; progressing through normal setup choices.");

  const setupStartingNavyForPlayerOne = async () => {
    await firstPage.getByRole("button", { name: "Deploy starting troops", exact: true }).click();
    const drawer = firstPage.locator(".military-drawer[role=dialog]");
    await drawer.waitFor({ state: "visible" });
    const place = async (accessibleName, key) => {
      const control = firstPage.getByRole("button", { name: accessibleName, exact: true });
      await control.waitFor({ state: "visible" });
      await control.click();
      const target = key
        ? firstPage.locator(`.hex-tile.legal:not(:disabled)[data-hex-key="${key}"]`)
        : firstPage.locator(".hex-tile.legal:not(:disabled)").first();
      await target.waitFor({ state: "visible" });
      await target.click();
    };
    await place("Deploy navy fighter piece 1", "2,8");
    await place("Deploy navy fighter piece 2", "3,7");
    await place("Deploy national guard tank piece 1");
    await firstPage.getByRole("button", { name: "Finish starting deployment", exact: true }).click();
    report.setup.startingDeployment = ["two Navy fighters", "one National Guard tank"];
  };

  const progressSetup = async (page, playerNumber) => {
    const panel = page.locator(".setup-panel");
    if (!(await panel.count())) return false;
    const setupCopy = await panel.evaluate((node) => ({
      phase: node.classList.contains("lair-selection-prompt") ? "lair selection" : node.querySelector("h2")?.textContent?.trim().toLowerCase() ?? "",
      turn: node.querySelector(".setup-turn")?.textContent ?? node.querySelector("strong")?.textContent ?? "",
    }));
    const phase = setupCopy.phase;
    const seat = setupCopy.turn.match(/Player\s+(\d+)/i);
    const choosingPlayer = seat ? Number(seat[1]) : undefined;
    const enabled = panel.locator(".setup-options button:visible:not(:disabled)");
    if (phase.includes("monster selection")) {
      if (!(await enabled.count())) return false;
      await enabled.first().click();
      return true;
    }
    if (phase.includes("branch selection")) {
      if (!(await enabled.count())) return false;
      const branch = choosingPlayer === 1 ? "Navy" : "Army";
      const option = panel.locator(`.branch-choice[data-branch="${branch}"]:visible:not(:disabled)`);
      if (!(await option.count())) return false;
      await option.click();
      return true;
    }
    if (phase.includes("lair selection")) {
      const disclosure = panel.locator("details");
      if (await disclosure.count() && !(await disclosure.evaluate((node) => node.open))) {
        await disclosure.locator("summary").click();
        return true;
      }
      if (!(await enabled.count())) return false;
      await enabled.first().click();
      return true;
    }
    if (phase.includes("starting choice")) {
      if (choosingPlayer === 1 && playerNumber === 1) {
        await setupStartingNavyForPlayerOne();
        return true;
      }
      if (choosingPlayer === 2 && playerNumber === 2) {
        const research = page.getByRole("button", { name: "Draw Research", exact: true });
        if (!(await research.isEnabled())) return false;
        await research.click();
        return true;
      }
    }
    return false;
  };

  let setupComplete = false;
  let stalled = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const [firstProgress, secondProgress] = await Promise.all([
      progressSetup(firstPage, 1),
      progressSetup(secondPage, 2),
    ]);
    if (!(await firstPage.locator(".setup-panel").count()) && !(await secondPage.locator(".setup-panel").count())) {
      setupComplete = true;
      break;
    }
    if (!firstProgress && !secondProgress) {
      stalled += 1;
      if (stalled > 12) {
        const diagnostic = await Promise.all([firstPage, secondPage].map((page) => page.locator(".setup-panel").innerText().catch(() => "no setup panel")));
        throw new Error(`Online setup stopped progressing: ${JSON.stringify(diagnostic)}`);
      }
      await wait(120);
    } else {
      stalled = 0;
      await wait(120);
    }
  }
  assert.ok(setupComplete, "production browser setup completes for both online players");
  console.log("Production setup complete; starting match and entering Deploy.");
  report.setup = { ...report.setup, branches: { player1: "Navy", player2: "Army" }, normalSetupUi: true };

  const markReady = async (page) => {
    const menu = page.locator(".hud-menu");
    const menuSummary = menu.locator("summary").first();
    if (!(await menu.evaluate((node) => node.open))) await menuSummary.click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await menuSummary.click();
  };
  await markReady(firstPage);
  await markReady(secondPage);
  await firstPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Move");
  await secondPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Move");

  const firstSession = await readSession(firstPage);
  roomToken = firstSession.token;
  assert.ok(roomToken && firstSession.participantId, "Player 1's real room session is available for authoritative snapshots");
  const readRoom = async () => {
    const response = await fetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(roomToken)}`);
    const result = await response.json();
    assert.equal(response.status, 200, `authoritative room read should succeed (${response.status}): ${JSON.stringify(result)}`);
    return result;
  };

  await firstPage.locator(".piece-context-tab summary").first().click();
  const disappear = firstPage.getByRole("button", { name: "Disappear to lair", exact: true });
  await disappear.waitFor({ state: "visible" });
  await disappear.click();
  await firstPage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy");
  let deployBaseline = await readRoom();
  assert.equal(deployBaseline.state.phase, "deploy", "the production route reaches Deploy before acceptance snapshots");
  assert.equal(deployBaseline.state.currentPlayer, 0, "the first setup player owns this Deploy acceptance turn");
  assert.ok(deployBaseline.state.units.some((unit) => unit.branch === "Navy" && unit.location !== "record-tile" && unit.location !== "permanently-removed"), "starting setup leaves an on-board Navy unit available for redeployment");
  assert.ok(deployBaseline.state.units.some((unit) => unit.branch === "Navy" && unit.location === "record-tile"), "starting setup leaves a Navy unit in reserve for deployment");
  await wait(300);
  const settledRoom = await readRoom();
  assert.equal(settledRoom.version, deployBaseline.version, "room version is stable before the cancellation matrix begins");
  deployBaseline = settledRoom;
  report.deployEntry = {
    path: "production Move context → Disappear to lair → production Deploy surface",
    command: "disappear-monster",
    currentPlayer: deployBaseline.state.currentPlayer,
    roomVersion: deployBaseline.version,
    eventCount: deployBaseline.state.eventLog.length,
    branch: "Navy",
    inventory: summarizeInventory(deployBaseline.state),
  };
  console.log("Production Deploy entry established; running phone/tablet keyboard/touch cancel matrix.");

  const commandSubmissions = [];
  firstPage.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const raw = frame && typeof frame === "object" && "payload" in frame ? frame.payload : frame;
      const source = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
      try {
        const message = JSON.parse(source);
        if (message.type === "command.submit") commandSubmissions.push({ actionId: message.envelope?.actionId, commandType: message.envelope?.command?.type });
      } catch { /* Ignore non-command protocol frames. */ }
    });
  });
  const commandCountAtDeploy = commandSubmissions.length;
  const entryPositions = positionSnapshot(deployBaseline.state);
  const entryEvents = eventSnapshot(deployBaseline.state);
  const entryInventory = summarizeInventory(deployBaseline.state);
  const snapshotMatchesDeployEntry = (room) => {
    assert.equal(room.version, deployBaseline.version, "cancellation does not change the room revision/version");
    assert.equal(room.state.phase, deployBaseline.state.phase, "cancellation leaves the phase unchanged");
    assert.equal(room.state.currentPlayer, deployBaseline.state.currentPlayer, "cancellation leaves the active player unchanged");
    assert.deepEqual(eventSnapshot(room.state), entryEvents, "cancellation appends no game event");
    assert.deepEqual(positionSnapshot(room.state), entryPositions, "cancellation leaves every unit position and ownership unchanged");
    assert.deepEqual(summarizeInventory(room.state), entryInventory, "cancellation leaves branch reserve/deployed/removed inventory unchanged");
    assert.equal(room.state.deploymentsThisTurn, deployBaseline.state.deploymentsThisTurn, "cancellation leaves the deployment allowance unchanged");
    assert.deepEqual(room.state.deploymentDestinations, deployBaseline.state.deploymentDestinations, "cancellation leaves completed deployment destinations unchanged");
    assert.deepEqual(room.state.pendingDecision, deployBaseline.state.pendingDecision, "cancellation leaves the pending decision unchanged");
    assert.equal(commandSubmissions.length, commandCountAtDeploy, "cancellation sends no command.submit WebSocket frame");
  };

  const legalHighlightKeys = async () => firstPage.locator(".hex-tile.deployment-legal").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-hex-key")).sort());
  const runCancellation = async ({ kind, viewport, width, height, input }) => {
    await firstPage.setViewportSize({ width, height });
    await firstPage.waitForFunction(({ width: expectedWidth, height: expectedHeight }) => innerWidth === expectedWidth && innerHeight === expectedHeight, { width, height });
    const before = await readRoom();
    snapshotMatchesDeployEntry(before);
    const tray = firstPage.locator(".deployment-tray-shortcut");
    await tray.waitFor({ state: "visible" });
    const trayLabel = await tray.getAttribute("aria-label");
    assert.match(trayLabel ?? "", /Open Navy military sheet/, `${viewport}/${kind} starts from the active player's persistent branch tray`);
    await accessibleButton(firstPage, trayLabel, input);
    const drawer = firstPage.locator(".military-drawer[role=dialog]");
    await drawer.waitFor({ state: "visible" });
    const selector = kind === "deploy" ? /^Deploy .* piece \d+$/ : /^Redeploy .* piece \d+$/;
    const choice = drawer.getByRole("button", { name: selector }).first();
    await choice.waitFor({ state: "visible" });
    const selectedChoiceName = await choice.getAttribute("aria-label");
    assert.ok(selectedChoiceName, `${kind} choice is named for assistive technology`);
    await accessibleButton(firstPage, selectedChoiceName, input);

    const cancel = firstPage.getByRole("button", { name: "Cancel placement", exact: true });
    await cancel.waitFor({ state: "visible" });
    const highlightKeys = await legalHighlightKeys();
    assert.ok(highlightKeys.length > 0, `${viewport}/${kind} selection shows legal map highlights before cancel`);
    const bounds = await cancel.boundingBox();
    const dimensions = await firstPage.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth }));
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= dimensions.width + 1 && bounds.y + bounds.height <= dimensions.height + 1,
      `${viewport}/${kind} Cancel placement target fits inside viewport: ${JSON.stringify({ bounds, dimensions })}`);
    assert.ok(dimensions.documentWidth <= dimensions.width + 1, `${viewport}/${kind} has no page-level horizontal overflow`);
    const selectingRoom = await readRoom();
    snapshotMatchesDeployEntry(selectingRoom);

    await accessibleButton(firstPage, "Cancel placement", input);
    await cancel.waitFor({ state: "detached" });
    await firstPage.waitForFunction(() => [...document.querySelectorAll(".hex-tile.deployment-legal")].length === 0);
    const after = await readRoom();
    snapshotMatchesDeployEntry(after);
    assert.deepEqual(await legalHighlightKeys(), [], `${viewport}/${kind} cancellation clears every deployment highlight`);
    assert.equal(await firstPage.getByRole("button", { name: "Cancel placement", exact: true }).count(), 0, `${viewport}/${kind} placement prompt disappears after cancel`);

    const reopenTray = firstPage.locator(".deployment-tray-shortcut");
    const reopenLabel = await reopenTray.getAttribute("aria-label");
    await accessibleButton(firstPage, reopenLabel, input);
    await drawer.waitFor({ state: "visible" });
    assert.equal(await drawer.getByRole("button", { name: selectedChoiceName, exact: true }).count(), 1, `${viewport}/${kind} canceled piece remains selectable in the production sheet`);
    await accessibleButton(firstPage, "Close military sheets", input);
    await drawer.waitFor({ state: "detached" });
    const key = `${kind}-${viewport}-${input}`;
    report.scenarios[key] = {
      status: "passed",
      viewport: `${width}x${height}`,
      input,
      action: selectedChoiceName,
      before: { roomVersion: before.version, eventCount: before.state.eventLog.length, inventory: summarizeInventory(before.state) },
      during: { highlightedHexes: highlightKeys.length, cancelButtonVisibleAndInBounds: true },
      after: { roomVersion: after.version, eventCount: after.state.eventLog.length, commandSubmissions: commandSubmissions.length - commandCountAtDeploy, inventory: summarizeInventory(after.state), positionsUnchanged: true, highlights: await legalHighlightKeys(), selectedChoiceRemainsAvailable: true },
    };
  };

  await runCancellation({ kind: "deploy", viewport: "phone", width: 390, height: 844, input: "touch" });
  await runCancellation({ kind: "deploy", viewport: "tablet", width: 834, height: 1112, input: "keyboard" });
  await runCancellation({ kind: "redeploy", viewport: "phone", width: 390, height: 844, input: "keyboard" });
  await runCancellation({ kind: "redeploy", viewport: "tablet", width: 834, height: 1112, input: "touch" });
  console.log("All four cancellation cases passed; writing full-route evidence.");

  report.commandSubmissionsAfterDeployBaseline = commandSubmissions;
  assert.deepEqual(commandSubmissions, [], "neither cancel flow submits a command through the production room WebSocket");
  assert.deepEqual(report.runtimeErrors, [], "full-route browser flows have no uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `deployment-cancel-full-route-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Full-route deployment cancellation browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `deployment-cancel-full-route-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser?.close();
  await Promise.all([stopServer(webServer), stopServer(apiServer)]);
}
