import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = resolve(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a Challenge Mutation verifier port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/challenge-mutation-harness.html`;
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const server = spawn(process.execPath, [join(cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: join(cwd, "apps/web"),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const stopServer = async () => {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    wait(2000).then(() => server.kill("SIGKILL")),
  ]);
};
const stateOf = (page) => page.locator("#challenge-mutation-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const report = {
  started: new Date().toISOString(),
  fixture: "Two-player active Monster Challenge. The challenger holds Berserk and Son of a Monster; the opponent is selected by applyCommand before the UI mounts.",
  coveredSlice: "Challenge Mutation controls for the active owner and one waiting participant in a separate freshly initialized fixture; full-route/server transport behavior and other Challenge steps remain outside this slice.",
  scenarios: {},
  runtimeErrors: [],
};
let browser;

try {
  await mkdir(artifactDirectory, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* wait for Vite */ }
    await wait(100);
  }
  if (!ready) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const ownerPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  ownerPage.setDefaultTimeout(8000);
  ownerPage.on("pageerror", (error) => report.runtimeErrors.push(`active-owner: ${error.message}`));
  await ownerPage.emulateMedia({ reducedMotion: "reduce" });
  await ownerPage.goto(url, { waitUntil: "domcontentloaded" });
  const ownerDialog = ownerPage.locator("dialog.resolution-challenge[open]");
  await ownerDialog.waitFor({ state: "visible" });
  await ownerPage.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));

  const before = await stateOf(ownerPage);
  assert.equal(before.role, "mutation-owner");
  assert.equal(before.viewerIndex, 0);
  assert.equal(before.currentPlayer, 0);
  assert.equal(before.pendingDecision?.type, "challenge-resolution");
  assert.deepEqual(before.heldMutationCardIds, ["Berserk", "Son of a Monster"]);
  assert.equal(before.challengerHealth, 10);
  assert.equal(before.remainingAttacks, 1);
  assert.deepEqual(before.submittedCommands, []);

  const mutationGroup = ownerDialog.getByRole("group", { name: "Challenge Mutation cards" });
  assert.equal(await mutationGroup.count(), 1, "the active owner sees one semantically named Challenge Mutation action group");
  const initialActionCount = await mutationGroup.getByRole("button").count();
  assert.equal(initialActionCount, 2, "the active owner sees both eligible Mutation actions");
  const berserk = mutationGroup.getByRole("button", { name: /Berserk/ });
  const son = mutationGroup.getByRole("button", { name: /Son of a Monster/ });
  assert.equal(await berserk.count(), 1, "the active owner sees one Berserk action");
  assert.equal(await son.count(), 1, "the active owner sees one Son of a Monster action");
  assert.equal(await berserk.isEnabled(), true);
  assert.equal(await son.isEnabled(), true);

  await ownerPage.keyboard.press("Tab");
  assert.equal(await berserk.evaluate((node) => node === document.activeElement), true,
    "Tab from the dialog close control reaches the first Challenge Mutation action");
  await ownerPage.keyboard.press("Enter");
  await ownerPage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#challenge-mutation-state")?.textContent ?? "{}");
    return state.latestEvent?.action === "mutation.used" && state.latestEvent.detail.mutationCardId === "Berserk";
  });
  const afterBerserk = await stateOf(ownerPage);
  assert.deepEqual(afterBerserk.submittedCommands, [{ type: "use-mutation", cardId: "Berserk" }]);
  assert.equal(afterBerserk.eventCount, before.eventCount + 1);
  assert.equal(afterBerserk.latestEvent.action, "mutation.used");
  assert.equal(afterBerserk.latestEvent.detail.monsterId, "monster-1");
  assert.equal(afterBerserk.latestEvent.detail.playerIndex, 0);
  assert.equal(afterBerserk.latestEvent.detail.mutationCardId, "Berserk");
  assert.equal(afterBerserk.latestEvent.detail.extraAttacks, 5);
  assert.equal(afterBerserk.latestEvent.detail.healthRoll, undefined);
  assert.equal(afterBerserk.remainingAttacks, before.remainingAttacks + 5);
  assert.equal(afterBerserk.challengerHealth, before.challengerHealth);
  assert.deepEqual(afterBerserk.heldMutationCardIds, ["Son of a Monster"]);
  assert.ok(afterBerserk.discardedMutationCardIds.includes("Berserk"));

  const sonAfterBerserk = ownerDialog.getByRole("group", { name: "Challenge Mutation cards" }).getByRole("button", { name: /Son of a Monster/ });
  const remainingActionCount = await ownerDialog.getByRole("group", { name: "Challenge Mutation cards" }).getByRole("button").count();
  assert.equal(remainingActionCount, 1, "Berserk is removed and only Son of a Monster remains");
  await ownerDialog.locator(".resolution-close").focus();
  await ownerPage.keyboard.press("Tab");
  assert.equal(await sonAfterBerserk.evaluate((node) => node === document.activeElement), true,
    "Tab from the persistent dialog close control reaches the remaining Son of a Monster action");
  await ownerPage.keyboard.press("Enter");
  await ownerPage.waitForFunction(() => {
    const state = JSON.parse(document.querySelector("#challenge-mutation-state")?.textContent ?? "{}");
    return state.latestEvent?.action === "mutation.used" && state.latestEvent.detail.mutationCardId === "Son of a Monster";
  });
  const afterSon = await stateOf(ownerPage);
  const healthRoll = afterSon.latestEvent.detail.healthRoll;
  assert.deepEqual(afterSon.submittedCommands, [
    { type: "use-mutation", cardId: "Berserk" },
    { type: "use-mutation", cardId: "Son of a Monster" },
  ]);
  assert.equal(afterSon.eventCount, afterBerserk.eventCount + 1);
  assert.equal(afterSon.latestEvent.action, "mutation.used");
  assert.equal(afterSon.latestEvent.detail.monsterId, "monster-1");
  assert.equal(afterSon.latestEvent.detail.playerIndex, 0);
  assert.equal(afterSon.latestEvent.detail.mutationCardId, "Son of a Monster");
  assert.equal(afterSon.latestEvent.detail.extraAttacks, 2);
  assert.ok(Number.isInteger(healthRoll) && healthRoll >= 1 && healthRoll <= 6,
    `Son of a Monster records one d6 Health roll: ${healthRoll}`);
  assert.equal(afterSon.remainingAttacks, afterBerserk.remainingAttacks + 2);
  assert.equal(afterSon.challengerHealth, afterBerserk.challengerHealth + healthRoll);
  assert.deepEqual(afterSon.heldMutationCardIds, []);
  assert.ok(afterSon.discardedMutationCardIds.includes("Berserk"));
  assert.ok(afterSon.discardedMutationCardIds.includes("Son of a Monster"));
  assert.equal(await ownerDialog.getByRole("group", { name: "Challenge Mutation cards" }).count(), 0,
    "the named action group disappears after both held cards are used");
  report.scenarios.activeOwner = {
    status: "passed",
    viewport: { width: 1280, height: 900 },
    initialFocus: "Challenge dialog close control",
    mutationActionGroup: {
      role: "group",
      accessibleName: "Challenge Mutation cards",
      initialActionCount,
      actionCountAfterBerserk: remainingActionCount,
      actionGroupCountAfterBothActions: 0,
    },
    berserk: {
      activation: "Tab from dialog close control to Berserk; Enter",
      command: afterBerserk.submittedCommands[0],
      event: afterBerserk.latestEvent,
      remainingAttacks: { before: before.remainingAttacks, after: afterBerserk.remainingAttacks },
      health: { before: before.challengerHealth, after: afterBerserk.challengerHealth },
      heldMutationCardIds: { before: before.heldMutationCardIds, after: afterBerserk.heldMutationCardIds },
      discardedMutationCardIds: { before: before.discardedMutationCardIds, after: afterBerserk.discardedMutationCardIds },
    },
    sonOfAMonster: {
      activation: "Focus persistent dialog close control; Tab to remaining Son of a Monster action; Enter",
      command: afterSon.submittedCommands[1],
      event: afterSon.latestEvent,
      remainingAttacks: { before: afterBerserk.remainingAttacks, after: afterSon.remainingAttacks },
      health: { before: afterBerserk.challengerHealth, after: afterSon.challengerHealth },
      heldMutationCardIds: { before: afterBerserk.heldMutationCardIds, after: afterSon.heldMutationCardIds },
      discardedMutationCardIds: { before: afterBerserk.discardedMutationCardIds, after: afterSon.discardedMutationCardIds },
    },
    totalCommands: afterSon.submittedCommands.length,
    totalNewEvents: afterSon.eventCount - before.eventCount,
  };
  await ownerPage.close();

  const waitingPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  waitingPage.setDefaultTimeout(8000);
  waitingPage.on("pageerror", (error) => report.runtimeErrors.push(`waiting-player: ${error.message}`));
  await waitingPage.emulateMedia({ reducedMotion: "reduce" });
  await waitingPage.goto(`${url}?role=waiting`, { waitUntil: "domcontentloaded" });
  const waitingDialog = waitingPage.locator("dialog.resolution-challenge[open]");
  await waitingDialog.waitFor({ state: "visible" });
  const waitingBefore = await stateOf(waitingPage);
  assert.equal(waitingBefore.role, "waiting-player");
  assert.equal(waitingBefore.viewerIndex, 1);
  assert.equal(waitingBefore.currentPlayer, 0);
  assert.deepEqual(waitingBefore.heldMutationCardIds, ["Berserk", "Son of a Monster"], "the authoritative challenger still owns both cards");
  assert.equal(await waitingDialog.locator('[aria-label="Challenge Mutation cards"]').count(), 0,
    "a waiting participant who does not own the cards sees no Mutation action group");
  assert.deepEqual(waitingBefore.submittedCommands, []);
  assert.equal(waitingBefore.eventCount, before.eventCount);
  await waitingPage.keyboard.press("Tab");
  await waitingPage.keyboard.press("Tab");
  const waitingAfter = await stateOf(waitingPage);
  assert.deepEqual(waitingAfter.submittedCommands, [], "waiting-player navigation submits no game command");
  assert.equal(waitingAfter.eventCount, waitingBefore.eventCount, "waiting-player navigation leaves event history unchanged");
  assert.deepEqual(waitingAfter.heldMutationCardIds, waitingBefore.heldMutationCardIds);
  report.scenarios.waitingPlayer = {
    status: "passed",
    fixtureInitialization: "Separate browser page with a freshly initialized GameState; no active-owner commands are shared with this fixture.",
    viewerIndex: waitingBefore.viewerIndex,
    activePlayerIndex: waitingBefore.currentPlayer,
    mutationOwnerIndex: 0,
    challengerCardsRemainHeld: waitingAfter.heldMutationCardIds,
    mutationActionGroupCount: 0,
    submittedCommands: waitingAfter.submittedCommands,
    eventCount: { before: waitingBefore.eventCount, after: waitingAfter.eventCount },
  };

  assert.deepEqual(report.runtimeErrors, [], "the Challenge Mutation scenarios complete without uncaught browser errors");
  report.finished = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `challenge-mutations-${date}.json`);
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, artifact }, null, 2));
  await waitingPage.close();
} finally {
  await browser?.close();
  await stopServer();
}
