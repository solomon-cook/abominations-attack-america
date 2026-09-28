import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve an online Fight verifier port."));
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
  return { child, ready, output: () => output };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.child.once("exit", resolve)), wait(2000).then(() => server.child.kill("SIGKILL"))]);
};
const stateUrl = (roomCode, token) => `${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(token)}`;
const readBrowserRoom = (page, roomCode) => page.evaluate(async ({ service, code }) => {
  const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
  const response = await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`);
  return { status: response.status, body: await response.json() };
}, { service: apiUrl, code: roomCode });
const inspectReadOnlyFight = async (page, roomCode, monsterName, pendingBattleCount, role, { leaveOpen = false } = {}) => {
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Fight");
  const before = await readBrowserRoom(page, roomCode);
  assert.equal(before.status, 200, `${role} receives the current public Fight projection`);
  assert.equal(before.body.state.phase, "fight", `${role} sees the current Fight phase`);
  assert.equal(before.body.state.pendingBattles.length, pendingBattleCount, `${role} sees both pending battles`);
  const opener = page.getByRole("button", { name: "Watch fight", exact: true });
  await opener.waitFor({ state: "visible" });
  assert.equal(await opener.isEnabled(), true, `${role} can open the read-only Fight view`);
  await opener.click();
  const dialog = page.locator("dialog.resolution-fight[open]");
  await dialog.waitFor({ state: "visible" });
  const chooser = dialog.getByRole("navigation", { name: "Choose battle" });
  await chooser.waitFor({ state: "visible" });
  assert.equal(await chooser.locator("button").count(), pendingBattleCount, `${role} can inspect each queued battle`);
  const selectedBattle = chooser.locator("button").filter({ hasText: monsterName });
  assert.equal(await selectedBattle.count(), 1, `${role} can locate the chosen monster's queued battle`);
  await selectedBattle.click();
  assert.equal((await dialog.locator(".battle-monster h3").textContent())?.trim(), monsterName, `${role} can inspect the selected live battle`);
  const targets = dialog.locator(".battle-target-button");
  assert.ok(await targets.count() > 0, `${role} sees legal battle targets`);
  assert.equal(await targets.evaluateAll((buttons) => buttons.every((button) => button.disabled)), true, `${role} cannot submit a battle target`);
  const commandControls = dialog.locator(".cinema-battle-actions button");
  assert.ok(await commandControls.count() > 0, `${role} sees Fight command controls`);
  assert.equal(await commandControls.evaluateAll((buttons) => buttons.every((button) => button.disabled)), true, `${role} cannot activate Fight command controls`);
  assert.equal(await selectedBattle.getAttribute("aria-pressed"), "true", `${role} can select a battle for local viewing`);
  const after = await readBrowserRoom(page, roomCode);
  assert.equal(after.body.version, before.body.version, `${role} viewing and selecting a battle leaves the room revision unchanged`);
  if (!leaveOpen) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await opener.evaluate((button) => button === document.activeElement), true, `${role} returns focus to the Watch fight opener`);
    const afterClose = await readBrowserRoom(page, roomCode);
    assert.equal(afterClose.body.version, before.body.version, `${role} closing the view leaves the room revision unchanged`);
  }
  return { role, pendingBattleCount, revision: before.body.version, targetsDisabled: true, chooserViewOnly: true, focusReturned: !leaveOpen, dialogLeftOpen: leaveOpen };
};
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
  const first = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const second = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const runtimeErrors = [];
  for (const page of [first, second]) {
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push({ text: message.text(), location: message.location() });
    });
    await page.route((requestUrl) => {
      const request = new URL(requestUrl);
      return request.origin === apiUrl && request.pathname === "/accounts/me";
    }, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  await first.locator("details.home-online > summary").click();
  await first.getByLabel("Display name").fill("Fight player one");
  await first.getByLabel("Room privacy").selectOption("public");
  await first.getByRole("button", { name: "Create", exact: true }).click();
  await first.waitForFunction(() => document.querySelector(".lobby strong")?.textContent?.trim().length > 0);
  const roomCode = await first.locator(".lobby strong").first().textContent().then((text) => text?.trim());
  assert.ok(roomCode, "room creation exposes a room code");

  await second.locator("details.home-online > summary").click();
  await second.getByLabel("Display name").fill("Fight player two");
  await second.getByLabel("Room code").fill(roomCode);
  await second.getByRole("button", { name: "Join", exact: true }).click();
  await second.waitForFunction(() => document.querySelector(".lobby strong")?.textContent?.trim().length > 0);
  await Promise.all([first.locator(".setup-panel").waitFor({ state: "visible" }), second.locator(".setup-panel").waitFor({ state: "visible" })]);

  const submitSetup = async (page, action) => page.evaluate(async ({ apiUrl: service, roomCode: code, action: nextAction }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const roomResponse = await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`);
    const room = await roomResponse.json();
    const response = await fetch(`${service}/rooms/${code}/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
      body: JSON.stringify({ action: nextAction, expectedRevision: room.version }),
    });
    const result = await response.json();
    return { status: response.status, error: result.error, version: result.version };
  }, { apiUrl, roomCode, action });
  const setupActions = [
    [first, { type: "choose-monster", monsterId: "monster-1" }],
    [second, { type: "choose-monster", monsterId: "monster-3" }],
    [second, { type: "choose-branch", branch: "Army" }],
    [first, { type: "choose-branch", branch: "Navy" }],
    [first, { type: "choose-lair", lair: "19,2" }],
    [second, { type: "choose-lair", lair: "17,-1" }],
    [first, { type: "choose-starting-choice", startingChoice: { kind: "deploy", placements: [{ unitId: "1-1", destination: "19,1" }, { unitId: "1-0", destination: "22,-7" }] } }],
    [second, { type: "choose-starting-choice", startingChoice: { kind: "deploy", placements: [{ unitId: "0-0", destination: "16,0" }, { unitId: "0-1", destination: "20,-6" }] } }],
  ];
  for (const [page, action] of setupActions) {
    const response = await submitSetup(page, action);
    assert.equal(response.status, 200, `valid deterministic setup action ${action.type} is accepted: ${JSON.stringify(response)}`);
  }
  await Promise.all([first.locator(".setup-panel").waitFor({ state: "detached" }), second.locator(".setup-panel").waitFor({ state: "detached" })]);
  for (const page of [first, second]) {
    const clicked = await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Ready" && !candidate.disabled); button?.click(); return Boolean(button); });
    assert.ok(clicked, "each seated player exposes the Ready action after setup");
  }
  await Promise.all([first.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Move"), second.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Move")]);

  const roomAfterReady = await first.evaluate(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
  }, { service: apiUrl, code: roomCode });
  const activePlayerIndex = roomAfterReady.state.currentPlayer;
  assert.ok(activePlayerIndex === 0 || activePlayerIndex === 1, "server identifies the active monster player");
  assert.equal(activePlayerIndex, 0, "completed deterministic setup begins with Player 1's turn");
  const activePage = activePlayerIndex === 0 ? first : second;
  const combatDestination = activePlayerIndex === 0 ? "19,1" : "16,0";
  const assignedMonsterId = activePlayerIndex === 0 ? "monster-1" : "monster-3";
  assert.equal(roomAfterReady.state.setupApplied, true, "the server applied all deterministic setup choices before Move");
  await Promise.all([first.reload(), second.reload()]);
  await Promise.all([first, second].map((page) => page.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online" && document.querySelector(".action-card h2")?.textContent?.trim() === "Move")));
  await Promise.all([first, second].map((page) => page.locator(".setup-summary").waitFor({ state: "detached" })));
  if (await activePage.locator(".onboarding").isVisible()) await activePage.getByRole("button", { name: /Got it.*hide guide/ }).click();
  const occupiedUnit = roomAfterReady.state.units.find((unit) => unit.ownerPlayer === activePlayerIndex && unit.location === combatDestination);
  assert.ok(occupiedUnit, `the active player's ${combatDestination} troop was deployed during setup`);
  assert.equal(roomAfterReady.state.monsters[activePlayerIndex]?.id, assignedMonsterId, "the active player's selected monster has the expected lair route");
  const readDeploymentTray = async () => {
    const label = await activePage.locator(".deployment-tray-shortcut").getAttribute("aria-label");
    const counts = label?.match(/(\d+) deployed, (\d+) in reserve/);
    assert.ok(counts, `the active branch tray exposes deployed and reserve counts: ${label}`);
    return { label, deployed: Number(counts[1]), reserve: Number(counts[2]) };
  };
  const deploymentTrayBeforeFight = await readDeploymentTray();

  // Exercise a second, separately queued battle in the same Move step. Let the
  // rendered legal destinations come from the pinned board graph, then submit
  // the ordinary browser movement confirmation for the spare Navy Fighter.
  const fighterOrder = activePage.locator(".movement-piece").filter({ hasText: /Navy fighter/i });
  await fighterOrder.waitFor({ state: "visible" });
  assert.equal(await fighterOrder.isEnabled(), true, "the spare Navy Fighter remains available to move this turn");
  await fighterOrder.click();
  const opponentLairTile = activePage.locator('.hex-tile.legal:not(:disabled)[data-hex-key="17,-1"]');
  await opponentLairTile.waitFor({ state: "visible" });
  const legalFighterDestinations = await activePage.locator(".hex-tile.legal:not(:disabled)").evaluateAll((tiles) => tiles.map((tile) => tile.dataset.hexKey));
  assert.ok(legalFighterDestinations.includes("17,-1"), `the board graph exposes the opponent lair as a legal flying-unit destination: ${JSON.stringify(legalFighterDestinations)}`);
  await opponentLairTile.click();
  await activePage.getByRole("button", { name: "Confirm move", exact: true }).click();
  const firstPendingBattle = await activePage.evaluate(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
  }, { service: apiUrl, code: roomCode });
  assert.equal(firstPendingBattle.state.phase, "move", "moving the spare Navy Fighter creates a battle without ending Move");
  assert.equal(firstPendingBattle.state.pendingBattles.length, 1, "the Navy Fighter move queues its own battle before the monster moves");
  const fighterBattleId = firstPendingBattle.state.pendingBattles[0]?.id;
  assert.ok(firstPendingBattle.state.pendingBattles[0]?.militaryUnitIds.includes("1-0"), "the first queued battle contains the moved spare Navy unit");

  const combatTile = activePage.locator(`.hex-tile.legal:not(:disabled)[data-hex-key="${combatDestination}"]`);
  const renderedMovement = await activePage.evaluate((destination) => ({
    heading: document.querySelector(".action-card h2")?.textContent?.trim(),
    tiles: [...document.querySelectorAll(".hex-tile")].filter((tile) => tile.dataset.hexKey === destination || tile.classList.contains("legal")).map((tile) => ({ key: tile.dataset.hexKey, className: tile.className, disabled: tile.disabled, rect: (() => { const rect = tile.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(), label: tile.getAttribute("aria-label") })),
  }), combatDestination);
  if (!await combatTile.count()) throw new Error(`The deterministic combat destination is not a rendered legal monster move: ${JSON.stringify({ combatDestination, currentPlayer: roomAfterReady.state.currentPlayer, monster: roomAfterReady.state.monsters[activePlayerIndex], troop: occupiedUnit, renderedMovement })}`);
  await combatTile.waitFor({ state: "visible" });
  await combatTile.click();
  const moveControls = await activePage.locator(".action-dock button, .action-card button").evaluateAll((buttons) => buttons.map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })));
  const confirmMove = activePage.getByRole("button", { name: "Confirm move", exact: true });
  if (!await confirmMove.count()) {
    throw new Error(`Selected occupied hex ${combatDestination} did not produce the normal movement confirmation control: ${JSON.stringify(moveControls)}`);
  }
  await confirmMove.click();
  const endAllMovement = activePage.getByRole("button", { name: "End all movement →", exact: true });
  if (!await endAllMovement.isVisible()) await activePage.locator("details.piece-context-tab > summary").click();
  await endAllMovement.waitFor({ state: "visible" });
  await endAllMovement.click();
  await activePage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Fight");
  await (activePlayerIndex === 0 ? second : first).waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Fight");

  const queuedFights = await activePage.evaluate(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
  }, { service: apiUrl, code: roomCode });
  assert.equal(queuedFights.state.pendingBattles.length, 2, "the monster move adds a second battle to the Fight queue");
  assert.ok(queuedFights.state.pendingBattles.some((battle) => battle.id === fighterBattleId), "the earlier Navy Fighter battle remains queued");
  const ownMonsterName = queuedFights.state.monsters[activePlayerIndex]?.name;
  const ownMonsterBattle = queuedFights.state.pendingBattles.find((battle) => battle.monsterId === queuedFights.state.monsters[activePlayerIndex]?.id);
  assert.ok(ownMonsterBattle?.militaryUnitIds.includes("1-1"), "the monster's attack queues the other battle against the deployed Navy Submarine");

  const observer = activePlayerIndex === 0 ? second : first;
  const waitingPlayerView = await inspectReadOnlyFight(observer, roomCode, ownMonsterName, 2, "waiting player");
  const spectator = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  spectator.setDefaultTimeout(8000);
  spectator.on("pageerror", (error) => runtimeErrors.push(error.message));
  spectator.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push({ text: message.text(), location: message.location() });
  });
  await spectator.route((requestUrl) => {
    const request = new URL(requestUrl);
    return request.origin === apiUrl && request.pathname === "/accounts/me";
  }, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
  await spectator.goto(url, { waitUntil: "domcontentloaded" });
  await spectator.locator("details.home-online > summary").click();
  await spectator.getByLabel("Display name").fill("Fight spectator");
  await spectator.getByLabel("Room code").fill(roomCode);
  await spectator.getByRole("button", { name: "Spectate", exact: true }).click();
  await spectator.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online"
    && document.querySelector(".lobby")?.textContent?.includes("spectating")
    && document.querySelector(".action-card h2")?.textContent?.trim() === "Fight");
  const spectatorProjection = await readBrowserRoom(spectator, roomCode);
  assert.equal(spectatorProjection.status, 200, "spectator receives a projection of the active Fight");
  assert.equal(spectatorProjection.body.state.pendingBattles.length, 2, "spectator receives both live pending battles");
  assert.equal(spectatorProjection.body.participants.find((participant) => participant.displayName === "Fight spectator")?.role, "spectator", "room marks the new viewer as a spectator");
  assert.equal(spectatorProjection.body.state.players.every((player) => player.mutationCardIds.length === 0 && player.researchCardIds.length === 0), true, "spectator projection hides every private player hand");
  assert.equal(spectatorProjection.body.state.decks.mutation.order.length + spectatorProjection.body.state.decks.mutation.discard.length, 0, "spectator projection hides mutation deck order and discard");
  assert.equal(spectatorProjection.body.state.decks.research.order.length + spectatorProjection.body.state.decks.research.discard.length, 0, "spectator projection hides research deck order and discard");
  const spectatorFightView = await inspectReadOnlyFight(spectator, roomCode, ownMonsterName, 2, "spectator", { leaveOpen: true });
  const spectatorSession = await spectator.evaluate(() => JSON.parse(localStorage.getItem("abominations-session") ?? "{}"));
  const spectatorCommandResponse = await fetch(`${apiUrl}/rooms/${roomCode}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": spectatorSession.token ?? "" },
    body: JSON.stringify({ envelope: {
      actionId: randomUUID(),
      actorId: spectatorSession.participantId,
      expectedRevision: spectatorProjection.body.version,
      protocolVersion: 1,
      command: { type: "resolve-fight", battleId: ownMonsterBattle.id },
    } }),
  });
  const spectatorCommandResult = { status: spectatorCommandResponse.status, body: await spectatorCommandResponse.json() };
  assert.equal(spectatorCommandResult.status, 400, "API rejects an attempted Fight command from the spectator token");
  assert.match(spectatorCommandResult.body.error, /Spectators cannot submit game actions/);
  const spectatorAfterRejectedCommand = await readBrowserRoom(spectator, roomCode);
  assert.equal(spectatorAfterRejectedCommand.body.version, spectatorProjection.body.version, "rejected spectator action leaves the room revision unchanged");
  assert.equal(spectatorAfterRejectedCommand.body.state.eventLog.length, spectatorProjection.body.state.eventLog.length, "rejected spectator action leaves the event history unchanged");

  const fightControls = [];
  let fightDialogKeyboardChecked = false;
  let submarineLaunchVerified = false;
  let multiBattleChooserVerified = false;
  let firstQueuedBattleResolved = false;
  let continueToSecondBattleVerified = false;
  for (let step = 0; step < 24; step += 1) {
    const authoritative = await activePage.evaluate(async ({ service, code }) => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    }, { service: apiUrl, code: roomCode });
    if (authoritative.state.phase !== "fight") break;
    const fightDialog = activePage.locator("dialog.resolution-fight[open]");
    if (!await fightDialog.count()) {
      if (!fightDialogKeyboardChecked) await activePage.setViewportSize({ width: 390, height: 844 });
      const openFight = activePage.getByRole("button", { name: /^(Resolve fight|Continue to Fight)$/ });
      assert.ok(await openFight.count(), "the active player can open the Fight resolution dialog");
      await openFight.waitFor({ state: "visible" });
      await openFight.focus();
      await openFight.click();
      await fightDialog.waitFor({ state: "visible" });
      if (!fightDialogKeyboardChecked) {
        assert.equal(await fightDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "opening Fight moves keyboard focus into the modal");
        const bounds = await fightDialog.evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
        });
        assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1,
          `the Fight dialog remains within a 390x844 viewport: ${JSON.stringify(bounds)}`);
        await activePage.keyboard.press("Escape");
        await fightDialog.waitFor({ state: "detached" });
        const openerFocused = await openFight.evaluate((button) => button === document.activeElement);
        if (!openerFocused) {
          const focusState = await activePage.evaluate(() => ({
            active: document.activeElement instanceof HTMLElement ? { tag: document.activeElement.tagName, className: document.activeElement.className, label: document.activeElement.getAttribute("aria-label"), text: document.activeElement.textContent?.trim().slice(0, 80), html: document.activeElement.outerHTML.slice(0, 300) } : null,
            resolveButtons: [...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Resolve fight").map((button) => ({ active: button === document.activeElement, connected: button.isConnected, disabled: button.disabled, html: button.outerHTML.slice(0, 300) })),
          }));
          throw new Error(`Fight Escape focus did not return to opener: ${JSON.stringify(focusState)}`);
        }
        await activePage.setViewportSize({ width: 1280, height: 720 });
        const desktopOpener = activePage.getByRole("button", { name: /^(Resolve fight|Continue to Fight)$/ });
        await desktopOpener.waitFor({ state: "visible" });
        await desktopOpener.focus();
        await desktopOpener.click();
        await fightDialog.waitFor({ state: "visible" });
        assert.equal(await fightDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "reopening Fight returns focus to the modal before combat continues");
        fightDialogKeyboardChecked = true;
      }
    }
    await fightDialog.waitFor({ state: "visible" });
    if (!multiBattleChooserVerified) {
      const chooser = fightDialog.getByRole("navigation", { name: "Choose battle" });
      await chooser.waitFor({ state: "visible" });
      const chooserButtons = chooser.locator("button");
      assert.equal(await chooserButtons.count(), 2, "the Fight dialog offers one chooser button for each pending battle");
      assert.equal(await chooser.locator('button[aria-pressed="true"]').count(), 1, "exactly one pending battle is exposed as selected");
      const submarineBattleChoice = chooser.locator("button").filter({ hasText: ownMonsterName });
      assert.equal(await submarineBattleChoice.count(), 1, `the current monster's submarine battle has one chooser entry (${ownMonsterName})`);
      const roomVersionBeforeSelection = authoritative.version;
      await submarineBattleChoice.click();
      assert.equal(await submarineBattleChoice.getAttribute("aria-pressed"), "true", "selecting a battle updates the chooser's aria-pressed state");
      assert.equal((await fightDialog.locator(".battle-monster h3").textContent())?.trim(), ownMonsterName, "the selected battle's monster is shown in the Fight dialog");
      const roomVersionAfterSelection = await activePage.evaluate(async ({ service, code }) => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
        return room.version;
      }, { service: apiUrl, code: roomCode });
      assert.equal(roomVersionAfterSelection, roomVersionBeforeSelection, "choosing a pending battle changes local selection without submitting a room command");
      multiBattleChooserVerified = true;
    }
    await activePage.waitForFunction(() => {
      const dialog = document.querySelector("dialog.resolution-fight[open]");
      return Boolean(dialog && [...dialog.querySelectorAll(".battle-target-button, .battle-next button")].some((button) => !button.disabled));
    });
    const launchSubmarine = fightDialog.getByRole("button", { name: "Launch Nuclear Submarine as cruise missile", exact: true });
    if (!submarineLaunchVerified && await launchSubmarine.count()) {
      const battle = authoritative.state.pendingBattles.find((candidate) => candidate.militaryUnitIds.includes("1-1"));
      assert.ok(battle, "the deterministic Fight state includes Player 1's Navy Nuclear Submarine");
      const version = authoritative.version;
      await launchSubmarine.first().click();
      await activePage.waitForFunction(async ({ service, code, previousVersion }) => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
        return room.version > previousVersion;
      }, { service: apiUrl, code: roomCode, previousVersion: version });
      const afterLaunch = await activePage.evaluate(async ({ service, code }) => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
      }, { service: apiUrl, code: roomCode });
      const launchedSubmarine = afterLaunch.state.units.find((unit) => unit.id === "1-1");
      const retainedBattle = afterLaunch.state.pendingBattles.find((candidate) => candidate.id === battle.id);
      assert.equal(afterLaunch.state.phase, "fight", "launching the optional submarine does not resolve the Fight");
      assert.equal(launchedSubmarine?.unitTypeId, "navy-nuclear-submarine-missile", "the optional control transforms the authoritative unit into a cruise missile");
      assert.ok(retainedBattle?.militaryUnitIds.includes("1-1"), "the launched unit remains attached to the open battle");
      fightControls.push("Launch Nuclear Submarine as cruise missile");
      submarineLaunchVerified = true;
      continue;
    }
    const continuePlayback = fightDialog.locator('button.battle-target-button:not(:disabled)[aria-label^="Continue attack against "]');
    if (await continuePlayback.count()) {
      await continuePlayback.first().click();
      continue;
    }
    const continueToNextBattle = fightDialog.getByRole("button", { name: /Continue to next battle/ });
    if (await continueToNextBattle.count()) {
      const afterFirstBattle = await activePage.evaluate(async ({ service, code }) => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
      }, { service: apiUrl, code: roomCode });
      assert.equal(firstQueuedBattleResolved, true, "the first resolved battle was recorded before continuing");
      assert.equal(afterFirstBattle.state.phase, "fight", "resolving one battle keeps the room in Fight");
      assert.equal(afterFirstBattle.state.pendingBattles.length, 1, "the other battle remains pending after resolving the first");
      const remainingBattle = afterFirstBattle.state.pendingBattles[0];
      assert.notEqual(remainingBattle.id, ownMonsterBattle.id, "the still-pending battle is the separate Navy Fighter battle");
      const remainingMonsterName = afterFirstBattle.state.monsters.find((monster) => monster.id === remainingBattle.monsterId)?.name;
      await continueToNextBattle.click();
      await activePage.waitForFunction((name) => document.querySelector("dialog.resolution-fight[open] .battle-monster h3")?.textContent?.trim() === name, remainingMonsterName);
      assert.equal(await fightDialog.locator(".battle-selection").count(), 0, "the sole remaining battle becomes the active Fight selection");
      continueToSecondBattleVerified = true;
      continue;
    }
    const enabledButtons = await fightDialog.locator("button:not(:disabled)").evaluateAll((buttons) => buttons.map((button, index) => ({ index, text: button.textContent?.trim() ?? "", ariaLabel: button.getAttribute("aria-label") ?? "" })));
    const selected = enabledButtons.find(({ text, ariaLabel }) => /^(Resolve fight|Resolve without spending Infamy|Spend 1 Infamy|Attack |Roll attack against |Target this .* · roll|Roll battle dice)/.test(ariaLabel || text))
      ?? enabledButtons.find(({ text }) => text === "Confirm retreat");
    if (!selected) throw new Error(`Fight has no enabled legal decision control: ${JSON.stringify({ decision: authoritative.state.pendingDecision, enabledButtons })}`);
    fightControls.push(selected.text || selected.ariaLabel);
    const version = authoritative.version;
    await fightDialog.locator("button:not(:disabled)").nth(selected.index).click();
    await activePage.waitForFunction(async ({ service, code, previousVersion }) => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
      return room.version > previousVersion;
    }, { service: apiUrl, code: roomCode, previousVersion: version });
    if (!firstQueuedBattleResolved) {
      const afterDecision = await activePage.evaluate(async ({ service, code }) => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        return await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
      }, { service: apiUrl, code: roomCode });
      const firstBattleEvent = [...afterDecision.state.eventLog].reverse().find((event) => event.action === "fight.resolved" && event.detail.battleId === ownMonsterBattle.id);
      if (firstBattleEvent) {
        assert.equal(afterDecision.state.phase, "fight", "finishing the selected first battle leaves the other battle in Fight");
        assert.equal(afterDecision.state.pendingBattles.length, 1, "only the other queued battle remains after the selected battle resolves");
        assert.equal(afterDecision.state.pendingBattles[0]?.id, fighterBattleId, "the original Navy Fighter battle remains for playback after the submarine battle");
        firstQueuedBattleResolved = true;
      }
    }
  }
  const completed = await activePage.evaluate(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    return {
      version: room.version,
      phase: room.state.phase,
      pendingBattles: room.state.pendingBattles.length,
      fightBattleIds: room.state.eventLog.filter((event) => event.action === "fight.resolved").map((event) => event.detail.battleId),
      fightEvents: room.state.eventLog.filter((event) => event.action === "fight.resolved").length,
      destination: room.state.monsters[room.state.currentPlayer]?.location,
      navySubmarine: (() => {
        const submarine = room.state.units.find((unit) => unit.id === "1-1");
        return submarine ? { unitTypeId: submarine.unitTypeId, location: submarine.location, removed: room.state.removedUnitIds.includes(submarine.id) } : null;
      })(),
      navyFighter: (() => {
        const fighter = room.state.units.find((unit) => unit.id === "1-0");
        return fighter ? { unitTypeId: fighter.unitTypeId, location: fighter.location, removed: room.state.removedUnitIds.includes(fighter.id) } : null;
      })(),
    };
  }, { service: apiUrl, code: roomCode });
  assert.ok(fightControls.length > 0, "Fight required a visible legal UI decision");
  assert.equal(submarineLaunchVerified, true, "the browser flow exercised the optional Navy submarine choice");
  assert.equal(multiBattleChooserVerified, true, "the Fight UI exposed both pending battles and updated selection semantics");
  assert.equal(firstQueuedBattleResolved, true, "the selected submarine battle resolved while the second battle remained pending");
  assert.equal(continueToSecondBattleVerified, true, "the Fight UI continued to the remaining battle before resolving it");
  assert.equal(completed.fightEvents, 2, "server recorded one fight.resolved event for each of the two queued battles");
  assert.deepEqual(new Set(completed.fightBattleIds), new Set([fighterBattleId, ownMonsterBattle.id]), "the event log records resolution for both distinct queued battle ids");
  assert.equal(completed.pendingBattles, 0, "the online Fight queue is resolved");
  assert.equal(completed.phase, "encounter", "online match progressed from Fight to Encounter");
  await observer.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter");
  await spectator.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter");
  await activePage.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter");
  const spectatorFightDialog = spectator.locator("dialog.resolution-fight[open]");
  await spectatorFightDialog.waitFor({ state: "visible" });
  await spectator.keyboard.press("Escape");
  await spectatorFightDialog.waitFor({ state: "detached" });
  const spectatorActionHeading = spectator.locator(".turn-hud-heading h2");
  assert.equal((await spectatorActionHeading.textContent())?.trim(), "Encounter", "spectator's current phase heading updates behind live Fight playback");
  await spectator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusAfterPhaseChange = await spectator.evaluate(() => ({
    heading: document.querySelector(".turn-hud-heading h2")?.outerHTML,
    active: document.activeElement instanceof HTMLElement ? { tag: document.activeElement.tagName, className: document.activeElement.className, text: document.activeElement.textContent?.trim(), html: document.activeElement.outerHTML.slice(0, 360) } : null,
    headingIsActive: document.querySelector(".turn-hud-heading h2") === document.activeElement,
  }));
  assert.equal(focusAfterPhaseChange.headingIsActive, true, `closing playback after Fight disappears restores focus to the current phase heading: ${JSON.stringify(focusAfterPhaseChange)}`);
  assert.equal(fightDialogKeyboardChecked, true, "the browser flow exercised keyboard and compact-viewport dialog behavior");
  await activePage.waitForFunction(() => /\d+ deployed, \d+ in reserve/.test(document.querySelector(".deployment-tray-shortcut")?.getAttribute("aria-label") ?? ""));
  const deploymentTrayAfterFight = await readDeploymentTray();
  assert.equal(completed.navySubmarine?.unitTypeId, "navy-nuclear-submarine", "the returned cruise missile is restored to its reusable submarine type");
  assert.equal(completed.navySubmarine?.location, "record-tile", "the cruise missile returns to the military record after combat");
  assert.equal(completed.navySubmarine?.removed, false, "returning from combat does not permanently remove the Navy piece");
  const returnedBattlePieces = [completed.navySubmarine, completed.navyFighter].filter((unit) => unit?.location === "record-tile" && !unit.removed).length;
  assert.ok(returnedBattlePieces >= 1, "at least one reusable Navy piece returns to its military record after combat");
  assert.equal(deploymentTrayAfterFight.deployed, deploymentTrayBeforeFight.deployed - returnedBattlePieces, "the visible branch tray removes all returned battle pieces from its deployed count");
  assert.equal(deploymentTrayAfterFight.reserve, deploymentTrayBeforeFight.reserve + returnedBattlePieces, "the visible branch tray adds all returned battle pieces to its reserve count");
  const attackHistory = activePage.locator("dialog.resolution-fight[open] details.battle-history");
  await attackHistory.waitFor({ state: "visible" });
  const historySummary = attackHistory.locator("summary");
  await historySummary.click();
  const historyRows = attackHistory.locator("button");
  assert.ok(await historyRows.count() > 0, "Fight playback exposes recorded attack history");
  const versionBeforePlayback = completed.version;
  const firstRecordedAttack = attackHistory.locator("button").first();
  const selectedHistoryText = await firstRecordedAttack.textContent();
  const selectedRoll = selectedHistoryText?.match(/⚄\s*(\d)/)?.[1];
  assert.ok(selectedRoll, `selected history row includes its recorded die face: ${selectedHistoryText}`);
  await firstRecordedAttack.click();
  await activePage.waitForFunction((roll) => document.querySelector("dialog.resolution-fight[open] .battle-roll .combat-die")?.getAttribute("aria-label")?.endsWith(`rolls ${roll}`), selectedRoll);
  const selectedHistoryState = await firstRecordedAttack.getAttribute("aria-current");
  assert.equal(selectedHistoryState, "step", "selected attack history row is exposed as the current playback step");
  const versionAfterPlayback = await activePage.evaluate(async ({ service, code }) => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(`${service}/rooms/${code}/state?token=${encodeURIComponent(session.token ?? "")}`)).json();
    return room.version;
  }, { service: apiUrl, code: roomCode });
  assert.equal(versionAfterPlayback, versionBeforePlayback, "browsing recorded combat playback does not submit a game command or change the room revision");

  const fixtureUrl = new URL("fight-resolution-harness.html", url).toString();
  const infamyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  infamyPage.setDefaultTimeout(8000);
  infamyPage.on("pageerror", (error) => runtimeErrors.push(`Infamy fixture: ${error.message}`));
  await infamyPage.goto(`${fixtureUrl}?infamy=1`, { waitUntil: "domcontentloaded" });
  const infamyDialog = infamyPage.locator("dialog.resolution-fight[open]");
  await infamyDialog.waitFor({ state: "visible" });
  const readFightFixture = () => infamyPage.locator("#fight-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
  const infamyBefore = await readFightFixture();
  assert.equal(infamyBefore.monsterInfamy, 1, "the controlled Fight UI fixture starts with one Infamy");
  const spendInfamy = infamyDialog.getByRole("button", { name: "✦ 1 Infamy · target + extra attack", exact: true });
  assert.equal(await spendInfamy.count(), 2, "the Fight panel offers one visible Infamy target control per legal military unit");
  assert.equal(await spendInfamy.first().isEnabled(), true, "the decision-maker can spend Infamy on the first target");
  await spendInfamy.first().click();
  await infamyPage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#fight-state")?.textContent ?? "{}");
    return state.monsterInfamy === 0 && state.pendingCombat?.spendInfamy === 1 && state.pendingCombat?.attacks?.length > 0;
  });
  let infamyState = await readFightFixture();
  for (let step = 0; step < 6 && infamyState.pendingDecision?.type === "attack-target" && infamyState.pendingDecision.round === 1; step += 1) {
    const previousAttackCount = infamyState.pendingCombat?.attacks?.length ?? 0;
    const nextTarget = infamyDialog.locator('button.battle-target-button[aria-label^="Roll attack against "]:not(:disabled)').first();
    await nextTarget.waitFor({ state: "visible" });
    await nextTarget.click();
    await infamyPage.waitForFunction((count) => {
      const state = JSON.parse(document.querySelector("#fight-state")?.textContent ?? "{}");
      return state.pendingCombat?.attacks?.length > count || state.pendingDecision?.round === 2 || state.phase !== "fight";
    }, previousAttackCount);
    infamyState = await readFightFixture();
  }
  assert.equal(infamyState.pendingDecision?.type, "attack-target", "the fixture remains interactive at the second combat round");
  assert.equal(infamyState.pendingDecision?.round, 2, "the first round completed after the additional Infamy attack");
  assert.equal(infamyState.pendingCombat?.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length, 4, "one Infamy adds one monster attack to Zorb's three first-round attacks");
  assert.equal(infamyState.pendingCombat?.spendInfamy, 1, "the serialized pending combat retains the paid Infamy amount");
  assert.equal(infamyState.monsterInfamy, 0, "the authoritative game-engine state spends exactly one Infamy");

  const zeroInfamyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  zeroInfamyPage.setDefaultTimeout(8000);
  zeroInfamyPage.on("pageerror", (error) => runtimeErrors.push(`Zero-Infamy fixture: ${error.message}`));
  await zeroInfamyPage.goto(`${fixtureUrl}?infamy=0`, { waitUntil: "domcontentloaded" });
  const zeroInfamyDialog = zeroInfamyPage.locator("dialog.resolution-fight[open]");
  await zeroInfamyDialog.waitFor({ state: "visible" });
  assert.equal(await zeroInfamyDialog.locator(".battle-infamy-target").count(), 0, "the Infamy targeting control is absent when the monster has no Infamy");
  const readZeroInfamyState = () => zeroInfamyPage.locator("#fight-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
  let zeroInfamyState = await readZeroInfamyState();
  const ordinaryTarget = zeroInfamyDialog.locator('button.battle-target-button[aria-label^="Roll attack against "]:not(:disabled)').first();
  await ordinaryTarget.click();
  await zeroInfamyPage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#fight-state")?.textContent ?? "{}");
    return state.pendingCombat?.attacks?.length > 0;
  });
  zeroInfamyState = await readZeroInfamyState();
  for (let step = 0; step < 6 && zeroInfamyState.pendingDecision?.type === "attack-target" && zeroInfamyState.pendingDecision.round === 1; step += 1) {
    const previousAttackCount = zeroInfamyState.pendingCombat?.attacks?.length ?? 0;
    const nextTarget = zeroInfamyDialog.locator('button.battle-target-button[aria-label^="Roll attack against "]:not(:disabled)').first();
    await nextTarget.waitFor({ state: "visible" });
    await nextTarget.click();
    await zeroInfamyPage.waitForFunction((count) => {
      const state = JSON.parse(document.querySelector("#fight-state")?.textContent ?? "{}");
      return state.pendingCombat?.attacks?.length > count || state.pendingDecision?.round === 2 || state.phase !== "fight";
    }, previousAttackCount);
    zeroInfamyState = await readZeroInfamyState();
  }
  assert.equal(zeroInfamyState.pendingDecision?.round, 2, "zero-Infamy control battle reaches the second round");
  assert.equal(zeroInfamyState.pendingCombat?.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length, 3, "Zorb makes three first-round attacks with no Infamy");
  assert.equal(infamyState.pendingCombat.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length
    - zeroInfamyState.pendingCombat.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length, 1,
  "spending one Infamy adds exactly one first-round monster attack over the control fixture");
  const spectatorInfamyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  spectatorInfamyPage.setDefaultTimeout(8000);
  spectatorInfamyPage.on("pageerror", (error) => runtimeErrors.push(`Read-only Infamy fixture: ${error.message}`));
  await spectatorInfamyPage.goto(`${fixtureUrl}?infamy=1&role=spectator`, { waitUntil: "domcontentloaded" });
  const spectatorInfamyControls = spectatorInfamyPage.locator("dialog.resolution-fight[open] .battle-infamy-target");
  assert.equal(await spectatorInfamyControls.count(), 2, "read-only Infamy fixture keeps the option visible for explanation");
  assert.equal(await spectatorInfamyControls.evaluateAll((buttons) => buttons.every((button) => button.disabled)), true, "read-only Infamy fixture cannot spend a token");

  assert.deepEqual(runtimeErrors, [], "online Fight browser pages should not report browser console or runtime errors");
  const report = { ok: true, date: new Date().toISOString().slice(0, 10), roomCode, setupActions: setupActions.length, activePlayerIndex, selectedMonster: assignedMonsterId, targetHex: combatDestination, setupDeployedUnit: occupiedUnit.id, onlineFight: "entered-and-resolved", multiplePendingBattles: "chooser-selected-one-remaining-continue-resolve", optionalChoice: "navy-submarine-launched-and-persisted", readOnlyFightViews: [waitingPlayerView, spectatorFightView], spectatorProjection: "current-battles-visible-private-hands-and-decks-redacted-rejected-command-no-revision-change", spectatorRemotePhaseFocus: "encounter-heading-focus-fallback", infamy: { scenario: "component-fixture-with-applyCommand", availableControl: true, zeroTokenControlHidden: true, readOnlyControlDisabled: true, spent: 1, remaining: infamyState.monsterInfamy, firstRoundMonsterAttacks: infamyState.pendingCombat.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length, zeroInfamyFirstRoundAttacks: zeroInfamyState.pendingCombat.attacks.filter((attack) => attack.attackerId === "monster-1" && attack.combatRound === 1).length }, deploymentTrayBeforeFight, returnedSubmarine: completed.navySubmarine, returnedFighter: completed.navyFighter, deploymentTrayAfterFight, fightPlayback: "recorded-history-selection-without-room-mutation", fightDialogKeyboard: "focus-entry-escape-focus-return", fightDialogViewport: "390x844-bounded", fightControls, fightEvents: completed.fightEvents, pendingBattles: completed.pendingBattles, resultingPhase: completed.phase, runtimeErrors };
  const outputDirectory = join(cwd, "output", "ui-review");
  await mkdir(outputDirectory, { recursive: true });
  const artifactPath = join(outputDirectory, `online-fight-${report.date}.json`);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, artifact: artifactPath }));
} finally {
  try {
    await browser?.close();
  } finally {
    await Promise.all([stopServer(apiServer), stopServer(webServer)]);
  }
}
