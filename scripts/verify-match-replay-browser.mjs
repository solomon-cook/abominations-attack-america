import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { createGame } from "@abominations/game-engine";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const freePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    if (await (await fetch(baseUrl)).ok) break;
  } catch {
    if (server.exitCode !== null) throw new Error(`Vite exited before ready.\n${serverOutput}`);
  }
  if (attempt === 119) throw new Error(`Vite did not become ready.\n${serverOutput}`);
  await wait(100);
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors = [];
  const actions = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/rooms/ABC123/replay**", async (route) => {
    const url = new URL(route.request().url());
    const frame = (version) => {
      const state = structuredClone(createGame(2, 77));
      state.currentPlayer = 0;
      state.round = version + 1;
      state.eventLog = [];
      state.rng = { seed: 0, cursor: 0 };
      state.decks.mutation = { ...state.decks.mutation, order: [], discard: [] };
      state.decks.research = { ...state.decks.research, order: [], discard: [] };
      return { version, eventType: version === 0 ? "match.created" : "game.action", state };
    };
    if (url.pathname.endsWith("/export")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ replayable: true, formatVersion: 1, roomCode: "ABC123", terminalVersion: 10, boardId: "development-nine-space", boardVersion: 1, boardContentHash: "fixture", rulesetVersion: "test", frames: Array.from({ length: 11 }, (_, version) => frame(version)) }),
      });
      return;
    }
    const fromVersion = Number(url.searchParams.get("fromVersion") ?? 0);
    const limit = Math.min(8, Number(url.searchParams.get("limit") ?? 8));
    const frames = Array.from({ length: Math.min(limit, 10 - fromVersion) }, (_, index) => frame(fromVersion + index + 1));
    const terminalVersion = 10;
    const lastVersion = frames.at(-1)?.version ?? fromVersion;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ replayable: true, roomCode: "ABC123", terminalVersion, boardId: "development-nine-space", boardVersion: 1, boardContentHash: "fixture", rulesetVersion: "test", base: frame(fromVersion), frames, ...(lastVersion < terminalVersion ? { nextFromVersion: lastVersion } : {}) }),
    });
  });
  await page.route("**/rooms/ABC123/actions**", async (route) => { actions.push(route.request().url()); await route.abort(); });

  await page.goto(`${baseUrl}/?replay=ABC123`);
  await page.getByRole("heading", { name: "Room ABC123" }).waitFor();
  const roundHeading = page.locator(".replay-board-heading strong");
  await roundHeading.waitFor();
  assert.match(await roundHeading.innerText(), /Round 1 · Player 1 · move/);
  await page.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 2"));
  await page.getByRole("button", { name: "Bookmark this moment" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 3"));
  await page.getByLabel("Saved moments").selectOption("1");
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 2"));
  assert.equal(await page.evaluate(() => localStorage.getItem("abominations-replay-bookmarks:ABC123")), "[1]");
  await page.reload();
  await page.getByRole("heading", { name: "Room ABC123" }).waitFor();
  await page.getByLabel("Saved moments").selectOption("1");
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 2"));
  await page.getByRole("button", { name: "Previous", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 1"));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 2"));
  assert.ok((await page.locator(".hex-grid .hex-tile").count()) > 0, "a board should render for the replay frame");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "replay should fit a phone viewport without horizontal scrolling");
  assert.deepEqual(actions, [], "the read-only replay must never send live game actions");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let version = 3; version <= 8; version += 1) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 9"));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".replay-board-heading strong")?.textContent?.includes("Round 10"));
  await page.getByRole("button", { name: "Copy replay link" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${baseUrl}/?replay=ABC123`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download JSON" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "abominations-replay-ABC123.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.formatVersion, 1);
  assert.equal(exported.frames.length, 11);
  assert.equal(JSON.stringify(exported).includes("secretSeed"), false);
  assert.ok(exported.frames.every((frame) => Array.isArray(frame.state.eventLog) && frame.state.eventLog.length === 0), "exported replay frames must not contain historical event-log payloads");
  assert.equal(JSON.stringify(exported).includes("replayCommand"), false);
  assert.deepEqual(errors, [], "replay UI should not emit browser runtime errors");
  console.log(JSON.stringify({ ok: true, mode: "mobile", check: "read-only board, keyboard next/previous paging, local bookmarks, share URL copy, secret-free JSON download, no horizontal overflow or live action requests" }));
  await context.close();
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
