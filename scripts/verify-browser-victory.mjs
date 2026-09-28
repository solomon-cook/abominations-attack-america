import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
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
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    if (avoid.has(address.port)) {
      probe.close(() => freePort(avoid).then(resolve, reject));
      return;
    }
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_VICTORY_PORT ?? await freePort());
const apiPort = Number(process.env.BROWSER_VICTORY_API_PORT ?? await freePort(new Set([port])));
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const apiUrl = process.env.BROWSER_API_URL ?? `http://127.0.0.1:${apiPort}`;
const ownsWebServer = !process.env.BROWSER_TEST_URL;
const ownsApiServer = !process.env.BROWSER_API_URL && ownsWebServer;
const startServer = ({ command, args, cwd, env, name }) => {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  return { child, output: () => output, name };
};
const stopServer = async (server) => {
  if (!server || server.child.exitCode !== null) return;
  const timeout = setTimeout(() => server.child.kill("SIGKILL"), 2000);
  server.child.kill("SIGTERM");
  await new Promise((resolve) => server.child.once("exit", resolve));
  clearTimeout(timeout);
};
let webServer;
let apiServer;
let chrome;
let socket;
const profile = await mkdtemp(join(tmpdir(), "abominations-victory-browser-"));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitForServer = async (server, ready) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.child.exitCode !== null) throw new Error(`${server.name} exited before becoming ready.\n${server.output()}`);
    try {
      if (await ready()) return;
    } catch { /* The service is still starting. */ }
    await wait(100);
  }
  throw new Error(`${server.name} did not become ready.\n${server.output()}`);
};
try {
if (ownsApiServer) {
  apiServer = startServer({
    command: process.execPath,
    args: ["--import", "tsx/esm", "src/server.ts"],
    cwd: join(process.cwd(), "apps/api"),
    env: { ...process.env, PORT: String(apiPort), PERSISTENCE: "memory", ALLOWED_ORIGIN: new URL(url).origin },
    name: "MVP API",
  });
  await waitForServer(apiServer, async () => (await fetch(`${apiUrl}/health`)).ok);
}
if (ownsWebServer) {
  webServer = startServer({
    command: process.execPath,
    args: [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)],
    cwd: join(process.cwd(), "apps/web"),
    env: { ...process.env, VITE_API_URL: apiUrl },
    name: "Vite",
  });
  await waitForServer(webServer, async () => (await fetch(url)).ok);
}
const chromePort = Number(process.env.BROWSER_VICTORY_CDP_PORT ?? await freePort(new Set([port, apiPort])));
chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--window-size=1280,720", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const pages = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
    page = pages.find((candidate) => candidate.type === "page");
    if (page) break;
  } catch { /* Chrome is still starting. */ }
  await wait(100);
}
if (!page?.webSocketDebuggerUrl) throw new Error("Chrome debugging page did not become available.");

socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
let nextId = 0;
const pending = new Map();
const browserDiagnostics = [];
const requestUrls = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === "Runtime.exceptionThrown") browserDiagnostics.push({ type: "exception", details: message.params.exceptionDetails?.text ?? "JavaScript exception" });
  if (message.method === "Runtime.consoleAPICalled") {
    const values = message.params.args?.map((argument) => argument.value ?? argument.description ?? "").join(" ") ?? "";
    if (values) browserDiagnostics.push({ type: "console", level: message.params.type, text: values });
  }
  if (message.method === "Network.requestWillBeSent") requestUrls.set(message.params.requestId, message.params.request.url);
  if (message.method === "Network.loadingFailed") browserDiagnostics.push({ type: "network-failed", url: requestUrls.get(message.params.requestId) ?? message.params.requestId, error: message.params.errorText });
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === "Page.javascriptDialogOpening") void command("Page.handleJavaScriptDialog", { accept: true });
});
await command("Page.enable");
await command("Runtime.enable");
await command("Network.enable");
await command("Page.navigate", { url });
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  const snapshot = await evaluate(`JSON.stringify({ title: document.title, url: location.href, text: document.body?.innerText?.slice(0, 3500), buttons: [...document.querySelectorAll("button")].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled, visible: button.getClientRects().length > 0 })), alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent.trim()), phase: document.querySelector(".action-card h2")?.textContent?.trim() ?? null })`);
  throw new Error(`Timed out waiting for ${label}. Browser state: ${snapshot}\nBrowser diagnostics: ${JSON.stringify(browserDiagnostics)}`);
};
const clickButton = async (label) => evaluate(`(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled && candidate.getClientRects().length > 0);
  if (!button) return false;
  button.click();
  return true;
})()`);
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? ""`);
const actionSignature = () => evaluate(`JSON.stringify({ phase: document.querySelector(".action-card h2")?.textContent?.trim() ?? "", controls: [...document.querySelectorAll("button")].filter((button) => !button.disabled && button.getClientRects().length > 0).map((button) => button.textContent.trim()).filter(Boolean) })`);

  await waitFor(`Boolean(document.querySelector(".home-screen") && document.querySelector(".home-tools"))`, "home screen");
  await evaluate(`(() => { const details = document.querySelector(".home-tools"); if (details) details.open = true; })()`);
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Victory test" && button.getClientRects().length > 0)`, "visible victory test tool");
  await clickButton("Victory test");
  await waitFor(`!document.querySelector(".setup-panel") && document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "temporary victory scenario");
  const route = ["San Francisco", "Denver", "Seattle", "Chicago", "Infamy Site", "New York", "Los Angeles"];
  for (const destination of route) {
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} Move phase`);
    const activeMonsterName = await evaluate(`document.querySelector(".hex-tile.active .tile-monster")?.getAttribute("alt") ?? ""`);
    if (!activeMonsterName) throw new Error(`Could not identify the active monster before moving to ${destination}.`);
    const selected = await evaluate(`(() => {
      const tile = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].find((candidate) => candidate.getAttribute("data-location-name") === ${JSON.stringify(destination)});
      tile?.click();
      return Boolean(tile);
    })()`);
    if (!selected) {
      const state = await evaluate(`JSON.stringify({ phase: document.querySelector(".action-card h2")?.textContent?.trim(), visibleButtons: [...document.querySelectorAll("button")].filter((button) => button.getClientRects().length).map((button) => button.textContent.trim()).filter(Boolean), legalTiles: [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].map((tile) => tile.getAttribute("data-location-name")), monsters: [...document.querySelectorAll(".hex-tile")].flatMap((tile) => [...tile.querySelectorAll(".tile-monster")].map((monster) => ({ name: monster.getAttribute("alt"), location: tile.getAttribute("data-location-name") }))) })`);
      throw new Error(`No legal rendered destination for ${destination}. Browser state: ${state}`);
    }
    await waitFor(`!![...document.querySelectorAll("button")].find((button) => /^(Confirm move|Confirm path)$/.test(button.textContent.trim()) && !button.disabled && button.getClientRects().length > 0)`, `${destination} move confirmation`);
    const confirmLabel = await evaluate(`([...document.querySelectorAll("button")].find((button) => /^(Confirm move|Confirm path)$/.test(button.textContent.trim()) && !button.disabled && button.getClientRects().length > 0)?.textContent?.trim() ?? "")`);
    if (!confirmLabel || !await clickButton(confirmLabel)) throw new Error(`${destination} movement did not expose its confirmation control.`);
    await waitFor(`document.querySelector('.hex-tile[data-location-name="${destination}"] .tile-monster[alt=${JSON.stringify(activeMonsterName)}]') && document.querySelector(".action-card h2")?.textContent?.trim() !== "Waiting for server…"`, `${destination} movement result`);
    console.log(`${activeMonsterName} reached ${destination}; phase=${await phase()}`);
    if (await phase() === "Move" && await evaluate(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Continue to Fight" && !button.disabled && button.getClientRects().length > 0)`)) {
      if (!await clickButton("Continue to Fight")) throw new Error(`${destination} movement did not expose its phase transition.`);
      await waitFor(`!(["Move", "Waiting for server…"].includes(document.querySelector(".action-card h2")?.textContent?.trim() ?? ""))`, `${destination} move phase transition`);
      console.log(`${destination} Move resolved; phase=${await phase()}`);
    }
    if (await phase() === "Encounter") {
      for (let attempt = 0; attempt < 4 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`); attempt += 1) {
        await waitFor(`!![...document.querySelectorAll("button")].find((button) => !button.disabled && button.getClientRects().length > 0 && /^(Resolve encounter|Resolve city stomp|Reveal encounter|Roll all .* dice|Take the city Health benefit|Take 2 Infamy instead|Take |Return to board)/.test(button.textContent.trim()))`, `${destination} Encounter control`);
        const previousSignature = await actionSignature();
        const selectedEncounterControl = await evaluate(`(() => {
          const buttons = [...document.querySelectorAll("button")].filter((button) => !button.disabled && button.getClientRects().length > 0);
          const preferred = buttons.find((button) => /^(Reveal encounter|Roll all .* dice|Resolve city stomp|Take the city Health benefit|Take 2 Infamy instead|Take |Return to board)/.test(button.textContent.trim()))
            ?? buttons.find((button) => button.textContent.trim() === "Resolve encounter");
          const button = preferred;
          button?.click();
          return button?.textContent.trim() ?? "";
        })()`);
        if (!selectedEncounterControl) {
          const state = await evaluate(`JSON.stringify({ text: document.body?.innerText?.slice(-2200), visibleButtons: [...document.querySelectorAll("button")].filter((button) => button.getClientRects().length > 0).map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })) })`);
          throw new Error(`${destination} Encounter exposed no supported visible control. Browser state: ${state}`);
        }
        console.log(`${destination} Encounter selected ${selectedEncounterControl}`);
        await waitFor(`(() => { const heading = document.querySelector(".action-card h2")?.textContent?.trim() ?? ""; if (heading === "Waiting for server…") return false; const current = JSON.stringify({ phase: heading, controls: [...document.querySelectorAll("button")].filter((button) => !button.disabled && button.getClientRects().length > 0).map((button) => button.textContent.trim()).filter(Boolean) }); return heading !== "Encounter" || current !== ${JSON.stringify(previousSignature)}; })()`, `${destination} Encounter result`);
        console.log(`${destination} Encounter advanced; phase=${await phase()}`);
      }
    }
    if (await evaluate(`Boolean(document.querySelector('dialog.resolution-stage[aria-label="Encounter resolved"]'))`)) {
      await evaluate(`document.querySelector('dialog.resolution-stage[aria-label="Encounter resolved"] .resolution-close')?.click()`);
    }
    if (await phase() === "Deploy") {
      if (!await clickButton("Deploy military")) throw new Error(`${destination} Deploy did not expose the military sheet.`);
      await waitFor(`Boolean(document.querySelector(".physical-military-sheet"))`, `${destination} military sheet`);
      const researchTab = await evaluate(`(() => { const button = [...document.querySelectorAll(".military-section-nav button")].find((candidate) => candidate.textContent.trim().startsWith("Military research") && candidate.getClientRects().length > 0); button?.click(); return Boolean(button); })()`);
      if (!researchTab) throw new Error(`${destination} military sheet did not expose its Research tab.`);
      await waitFor(`Boolean(document.querySelector(".military-research-draw-choice") && !document.querySelector(".military-research-draw-choice").disabled && document.querySelector(".military-research-draw-choice").getClientRects().length > 0)`, `${destination} deployment Research option`);
      await evaluate(`document.querySelector(".military-research-draw-choice")?.click()`);
      await waitFor(`(() => { const heading = document.querySelector(".action-card h2")?.textContent?.trim() ?? ""; return heading === "Move" || /^Victory · /.test(heading); })()`, `${destination} next Move phase or terminal result`);
      if (await evaluate(`Boolean(document.querySelector('dialog.resolution-stage[aria-label="Research"]'))`)) {
        await evaluate(`document.querySelector('dialog.resolution-stage[aria-label="Research"] .resolution-close')?.click()`);
      }
    }
    if ((await phase()).startsWith("Victory · ")) break;
  }
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "temporary victory terminal phase");
  const terminal = await evaluate(`Boolean(document.querySelector(".victory-summary")) && /temporary|development/i.test(document.body.textContent ?? "")`);
  if (!terminal) throw new Error("Temporary victory did not expose its terminal summary.");
  if (!await clickButton("Start another local playtest")) throw new Error("Temporary victory did not expose its local restart path.");
  await waitFor(`Boolean(document.querySelector(".setup-panel") && document.querySelector(".game-screen"))`, "restart from temporary victory to local setup");
  console.log(JSON.stringify({ ok: true, url, scenario: "temporary-victory", route, terminal: "verified", restartToLocalSetup: true }));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close(); else socket?.terminate();
  chrome?.kill("SIGKILL");
  if (chrome && chrome.exitCode === null) await new Promise((resolve) => chrome.once("exit", resolve));
  const cleanup = await Promise.allSettled([
    stopServer(webServer),
    stopServer(apiServer),
    rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  ]);
  const cleanupError = cleanup.find((result) => result.status === "rejected");
  if (cleanupError) throw cleanupError.reason;
}
