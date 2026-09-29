import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import { COMMAND_PROTOCOL_VERSION, boardForState, legalMonsterPaths, type GameCommand, type GameState } from "@abominations/game-engine";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { chromePath } = require("./chrome-path.mjs") as { chromePath: string };
const cwd = process.cwd();
const artifacts = resolve(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const wait = (milliseconds: number) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const reservePort = () => new Promise<number>((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a held-card verifier port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const webUrl = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

type Session = { room: { code: string }; participantId: string; token: string };
type RoomView = { code: string; status: string; version: number; state: GameState; participants: Array<{ id: string; role: string; playerIndex?: number }> };
const report: Record<string, unknown> = {
  started: new Date().toISOString(),
  scope: "Production main.tsx game route backed by the local MemoryRoomStore. A genuine Mutation card is acquired through the public room API, normal two-seat setup, a legal Gargantis move to a Mutation site on the pinned development-board candidate, and authoritative Encounter resolution. Browser inspection makes no gameplay command or physical-edition rule claim.",
  runtimeErrors: [],
};

const startServer = ({ command, args, serverCwd, env, label }: { command: string; args: string[]; serverCwd: string; env: NodeJS.ProcessEnv; label: string }) => {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return {
    child,
    output: () => output,
    async ready(check: () => Promise<boolean>) {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
        try { if (await check()) return; } catch { /* wait for local service startup */ }
        await wait(100);
      }
      throw new Error(`${label} did not become ready.\n${output}`);
    },
  };
};
const stopServer = async (server: ReturnType<typeof startServer> | undefined) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => server.child.once("exit", () => resolveExit())),
    wait(2000).then(() => { server.child.kill("SIGKILL"); }),
  ]);
};
const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status}): ${body.error ?? JSON.stringify(body)}`);
  return body;
};
const post = <T,>(path: string, value: unknown, token?: string) => requestJson<T>(path, {
  method: "POST",
  body: JSON.stringify(value),
  ...(token ? { headers: { "x-room-token": token } } : {}),
});
const readRoom = (code: string, token: string) => requestJson<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}`);
const submitSetup = (code: string, player: Session, action: unknown, expectedRevision: number) =>
  post<RoomView>(`/rooms/${code}/setup`, { expectedRevision, action }, player.token);
const submitCommand = (code: string, room: RoomView, player: Session, command: GameCommand) => post<RoomView>(`/rooms/${code}/actions`, {
  envelope: {
    actionId: randomUUID(), actorId: player.participantId, expectedRevision: room.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION, command,
  },
}, player.token);

let webServer: ReturnType<typeof startServer> | undefined;
let apiServer: ReturnType<typeof startServer> | undefined;
let browser: import("playwright").Browser | undefined;
let context: import("playwright").BrowserContext | undefined;
try {
  await mkdir(artifacts, { recursive: true });
  webServer = startServer({
    command: process.execPath, args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    serverCwd: join(cwd, "apps/web"), env: { ...process.env, VITE_API_URL: apiUrl }, label: "Vite",
  });
  await webServer.ready(async () => (await fetch(webUrl)).ok);
  apiServer = startServer({
    command: process.execPath, args: ["--import", "tsx/esm", "src/server.ts"],
    serverCwd: join(cwd, "apps/api"), env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(webUrl).origin }, label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);

  const first = await post<Session>("/rooms", { maxPlayers: 2, displayName: "Monster sheet player one", privacy: "public" });
  const code = first.room.code;
  const second = await post<Session>(`/rooms/${code}/join`, { displayName: "Monster sheet player two" });
  const players = [first, second];
  let room = await readRoom(code, first.token);
  const setup = room.state.setupState;
  assert.ok(setup, "the public production room exposes its normal setup state");
  // A new two-seat game begins at seat 0 after setup is completed, regardless
  // of the pre-setup seed-derived cursor exposed in the room creation response.
  const activeSeat = 0;
  const gargantisId = "monster-6";
  const otherMonsterId = "monster-1";
  assert.ok(setup.definition.monsterIds.includes(gargantisId) && setup.definition.monsterIds.includes(otherMonsterId), "the room's production setup catalogue offers Gargantis and Zorb");
  const mutationSite = "4,4";
  const gargantisLair = setup.definition.lairsByMonster[gargantisId]!.find((lair) => lair === "3,5") ?? setup.definition.lairsByMonster[gargantisId]![0]!;
  const otherLair = setup.definition.lairsByMonster[otherMonsterId]!.find((lair) => lair !== gargantisLair)!;
  assert.ok(otherLair, "the other seat receives a different legal configured lair");
  const monsterBySeat = activeSeat === 0 ? [gargantisId, otherMonsterId] : [otherMonsterId, gargantisId];
  const lairBySeat = monsterBySeat.map((monsterId) => monsterId === gargantisId ? gargantisLair : otherLair);
  const setupSteps: Array<[number, unknown]> = [
    [0, { type: "choose-monster", monsterId: monsterBySeat[0] }],
    [1, { type: "choose-monster", monsterId: monsterBySeat[1] }],
    [1, { type: "choose-branch", branch: "Army" }],
    [0, { type: "choose-branch", branch: "Navy" }],
    [0, { type: "choose-lair", lair: lairBySeat[0] }],
    [1, { type: "choose-lair", lair: lairBySeat[1] }],
    [0, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [1, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ];
  for (const [playerIndex, action] of setupSteps) room = await submitSetup(code, players[playerIndex]!, action, room.version);
  for (const player of players) await post<RoomView>(`/rooms/${code}/ready`, { ready: true }, player.token);
  room = await readRoom(code, first.token);
  assert.equal(room.status, "active", "both ordinary Ready actions activate the configured match");
  assert.equal(room.state.setupApplied, true);
  assert.equal(room.state.currentPlayer, activeSeat, "the seat selected for Gargantis remains the active turn after ordinary setup");
  const gargantis = room.state.monsters[activeSeat]!;
  assert.equal(gargantis.name, "Gargantis");
  const board = boardForState(room.state);
  assert.ok(board.hexes[mutationSite]?.features.some((feature) => feature.kind === "mutation-site"), "the destination is a Mutation-site feature on the room's pinned development-board candidate");
  const paths = legalMonsterPaths(room.state, gargantis.id).filter((path) => path.at(-1) === mutationSite);
  assert.ok(paths.length > 0, `Gargantis has a legal path from ${gargantis.location} to Mutation site ${mutationSite}`);
  const path = paths.sort((left, right) => left.length - right.length)[0]!;
  const beforeMove = room;
  room = await submitCommand(code, room, players[activeSeat]!, { type: "move", path });
  assert.equal(room.version, beforeMove.version + 1, "the accepted legal move advances the authoritative revision once");
  assert.equal(room.state.phase, "encounter", "the legal Mutation-site move enters normal Encounter resolution");
  assert.equal(room.state.monsters[activeSeat]?.location, mutationSite);
  const moveEvent = room.state.eventLog.at(-1)!;
  assert.equal(moveEvent.action, "monster.moved");
  const beforeEncounter = room;
  room = await submitCommand(code, room, players[activeSeat]!, { type: "resolve-encounter" });
  assert.equal(room.version, beforeEncounter.version + 1, "accepted Encounter resolution advances the authoritative revision once");
  assert.equal(room.state.phase, "deploy", "the resolved Mutation encounter returns to the ordinary Deploy phase");
  const encounter = room.state.eventLog.at(-1)!;
  assert.equal(encounter.action, "encounter.resolved", "the authoritative history records normal Encounter resolution");
  const siteId = board.hexes[mutationSite]!.features.find((feature) => feature.kind === "mutation-site")!.siteId;
  const mutationDraw = (encounter.detail.mutationDraws as Array<{ siteId: string; cardDrawn: boolean; effectStatus: string }>).find((draw) => draw.siteId === siteId);
  assert.ok(mutationDraw?.cardDrawn, "the authoritative Mutation-site history confirms that an actual card was drawn");
  const heldCards = [...room.state.players[activeSeat]!.mutationCardIds];
  assert.equal(heldCards.length, 1, "the owner projection exposes the single genuinely acquired Mutation card");
  const cardId = heldCards[0]!;
  assert.equal(encounter.detail.playerIndex, activeSeat);
  const acquired = {
    roomCode: code, boardId: room.state.boardId, currentRevision: room.version, activeSeat,
    monster: gargantis.name, lair: gargantisLair, movePath: path, mutationSite,
    acceptedMove: { revision: beforeMove.version + 1, eventId: moveEvent.id, action: moveEvent.action },
    encounter: { revision: room.version, eventId: encounter.id, action: encounter.action, mutationDraw, heldCardIds: heldCards },
  };

  await mkdir(artifacts, { recursive: true });
  const launchedBrowser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  browser = launchedBrowser;
  const browserContext: import("playwright").BrowserContext = await launchedBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  context = browserContext;
  const page: import("playwright").Page = await browserContext.newPage();
  const commandFrames: string[] = [];
  page.setDefaultTimeout(10000);
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    if (typeof frame.payload === "string" && frame.payload.includes("command.submit")) commandFrames.push(frame.payload);
  }));
  page.on("pageerror", (error) => (report.runtimeErrors as string[]).push(error.message));
  page.on("console", (message) => { if (message.type() === "error") (report.runtimeErrors as string[]).push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route((url) => new URL(url).origin === apiUrl && new URL(url).pathname === "/accounts/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
  await page.addInitScript((value: { session: string }) => {
    localStorage.setItem("abominations-session", value.session);
    localStorage.setItem("abominations-onboarding-seen", "1");
  }, { session: JSON.stringify({ token: players[activeSeat]!.token, participantId: players[activeSeat]!.participantId, accountLinked: false, room: { code } }) });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online"
    && document.querySelector(".top-turn-summary h2")?.textContent?.trim() === "Deploy");
  const roomBeforeInspection = await readRoom(code, players[activeSeat]!.token);
  assert.deepEqual(roomBeforeInspection.state, room.state, "the real browser route opens at the authoritative post-Encounter state");
  const toggle = page.getByRole("button", { name: /Open .* player record/ });
  await toggle.click();
  await page.locator(".command-station.mobile-command-expanded .mobile-record-slot .record-preview").waitFor({ state: "visible" });
  await page.getByRole("button", { name: `Open Gargantis monster sheet` }).click();
  const dialog = page.getByRole("dialog", { name: "Gargantis" });
  await dialog.waitFor({ state: "visible" });
  const card = dialog.getByRole("article", { name: `${cardId} Monster Mutation card`, exact: true });
  await card.waitFor({ state: "visible" });
  assert.equal(await dialog.getByRole("region", { name: "Your Mutation cards" }).getByRole("heading", { name: `Monster Mutation · 1` }).count(), 1, "the production Monster Sheet displays its real one-card hand");
  assert.equal((await card.locator("h4").innerText()).trim(), cardId, "the real held card is visibly labeled with its authoritative identifier");
  const artworkLoaded = await card.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
  assert.ok(artworkLoaded, "the actual held Mutation card artwork loads in the production route");
  const workspace = dialog.locator(".monster-sheet-workspace");
  const mutationArea = dialog.getByRole("region", { name: "Your Mutation cards" });
  assert.equal(await workspace.getAttribute("tabindex"), "0", "the record/card workspace is keyboard focusable in the real route");
  const phoneBounds = await dialog.boundingBox();
  assert.ok(phoneBounds && phoneBounds.x >= -1 && phoneBounds.y >= -1 && phoneBounds.x + phoneBounds.width <= 391 && phoneBounds.y + phoneBounds.height <= 845,
    `the phone Monster Sheet fits its viewport: ${JSON.stringify(phoneBounds)}`);
  const phoneLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(phoneLayout.document <= phoneLayout.viewport + 1 && phoneLayout.body <= phoneLayout.viewport + 1, `the phone route has no horizontal overflow: ${JSON.stringify(phoneLayout)}`);

  const cardFullyVisible = async () => card.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const clip = element.closest(".monster-sheet-workspace")!.getBoundingClientRect();
    return item.left >= clip.left - 1 && item.right <= clip.right + 1 && item.top >= clip.top - 1 && item.bottom <= clip.bottom + 1;
  });
  await workspace.evaluate((element) => { element.scrollLeft = 0; });
  await workspace.focus();
  for (let press = 0; press < 4 && !(await cardFullyVisible()); press += 1) await page.keyboard.press("ArrowRight");
  assert.ok(await cardFullyVisible(), "keyboard ArrowRight reaches and fully exposes the actual held card on phone");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await card.evaluate((element) => element === document.activeElement), true, "normal Tab navigation reaches the held card article on phone");
  const phoneKeyboard = { workspaceScrollLeft: await workspace.evaluate((element) => element.scrollLeft), focusedCard: await card.evaluate((element) => element === document.activeElement), cardBounds: await card.boundingBox() };

  await workspace.evaluate((element) => { element.scrollLeft = 0; });
  const touchSession = await browserContext.newCDPSession(page);
  await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const touchCounts: number[] = [];
  for (let attempt = 0; attempt < 4 && !(await cardFullyVisible()); attempt += 1) {
    const points = await dialog.locator(".monster-physical-record").evaluate((record) => {
      const clip = record.closest(".monster-sheet-workspace")!.getBoundingClientRect();
      const bounds = record.getBoundingClientRect();
      const left = Math.max(bounds.left, clip.left) + 12;
      const right = Math.min(bounds.right, clip.right) - 12;
      const y = Math.max(bounds.top, clip.top) + Math.min(48, Math.max(12, (Math.min(bounds.bottom, clip.bottom) - Math.max(bounds.top, clip.top)) / 2));
      return { left, right, y };
    });
    assert.ok(points.right > points.left + 30, `the visible physical record leaves room for a touch swipe: ${JSON.stringify(points)}`);
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: points.right, y: points.y }] });
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: points.left, y: points.y }] });
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(100);
    touchCounts.push(await workspace.evaluate((element) => element.scrollLeft));
  }
  assert.ok(await cardFullyVisible(), `a touch swipe sequence from the physical record fully reveals the held Mutation card: ${JSON.stringify(touchCounts)}`);
  const cardHeader = card.locator("h4");
  const touchHitTarget = await cardHeader.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, cardContainsHit: Boolean(hit && element.closest("article")?.contains(hit)) };
  });
  assert.ok(touchHitTarget.cardContainsHit, `the touch-visible Mutation card title is the actual hit target: ${JSON.stringify(touchHitTarget)}`);
  await cardHeader.tap();
  const touchAfter = await readRoom(code, players[activeSeat]!.token);
  assert.deepEqual(touchAfter.state, roomBeforeInspection.state, "touch-scrolling to and tapping the card performs inspection only, with unchanged authoritative game state");
  assert.deepEqual(commandFrames, [], "opening, keyboard-reaching, and touch-tapping the held card emits no command-submit frame");
  await page.screenshot({ path: join(artifacts, `monster-sheet-held-card-phone-${date}.png`), fullPage: false });
  await touchSession.detach();

  await page.setViewportSize({ width: 834, height: 1112 });
  await page.waitForFunction(() => innerWidth === 834);
  await workspace.evaluate((element) => { element.scrollLeft = 0; });
  await workspace.focus();
  for (let press = 0; press < 4 && !(await cardFullyVisible()); press += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.ok(await cardFullyVisible(), "keyboard navigation reaches and fully exposes the actual held card at tablet width");
  assert.equal(await card.evaluate((element) => element === document.activeElement), true, "the actual held card receives normal keyboard focus at tablet width");
  const tabletBounds = await dialog.boundingBox();
  assert.ok(tabletBounds && tabletBounds.x >= -1 && tabletBounds.y >= -1 && tabletBounds.x + tabletBounds.width <= 835 && tabletBounds.y + tabletBounds.height <= 1113,
    `the tablet Monster Sheet fits its viewport: ${JSON.stringify(tabletBounds)}`);
  const tabletLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(tabletLayout.document <= tabletLayout.viewport + 1 && tabletLayout.body <= tabletLayout.viewport + 1, `the tablet route has no page-level horizontal overflow: ${JSON.stringify(tabletLayout)}`);
  await page.screenshot({ path: join(artifacts, `monster-sheet-held-card-tablet-${date}.png`), fullPage: false });
  const afterInspection = await readRoom(code, players[activeSeat]!.token);
  assert.equal(afterInspection.version, roomBeforeInspection.version, "the browser inspection and viewport changes do not advance the authoritative room revision");
  assert.deepEqual(afterInspection.state, roomBeforeInspection.state, "the browser inspection preserves the complete authoritative match state");
  assert.deepEqual(report.runtimeErrors, [], "the production route opens and inspects a held Mutation card without runtime or console errors");
  report.status = "passed";
  report.finished = new Date().toISOString();
  report.acquisition = acquired;
  report.phone = { viewport: { width: 390, height: 844 }, cardId, artworkLoaded, phoneBounds, layout: phoneLayout, keyboard: phoneKeyboard, touchScrollPositions: touchCounts, touchHitTarget, screenshot: `monster-sheet-held-card-phone-${date}.png` };
  report.tablet = { viewport: { width: 834, height: 1112 }, cardId, bounds: tabletBounds, layout: tabletLayout, keyboardFocused: true, screenshot: `monster-sheet-held-card-tablet-${date}.png` };
  report.inspection = { baselineRevision: roomBeforeInspection.version, finalRevision: afterInspection.version, completeStateUnchanged: true, commandSubmitFrames: commandFrames.length };
  const artifact = join(artifacts, `monster-sheet-held-card-${date}.json`);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  await unlink(join(artifacts, `monster-sheet-held-card-${date}-failed.json`)).catch(() => undefined);
  console.log(JSON.stringify({ ...report, artifact }, null, 2));
} catch (error) {
  report.status = "failed";
  report.finished = new Date().toISOString();
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  report.serverOutput = { web: webServer?.output(), api: apiServer?.output() };
  const failedArtifact = join(artifacts, `monster-sheet-held-card-${date}-failed.json`);
  await mkdir(artifacts, { recursive: true });
  await writeFile(failedArtifact, `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined);
  throw error;
} finally {
  await context?.close();
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
