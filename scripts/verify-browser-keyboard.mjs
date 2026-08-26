import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.env.BROWSER_TEST_URL ?? "http://127.0.0.1:5184/";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "abominations-keyboard-browser-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--window-size=1280,720", "--remote-debugging-port=9232", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const pages = await (await fetch("http://127.0.0.1:9232/json/list")).json();
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
await command("Page.enable");
await command("Runtime.enable");
await command("Accessibility.enable");
await command("Page.navigate", { url });
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const accessibilityTree = async () => (await command("Accessibility.getFullAXTree")).nodes ?? [];
const axValue = (entry) => typeof entry?.value === "object" ? entry.value.value : entry?.value;
const axText = (node) => ({
  role: axValue(node.role) ?? "",
  name: axValue(node.name) ?? "",
});
const assertAccessibility = async (label, checks) => {
  const nodes = (await accessibilityTree()).map(axText);
  for (const check of checks) {
    if (!nodes.some(check)) throw new Error(`Accessibility tree missing ${label}: ${check.description ?? "required semantic"}.`);
  }
};
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  const currentPhase = await evaluate('document.querySelector(".action-card h2")?.textContent?.trim() ?? "none"');
  const action = await evaluate('document.querySelector(".action-dock button:not(:disabled)")?.textContent?.trim() ?? "none"');
  throw new Error(`Timed out waiting for ${label}; phase=${currentPhase}; action=${action}.`);
};
const key = async (keyName, code) => {
  const keyCode = keyName === "Tab" ? 9 : 32;
  const params = { key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: 0 };
  await command("Input.dispatchKeyEvent", { type: "keyDown", ...params });
  await command("Input.dispatchKeyEvent", { type: "keyUp", ...params });
};
const activeMatches = async (predicate) => evaluate(`(() => { const element = document.activeElement; return Boolean(element && (${predicate})(element)); })()`);
const tabTo = async (predicate, label) => {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (await activeMatches(predicate)) return;
    await key("Tab", "Tab");
  }
  throw new Error(`Could not reach ${label} with keyboard Tab traversal.`);
};
const activate = async (predicate, label) => {
  await tabTo(predicate, label);
  await key(" ", "Space");
};
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? ""`);

try {
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Run temporary victory test")`, "home screen");
  await assertAccessibility("home", [
    Object.assign((node) => node.role === "main", { description: "main landmark" }),
    Object.assign((node) => node.role === "button" && node.name === "Run temporary victory test", { description: "temporary victory control" }),
  ]);
  await activate("(element) => element.textContent.trim() === \"Run temporary victory test\"", "temporary victory start");
  await waitFor(`!document.querySelector(".setup-panel") && document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "temporary victory scenario");
  await assertAccessibility("Move phase", [
    Object.assign((node) => node.role === "heading" && node.name === "Move", { description: "Move heading" }),
    Object.assign((node) => node.role === "button" && /San Francisco/.test(node.name), { description: "named San Francisco hex control" }),
    Object.assign((node) => /Match status/i.test(node.name), { description: "named match status live region" }),
  ]);

  const route = ["San Francisco", "Denver", "Seattle", "Chicago", "Infamy Site", "New York", "Los Angeles"];
  for (const destination of route) {
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} Move phase`);
    await activate(`(element) => element.matches(".hex-tile.legal:not(:disabled)") && element.getAttribute("data-location-name") === ${JSON.stringify(destination)}`, `${destination} destination`);
    await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm monster move" && !button.disabled && button.getBoundingClientRect().width > 0)`, `${destination} path confirmation control`);
    await assertAccessibility(`${destination} path`, [
      Object.assign((node) => node.role === "button" && node.name === "Confirm monster move", { description: "named movement confirmation" }),
    ]);
    await activate("(element) => element.tagName === \"BUTTON\" && element.textContent.trim() === \"Confirm monster move\" && !element.disabled && element.getBoundingClientRect().width > 0", `${destination} path confirmation`);
    await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} movement result`);
    if (await phase() === "Encounter") {
      await waitFor(`!![...document.querySelectorAll(".action-dock .action-dock-secondary")].find((button) => !button.disabled && button.getBoundingClientRect().width > 0)`, `${destination} encounter action readiness`);
      for (let attempt = 0; attempt < 4 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`); attempt += 1) {
        await activate("(element) => element.matches(\".action-dock .action-dock-secondary\") && element.getBoundingClientRect().width > 0", `${destination} open encounter controls`);
        await waitFor(`!![...document.querySelectorAll(".action-card button")].find((button) => !button.disabled && button.getBoundingClientRect().width > 0)`, `${destination} encounter control`);
        await assertAccessibility(`${destination} encounter`, [
          Object.assign((node) => node.role === "button" && /Resolve encounter|Take the city Health benefit|Take 2 Infamy instead|Take /.test(node.name), { description: "named encounter decision" }),
        ]);
        await activate("(element) => element.matches(\".action-card button:not(:disabled)\") && element.getBoundingClientRect().width > 0", `${destination} encounter control`);
        await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, `${destination} encounter result`);
      }
    } else {
      await waitFor(`!![...document.querySelectorAll(".action-dock button")].find((button) => button.textContent.trim() !== "Open controls" && !button.disabled && button.getBoundingClientRect().width > 0)`, `${destination} action readiness`);
    }
    if (await phase() === "Deploy") {
      await activate("(element) => element.tagName === \"BUTTON\" && element.textContent.trim() === \"Pass deployment\" && !element.disabled && element.getBoundingClientRect().width > 0", `${destination} deployment pass`);
      await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, `${destination} next Move phase`);
    }
  }
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "temporary victory terminal phase");
  const terminal = await evaluate(`Boolean(document.querySelector(".victory-summary")) && /temporary|development/i.test(document.body.textContent ?? "")`);
  if (!terminal) throw new Error("Keyboard playthrough did not expose its terminal summary.");
  await assertAccessibility("terminal", [
    Object.assign((node) => node.role === "heading" && /^Victory · /.test(node.name), { description: "Victory heading" }),
    Object.assign((node) => node.role === "button" && node.name === "Start another local playtest", { description: "terminal restart control" }),
  ]);
  console.log(JSON.stringify({ ok: true, url, input: "keyboard-tab-space", route, accessibilityTree: "verified", terminal: "verified" }));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
