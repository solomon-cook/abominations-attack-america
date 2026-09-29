import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  COMMAND_PROTOCOL_VERSION,
  boardForState,
  hasStompableEncounterFeature,
  legalLaserFenceTargets,
  legalMonsterPaths,
  type GameCommand,
  type GameState,
} from "@abominations/game-engine";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = resolve(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const wait = (milliseconds: number) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const reservePort = () => new Promise<number>((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a Challenge verifier port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const webPort = await reservePort();
let apiPort = await reservePort();
while (apiPort === webPort) apiPort = await reservePort();
const webUrl = `http://127.0.0.1:${webPort}/`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

type Session = { room: { code: string }; participantId: string; token: string };
type RoomView = { code: string; status: string; version: number; state: GameState; participants: Array<{ id: string; role: string; playerIndex?: number; displayName: string }> };

const report: Record<string, unknown> = {
  started: new Date().toISOString(),
  scope: "Production main.tsx route and local MemoryRoomStore API. The room reaches Challenge using ordinary legal setup/actions on its pinned playtest board; no Challenge state or pending decision is hand-written. The active phone owner selects an eligible opponent and rolls one legal Challenge attack through the live UI; the spectator tablet receives the authoritative attack history read-only. Mutation and Infamy branches are not forced when absent from natural play.",
  preparation: {},
  scenarios: {},
  runtimeErrors: [],
  findings: [],
};

const startServer = ({ command, args, serverCwd, env, label }: { command: string; args: string[]; serverCwd: string; env: NodeJS.ProcessEnv; label: string }) => {
  const child = spawn(command, args, { cwd: serverCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = async (check: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.\n${output}`);
      try { if (await check()) return; } catch { /* wait for the local service */ }
      await wait(100);
    }
    throw new Error(`${label} did not become ready.\n${output}`);
  };
  return { child, ready, output: () => output };
};

const stopServer = async (server: ReturnType<typeof startServer> | undefined) => {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => server.child.once("exit", () => resolveExit())),
    wait(2000).then(() => { server.child.kill("SIGKILL"); }),
  ]);
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status}): ${body.error ?? JSON.stringify(body)}`);
  return body;
};

const post = <T>(path: string, value: unknown, token?: string) => requestJson<T>(path, {
  method: "POST",
  body: JSON.stringify(value),
  ...(token ? { headers: { "x-room-token": token } } : {}),
});

const readRoom = (code: string, token: string) => requestJson<RoomView>(`/rooms/${code}/state?token=${encodeURIComponent(token)}`);

function axialDistance(from: string, to: string) {
  const [fq, fr] = from.split(",").map(Number);
  const [tq, tr] = to.split(",").map(Number);
  return (Math.abs(fq! - tq!) + Math.abs(fr! - tr!) + Math.abs((fq! + fr!) - (tq! + tr!))) / 2;
}

function choosePreparationAction(state: GameState): { playerIndex: number; command: GameCommand } | undefined {
  const decision = state.pendingDecision;
  if (state.phase === "move") {
    // A face-up Laser Fence can own a response during the movement/Encounter
    // window even when another player currently has the active turn.
    const fenceTargets = legalLaserFenceTargets(state);
    const fenceOwner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence")
      || player.visibleResearchCardIds?.includes("Laser Fence"));
    const fenceTarget = fenceTargets[0];
    if (fenceOwner >= 0 && fenceTarget) {
      if (fenceTarget.infamy >= 2) return { playerIndex: fenceOwner, command: { type: "use-research", cardId: "Laser Fence", targetMonsterId: fenceTarget.targetMonsterId, choice: "infamy" } };
      if (fenceTarget.retreatDestinations.length) return { playerIndex: fenceOwner, command: { type: "use-research", cardId: "Laser Fence", targetMonsterId: fenceTarget.targetMonsterId, choice: "retreat", destination: fenceTarget.retreatDestinations[0] } };
    }

    const monster = state.monsters[state.currentPlayer];
    if (!monster) return undefined;
    if (state.movedPieceIds.includes(monster.id)) return { playerIndex: state.currentPlayer, command: { type: "pass-move" } };
    const board = boardForState(state);
    const goals = Object.values(board.hexes).filter((hex) => !state.stompedLocations.includes(hex.key)
      && hasStompableEncounterFeature(hex.features));
    const paths = legalMonsterPaths(state, monster.id);
    const freshSites = paths.filter((path) => goals.some((hex) => hex.key === path.at(-1)));
    if (freshSites.length) {
      freshSites.sort((left, right) => left.length - right.length || left.at(-1)!.localeCompare(right.at(-1)!));
      return { playerIndex: state.currentPlayer, command: { type: "move", path: freshSites[0]! } };
    }
    if (paths.length && goals.length) {
      const best = paths.map((path) => ({ path, distance: Math.min(...goals.map((goal) => axialDistance(path.at(-1)!, goal.key))) }))
        .sort((left, right) => left.distance - right.distance || left.path.length - right.path.length || left.path.at(-1)!.localeCompare(right.path.at(-1)!))[0];
      return { playerIndex: state.currentPlayer, command: { type: "move", path: best!.path } };
    }
    return { playerIndex: state.currentPlayer, command: { type: "pass-move" } };
  }
  if (state.phase === "encounter") {
    if (decision?.type === "trophy-choice") return { playerIndex: decision.playerIndex, command: { type: "resolve-encounter", trophyUnitId: decision.unitIds[0] } };
    if (decision?.type === "encounter-choice") return { playerIndex: decision.playerIndex, command: { type: "resolve-encounter", choice: "health" } };
    return { playerIndex: state.currentPlayer, command: { type: "resolve-encounter" } };
  }
  if (state.phase === "deploy") return { playerIndex: decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer, command: { type: "pass-deploy" } };
  return undefined;
}

async function submitSetup(code: string, player: Session, action: unknown, expectedRevision: number) {
  return post<RoomView>(`/rooms/${code}/setup`, { expectedRevision, action }, player.token);
}

async function submitCommand(code: string, room: RoomView, player: Session, command: GameCommand) {
  const envelope = {
    actionId: randomUUID(),
    actorId: player.participantId,
    expectedRevision: room.version,
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    command,
  };
  return post<RoomView>(`/rooms/${code}/actions`, { envelope }, player.token);
}

let webServer: ReturnType<typeof startServer> | undefined;
let apiServer: ReturnType<typeof startServer> | undefined;
let browser: import("playwright").Browser | undefined;

try {
  await mkdir(artifactDirectory, { recursive: true });
  webServer = startServer({
    command: process.execPath,
    args: [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    serverCwd: join(cwd, "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    label: "Vite",
  });
  await webServer.ready(async () => (await fetch(webUrl)).ok);
  apiServer = startServer({
    command: process.execPath,
    args: ["--import", "tsx/esm", "src/server.ts"],
    serverCwd: join(cwd, "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(webUrl).origin },
    label: "Memory API",
  });
  await apiServer.ready(async () => (await fetch(`${apiUrl}/health`)).ok);

  const first = await post<Session>("/rooms", { maxPlayers: 2, displayName: "Challenge player one", privacy: "public" });
  const code = first.room.code;
  const second = await post<Session>(`/rooms/${code}/join`, { displayName: "Challenge player two" });
  const spectator = await post<Session>(`/rooms/${code}/spectate`, { displayName: "Challenge spectator" });
  const phoneSpectator = await post<Session>(`/rooms/${code}/spectate`, { displayName: "Phone Challenge spectator" });
  const sessions = [first, second];
  let room = await readRoom(code, first.token);
  const setup = room.state.setupState;
  assert.ok(setup, "new public MemoryRoomStore room exposes a live setup state");
  const monsterOne = "monster-2";
  const monsterTwo = "monster-3";
  assert.ok(setup.definition.monsterIds.includes(monsterOne) && setup.definition.monsterIds.includes(monsterTwo), "the setup catalogue includes the deterministic non-Zorb monster pair");
  const lairOne = setup.definition.lairsByMonster[monsterOne]![0]!;
  const lairTwo = setup.definition.lairsByMonster[monsterTwo]!.find((candidate) => candidate !== lairOne);
  assert.ok(lairTwo, "the selected monsters have distinct configured lairs");
  const branchOne = setup.definition.eligibleBranches[0]!;
  const branchTwo = setup.definition.eligibleBranches[1]!;
  const setupSteps: Array<[number, unknown]> = [
    [0, { type: "choose-monster", monsterId: monsterOne }],
    [1, { type: "choose-monster", monsterId: monsterTwo }],
    [1, { type: "choose-branch", branch: branchOne }],
    [0, { type: "choose-branch", branch: branchTwo }],
    [0, { type: "choose-lair", lair: lairOne }],
    [1, { type: "choose-lair", lair: lairTwo }],
    [0, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
    [1, { type: "choose-starting-choice", startingChoice: { kind: "research" } }],
  ];
  for (const [playerIndex, action] of setupSteps) {
    room = await submitSetup(code, sessions[playerIndex]!, action, room.version);
  }
  for (const player of sessions) await post<RoomView>(`/rooms/${code}/ready`, { ready: true }, player.token);
  room = await readRoom(code, first.token);
  assert.equal(room.status, "active", "completed legal setup and both Ready actions activate the room");
  assert.equal(room.state.setupApplied, true);

  const initialStompMarkers = room.state.stompMarkers;
  const prepStartedAt = Date.now();
  let preparationActions = 0;
  let lastStompCount = room.state.stompMarkers;
  while (room.state.stompMarkers > 0 && preparationActions < 120) {
    const next = choosePreparationAction(room.state);
    if (!next) throw new Error(`Could not prepare a natural Challenge from ${room.state.phase}/${room.state.pendingDecision?.type}; remaining Stomp markers: ${room.state.stompMarkers}`);
    const player = sessions[next.playerIndex];
    assert.ok(player, `player ${next.playerIndex} owns the next authoritative decision`);
    room = await submitCommand(code, room, player, next.command);
    preparationActions += 1;
    if (room.state.stompMarkers < lastStompCount) {
      lastStompCount = room.state.stompMarkers;
      assert.ok(preparationActions < 120, "the legal engine sequence keeps making bounded progress toward Challenge");
    }
  }
  assert.equal(room.state.stompMarkers, 0, "ordinary play has consumed the complete configured Stomp supply");
  assert.ok(preparationActions > 0 && preparationActions < 120, "the engine sequence reaches the final Stomp marker within its action bound");
  assert.equal(room.state.phase, "deploy", "the final Stomp encounter ends in the normal Deploy phase before Challenge starts");
  assert.equal(room.state.challenge?.declared, true, "the final Stomp Encounter declares Challenge through engine logic");
  const beforeChallengeStart = room;
  room = await submitCommand(code, room, sessions[room.state.currentPlayer]!, { type: "pass-deploy" });
  let challengeStartCommands = 1;
  while (room.state.phase !== "challenge" && challengeStartCommands < 12) {
    const next = choosePreparationAction(room.state);
    if (!next) throw new Error(`Could not finish the intervening legal turn toward Challenge from ${room.state.phase}/${room.state.pendingDecision?.type}`);
    const player = sessions[next.playerIndex];
    assert.ok(player, `player ${next.playerIndex} owns the next decision on the route to Challenge`);
    room = await submitCommand(code, room, player, next.command);
    challengeStartCommands += 1;
  }
  assert.equal(room.state.challenge?.declared, true, "the engine declared the pending Challenge through its normal Encounter resolution");
  assert.equal(room.state.phase, "challenge", "the turn-end action started the active Monster Challenge");
  assert.equal(room.state.pendingDecision?.type, "challenge-opponent", "the active Challenge asks its eligible challenger to choose an opponent");
  const choiceBefore = room;
  const challengerIndex = room.state.pendingDecision.playerIndex;
  const challenger = sessions[challengerIndex]!;
  const eligibleOpponentIds = [...room.state.pendingDecision.opponentIds];
  assert.ok(eligibleOpponentIds.length > 0, "the real engine pending decision exposes an eligible opponent");
  report.preparation = {
    status: "passed",
    playtestBoardId: room.state.boardId,
    setupActions: setupSteps.length,
    acceptedEngineCommands: preparationActions,
    challengeStartCommand: {
      type: "legal engine command sequence",
      acceptedCommands: challengeStartCommands,
      event: room.state.eventLog.at(-1)?.action,
      revisionDelta: room.version - beforeChallengeStart.version,
    },
    initialStompMarkers,
    remainingStompMarkers: room.state.stompMarkers,
    engineEvents: room.state.eventLog.length,
    elapsedMs: Date.now() - prepStartedAt,
    challenge: { phase: room.state.phase, pendingDecision: room.state.pendingDecision.type, challengerPlayerIndex: challengerIndex, eligibleOpponentIds },
    sourceBoundary: "The room uses the currently pinned board/ruleset candidate. This verifies the present digital route and does not approve physical-edition parity.",
  };

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ownerViewport = { width: 390, height: 844 };
  const spectatorViewport = { width: 834, height: 1112 };
  const makePage = async (session: Session, viewport: { width: number; height: number }, label: string, mobile = false) => {
    const context = await browser!.newContext({ viewport, deviceScaleFactor: 1, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const sentFrames: string[] = [];
    page.on("websocket", (socket) => socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string" && frame.payload.includes("command.submit")) sentFrames.push(frame.payload);
    }));
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => (report.runtimeErrors as string[]).push(`${label}: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") (report.runtimeErrors as string[]).push(`${label}: ${message.text()}`); });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route((url) => new URL(url).origin === apiUrl && new URL(url).pathname === "/accounts/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: null }) }));
    await page.addInitScript((value) => localStorage.setItem("abominations-session", value), JSON.stringify({ token: session.token, participantId: session.participantId, accountLinked: false, room: { code: session.room.code } }));
    return { page, context, sentFrames };
  };

  const ownerBeforeOpen = await readRoom(code, challenger.token);
  const spectatorBeforeOpen = await readRoom(code, spectator.token);
  const phoneSpectatorBeforeOpen = await readRoom(code, phoneSpectator.token);
  assert.equal(ownerBeforeOpen.version, choiceBefore.version, "the owner baseline matches the engine-created Challenge decision before browser navigation");
  assert.equal(spectatorBeforeOpen.version, choiceBefore.version, "the spectator baseline matches the same pre-navigation Challenge revision");
  assert.equal(phoneSpectatorBeforeOpen.version, choiceBefore.version, "the phone spectator baseline matches the same pre-navigation Challenge revision");
  const { page: ownerPage, context: ownerContext, sentFrames: commandFrames } = await makePage(challenger, ownerViewport, "active owner", true);
  const { page: spectatorPage, context: spectatorContext, sentFrames: spectatorCommandFrames } = await makePage(spectator, spectatorViewport, "spectator");
  const { page: spectatorPhonePage, context: spectatorPhoneContext, sentFrames: spectatorPhoneCommandFrames } = await makePage(phoneSpectator, ownerViewport, "phone spectator", true);
  try {
    await Promise.all([ownerPage.goto(webUrl, { waitUntil: "domcontentloaded" }), spectatorPage.goto(webUrl, { waitUntil: "domcontentloaded" }), spectatorPhonePage.goto(webUrl, { waitUntil: "domcontentloaded" })]);
    for (const [page, role] of [[ownerPage, "active owner"], [spectatorPage, "spectator"], [spectatorPhonePage, "phone spectator"]] as const) {
      await page.waitForFunction(() => document.querySelector(".connection")?.textContent?.trim() === "online"
        && document.querySelector(".action-card h2")?.textContent?.trim() === "Monster Challenge", null, { timeout: 20000 });
    }

    const ownerDialog = ownerPage.locator("dialog.resolution-challenge[open]");
    await ownerDialog.waitFor({ state: "visible" });
    await ownerPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    const beforeOpen = ownerBeforeOpen;
    const ownerBounds = await ownerDialog.boundingBox();
    assert.ok(ownerBounds && ownerBounds.x >= -1 && ownerBounds.y >= -1 && ownerBounds.x + ownerBounds.width <= ownerViewport.width + 1 && ownerBounds.y + ownerBounds.height <= ownerViewport.height + 1,
      `the active owner's Challenge arena fits the phone viewport: ${JSON.stringify(ownerBounds)}`);
    const ownerChoiceButtons = ownerDialog.locator(".challenge-opponents button:not(:disabled)");
    assert.equal(await ownerChoiceButtons.count(), eligibleOpponentIds.length, "the live route exposes every eligible opponent as an actionable choice to the challenger");
    assert.deepEqual(await ownerChoiceButtons.evaluateAll((buttons) => buttons.map((button) => button.querySelector("strong")?.textContent?.trim())),
      eligibleOpponentIds.map((id) => beforeOpen.state.monsters.find((monster) => monster.id === id)?.name), "the rendered choice labels match the engine's eligible-opponent list");
    assert.deepEqual(commandFrames, [], "automatically opening the Challenge arena emits no command-submit frame");
    const afterOpen = await readRoom(code, challenger.token);
    assert.equal(afterOpen.state.eventLog.length, ownerBeforeOpen.state.eventLog.length, "opening the arena preserves the pre-navigation event count");
    assert.deepEqual(afterOpen.state, ownerBeforeOpen.state, "opening the arena preserves the complete pre-navigation game state; only WebSocket presence may advance room revision");
    await ownerPage.screenshot({ path: join(artifactDirectory, `challenge-full-route-owner-open-${date}.png`), fullPage: true });

    await ownerPage.keyboard.press("Escape");
    await ownerDialog.waitFor({ state: "detached" });
    await ownerPage.waitForFunction(() => document.activeElement === document.querySelector(".turn-hud-heading h2"));
    const ownerAutoOpenFocus = await ownerPage.evaluate(() => ({
      returnedToHeading: document.activeElement === document.querySelector(".turn-hud-heading h2"),
      tag: document.activeElement?.tagName ?? "none",
      label: (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 60) ?? "",
    }));
    assert.equal(ownerAutoOpenFocus.returnedToHeading, true, "closing the auto-opened owner arena restores focus to the persistent Challenge heading");
    const ownerDockButton = ownerPage.getByRole("button", { name: "Resolve Monster Challenge" });
    assert.equal(await ownerDockButton.isEnabled(), true, "the active phone can reopen the Challenge from its action dock");
    await ownerDockButton.focus();
    await ownerDockButton.press("Enter");
    const ownerFallbackDialog = ownerPage.locator("dialog.resolution-challenge[open]");
    await ownerFallbackDialog.waitFor({ state: "visible" });
    await ownerPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    assert.deepEqual(commandFrames, [], "reopening the Challenge from the action dock submits no command");
    const ownerAfterDockOpen = await readRoom(code, challenger.token);
    assert.equal(ownerAfterDockOpen.version, afterOpen.version, "reopening the Challenge from the action dock does not change the post-connection room revision");
    await ownerPage.keyboard.press("Escape");
    await ownerFallbackDialog.waitFor({ state: "detached" });
    await ownerPage.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Resolve Monster Challenge"]'));
    const ownerReopenFocus = await ownerDockButton.evaluate((node) => node === document.activeElement);
    assert.equal(ownerReopenFocus, true, "closing a manually reopened owner arena restores focus to its action-dock opener");
    await ownerDockButton.press("Enter");
    await ownerFallbackDialog.waitFor({ state: "visible" });
    await ownerPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));

    const spectatorDialog = spectatorPage.locator("dialog.resolution-challenge[open]");
    await spectatorDialog.waitFor({ state: "visible" });
    await spectatorPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    const spectatorBefore = await readRoom(code, spectator.token);
    assert.equal(spectatorBefore.state.phase, "challenge");
    assert.equal(spectatorBefore.state.pendingDecision?.type, "challenge-opponent");
    assert.equal(spectatorBefore.state.eventLog.length, spectatorBeforeOpen.state.eventLog.length, "the spectator's auto-open preserves the pre-navigation event count");
    assert.deepEqual(spectatorBefore.state, spectatorBeforeOpen.state, "the spectator's auto-open preserves the complete pre-navigation game state; only WebSocket presence may advance room revision");
    const spectatorBounds = await spectatorDialog.boundingBox();
    assert.ok(spectatorBounds && spectatorBounds.x >= -1 && spectatorBounds.y >= -1 && spectatorBounds.x + spectatorBounds.width <= spectatorViewport.width + 1 && spectatorBounds.y + spectatorBounds.height <= spectatorViewport.height + 1,
      `the spectator Challenge arena fits the tablet viewport: ${JSON.stringify(spectatorBounds)}`);
    const spectatorChoiceButtons = spectatorDialog.locator(".challenge-opponents button");
    assert.equal(await spectatorChoiceButtons.count(), eligibleOpponentIds.length, "the spectator can inspect the same eligible opponents");
    assert.ok(await spectatorChoiceButtons.evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled)), "all spectator opponent choices are disabled");
    await spectatorChoiceButtons.first()!.evaluate((button) => button.click());
    await spectatorPage.waitForTimeout(50);
    const spectatorAfterClick = await readRoom(code, spectator.token);
    assert.equal(spectatorAfterClick.version, spectatorBefore.version, "attempting the disabled spectator choice cannot change the room revision");
    assert.equal(spectatorAfterClick.state.eventLog.length, spectatorBefore.state.eventLog.length, "the spectator submits no game event");
    assert.deepEqual(spectatorCommandFrames, [], "the spectator emits no command-submit frame");
    await spectatorPage.screenshot({ path: join(artifactDirectory, `challenge-full-route-spectator-${date}.png`), fullPage: true });

    await spectatorPage.keyboard.press("Escape");
    await spectatorDialog.waitFor({ state: "detached" });
    await spectatorPage.waitForFunction(() => document.activeElement === document.querySelector(".turn-hud-heading h2"));
    const spectatorAutoOpenFocus = await spectatorPage.evaluate(() => ({
      returnedToHeading: document.activeElement === document.querySelector(".turn-hud-heading h2"),
      tag: document.activeElement?.tagName ?? "none",
      label: (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 60) ?? "",
    }));
    assert.equal(spectatorAutoOpenFocus.returnedToHeading, true, "closing the auto-opened spectator arena restores focus to the persistent Challenge heading");
    const spectatorDockButton = spectatorPage.getByRole("button", { name: "Watch Monster Challenge" });
    assert.equal(await spectatorDockButton.isEnabled(), true, "the tablet spectator can reopen a read-only Challenge from the action dock");
    await spectatorDockButton.focus();
    await spectatorDockButton.press("Enter");
    const spectatorReopenedDialog = spectatorPage.locator("dialog.resolution-challenge[open]");
    await spectatorReopenedDialog.waitFor({ state: "visible" });
    await spectatorPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    assert.deepEqual(spectatorCommandFrames, [], "reopening the read-only Challenge submits no command");
    const spectatorAfterDockOpen = await readRoom(code, spectator.token);
    assert.equal(spectatorAfterDockOpen.version, spectatorBefore.version, "reopening the read-only Challenge does not change the post-connection room revision");

    const phoneSpectatorDialog = spectatorPhonePage.locator("dialog.resolution-challenge[open]");
    await phoneSpectatorDialog.waitFor({ state: "visible" });
    await spectatorPhonePage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    const phoneSpectatorBounds = await phoneSpectatorDialog.boundingBox();
    assert.ok(phoneSpectatorBounds && phoneSpectatorBounds.x >= -1 && phoneSpectatorBounds.y >= -1 && phoneSpectatorBounds.x + phoneSpectatorBounds.width <= ownerViewport.width + 1 && phoneSpectatorBounds.y + phoneSpectatorBounds.height <= ownerViewport.height + 1,
      `the phone spectator Challenge arena fits the phone viewport: ${JSON.stringify(phoneSpectatorBounds)}`);
    const phoneSpectatorInitial = await readRoom(code, phoneSpectator.token);
    assert.equal(phoneSpectatorInitial.state.eventLog.length, phoneSpectatorBeforeOpen.state.eventLog.length,
      `the phone spectator's auto-open adds no event: ${JSON.stringify({ before: phoneSpectatorBeforeOpen.state.eventLog.slice(-2), after: phoneSpectatorInitial.state.eventLog.slice(-2), beforeVersion: phoneSpectatorBeforeOpen.version, afterVersion: phoneSpectatorInitial.version })}`);
    assert.deepEqual(phoneSpectatorInitial.state, phoneSpectatorBeforeOpen.state, "the phone spectator's auto-open preserves the complete game state; only WebSocket presence may advance room revision");
    await spectatorPhonePage.screenshot({ path: join(artifactDirectory, `challenge-full-route-spectator-phone-${date}.png`), fullPage: true });
    await spectatorPhonePage.keyboard.press("Escape");
    await phoneSpectatorDialog.waitFor({ state: "detached" });
    await spectatorPhonePage.waitForFunction(() => document.activeElement === document.querySelector(".turn-hud-heading h2"));
    const phoneSpectatorDock = spectatorPhonePage.getByRole("button", { name: "Watch Monster Challenge" });
    assert.equal(await phoneSpectatorDock.isEnabled(), true, "the phone spectator can reopen a read-only Challenge from the collapsed action dock");
    await phoneSpectatorDock.focus();
    await phoneSpectatorDock.press("Enter");
    const phoneSpectatorReopenedDialog = spectatorPhonePage.locator("dialog.resolution-challenge[open]");
    await phoneSpectatorReopenedDialog.waitFor({ state: "visible" });
    await spectatorPhonePage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
    assert.deepEqual(spectatorPhoneCommandFrames, [], "the phone spectator's dock re-entry submits no command");
    const phoneSpectatorAfterReopen = await readRoom(code, phoneSpectator.token);
    assert.equal(phoneSpectatorAfterReopen.version, phoneSpectatorInitial.version, "the phone spectator's dock re-entry leaves the post-connection room revision unchanged");
    await spectatorPhonePage.keyboard.press("Escape");
    await phoneSpectatorReopenedDialog.waitFor({ state: "detached" });
    await spectatorPhonePage.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Watch Monster Challenge"]'));
    const phoneSpectatorLayout = await spectatorPhonePage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(phoneSpectatorLayout.document <= phoneSpectatorLayout.viewport + 1 && phoneSpectatorLayout.body <= phoneSpectatorLayout.viewport + 1,
      `the phone spectator route has no horizontal overflow: ${JSON.stringify(phoneSpectatorLayout)}`);

    const chosenId = eligibleOpponentIds[0]!;
    const chosenMonster = beforeOpen.state.monsters.find((monster) => monster.id === chosenId)!;
    const expectedVersion = afterOpen.version;
    const expectedEventCount = afterOpen.state.eventLog.length;
    const chosenButton = ownerDialog.locator(".challenge-opponents button").filter({ hasText: chosenMonster.name });
    assert.equal(await chosenButton.count(), 1, "the selected eligible monster has one unambiguous control");
    await chosenButton.click();
    await ownerPage.waitForFunction(async ({ service, roomCode, token: accessToken, version }) => {
      const response = await fetch(`${service}/rooms/${roomCode}/state?token=${encodeURIComponent(accessToken)}`);
      const current = await response.json();
      return current.version === version + 1 && current.state.eventLog.at(-1)?.action === "challenge.opponent.selected";
    }, { service: apiUrl, roomCode: code, token: challenger.token, version: expectedVersion });
    const ownerAfterChoice = await readRoom(code, challenger.token);
    assert.equal(ownerAfterChoice.version, expectedVersion + 1, "the active player's legal choice advances exactly one room revision");
    assert.equal(ownerAfterChoice.state.eventLog.length, expectedEventCount + 1, "the active player's legal choice appends exactly one game event");
    const selectionEvent = ownerAfterChoice.state.eventLog.at(-1)!;
    assert.equal(selectionEvent.action, "challenge.opponent.selected");
    assert.equal(selectionEvent.detail.challengerMonsterId, room.state.challenge?.challengerMonsterId);
    assert.equal(selectionEvent.detail.opponentMonsterId, chosenId, "the authoritative event records the selected eligible monster");
    assert.deepEqual(ownerAfterChoice.state.challenge?.weighInHealth, {
      [selectionEvent.detail.challengerMonsterId as string]: selectionEvent.detail.challengerWeighIn,
      [chosenId]: selectionEvent.detail.opponentWeighIn,
    }, "the authoritative Challenge state records both weigh-in values");
    assert.equal(ownerAfterChoice.state.pendingDecision?.type, "challenge-resolution", "the route advances to the first authoritative duel decision");
    assert.equal(ownerAfterChoice.state.challenge?.turn?.round, 1);
    assert.equal(commandFrames.length, 1, "the opponent selection emits exactly one command-submit frame");
    const submittedFrame = JSON.parse(commandFrames[0]!) as { type?: string; envelope?: { command?: GameCommand; expectedRevision?: number; actorId?: string } };
    assert.equal(submittedFrame.type, "command.submit");
    assert.equal(submittedFrame.envelope?.command?.type, "challenge-opponent");
    assert.equal((submittedFrame.envelope?.command as Extract<GameCommand, { type: "challenge-opponent" }>).opponentMonsterId, chosenId);
    assert.equal(submittedFrame.envelope?.expectedRevision, expectedVersion);
    assert.equal(submittedFrame.envelope?.actorId, challenger.participantId);
    const spectatorAfterOwnerChoice = await readRoom(code, spectator.token);
    assert.equal(spectatorAfterOwnerChoice.version, expectedVersion + 1, "the spectator receives the owner's single accepted opponent-selection revision");
    assert.equal(spectatorAfterOwnerChoice.state.eventLog.at(-1)?.id, selectionEvent.id, "the spectator projection contains the same opponent-selection event");
    const ownerLayout = await ownerPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(ownerLayout.document <= ownerLayout.viewport + 1 && ownerLayout.body <= ownerLayout.viewport + 1, `the phone route has no horizontal overflow: ${JSON.stringify(ownerLayout)}`);

    const attackBefore = ownerAfterChoice;
    const attackDecision = attackBefore.state.pendingDecision;
    assert.ok(attackDecision?.type === "challenge-resolution" || attackDecision?.type === "challenge-giant-resolution",
      "the selected rival exposes the authoritative Challenge attack decision");
    assert.equal(attackBefore.state.currentPlayer, challengerIndex,
      "the naturally generated first Challenge attack is controlled by the phone owner who selected the opponent");
    assert.equal(attackDecision.playerIndex, challengerIndex, "the current phone owner is authorized for this Challenge attack");
    const attackerId = attackBefore.state.challenge?.turn?.attackerId;
    assert.ok(attackerId, "the engine selected a first attacker for the Challenge turn");
    const attacker = attackBefore.state.monsters.find((monster) => monster.id === attackerId)
      ?? attackBefore.state.units.find((unit) => unit.id === attackerId);
    const defender = attackBefore.state.monsters.find((monster) => monster.id !== attackerId && monster.id === chosenId)
      ?? attackBefore.state.units.find((unit) => unit.id === chosenId);
    assert.ok(attacker && defender, "the authoritative Challenge combatants are present");
    const nameOf = (unit: typeof attacker) => unit && "name" in unit ? unit.name : unit?.unitTypeId?.replaceAll("-", " ") ?? "Opponent";
    const defenderName = nameOf(defender);
    const attackButton = ownerDialog.getByRole("button", { name: `Roll attack against ${defenderName}`, exact: true });
    assert.equal(await attackButton.count(), 1, "the production phone arena offers exactly one roll action against the current defender");
    assert.equal(await attackButton.isEnabled(), true, "the phone owner can legally resolve the generated attack");
    const attackRevision = attackBefore.version;
    const attackEventCount = attackBefore.state.eventLog.length;
    await attackButton.click();
    await ownerPage.waitForFunction(async ({ service, roomCode, token: accessToken, version }) => {
      const response = await fetch(`${service}/rooms/${roomCode}/state?token=${encodeURIComponent(accessToken)}`);
      const current = await response.json();
      return current.version === version + 1 && current.state.eventLog.at(-1)?.action === "challenge.attack.rolled";
    }, { service: apiUrl, roomCode: code, token: challenger.token, version: attackRevision });
    const ownerAfterAttack = await readRoom(code, challenger.token);
    assert.equal(ownerAfterAttack.version, attackRevision + 1, "one accepted Challenge attack advances exactly one room revision");
    assert.equal(ownerAfterAttack.state.eventLog.length, attackEventCount + 1, "one accepted Challenge attack appends exactly one event");
    const attackEvent = ownerAfterAttack.state.eventLog.at(-1)!;
    assert.equal(attackEvent.action, "challenge.attack.rolled");
    assert.equal(attackEvent.actorId, challenger.participantId, "the accepted attack is attributed to the phone owner's participant");
    const attackDetails = attackEvent.detail.attacks as Array<Record<string, unknown>>;
    assert.equal(attackDetails.length, 1, "the authoritative event contains exactly the newly rolled attack");
    const resolvedAttack = attackDetails[0]!;
    assert.equal(resolvedAttack.attackerId, attackerId);
    assert.equal(resolvedAttack.targetId, defender.id);
    assert.ok(Number.isInteger(resolvedAttack.roll) && Number(resolvedAttack.roll) >= 1 && Number(resolvedAttack.roll) <= 6,
      "the authoritative attack records its d6 result");
    assert.deepEqual(attackEvent.detail.rolls, [resolvedAttack.roll], "the event roll summary matches its attack record");
    assert.deepEqual(ownerAfterAttack.state.challenge?.turn?.attacks.at(-1), resolvedAttack,
      "the live Challenge turn history contains the exact authoritative attack");
    assert.deepEqual(attackEvent.detail.healthBeforeAttack, {
      [attackerId]: attackBefore.state.monsters.find((monster) => monster.id === attackerId)?.health ?? attackBefore.state.units.find((unit) => unit.id === attackerId)?.health,
      [defender.id]: attackBefore.state.monsters.find((monster) => monster.id === defender.id)?.health ?? attackBefore.state.units.find((unit) => unit.id === defender.id)?.health,
    }, "the attack event's before-Health snapshot matches the prior authoritative state");
    assert.deepEqual(attackEvent.detail.healthAfterAttack, {
      [attackerId]: ownerAfterAttack.state.monsters.find((monster) => monster.id === attackerId)?.health ?? ownerAfterAttack.state.units.find((unit) => unit.id === attackerId)?.health,
      [defender.id]: ownerAfterAttack.state.monsters.find((monster) => monster.id === defender.id)?.health ?? ownerAfterAttack.state.units.find((unit) => unit.id === defender.id)?.health,
    }, "the attack event's after-Health snapshot matches the resulting authoritative state");
    assert.equal(commandFrames.length, 2, "the selected opponent and one Challenge attack submit exactly two commands");
    const attackFrame = JSON.parse(commandFrames[1]!) as { type?: string; envelope?: { command?: GameCommand; expectedRevision?: number; actorId?: string } };
    assert.equal(attackFrame.type, "command.submit");
    assert.equal(attackFrame.envelope?.command?.type, "resolve-challenge");
    assert.equal(attackFrame.envelope?.expectedRevision, attackRevision, "the attack submits against the accepted opponent-selection revision");
    assert.equal(attackFrame.envelope?.actorId, challenger.participantId);

    const spectatorAfterAttack = await readRoom(code, spectator.token);
    assert.equal(spectatorAfterAttack.version, attackRevision + 1, "the spectator receives the accepted attack revision");
    assert.equal(spectatorAfterAttack.state.eventLog.at(-1)?.id, attackEvent.id, "the spectator projection contains the same authoritative attack event");
    assert.deepEqual(spectatorAfterAttack.state.challenge?.turn?.attacks.at(-1), resolvedAttack,
      "the spectator projection receives the same attack history without revealing extra state");
    const spectatorAttackControls = spectatorDialog.locator(".challenge-opponents button, .battle-target-actions button, .challenge-turn-actions button");
    await spectatorAttackControls.first().waitFor({ state: "visible" });
    const spectatorAttackControlStates = await spectatorAttackControls.evaluateAll((buttons) => buttons.map((button) => ({
      label: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
      disabled: (button as HTMLButtonElement).disabled,
    })));
    assert.ok(spectatorAttackControlStates.length > 0, "the spectator can see the current Challenge action state");
    assert.ok(spectatorAttackControlStates.every((control) => control.disabled),
      `all current Challenge actions remain read-only for the spectator: ${JSON.stringify(spectatorAttackControlStates)}`);
    await spectatorDialog.locator(".battle-history summary").press("Space");
    const expectedHistoryLine = `Round ${String(resolvedAttack.combatRound)} · ${nameOf(attacker)} · ⚄ ${String(resolvedAttack.roll)} · ${resolvedAttack.hit ? `${String(resolvedAttack.damage)} damage` : "Miss"}${Array.isArray(resolvedAttack.modifiers) && resolvedAttack.modifiers.length ? ` · ${(resolvedAttack.modifiers as string[]).join(" · ")}` : ""}`;
    const spectatorHistoryLine = spectatorDialog.locator(".battle-history li").last();
    await spectatorHistoryLine.waitFor({ state: "visible" });
    assert.equal((await spectatorHistoryLine.innerText()).trim(), expectedHistoryLine,
      "the read-only spectator arena renders the authoritative round, attacker, roll, outcome, and modifiers");
    assert.deepEqual(spectatorCommandFrames, [], "the spectator receives the attack but sends no command-submit frame");
    const ownerAttackBounds = await ownerDialog.boundingBox();
    assert.ok(ownerAttackBounds && ownerAttackBounds.x >= -1 && ownerAttackBounds.y >= -1 && ownerAttackBounds.x + ownerAttackBounds.width <= ownerViewport.width + 1 && ownerAttackBounds.y + ownerAttackBounds.height <= ownerViewport.height + 1,
      `the active attack arena fits the phone viewport: ${JSON.stringify(ownerAttackBounds)}`);
    const ownerAttackLayout = await ownerPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(ownerAttackLayout.document <= ownerAttackLayout.viewport + 1 && ownerAttackLayout.body <= ownerAttackLayout.viewport + 1,
      `the active phone attack has no horizontal overflow: ${JSON.stringify(ownerAttackLayout)}`);
    const spectatorAttackBounds = await spectatorDialog.boundingBox();
    assert.ok(spectatorAttackBounds && spectatorAttackBounds.x >= -1 && spectatorAttackBounds.y >= -1 && spectatorAttackBounds.x + spectatorAttackBounds.width <= spectatorViewport.width + 1 && spectatorAttackBounds.y + spectatorAttackBounds.height <= spectatorViewport.height + 1,
      `the read-only spectator attack arena fits the tablet viewport: ${JSON.stringify(spectatorAttackBounds)}`);
    const spectatorAttackLayout = await spectatorPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(spectatorAttackLayout.document <= spectatorAttackLayout.viewport + 1 && spectatorAttackLayout.body <= spectatorAttackLayout.viewport + 1,
      `the spectator attack has no horizontal overflow: ${JSON.stringify(spectatorAttackLayout)}`);
    await ownerPage.screenshot({ path: join(artifactDirectory, `challenge-full-route-owner-attack-${date}.png`), fullPage: true });
    await spectatorPage.screenshot({ path: join(artifactDirectory, `challenge-full-route-spectator-attack-${date}.png`), fullPage: true });

    await spectatorPage.keyboard.press("Escape");
    await spectatorReopenedDialog.waitFor({ state: "detached" });
    await spectatorPage.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Watch Monster Challenge"]'));
    const spectatorReopenFocus = await spectatorDockButton.evaluate((node) => node === document.activeElement);
    assert.equal(spectatorReopenFocus, true, "closing a manually reopened spectator arena restores focus to its action-dock opener");
    const spectatorLayout = await spectatorPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(spectatorLayout.document <= spectatorLayout.viewport + 1 && spectatorLayout.body <= spectatorLayout.viewport + 1, `the tablet route has no horizontal overflow: ${JSON.stringify(spectatorLayout)}`);

    report.scenarios = {
      activeOwner: {
        status: "passed",
        viewport: ownerViewport,
        input: "production phase transition auto-opens Challenge arena; pointer opponent selection; Escape to close",
        eligibleChoices: eligibleOpponentIds.map((id) => beforeOpen.state.monsters.find((monster) => monster.id === id)?.name),
        openingGameStateUnchanged: true,
        acceptedCommandFrames: commandFrames.length,
        acceptedRevision: ownerAfterChoice.version,
        acceptedEvent: selectionEvent,
        pendingDecisionAfterChoice: ownerAfterChoice.state.pendingDecision?.type,
        acceptedAttack: {
          viewport: ownerViewport,
          actorId: challenger.participantId,
          command: attackFrame.envelope?.command,
          expectedRevision: attackFrame.envelope?.expectedRevision,
          acceptedRevision: ownerAfterAttack.version,
          event: attackEvent,
          authoritativeAttack: resolvedAttack,
          challengeHistoryCount: ownerAfterAttack.state.challenge?.turn?.attacks.length,
          phoneBounds: ownerAttackBounds,
          layout: ownerAttackLayout,
          screenshot: `challenge-full-route-owner-attack-${date}.png`,
        },
        autoOpenFocusAfterClose: ownerAutoOpenFocus,
        reopenFocusReturnedToActionDock: ownerReopenFocus,
        horizontalOverflow: ownerLayout.document > ownerLayout.viewport + 1 || ownerLayout.body > ownerLayout.viewport + 1,
        bounds: ownerBounds,
        screenshot: `challenge-full-route-owner-open-${date}.png`,
        openingBaseline: { beforeConnectionVersion: ownerBeforeOpen.version, afterConnectionVersion: afterOpen.version, gameStateUnchanged: true, eventCount: ownerBeforeOpen.state.eventLog.length, pendingDecision: ownerBeforeOpen.state.pendingDecision?.type },
      },
      spectator: {
        status: "passed",
        viewport: spectatorViewport,
        input: "automatic route entry; disabled-choice attempt; keyboard dock re-entry; Escape to close",
        visibleChoices: eligibleOpponentIds.length,
        choicesDisabled: true,
        commandsSubmitted: spectatorCommandFrames.length,
        revisionUnchangedByAttempt: spectatorAfterClick.version === spectatorBefore.version,
        autoOpenFocusAfterClose: spectatorAutoOpenFocus,
        reopenFocusReturnedToActionDock: spectatorReopenFocus,
        horizontalOverflow: spectatorLayout.document > spectatorLayout.viewport + 1 || spectatorLayout.body > spectatorLayout.viewport + 1,
        bounds: spectatorBounds,
        screenshot: `challenge-full-route-spectator-${date}.png`,
        receivedOwnerResult: spectatorAfterOwnerChoice.state.eventLog.at(-1)?.action,
        receivedAttack: {
          acceptedRevision: spectatorAfterAttack.version,
          eventId: spectatorAfterAttack.state.eventLog.at(-1)?.id,
          authoritativeHistoryMatches: true,
          visibleActionControls: spectatorAttackControlStates,
          allActionControlsDisabled: spectatorAttackControlStates.every((control) => control.disabled),
          commandsSubmitted: spectatorCommandFrames.length,
          tabletBounds: spectatorAttackBounds,
          layout: spectatorAttackLayout,
          screenshot: `challenge-full-route-spectator-attack-${date}.png`,
        },
        phoneReentry: {
          status: "passed",
          viewport: ownerViewport,
          commandsSubmitted: spectatorPhoneCommandFrames.length,
          revisionUnchangedAfterConnection: phoneSpectatorAfterReopen.version === phoneSpectatorInitial.version,
          focusReturnedToActionDock: true,
          horizontalOverflow: phoneSpectatorLayout.document > phoneSpectatorLayout.viewport + 1 || phoneSpectatorLayout.body > phoneSpectatorLayout.viewport + 1,
          bounds: phoneSpectatorBounds,
          screenshot: `challenge-full-route-spectator-phone-${date}.png`,
        },
      },
    };
    assert.deepEqual(report.runtimeErrors, [], "the production Challenge route completes without uncaught browser errors");
    report.finished = new Date().toISOString();
    report.status = "passed";
    const artifact = join(artifactDirectory, `challenge-full-route-${date}.json`);
    await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
    await unlink(join(artifactDirectory, `challenge-full-route-${date}-failed.json`)).catch(() => undefined);
    console.log(JSON.stringify({ ...report, artifact }, null, 2));
  } finally {
    await ownerContext.close();
    await spectatorContext.close();
    await spectatorPhoneContext.close();
  }
} catch (error) {
  report.status = "failed";
  report.finished = new Date().toISOString();
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  const artifact = join(artifactDirectory, `challenge-full-route-${date}-failed.json`);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  await stopServer(apiServer);
  await stopServer(webServer);
}
