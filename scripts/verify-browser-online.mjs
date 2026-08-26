import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
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
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.navigate", { url });
  const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(100);
    }
    const diagnostic = await evaluate(`({ url: location.href, connection: document.querySelector(".connection")?.textContent?.trim(), error: document.querySelector(".error")?.textContent?.trim(), lobby: document.querySelector(".lobby")?.textContent?.trim(), phase: document.querySelector(".action-card h2")?.textContent?.trim() })`);
    throw new Error(`${name}: timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  };
  return {
    evaluate,
    waitFor,
    restart: async () => {
      socket.close();
      child.kill("SIGKILL");
      if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
      return openBrowser(port, name, profile);
    },
    click: (label) => evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled); if (!button) return false; button.click(); return true; })()`),
    close: async () => {
      socket.close();
      child.kill("SIGKILL");
      if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
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
      env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory" },
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
  if (new Set(boardIdentityKeys).size !== 1 || boardIdentities[0]?.id !== "provisional-authoritative-honeycomb-board" || boardIdentities[0]?.renderedId !== boardIdentities[0]?.id || boardIdentities[0]?.renderedHash !== boardIdentities[0]?.hash) {
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let progressed = false;
    for (const browser of [first, second]) {
      const preferredStartingChoice = browser === first ? "Development Deploy" : "Draw Research";
      const clicked = await browser.evaluate(`(() => { const phase = document.querySelector(".setup-panel h2")?.textContent?.trim(); const buttons = [...document.querySelectorAll(".setup-options button")].filter((candidate) => !candidate.disabled); const button = phase === "starting choice" ? buttons.find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(preferredStartingChoice)}) : buttons[0]; if (!button) return false; button.click(); return true; })()`);
      if (clicked) { setupClicks += 1; progressed = true; await wait(120); break; }
    }
    if (!progressed) {
      const complete = await first.evaluate("!document.querySelector('.setup-panel')") && await second.evaluate("!document.querySelector('.setup-panel')");
      if (complete) break;
      throw new Error("Neither online browser exposed the current setup choice.");
    }
  }
  await first.waitFor("!document.querySelector('.setup-panel')", "first setup completion");
  await second.waitFor("!document.querySelector('.setup-panel')", "second setup completion");
  if (!await first.click("Ready") || !await second.click("Ready")) throw new Error("Both players did not expose Ready controls.");
  await first.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "first Move phase");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "second Move phase");
  await spectator.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "spectator Move projection");
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
  const reconnectedFirst = await first.restart();
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
  if (!await first.evaluate(`(() => { const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")]; const tile = tiles.find((candidate) => candidate.querySelector('img[alt^="Navy "]')) ?? tiles.find((candidate) => candidate.getAttribute("data-location-name") === "Denver") ?? tiles[0]; tile?.click(); return Boolean(tile); })()`)) throw new Error("First browser could not select an online legal destination.");
  await first.waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "online path confirmation");
  if (!await first.click("Confirm path")) throw new Error("First browser could not confirm the online path.");
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
  const clickEncounterDecision = async () => {
    for (const [browser, label] of [[first, "first"], [second, "second"]]) {
      const clicked = await browser.evaluate(`(() => { const button = [...document.querySelectorAll(".action-card button")].find((candidate) => !candidate.disabled); if (!button) return false; button.click(); return true; })()`);
      if (clicked) {
        await browser.waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${label} Encounter response`);
        return true;
      }
    }
    return false;
  };
  const encounterAction = await clickEncounterDecision();
  if (!encounterAction) throw new Error("First browser exposed no legal Encounter action.");
  for (let encounterStep = 0; encounterStep < 4; encounterStep += 1) {
    const currentPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
    if (currentPhase === "Deploy") break;
    if (currentPhase !== "Encounter") throw new Error(`Expected Encounter or Deploy after Encounter action, got ${currentPhase ?? "unknown"}.`);
    const followUp = await clickEncounterDecision();
    if (!followUp) throw new Error("Encounter remained active without an enabled legal decision control in either player session.");
  }
  const deployPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === ${JSON.stringify(deployPhase)}`, "second synchronized post-encounter phase");
  if (deployPhase !== "Deploy") throw new Error(`Expected Deploy after Encounter, got ${deployPhase ?? "unknown"}.`);
  if (!await first.click("Pass deployment")) throw new Error("First browser could not pass Deploy.");
  await first.waitFor(`(() => { const phase = document.querySelector(".action-card h2")?.textContent?.trim(); return phase === "Move"; })()`, "first next Move phase");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "second synchronized next Move phase");
  const concessionActor = await first.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Concede match" && !candidate.disabled); if (!button) return false; button.click(); return true; })()`) ? "first" : await second.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Concede match" && !candidate.disabled); if (!button) return false; button.click(); return true; })()`) ? "second" : undefined;
  if (!concessionActor) throw new Error("Neither online player exposed an enabled Concede match control.");
  for (const [browser, label] of [[first, "first terminal"], [second, "second terminal"], [spectator, "spectator terminal"]]) {
    await browser.waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, label);
    const terminalSummary = await browser.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
    if (!terminalSummary) throw new Error(`${label} did not render the authoritative terminal summary.`);
  }
  await second.evaluate("location.reload()");
  await second.waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "reloaded second terminal");
  const reloadedTerminal = await second.evaluate(`Boolean(document.querySelector(".victory-summary")?.textContent?.includes("Victory type:"))`);
  if (!reloadedTerminal) throw new Error("Reloaded second browser lost the terminal result.");
  console.log(JSON.stringify({ ok: true, url, roomCode, setupClicks, boardCells: renderedBoardCells[0]?.count, boardIdentity: "shared-pinned-best-guess-honeycomb", spectatorSetup: "no-act", spectatorMove: "no-act", disconnect: disconnectState, reconnect: "online", reconnectRecovery: "verified", forgedCommand: "rejected-without-state-change", malformedCommand: "rejected-without-state-change", synchronizedPhase: "Move", reloadRecovery: "verified", onlineMovement: "verified", onlineFight, onlineEncounter: "verified", onlineDeploy: "verified", onlineConcession: "verified", terminalProjection: "players-and-spectator", terminalReloadRecovery: "verified", concessionActor, nextPhase }));
} finally {
  await Promise.all([first?.close(), second?.close(), spectator?.close()]);
  await Promise.all([stopServer(apiServer), stopServer(webServer)]);
}
