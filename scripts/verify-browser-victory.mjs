import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { chromePath } from "./chrome-path.mjs";

const port = Number(process.env.BROWSER_VICTORY_PORT ?? 5183);
const ownsServer = !process.env.BROWSER_TEST_URL;
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = ownsServer
  ? spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] })
  : undefined;
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const profile = await mkdtemp(join(tmpdir(), "abominations-victory-browser-"));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      await wait(100);
    }
  }
  if (!ready) {
    server.kill("SIGTERM");
    throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
  }
}
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--window-size=1280,720", "--remote-debugging-port=9231", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const pages = await (await fetch("http://127.0.0.1:9231/json/list")).json();
    page = pages.find((candidate) => candidate.type === "page");
    if (page) break;
  } catch { /* Chrome is still starting. */ }
  await wait(100);
}
if (!page?.webSocketDebuggerUrl) throw new Error("Chrome debugging page did not become available.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
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
await command("Page.navigate", { url });
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  const state = await evaluate(`JSON.stringify({ phase: document.querySelector(".action-card h2")?.textContent?.trim(), action: document.querySelector(".action-dock button")?.textContent?.trim(), status: document.querySelector(".action-dock-status")?.textContent?.trim(), error: document.querySelector(".error")?.textContent?.trim() })`);
  throw new Error(`Timed out waiting for ${label}. Browser state: ${state}`);
};
const clickButton = async (label) => evaluate(`(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent.trim() === ${JSON.stringify(label)} || candidate.textContent.trim().startsWith(${JSON.stringify(label)})) && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`);
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? ""`);

try {
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Victory test")`, "home screen");
  await clickButton("Victory test");
  await waitFor(`!document.querySelector(".setup-panel") && document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "temporary victory scenario");
  const route = ["San Francisco", "Denver", "Seattle", "Chicago", "Infamy Site", "New York", "Los Angeles"];
  for (const destination of route) {
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} Move phase`);
    const selected = await evaluate(`(() => {
      const tile = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].find((candidate) => candidate.getAttribute("data-location-name") === ${JSON.stringify(destination)});
      tile?.click();
      return Boolean(tile);
    })()`);
    if (!selected) {
      const state = await evaluate(`JSON.stringify({ phase: document.querySelector(".action-card h2")?.textContent?.trim(), legalDestinations: [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].map((tile) => tile.getAttribute("data-location-name")), status: document.querySelector(".action-dock-status")?.textContent?.trim() })`);
      throw new Error(`No legal rendered destination for ${destination}. Browser state: ${state}`);
    }
    await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm move")`, `${destination} path confirmation`);
    const movementCount = await evaluate(`document.querySelectorAll(".movement-piece.completed").length`);
    await clickButton("Confirm move");
    await waitFor(`document.querySelectorAll(".movement-piece.completed").length > ${movementCount}`, `${destination} movement result`);
    if (await phase() === "Move") {
      const ended = await evaluate(`(() => { const button = document.querySelector(".end-movement:not(:disabled)"); button?.click(); return Boolean(button); })()`);
      if (!ended) throw new Error(`${destination} movement exposed no enabled End movement control.`);
      await waitFor(`["Fight", "Encounter"].includes(document.querySelector(".action-card h2")?.textContent?.trim())`, `${destination} post-movement phase`);
    }
    if (await phase() === "Fight") {
      if (await evaluate(`document.querySelectorAll(".hex-tile.battle:not(:disabled)").length > 0`)) throw new Error(`${destination} unexpectedly created a battle in the no-units victory fixture.`);
      if (!await clickButton("Continue to Encounter")) throw new Error(`${destination} Fight did not expose Continue to Encounter.`);
      await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`, `${destination} Encounter phase`);
    }
    if (await phase() === "Encounter") {
      const pendingChoice = await evaluate(`document.querySelector(".action-dock button")?.textContent?.trim() === "Choose encounter option"`);
      const routineRoll = await evaluate(`document.querySelector(".action-dock button")?.textContent?.trim().startsWith("Roll all")`);
      if (pendingChoice) {
        if (!await clickButton("Choose encounter option")) throw new Error(`${destination} encounter reward choice was not exposed.`);
        const reward = await evaluate(`([...document.querySelectorAll("button:not(:disabled)")].find((button) => /^Take .* Health|^Take 2 Infamy/.test(button.textContent.trim()))?.textContent ?? "").trim()`);
        if (!reward || !await clickButton(reward)) throw new Error(`${destination} encounter has no legal reward choice.`);
        await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy" || /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} encounter choice`);
      } else if (routineRoll) {
        const rollLabel = await evaluate(`document.querySelector(".action-dock button")?.textContent?.trim()`);
        if (!rollLabel || !await clickButton(rollLabel)) throw new Error(`${destination} could not resolve its city stomp roll.`);
        await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy" || /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "") || document.querySelector(".action-dock button")?.textContent?.trim() === "Choose encounter option"`, `${destination} city stomp result`);
        if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`)) {
          if (!await clickButton("Choose encounter option")) throw new Error(`${destination} city reward choice was not exposed.`);
          const reward = await evaluate(`([...document.querySelectorAll("button:not(:disabled)")].find((button) => /^Take .* Health|^Take 2 Infamy/.test(button.textContent.trim()))?.textContent ?? "").trim()`);
          if (!reward || !await clickButton(reward)) throw new Error(`${destination} city reward has no legal choice.`);
          await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy" || /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} city reward resolution`);
        }
      } else {
        if (!await clickButton("Resolve encounter")) throw new Error(`${destination} Encounter exposed no Resolve encounter action.`);
        await waitFor(`!!document.querySelector(".cinema-intro button") || document.querySelector(".action-dock button")?.textContent?.trim() === "Choose encounter option" || document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy" || /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} encounter resolution prompt`);
        if (await evaluate(`document.querySelector(".action-dock button")?.textContent?.trim() === "Choose encounter option"`)) {
          await clickButton("Choose encounter option");
          const reward = await evaluate(`([...document.querySelectorAll("button:not(:disabled)")].find((button) => /^Take .* Health|^Take 2 Infamy/.test(button.textContent.trim()))?.textContent ?? "").trim()`);
          if (!reward || !await clickButton(reward)) throw new Error(`${destination} encounter has no legal reward choice.`);
          await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy" || /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} encounter choice`);
        } else if (await evaluate(`!!document.querySelector(".cinema-intro button")`)) {
          if (!await clickButton("Reveal encounter")) throw new Error(`${destination} encounter reveal action was unavailable.`);
          const remainingRolls = await evaluate(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Reveal remaining rolls")`);
          if (remainingRolls) await clickButton("Reveal remaining rolls");
          const choice = await evaluate(`document.querySelector(".cinema-choice button")?.textContent?.trim()`);
          if (choice && !await clickButton(choice)) throw new Error(`${destination} could not choose its encounter reward.`);
          await waitFor(`!!document.querySelector(".cinema-primary") && ([...document.querySelectorAll(".cinema-primary")].some((button) => button.textContent.includes("Return to board")) || !["Encounter", "Waiting for server…"].includes(document.querySelector(".action-card h2")?.textContent?.trim()))`, `${destination} encounter resolution`);
          if (await evaluate(`!![...document.querySelectorAll("button")].find((button) => button.textContent.includes("Return to board"))`)) await clickButton("Return to board →");
        }
      }
    }
    if (await phase() === "Deploy") {
      if (!await clickButton("Pass deployment")) {
        const opened = await evaluate(`(() => { const details = document.querySelector("#phase-command-context"); if (!details) return false; details.open = true; return true; })()`);
        if (!opened || !await clickButton("Pass deployment")) throw new Error(`${destination} Deploy exposed no pass control.`);
      }
      await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} next Move phase`);
    }
  }
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "temporary victory terminal phase");
  const terminal = await evaluate(`(() => { const summary = document.querySelector(".victory-summary")?.textContent ?? ""; return summary.includes("development-board-exhaustion") && /^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? ""); })()`);
  if (!terminal) throw new Error("Temporary victory did not expose its terminal summary.");
  console.log(JSON.stringify({ ok: true, url, scenario: "temporary-victory", route, terminal: "verified" }));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once("exit", resolve));
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
