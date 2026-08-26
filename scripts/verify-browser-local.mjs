import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import WebSocket from "ws";

const url = process.env.BROWSER_TEST_URL ?? "http://127.0.0.1:5177/";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewportWidth = Number(process.env.BROWSER_TEST_WIDTH ?? 1280);
const viewportHeight = Number(process.env.BROWSER_TEST_HEIGHT ?? 720);
const viewport = `${viewportWidth}x${viewportHeight}`;
const screenshotPath = process.env.BROWSER_TEST_SCREENSHOT_PATH;
const debugPort = 9229;
const profile = await mkdtemp(join(tmpdir(), "abominations-browser-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--window-size=${viewport}`,
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const debugUrl = `http://127.0.0.1:${debugPort}/json/list`;
let page;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(debugUrl);
    const pages = await response.json();
    page = pages.find((candidate) => candidate.type === "page");
    if (page) break;
  } catch {
    // Chrome is still starting.
  }
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
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
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
await command("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 600 });
await command("Page.navigate", { url });
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
const phase = () => evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() ?? document.querySelector(".setup-panel h2")?.textContent?.trim() ?? ""`);

try {
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start development playtest")`, "home screen");
  await clickButton("Start development playtest");
  await waitFor(`!!document.querySelector(".setup-panel")`, "development setup");

  for (let attempt = 0; attempt < 30 && await evaluate("!!document.querySelector('.setup-panel')"); attempt += 1) {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll(".setup-options button")].find((candidate) => !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error("Setup presented no enabled choice.");
    await wait(80);
  }
  await waitFor(`!document.querySelector(".setup-panel")`, "completed local setup");
  const setupPhase = await phase();
  if (!/move/i.test(setupPhase)) throw new Error(`Expected Move after setup, got ${setupPhase || "no phase"}.`);
  if (screenshotPath) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  const accessibleControls = await evaluate(`(() => {
    const controls = [...document.querySelectorAll("button, input, select, textarea")];
    const named = controls.every((control) => Boolean(control.textContent?.trim() || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || control.getAttribute("placeholder")));
    return Boolean(document.querySelector("main")) && named;
  })()`);
  if (!accessibleControls) throw new Error("Local browser smoke found an unnamed gameplay control or missing main landmark.");

  const invalidAction = await evaluate(`(() => {
    const tile = document.querySelector(".hex-tile.unreachable:disabled");
    if (!tile) return false;
    tile.click();
    return true;
  })()`);
  if (!invalidAction) throw new Error("Local browser smoke found no disabled unreachable destination for invalid-action coverage.");
  await wait(80);
  if (await evaluate(`Boolean(document.querySelector(".path-controls"))`)) throw new Error("An unreachable destination opened movement controls.");
  if (!/^Move$/i.test(await phase())) throw new Error("An unreachable destination changed the Move phase.");

  await waitFor(`document.querySelectorAll(".hex-tile.legal:not(:disabled)").length > 0`, "legal movement destination");
  const selected = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")];
    const tile = tiles.find((candidate) => candidate.getAttribute("data-location-name") === "Denver") ?? tiles[0];
    tile?.click();
    return Boolean(tile);
  })()`);
  if (!selected) throw new Error("No legal movement tile could be selected.");
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "path confirmation controls");
  await clickButton("Cancel");
  if (await evaluate(`!!document.querySelector(".path-controls")`)) throw new Error("Cancel did not clear the movement path.");
  await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(".hex-tile.legal:not(:disabled)")];
    (tiles.find((candidate) => candidate.getAttribute("data-location-name") === "Denver") ?? tiles[0])?.click();
  })()`);
  await waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "path confirmation after cancel");
  await clickButton("Confirm path");
  await wait(0);
  if (!await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Waiting for server…"`)) throw new Error("Local browser smoke did not expose the pending-action loading state.");
  await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "movement result");
  const afterMove = await phase();
  if (!afterMove) throw new Error("No phase prompt remained after confirming movement.");

  let fight = "not-reached";
  let encounter = "not-reached";
  let deployment = "not-reached";
  let settledPhase = afterMove;
  let finalPhase = settledPhase;
  if (afterMove === "Fight") {
    fight = "verified";
    for (let attempt = 0; attempt < 8 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Fight"`); attempt += 1) {
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button")].filter((button) => !button.disabled);
        const preferred = buttons.find((button) => button.textContent.trim() === "Confirm retreat")
          ?? buttons.find((button) => /^Attack /.test(button.textContent.trim()))
          ?? buttons.find((button) => /^(Resolve fight|Resolve without spending Infamy|Spend 1 Infamy)/.test(button.textContent.trim()))
          ?? buttons.find((button) => button.closest(".retreat-unit"));
        if (!preferred) return false;
        preferred.click();
        return true;
      })()`);
      if (!clicked) throw new Error("Fight exposed no enabled decision control.");
      await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "Fight result");
    }
    if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Fight"`)) throw new Error("Fight did not resolve within the supported decision steps.");
    settledPhase = await phase();
  }
  if (settledPhase === "Encounter") {
    encounter = "verified";
    for (let attempt = 0; attempt < 4 && await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`); attempt += 1) {
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll(".action-card button")].filter((button) => !button.disabled);
        const preferred = buttons.find((button) => /^(Resolve encounter|Take the city Health benefit|Take 2 Infamy instead|Take )/.test(button.textContent.trim()));
        const button = preferred ?? buttons[0];
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error("Encounter exposed no enabled decision control.");
      await waitFor(`!/^Waiting for server/.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "Encounter result");
    }
    if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Encounter"`)) throw new Error("Encounter did not resolve within the supported decision steps.");
  }
  if (await evaluate(`document.querySelector(".action-card h2")?.textContent?.trim() === "Deploy"`)) {
    if (!await clickButton("Pass deployment")) throw new Error("Deploy exposed no pass control after Encounter.");
    deployment = "verified";
    await waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "next Move phase after Deploy");
    finalPhase = await phase();
  }
  if (finalPhase !== "Move") throw new Error(`Expected the development turn to return to Move before terminal-state coverage, got ${finalPhase || "no phase"}.`);
  if (!await clickButton("Concede match")) throw new Error("Local browser smoke exposed no Concede match control.");
  await waitFor(`/^Victory · /.test(document.querySelector(".action-card h2")?.textContent?.trim() ?? "")`, "concession terminal phase");
  const concessionTerminal = await evaluate(`Boolean(document.querySelector(".victory-summary")) && Boolean([...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Start another local playtest"))`);
  if (!concessionTerminal) throw new Error("Concession did not expose the terminal victory summary and restart control.");

  console.log(JSON.stringify({ ok: true, url, viewport, setup: "complete", accessibleControls: "verified", invalidAction: "disabled-unreachable-destination", loadingState: "verified", pathCancel: "verified", pathConfirmation: "verified", fight, encounter, deployment, concessionTerminal: "verified", nextPhase: finalPhase }));
} finally {
  socket.close();
  chrome.kill("SIGKILL");
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
