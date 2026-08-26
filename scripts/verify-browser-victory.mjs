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
  throw new Error(`Timed out waiting for ${label}.`);
};
const clickButton = async (label) => evaluate(`(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`);
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? ""`);

try {
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Run temporary victory test")`, "home screen");
  await clickButton("Run temporary victory test");
  await waitFor(`!document.querySelector(".setup-panel") && document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "temporary victory scenario");
  const route = ["San Francisco", "Denver", "Seattle", "Chicago", "Infamy Site", "New York", "Los Angeles"];
  for (const destination of route) {
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} Move phase`);
    const selected = await evaluate(`(() => {
      const tile = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")].find((candidate) => candidate.getAttribute("data-location-name") === ${JSON.stringify(destination)});
      tile?.click();
      return Boolean(tile);
    })()`);
    if (!selected) throw new Error(`No legal rendered destination for ${destination}.`);
    await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, `${destination} path confirmation`);
    await clickButton("Confirm path");
    await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} movement result`);
    if (await phase() === "Encounter") {
      for (let attempt = 0; attempt < 4 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`); attempt += 1) {
        const resolved = await evaluate(`(() => {
          const buttons = [...document.querySelectorAll(".action-card button")].filter((button) => !button.disabled);
          const preferred = buttons.find((button) => /^(Resolve encounter|Take the city Health benefit|Take 2 Infamy instead|Take )/.test(button.textContent.trim()));
          const button = preferred ?? buttons[0];
          button?.click();
          return Boolean(button);
        })()`);
        if (!resolved) throw new Error(`${destination} Encounter exposed no enabled control.`);
        await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} Encounter result`);
      }
    }
    if (await phase() === "Deploy") {
      if (!await clickButton("Pass deployment")) throw new Error(`${destination} Deploy exposed no pass control.`);
      await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} next Move phase`);
    }
  }
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "temporary victory terminal phase");
  const terminal = await evaluate(`Boolean(document.querySelector(".victory-summary")) && /temporary|development/i.test(document.body.textContent ?? "")`);
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
