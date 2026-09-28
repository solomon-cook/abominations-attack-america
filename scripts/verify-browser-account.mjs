import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: join(cwd, "apps/web"), stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const account = { id: "account-browser-fixture", username: "AbomTest", emailVerified: true };
const stats = {
  username: "AbomTest", gamesPlayed: 5, wins: 3, losses: 1, ties: 1, winRate: 0.6,
  stompedTiles: 27, damageTaken: 8, healthGained: 11, luckTotal: 18, luckRolls: 5,
  luckAverage: 3.6, monsterChoices: { Zorb: 3 }, branchChoices: { Army: 2 },
  mostChosenMonster: "Zorb", mostChosenBranch: "Army",
};
const requests = [];
const accountPageErrors = [];
let registered = false;
let deleted = false;
let harnessMode = false;
let currentFixtureAccount = account;
let linkedSeatAccountId = null;
let claimCount = 0;
let resumeCount = 0;
let verifyCount = 0;
const claimAccounts = [];
let pendingGamesDelay = null;
let verificationPage = null;
let verificationClaimAfterRestore = false;
const verificationRequests = [];
const verificationClaimPaths = [];
const verificationPageErrors = [];
const createGamesDelay = (accountId) => {
  let start;
  let release;
  const started = new Promise((resolve) => { start = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const delay = { accountId, start, waiting };
  pendingGamesDelay = delay;
  return { started, release: () => { if (pendingGamesDelay === delay) pendingGamesDelay = null; release(); } };
};
const linkedRoom = {
  id: "room-id-42", code: "ROOM42", status: "active", privacy: "private", version: 3, state: {},
  participants: [{ id: "participant-42", displayName: "Guest player", role: "player", playerIndex: 0, connected: true, ready: true, botControlled: false, botAssisted: false }],
  events: [],
};
const activeAccountGame = { roomId: linkedRoom.id, code: linkedRoom.code, status: "active", privacy: "private", playerIndex: 0, displayName: "AbomTest", botControlled: false, botAssisted: false };
const expiredAccountGame = { ...activeAccountGame, roomId: "expired-room-id", code: "EXPIRED99", status: "expired" };
const sessionResponse = (token, accountLinked) => ({ room: linkedRoom, participantId: "participant-42", token, accountLinked });
const otherAccount = { id: "account-browser-other", username: "OtherPlayer", emailVerified: true };
const json = (data, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": `http://127.0.0.1:${port}`, "access-control-allow-credentials": "true" }, body: JSON.stringify(data) });

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) { ready = true; break; }
    } catch {
      if (server.exitCode !== null) throw new Error(`Vite exited before ready.\n${serverOutput}`);
    }
    await wait(100);
  }
  if (!ready) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => accountPageErrors.push(error.message));
  await page.route("http://localhost:8787/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": `http://127.0.0.1:${port}`,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-room-token",
      } });
      return;
    }
    const path = new URL(request.url()).pathname;
    const query = new URL(request.url()).searchParams;
    requests.push({ method: request.method(), path, category: query.get("category") });
    if (request.method() === "GET" && path === "/accounts/me") return route.fulfill(json({ account: harnessMode ? currentFixtureAccount : null }));
    if (request.method() === "GET" && path === "/leaderboard") return route.fulfill(json([]));
    if (request.method() === "POST" && path === "/accounts/register") {
      registered = true;
      return route.fulfill(json({ message: "Check your email to verify your account.", developmentLink: `${url}?verify-email=fixture-token` }, 202));
    }
    if (request.method() === "POST" && path === "/accounts/resend-verification") return route.fulfill(json({ message: "If the address is registered, a verification link has been sent." }));
    if (request.method() === "POST" && path === "/accounts/password-reset") return route.fulfill(json({ message: "If the address is registered, reset instructions have been sent." }));
    if (request.method() === "POST" && path === "/accounts/login") {
      currentFixtureAccount = request.postDataJSON().email === "other@example.test" ? otherAccount : account;
      return route.fulfill(json({ account: currentFixtureAccount, message: "Signed in." }));
    }
    if (request.method() === "POST" && path === "/accounts/verify-email") {
      verifyCount += 1;
      currentFixtureAccount = account;
      return route.fulfill(json({ account, message: "Email verified." }));
    }
    if (request.method() === "GET" && path === "/accounts/me/games") {
      const requestAccountId = currentFixtureAccount?.id;
      const matches = requestAccountId === linkedSeatAccountId ? [activeAccountGame, expiredAccountGame] : [];
      const delay = pendingGamesDelay?.accountId === requestAccountId ? pendingGamesDelay : null;
      if (delay) {
        delay.start();
        await delay.waiting;
      }
      return route.fulfill(json(matches));
    }
    if (request.method() === "GET" && path === "/accounts/me/stats") return route.fulfill(json(stats));
    if (request.method() === "POST" && path === "/rooms/ROOM42/claim") {
      claimCount += 1;
      claimAccounts.push(currentFixtureAccount?.id ?? null);
      if (verificationPage) verificationClaimAfterRestore = await verificationPage.evaluate(() => window.__accountHarnessSessionRestored === true);
      if (linkedSeatAccountId && linkedSeatAccountId !== currentFixtureAccount?.id) return route.fulfill(json({ error: "This seat is already linked to another account." }, 409));
      linkedSeatAccountId = currentFixtureAccount?.id ?? null;
      return route.fulfill(json(sessionResponse("linked-token", true)));
    }
    if (request.method() === "POST" && path === `/accounts/me/games/${linkedRoom.id}/resume`) {
      resumeCount += 1;
      return route.fulfill(json(sessionResponse("resumed-token", true)));
    }
    if (request.method() === "GET" && path.startsWith("/players/")) return route.fulfill(json({ ...stats, username: decodeURIComponent(path.slice("/players/".length)), botAssistedMatches: 1 }));
    if (request.method() === "PATCH" && path === "/accounts/me") {
      const body = request.postDataJSON();
      account.username = body.username;
      return route.fulfill(json({ account: { ...account } }));
    }
    if (request.method() === "POST" && path === "/accounts/logout") return route.fulfill(json({ message: "Signed out." }));
    if (request.method() === "DELETE" && path === "/accounts/me") {
      deleted = true;
      return route.fulfill(json({ message: "Account deleted." }));
    }
    if (request.method() === "GET" && path === "/rooms/public") return route.fulfill(json([]));
    return route.fulfill(json({ error: `Unexpected account-audit request: ${request.method()} ${path}` }, 404));
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const disclosure = page.locator("details.account-panel");
  await disclosure.waitFor({ state: "visible" });
  const summary = disclosure.locator(":scope > summary");
  await summary.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("details.account-panel")?.open === true);
  await page.locator("input[type=email]").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".account-leaderboard")?.querySelector("[role=alert]") === null);

  const email = page.locator(".account-form input[type=email]").first();
  const password = page.locator(".account-form input[type=password]").first();
  assert.equal(await email.getAttribute("required"), "");
  assert.equal(await password.getAttribute("required"), "");
  assert.equal(await password.getAttribute("minlength"), "12");
  assert.equal(await email.getAttribute("autocomplete"), "email");
  await page.locator(".account-mode-tabs button", { hasText: "Create account" }).click();
  assert.equal(await password.getAttribute("autocomplete"), "new-password");
  await email.fill("invalid-email");
  assert.ok(await email.evaluate((input) => !input.validity.valid), "invalid emails should be rejected before submission");
  await email.fill("qa@example.test");
  await password.fill("a-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.getByRole("status").filter({ hasText: "Check your email" }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Continue with account link" }).waitFor({ state: "visible" });
  assert.equal(registered, true);

  await page.getByRole("button", { name: "Resend verification" }).click();
  await page.getByRole("status").filter({ hasText: "verification link has been sent" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("status").filter({ hasText: "reset instructions have been sent" }).waitFor({ state: "visible" });

  await page.locator(".account-mode-tabs button", { hasText: "Sign in" }).click();
  await page.locator(".account-form input[type=email]").fill("qa@example.test");
  await page.locator(".account-form input[type=password]").fill("a-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.locator(".account-identity strong", { hasText: `@${account.username}` }).waitFor({ state: "visible" });
  await page.locator(".account-stats strong").first().waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Your online matches" }).waitFor({ state: "visible" });
  await page.getByRole("combobox", { name: "Leaderboard category" }).selectOption("win-rate");
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("/leaderboard?category=win-rate")));
  await page.locator('input[placeholder="player username"]').fill("PublicPlayer");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.locator(".account-public-profile").getByText("@PublicPlayer", { exact: true }).waitFor({ state: "visible" });
  await page.getByLabel("Change username").fill("UpdatedName");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Username updated.", { exact: true }).waitFor({ state: "visible" });

  let confirmedText = "";
  page.once("dialog", async (dialog) => { confirmedText = dialog.message(); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.waitForFunction(() => document.querySelector(".account-identity") !== null);
  assert.match(confirmedText, /Delete your account/);
  assert.equal(deleted, false, "cancelling account deletion must not send the destructive request");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".account-form button[type=submit]").waitFor({ state: "visible" });

  await page.locator(".account-mode-tabs button", { hasText: "Sign in" }).click();
  await page.locator(".account-form input[type=email]").fill("qa@example.test");
  await page.locator(".account-form input[type=password]").fill("a-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.getByRole("button", { name: "Delete account" }).waitFor({ state: "visible" });
  page.once("dialog", async (dialog) => { confirmedText = dialog.message(); await dialog.accept(); });
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.locator(".account-form button[type=submit]").waitFor({ state: "visible" });
  assert.equal(deleted, true, "accepting account deletion must submit the destructive request");

  await summary.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("details.account-panel")?.open === false);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await summary.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("details.account-panel")?.open === true);
    const bounds = await disclosure.boundingBox();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}px account panel should remain in viewport: ${JSON.stringify(bounds)}`);
    assert.equal(overflow, false, `${width}px account panel should not cause horizontal page overflow`);
    await summary.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("details.account-panel")?.open === false);
  }

  harnessMode = true;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${url}account-panel-harness.html`, { waitUntil: "domcontentloaded" });
  const harnessPanel = page.locator("details.account-panel");
  await harnessPanel.locator(":scope > summary").click();
  await page.getByRole("heading", { name: "Your online matches" }).waitFor({ state: "visible" });
  await page.getByText("No account-linked matches yet.").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Link current player seat" }).click();
  await page.getByRole("status").filter({ hasText: "This match is linked to your account." }).waitFor({ state: "visible" });
  await page.locator(".account-match").getByText("ROOM42", { exact: false }).waitFor({ state: "visible" });
  const expiredMatch = page.locator(".account-match").filter({ hasText: "EXPIRED99" });
  await expiredMatch.waitFor({ state: "visible" });
  assert.equal(await expiredMatch.getByRole("button", { name: "Resume" }).count(), 0, "expired matches must not offer recovery that the API rejects");
  assert.equal(await page.getByRole("button", { name: "Link current player seat" }).count(), 0, "a linked seat should not offer a second token-rotating claim");
  assert.equal(claimCount, 1, "linking the seat submits one claim request");
  await page.locator(".account-match").getByRole("button", { name: "Resume" }).click();
  await page.getByRole("status").filter({ hasText: "Resumed match ROOM42." }).waitFor({ state: "visible" });
  const resumedSession = JSON.parse(await page.locator("#account-session-state").textContent());
  assert.equal(resumedSession.token, "resumed-token", "the Resume response reaches the parent session state");
  assert.equal(resumedSession.code, "ROOM42", "the Resume response selects the match's room");
  assert.equal(resumeCount, 1, "Resume calls the selected account match exactly once");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("status").filter({ hasText: "Signed out." }).waitFor({ state: "visible" });
  await page.locator(".account-form input[type=email]").fill("other@example.test");
  await page.locator(".account-form input[type=password]").fill("another-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.locator(".account-identity strong", { hasText: "@OtherPlayer" }).waitFor({ state: "visible" });
  await page.getByRole("alert").filter({ hasText: "already linked to another account" }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Link current player seat" }).count(), 1, "a different account should not have the linked seat silently hidden");
  assert.equal(claimCount, 2, "the second account checks ownership with the server rather than trusting a local linked flag");

  // Hold account A's seat-link preflight while switching to account B. The
  // delayed A continuation must not submit a claim using B's newly active cookie.
  linkedSeatAccountId = null;
  currentFixtureAccount = account;
  await page.goto(`${url}account-panel-harness.html`, { waitUntil: "domcontentloaded" });
  const racePanel = page.locator("details.account-panel");
  await racePanel.locator(":scope > summary").click();
  await page.getByText("No account-linked matches yet.").waitFor({ state: "visible" });
  const claimsBeforeRace = claimCount;
  const delayedARefresh = createGamesDelay(account.id);
  await page.getByRole("button", { name: "Link current player seat" }).click();
  await delayedARefresh.started;
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".account-form button[type=submit]").waitFor({ state: "visible" });
  await page.locator(".account-form input[type=email]").fill("other@example.test");
  await page.locator(".account-form input[type=password]").fill("another-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.locator(".account-identity strong", { hasText: "@OtherPlayer" }).waitFor({ state: "visible" });
  await page.locator(".account-match").getByText("ROOM42", { exact: false }).waitFor({ state: "visible" });
  assert.equal(claimCount, claimsBeforeRace + 1, "account B's login may claim the guest seat once while account A's stale preflight is held");
  assert.equal(claimAccounts.at(-1), otherAccount.id, "the accepted claim belongs to the currently signed-in account B");
  delayedARefresh.release();
  await page.waitForTimeout(100);
  assert.equal(claimCount, claimsBeforeRace + 1, "the delayed account A continuation must not issue another claim after the switch to B");

  // Repeat through sign-in itself: A's login preflight can be pending when the
  // user signs out and completes a B login.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".account-form button[type=submit]").waitFor({ state: "visible" });
  linkedSeatAccountId = null;
  const claimsBeforeLoginRace = claimCount;
  const delayedALoginRefresh = createGamesDelay(account.id);
  await page.locator(".account-form input[type=email]").fill("qa@example.test");
  await page.locator(".account-form input[type=password]").fill("a-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await delayedALoginRefresh.started;
  await page.locator(".account-identity strong", { hasText: `@${account.username}` }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".account-form button[type=submit]").waitFor({ state: "visible" });
  await page.locator(".account-form input[type=email]").fill("other@example.test");
  await page.locator(".account-form input[type=password]").fill("another-long-password-42");
  await page.locator(".account-form button[type=submit]").click();
  await page.locator(".account-identity strong", { hasText: "@OtherPlayer" }).waitFor({ state: "visible" });
  await page.locator(".account-match").getByText("ROOM42", { exact: false }).waitFor({ state: "visible" });
  assert.equal(claimCount, claimsBeforeLoginRace + 1, "account B's login makes one claim while account A's login preflight is held");
  assert.equal(claimAccounts.at(-1), otherAccount.id, "the login race claim belongs to account B");
  delayedALoginRefresh.release();
  await page.waitForTimeout(100);
  assert.equal(claimCount, claimsBeforeLoginRace + 1, "account A's delayed login continuation must not claim after B becomes current");

  // Email verification returns before the test harness restores its guest room
  // session. The verified-account marker must survive until that session arrives.
  linkedSeatAccountId = null;
  currentFixtureAccount = null;
  account.username = "AbomTest";
  verificationPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const claimsBeforeVerification = claimCount;
  await verificationPage.route("http://localhost:8787/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": `http://127.0.0.1:${port}`,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-room-token",
      } });
      return;
    }
    const path = new URL(request.url()).pathname;
    verificationRequests.push(`${request.method()} ${path}`);
    if (request.method() === "POST" && path === "/accounts/verify-email") {
      verifyCount += 1;
      currentFixtureAccount = account;
      return route.fulfill(json({ account, message: "Email verified." }));
    }
    if (request.method() === "GET" && path === "/accounts/me") return route.fulfill(json({ account: currentFixtureAccount }));
    if (request.method() === "GET" && path === "/accounts/me/games") {
      const requestAccountId = currentFixtureAccount?.id;
      const matches = requestAccountId === linkedSeatAccountId ? [activeAccountGame] : [];
      const delay = pendingGamesDelay?.accountId === requestAccountId ? pendingGamesDelay : null;
      if (delay) {
        delay.start();
        await delay.waiting;
      }
      return route.fulfill(json(matches));
    }
    if (request.method() === "GET" && path === "/accounts/me/stats") return route.fulfill(json(stats));
    if (request.method() === "GET" && path === "/leaderboard") return route.fulfill(json([]));
    if (request.method() === "POST" && path.startsWith("/rooms/") && path.endsWith("/claim")) {
      verificationClaimPaths.push(path);
      claimCount += 1;
      claimAccounts.push(currentFixtureAccount?.id ?? null);
      verificationClaimAfterRestore = await verificationPage.evaluate(() => window.__accountHarnessSessionRestored === true);
      if (path !== "/rooms/ROOM42/claim") return route.fulfill(json(sessionResponse("unexpected-room-rotated-token", true)));
      linkedSeatAccountId = currentFixtureAccount?.id ?? null;
      return route.fulfill(json(sessionResponse("verified-linked-token", true)));
    }
    return route.fulfill(json({ error: `Unexpected verification-audit request: ${request.method()} ${path}` }, 404));
  });
  verificationPage.on("pageerror", (error) => { verificationPageErrors.push(error.message); console.error("Verification browser error:", error.message); });
  await verificationPage.addInitScript(() => localStorage.setItem("abominations-session", JSON.stringify({ token: "guest-token", participantId: "participant-42", room: { code: "ROOM42" } })));
  await verificationPage.goto(`${url}account-panel-harness.html?verify-email=fixture-token&restore-session`, { waitUntil: "domcontentloaded" });
  await verificationPage.locator("details.account-panel > summary").click();
  await verificationPage.locator(".account-identity strong", { hasText: "@AbomTest" }).waitFor({ state: "visible", timeout: 8000 }).catch(async (error) => {
    const body = await verificationPage.locator(".account-panel-content").innerText().catch(() => "<no account panel>");
    throw new Error(`${error.message}\nVerification requests: ${verificationRequests.join(", ")}\nPanel: ${body}`);
  });
  await verificationPage.waitForFunction(() => window.__accountHarnessSessionRestored === true);
  await verificationPage.locator("details.account-panel > summary").click();
  await verificationPage.getByRole("status").filter({ hasText: "This match is linked to your account." }).waitFor({ state: "visible", timeout: 8000 }).catch(async (error) => {
    const body = await verificationPage.locator(".account-panel-content").innerText().catch(() => "<no account panel>");
    throw new Error(`${error.message}\nVerification requests: ${verificationRequests.join(", ")}\nPanel: ${body}`);
  });
  const verificationSession = JSON.parse(await verificationPage.locator("#account-session-state").textContent());
  assert.equal(verificationSession.token, "verified-linked-token", "the verified seat claim updates the asynchronously restored room session");
  assert.equal(verificationClaimAfterRestore, true, "email verification must wait until the guest room session is restored before claiming");
  assert.equal(verifyCount, 1, "the verification token is submitted once across the deferred session flow");
  assert.equal(claimCount, claimsBeforeVerification + 1, "verification links the restored player seat exactly once");

  // The persisted guest identity must bind a pending verification claim to the
  // same room and participant. Restoring another room must discard the marker.
  const claimsBeforeReplacementSession = claimCount;
  const verificationPathsBeforeReplacementSession = verificationClaimPaths.length;
  linkedSeatAccountId = null;
  currentFixtureAccount = null;
  verificationClaimAfterRestore = false;
  await verificationPage.goto(`${url}account-panel-harness.html?verify-email=other-token&restore-session&restore-other-room`, { waitUntil: "domcontentloaded" });
  await verificationPage.locator("details.account-panel > summary").click();
  await verificationPage.locator(".account-identity strong", { hasText: "@AbomTest" }).waitFor({ state: "visible" });
  await verificationPage.waitForFunction(() => {
    const marker = sessionStorage.getItem("abominations-pending-verification-seat");
    return Boolean(marker && JSON.parse(marker).roomCode === "ROOM42" && JSON.parse(marker).participantId === "participant-42");
  });
  await verificationPage.waitForFunction(() => window.__accountHarnessSessionRestored === true);
  await verificationPage.locator("details.account-panel > summary").click();
  await verificationPage.getByText("No account-linked matches yet.").waitFor({ state: "visible" });
  await verificationPage.waitForFunction(() => sessionStorage.getItem("abominations-pending-verification-seat") === null);
  const replacementSession = JSON.parse(await verificationPage.locator("#account-session-state").textContent());
  assert.equal(replacementSession.code, "OTHER99", "the different room is the one that actually restored");
  assert.equal(replacementSession.participantId, "participant-42", "the replacement room keeps the same participant id, so the room identity alone must invalidate the marker");
  assert.equal(replacementSession.token, "replacement-guest-token", "mismatched deferred verification does not rotate the replacement session token");
  assert.equal(claimCount, claimsBeforeReplacementSession, "verification must not claim or rotate a different restored room's guest seat");
  assert.equal(verificationClaimPaths.length, verificationPathsBeforeReplacementSession, "no room claim endpoint is called for the replacement session");

  // Switch rooms after a matching room's account-games preflight has started.
  // The old async continuation must not claim its stale room or replace the
  // still-mounted panel's new session when the delayed response arrives.
  const claimsBeforeInFlightRoomSwitch = claimCount;
  const verificationPathsBeforeInFlightRoomSwitch = verificationClaimPaths.length;
  linkedSeatAccountId = null;
  currentFixtureAccount = null;
  const delayedMatchingRoomGames = createGamesDelay(account.id);
  await verificationPage.goto(`${url}account-panel-harness.html?verify-email=switch-token&allow-room-switch`, { waitUntil: "domcontentloaded" });
  await verificationPage.locator("details.account-panel > summary").click();
  await verificationPage.locator(".account-identity strong", { hasText: "@AbomTest" }).waitFor({ state: "visible" });
  await delayedMatchingRoomGames.started;
  const originalPanel = await verificationPage.locator("details.account-panel").elementHandle();
  assert.ok(originalPanel, "the account panel should be mounted before its room changes");
  await verificationPage.getByRole("button", { name: "Switch room session" }).click();
  await verificationPage.waitForFunction(() => window.__accountHarnessRoomSwitched === true);
  await verificationPage.waitForFunction(() => JSON.parse(document.querySelector("#account-session-state")?.textContent ?? "null")?.code === "OTHER99");
  assert.equal(await originalPanel.evaluate((element) => element.isConnected), true, "the replacement scenario changes room props without remounting the account panel");
  assert.equal(await verificationPage.locator("details.account-panel").evaluate((element, previous) => element === previous, originalPanel), true, "the same account panel instance remains mounted across the room change");
  await verificationPage.waitForFunction(() => sessionStorage.getItem("abominations-pending-verification-seat") === null);
  delayedMatchingRoomGames.release();
  await verificationPage.getByText("No account-linked matches yet.").waitFor({ state: "visible" });
  await verificationPage.waitForTimeout(100);
  const afterInFlightRoomSwitch = JSON.parse(await verificationPage.locator("#account-session-state").textContent());
  assert.equal(afterInFlightRoomSwitch.code, "OTHER99", "the pending claim continuation must leave the replacement room selected");
  assert.equal(afterInFlightRoomSwitch.token, "replacement-guest-token", "the pending claim continuation must preserve the replacement room token");
  assert.equal(claimCount, claimsBeforeInFlightRoomSwitch, "a room switch during preflight cancels the pending claim before either seat can be rotated");
  assert.equal(verificationClaimPaths.length, verificationPathsBeforeInFlightRoomSwitch, "neither the original nor replacement room claim endpoint is called after switching during preflight");
  await originalPanel.dispose();
  await verificationPage.close();
  verificationPage = null;

  const unexpected = requests.filter(({ path }) => ![
    "/accounts/me", "/leaderboard", "/accounts/register", "/accounts/resend-verification", "/accounts/password-reset", "/accounts/login", "/accounts/me/games", `/accounts/me/games/${linkedRoom.id}/resume`, "/accounts/me/stats", "/players/PublicPlayer", "/accounts/logout", "/rooms/public", "/rooms/ROOM42/claim",
  ].includes(path));
  assert.deepEqual(unexpected, [], "account flow should use only the expected endpoints");
  assert.deepEqual(accountPageErrors, [], "account browser flow produces no runtime errors");
  assert.deepEqual(verificationPageErrors, [], "deferred account verification flows produce no browser runtime errors");
  assert.ok(requests.some((request) => request.path === "/leaderboard" && request.category === "win-rate"), "category selection should request the selected leaderboard");
  console.log(JSON.stringify({ ok: true, viewport: "1280x800, 390x844, 320x740", signedOut: "validated", registerAndRecovery: "verified-with-api-fixture", signedInStatsProfileAndLeaderboard: "verified-with-api-fixture", usernameEditSignOutAndDeleteCancelConfirm: "verified-with-api-fixture", linkRefreshAndResume: { claimCount, resumeCount, matchAppearedAfterLink: true, alreadyLinkedControlHidden: true, secondAccountOwnershipChecked: true }, accountSwitchRace: { staleLinkClaimPrevented: true, staleLoginClaimPrevented: true, claimAccounts }, delayedVerificationSession: { matchingSessionLinked: verificationSession.token, differentRestoredRoomDiscarded: replacementSession.code, replacementTokenUnchanged: replacementSession.token, inFlightRoomSwitchKeptReplacement: afterInFlightRoomSwitch.code, noClaimAfterSwitch: true, verificationClaimPaths }, keyboardDisclosure: "verified" }));
  await browser.close();
} finally {
  await browser?.close().catch(() => undefined);
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
