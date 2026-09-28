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
const reservePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve an Encounter focus verifier port."));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = await reservePort();
const url = `http://127.0.0.1:${port}/encounter-focus-harness.html`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    new Promise((resolve) => server.once("exit", resolve)),
    wait(2000).then(() => server.kill("SIGKILL")),
  ]);
};

let browser;
const report = { started: new Date().toISOString(), viewports: {}, runtimeErrors: [] };
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try {
      if ((await fetch(url)).ok) break;
    } catch { /* Wait for Vite to start. */ }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }

  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const viewportCases = [
    { name: "desktop", options: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
    { name: "mobile-390x844", options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ];

  for (const { name, options } of viewportCases) {
    const page = await browser.newPage(options);
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => report.runtimeErrors.push(`${name}: ${error.message}`));
    const dialog = page.locator("dialog.resolution-encounter[open]");
    const heading = page.locator("#action-heading");

    const openAndReveal = async (scenario, activation = "keyboard") => {
      await page.goto(`${url}?scenario=${scenario}`, { waitUntil: "domcontentloaded" });
      const opener = page.getByRole("button", { name: "Resolve encounter", exact: true });
      if (activation === "keyboard") {
        await opener.focus();
        assert.equal(await opener.evaluate((node) => node === document.activeElement), true, `${name}/${scenario}: the Encounter opener accepts keyboard focus`);
        await page.keyboard.press("Enter");
      } else {
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement : document.body).blur());
        assert.equal(await page.evaluate(() => document.activeElement === document.body), true, `${name}/${scenario}: pointer activation starts while BODY owns focus`);
        if (activation === "touch") await opener.tap();
        else await opener.click();
      }
      await dialog.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.activeElement?.classList.contains("resolution-close"));
      assert.equal(await dialog.locator(".resolution-close").evaluate((node) => node === document.activeElement), true,
        `${name}/${scenario}: opening the Encounter moves keyboard focus to the dialog's Board control`);
      if (activation !== "keyboard" && scenario !== "body-fallback") {
        assert.equal(await page.locator("#encounter-focus-state").evaluate((node) => JSON.parse(node.textContent ?? "{}").openerLabel), "Resolve encounter",
          `${name}/${scenario}: pointer activation captures the clicked trigger as the opener`);
      } else if (scenario === "body-fallback") {
        assert.equal(await page.locator("#encounter-focus-state").evaluate((node) => JSON.parse(node.textContent ?? "{}").activeElementAtOpen), "BODY",
          `${name}/${scenario}: the dialog opens with BODY active and no trigger supplied`);
      }
      const bounds = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
      assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1,
        `${name}/${scenario}: the Encounter dialog fits its viewport: ${JSON.stringify(bounds)}`);
      await dialog.getByRole("button", { name: /Reveal encounter/ }).click();
      await opener.waitFor({ state: "detached" });
      assert.equal(await page.locator("#encounter-focus-state").evaluate((node) => JSON.parse(node.textContent ?? "{}").revealed), true,
        `${name}/${scenario}: Reveal transitions to the deterministic resolved fixture`);
      return bounds;
    };

    const escapeBounds = await openAndReveal("focus");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "action-heading");
    assert.equal(await heading.evaluate((node) => node === document.activeElement), true,
      `${name}: Escape restores focus to the persistent action heading after the opener is removed`);

    const boardBounds = await openAndReveal("focus", name === "mobile-390x844" ? "touch" : "pointer");
    await dialog.getByRole("button", { name: "Return to board", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "action-heading");
    assert.equal(await heading.evaluate((node) => node === document.activeElement), true,
      `${name}: the Board close control restores focus to the persistent action heading after the opener is removed`);

    const bodyFallbackBounds = await openAndReveal("body-fallback", name === "mobile-390x844" ? "touch" : "pointer");
    await dialog.getByRole("button", { name: "Return to board", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "action-heading");
    assert.equal(await heading.evaluate((node) => node === document.activeElement), true,
      `${name}: a BODY activeElement falls back to the persistent action heading when no opener was captured`);

    const pendingBounds = await openAndReveal("pending");
    await dialog.locator(".cinema-choice").waitFor({ state: "visible" });
    await page.waitForTimeout(1150);
    assert.equal(await dialog.count(), 1, `${name}: pending reward keeps the autoplay dialog open until a choice is made`);
    assert.equal(await page.locator("#encounter-focus-state").evaluate((node) => JSON.parse(node.textContent ?? "{}").choice), "",
      `${name}: the fixture has no choice recorded before the reward is selected`);
    await dialog.getByRole("button", { name: /Take city Health/ }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#encounter-focus-state")?.textContent ?? "{}").choice === "health");
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "action-heading");
    assert.deepEqual(await page.locator("#encounter-focus-state").evaluate((node) => JSON.parse(node.textContent ?? "{}").choice), "health",
      `${name}: making a reward choice releases the pending autoplay close`);

    const commandFailureBounds = await openAndReveal("choice-failure");
    await dialog.locator(".cinema-choice").waitFor({ state: "visible" });
    const choiceButton = dialog.getByRole("button", { name: /Take city Health/ });
    await choiceButton.click();
    await dialog.getByRole("alert").getByText("Harness-injected overlay command failure.").waitFor({ state: "visible" });
    assert.ok(await choiceButton.isEnabled(), `${name}: failed overlay choice re-enables the original reward button`);
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Take city Health"));
    assert.equal(await choiceButton.evaluate((node) => node === document.activeElement), true,
      `${name}: the production EncounterOverlay returns focus to the failed reward button`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#encounter-focus-state")?.textContent ?? "{}").choice === "health");
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "action-heading");

    await page.goto(`${url}?scenario=ownership`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Resolve encounter", exact: true }).click();
    await dialog.waitFor({ state: "visible" });
    const transitionOwnership = async (label, change, returnChange, stateKey) => {
      await page.evaluate(([key, value]) => window.__encounterOwnershipFixture[key](value), [change.key, change.value]);
      await dialog.waitFor({ state: "detached" });
      const closedState = await page.locator("#encounter-ownership-state").evaluate((node) => JSON.parse(node.textContent ?? "{}"));
      assert.equal(closedState.requestedOpen, false, `${name}: ${label} transition clears the requested-open state`);
      assert.equal(closedState.ownerPlayerIndex, undefined, `${name}: ${label} transition clears the remembered owner`);
      await page.evaluate(([key, value]) => window.__encounterOwnershipFixture[key](value), [returnChange.key, returnChange.value]);
      await page.waitForTimeout(0);
      assert.equal(await dialog.count(), 0, `${name}: returning after ${label} does not unexpectedly reopen Encounter`);
      await page.getByRole("button", { name: "Resolve encounter", exact: true }).click();
      await dialog.waitFor({ state: "visible" });
    };
    await transitionOwnership("participant role change", { key: "setRole", value: "spectator" }, { key: "setRole", value: "player" });
    await transitionOwnership("participant seat change", { key: "setSeat", value: 1 }, { key: "setSeat", value: 0 });
    await page.evaluate(() => window.__encounterOwnershipFixture.setRole(undefined));
    await dialog.waitFor({ state: "detached" });

    report.viewports[name] = {
      status: "passed",
      escape: { openerRemovedByReveal: true, focusRestoredTo: "action-heading", dialogBounds: escapeBounds },
      boardClose: { activation: name === "mobile-390x844" ? "touch" : "pointer", clickedTriggerCaptured: true, openerRemovedByReveal: true, focusRestoredTo: "action-heading", dialogBounds: boardBounds },
      bodyFallback: { activeElementAtOpen: "BODY", openerCaptured: false, focusRestoredTo: "action-heading", dialogBounds: bodyFallbackBounds },
      pendingChoice: { stayedOpenUntilChoice: true, selected: "health", focusRestoredTo: "action-heading", dialogBounds: pendingBounds },
      choiceCommandFailure: { failureInjectedInLocalHarnessCallbackBeforeCommandAcceptance: true, rewardStayedAvailable: true, focusRestoredToRewardButton: true, keyboardRetryAccepted: true, serviceFailureNotTested: true, dialogBounds: commandFailureBounds },
      ownershipGate: { roleChangeDoesNotReopen: true, seatChangeDoesNotReopen: true, decisionPlayerUnchanged: 0 },
    };
    await page.close();
  }

  assert.deepEqual(report.runtimeErrors, [], "Encounter focus scenarios complete without uncaught browser errors");
  const evidence = { ...report, finished: new Date().toISOString(), status: "passed" };
  const artifact = "output/ui-review/encounter-focus-2026-09-28.json";
  mkdirSync(join(cwd, "output/ui-review"), { recursive: true });
  writeFileSync(join(cwd, artifact), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence, artifact }, null, 2));
} finally {
  await browser?.close();
  await stopServer();
}
