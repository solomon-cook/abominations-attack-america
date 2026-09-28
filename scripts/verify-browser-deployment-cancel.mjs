import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = process.cwd();
const artifactDirectory = join(cwd, "output/ui-review");
const date = new Date().toISOString().slice(0, 10);
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a deployment cancellation verifier port."));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/deployment-cancel-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stateOf = (page) => page.locator("#deployment-cancel-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
const highlightKeys = (page) => page.locator(".hex-tile.deployment-legal").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-hex-key")).sort());
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
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), wait(2000).then(() => server.kill("SIGKILL"))]);
};

const report = {
  started: new Date().toISOString(),
  scope: "fixture-level browser acceptance of the production MilitarySheet choice and HexGrid selection state with the production Cancel placement label/callback behavior mirrored from main.tsx; command dispatch goes through applyCommand if a highlighted map cell is selected; not full-match or persisted-service evidence",
  scenarios: {},
  runtimeErrors: [],
};
let browser;
try {
  mkdirSync(artifactDirectory, { recursive: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try { if ((await fetch(url)).ok) break; } catch { /* wait for Vite */ }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const scenario of ["deploy", "redeploy"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.runtimeErrors.push(`${scenario}: ${error.message}`));
    await page.goto(`${url}?scenario=${scenario}`, { waitUntil: "domcontentloaded" });
    const before = await stateOf(page);
    assert.equal(before.scenario, scenario);
    assert.equal(before.phase, "deploy");
    assert.equal(before.currentPlayer, 0);
    assert.deepEqual(before.submittedCommands, []);
    assert.ok(before.eventCount >= 0);
    const targetChoice = before.availableChoices.find((choice) => choice.kind === scenario);
    assert.ok(targetChoice, `${scenario} fixture should expose at least one legal choice through deploymentChoices`);
    assert.equal(targetChoice.sheet, "Army", `${scenario} fixture should exercise the active player's Army sheet`);
    assert.ok(targetChoice.destinations.length > 0, `${scenario} fixture should expose a legal destination`);

    await page.getByRole("button", { name: "Open military sheets", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Army", exact: true });
    await drawer.waitFor({ state: "visible" });
    const selectedControl = drawer.getByRole("button", { name: targetChoice.accessibleName, exact: true });
    assert.equal(await selectedControl.count(), 1, `${scenario} choice should be available in the production MilitarySheet`);
    await selectedControl.click();
    await drawer.waitFor({ state: "detached" });
    await page.waitForFunction(({ id }) => {
      const state = JSON.parse(document.querySelector("#deployment-cancel-state")?.textContent ?? "{}");
      return state.deploymentPieceId === id;
    }, { id: targetChoice.id });

    const selected = await stateOf(page);
    assert.equal(selected.selectedKind, scenario);
    assert.equal(selected.selectedUnit?.id, targetChoice.id);
    assert.equal(selected.selectedDestinationCount, targetChoice.destinations.length);
    assert.equal(await page.getByRole("button", { name: "Cancel placement", exact: true }).count(), 1);
    assert.deepEqual(await highlightKeys(page), [...targetChoice.destinations].sort(), `${scenario} should highlight only the chosen piece's legal board destinations`);
    assert.deepEqual(selected.submittedCommands, [], "choosing a piece only selects placement; it must not dispatch a command");
    assert.deepEqual(selected.unitPositions, before.unitPositions);

    await page.getByRole("button", { name: "Cancel placement", exact: true }).click();
    await page.waitForFunction(() => {
      const state = JSON.parse(document.querySelector("#deployment-cancel-state")?.textContent ?? "{}");
      return state.deploymentPieceId === null;
    });
    const after = await stateOf(page);
    assert.equal(after.deploymentPieceId, null, `${scenario} cancellation clears the selected piece`);
    assert.equal(after.selectedKind, null);
    assert.equal(after.selectedDestinationCount, 0);
    assert.equal(await page.getByRole("button", { name: "Cancel placement", exact: true }).count(), 0, "the placement prompt closes after cancellation");
    assert.deepEqual(await highlightKeys(page), [], "cancellation clears all deployment destination highlights");
    assert.deepEqual(after.submittedCommands, [], "cancellation does not dispatch deploy or redeploy");
    assert.deepEqual(after.inventory, before.inventory, "reserve/on-board inventory counts are unchanged");
    assert.deepEqual(after.unitPositions, before.unitPositions, "every unit remains on its original reserve tile or board hex");
    assert.equal(after.deploymentCountThisTurn, before.deploymentCountThisTurn);
    assert.deepEqual(after.deploymentDestinations, before.deploymentDestinations);
    assert.equal(after.eventCount, before.eventCount, "cancellation does not append a game event");
    assert.deepEqual(after.pendingDecision, before.pendingDecision);
    assert.equal(after.phase, before.phase);
    assert.deepEqual(after.availableChoices, before.availableChoices, "the same deploy/redeploy choices remain available after cancellation");

    await page.getByRole("button", { name: "Open military sheets", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: "Army", exact: true });
    await reopened.waitFor({ state: "visible" });
    assert.equal(await reopened.getByRole("button", { name: targetChoice.accessibleName, exact: true }).count(), 1, "the original piece remains available after canceling its placement");
    report.scenarios[scenario] = {
      status: "passed",
      productionSheetAction: targetChoice.accessibleName,
      commandTypeIfDestinationWereSelected: targetChoice.kind,
      selectedDestinationKeys: targetChoice.destinations,
      before: { inventory: before.inventory, selectedUnit: selected.selectedUnit, phase: before.phase, eventCount: before.eventCount },
      after: { inventory: after.inventory, unitPositionsUnchanged: true, selectedPieceCleared: after.deploymentPieceId === null, legalHighlights: await highlightKeys(page), commandCount: after.submittedCommands.length, eventCount: after.eventCount },
      choiceRemainsAvailable: true,
    };
    await page.close();
  }

  assert.deepEqual(report.runtimeErrors, [], "browser fixtures should not produce uncaught runtime errors");
  report.completed = new Date().toISOString();
  report.status = "passed";
  const artifact = join(artifactDirectory, `deployment-cancel-${date}.json`);
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Deployment cancellation browser acceptance passed. Evidence: ${artifact}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.completed = new Date().toISOString();
  report.status = "failed";
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, `deployment-cancel-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
