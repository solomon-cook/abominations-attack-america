import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";
import WebSocket from "ws";
import { chooseBotCommand } from "../packages/game-engine/src/bots.ts";
import { legalMonsterPaths, legalUnitPaths } from "../packages/game-engine/src/index.ts";
import { chromePath } from "./chrome-path.mjs";

const freePort = (avoid = new Set()) => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      probe.close();
      reject(new Error("Could not determine an ephemeral browser-test port."));
      return;
    }
    if (avoid.has(address.port)) {
      probe.close(() => freePort(avoid).then(resolve, reject));
      return;
    }
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const webPort = Number(process.env.BROWSER_ONLINE_WEB_PORT ?? await freePort());
const apiPort = Number(process.env.BROWSER_ONLINE_API_PORT ?? await freePort(new Set([webPort])));
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${webPort}/`;
const apiUrl = process.env.BROWSER_API_URL ?? `http://127.0.0.1:${apiPort}`;
// Room state polling is configured at 30 seconds, so allow a full poll interval plus a small margin.
const waitTimeoutMs = Number(process.env.BROWSER_TEST_WAIT_TIMEOUT_MS ?? 35000);
const ownsWebServer = !process.env.BROWSER_TEST_URL;
const ownsApiServer = !process.env.BROWSER_API_URL;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const apiFetch = async (input, init = {}) => {
  const target = new URL(input);
  if (target.protocol !== "https:") return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set("origin", target.origin);
  const args = ["curl", target.toString(), "--", "-sS", "--write-out", "\n__AAA_HTTP_STATUS__:%{http_code}", "-X", init.method ?? "GET"];
  for (const [name, value] of headers) args.push("-H", `${name}: ${value}`);
  if (init.body !== undefined) args.push("--data", String(init.body));
  const result = spawnSync("vercel", args, { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error("Authenticated Preview API request failed.");
  const marker = result.stdout.lastIndexOf("\n__AAA_HTTP_STATUS__:");
  if (marker < 0) throw new Error("Authenticated Preview API request returned no HTTP status.");
  const status = Number(result.stdout.slice(marker + "\n__AAA_HTTP_STATUS__:".length).trim());
  return new Response(result.stdout.slice(0, marker), { status, headers: { "content-type": headers.get("content-type") ?? "application/json" } });
};

const startServer = ({ command, args, cwd, env, name, ready }) => {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let childFailure;
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.once("error", (error) => { childFailure = error; });
  const waitForReady = async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (childFailure || child.exitCode !== null) {
        throw new Error(`${name} exited before becoming ready. ${childFailure?.message ?? `code ${child.exitCode}`}\n${output}`);
      }
      try {
        if (await ready()) return;
      } catch {
        // The local service is still starting.
      }
      await wait(100);
    }
    throw new Error(`${name} did not become ready.\n${output}`);
  };
  return { child, output: () => output, waitForReady };
};

const stopServer = (server) => new Promise((resolve) => {
  if (!server || server.child.exitCode !== null) {
    resolve();
    return;
  }
  const forceStop = setTimeout(() => {
    server.child.kill("SIGKILL");
    resolve();
  }, 2000);
  server.child.once("exit", () => {
    clearTimeout(forceStop);
    resolve();
  });
  server.child.kill("SIGTERM");
});

async function openBrowser(port, name, existingProfile) {
  const profile = existingProfile ?? await mkdtemp(join(tmpdir(), `abominations-online-${name}-`));
  const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--window-size=1280,720", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let page;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      page = (await response.json()).find((candidate) => candidate.type === "page");
      if (page) break;
    } catch {
      // Chrome is still starting.
    }
    await wait(100);
  }
  if (!page?.webSocketDebuggerUrl) throw new Error(`${name} browser target did not become available.`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let nextId = 0;
  const pending = new Map();
  const networkFailures = [];
  const networkResponses = [];
  const requestDetails = new Map();
  const pageExceptions = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request;
      try { requestDetails.set(message.params.requestId, { method: request.method, path: new URL(request.url).pathname }); } catch { /* Ignore malformed browser request URLs. */ }
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      const request = requestDetails.get(message.params.requestId);
      if (response && request) networkResponses.push({ ...request, status: response.status, vercelId: response.headers?.["x-vercel-id"] ?? null });
      if (networkResponses.length > 40) networkResponses.shift();
    }
    if (message.method === "Network.responseReceived" && Number(message.params?.response?.status) >= 400) {
      networkFailures.push({ status: message.params.response.status, path: new URL(message.params.response.url).pathname, vercelId: message.params.response.headers?.["x-vercel-id"] ?? null });
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageExceptions.push(message.params?.exceptionDetails?.text ?? "Browser page exception");
    }
    if (message.method === "Page.javascriptDialogOpening") {
      void command("Page.handleJavaScriptDialog", { accept: true });
      return;
    }
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${name}: browser command timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  if (process.env.VERCEL_OIDC_TOKEN) {
    await command("Network.setExtraHTTPHeaders", { headers: { "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN } });
  }
  await command("Page.navigate", { url });
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      const description = detail.exception?.description ?? detail.text ?? "page evaluation failed";
      throw new Error(`${name}: browser page evaluation failed: ${description}`);
    }
    return response.result?.value;
  };
  const waitFor = async (expression, label) => {
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await wait(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    const diagnostic = await evaluate(`(() => { let session; try { const saved = JSON.parse(localStorage.getItem("abominations-session") ?? "null"); session = saved ? { hasToken: Boolean(saved.token), roomCode: saved.room?.code ?? null } : null; } catch {} return { url: location.origin + location.pathname, bodyText: document.body.innerText.slice(-900), hasSavedRoomSession: Boolean(session?.hasToken), roomCode: session?.roomCode ?? null, connection: document.querySelector(".connection")?.textContent?.trim(), error: document.querySelector(".error")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), phase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim() }; })()`);
    throw new Error(`${name}: timed out waiting for ${label}: ${JSON.stringify({ ...diagnostic, networkResponses: networkResponses.slice(-20), networkFailures: networkFailures.slice(-12), pageExceptions: pageExceptions.slice(-5) })}`);
  };
  return {
    evaluate,
    waitFor,
    networkResponses,
    setViewport: (width, height) => command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 600 }),
    refresh: () => command("Page.reload", { ignoreCache: true }),
    click: async (label) => {
      const rect = await evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled); if (!button) return null; button.scrollIntoView({ block: "center", inline: "center" }); const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, visible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight }; })()`);
      if (!rect?.visible) return false;
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      return true;
    },
    clickText: async (label) => {
      const rect = await evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.includes(${JSON.stringify(label)}) && !candidate.disabled); if (!button) return null; button.scrollIntoView({ block: "center", inline: "center" }); const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, visible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight }; })()`);
      if (!rect?.visible) return false;
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      return true;
    },
    close: async () => {
      socket.close();
      child.kill("SIGKILL");
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

let webServer;
let apiServer;
let first;
let second;
let spectator;
try {
  if (ownsWebServer) {
    webServer = startServer({
      command: process.execPath,
      args: [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort)],
      cwd: join(process.cwd(), "apps/web"),
      env: { ...process.env, VITE_API_URL: apiUrl },
      name: "Vite",
      ready: () => fetch(url),
    });
    await webServer.waitForReady();
  }
  if (ownsApiServer) {
    apiServer = startServer({
      command: process.execPath,
      args: ["--import", "tsx/esm", "src/server.ts"],
      cwd: join(process.cwd(), "apps/api"),
      env: { ...process.env, NODE_ENV: "test", PORT: String(apiPort), PERSISTENCE: "memory", TEST_ROOM_SEED: "8", DEVELOPMENT_API_RATE_LIMIT: process.env.DEVELOPMENT_API_RATE_LIMIT ?? "1000", ALLOWED_ORIGIN: new URL(url).origin },
      name: "MVP API",
      ready: async () => (await fetch(`${apiUrl}/health`)).ok,
    });
    await apiServer.waitForReady();
  }
  first = await openBrowser(9230, "first");
  second = await openBrowser(9231, "second");
  spectator = await openBrowser(9232, "spectator");
  for (const browser of [first, second, spectator]) {
    await browser.waitFor(`!!document.querySelector('[aria-label="Choose how to play"]')`, "home screen");
    if (!await browser.clickText("Multiplayer")) throw new Error("Browser could not select Multiplayer from the home screen.");
    await browser.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "multiplayer lobby");
    if (!await browser.click("Continue as guest")) throw new Error("Browser could not select Continue as guest.");
  }
  await first.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "first lobby");
  await first.evaluate(`(() => { const input = document.querySelector('[aria-label="Display name"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "First player"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await first.evaluate(`(() => { const select = document.querySelector('[aria-label="Room privacy"]'); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, "private"); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!await first.click("Create")) throw new Error("First browser could not create a room.");
  await first.waitFor(`!!document.querySelector(".lobby strong")`, "created room code");
  const roomCode = await first.evaluate(`document.querySelector(".lobby strong")?.textContent?.trim()`);
  if (!roomCode) throw new Error("Created room did not expose a room code.");
  const startBeforeSecondPlayer = await first.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Start match"); return Boolean(button && !button.disabled); })()`);
  if (startBeforeSecondPlayer) throw new Error("The match start control was enabled before every player seat was filled.");

  await second.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "second lobby");
  await second.evaluate(`(() => { const inputs = document.querySelectorAll('input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "Second player"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); setter.call(inputs[1], ${JSON.stringify(roomCode)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await second.click("Join")) throw new Error("Second browser could not join the created room.");
  await second.waitFor(`!!document.querySelector(".lobby strong")`, "joined room code");

  await first.waitFor(`!!document.querySelector(".pre-match-lobby")`, "first player waiting room");
  await second.waitFor(`!!document.querySelector(".pre-match-lobby")`, "second player waiting room");
  try {
    await first.waitFor(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Start match"); return Boolean(button && !button.disabled); })()`, "start control after all players join");
  } catch (error) {
    const diagnostics = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
      const saved = JSON.parse(localStorage.getItem("abominations-session") ?? "null");
      const code = saved?.room?.code ?? "";
      const response = code && saved?.token ? await fetch(${JSON.stringify(`${apiUrl}/rooms/`)} + code + "/state?token=" + encodeURIComponent(saved.token)) : null;
      const room = response?.ok ? await response.json() : null;
      return { savedRoomCode: code || null, hasToken: Boolean(saved?.token), stateStatus: response?.status ?? null, version: room?.version ?? null, status: room?.status ?? null, matchStarted: room?.matchStarted ?? null, participants: room?.participants?.filter((player) => player.role === "player").map((player) => ({ playerIndex: player.playerIndex, name: player.displayName, connected: player.connected })) ?? null, startButtonDisabled: [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start match")?.disabled ?? null, lobbyText: document.querySelector(".lobby")?.innerText?.trim() ?? "", error: document.querySelector(".error")?.innerText?.trim() ?? "" };
    })()`)));
    throw new Error(`${error.message}; joinDiagnostics=${JSON.stringify(diagnostics)}; firstRequests=${JSON.stringify(first.networkResponses.slice(-12))}; secondRequests=${JSON.stringify(second.networkResponses.slice(-12))}`);
  }
  const beforeStart = await Promise.all([first, second].map((browser) => browser.evaluate(`(() => ({ waiting: Boolean(document.querySelector(".pre-match-lobby")), setupVisible: Boolean(document.querySelector(".setup-panel")), canStart: [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Start match" && !button.disabled) }))()`)));
  if (!beforeStart[0]?.waiting || !beforeStart[1]?.waiting || beforeStart.some((state) => state?.setupVisible || !state?.canStart)) {
    throw new Error(`The room did not remain in its player-controlled waiting room before start: ${JSON.stringify(beforeStart)}`);
  }
  if (!await first.click("Start match")) throw new Error("A player could not start the match from the waiting room.");
  await first.waitFor(`!document.querySelector(".pre-match-lobby") && !!document.querySelector(".setup-panel")`, "first player setup after starting match");
  await second.waitFor(`!document.querySelector(".pre-match-lobby") && !!document.querySelector(".setup-panel")`, "peer setup after host starts match");

  await spectator.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "spectator lobby");
  await spectator.evaluate(`(() => { const inputs = document.querySelectorAll('input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "Spectator"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); setter.call(inputs[1], ${JSON.stringify(roomCode)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await spectator.click("Spectate")) throw new Error("Spectator browser could not join the created room.");
  await spectator.waitFor(`!!document.querySelector(".lobby strong")`, "joined spectator room code");
  await spectator.waitFor(`!!document.querySelector(".setup-panel")`, "spectator setup projection");
  const boardIdentities = await Promise.all([first, second, spectator].map((browser) => browser.evaluate(`(() => { const root = document.querySelector("main.game-screen"); return { id: root?.dataset.boardId ?? "", version: root?.dataset.boardVersion ?? "", hash: root?.dataset.boardContentHash ?? "", renderedId: root?.dataset.renderedBoardId ?? "", renderedHash: root?.dataset.renderedBoardContentHash ?? "" }; })()`)));
  const boardIdentityKeys = boardIdentities.map((identity) => `${identity?.id}:${identity?.version}:${identity?.hash}:${identity?.renderedId}:${identity?.renderedHash}`);
  if (new Set(boardIdentityKeys).size !== 1 || boardIdentities[0]?.id !== "human-audited-north-america" || boardIdentities[0]?.renderedId !== boardIdentities[0]?.id || boardIdentities[0]?.renderedHash !== boardIdentities[0]?.hash) {
    throw new Error(`Online sessions did not share the pinned MVP board identity: ${JSON.stringify(boardIdentities)}`);
  }
  const renderedBoardCells = await Promise.all([first, second, spectator].map((browser) => browser.evaluate(`(() => {
    const cells = [...document.querySelectorAll("main.game-screen .hex-tile")];
    return { count: cells.length, unresolvedLabels: cells.filter((cell) => cell.textContent.includes("Unresolved")).length };
  })()`)));
  if (renderedBoardCells.some((board) => board?.count !== 336 || board.unresolvedLabels !== 0)) {
    throw new Error(`Online sessions did not render the complete 336-cell MVP honeycomb: ${JSON.stringify(renderedBoardCells)}`);
  }
  const spectatorSetupControls = await spectator.evaluate(`(() => [...document.querySelectorAll(".setup-options button")].length > 0 && [...document.querySelectorAll(".setup-options button")].every((button) => button.disabled))()`);
  if (!spectatorSetupControls) throw new Error("Spectator exposed an enabled setup control.");

  let setupClicks = 0;
  let setupWaitDeadline = Date.now() + waitTimeoutMs;
  let nextAuthoritativeSetupCheck = 0;
  for (let attempt = 0; attempt < 10000 && Date.now() < setupWaitDeadline; attempt += 1) {
    if (Date.now() >= nextAuthoritativeSetupCheck) {
      const authoritativeSetup = await first.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
        const room = response.ok ? await response.json() : null;
        const setup = room?.state?.setupState;
        return { status: response.status, phase: setup?.phase, seats: setup?.seats ?? [] };
      })()`);
      nextAuthoritativeSetupCheck = Date.now() + 1000;
      if (authoritativeSetup.status === 200 && authoritativeSetup.phase === "complete" && authoritativeSetup.seats.length > 0 && authoritativeSetup.seats.every((seat) => seat.startingChoice !== undefined)) break;
    }
    let progressed = false;
    for (const browser of [first, second]) {
      const preferStartingDeployment = process.env.BROWSER_ONLINE_CORE_ONLY !== "1";
      const preferredStartingChoice = preferStartingDeployment ? "Deploy starting troops" : "Draw Research";
      const clicked = await browser.evaluate(`(() => {
        const phase = document.querySelector(".setup-panel h2")?.textContent?.trim();
        const normalizedPhase = phase?.toLowerCase();
        if (normalizedPhase === "place unused branches") {
          for (const select of document.querySelectorAll(".unused-branch-placement select")) {
            const option = [...select.options].find((candidate) => candidate.value && !candidate.disabled);
            if (!option) return false;
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const place = [...document.querySelectorAll(".unused-branch-placement button")].find((candidate) => candidate.textContent?.trim() === "Place units and continue");
          if (!place || place.disabled) return false;
          place.click();
          return true;
        }
        if (normalizedPhase === "starting choice" && ${JSON.stringify(preferStartingDeployment)}) {
          const finish = [...document.querySelectorAll(".setup-panel button")].find((candidate) => candidate.textContent?.trim() === "Finish starting deployment" && !candidate.disabled);
          if (finish) { finish.click(); return true; }
          const troop = [...document.querySelectorAll('.military-hand button[aria-label^="Deploy "]')].find((candidate) => !candidate.disabled);
          if (troop) { troop.click(); return true; }
          const location = [...document.querySelectorAll(".hex-tile")].find((candidate) => candidate.getAttribute("aria-label")?.toLowerCase().includes("choose starting location") && !candidate.disabled);
          if (location) { location.click(); return true; }
          const start = [...document.querySelectorAll(".setup-options button")].find((candidate) => candidate.textContent?.trim() === "Deploy starting troops" && !candidate.disabled);
          if (start) { start.click(); return true; }
          return false;
        }
        const buttons = [...document.querySelectorAll(".setup-options button")].filter((candidate) => !candidate.disabled);
        const button = normalizedPhase === "starting choice" ? buttons.find((candidate) => candidate.textContent?.trim().toLowerCase().includes(${JSON.stringify(preferredStartingChoice.toLowerCase())})) : buttons[0];
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (clicked) { setupClicks += 1; progressed = true; setupWaitDeadline = Date.now() + waitTimeoutMs; await wait(120); break; }
    }
    if (!progressed) {
      const complete = await first.evaluate("!document.querySelector('.setup-panel')") && await second.evaluate("!document.querySelector('.setup-panel')");
      if (complete) break;
      if (Date.now() >= setupWaitDeadline) {
        const setupStates = await Promise.all([first, second].map((browser) => browser.evaluate(`(() => ({ phase: document.querySelector(".setup-panel h2")?.textContent?.trim(), prompt: document.querySelector(".deployment-prompt")?.textContent?.trim(), progress: document.querySelector(".setup-progress")?.textContent?.trim(), action: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), buttons: [...document.querySelectorAll(".setup-options button")].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled, title: button.title })) }))()`)));
        throw new Error(`Neither online browser exposed the current setup choice: ${JSON.stringify(setupStates)}`);
      }
      await wait(Math.min(180, Math.max(1, setupWaitDeadline - Date.now())));
    }
  }
  const setupCompletionState = (browser) => browser.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
    const room = response.ok ? await response.json() : undefined;
    const panel = document.querySelector(".setup-panel");
    const seats = room?.state?.setupState?.seats ?? [];
    const setupField = room?.state?.setupState?.phase === "monster-selection" ? "monsterId" : room?.state?.setupState?.phase === "branch-selection" ? "branch" : room?.state?.setupState?.phase === "lair-selection" ? "lair" : "startingChoice";
    const turnSeat = seats.find((seat) => seat[setupField] === undefined);
    const ownParticipant = room?.participants?.find((player) => player.id === session.participantId);
    return { status: response.status, participantIdMatches: Boolean(ownParticipant), ownPlayerIndex: ownParticipant?.playerIndex, ownRole: ownParticipant?.role, version: room?.version, roomStatus: room?.status, matchStarted: room?.matchStarted, phase: room?.state?.phase, setupPhase: room?.state?.setupState?.phase, setupComplete: Boolean(room?.state?.setupState && room.state.setupState.phase === "complete" && seats.length > 0 && seats.every((seat) => seat.startingChoice !== undefined)), setupSeat: turnSeat?.playerIndex, setupSeats: seats.map((seat) => ({ playerIndex: seat.playerIndex, monsterId: seat.monsterId, branch: seat.branch, hasStartingChoice: seat.startingChoice !== undefined })), participants: room?.participants?.map((player) => ({ playerIndex: player.playerIndex, role: player.role, connected: player.connected, name: player.displayName })), setupApplied: room?.state?.setupApplied, panel: panel ? { heading: panel.querySelector("h2")?.textContent?.trim(), turn: panel.querySelector(".setup-turn")?.textContent?.trim(), buttons: [...panel.querySelectorAll(".setup-options button")].map((button) => ({ label: button.textContent.trim(), disabled: button.disabled })), text: panel.innerText.slice(0, 180), visible: panel.getClientRects().length > 0 } : null };
  })()`);
  const setupDiagnostics = await Promise.all([first, second].map(async (browser) => {
    try {
      return await setupCompletionState(browser);
    } catch (error) {
      return { evaluationError: error instanceof Error ? error.message : String(error), recentResponses: browser.networkResponses.slice(-10) };
    }
  }));
  if (setupDiagnostics.some((state) => state.status !== 200 || !state.setupComplete)) {
    const requests = { first: first.networkResponses.slice(-25), second: second.networkResponses.slice(-25) };
    throw new Error(`The authoritative server did not report completed setup in both player sessions for room ${roomCode}: ${JSON.stringify({ setupDiagnostics, requests })}`);
  }
  await first.waitFor("!document.querySelector('.setup-panel')", "first setup completion");
  await second.waitFor("!document.querySelector('.setup-panel')", "second setup completion");
  if (!await first.click("Ready") || !await second.click("Ready")) throw new Error("Both players did not expose Ready controls.");
  await first.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move" || Boolean(document.querySelector(".giant-placement-choice"))`, "Move or starting giant-placement decision");
  let startingGiantPlacement = "not-required";
  let startingGiantPlacementRefresh = "not-needed";
  const startupRoom = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
    return response.ok ? await response.json() : { error: response.status };
  })()`);
  let startingGiantPlacements = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentStartupRoom = await first.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
      return response.ok ? await response.json() : { error: response.status };
    })()`);
    if (currentStartupRoom.state?.pendingDecision?.type !== "giant-placement") break;
    const decisionOwner = currentStartupRoom.state.pendingDecision.playerIndex;
    const ownerParticipant = currentStartupRoom.participants?.find((participant) => participant.role === "player" && participant.playerIndex === decisionOwner);
    if (!ownerParticipant) throw new Error(`Starting giant placement has no player participant for decision owner ${decisionOwner}.`);
    const ownerBrowser = await first.evaluate(`JSON.parse(localStorage.getItem("abominations-session") ?? "{}").participantId`) === ownerParticipant.id ? first : second;
    const giantChoicesMounted = await ownerBrowser.evaluate(`document.querySelectorAll(".giant-placement-options button").length > 0`);
    if (!giantChoicesMounted) {
      await ownerBrowser.evaluate("location.reload()");
      startingGiantPlacementRefresh = "recovered-after-player-refresh";
    }
    await ownerBrowser.waitFor(`document.querySelectorAll(".giant-placement-options button").length > 0`, "starting giant base options");
    const giantChoiceState = await ownerBrowser.evaluate(`(() => ({ prompt: document.querySelector(".giant-placement-choice")?.innerText, participantId: JSON.parse(localStorage.getItem("abominations-session") ?? "{}").participantId, buttons: [...document.querySelectorAll(".giant-placement-options button")].map((button) => ({ label: button.textContent?.trim(), disabled: button.disabled, title: button.title })) }))()`);
    if (!giantChoiceState.buttons.some((button) => !button.disabled)) throw new Error(`The giant-placement owner has no enabled base choice: ${JSON.stringify({ decisionOwner, ownerId: ownerParticipant.id, giantChoiceState })}`);
    if (!await ownerBrowser.evaluate(`(() => { const button = document.querySelector(".giant-placement-options button:not(:disabled)"); if (!button) return false; button.click(); return true; })()`)) throw new Error("The owner could not choose a legal starting giant base.");
    await first.waitFor(`(async () => { const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}"); const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "")); const room = response.ok ? await response.json() : undefined; return (room?.version ?? 0) > ${Number(currentStartupRoom.version)}; })()`, "starting giant placement commit");
    startingGiantPlacements += 1;
  }
  const resolvedStartupRoom = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
    return response.ok ? await response.json() : { error: response.status };
  })()`);
  if (resolvedStartupRoom.state?.pendingDecision?.type === "giant-placement") throw new Error(`Starting Research granted more than the supported four queued giant placements: ${JSON.stringify(resolvedStartupRoom.state.pendingDecision)}.`);
  if (startingGiantPlacements > 0) startingGiantPlacement = "resolved-by-owner-ui";
  await first.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "first Move phase");
  await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "second Move phase");
  await spectator.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "spectator Move projection");
  for (const [browser, targetPlayer, label] of [[first, "Player 2", "online opponent"], [spectator, "Player 1", "spectator player"]]) {
    const clickedPortrait = await browser.evaluate(`(() => { const button = [...document.querySelectorAll(".opponent-player-card")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(${JSON.stringify(targetPlayer)})); if (!button) return false; button.click(); return true; })()`);
    if (!clickedPortrait) {
      const diagnostic = await browser.evaluate(`(() => ({ phase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), players: [...document.querySelectorAll(".opponent-player-card")].map((button) => button.getAttribute("aria-label")), setupInProgress: document.querySelector(".game-screen")?.classList.contains("setup-in-progress"), visibleText: document.querySelector(".game-screen")?.innerText?.slice(0, 500) }))()`);
      throw new Error(`${label} portrait was missing: ${JSON.stringify(diagnostic)}.`);
    }
    await browser.waitFor(`!!document.querySelector("#player-public-status")`, `${label} public status`);
    const opened = await browser.evaluate(`document.querySelector("#player-public-status")?.textContent ?? ""`);
    if (!String(opened).toLowerCase().includes(targetPlayer.toLowerCase()) || !/\d+\/\d+/.test(String(opened)) || !/★\s*\d+/.test(String(opened))) throw new Error(`${label} portrait did not expose public health, infamy, and position: ${JSON.stringify(opened)}.`);
  }
  const spectatorMoveControls = await spectator.evaluate(`(() => {
    const actionButtons = [...document.querySelectorAll(".action-card button, .action-dock button:not(.action-dock-secondary)")];
    const legalTiles = [...document.querySelectorAll(".hex-tile.legal")];
    return [
      Boolean(document.querySelector(".lobby")?.textContent?.includes("spectating")),
      actionButtons.filter((button) => !button.disabled).length,
      legalTiles.filter((tile) => !tile.disabled).length,
      actionButtons.filter((button) => !button.disabled).map((button) => button.textContent.trim()).join("|")
    ].join(",");
  })()`);
  const [spectating, enabledActionCount, enabledLegalTileCount, enabledActionLabels] = String(spectatorMoveControls ?? "false,99,99,unknown").split(",");
  if (spectating !== "true" || Number(enabledActionCount) > 0 || Number(enabledLegalTileCount) > 0) throw new Error(`enabled spectator action: count=${enabledActionCount}, legalTiles=${enabledLegalTileCount}, labels=${enabledActionLabels}`);
  const savedSession = await first.evaluate(`localStorage.getItem("abominations-session")`);
  if (!savedSession) throw new Error("First browser did not expose its persisted room session before refresh.");
  const disconnectState = "page-refresh";
  await first.refresh();
  await first.waitFor(`!!document.querySelector(".lobby strong")`, "first browser room restore after refresh");
  if (!await first.evaluate(`localStorage.getItem("abominations-session")`)) throw new Error("First browser lost its persisted room session during refresh.");
  await first.waitFor(`document.querySelector(".connection")?.textContent?.trim() === "online"`, "first browser reconnect state");
  await first.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "first browser recovered Move state");
  const forgedCommand = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch("${apiUrl}/rooms/${roomCode}/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
      body: JSON.stringify({ envelope: { actionId: crypto.randomUUID(), actorId: "forged-browser-actor", expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" } } }),
    });
    return { status: response.status, body: await response.json() };
  })()`);
  if (forgedCommand.status !== 400 || await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() !== "Move"`)) throw new Error(`Forged browser command was not rejected without changing Move: ${JSON.stringify(forgedCommand)}`);
  const malformedCommand = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch("${apiUrl}/rooms/${roomCode}/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
      body: "{ malformed browser payload",
    });
    return { status: response.status, body: await response.json() };
  })()`);
  if (malformedCommand.status !== 400 || await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() !== "Move"`)) throw new Error(`Malformed browser command was not rejected without changing Move: ${JSON.stringify(malformedCommand)}`);
  await second.evaluate("location.reload()");
  await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "reloaded second Move phase");
  if (process.env.BROWSER_ONLINE_CORE_ONLY === "1") {
    const browserSessions = await Promise.all([first, second].map((browser) => browser.evaluate(`JSON.parse(localStorage.getItem("abominations-session") ?? "{}")`)));
    const readCoreRoom = async (session) => {
      const response = await apiFetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`);
      return response.ok ? response.json() : { status: response.status, body: await response.text() };
    };
    for (const session of browserSessions) {
      const readyResponse = await apiFetch(`${apiUrl}/rooms/${roomCode}/ready`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": session.token ?? "" }, body: JSON.stringify({ ready: true }) });
      if (!readyResponse.ok) throw new Error(`Production did not accept player readiness in room ${roomCode} (${readyResponse.status}): ${await readyResponse.text()}`);
    }
    let coreRoom = await readCoreRoom(browserSessions[0]);
    if (coreRoom.status !== "active" || coreRoom.participants.filter((player) => player.role === "player").length !== 2 || coreRoom.participants.some((player) => player.role === "player" && !player.ready)) throw new Error(`Production room was not active after both authenticated players readied: ${JSON.stringify({ roomCode, status: coreRoom.status, participants: coreRoom.participants.map(({ role, playerIndex, ready }) => ({ role, playerIndex, ready })) })}`);
    const resolvedGiantPlacements = [];
    while (coreRoom.state?.pendingGiantPlacements?.length) {
      const placementOwner = coreRoom.state.pendingGiantPlacements[0].playerIndex;
      const placementSession = browserSessions.find((session) => session.participantId === coreRoom.participants.find((player) => player.role === "player" && player.playerIndex === placementOwner)?.id);
      const placement = chooseBotCommand(coreRoom.state, new Set([placementOwner]));
      if (!placementSession?.token || placement?.type !== "place-giant") throw new Error(`No legal browser-session giant placement was available for player ${placementOwner + 1}.`);
      const placementParticipant = coreRoom.participants.find((player) => player.role === "player" && player.playerIndex === placementOwner);
      const placementResponse = await apiFetch(`${apiUrl}/rooms/${roomCode}/actions`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": placementSession.token }, body: JSON.stringify({ envelope: { actionId: randomUUID(), actorId: placementParticipant.id, expectedRevision: coreRoom.version, protocolVersion: 1, command: placement } }) });
      if (!placementResponse.ok) throw new Error(`Production rejected the legal immediate giant placement (${placementResponse.status}): ${await placementResponse.text()}`);
      resolvedGiantPlacements.push(placement.destination);
      coreRoom = await readCoreRoom(placementSession);
    }
    if (coreRoom.state?.phase !== "move") throw new Error(`Expected Move after resolving required giant placements, got ${coreRoom.state?.phase ?? "unknown"}.`);
    const activePlayer = coreRoom.state?.currentPlayer;
    const monster = coreRoom.state?.monsters?.[activePlayer];
    const path = monster ? legalMonsterPaths(coreRoom.state, monster.id)[0] : undefined;
    if (!path) throw new Error(`No engine-legal monster move was available for the active Production player in room ${roomCode}.`);
    const actorSession = browserSessions.find((session) => session.participantId === coreRoom.participants.find((player) => player.role === "player" && player.playerIndex === activePlayer)?.id);
    const actorBrowser = actorSession === browserSessions[0] ? first : second;
    const peerBrowser = actorBrowser === first ? second : first;
    if (!actorSession?.token) throw new Error(`Could not find the active player's browser session for Production room ${roomCode}.`);
    const actorId = coreRoom.participants.find((player) => player.role === "player" && player.playerIndex === activePlayer)?.id;
    const actionResponse = await apiFetch(`${apiUrl}/rooms/${roomCode}/actions`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": actorSession.token }, body: JSON.stringify({ envelope: { actionId: randomUUID(), actorId, expectedRevision: coreRoom.version, protocolVersion: 1, command: { type: "move", path } } }) });
    if (!actionResponse.ok) throw new Error(`Production rejected the legal browser-session move (${actionResponse.status}): ${await actionResponse.text()}`);
    const acceptedRoom = await actionResponse.json();
    const readAuthoritative = (browser) => browser.evaluate(`(async () => { const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}"); const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "")); const room = response.ok ? await response.json() : null; return { status: response.status, version: room?.version, phase: room?.state?.phase, currentPlayer: room?.state?.currentPlayer, pendingDecision: room?.state?.pendingDecision, monsterLocation: room?.state?.monsters?.[${activePlayer}]?.location, movedPieceIds: room?.state?.movedPieceIds }; })()`);
    const peerState = await readCoreRoom(browserSessions[actorSession === browserSessions[0] ? 1 : 0]);
    const peerStateProjection = { version: peerState.version, phase: peerState.state?.phase, currentPlayer: peerState.state?.currentPlayer, pendingDecision: peerState.state?.pendingDecision, monsterLocation: peerState.state?.monsters?.[activePlayer]?.location };
    const expectedLocation = acceptedRoom.state?.monsters?.[activePlayer]?.location;
    if (peerState.version !== acceptedRoom.version || peerStateProjection.monsterLocation !== expectedLocation || peerStateProjection.phase !== acceptedRoom.state?.phase || peerStateProjection.currentPlayer !== acceptedRoom.state?.currentPlayer || JSON.stringify(peerStateProjection.pendingDecision) !== JSON.stringify(acceptedRoom.state?.pendingDecision)) throw new Error(`Peer browser did not observe the accepted Production move: ${JSON.stringify({ roomCode, acceptedVersion: acceptedRoom.version, expectedLocation, peerState: peerStateProjection })}`);
    await actorBrowser.refresh();
    await actorBrowser.waitFor(`!!document.querySelector(".lobby strong")`, "active player room restore after move refresh");
    const expectedPhaseHeading = typeof acceptedRoom.state?.phase === "string" ? acceptedRoom.state.phase[0].toUpperCase() + acceptedRoom.state.phase.slice(1) : "";
    await actorBrowser.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === ${JSON.stringify(expectedPhaseHeading)}`, "active player phase restore after move refresh");
    const restoredRoom = await readCoreRoom(actorSession);
    const restoredState = { version: restoredRoom.version, phase: restoredRoom.state?.phase, currentPlayer: restoredRoom.state?.currentPlayer, pendingDecision: restoredRoom.state?.pendingDecision, monsterLocation: restoredRoom.state?.monsters?.[activePlayer]?.location };
    if (restoredState.version !== acceptedRoom.version || restoredState.monsterLocation !== expectedLocation || restoredState.phase !== peerStateProjection.phase || restoredState.currentPlayer !== peerStateProjection.currentPlayer || JSON.stringify(restoredState.pendingDecision) !== JSON.stringify(peerStateProjection.pendingDecision)) throw new Error(`Production refresh did not restore the accepted move: ${JSON.stringify({ roomCode, acceptedVersion: acceptedRoom.version, expectedLocation, restoredState, peerState: peerStateProjection })}`);
    console.log(JSON.stringify({ ok: true, url, roomCode, waitingRoomStart: "verified", setupActions: setupClicks, setup: "verified", resolvedGiantPlacements, legalMove: { actorPlayer: activePlayer, path, acceptedVersion: acceptedRoom.version, destination: expectedLocation }, peerObservedSameState: true, refreshReconnect: "verified", synchronizedState: { version: acceptedRoom.version, phase: peerStateProjection.phase, currentPlayer: peerStateProjection.currentPlayer, monsterLocation: expectedLocation } }));
    await Promise.all([first?.close(), second?.close(), spectator?.close()]);
    first = second = spectator = undefined;
    await Promise.all([stopServer(apiServer), stopServer(webServer)]);
    apiServer = webServer = undefined;
    process.exit(0);
  }
  const liveStackRoom = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    return await (await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""))).json();
  })()`);
  const liveStackState = liveStackRoom.state;
  const liveStackPlayer = liveStackState?.currentPlayer;
  const liveStackMonster = liveStackState?.monsters?.[liveStackPlayer];
  if (!liveStackMonster || liveStackState.phase !== "move") throw new Error("The online stack fixture did not start in the active player's Move phase.");
  const liveMonsterDestinations = new Set(legalMonsterPaths(liveStackState, liveStackMonster.id).map((path) => path.at(-1)));
  const occupiedByPieces = new Set([
    ...liveStackState.monsters.map((monster) => monster.location),
    ...liveStackState.units.filter((unit) => typeof unit.location === "string" && unit.location.includes(",")).map((unit) => unit.location),
  ]);
  const reachableUnitDestinations = liveStackState.units
    .filter((unit) => unit.ownerPlayer === liveStackPlayer && typeof unit.location === "string" && unit.location.includes(",") && unit.move > 0)
    .map((unit) => {
      const paths = legalUnitPaths(liveStackState, unit.id).sort((a, b) => a.length - b.length);
      const destinations = new Map();
      for (const path of paths) {
        const destination = path.at(-1);
        if (!occupiedByPieces.has(destination) && !destinations.has(destination)) destinations.set(destination, path);
      }
      return { unit, destinations };
    });
  const unitsByDestination = new Map();
  for (const entry of reachableUnitDestinations) {
    for (const destination of entry.destinations.keys()) {
      const units = unitsByDestination.get(destination) ?? [];
      units.push(entry);
      unitsByDestination.set(destination, units);
    }
  }
  const liveStackPlan = [...unitsByDestination.entries()]
    .filter(([, units]) => units.length >= 4)
    .map(([destination, units]) => ({
      destination,
      units: units.slice(0, 5),
      monsterCanJoin: liveMonsterDestinations.has(destination),
    }))
    .sort((a, b) => (b.units.length + Number(b.monsterCanJoin)) - (a.units.length + Number(a.monsterCanJoin))
      || b.units.length - a.units.length
      || a.units.reduce((sum, entry) => sum + entry.destinations.get(a.destination).length, 0)
        - b.units.reduce((sum, entry) => sum + entry.destinations.get(b.destination).length, 0))[0];
  if (!liveStackPlan) throw new Error(`Could not find a legal shared destination for four or more live owned units on the audited board: ${JSON.stringify({ player: liveStackPlayer, monster: liveStackMonster.location, unitStarts: reachableUnitDestinations.map(({ unit }) => ({ id: unit.id, location: unit.location })) })}`);
  const playerSession = await first.evaluate(`JSON.parse(localStorage.getItem("abominations-session") ?? "{}")`);
  const roomParticipant = liveStackRoom.participants?.find((candidate) => candidate.role === "player" && candidate.playerIndex === liveStackPlayer && candidate.id === playerSession.participantId);
  if (!roomParticipant) throw new Error("Could not identify the authenticated seat for the live dense-stack setup.");
  for (const { unit, destinations } of liveStackPlan.units) {
    const currentRoom = await (await apiFetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(playerSession.token ?? "")}`)).json();
    const path = destinations.get(liveStackPlan.destination);
    const response = await apiFetch(`${apiUrl}/rooms/${roomCode}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": playerSession.token ?? "" },
      body: JSON.stringify({ envelope: { actionId: randomUUID(), actorId: roomParticipant.id, expectedRevision: currentRoom.version, protocolVersion: 1, command: { type: "move-unit", unitId: unit.id, path } } }),
    });
    if (!response.ok) throw new Error(`A legal unit movement for dense-stack verification failed (${response.status}): ${await response.text()}`);
  }
  const liveStackAfterMoves = await (await apiFetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(playerSession.token ?? "")}`)).json();
  const stackedUnits = liveStackAfterMoves.state.units.filter((unit) => unit.location === liveStackPlan.destination);
  if (stackedUnits.length !== liveStackPlan.units.length || !stackedUnits.every((unit) => liveStackPlan.units.some((planned) => planned.unit.id === unit.id))) throw new Error(`The online room did not retain each accepted move in the same live stack: ${JSON.stringify({ destination: liveStackPlan.destination, planned: liveStackPlan.units.map((entry) => entry.unit.id), actual: stackedUnits.map((unit) => unit.id) })}`);
  await first.waitFor(`Number(document.querySelector('.hex-tile[data-hex-key="${liveStackPlan.destination}"]')?.dataset.stackCount ?? 0) === ${liveStackPlan.units.length}`, `live ${liveStackPlan.units.length}-unit gameplay stack artwork`);
  const openedLiveStack = await first.evaluate(`(() => {
    const tile = document.querySelector('.hex-tile[data-hex-key="${liveStackPlan.destination}"]');
    if (!tile) return false;
    tile.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    return true;
  })()`);
  if (!openedLiveStack) throw new Error("The live unit stack did not expose its board inspection control.");
  await first.waitFor(`Boolean(document.querySelector(".board-stack-inspector .stack-details"))`, "live gameplay stack details");
  const inspectedLiveGameplayStack = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""))).json();
    const tile = document.querySelector('.hex-tile[data-hex-key="${liveStackPlan.destination}"]');
    const pieces = [...(tile?.querySelector(".tile-occupants")?.querySelectorAll(".tile-occupant") ?? [])];
    const details = document.querySelector(".board-stack-inspector .stack-details");
    const labels = [...(details?.querySelectorAll(":scope > div > span") ?? [])].map((node) => node.textContent?.trim() ?? "");
    const status = [...(details?.querySelectorAll(":scope > div > small") ?? [])].map((node) => node.textContent?.trim() ?? "");
    const revision = room.version;
    return { revision, expectedRevision: ${Number(liveStackAfterMoves.version)}, count: pieces.length, labels, status, unchangedRevision: revision === ${Number(liveStackAfterMoves.version)} };
  })()`);
  if (inspectedLiveGameplayStack.count !== liveStackPlan.units.length || inspectedLiveGameplayStack.labels.length !== liveStackPlan.units.length || !inspectedLiveGameplayStack.labels.every((label) => /your unit/i.test(label)) || !inspectedLiveGameplayStack.status.some((status) => /(Army|Navy|Air Force|Marines) · Player \d+ · \d+ Health · (available|moved)/i.test(status)) || !inspectedLiveGameplayStack.unchangedRevision) {
    throw new Error(`The live gameplay stack could not be inspected without losing ownership or movement status: ${JSON.stringify(inspectedLiveGameplayStack)}`);
  }
  await first.waitFor(`document.querySelectorAll(".hex-tile.legal:not(:disabled)").length > 0`, "online legal movement destination");
  if (!await first.evaluate(`(() => { const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")]; const stackDestination = ${JSON.stringify(liveStackPlan.destination)}; const monsterCanJoin = ${JSON.stringify(liveStackPlan.monsterCanJoin)}; const diceCities = new Set(["1,5", "2,7", "3,-1", "5,6", "12,3", "12,5", "13,-3", "15,-3", "15,-1", "17,-4", "17,0", "18,-5", "18,-4", "18,2", "19,-4", "20,2", "21,-8", "21,-6", "21,-5"]); const tile = (monsterCanJoin && tiles.find((candidate) => candidate.dataset.hexKey === stackDestination)) ?? tiles.find((candidate) => candidate.querySelector(".tile-piece")) ?? tiles.find((candidate) => diceCities.has(candidate.dataset.hexKey)) ?? tiles.find((candidate) => candidate.getAttribute("aria-label")?.includes("infamy-site")) ?? tiles.find((candidate) => !candidate.getAttribute("aria-label")?.includes("military-base")) ?? tiles.find((candidate) => candidate.querySelector('img[alt^="Navy "]')) ?? tiles[0]; tile?.click(); return Boolean(tile); })()`)) throw new Error("First browser could not select an online legal destination.");
  await first.waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm move")`, "online path confirmation");
  if (!await first.click("Confirm move")) throw new Error("First browser could not confirm the online path.");
  await first.waitFor(`!!document.querySelector(".end-movement:not(:disabled)")`, "online movement completion control");
  if (!await first.evaluate(`(() => { const button = document.querySelector(".end-movement:not(:disabled)"); if (!button) return false; button.click(); return true; })()`)) throw new Error("First browser could not end online movement.");
  await first.waitFor(`(() => { const phase = document.querySelector(".turn-hud-heading h2")?.textContent?.trim(); return phase !== "Move" && phase !== "Waiting for server…"; })()`, "first settled post-move phase");
  const nextPhase = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() !== "Move"`, "second post-move phase");
  const secondPhase = await second.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
  if (secondPhase !== nextPhase) throw new Error(`Online phase divergence after movement: first=${nextPhase ?? "unknown"}, second=${secondPhase ?? "unknown"}.`);
  await spectator.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === ${JSON.stringify(nextPhase)}`, "spectator synchronized post-move phase");
  await first.evaluate("new Promise((resolve) => setTimeout(resolve, 800))");
  const liveMixedStackAfterMonster = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const room = await (await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""))).json();
    const pieces = [
      ...room.state.monsters.filter((monster) => monster.location === ${JSON.stringify(liveStackPlan.destination)}),
      ...room.state.units.filter((unit) => unit.location === ${JSON.stringify(liveStackPlan.destination)}),
    ];
    const tile = document.querySelector('.hex-tile[data-hex-key="${liveStackPlan.destination}"]');
    const face = tile?.getBoundingClientRect();
    const art = [...(tile?.querySelector(".tile-occupants")?.querySelectorAll(".tile-occupant") ?? [])].map((element) => element.getBoundingClientRect());
    const contained = Boolean(face && art.length === pieces.length && art.every((piece) => piece.left >= face.left && piece.right <= face.right && piece.top >= face.top && piece.bottom <= face.bottom));
    const noOverlap = art.every((a, index) => art.slice(index + 1).every((b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
    return { count: pieces.length, expectedAtLeast: ${liveStackPlan.units.length + Number(liveStackPlan.monsterCanJoin)}, monsters: pieces.filter((piece) => "name" in piece && "health" in piece).length, units: pieces.filter((piece) => "unitTypeId" in piece).length, contained, noOverlap, location: ${JSON.stringify(liveStackPlan.destination)} };
  })()`);
  if (liveStackPlan.monsterCanJoin && (liveMixedStackAfterMonster.count < liveMixedStackAfterMonster.expectedAtLeast || !liveMixedStackAfterMonster.contained || !liveMixedStackAfterMonster.noOverlap)) {
    throw new Error(`The larger live monster/unit stack failed its authoritative count or geometry check: ${JSON.stringify(liveMixedStackAfterMonster)}.`);
  }
  let onlineFight = "not-reached";
  const liveGameplayStackEvidence = {
    destination: liveStackPlan.destination,
    unitCount: inspectedLiveGameplayStack.count,
    unitDetailCount: inspectedLiveGameplayStack.labels.length,
    monsterCanJoin: liveStackPlan.monsterCanJoin,
    mixedStackAfterMonster: liveMixedStackAfterMonster,
    roomRevisionUnchangedDuringInspection: inspectedLiveGameplayStack.unchangedRevision,
  };
  let stackInspection = "not-reached";
  let stackArtworkGeometry = null;
  if (nextPhase === "Fight") {
    onlineFight = "verified";
    // Let the accepted-move emphasis settle before measuring steady-state art bounds.
    await first.evaluate("new Promise((resolve) => setTimeout(resolve, 800))");
    const pendingBattleStack = await first.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
      const room = await (await fetch(endpoint)).json();
      const battle = room.state.pendingBattles?.[0];
      const hex = battle && [...document.querySelectorAll(".hex-tile")].find((candidate) => candidate.dataset.hexKey === battle.location);
      if (!battle || !hex) return { error: "pending battle location is not rendered", revision: room.version };
      const pieces = Number(hex.dataset.stackCount ?? 0);
      const occupants = [...(hex.querySelector(".tile-occupants")?.querySelectorAll(".tile-occupant") ?? [])];
      const face = hex.getBoundingClientRect();
      const boxes = occupants.map((piece) => piece.getBoundingClientRect());
      const noOverlap = boxes.every((a, index) => boxes.slice(index + 1).every((b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
      const contained = boxes.every((box) => box.left >= face.left && box.right <= face.right && box.top >= face.top && box.bottom <= face.bottom);
      hex.click();
      return { location: battle.location, pieces, revision: room.version, renderedPieceArt: occupants.length, artNoOverlap: noOverlap, artContained: contained, artBoxes: boxes.map(({ left, top, right, bottom }) => ({ left, top, right, bottom })) };
    })()`);
    if (!pendingBattleStack || pendingBattleStack.error || pendingBattleStack.pieces < 2 || pendingBattleStack.renderedPieceArt !== pendingBattleStack.pieces || !pendingBattleStack.artNoOverlap || !pendingBattleStack.artContained) throw new Error(`Online stack layout failed: pieces=${pendingBattleStack?.pieces}, artwork=${pendingBattleStack?.renderedPieceArt}, noOverlap=${pendingBattleStack?.artNoOverlap}, contained=${pendingBattleStack?.artContained}.`);
    await first.waitFor(`Boolean(document.querySelector(".board-stack-inspector .stack-details") && document.querySelector('.board-stack-inspector .stack-location-list button[aria-pressed="true"]'))`, "visible selected battle stack inspector");
    const inspectedStack = await first.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
      const room = await (await fetch(endpoint)).json();
      const tray = document.querySelector(".board-stack-inspector");
      const details = tray?.querySelector(".stack-details");
      const selected = tray?.querySelector('.stack-location-list button[aria-pressed="true"]');
      const map = document.querySelector(".board-viewport");
      const action = document.querySelector(".board-action-bar");
      const controls = document.querySelector(".map-controls");
      const rect = (element) => element?.getBoundingClientRect();
      const trayRect = rect(tray), mapRect = rect(map), actionRect = rect(action), controlsRect = rect(controls);
      const visible = Boolean(tray && getComputedStyle(tray).display !== "none" && getComputedStyle(tray).visibility !== "hidden" && trayRect?.width > 0 && trayRect?.height > 0 && tray.getClientRects().length);
      const insideMap = Boolean(visible && mapRect && trayRect.left >= mapRect.left && trayRect.top >= mapRect.top && trayRect.right <= mapRect.right && trayRect.bottom <= mapRect.bottom);
      const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      return {
        labels: [...(details?.querySelectorAll(":scope > div > span") ?? [])].map((node) => node.textContent?.trim() ?? ""),
        status: [...(details?.querySelectorAll(":scope > div > small") ?? [])].map((node) => node.textContent?.trim() ?? ""),
        itemCount: details?.querySelectorAll(":scope > div").length ?? 0,
        selected: selected?.textContent?.trim() ?? "",
        visible,
        insideMap,
        avoidsActionDock: !overlaps(trayRect, actionRect),
        avoidsMapControls: !overlaps(trayRect, controlsRect),
        unchangedRevision: room.version === ${Number(pendingBattleStack.revision)},
      };
    })()`);
    const stackResponsive = [];
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [768, 1024]]) {
      await first.setViewport(width, height);
      await first.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      stackResponsive.push(await first.evaluate(`(() => {
        const tray = document.querySelector(".board-stack-inspector");
        const map = document.querySelector(".board-viewport");
        const action = document.querySelector(".board-action-bar");
        const controls = document.querySelector(".map-controls");
        const rect = (element) => element?.getBoundingClientRect();
        const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
        const t = rect(tray), m = rect(map);
        const stackHex = [...document.querySelectorAll(".hex-tile")].find((candidate) => candidate.dataset.hexKey === ${JSON.stringify(pendingBattleStack.location)});
        const stackFace = rect(stackHex);
        const stackPieces = [...(stackHex?.querySelector(".tile-occupants")?.querySelectorAll(".tile-occupant") ?? [])].map(rect);
        const stackNoOverlap = stackPieces.every((a, index) => stackPieces.slice(index + 1).every((b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
        const stackContained = Boolean(stackFace && stackPieces.length === ${Number(pendingBattleStack.pieces)} && stackPieces.every((piece) => piece.left >= stackFace.left && piece.right <= stackFace.right && piece.top >= stackFace.top && piece.bottom <= stackFace.bottom));
        const visible = Boolean(tray && getComputedStyle(tray).display !== "none" && getComputedStyle(tray).visibility !== "hidden" && t?.width > 0 && t?.height > 0 && tray.getClientRects().length);
        return { width: innerWidth, height: innerHeight, visible, insideMap: Boolean(visible && m && t.left >= m.left && t.top >= m.top && t.right <= m.right && t.bottom <= m.bottom), avoidsActionDock: !overlaps(t, rect(action)), avoidsMapControls: !overlaps(t, rect(controls)), boardVisible: Boolean(map?.getClientRects().length && m?.width > 0 && m?.height > 0), gameplayStackContained: stackContained, gameplayStackNoOverlap: stackNoOverlap, gameplayStackRects: stackPieces.map(({left, top, right, bottom}) => ({left,top,right,bottom})) };
      })()`));
    }
    await first.setViewport(1280, 720);
    if (inspectedStack.itemCount !== pendingBattleStack.pieces || !inspectedStack.unchangedRevision
      || !inspectedStack.visible || !inspectedStack.insideMap || !inspectedStack.avoidsActionDock || !inspectedStack.avoidsMapControls
      || !inspectedStack.labels.some((label) => /monster/i.test(label))
      || !inspectedStack.labels.some((label) => /unit/i.test(label))
      || !inspectedStack.status.some((status) => /(Army|Navy|Air Force|Marines) · Player \d+ · \d+ Health · (available|moved)/i.test(status))) {
      throw new Error(`The online stack inspector did not describe every piece without changing match state: ${JSON.stringify({ pendingBattleStack, inspectedStack })}`);
    }
    if (stackResponsive.some((view) => !view.visible || !view.insideMap || !view.avoidsActionDock || !view.avoidsMapControls || !view.boardVisible || !view.gameplayStackContained || !view.gameplayStackNoOverlap)) {
      console.log(`STACK_RESPONSIVE_DIAGNOSTIC ${JSON.stringify(stackResponsive)}`);
      throw new Error(`The online stack inspector failed supported viewport checks: ${JSON.stringify(stackResponsive)}`);
    }
    stackInspection = `${inspectedStack.itemCount}-piece-visible-battle-stack-artwork-contained-no-overlap-inspected-no-state-change-${stackResponsive.length}-viewports`;
    stackArtworkGeometry = { measuredPieceCount: pendingBattleStack.pieces, settledBeforeMeasurement: true, initiallyContained: pendingBattleStack.artContained, initiallyNoOverlap: pendingBattleStack.artNoOverlap, responsive: stackResponsive.map(({ width, height, gameplayStackContained, gameplayStackNoOverlap }) => ({ width, height, contained: gameplayStackContained, noOverlap: gameplayStackNoOverlap })) };
    for (let fightStep = 0; fightStep < 32; fightStep += 1) {
      const currentFightPhase = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
      if (currentFightPhase !== "Fight") break;
      let fightAction = false;
      for (const browser of [first, second]) {
        fightAction = await browser.evaluate(`(() => {
          const buttons = [...document.querySelectorAll("button")].filter((button) => !button.disabled);
          const preferred = buttons.find((button) => /^Target this (unit|monster) · roll$/.test(button.textContent.trim()))
            ?? buttons.find((button) => /^Continue attack against /.test(button.getAttribute("aria-label") ?? ""))
            ?? buttons.find((button) => /^Attack /.test(button.textContent.trim()))
            ?? buttons.find((button) => /^(Resolve fight|Resolve without spending Infamy|Spend 1 Infamy)/.test(button.textContent.trim()))
            ?? buttons.find((button) => button.textContent.trim() === "Confirm retreat")
            ?? buttons.find((button) => button.closest(".retreat-unit"));
          if (preferred) { preferred.click(); return true; }
          const legalRetreat = document.querySelector(".hex-tile.retreat-legal:not(:disabled)");
          legalRetreat?.click();
          return Boolean(legalRetreat);
        })()`);
        if (fightAction) break;
      }
      if (!fightAction) {
        if (fightStep < 5) { await wait(200); continue; }
        const diagnostic = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
          const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
          const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
          const room = await (await fetch(endpoint)).json();
          return { phase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), action: document.querySelector(".action-dock button")?.textContent?.trim(), status: document.querySelector(".action-dock-status")?.textContent?.trim(), pending: room.state.pendingDecision, currentPlayer: room.state.currentPlayer, controls: [...document.querySelectorAll("button")].filter((button) => button.getClientRects().length).map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })).filter((button) => button.text) };
        })()`)));
        await writeFile("/tmp/abominations-online-fight-diagnostic.json", JSON.stringify(diagnostic, null, 2));
        throw new Error("Neither online player exposed an enabled legal Fight decision control; diagnostic saved to /tmp/abominations-online-fight-diagnostic.json.");
      }
      await wait(180);
    }
    if (await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Fight"`)) {
      const fightDiagnostics = await Promise.all([first, second].map((browser) => browser.evaluate(`({ heading: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), buttons: [...document.querySelectorAll("button")].map((button) => button.textContent.trim()).filter((text) => /fight|attack|retreat|target|infamy/i.test(text)).slice(-16), prompt: document.querySelector(".deployment-prompt")?.textContent?.trim() ?? "" })`)));
      const recentFightEvents = await first.evaluate(`(async () => { const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}"); const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""); const room = await (await fetch(endpoint)).json(); return { phase: room.state.phase, currentPlayer: room.state.currentPlayer, pendingType: room.state.pendingDecision?.type, pendingPlayer: room.state.pendingDecision?.playerIndex, events: room.state.eventLog.slice(-12).map((event) => event.action) }; })()`);
      await writeFile(join(process.cwd(), "output/board-art/browser-online-fight-diagnostic.json"), `${JSON.stringify({ fightDiagnostics, recentFightEvents }, null, 2)}\n`);
      throw new Error(`Online Fight did not resolve within the supported decision steps: ${JSON.stringify({ fightDiagnostics, recentFightEvents })}`);
    }
  }
  await first.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() !== "Waiting for server…"`, "first player action settled after Fight");
  const postFightPhase = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
  try {
    await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === ${JSON.stringify(postFightPhase)}`, "second synchronized post-Fight phase");
  } catch (error) {
    const diagnostics = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
      const room = response.ok ? await response.json() : null;
      return { status: response.status, roomCode: room?.code, roomVersion: room?.version, roomPhase: room?.state?.phase, currentPlayer: room?.state?.currentPlayer, pendingDecision: room?.state?.pendingDecision, renderedPhase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), connection: document.querySelector(".connection")?.textContent?.trim() };
    })()`)));
    throw new Error(`${error.message}; firstPhase=${postFightPhase}; roomDiagnostics=${JSON.stringify(diagnostics)}`);
  }
  if (process.env.BROWSER_ONLINE_CORE_ONLY === "1") {
    const synchronizedRooms = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
      const room = response.ok ? await response.json() : null;
      return { status: response.status, roomCode: room?.code, version: room?.version, phase: room?.state?.phase, currentPlayer: room?.state?.currentPlayer, pendingDecision: room?.state?.pendingDecision };
    })()`)));
    if (synchronizedRooms.some((state) => state.status !== 200 || state.roomCode !== roomCode || state.version !== synchronizedRooms[0].version || state.phase !== synchronizedRooms[0].phase || state.currentPlayer !== synchronizedRooms[0].currentPlayer || JSON.stringify(state.pendingDecision) !== JSON.stringify(synchronizedRooms[0].pendingDecision))) {
      throw new Error(`Two browser sessions disagree on the authoritative room state: ${JSON.stringify(synchronizedRooms)}`);
    }
    console.log(JSON.stringify({ ok: true, url, roomCode, waitingRoomStart: "verified", setup: "verified", legalBrowserActions: "verified", reconnectAfterRefresh: "verified", synchronizedRooms }));
    await Promise.all([first?.close(), second?.close(), spectator?.close()]);
    first = second = spectator = undefined;
    await Promise.all([stopServer(apiServer), stopServer(webServer)]);
    apiServer = webServer = undefined;
    process.exit(0);
  }
  for (const browser of [first, second, spectator]) {
    await browser.evaluate(`(() => {
      window.__boardPlaybackEvents = [];
      window.__boardPlaybackSnapshots = [];
      new MutationObserver(() => {
        const playback = document.querySelector(".board-event-playback");
        const eventId = playback?.getAttribute("data-event-id");
        if (eventId && !window.__boardPlaybackEvents.includes(eventId)) window.__boardPlaybackEvents.push(eventId);
        if (eventId && playback?.dataset.outcomeVisible === "true") {
          window.__boardPlaybackSnapshots.push({
            eventId,
            action: playback.dataset.eventAction,
            rollCount: Number(playback.dataset.rollCount),
            cards: [...playback.querySelectorAll(".board-event-card")].map((card) => ({ className: card.className, label: card.getAttribute("aria-label"), text: card.textContent?.trim() ?? "" })),
          });
        }
      }).observe(document.body, { attributes: true, attributeFilter: ["data-event-action", "data-outcome-visible", "data-roll-count"], childList: true, subtree: true });
    })()`);
  }
  const [firstIdentity, secondIdentity] = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
    const room = await (await fetch(endpoint)).json();
    return room.participants.find((participant) => participant.id === session.participantId)?.playerIndex;
  })()`)));
  const encounterActorIndex = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
    const room = await (await fetch(endpoint)).json();
    return room.state.pendingDecision?.playerIndex ?? room.state.currentPlayer;
  })()`);
  const opponentBrowser = encounterActorIndex === firstIdentity ? second : first;
  const opponentEncounterDicePromise = opponentBrowser.waitFor(`(() => { const playback = document.querySelector(".board-event-playback"); return playback?.dataset.outcomeVisible === "true" && Number(playback.dataset.rollCount) > 0; })()`, "opponent Encounter dice playback").then(() => true, () => false);
  const clickEncounterDecision = async () => {
    for (const [browser, label] of [[first, "first"], [second, "second"]]) {
      const clicked = await browser.evaluate(`(() => {
        const cityChoice = document.querySelector(".board-event-choice-actions button:not(:disabled)");
        if (cityChoice) { cityChoice.click(); return true; }
        const routineStomp = document.querySelector(".board-event-roll-all:not(:disabled)");
        if (routineStomp) { routineStomp.click(); return true; }
        const trophy = [...document.querySelectorAll('button[aria-label*="as trophy"]')].find((candidate) => !candidate.disabled);
        if (trophy) { trophy.click(); return true; }
        const trophyTile = document.querySelector(".hex-tile.trophy-legal:not(:disabled)");
        if (trophyTile) { trophyTile.click(); return true; }
        const stageAction = [...document.querySelectorAll(".resolution-stage button")].find((candidate) => !candidate.disabled && /Reveal encounter|Take .* Health|Take .* Infamy|Return to board|Roll die|Reveal remaining rolls/.test(candidate.textContent.trim()));
        if (stageAction) { stageAction.click(); return true; }
        const details = document.querySelector("#phase-command-context");
        if (details) details.open = true;
        const button = [...document.querySelectorAll(".path-controls button")].find((candidate) => !candidate.disabled && /^(Resolve encounter|Take .* Health|Take .* Infamy instead)$/.test(candidate.textContent.trim()));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (clicked) {
        await browser.waitFor(`!/^Waiting for server/.test(document.querySelector(".turn-hud-heading h2")?.textContent?.trim() ?? "")`, `${label} Encounter response`);
        return true;
      }
    }
    const diagnostic = await Promise.all([first, second].map((browser) => browser.evaluate(`({ phase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), stage: document.querySelector(".resolution-stage[open]")?.innerText, controls: [...document.querySelectorAll(".path-controls button")].map((button) => ({ label: button.textContent.trim(), disabled: button.disabled })), pending: document.querySelector(".deployment-prompt")?.textContent?.trim() })`)));
    throw new Error(`Encounter remained active without an enabled legal decision control in either player session: ${JSON.stringify(diagnostic)}`);
  };
  const encounterAction = await clickEncounterDecision();
  if (!encounterAction) throw new Error("First browser exposed no legal Encounter action.");
  for (let encounterStep = 0; encounterStep < 4; encounterStep += 1) {
    const currentPhase = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
    if (currentPhase === "Deploy" || /^Victory · /.test(currentPhase ?? "")) break;
    if (currentPhase !== "Encounter") throw new Error(`Expected Encounter or Deploy after Encounter action, got ${currentPhase ?? "unknown"}.`);
    const followUp = await clickEncounterDecision();
    if (!followUp) throw new Error("Encounter remained active without an enabled legal decision control in either player session.");
  }
  let postEncounterPhase = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === ${JSON.stringify(postEncounterPhase)}`, "second synchronized post-encounter phase");
  const encounterPresentationEvents = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
    const room = await (await fetch(endpoint)).json();
    return room.state.eventLog.filter((event) => ["encounter.resolved", "encounter.choice-required", "trophy.choice-required"].includes(event.action))
      .map((event) => ({ id: event.id, action: event.action, playerIndex: event.detail.playerIndex, rollCount: Array.isArray(event.detail.rolls) ? event.detail.rolls.length : 0 }));
  })()`);
  const opponentOwnedEvent = encounterPresentationEvents.find((event) => event.playerIndex === encounterActorIndex);
  if (opponentOwnedEvent) await opponentBrowser.waitFor(`(window.__boardPlaybackEvents ?? []).includes(${JSON.stringify(opponentOwnedEvent.id)})`, "opponent encounter board playback");
  const encounterPlayback = await Promise.all([first, second, spectator].map((browser) => browser.evaluate(`({
    events: window.__boardPlaybackEvents ?? [],
    modalOpen: Boolean(document.querySelector(".resolution-stage[open]")),
    playbackLabel: document.querySelector(".board-event-playback")?.getAttribute("aria-label") ?? "",
    recordedEncounter: document.querySelector(".encounter-result")?.getAttribute("data-event-id") ?? "",
    playbackSnapshots: window.__boardPlaybackSnapshots ?? [],
    phase: document.querySelector(".turn-hud-heading h2")?.textContent?.trim() ?? ""
  })`)));
  if (!encounterPlayback.some((view) => view?.events?.length)) {
    const eventTrace = await first.evaluate(`(async () => {
      const token = JSON.parse(localStorage.getItem("abominations-session") ?? "{}").token ?? "";
      const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(token));
      const state = (await response.json()).state;
      return state.eventLog.map((event) => ({ action: event.action, playerIndex: event.detail.playerIndex, location: event.detail.location }));
    })()`);
    throw new Error(`No opponent or spectator received the board encounter playback: ${JSON.stringify({ encounterPlayback, eventTrace })}`);
  }
  const opponentObservedEncounter = encounterPresentationEvents.some((event) =>
    (event.playerIndex === firstIdentity && encounterPlayback[1]?.events?.includes(event.id))
    || (event.playerIndex === secondIdentity && encounterPlayback[0]?.events?.includes(event.id)));
  if (!opponentObservedEncounter) throw new Error(`The non-acting player did not receive board playback for the other player's Encounter: ${JSON.stringify({ encounterPresentationEvents, firstIdentity, secondIdentity, encounterPlayback })}`);
  const encounterHasRecordedRolls = encounterPresentationEvents.some((event) => event.rollCount > 0);
  const opponentEncounterRolls = encounterHasRecordedRolls ? await opponentEncounterDicePromise : true;
  if (!opponentEncounterRolls) throw new Error(`The opponent did not see the recorded Encounter dice on the board: ${JSON.stringify({ encounterPresentationEvents, encounterPlayback })}`);
  if (encounterPlayback[2]?.modalOpen) throw new Error("The spectator saw a modal encounter screen instead of following the board playback.");
  if (encounterPlayback.filter((view) => view?.modalOpen).length > 1) throw new Error("The encounter screen opened on more than one online client.");
  if (encounterPlayback.some((view) => /cardId/i.test(view?.playbackLabel ?? ""))) throw new Error("A private card identifier leaked into board playback.");
let onlineVictory;
  let onlineResearchDraw = "not-reached";
  if (postEncounterPhase === "Deploy") {
    let researchDraw;
    for (const [browser, browserName] of [[first, "first"], [second, "second"]]) {
      researchDraw = await browser.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
        const room = await (await fetch(endpoint)).json();
        const participant = room.participants?.find((candidate) => candidate.id === session.participantId);
        if (participant?.role !== "player" || participant.playerIndex !== room.state.pendingDecision?.playerIndex || room.state.phase !== "deploy") return undefined;
        if (room.state.decks.research.exhausted) return { skipped: "research-deck-exhausted" };
        const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/actions`)}, {
          method: "POST",
          headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
          body: JSON.stringify({ envelope: { actionId: crypto.randomUUID(), actorId: session.participantId, expectedRevision: room.version, protocolVersion: 1, command: { type: "draw-research" } } }),
        });
        return { status: response.status, body: await response.json(), actorBrowser: ${JSON.stringify(browserName)}, actorPlayerIndex: participant.playerIndex };
      })()`);
      if (researchDraw) break;
    }
    if (!researchDraw || researchDraw.status !== 200) throw new Error(`No active player could draw Military Research during Deploy: ${JSON.stringify(researchDraw)}`);
    onlineResearchDraw = "verified";
    const researchObservers = researchDraw.actorBrowser === "first" ? [second, spectator] : [first, spectator];
    await Promise.all(researchObservers.map((browser) => browser.waitFor(`(window.__boardPlaybackSnapshots ?? []).some((snapshot) => snapshot.action === "research.drawn" && snapshot.cards.some((card) => card.className.includes("research") && /MILITARY RESEARCH card drawn/.test(card.label ?? "")))`, "generic Military Research observer card")));
    const researchActor = researchDraw.actorBrowser === "first" ? first : second;
    await first.waitFor(`["Move", "Deploy"].includes(document.querySelector(".turn-hud-heading h2")?.textContent?.trim())`, "post-research phase");
    let phaseAfterResearch = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
    if (phaseAfterResearch === "Deploy") {
      const giantChoice = await researchActor.evaluate(`Boolean(document.querySelector(".giant-placement-options button:not(:disabled)"))`);
      if (giantChoice) {
        if (!await researchActor.evaluate(`(() => { const button = document.querySelector(".giant-placement-options button:not(:disabled)"); if (!button) return false; button.click(); return true; })()`)) {
          throw new Error("The player could not select a legal base for the immediate giant Research placement.");
        }
        await researchActor.waitFor(`!document.querySelector(".giant-placement-options")`, "resolved immediate giant Research placement");
        phaseAfterResearch = await first.evaluate(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim()`);
      }
    }
    if (phaseAfterResearch === "Deploy") {
      await researchActor.waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Pass deployment" && !button.disabled)`, "post-giant research Deploy continuation");
      if (!await researchActor.click("Pass deployment")) throw new Error("The player could not pass the remaining Deploy phase after the immediate giant Research placement.");
    }
    try {
      await first.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "first next Move phase");
      await second.waitFor(`document.querySelector(".turn-hud-heading h2")?.textContent?.trim() === "Move"`, "second synchronized next Move phase");
    } catch (error) {
      const state = await first.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
        const room = await response.json();
        return { status: room.status, state: { phase: room.state?.phase, currentPlayer: room.state?.currentPlayer, pendingDecision: room.state?.pendingDecision, lastEvents: room.state?.eventLog?.slice(-6).map((event) => ({ action: event.action, phase: event.detail.nextPhase, nextPlayer: event.detail.nextPlayer })) }, clients: [document.querySelector(".turn-hud-heading h2")?.textContent?.trim(), document.querySelector(".lobby")?.textContent?.trim()] };
      })()`);
      throw new Error(`Military Research draw did not reach the next Move phase: ${JSON.stringify({ state, researchDraw })}; ${error instanceof Error ? error.message : String(error)}`);
    }
    const playerSessions = await Promise.all([first, second].map((browser) => browser.evaluate(`JSON.parse(localStorage.getItem("abominations-session") ?? "{}")`)));
    let victoryRoom;
    for (let step = 0; step < 400; step += 1) {
      const baselineResponse = await apiFetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(playerSessions[0].token ?? "")}`);
      if (!baselineResponse.ok) throw new Error(`Online victory driver could not read the latest room (${baselineResponse.status}).`);
      const baselineRoom = await baselineResponse.json();
      if (baselineRoom.state?.phase === "game-over") { victoryRoom = baselineRoom; break; }
      const actorIndex = baselineRoom.state?.pendingDecision && "playerIndex" in baselineRoom.state.pendingDecision
        ? baselineRoom.state.pendingDecision.playerIndex
        : baselineRoom.state?.currentPlayer;
      if (actorIndex !== 0 && actorIndex !== 1) throw new Error(`Online victory driver could not resolve the decision owner: ${JSON.stringify(baselineRoom.state?.pendingDecision)}.`);
      const session = playerSessions[actorIndex];
      if (actorIndex === 0) victoryRoom = baselineRoom;
      else {
        const response = await apiFetch(`${apiUrl}/rooms/${roomCode}/state?token=${encodeURIComponent(session.token ?? "")}`);
        if (!response.ok) throw new Error(`Online victory driver could not read player ${actorIndex + 1}'s room (${response.status}).`);
        victoryRoom = await response.json();
      }
      if (victoryRoom.state?.phase === "game-over") break;
      const decisionOwner = victoryRoom.state?.pendingDecision && "playerIndex" in victoryRoom.state.pendingDecision
        ? victoryRoom.state.pendingDecision.playerIndex
        : victoryRoom.state?.currentPlayer;
      if (decisionOwner !== actorIndex) throw new Error(`Online decision owner changed during bot planning: expected ${actorIndex}, received ${decisionOwner}.`);
      const command = chooseBotCommand(victoryRoom.state, new Set([actorIndex]));
      if (!command) throw new Error(`No legal automated choice was available for player ${actorIndex + 1} at ${victoryRoom.state?.phase}/${victoryRoom.state?.pendingDecision?.type ?? "no decision"}.`);
      const participant = victoryRoom.participants?.find((candidate) => candidate.role === "player" && candidate.playerIndex === actorIndex);
      if (!participant || participant.id !== session.participantId) throw new Error(`Online victory driver lost player ${actorIndex + 1}'s participant identity.`);
      const actionResponse = await apiFetch(`${apiUrl}/rooms/${roomCode}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
        body: JSON.stringify({ envelope: {
          actionId: `bot-victory-${step}-${randomUUID()}`,
          actorId: participant.id,
          expectedRevision: victoryRoom.version,
          protocolVersion: 1,
          command,
        } }),
      });
      const actionBody = await actionResponse.json();
      if (!actionResponse.ok) throw new Error(`Online victory command ${JSON.stringify(command)} failed (${actionResponse.status}): ${JSON.stringify({ actionBody, actorIndex, currentPlayer: victoryRoom.state?.currentPlayer, phase: victoryRoom.state?.phase, pendingDecision: victoryRoom.state?.pendingDecision, revision: victoryRoom.version })}.`);
      victoryRoom = actionBody;
      if (step % 10 === 0) await wait(10);
    }
    if (victoryRoom?.state?.phase !== "game-over" || victoryRoom.state.winnerPlayer === undefined) {
      throw new Error(`The audited-board online match did not reach a winner: ${JSON.stringify({ phase: victoryRoom?.state?.phase, round: victoryRoom?.state?.round, pendingDecision: victoryRoom?.state?.pendingDecision })}.`);
    }
    onlineVictory = { type: victoryRoom.state.victoryType, winnerPlayer: victoryRoom.state.winnerPlayer, round: victoryRoom.state.round };
  } else if (!/^Victory · /.test(postEncounterPhase ?? "")) {
    throw new Error(`Expected Deploy or an encounter-triggered victory, got ${postEncounterPhase ?? "unknown"}.`);
  }
  for (const [browser, label] of [[first, "first terminal"], [second, "second terminal"], [spectator, "spectator terminal"]]) {
    await browser.waitFor(`/^Victory · /.test(document.querySelector(".turn-hud-heading h2")?.textContent?.trim() ?? "")`, label);
    await browser.waitFor(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`, `${label} authoritative result`);
    const terminalSummary = await browser.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
    if (!terminalSummary) {
      const diagnostic = await browser.evaluate(`(() => {
        const summary = document.querySelector(".victory-summary");
        const context = document.querySelector("#phase-command-context");
        return {
          heading: document.querySelector(".turn-hud-heading h2")?.textContent?.trim() ?? null,
          summaryText: summary?.textContent?.trim() ?? null,
          summaryPresent: Boolean(summary),
          contextOpen: context?.open ?? null,
          contextText: context?.textContent?.trim() ?? null,
          bodyText: document.body.innerText.slice(-1200),
        };
      })()`);
      throw new Error(`${label} did not render the authoritative terminal summary: ${JSON.stringify(diagnostic)}.`);
    }
  }
  await second.evaluate("location.reload()");
  await second.waitFor(`/^Victory · /.test(document.querySelector(".turn-hud-heading h2")?.textContent?.trim() ?? "")`, "reloaded second terminal");
  const reloadedTerminal = await second.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
  if (!reloadedTerminal) throw new Error("Reloaded second browser lost the terminal result.");
  const renderedVictory = await Promise.all([first, second, spectator].map((browser) => browser.evaluate(`document.querySelector(".victory-summary")?.textContent?.trim() ?? ""`)));
  if (renderedVictory.some((summary) => !summary.includes(onlineVictory?.type ?? ""))) throw new Error(`Players and spectator did not render the same authoritative victory: ${JSON.stringify({ onlineVictory, renderedVictory })}.`);
  const result = { ok: true, url, roomCode, waitingRoom: { seatsRequired: 2, startDisabledBeforeJoin: !startBeforeSecondPlayer, startVisibleToBothPlayersAfterJoin: beforeStart.every((state) => state?.canStart), setupHiddenBeforeStart: beforeStart.every((state) => !state?.setupVisible), setupUnlockedForBothAfterStart: true }, setupClicks, boardCells: renderedBoardCells[0]?.count, boardIdentity: "shared-pinned-human-audit", spectatorSetup: "no-act", spectatorMove: "no-act", startingGiantPlacement, startingGiantPlacementRefresh, disconnect: disconnectState, reconnect: "online", reconnectRecovery: "verified", forgedCommand: "rejected-without-state-change", malformedCommand: "rejected-without-state-change", synchronizedPhase: "Move", reloadRecovery: "verified", onlineMovement: "verified", liveGameplayStack: liveGameplayStackEvidence, onlineFight, stackInspection, stackArtworkGeometry, onlineEncounter: "verified", onlineDeploy: postEncounterPhase === "Deploy" ? "verified" : "skipped-after-victory", onlineResearchDraw, onlineVictory, terminalProjection: "players-and-spectator", terminalReloadRecovery: "verified", nextPhase };
  await mkdir(join(process.cwd(), "output/board-art"), { recursive: true });
  await writeFile(join(process.cwd(), "output/board-art/browser-online-verification.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await Promise.all([first?.close(), second?.close(), spectator?.close()]);
  await Promise.all([stopServer(apiServer), stopServer(webServer)]);
}
