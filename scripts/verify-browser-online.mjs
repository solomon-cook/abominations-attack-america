import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import WebSocket from "ws";

const url = process.env.BROWSER_TEST_URL ?? "http://127.0.0.1:5177/";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function openBrowser(port, name) {
  const profile = await mkdtemp(join(tmpdir(), `abominations-online-${name}-`));
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
    throw new Error(`${name}: timed out waiting for ${label}.`);
  };
  return {
    evaluate,
    waitFor,
    click: (label) => evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled); if (!button) return false; button.click(); return true; })()`),
    close: async () => {
      socket.close();
      child.kill("SIGKILL");
      if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

const first = await openBrowser(9230, "first");
const second = await openBrowser(9231, "second");
try {
  await first.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "first lobby");
  await first.evaluate(`(() => { const input = document.querySelector('[aria-label="Display name"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, "First player"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await first.click("Create")) throw new Error("First browser could not create a room.");
  await first.waitFor(`!!document.querySelector(".lobby strong")`, "created room code");
  const roomCode = await first.evaluate(`document.querySelector(".lobby strong")?.textContent?.trim()`);
  if (!roomCode) throw new Error("Created room did not expose a room code.");

  await second.waitFor(`!!document.querySelector('[aria-label="Display name"]')`, "second lobby");
  await second.evaluate(`(() => { const inputs = document.querySelectorAll('input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(inputs[0], "Second player"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); setter.call(inputs[1], ${JSON.stringify(roomCode)}); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); })()`);
  if (!await second.click("Join")) throw new Error("Second browser could not join the created room.");
  await second.waitFor(`!!document.querySelector(".lobby strong")`, "joined room code");

  let setupClicks = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let progressed = false;
    for (const browser of [first, second]) {
      const clicked = await browser.evaluate(`(() => { const button = [...document.querySelectorAll(".setup-options button")].find((candidate) => !candidate.disabled); if (!button) return false; button.click(); return true; })()`);
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
  await second.evaluate("location.reload()");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "reloaded second Move phase");
  await first.waitFor(`document.querySelectorAll(".hex-tile.legal:not(:disabled)").length > 0`, "online legal movement destination");
  if (!await first.evaluate(`(() => { const tile = document.querySelector(".hex-tile.legal:not(:disabled)"); tile?.click(); return Boolean(tile); })()`)) throw new Error("First browser could not select an online legal destination.");
  await first.waitFor(`!![...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm path")`, "online path confirmation");
  if (!await first.click("Confirm path")) throw new Error("First browser could not confirm the online path.");
  await first.waitFor(`(() => { const phase = document.querySelector(".action-card h2")?.textContent?.trim(); return phase !== "Move" && phase !== "Waiting for server…"; })()`, "first settled post-move phase");
  const nextPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() !== "Move"`, "second post-move phase");
  const secondPhase = await second.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  if (secondPhase !== nextPhase) throw new Error(`Online phase divergence after movement: first=${nextPhase ?? "unknown"}, second=${secondPhase ?? "unknown"}.`);
  const encounterAction = await first.click("Resolve encounter") || await first.evaluate(`(() => { const button = [...document.querySelectorAll(".action-card button")].find((candidate) => !candidate.disabled); if (!button) return false; button.click(); return true; })()`);
  if (!encounterAction) throw new Error("First browser exposed no legal Encounter action.");
  for (let encounterStep = 0; encounterStep < 4; encounterStep += 1) {
    await first.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() !== "Waiting for server…"`, "Encounter response");
    const currentPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
    if (currentPhase === "Deploy") break;
    if (currentPhase !== "Encounter") throw new Error(`Expected Encounter or Deploy after Encounter action, got ${currentPhase ?? "unknown"}.`);
    const followUp = await first.evaluate(`(() => { const button = [...document.querySelectorAll(".action-card button")].find((candidate) => !candidate.disabled); if (!button) return false; button.click(); return true; })()`);
    if (!followUp) throw new Error("Encounter remained active without an enabled legal decision control.");
  }
  const deployPhase = await first.evaluate(`document.querySelector(".action-card h2")?.textContent?.trim()`);
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === ${JSON.stringify(deployPhase)}`, "second synchronized post-encounter phase");
  if (deployPhase !== "Deploy") throw new Error(`Expected Deploy after Encounter, got ${deployPhase ?? "unknown"}.`);
  if (!await first.click("Pass deployment")) throw new Error("First browser could not pass Deploy.");
  await first.waitFor(`(() => { const phase = document.querySelector(".action-card h2")?.textContent?.trim(); return phase === "Move"; })()`, "first next Move phase");
  await second.waitFor(`document.querySelector(".action-card h2")?.textContent?.trim() === "Move"`, "second synchronized next Move phase");
  console.log(JSON.stringify({ ok: true, url, roomCode, setupClicks, synchronizedPhase: "Move", reloadRecovery: "verified", onlineMovement: "verified", onlineEncounter: "verified", onlineDeploy: "verified", nextPhase }));
} finally {
  await Promise.all([first.close(), second.close()]);
}
