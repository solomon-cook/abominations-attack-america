import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import WebSocket from "ws";
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
const ownsWebServer = !process.env.BROWSER_TEST_URL;
const ownsApiServer = !process.env.BROWSER_API_URL;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function openBrowser(port, name, existingProfile, restoredSessionStorage = []) {
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
  let nextDialogAccepted = true;
  const dialogOpenings = [];
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "Page.javascriptDialogOpening") {
      dialogOpenings.push({ type: message.params?.type, message: message.params?.message ?? "" });
      const accept = nextDialogAccepted;
      nextDialogAccepted = true;
      void command("Page.handleJavaScriptDialog", { accept });
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
  if (restoredSessionStorage.length) {
    const serializedStorage = JSON.stringify(restoredSessionStorage);
    await command("Page.addScriptToEvaluateOnNewDocument", {
      source: `const restoredSessionStorage = JSON.parse(${JSON.stringify(serializedStorage)}); for (const [key, value] of restoredSessionStorage) sessionStorage.setItem(key, value);`,
    });
  }
  await command("Page.navigate", { url });
  const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const clickPoint = async ({ x, y }) => {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const pressKey = async (key) => {
    const keys = {
      Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
      Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
      Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
    };
    const definition = keys[key];
    if (!definition) throw new Error(`${name}: unsupported browser test key ${key}.`);
    await command("Input.dispatchKeyEvent", { type: "rawKeyDown", ...definition });
    if (key === "Space") await command("Input.dispatchKeyEvent", { type: "char", key: " ", text: " " });
    await command("Input.dispatchKeyEvent", { type: "keyUp", ...definition });
  };
  const clickSelector = async (selector) => {
    const box = await evaluate(`(() => { for (const element of document.querySelectorAll(${JSON.stringify(selector)})) { element.scrollIntoView({ block: "center", inline: "nearest" }); const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2; const hit = document.elementFromPoint(x, y); if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && (hit === element || element.contains(hit))) return { x, y }; } return null; })()`);
    if (!box) return false;
    await clickPoint(box);
    return true;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(100);
    }
    const diagnostic = await evaluate(`({ url: location.href, connection: document.querySelector(".connection")?.textContent?.trim(), error: document.querySelector(".error")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), phase: document.querySelector(".action-card h2")?.textContent?.trim(), connectionLeaseStorage: Object.entries(sessionStorage).filter(([key]) => key.startsWith("abominations-connection-id:")) })`);
    throw new Error(`${name}: timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  };
  return {
    evaluate,
    waitFor,
    clickPoint,
    clickSelector,
    pressKey,
    dialogOpenings: () => dialogOpenings.map((dialog) => ({ ...dialog })),
    screenshot: async () => {
      const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      return Buffer.from(result.data, "base64");
    },
    setNextDialogResponse: (accept) => { nextDialogAccepted = accept; },
    restart: async (sessionStorageSnapshot = []) => {
      socket.close();
      child.kill("SIGKILL");
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
      return openBrowser(port, name, profile, sessionStorageSnapshot);
    },
    click: (label) => evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled); if (!button) return false; button.click(); return true; })()`),
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
let disabledConcedeEvidence;
let disappearFirst;
let disappearSecond;
let disabledConfirmDisappearEvidence;
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
      env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
      name: "MVP API",
      ready: async () => (await fetch(`${apiUrl}/health`)).ok,
    });
    await apiServer.waitForReady();
  }
  first = await openBrowser(9230, "first");
  second = await openBrowser(9231, "second");
  spectator = await openBrowser(9232, "spectator");
  await first.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "first lobby");
  await first.evaluate(`(() => { const input = document.querySelector('[aria-label="Display name"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "First player"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await first.evaluate(`(() => { const select = document.querySelector('[aria-label="Room privacy"]'); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, "public"); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  if (!await first.click("Create")) throw new Error("First browser could not create a room.");
  await first.waitFor(`!!document.querySelector(".lobby strong")`, "created room code");
  const roomCode = await first.evaluate(`document.querySelector(".lobby strong")?.textContent?.trim()`);
  if (!roomCode) throw new Error("Created room did not expose a room code.");

  await second.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "second lobby");
  await second.evaluate(`(() => { const inputs = document.querySelectorAll('input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "Second player"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); setter.call(inputs[1], ${JSON.stringify(roomCode)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await second.click("Join")) throw new Error("Second browser could not join the created room.");
  await second.waitFor(`!!document.querySelector(".lobby strong")`, "joined room code");

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
  let consecutiveSetupWaits = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let progressed = false;
    for (const browser of [first, second]) {
      const preferredStartingChoice = "Draw Research";
      const clicked = await browser.evaluate(`(() => { const phase = document.querySelector(".setup-panel h2")?.textContent?.trim(); const buttons = [...document.querySelectorAll(".setup-options button")].filter((candidate) => !candidate.disabled); const button = phase === "starting choice" ? buttons.find((candidate) => candidate.textContent?.trim().toLowerCase().includes(${JSON.stringify(preferredStartingChoice.toLowerCase())})) : buttons[0]; if (!button) return false; button.click(); return true; })()`);
      if (clicked) { setupClicks += 1; progressed = true; consecutiveSetupWaits = 0; await wait(120); break; }
    }
    if (!progressed) {
      const complete = await first.evaluate("!document.querySelector('.setup-panel')") && await second.evaluate("!document.querySelector('.setup-panel')");
      if (complete) break;
      consecutiveSetupWaits += 1;
      if (consecutiveSetupWaits >= 8) {
        const setupStates = await Promise.all([first, second].map((browser) => browser.evaluate(`(() => ({ phase: document.querySelector(".setup-panel h2")?.textContent?.trim(), prompt: document.querySelector(".deployment-prompt")?.textContent?.trim(), progress: document.querySelector(".setup-progress")?.textContent?.trim(), action: document.querySelector(".action-card h2")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), buttons: [...document.querySelectorAll(".setup-options button")].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled, title: button.title })) }))()`)));
        throw new Error(`Neither online browser exposed the current setup choice: ${JSON.stringify(setupStates)}`);
      }
      await wait(180);
    }
  }
  await first.waitFor("!document.querySelector('.setup-panel')", "first setup completion");
  await second.waitFor("!document.querySelector('.setup-panel')", "second setup completion");
  if (!await first.click("Ready") || !await second.click("Ready")) throw new Error("Both players did not expose Ready controls.");
  await first.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "first Move phase");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "second Move phase");
  await spectator.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "spectator Move projection");
  for (const [browser, targetPlayer, label] of [[first, "Player 2", "online opponent"], [spectator, "Player 1", "spectator player"]]) {
    const clickedPortrait = await browser.evaluate(`(() => { const button = [...document.querySelectorAll(".opponent-player-card")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(${JSON.stringify(targetPlayer)})); if (!button) return false; button.click(); return true; })()`);
    if (!clickedPortrait) throw new Error(`${label} portrait was missing.`);
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
  if (!savedSession) throw new Error("First browser did not expose its persisted room session before restart.");
  const savedConnectionLease = await first.evaluate(`JSON.stringify(Object.entries(sessionStorage))`);
  if (!JSON.parse(savedConnectionLease).some(([key, value]) => key === `abominations-connection-id:${roomCode}` && value)) {
    throw new Error("First browser did not expose its acknowledged session-scoped connection lease before restart.");
  }
  const reconnectedFirst = await first.restart(JSON.parse(savedConnectionLease));
  first = reconnectedFirst;
  const disconnectState = "websocket-process-restart";
  await first.waitFor(`!!document.querySelector(".lobby strong") || !!document.querySelector('[aria-label="Display name"]')`, "first browser reopened");
  const restoredRoom = await first.evaluate(`Boolean(document.querySelector(".lobby strong"))`);
  if (!restoredRoom) {
    await first.evaluate(`localStorage.setItem("abominations-session", ${JSON.stringify(savedSession)})`);
    await first.evaluate("location.reload()");
  }
  await first.waitFor(`document.querySelector(".connection")?.textContent?.trim() === "online"`, "first browser reconnect state");
  await first.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "first browser recovered Move state");
  const forgedCommand = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch("${apiUrl}/rooms/${roomCode}/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
      body: JSON.stringify({ envelope: { actionId: crypto.randomUUID(), actorId: "forged-browser-actor", expectedRevision: 0, protocolVersion: 1, command: { type: "pass-move" } } }),
    });
    return { status: response.status, body: await response.json() };
  })()`);
  if (forgedCommand.status !== 400 || await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() !== "Move"`)) throw new Error(`Forged browser command was not rejected without changing Move: ${JSON.stringify(forgedCommand)}`);
  const malformedCommand = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch("${apiUrl}/rooms/${roomCode}/actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token ?? "" },
      body: "{ malformed browser payload",
    });
    return { status: response.status, body: await response.json() };
  })()`);
  if (malformedCommand.status !== 400 || await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() !== "Move"`)) throw new Error(`Malformed browser command was not rejected without changing Move: ${JSON.stringify(malformedCommand)}`);
  await second.evaluate("location.reload()");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "reloaded second Move phase");
  await first.waitFor(`document.querySelectorAll(".hex-tile.legal:not(:disabled)").length > 0`, "online legal movement destination");
  if (!await first.evaluate(`(() => { const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")]; const diceCities = new Set(["1,5", "2,7", "3,-1", "5,6", "12,3", "12,5", "13,-3", "15,-3", "15,-1", "17,-4", "17,0", "18,-5", "18,-4", "18,2", "19,-4", "20,2", "21,-8", "21,-6", "21,-5"]); const tile = tiles.find((candidate) => diceCities.has(candidate.dataset.hexKey)) ?? tiles.find((candidate) => candidate.getAttribute("aria-label")?.includes("infamy-site")) ?? tiles.find((candidate) => !candidate.getAttribute("aria-label")?.includes("military-base")) ?? tiles.find((candidate) => candidate.querySelector('img[alt^="Navy "]')) ?? tiles[0]; tile?.click(); return Boolean(tile); })()`)) throw new Error("First browser could not select an online legal destination.");
  await first.waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm move")`, "online path confirmation");
  if (!await first.click("Confirm move")) throw new Error("First browser could not confirm the online path.");
  await first.waitFor(`!!document.querySelector(".end-movement:not(:disabled)")`, "online movement completion control");
  if (!await first.evaluate(`(() => { const button = document.querySelector(".end-movement:not(:disabled)"); if (!button) return false; button.click(); return true; })()`)) throw new Error("First browser could not end online movement.");
  await first.waitFor(`(() => { const phase = document.querySelector(".action-card h2")?.textContent?.trim(); return phase !== "Move" && phase !== "Waiting for server…"; })()`, "first settled post-move phase");
  const nextPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() !== "Move"`, "second post-move phase");
  const secondPhase = await second.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  if (secondPhase !== nextPhase) throw new Error(`Online phase divergence after movement: first=${nextPhase ?? "unknown"}, second=${secondPhase ?? "unknown"}.`);
  await spectator.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === ${JSON.stringify(nextPhase)}`, "spectator synchronized post-move phase");
  let onlineFight = "not-reached";
  if (nextPhase === "Fight") {
    onlineFight = "verified";
    for (let fightStep = 0; fightStep < 8; fightStep += 1) {
      const currentFightPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
      if (currentFightPhase !== "Fight") break;
      const fightAction = await first.evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button")].filter((button) => !button.disabled);
        const preferred = buttons.find((button) => /^(Resolve fight|Resolve without spending Infamy|Spend 1 Infamy|Attack )/.test(button.textContent.trim()))
          ?? buttons.find((button) => button.textContent.trim() === "Confirm retreat")
          ?? buttons.find((button) => button.closest(".retreat-unit"));
        preferred?.click();
        return Boolean(preferred);
      })()`);
      if (!fightAction) throw new Error("Online Fight exposed no enabled legal decision control.");
      await first.waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "online Fight response");
    }
    if (await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Fight"`)) throw new Error("Online Fight did not resolve within the supported decision steps.");
  }
  const postFightPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === ${JSON.stringify(postFightPhase)}`, "second synchronized post-Fight phase");
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
      const turnPanelCollapsed = await browser.evaluate(`document.querySelector("#turn-hud-body")?.hidden === true`);
      if (turnPanelCollapsed) {
        if (!await browser.clickSelector('button[aria-label="Expand turn panel"]')) continue;
        await browser.waitFor(`document.querySelector("#turn-hud-body")?.hidden === false`, `${label} expanded turn panel for Encounter`);
      }
      const clicked = await browser.evaluate(`(() => {
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
        const reward = [...document.querySelectorAll(".battle-choice button")].find((candidate) => !candidate.disabled && /^(Take .* Health|Take .* Infamy(?: instead)?)$/.test(candidate.textContent.trim()));
        if (reward) { reward.click(); return true; }
        const button = [...document.querySelectorAll(".path-controls button")].find((candidate) => !candidate.disabled && /^(Resolve encounter|Take .* Health|Take .* Infamy instead)$/.test(candidate.textContent.trim()));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (clicked) {
        await browser.waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${label} Encounter response`);
        return true;
      }
    }
    const diagnostic = await Promise.all([first, second].map((browser) => browser.evaluate(`(async () => {
      const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
      const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
      const room = await response.json();
      return {
        phase: document.querySelector(".action-card h2")?.textContent?.trim(),
        serverPhase: room.state?.phase,
        currentPlayer: room.state?.currentPlayer,
        pendingDecision: room.state?.pendingDecision,
        participants: room.participants?.map(({ id, playerIndex, connected }) => ({ id, playerIndex, connected })),
        stage: document.querySelector(".resolution-stage[open]")?.innerText,
        controls: [...document.querySelectorAll(".path-controls button, .action-card button, .action-dock button, .resolution-stage button")].map((button) => ({ label: button.textContent.trim(), disabled: button.disabled, visible: button.getBoundingClientRect().width > 0 })),
        pending: document.querySelector(".deployment-prompt")?.textContent?.trim(),
      };
    })()`)));
    throw new Error(`Encounter remained active without an enabled legal decision control in either player session: ${JSON.stringify(diagnostic)}`);
  };
  const encounterAction = await clickEncounterDecision();
  if (!encounterAction) throw new Error("First browser exposed no legal Encounter action.");
  for (let encounterStep = 0; encounterStep < 4; encounterStep += 1) {
    const currentPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
    if (currentPhase === "Deploy" || /^Victory · /.test(currentPhase ?? "")) break;
    if (currentPhase !== "Encounter") throw new Error(`Expected Encounter or Deploy after Encounter action, got ${currentPhase ?? "unknown"}.`);
    const followUp = await clickEncounterDecision();
    if (!followUp) throw new Error("Encounter remained active without an enabled legal decision control in either player session.");
  }
  let postEncounterPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === ${JSON.stringify(postEncounterPhase)}`, "second synchronized post-encounter phase");
  const encounterPlayback = await Promise.all([first, second, spectator].map((browser) => browser.evaluate(`({
    events: window.__boardPlaybackEvents ?? [],
    modalOpen: Boolean(document.querySelector(".resolution-stage[open]")),
    playbackLabel: document.querySelector(".board-event-playback")?.getAttribute("aria-label") ?? "",
    recordedEncounter: document.querySelector(".encounter-result")?.getAttribute("data-event-id") ?? "",
    playbackSnapshots: window.__boardPlaybackSnapshots ?? [],
    phase: document.querySelector(".action-card h2")?.textContent?.trim() ?? ""
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
  const encounterPresentationEvents = await first.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const endpoint = ${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? "");
    const room = await (await fetch(endpoint)).json();
    return room.state.eventLog.filter((event) => ["encounter.resolved", "encounter.choice-required", "trophy.choice-required"].includes(event.action))
      .map((event) => ({ id: event.id, action: event.action, playerIndex: event.detail.playerIndex }));
  })()`);
  const opponentObservedEncounter = encounterPresentationEvents.some((event) =>
    (event.playerIndex === firstIdentity && encounterPlayback[1]?.events?.includes(event.id))
    || (event.playerIndex === secondIdentity && encounterPlayback[0]?.events?.includes(event.id)));
  if (!opponentObservedEncounter) throw new Error(`The non-acting player did not receive board playback for the other player's Encounter: ${JSON.stringify({ encounterPresentationEvents, firstIdentity, secondIdentity, encounterPlayback })}`);
  const opponentEncounterRolls = await opponentEncounterDicePromise;
  if (!opponentEncounterRolls) throw new Error(`The opponent did not see the Encounter dice on the board: ${JSON.stringify(encounterPlayback)}`);
  if (encounterPlayback[2]?.modalOpen) throw new Error("The spectator saw a modal encounter screen instead of following the board playback.");
  if (encounterPlayback.filter((view) => view?.modalOpen).length > 1) throw new Error("The encounter screen opened on more than one online client.");
  if (encounterPlayback.some((view) => /cardId/i.test(view?.playbackLabel ?? ""))) throw new Error("A private card identifier leaked into board playback.");
  let concessionActor;
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
    await first.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "first next Move phase");
    await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "second synchronized next Move phase");
    for (const [browser, label] of [[first, "first"], [second, "second"]]) {
      if (!await browser.clickSelector('button[aria-label="Expand turn panel"]')) continue;
      await browser.waitFor(`document.querySelector("#turn-hud-body")?.hidden === false`, `${label} expanded turn panel`);
      const optionBounds = await browser.evaluate(`(() => {
        const matches = [...document.querySelectorAll("details.hud-section")].filter((candidate) => candidate.querySelector("summary")?.textContent.trim() === "Match options");
        for (const section of matches) {
          const summary = section.querySelector("summary");
          const button = [...section.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Concede match" && !candidate.disabled);
          if (!summary || !button) continue;
          summary.scrollIntoView({ block: "center", inline: "nearest" });
          const rect = summary.getBoundingClientRect();
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          if (getComputedStyle(section).display !== "none" && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && (hit === summary || summary.contains(hit))) return { summary: { x, y }, open: section.open };
        }
        return null;
      })()`);
      if (!optionBounds) continue;
      if (!optionBounds.open) {
        await browser.clickPoint(optionBounds.summary);
        await browser.waitFor(`(() => [...document.querySelectorAll("details.hud-section")].some((section) => { const summary = section.querySelector("summary"); if (!section.open || summary?.textContent.trim() !== "Match options") return false; const rect = summary.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return rect.width > 0 && rect.height > 0 && (hit === summary || summary.contains(hit)); }))()`, "visible Match options disclosure");
      }
      const visibleConcede = await browser.evaluate(`(() => [...document.querySelectorAll("details.hud-section")].some((section) => { const button = [...section.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Concede match" && !candidate.disabled); if (!section.open || section.querySelector("summary")?.textContent.trim() !== "Match options" || !button) return false; const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden" && (hit === button || button.contains(hit)); }))()`);
      if (!visibleConcede) throw new Error(`${label} player's Match options disclosure did not expose the enabled concession control.`);
      browser.setNextDialogResponse(false);
      if (!await browser.clickSelector("details.hud-section[open] button.cancel")) throw new Error(`${label} browser could not pointer-activate the visible Concede match control.`);
      const cancelled = await browser.evaluate(`(() => { const section = [...document.querySelectorAll("details.hud-section")].find((candidate) => candidate.open && candidate.querySelector("summary")?.textContent.trim() === "Match options"); return { phase: document.querySelector(".action-card h2")?.textContent?.trim(), open: Boolean(section), button: [...(section?.querySelectorAll("button") ?? [])].some((candidate) => candidate.textContent.trim() === "Concede match" && !candidate.disabled) }; })()`);
      if (cancelled.phase !== "Move" || !cancelled.open || !cancelled.button) throw new Error(`${label} cancelling the concession prompt changed match state or closed Match options: ${JSON.stringify(cancelled)}`);

      const firstMatchGuideOpen = await browser.evaluate(`Boolean(document.querySelector(".onboarding"))`);
      if (firstMatchGuideOpen) {
        if (!await browser.clickSelector(".onboarding-actions button")) throw new Error(`${label} player could not dismiss the first-match guide to reach Settings.`);
        await browser.waitFor(`!document.querySelector(".onboarding")`, `${label} dismissed the first-match guide`);
      }
      const menuOpen = await browser.evaluate(`document.querySelector(".hud-menu")?.open === true`);
      if (!menuOpen && !await browser.clickSelector("details.hud-menu > summary")) throw new Error(`${label} player could not open the game menu for Settings.`);
      if (!await browser.clickSelector(".hud-menu .settings-action")) {
        const diagnostic = await browser.evaluate(`(() => { const menu = document.querySelector(".hud-menu"); const button = menu?.querySelector(".settings-action"); const rect = button?.getBoundingClientRect(); const hit = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { menuOpen: menu?.open, buttonExists: Boolean(button), buttonText: button?.textContent?.trim(), rect: rect && { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }, hit: hit?.outerHTML?.slice(0, 180), viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth }; })()`);
        throw new Error(`${label} player could not open Settings from the game menu: ${JSON.stringify(diagnostic)}`);
      }
      await browser.waitFor(`!!document.querySelector(".settings-panel")`, `${label} Settings panel`);
      const confirmPreferenceBefore = await browser.evaluate(`(() => { const label = [...document.querySelectorAll(".settings-grid label")].find((node) => node.textContent.includes("Confirm leave, concede, or disappear")); const input = label?.querySelector("input"); return { checked: input?.checked, stored: localStorage.getItem("abominations-confirm-irreversible") }; })()`);
      if (confirmPreferenceBefore.checked !== true) throw new Error(`${label} player did not start the disabled-confirm audit with confirmation enabled: ${JSON.stringify(confirmPreferenceBefore)}`);
      if (!await browser.clickSelector(".settings-panel .settings-grid label:nth-child(4)")) throw new Error(`${label} player could not disable confirmation from Settings.`);
      const confirmPreferenceAfter = await browser.evaluate(`(() => { const label = [...document.querySelectorAll(".settings-grid label")].find((node) => node.textContent.includes("Confirm leave, concede, or disappear")); const input = label?.querySelector("input"); return { checked: input?.checked, stored: localStorage.getItem("abominations-confirm-irreversible") }; })()`);
      if (confirmPreferenceAfter.checked !== false || confirmPreferenceAfter.stored !== "0") throw new Error(`${label} player's disabled confirmation preference did not persist: ${JSON.stringify(confirmPreferenceAfter)}`);
      const evidenceDir = join(process.cwd(), "output/ui-review");
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(evidenceDir, "online-concede-confirm-disabled-settings-2026-09-28.png"), await browser.screenshot());
      await browser.pressKey("Escape");
      await browser.waitFor(`!document.querySelector(".settings-panel")`, `${label} closed Settings panel`);
      const settingsFocusRestored = await browser.evaluate(`document.querySelector(".hud-menu .settings-action") === document.activeElement`);
      if (!settingsFocusRestored) throw new Error(`${label} player did not regain focus on the Settings opener after Escape.`);
      if (await browser.evaluate(`document.querySelector(".hud-menu")?.open === true`)
        && !await browser.clickSelector("details.hud-menu > summary")) throw new Error(`${label} player could not close the game menu before concession.`);
      const beforeConcession = await browser.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
        const room = await response.json();
        const participant = room.participants?.find((entry) => entry.id === session.participantId);
        return { status: response.status, roomVersion: room.version, phase: room.state.phase, currentPlayer: room.state.currentPlayer,
          participantId: session.participantId, participantRole: participant?.role, playerIndex: participant?.playerIndex,
          participants: room.participants?.map((entry) => ({ id: entry.id, role: entry.role, playerIndex: entry.playerIndex, connected: entry.connected })),
          eventIds: room.state.eventLog.map((event) => event.id), eventActions: room.state.eventLog.map((event) => event.action) };
      })()`);
      if (beforeConcession.status !== 200 || beforeConcession.phase !== "move") throw new Error(`${label} player's room was not in an active Move phase before disabled-confirm concession: ${JSON.stringify(beforeConcession)}`);
      await browser.evaluate(`(() => {
        const originalSend = WebSocket.prototype.send;
        window.__disabledConcedeAuditMessages = [];
        WebSocket.prototype.send = function(data) {
          if (typeof data === "string") {
            try {
              const message = JSON.parse(data);
              if (message.type === "command.submit") window.__disabledConcedeAuditMessages.push({ type: message.type, envelope: message.envelope });
            } catch { /* ignore non-JSON websocket frames */ }
          }
          return originalSend.call(this, data);
        };
        return true;
      })()`);
      const dialogsBeforeDisabledConcede = browser.dialogOpenings().length;
      browser.setNextDialogResponse(true);
      if (!await browser.clickSelector("details.hud-section[open] button.cancel")) throw new Error(`${label} browser could not confirm the visible Concede match control.`);
      await browser.waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${label} disabled-confirm concession result`);
      const requestsAfterDisabledConcede = await browser.evaluate(`window.__disabledConcedeAuditMessages ?? []`);
      const afterConcession = await browser.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
        const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${roomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
        const room = await response.json();
        const event = room.state.eventLog.at(-1);
        return { status: response.status, roomVersion: room.version, phase: room.state.phase, currentPlayer: room.state.currentPlayer,
          winnerPlayer: room.state.winnerPlayer, victoryType: room.state.victoryType, pendingDecision: room.state.pendingDecision,
          participants: room.participants?.map((entry) => ({ id: entry.id, role: entry.role, playerIndex: entry.playerIndex, connected: entry.connected })),
          eventIds: room.state.eventLog.map((entry) => entry.id), eventActions: room.state.eventLog.map((entry) => entry.action),
          lastEvent: event ? { action: event.action, detail: event.detail } : null };
      })()`);
      const newEventIds = afterConcession.eventIds.filter((eventId) => !beforeConcession.eventIds.includes(eventId));
      const dialogCountAfterDisabledConcede = browser.dialogOpenings().length;
      const concedeCommandRequests = requestsAfterDisabledConcede.filter((request) => request.type === "command.submit" && request.envelope?.command?.type === "concede");
      if (requestsAfterDisabledConcede.length !== 1 || concedeCommandRequests.length !== 1) {
        throw new Error(`${label} disabled-confirm Concede did not submit exactly one game command: ${JSON.stringify(requestsAfterDisabledConcede)}`);
      }
      if (concedeCommandRequests[0].envelope.actorId !== beforeConcession.participantId
        || concedeCommandRequests[0].envelope.expectedRevision !== beforeConcession.roomVersion
        || beforeConcession.participantRole !== "player" || beforeConcession.playerIndex !== beforeConcession.currentPlayer) {
        throw new Error(`${label} disabled-confirm Concede did not use the active player's current room revision: ${JSON.stringify({ beforeConcession, request: concedeCommandRequests[0] })}`);
      }
      if (dialogCountAfterDisabledConcede !== dialogsBeforeDisabledConcede) throw new Error(`${label} disabled-confirm Concede opened a native browser prompt: ${JSON.stringify(browser.dialogOpenings())}`);
      if (afterConcession.status !== 200 || afterConcession.phase !== "game-over" || afterConcession.victoryType !== "concession"
        || afterConcession.winnerPlayer !== (beforeConcession.currentPlayer + 1) % 2
        || JSON.stringify(afterConcession.pendingDecision) !== JSON.stringify({ type: "game-over", playerIndex: afterConcession.winnerPlayer, victoryType: "concession" })
        || afterConcession.lastEvent?.action !== "match.conceded"
        || afterConcession.lastEvent?.detail?.concedingPlayer !== beforeConcession.currentPlayer
        || afterConcession.lastEvent?.detail?.winnerPlayer !== afterConcession.winnerPlayer
        || newEventIds.length !== 1 || afterConcession.eventIds.length !== beforeConcession.eventIds.length + 1
        || afterConcession.eventIds.slice(0, beforeConcession.eventIds.length).some((eventId, index) => eventId !== beforeConcession.eventIds[index])
        || JSON.stringify(afterConcession.participants) !== JSON.stringify(beforeConcession.participants)) {
        throw new Error(`${label} Concede result did not match the engine's terminal/event contract: ${JSON.stringify({ beforeConcession, afterConcession, newEventIds })}`);
      }
      await writeFile(join(evidenceDir, "online-concede-confirm-disabled-terminal-2026-09-28.png"), await browser.screenshot());
      disabledConcedeEvidence = {
        actor: label,
        viewport: "1280x720",
        input: "pointer",
        firstMatchGuideDismissedBeforeSettings: firstMatchGuideOpen,
        preferenceChangedThroughSettings: true,
        settingsEscapeRestoredFocus: settingsFocusRestored,
        browserDialogCountBefore: dialogsBeforeDisabledConcede,
        browserDialogCountAfter: dialogCountAfterDisabledConcede,
        nativeConfirmationOpened: false,
        actionRequests: requestsAfterDisabledConcede,
        disconnectRequests: 0,
        playerConnectionsUnchanged: true,
        before: { phase: beforeConcession.phase, currentPlayer: beforeConcession.currentPlayer, eventCount: beforeConcession.eventIds.length },
        after: { phase: afterConcession.phase, winnerPlayer: afterConcession.winnerPlayer, victoryType: afterConcession.victoryType, event: afterConcession.lastEvent, eventCount: afterConcession.eventIds.length, appendedEventCount: newEventIds.length },
        screenshots: ["online-concede-confirm-disabled-settings-2026-09-28.png", "online-concede-confirm-disabled-terminal-2026-09-28.png"],
      };
      concessionActor = label;
      break;
    }
    if (!concessionActor) throw new Error("Neither online player exposed the visible Match options disclosure and concession control.");
  } else if (!/^Victory · /.test(postEncounterPhase ?? "")) {
    throw new Error(`Expected Deploy or an encounter-triggered victory, got ${postEncounterPhase ?? "unknown"}.`);
  }
  for (const [browser, label] of [[first, "first terminal"], [second, "second terminal"], [spectator, "spectator terminal"]]) {
    await browser.waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, label);
    const terminalSummary = await browser.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
    if (!terminalSummary) throw new Error(`${label} did not render the authoritative terminal summary.`);
  }
  await second.evaluate("location.reload()");
  await second.waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "reloaded second terminal");
  const reloadedTerminal = await second.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
  if (!reloadedTerminal) throw new Error("Reloaded second browser lost the terminal result.");

  // Use an independent room so the disappearance check starts from an untouched
  // active Move decision and does not affect the multiplayer flow above.
  const disappearPorts = await Promise.all([freePort(), freePort()]);
  disappearFirst = await openBrowser(disappearPorts[0], "disappear-first");
  disappearSecond = await openBrowser(disappearPorts[1], "disappear-second");
  await disappearFirst.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "disappearance first lobby");
  await disappearFirst.evaluate(`(() => { const input = document.querySelector('[aria-label="Display name"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "Disappear audit player"); input.dispatchEvent(new Event("input", { bubbles: true })); const select = document.querySelector('[aria-label="Room privacy"]'); if (select) { const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; selectSetter.call(select, "public"); select.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
  if (!await disappearFirst.click("Create")) throw new Error("Disappearance audit browser could not create its room.");
  await disappearFirst.waitFor(`!!document.querySelector(".lobby strong")`, "disappearance audit room code");
  const disappearRoomCode = await disappearFirst.evaluate(`document.querySelector(".lobby strong")?.textContent?.trim()`);
  if (!disappearRoomCode) throw new Error("Disappearance audit room did not expose its room code.");
  await disappearSecond.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "disappearance second lobby");
  await disappearSecond.evaluate(`(() => { const inputs = document.querySelectorAll("input"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "Disappear audit opponent"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); setter.call(inputs[1], ${JSON.stringify(disappearRoomCode)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await disappearSecond.click("Join")) throw new Error("Disappearance audit opponent could not join the room.");
  await disappearSecond.waitFor(`!!document.querySelector(".setup-panel")`, "disappearance audit setup");
  let disappearSetupWaits = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let progressed = false;
    for (const browser of [disappearFirst, disappearSecond]) {
      const clicked = await browser.evaluate(`(() => { const phase = document.querySelector(".setup-panel h2")?.textContent?.trim(); const buttons = [...document.querySelectorAll(".setup-options button")].filter((candidate) => !candidate.disabled); const button = phase === "starting choice" ? buttons.find((candidate) => candidate.textContent?.trim().toLowerCase().includes("draw research")) : buttons[0]; if (!button) return false; button.click(); return true; })()`);
      if (clicked) { progressed = true; disappearSetupWaits = 0; await wait(120); break; }
    }
    if (!progressed) {
      if (await disappearFirst.evaluate("!document.querySelector('.setup-panel')") && await disappearSecond.evaluate("!document.querySelector('.setup-panel')")) break;
      disappearSetupWaits += 1;
      if (disappearSetupWaits >= 8) throw new Error("Disappearance audit room stalled during setup without an enabled choice.");
      await wait(180);
    }
  }
  await disappearFirst.waitFor("!document.querySelector('.setup-panel')", "disappearance first setup completion");
  await disappearSecond.waitFor("!document.querySelector('.setup-panel')", "disappearance second setup completion");
  if (!await disappearFirst.click("Ready") || !await disappearSecond.click("Ready")) throw new Error("Disappearance audit players did not expose Ready controls.");
  await Promise.all([disappearFirst, disappearSecond].map((browser) => browser.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "disappearance audit Move phase")));
  const disappearActive = await disappearFirst.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${disappearRoomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
    const room = await response.json();
    const participant = room.participants?.find((entry) => entry.id === session.participantId);
    return { status: response.status, roomVersion: room.version, participantId: session.participantId, participantRole: participant?.role,
      participantPlayerIndex: participant?.playerIndex, currentPlayer: room.state.currentPlayer,
      participants: room.participants?.map((entry) => ({ id: entry.id, role: entry.role, playerIndex: entry.playerIndex, connected: entry.connected })),
      phase: room.state.phase, pendingDecision: room.state.pendingDecision, movedPieceIds: room.state.movedPieceIds ?? [],
      setupAssignments: room.state.setupAssignments, monsters: room.state.monsters.map((monster) => ({ id: monster.id, name: monster.name, location: monster.location })),
      eventIds: room.state.eventLog.map((event) => event.id), eventCount: room.state.eventLog.length };
  })()`);
  if (disappearActive.status !== 200 || disappearActive.phase !== "move" || disappearActive.participantRole !== "player"
    || disappearActive.participantPlayerIndex !== disappearActive.currentPlayer
    || disappearActive.pendingDecision?.type !== "monster-movement") {
    throw new Error(`Disappearance audit did not start at an active online Move decision: ${JSON.stringify(disappearActive)}`);
  }
  const disappearMonster = disappearActive.monsters[disappearActive.currentPlayer];
  const disappearAssignment = disappearActive.setupAssignments?.find((seat) => seat.playerIndex === disappearActive.currentPlayer && seat.monsterId === disappearMonster?.id);
  if (!disappearMonster || !disappearAssignment?.lair || disappearMonster.location !== disappearAssignment.lair
    || disappearMonster.location === "hollywood" || disappearActive.movedPieceIds.includes(disappearMonster.id)) {
    throw new Error(`Disappearance audit did not preserve the configured-lair, unmoved-monster eligibility boundary: ${JSON.stringify({ disappearMonster, disappearAssignment, movedPieceIds: disappearActive.movedPieceIds })}`);
  }
  const disappearBrowser = disappearActive.participantPlayerIndex === 0 ? disappearFirst : disappearSecond;
  const disappearActorLabel = disappearActive.participantPlayerIndex === 0 ? "first" : "second";
  const firstMatchGuideOpenForDisappear = await disappearBrowser.evaluate(`Boolean(document.querySelector(".onboarding"))`);
  if (firstMatchGuideOpenForDisappear) {
    if (!await disappearBrowser.clickSelector(".onboarding-actions button")) throw new Error("Disappearance audit player could not dismiss the first-match guide.");
    await disappearBrowser.waitFor(`!document.querySelector(".onboarding")`, "disappearance audit first-match guide dismissal");
  }
  const menuOpenForDisappear = await disappearBrowser.evaluate(`document.querySelector(".hud-menu")?.open === true`);
  if (!menuOpenForDisappear && !await disappearBrowser.clickSelector("details.hud-menu > summary")) throw new Error("Disappearance audit player could not open the game menu.");
  if (!await disappearBrowser.clickSelector(".hud-menu .settings-action")) throw new Error("Disappearance audit player could not open Settings from the game menu.");
  await disappearBrowser.waitFor(`!!document.querySelector(".settings-panel")`, "disappearance audit Settings panel");
  const disappearPreferenceBefore = await disappearBrowser.evaluate(`(() => { const label = [...document.querySelectorAll(".settings-grid label")].find((node) => node.textContent.includes("Confirm leave, concede, or disappear")); return { checked: label?.querySelector("input")?.checked, stored: localStorage.getItem("abominations-confirm-irreversible") }; })()`);
  if (disappearPreferenceBefore.checked !== true) throw new Error(`Disappearance audit did not begin with confirmation enabled: ${JSON.stringify(disappearPreferenceBefore)}`);
  if (!await disappearBrowser.clickSelector(".settings-panel .settings-grid label:nth-child(4)")) throw new Error("Disappearance audit player could not disable confirmation in Settings.");
  const disappearPreferenceAfter = await disappearBrowser.evaluate(`(() => { const label = [...document.querySelectorAll(".settings-grid label")].find((node) => node.textContent.includes("Confirm leave, concede, or disappear")); return { checked: label?.querySelector("input")?.checked, stored: localStorage.getItem("abominations-confirm-irreversible") }; })()`);
  if (disappearPreferenceAfter.checked !== false || disappearPreferenceAfter.stored !== "0") throw new Error(`Disappearance audit confirmation preference did not persist to storage: ${JSON.stringify(disappearPreferenceAfter)}`);
  const evidenceDir = join(process.cwd(), "output/ui-review");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "online-disappear-confirm-disabled-settings-2026-09-28.png"), await disappearBrowser.screenshot());
  await disappearBrowser.pressKey("Escape");
  await disappearBrowser.waitFor(`!document.querySelector(".settings-panel")`, "disappearance audit Settings close");
  const disappearFocusRestored = await disappearBrowser.evaluate(`document.querySelector(".hud-menu .settings-action") === document.activeElement`);
  const disappearPreferenceAfterEscape = await disappearBrowser.evaluate(`localStorage.getItem("abominations-confirm-irreversible")`);
  if (!disappearFocusRestored || disappearPreferenceAfterEscape !== "0") throw new Error(`Disappearance audit did not restore focus or retain the preference after Escape: ${JSON.stringify({ disappearFocusRestored, disappearPreferenceAfterEscape })}`);
  if (await disappearBrowser.evaluate(`document.querySelector(".hud-menu")?.open === true`)
    && !await disappearBrowser.clickSelector("details.hud-menu > summary")) throw new Error("Disappearance audit player could not close the game menu.");
  const disappearControlBounds = await disappearBrowser.evaluate(`(() => {
    const details = document.querySelector(".command-station .bottom-context-dock details.piece-context-tab");
    if (!details) return null;
    const summary = details.querySelector("summary");
    if (!details.open && summary) { summary.scrollIntoView({ block: "center", inline: "nearest" }); return { needsOpen: true, summary: (() => { const rect = summary.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })() }; }
    const button = [...details.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Disappear to lair" && !candidate.disabled);
    if (!button) return { needsOpen: false, missing: true };
    button.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { needsOpen: false, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, visible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && (hit === button || button.contains(hit)), disabled: button.disabled };
  })()`);
  if (disappearControlBounds?.needsOpen) {
    await disappearBrowser.clickPoint(disappearControlBounds.summary);
    await disappearBrowser.waitFor(`document.querySelector(".command-station .bottom-context-dock details.piece-context-tab")?.open === true`, "visible Move options disclosure");
  }
  const enabledDisappearControl = await disappearBrowser.evaluate(`(() => { const details = document.querySelector(".command-station .bottom-context-dock details.piece-context-tab"); const button = [...(details?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.trim() === "Disappear to lair"); if (!details?.open || !button || button.disabled) return null; button.scrollIntoView({ block: "center", inline: "nearest" }); const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, visible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && (hit === button || button.contains(hit)), disabled: button.disabled }; })()`);
  if (!enabledDisappearControl?.visible || enabledDisappearControl.disabled) {
    const uiDiagnostic = await disappearBrowser.evaluate(`(() => { const details = document.querySelector(".command-station .bottom-context-dock details.piece-context-tab"); return { open: details?.open, summary: details?.querySelector("summary")?.textContent?.trim(), content: details?.textContent?.trim(), buttons: [...(details?.querySelectorAll("button") ?? [])].map((button) => ({ text: button.textContent.trim(), aria: button.getAttribute("aria-label"), disabled: button.disabled })), selectedUnitRecord: document.querySelector(".unit-command-record h3")?.textContent?.trim(), monsterRecord: document.querySelector(".monster-command-record h3")?.textContent?.trim() }; })()`);
    throw new Error(`The production UI did not offer an enabled, visible disappearance control at the eligible Move step: ${JSON.stringify({ disappearControlBounds, enabledDisappearControl, uiDiagnostic })}`);
  }
  await disappearBrowser.evaluate(`(() => {
    const originalSend = WebSocket.prototype.send;
    window.__disabledDisappearAuditMessages = [];
    WebSocket.prototype.send = function(data) {
      if (typeof data === "string") {
        try { const message = JSON.parse(data); if (message.type === "command.submit") window.__disabledDisappearAuditMessages.push({ type: message.type, envelope: message.envelope }); } catch { /* ignore non-JSON websocket frames */ }
      }
      return originalSend.call(this, data);
    };
  })()`);
  const disappearDialogsBefore = disappearBrowser.dialogOpenings().length;
  disappearBrowser.setNextDialogResponse(true);
  await disappearBrowser.clickPoint({ x: enabledDisappearControl.x, y: enabledDisappearControl.y });
  await Promise.all([disappearFirst, disappearSecond].map((browser) => browser.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy"`, "disappearance result Deploy phase")));
  const disappearRequests = await disappearBrowser.evaluate(`window.__disabledDisappearAuditMessages ?? []`);
  const disappearAfter = await disappearBrowser.evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem("abominations-session") ?? "{}");
    const response = await fetch(${JSON.stringify(`${apiUrl}/rooms/${disappearRoomCode}/state?token=`)} + encodeURIComponent(session.token ?? ""));
    const room = await response.json();
    const event = room.state.eventLog.at(-1);
    const monster = room.state.monsters.find((entry) => entry.id === ${JSON.stringify(disappearMonster.id)});
    return { status: response.status, roomVersion: room.version, phase: room.state.phase, currentPlayer: room.state.currentPlayer,
      pendingDecision: room.state.pendingDecision, monster: monster ? { id: monster.id, location: monster.location } : null,
      movedPieceIds: room.state.movedPieceIds ?? [], encounterSuppressed: room.state.encounterSuppressed,
      participants: room.participants?.map((entry) => ({ id: entry.id, role: entry.role, playerIndex: entry.playerIndex, connected: entry.connected })),
      eventIds: room.state.eventLog.map((entry) => entry.id), eventCount: room.state.eventLog.length,
      lastEvent: event ? { id: event.id, actorId: event.actorId, action: event.action, detail: event.detail } : null };
  })()`);
  const disappearDialogCountAfter = disappearBrowser.dialogOpenings().length;
  const disappearNewEventIds = disappearAfter.eventIds.filter((eventId) => !disappearActive.eventIds.includes(eventId));
  const disappearCommands = disappearRequests.filter((request) => request.type === "command.submit");
  if (disappearCommands.length !== 1 || disappearCommands[0].envelope?.command?.type !== "disappear-monster"
    || disappearCommands[0].envelope?.actorId !== disappearActive.participantId
    || disappearCommands[0].envelope?.expectedRevision !== disappearActive.roomVersion
    || disappearCommands[0].envelope?.protocolVersion !== 1) {
    throw new Error(`Disabled-confirm disappearance did not submit exactly one current-revision command for the active player: ${JSON.stringify({ disappearActive, disappearRequests })}`);
  }
  if (disappearDialogCountAfter !== disappearDialogsBefore) throw new Error(`Disabled-confirm disappearance opened a native browser prompt: ${JSON.stringify(disappearBrowser.dialogOpenings())}`);
  if (disappearAfter.status !== 200 || disappearAfter.phase !== "deploy" || disappearAfter.currentPlayer !== disappearActive.currentPlayer
    || disappearAfter.pendingDecision?.type !== "deployment" || disappearAfter.pendingDecision?.playerIndex !== disappearActive.currentPlayer
    || disappearAfter.monster?.location !== "disappeared" || !disappearAfter.movedPieceIds.includes(disappearMonster.id)
    || disappearAfter.encounterSuppressed !== true || disappearAfter.lastEvent?.action !== "monster.disappeared"
    || disappearAfter.lastEvent?.detail?.monsterId !== disappearMonster.id || disappearAfter.lastEvent?.detail?.nextPhase !== "deploy"
    || disappearNewEventIds.length !== 1 || disappearAfter.eventCount !== disappearActive.eventCount + 1
    || disappearAfter.eventIds.slice(0, disappearActive.eventIds.length).some((eventId, index) => eventId !== disappearActive.eventIds[index])
    || JSON.stringify(disappearAfter.participants) !== JSON.stringify(disappearActive.participants)) {
    throw new Error(`Authoritative disappearance result did not match the engine contract or changed player connections: ${JSON.stringify({ disappearActive, disappearAfter, disappearNewEventIds })}`);
  }
  await writeFile(join(evidenceDir, "online-disappear-confirm-disabled-result-2026-09-28.png"), await disappearBrowser.screenshot());
  disabledConfirmDisappearEvidence = {
    roomCode: disappearRoomCode,
    actor: disappearActorLabel,
    viewport: "1280x720",
    input: "pointer",
    firstMatchGuideDismissedBeforeSettings: firstMatchGuideOpenForDisappear,
    eligibility: { phase: disappearActive.phase, currentPlayer: disappearActive.currentPlayer, monsterId: disappearMonster.id, monsterAtAssignedLair: true, lair: disappearAssignment.lair, notMoved: true, notHollywood: true, offeredByProductionUI: true },
    preference: { enabledBefore: disappearPreferenceBefore.checked, disabledAfter: disappearPreferenceAfter.checked, stored: disappearPreferenceAfter.stored, remainsStoredAfterEscape: disappearPreferenceAfterEscape },
    settingsEscapeRestoredFocus: disappearFocusRestored,
    browserDialogCountBefore: disappearDialogsBefore,
    browserDialogCountAfter: disappearDialogCountAfter,
    nativeConfirmationOpened: false,
    actionRequests: disappearCommands,
    playerConnectionsUnchanged: true,
    before: { roomVersion: disappearActive.roomVersion, phase: disappearActive.phase, currentPlayer: disappearActive.currentPlayer, participants: disappearActive.participants, eventCount: disappearActive.eventCount },
    after: { roomVersion: disappearAfter.roomVersion, phase: disappearAfter.phase, currentPlayer: disappearAfter.currentPlayer, pendingDecision: disappearAfter.pendingDecision, monster: disappearAfter.monster, event: disappearAfter.lastEvent, eventCount: disappearAfter.eventCount, appendedEventCount: disappearNewEventIds.length, participants: disappearAfter.participants },
    screenshots: ["online-disappear-confirm-disabled-settings-2026-09-28.png", "online-disappear-confirm-disabled-result-2026-09-28.png"],
  };

  const outputDir = join(process.cwd(), "output/ui-review");
  await mkdir(outputDir, { recursive: true });
  if (disabledConcedeEvidence) await writeFile(join(outputDir, "online-concede-confirm-disabled-2026-09-28.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), route: "main app route served by Vite with local in-memory API", ...disabledConcedeEvidence }, null, 2)}\n`);
  if (disabledConfirmDisappearEvidence) await writeFile(join(outputDir, "online-disappear-confirm-disabled-2026-09-28.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), route: "main app route served by Vite with local in-memory API", ...disabledConfirmDisappearEvidence }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, url, roomCode, setupClicks, boardCells: renderedBoardCells[0]?.count, boardIdentity: "shared-pinned-human-audit", spectatorSetup: "no-act", spectatorMove: "no-act", disconnect: disconnectState, reconnect: "online", reconnectRecovery: "verified", forgedCommand: "rejected-without-state-change", malformedCommand: "rejected-without-state-change", synchronizedPhase: "Move", reloadRecovery: "verified", onlineMovement: "verified", onlineFight, onlineEncounter: "verified", onlineDeploy: postEncounterPhase === "Deploy" ? "verified" : "skipped-after-victory", onlineResearchDraw, onlineConcession: concessionActor ? "verified" : "skipped-after-victory", disabledConfirmConcession: disabledConcedeEvidence, disabledConfirmDisappear: disabledConfirmDisappearEvidence, terminalProjection: "players-and-spectator", terminalReloadRecovery: "verified", concessionActor, nextPhase }));
} finally {
  await Promise.all([first?.close(), second?.close(), spectator?.close(), disappearFirst?.close(), disappearSecond?.close()]);
  await Promise.all([stopServer(apiServer), stopServer(webServer)]);
}
