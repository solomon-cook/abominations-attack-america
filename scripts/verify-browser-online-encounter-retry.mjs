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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve an online Encounter verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const url = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const startServer = ({ command, args, cwd: serverCwd, env, label }) => {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = async (check) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
      try { if (await check()) return; } catch { /* wait for the local service */ }
      await wait(100);
    }
    throw new Error(`${label} did not become ready.\n${output}`);
  };
  return { child, ready };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.child.once("exit", resolve)), wait(2000).then(() => server.child.kill("SIGKILL"))]);
};
const readRoom = async (page, roomCode) => page.evaluate(async ({ service, code }) => {
  const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
  const response = await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`);
  return { status: response.status, body: await response.json() };
}, { service: apiUrl, code: roomCode });
let webServer;
let apiServer;
let browser;

try {
  webServer = startServer({
    command: process.execPath,
    args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    cwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    label: "Vite",
  });
  await webServer.ready(async () => (await fetch(url)).ok);
  apiServer = startServer({
    command: process.execPath,
    args: ["--import", "tsx/esm", "src/server.ts"],
    cwd: join(cwd, "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
    label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const runtimeErrors = [];
  const activePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const secondPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let injectedStaleRevision = null;
  for (const page of [activePage, secondPage]) {
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      const expectedStaleResponse = injectedStaleRevision !== null
        && message.text().includes("status of 400 (Bad Request)")
        && (!location || location.startsWith(apiUrl));
      if (!expectedStaleResponse) runtimeErrors.push(message.text());
    });
    await page.route((requestUrl) => {
      const request = new URL(requestUrl);
      return request.origin === apiUrl && request.pathname === "/accounts/me";
    }, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
  }
  let activeSocketRoute;
  await activePage.routeWebSocket((requestUrl) => requestUrl.port === String(apiPort) && requestUrl.pathname === "/ws", (route) => {
    activeSocketRoute = route;
    route.connectToServer();
  });

  await Promise.all([activePage.goto(url, { waitUntil: "domcontentloaded" }), secondPage.goto(url, { waitUntil: "domcontentloaded" })]);
  await activePage.locator("details.home-online > summary").click();
  await activePage.getByLabel("Display name").fill("Encounter player one");
  await activePage.getByLabel("Room privacy").selectOption("public");
  await activePage.getByRole("button", { name: "Create", exact: true }).click();
  await activePage.waitForFunction(() => document.querySelector(".lobby strong")?.textContent?.trim().length > 0);
  const roomCode = await activePage.locator(".lobby strong").first().textContent().then((text) => text?.trim());
  assert.ok(roomCode, "room creation exposes a room code");

  await secondPage.locator("details.home-online > summary").click();
  await secondPage.getByLabel("Display name").fill("Encounter player two");
  await secondPage.getByLabel("Room code").fill(roomCode);
  await secondPage.getByRole("button", { name: "Join", exact: true }).click();
  await Promise.all([activePage.locator(".setup-panel").waitFor({ state: "visible" }), secondPage.locator(".setup-panel").waitFor({ state: "visible" })]);
  const initialSetup = await readRoom(activePage, roomCode);
  const opponentLair = initialSetup.body.state.setupState?.definition?.lairsByMonster?.["monster-2"]?.find((candidate) => candidate !== "13,4");
  assert.ok(opponentLair, "the configured setup offers a distinct Tomanagi lair");

  const setupActions = [
    [activePage, { type: "choose-monster", monsterId: "monster-1" }],
    [secondPage, { type: "choose-monster", monsterId: "monster-2" }],
    [secondPage, { type: "choose-branch", branch: "Army" }],
    [activePage, { type: "choose-branch", branch: "Navy" }],
    [activePage, { type: "choose-lair", lair: "13,4" }],
    [secondPage, { type: "choose-lair", lair: opponentLair }],
    [activePage, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [secondPage, { type: "choose-starting-choice", startingChoice: { kind: "deploy", unitId: "0-1", destination: "12,4" } }],
  ];
  for (const [page, action] of setupActions) {
    const result = await page.evaluate(async ({ service, roomCode: code, action: setupAction }) => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const current = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
      const response = await fetch(`${service}/rooms/${code}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
        body: JSON.stringify({ expectedRevision: current.version, action: setupAction }),
      });
      const body = await response.json();
      return { status: response.status, error: body.error };
    }, { service: apiUrl, roomCode, action });
    assert.equal(result.status, 200, `the real memory API accepts deterministic setup action ${action.type}: ${result.error ?? ""}`);
  }
  for (const [page, player] of [[activePage, "Player 1"], [secondPage, "Player 2"]]) {
    const ready = await page.evaluate(async ({ service, roomCode: code }) => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(`${service}/rooms/${code}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
        body: JSON.stringify({ ready: true }),
      });
      return { status: response.status, body: await response.json() };
    }, { service: apiUrl, roomCode });
    assert.equal(ready.status, 200, `${player} confirms completed setup through the actual memory API`);
  }
  await activePage.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online" && document.querySelector(".action-card h2")?.textContent?.trim() === "Move");
  await secondPage.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online");
  if (await activePage.locator(".onboarding").isVisible()) await activePage.getByRole("button", { name: /Got it.*hide guide/ }).click();

  let current = await readRoom(activePage, roomCode);
  assert.equal(current.status, 200, "active player can read the room from the memory API");
  assert.equal(current.body.state.currentPlayer, 0, "the setup flow gives Player 1 the first turn");
  assert.equal(current.body.state.monsters[0].name, "Zorb", "Player 1 controls Zorb for the city reward path");
  assert.equal(current.body.state.monsters[0].location, "13,4", "Zorb starts at the selected audited-board lair adjacent to city/base 12,4");
  assert.equal(current.body.state.units.find((unit) => unit.id === "0-1")?.location, "12,4", "Player 2 deploys an Army Missile Launcher to the adjacent city/base");
  assert.deepEqual(current.body.state.setupAssignments.map((seat) => seat.startingChoice.kind), ["research", "deploy"], "the active player draws Research and the opponent deploys one legal Army piece");

  const cityTile = activePage.locator('.hex-tile.legal:not(:disabled)[data-hex-key="12,4"]');
  await cityTile.waitFor({ state: "visible" });
  await cityTile.click();
  await activePage.getByRole("button", { name: "Confirm move", exact: true }).click();
  await activePage.waitForFunction(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    return room.state.monsters[0]?.location === "12,4";
  }, { service: apiUrl, code: roomCode });
  const endMovement = activePage.getByRole("button", { name: "End all movement →", exact: true });
  if (!await endMovement.isVisible()) await activePage.locator("details.piece-context-tab > summary").click();
  await endMovement.waitFor({ state: "visible" });
  await endMovement.click();
  await activePage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Fight");
  const session = await activePage.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "{}"));
  const fightRoom = await fetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`).then((response) => response.json());
  assert.equal(fightRoom.state.phase, "fight", "movement routes the match into Fight");
  assert.equal(fightRoom.state.pendingBattles.length, 1, "the adjacent Army Missile Launcher creates one battle on the city/base");
  const fightResponse = await fetch(`${apiUrl}/rooms/${roomCode}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": session.token },
    body: JSON.stringify({ envelope: {
      actionId: crypto.randomUUID(), actorId: session.participantId, expectedRevision: fightRoom.version,
      protocolVersion: 1, command: { type: "advance" },
    } }),
  });
  const fightResult = await fightResponse.json();
  assert.equal(fightResponse.status, 200, `the memory API resolves the single battle: ${fightResult.error ?? ""}`);
  assert.equal(fightResult.state.phase, "encounter", "the configured combat removes the troop and enters Encounter");
  assert.equal(fightResult.state.eventLog.at(-1)?.action, "fight.resolved", "the authoritative log records the preceding battle at the reward city");
  await activePage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter");
  current = await readRoom(activePage, roomCode);
  assert.equal(current.body.state.phase, "encounter", "the live route follows the API into Encounter");
  assert.equal(current.body.state.monsters[0].location, "12,4", "the authoritative Encounter remains at the city/base just fought over");

  assert.ok(activeSocketRoute, "the active route connected through the actual memory API WebSocket");
  activeSocketRoute.close({ code: 1001, reason: "Verifier exercises HTTP action fallback" });
  await activePage.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() !== "online");

  const choicePostResponses = [];
  await activePage.route((requestUrl) => {
    const parsed = new URL(requestUrl);
    return parsed.origin === apiUrl && parsed.pathname === `/rooms/${roomCode}/actions`;
  }, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const original = route.request().postDataJSON();
    const command = original?.envelope?.command;
    if (command?.type === "resolve-encounter" && command.choice && injectedStaleRevision === null) {
      injectedStaleRevision = original.envelope.expectedRevision - 1;
      await route.continue({ postData: JSON.stringify({ ...original, envelope: { ...original.envelope, expectedRevision: injectedStaleRevision } }) });
      return;
    }
    await route.continue();
  });
  activePage.on("response", (response) => {
    const request = response.request();
    if (request.method() !== "POST" || new URL(response.url()).pathname !== `/rooms/${roomCode}/actions`) return;
    let body;
    try { body = request.postDataJSON(); } catch { return; }
    if (body?.envelope?.command?.type === "resolve-encounter" && body.envelope.command.choice) choicePostResponses.push(response.status());
  });

  await activePage.getByRole("button", { name: "Resolve encounter", exact: true }).click();
  const overlay = activePage.locator("dialog.resolution-stage[open]");
  await overlay.waitFor({ state: "visible" });
  await overlay.getByRole("button", { name: /Reveal encounter/ }).click();
  await activePage.waitForFunction(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    return room.state.pendingDecision?.type === "encounter-choice";
  }, { service: apiUrl, code: roomCode });
  const beforeChoice = await readRoom(activePage, roomCode);
  assert.equal(beforeChoice.body.state.pendingDecision?.source, "zorb-city", "the real engine records the Zorb city reward decision");
  assert.deepEqual(beforeChoice.body.state.pendingDecision?.choices, ["health", "infamy"], "the authoritative reward offers Health or Infamy");
  const revealRemainingRolls = overlay.getByRole("button", { name: "Reveal remaining rolls" });
  if (await revealRemainingRolls.count()) await revealRemainingRolls.click();
  const rewardButton = overlay.getByRole("button", { name: /Take 2 Infamy/ });
  if (await rewardButton.count() !== 1) {
    const diagnostic = await activePage.evaluate(() => ({
      openDialogText: document.querySelector("dialog[open]")?.textContent?.trim(),
      phaseHeading: document.querySelector(".action-card h2")?.textContent?.trim(),
      visibleButtons: [...document.querySelectorAll("dialog[open] button")].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })),
      choiceGroups: [...document.querySelectorAll('[role="group"]')].map((group) => ({ label: group.getAttribute("aria-label"), text: group.textContent?.trim().slice(0, 250) })),
    }));
    throw new Error(`The full-route reward control did not render: ${JSON.stringify(diagnostic)}`);
  }
  await rewardButton.waitFor({ state: "visible" });

  const failedChoiceResponse = activePage.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== "POST" || new URL(response.url()).pathname !== `/rooms/${roomCode}/actions`) return false;
    try {
      const command = request.postDataJSON()?.envelope?.command;
      return command?.type === "resolve-encounter" && command.choice === "infamy";
    } catch { return false; }
  });
  await rewardButton.click();
  const rejected = await failedChoiceResponse;
  assert.equal(rejected.status(), 400, "the actual memory API rejects the first reward POST for its injected stale revision");
  assert.ok(injectedStaleRevision !== null, "the verifier injected the stale revision into exactly one choice POST");
  await activePage.getByRole("alert").filter({ hasText: /Expected revision/ }).first().waitFor({ state: "visible" });
  await activePage.waitForFunction(() => {
    const button = [...document.querySelectorAll("dialog[open] button")].find((candidate) => /Take 2 Infamy/.test(candidate.textContent ?? ""));
    return Boolean(button && !button.disabled && button === document.activeElement);
  });
  const afterFailure = await readRoom(activePage, roomCode);
  assert.equal(afterFailure.body.version, beforeChoice.body.version, "a rejected API command leaves the room revision unchanged");
  assert.equal(afterFailure.body.state.pendingDecision?.type, "encounter-choice", "the same reward decision remains authoritative after rejection");
  assert.equal(afterFailure.body.state.monsters[0].infamy, beforeChoice.body.state.monsters[0].infamy, "the failed reward POST grants no Infamy");
  assert.equal(afterFailure.body.state.eventLog.length, beforeChoice.body.state.eventLog.length, "the failed reward POST appends no game event");

  const retryResponse = activePage.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== "POST" || new URL(response.url()).pathname !== `/rooms/${roomCode}/actions`) return false;
    try {
      const command = request.postDataJSON()?.envelope?.command;
      return command?.type === "resolve-encounter" && command.choice === "infamy";
    } catch { return false; }
  });
  await rewardButton.click();
  const accepted = await retryResponse;
  assert.equal(accepted.status(), 200, "retry reaches and is accepted by the actual memory API");
  await activePage.waitForFunction(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    return room.state.pendingDecision?.type !== "encounter-choice";
  }, { service: apiUrl, code: roomCode });
  const completed = await readRoom(activePage, roomCode);
  assert.equal(completed.body.state.monsters[0].infamy, beforeChoice.body.state.monsters[0].infamy + 3, "the accepted retry applies the selected 2-city-Infamy reward once plus the adjacent Army base's 1 Infamy");
  const choiceResolutionEvents = completed.body.state.eventLog.slice(beforeChoice.body.state.eventLog.length);
  assert.equal(choiceResolutionEvents.length, 1, "the successful retry appends exactly one authoritative resolution event");
  const resolvedEncounter = choiceResolutionEvents[0];
  assert.ok(resolvedEncounter.action === "encounter.resolved" || resolvedEncounter.action === "trophy.choice-required", "the encounter resolves or continues into the separate base-trophy decision");
  const infamyEffects = resolvedEncounter?.detail.effects?.filter((effect) => effect.type === "infamy").map((effect) => effect.amount);
  assert.deepEqual(infamyEffects, [2, 1], "the one successful encounter event records the selected city reward and separate Army-base reward");
  assert.equal(completed.body.version, beforeChoice.body.version + 1, "only the successful retry advances the authoritative revision");
  assert.equal(choicePostResponses.length, 2, "exactly two reward choice POSTs reached the API response path");
  assert.deepEqual(choicePostResponses, [400, 200], "the API rejected the stale first POST and accepted the retry");
  assert.deepEqual(runtimeErrors, [], "the active full-route encounter flow has no browser runtime or console errors");

  const report = {
    ok: true,
    date: new Date().toISOString().slice(0, 10),
    roomCode,
    environment: "full web route + local memory API + audited-board game state",
    scenario: "Zorb at 13,4 moves to adjacent city/base 12,4 with an opponent Army unit; actual Fight resolution precedes the Zorb city reward decision",
    failure: "one choice POST sent to the real memory API with an injected stale expectedRevision; API returned 400 without changing authoritative state",
    focusRecovery: "same Infamy reward button remains enabled and receives focus after the API rejection",
    retry: "same UI reward button submitted through HTTP fallback to the actual memory API; API returned 200",
    authoritativeResult: { phase: completed.body.state.phase, infamyBefore: beforeChoice.body.state.monsters[0].infamy, infamyAfter: completed.body.state.monsters[0].infamy, infamyDelta: 3, selectedCityReward: 2, adjacentArmyBaseReward: 1, eventDelta: 1, revisionDelta: 1 },
    choicePostResponses,
    limits: ["Board/source and rule parity remain separately gated; this verifies only the configured audited-board route behavior.", "Failure injection modifies one browser request's expectedRevision; it does not simulate an unavailable database or arbitrary server crash."],
    runtimeErrors,
  };
  const outputDirectory = join(cwd, "output", "ui-review");
  await mkdir(outputDirectory, { recursive: true });
  const artifactPath = join(outputDirectory, `online-encounter-retry-${report.date}.json`);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, artifact: artifactPath }));
} finally {
  try {
    await browser?.close();
  } finally {
    await Promise.all([stopServer(apiServer), stopServer(webServer)]);
  }
}
