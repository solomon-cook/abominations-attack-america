import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
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

let publicStatsEnabled = true;
const patches = [];
const apiHeaders = { "access-control-allow-origin": baseUrl, "access-control-allow-credentials": "true", "content-type": "application/json" };
const playerStats = { username: "playertest", gamesPlayed: 1, wins: 1, losses: 0, ties: 0, winRate: 1, stompedTiles: 3, damageTaken: 2, healthGained: 4, luckTotal: 0, luckRolls: 0, luckAverage: null, monsterChoices: { Toxicor: 1 }, branchChoices: { Navy: 1 }, mostChosenMonster: "Toxicor", mostChosenBranch: "Navy" };
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const acceptedFriendInviteTokens = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost:8787/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...apiHeaders, "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "content-type" } });
      return;
    }
    if (url.pathname === "/accounts/me") return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify({ account: { id: "user-1", username: "playertest", emailVerified: true } }) });
    if (url.pathname === "/accounts/me/games") return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify([{ roomId: "room-1", code: "ABC123", status: "completed", privacy: "private", playerIndex: 0, displayName: "playertest", botControlled: false, botAssisted: false, outcome: "win" }]) });
    if (url.pathname === "/accounts/me/stats") return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify(playerStats) });
    if (url.pathname === "/accounts/me/social") return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify({ presenceEnabled: false, friends: [], incoming: [], outgoing: [], inviteLinks: [], savedOpponents: [] }) });
    if (url.pathname === "/accounts/me/friend-invite-links/accept" && request.method() === "POST") {
      acceptedFriendInviteTokens.push(request.postDataJSON().token);
      return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify({ message: "Friend invitation accepted." }) });
    }
    if (url.pathname === "/accounts/me/privacy" && request.method() === "GET") return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify({ publicStatsEnabled }) });
    if (url.pathname === "/accounts/me/privacy" && request.method() === "PATCH") {
      const input = request.postDataJSON();
      patches.push(input);
      publicStatsEnabled = input.publicStatsEnabled;
      return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify({ publicStatsEnabled }) });
    }
    if (url.pathname === "/leaderboard") {
      const rows = publicStatsEnabled ? [{ ...playerStats, rank: 1, value: 1 }] : [];
      return route.fulfill({ status: 200, headers: apiHeaders, body: JSON.stringify(rows) });
    }
    if (url.pathname === "/players/playertest") {
      return route.fulfill({ status: publicStatsEnabled ? 200 : 404, headers: apiHeaders, body: JSON.stringify(publicStatsEnabled ? { ...playerStats, botAssistedMatches: 0 } : { error: "Player not found." }) });
    }
    return route.fulfill({ status: 404, headers: apiHeaders, body: JSON.stringify({ error: "Not found" }) });
  });

  await page.goto(baseUrl);
  await page.getByText("PLAYER ACCOUNT", { exact: true }).click();
  const visibility = page.getByRole("checkbox", { name: /Show my username and stats in public profiles and rankings/ });
  await visibility.waitFor();
  await page.locator(".account-stats").waitFor();
  assert.equal(await visibility.isChecked(), true);
  assert.match(await page.locator(".account-stats").innerText(), /1\s*games/);
  assert.equal(await page.locator(".account-matches").innerText().then((text) => text.includes("ABC123")), true);
  assert.equal(await page.locator(".account-leaderboard").innerText().then((text) => text.includes("playertest")), true);

  await visibility.click();
  await page.waitForFunction(() => document.querySelector(".account-message")?.textContent?.includes("hidden"));
  assert.equal(await visibility.isChecked(), false);
  assert.match(await page.locator(".account-stats").innerText(), /1\s*games/, "private account stats remain available to their owner");
  assert.equal(await page.locator(".account-matches").innerText().then((text) => text.includes("ABC123")), true, "private match history remains available to its owner");
  assert.equal(await page.locator(".account-leaderboard").innerText().then((text) => text.includes("playertest")), false, "hidden account is removed from public rankings");
  assert.equal(await page.evaluate(async () => (await fetch("http://localhost:8787/players/playertest", { credentials: "include" })).status), 404, "hidden profile lookup returns not found");

  await visibility.click();
  await page.waitForFunction(() => document.querySelector(".account-message")?.textContent?.includes("visible"));
  assert.equal(await page.locator(".account-leaderboard").innerText().then((text) => text.includes("playertest")), true, "visibility can be restored");
  assert.deepEqual(patches, [{ publicStatsEnabled: false }, { publicStatsEnabled: true }]);

  const inviteToken = "test_friend_invite_token_abcdefghijklmnopqrstuvwxyz";
  await page.goto(`${baseUrl}/#friend-invite=${inviteToken}`);
  const accountPanel = page.locator(".account-panel");
  if (!(await accountPanel.evaluate((element) => element.open))) await page.getByText("PLAYER ACCOUNT", { exact: true }).click();
  const acceptInvite = page.getByRole("button", { name: "Accept friend invitation" });
  await acceptInvite.waitFor();
  await wait(250);
  assert.deepEqual(acceptedFriendInviteTokens, [], "opening a private friend link must not create a friendship automatically");
  await acceptInvite.click();
  await page.waitForFunction(() => document.querySelector(".account-message")?.textContent?.includes("Friend invitation accepted."));
  assert.deepEqual(acceptedFriendInviteTokens, [inviteToken], "friendship is created only after an explicit accept action");
  assert.equal(new URL(page.url()).hash.includes("friend-invite"), false, "remove the consumed invitation token from the visible URL");
  assert.deepEqual(errors, [], "account privacy controls must not emit browser runtime errors");
  console.log(JSON.stringify({ ok: true, mode: "mobile", checks: ["public stats opt-out removes profile and ranking visibility while preserving signed-in private history and stats; visibility can be restored", "private friend link opens a confirmation; friendship is accepted only after an explicit click"] }));
  await context.close();
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
