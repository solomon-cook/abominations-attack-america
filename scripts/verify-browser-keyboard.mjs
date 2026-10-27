import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromePath } from "./chrome-path.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const reservePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a browser-test port."));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const port = Number(process.env.BROWSER_KEYBOARD_PORT ?? await reservePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = process.env.BROWSER_TEST_URL ? undefined : spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if (await (await fetch(url)).ok) break;
    } catch {
      if (server.exitCode !== null) throw new Error(`Vite exited before ready.\n${serverOutput}`);
    }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await wait(100);
  }
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const tabTo = async (locator, label) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard Tab could not reach ${label}.`);
};
const activateByKeyboard = async (locator, label) => {
  await tabTo(locator, label);
  await page.keyboard.press("Enter");
};
const completeSetup = async () => {
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 16 && await page.locator(".setup-panel").count(); attempt += 1) {
    const list = page.locator(".lair-selection-prompt details");
    if (await list.count() && !(await list.evaluate((node) => node.open))) await activateByKeyboard(list.locator("summary"), "lair choices");
    if ((await page.locator(".setup-panel h2").textContent().catch(() => ""))?.trim() === "Place unused branches") {
      for (const select of await page.locator(".unused-branch-placement select").all()) {
        await tabTo(select, await select.getAttribute("aria-label") ?? "unused branch base choice");
        const firstChoice = await select.evaluate((element) => [...element.options].find((option) => option.value && !option.disabled)?.text ?? "");
        await page.keyboard.type(firstChoice);
        await page.keyboard.press("Enter");
      }
      const placementValues = await page.locator(".unused-branch-placement select").evaluateAll((selects) => selects.map((select) => select.value));
      assert.equal(placementValues.every(Boolean), true, "keyboard base selection must populate every unused branch unit");
      await activateByKeyboard(page.getByRole("button", { name: "Place units and continue", exact: true }), "place unused branch units");
      continue;
    }
    const choice = page.locator(".setup-panel .setup-options button:visible:not(:disabled)").first();
    await choice.waitFor({ state: "visible" });
    await activateByKeyboard(choice, "current setup choice");
    await page.waitForTimeout(80);
  }
  await page.locator(".setup-panel").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector(".action-card h2")?.textContent?.includes("Move"));
};

try {
  let actionLabel = "first keyboard matrix skipped";
  if (process.env.BROWSER_KEYBOARD_VICTORY_ONLY !== "1") {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: /Start local game/ });
  await activateByKeyboard(start, "Start local game");
  await page.locator(".setup-panel").waitFor({ state: "visible" });
  // Setup has several meaningful choices; enter the real local audited-board
  // match, then exercise the interaction-heavy gameplay controls by keyboard.
  await completeSetup();

  const menu = page.locator(".hud-menu > summary");
  await activateByKeyboard(menu, "game menu");
  assert.equal(await page.locator(".hud-menu").evaluate((node) => node.open), true);
  const settings = page.locator(".hud-menu .settings-action");
  await activateByKeyboard(settings, "Settings");
  await page.locator(".settings-panel").waitFor({ state: "visible" });
  const boardTheme = page.getByRole("combobox", { name: "Board theme" });
  assert.equal(await boardTheme.locator("option").count(), 3, "all board themes are available to keyboard users");
  await boardTheme.selectOption("moonlit");
  assert.equal(await page.locator("main.game-screen").getAttribute("data-board-theme"), "moonlit");
  assert.equal(await page.evaluate(() => localStorage.getItem("abominations-board-theme")), "moonlit");
  await boardTheme.selectOption("desert");
  assert.equal(await page.locator("main.game-screen").getAttribute("data-board-theme"), "desert");
  await boardTheme.selectOption("classic");
  await page.keyboard.press("Escape");
  await page.locator(".settings-panel").waitFor({ state: "detached" });
  await tabTo(menu, "game menu after closing Settings");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".hud-menu")?.open);

  const recordToggle = page.getByRole("button", { name: /^Open .* health \d+, infamy \d+$/ }).first();
  await activateByKeyboard(recordToggle, "player record");
  const monsterTab = page.getByRole("tab", { name: "Monster" });
  await monsterTab.waitFor({ state: "visible" });
  await tabTo(monsterTab, "Monster record tab");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Military" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Map" }).getAttribute("aria-selected"), "true");
  const overview = page.getByRole("button", { name: "Board overview. Click to move camera; arrow keys pan." });
  await overview.waitFor({ state: "visible" });
  const beforePan = await page.locator(".map-canvas").getAttribute("style");
  await tabTo(overview, "board overview");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.locator(".map-canvas").getAttribute("style"), beforePan, "the overview keyboard arrows pan the board");
  await activateByKeyboard(page.getByRole("button", { name: "Minimize monster, military and map record" }), "minimize record");

  const boardCell = page.locator(".hex-tile[tabindex='0']:not(:disabled)").first();
  await boardCell.waitFor({ state: "visible" });
  await tabTo(boardCell, "roving-focus board cell");
  let legalDestinationFocused = false;
  for (const direction of ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"]) {
    await page.keyboard.press(direction);
    const focusedCell = page.locator(".hex-tile:focus");
    legalDestinationFocused = await focusedCell.evaluate((element) => element.classList.contains("legal") && !element.disabled).catch(() => false);
    if (legalDestinationFocused) break;
  }
  assert.equal(legalDestinationFocused, true, "arrow-key board navigation should reach a legal movement destination");
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("button", { name: "Confirm move", exact: true });
  await confirm.waitFor({ state: "visible" });
  await activateByKeyboard(confirm, "Confirm move");
  await page.waitForFunction(() => {
    const button = document.querySelector(".action-dock > button");
    return button && button.textContent?.trim() !== "Confirm move" && !button.disabled;
  });
  actionLabel = await page.locator(".action-dock > button").innerText();
  assert.match(actionLabel, /Hold|Next piece|Continue to Fight|End movement/i);
  }

  // A second clean session drives the complete temporary-victory route using
  // keyboard focus and activation only. The graph is read from each hex's
  // canonical neighbour metadata, then arrow transitions mirror HexGrid's
  // directional focus rule.
  const victoryPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  victoryPage.on("pageerror", (error) => errors.push(error.message));
  const keyboardTabTo = async (locator, label) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return;
      await victoryPage.keyboard.press("Tab");
    }
    const focusState = await victoryPage.evaluate(() => ({ active: document.activeElement?.outerHTML?.slice(0, 300), target: [...document.querySelectorAll(".hex-tile[tabindex='0']")].map((element) => ({ key: element.getAttribute("data-hex-key"), disabled: element.disabled, rect: element.getBoundingClientRect().toJSON() })) }));
    throw new Error(`Keyboard Tab could not reach ${label}. ${JSON.stringify(focusState)}`);
  };
  const activateFocused = async (locator, label) => {
    await keyboardTabTo(locator, label);
    await victoryPage.keyboard.press("Enter");
  };
  const activateVisibleButton = async (predicate, label) => {
    for (const button of await victoryPage.locator("button:visible:not(:disabled)").all()) {
      if (predicate((await button.innerText()).trim())) {
        await activateFocused(button, label);
        return true;
      }
    }
    return false;
  };
  const phaseName = () => victoryPage.locator(".action-card h2").innerText().then((value) => value.trim());
  const waitForPhase = async (predicate, label) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (predicate(await phaseName())) return;
      await wait(100);
    }
    throw new Error(`Keyboard match did not reach ${label}; current phase: ${await phaseName()}`);
  };
  const moveFocusToLocation = async (locationName) => {
    const tiles = await victoryPage.locator(".hex-tile").evaluateAll((elements) => elements.map((element) => ({
      key: element.getAttribute("data-hex-key"),
      name: element.getAttribute("data-location-name"),
      neighbours: (element.getAttribute("data-neighbours") ?? "").split(/\s+/).filter(Boolean),
      point: [Number.parseFloat(element.style.left), Number.parseFloat(element.style.top)],
    })));
    const byKey = new Map(tiles.map((tile) => [tile.key, tile]));
    const start = await victoryPage.locator(".hex-tile[tabindex='0']").getAttribute("data-hex-key");
    const destination = tiles.find((tile) => tile.name === locationName);
    assert.ok(start && destination, `keyboard board contains the focused cell and ${locationName}`);
    const directions = [
      ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]],
      ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]],
    ];
    const queue = [start];
    const previous = new Map([[start, null]]);
    const via = new Map();
    for (let index = 0; index < queue.length && !previous.has(destination.key); index += 1) {
      const key = queue[index];
      const origin = byKey.get(key);
      if (!origin) continue;
      for (const [direction, vector] of directions) {
        const candidates = origin.neighbours
          .map((neighbourKey) => byKey.get(neighbourKey))
          .filter(Boolean)
          .map((candidate) => {
            const dx = candidate.point[0] - origin.point[0];
            const dy = candidate.point[1] - origin.point[1];
            return { key: candidate.key, forward: dx * vector[0] + dy * vector[1], distance: Math.hypot(dx, dy) };
          })
          .filter((candidate) => candidate.forward > 0)
          .sort((a, b) => a.distance - b.distance || b.forward - a.forward);
        const nextKey = candidates[0]?.key;
        if (nextKey && !previous.has(nextKey)) {
          previous.set(nextKey, key);
          via.set(nextKey, direction);
          queue.push(nextKey);
        }
      }
    }
    assert.ok(previous.has(destination.key), `arrow navigation reaches ${locationName} (start=${start}, destination=${destination.key}, cells=${tiles.length}, focusable=${await victoryPage.locator(".hex-tile[tabindex]").count()}, start-neighbours=${byKey.get(start)?.neighbours.join(";")})`);
    const keys = [];
    for (let key = destination.key; key !== start; key = previous.get(key)) keys.push(key);
    keys.reverse();
    await keyboardTabTo(victoryPage.locator(`.hex-tile[data-hex-key="${start}"]`), "board focus");
    for (const key of keys) {
      await victoryPage.keyboard.press(via.get(key));
      assert.equal(await victoryPage.locator(".hex-tile:focus").getAttribute("data-hex-key"), key, "arrow keys move focus by one accessible hex neighbour");
    }
    const destinationTile = victoryPage.locator(`.hex-tile[data-hex-key="${destination.key}"]`);
    const isLegal = await destinationTile.evaluate((element) => element.classList.contains("legal") && !element.disabled);
    assert.equal(isLegal, true, `${locationName} is a legal keyboard destination (phase=${await phaseName()}, actions=${JSON.stringify(await victoryPage.locator("button:visible:not(:disabled)").allInnerTexts())})`);
    await victoryPage.keyboard.press("Enter");
    await victoryPage.getByRole("button", { name: "Confirm move", exact: true }).waitFor({ state: "visible" });
    assert.equal(await victoryPage.getByRole("button", { name: "Confirm move", exact: true }).isEnabled(), true, "the path confirmation has an accessible name and is enabled");
    const completedBefore = await victoryPage.locator(".movement-piece.completed").count();
    await activateFocused(victoryPage.getByRole("button", { name: "Confirm move", exact: true }), "Confirm move");
    await victoryPage.waitForFunction((count) => document.querySelectorAll(".movement-piece.completed").length > count, completedBefore);
  };

  await victoryPage.goto(url, { waitUntil: "domcontentloaded" });
  await activateFocused(victoryPage.locator(".home-tools > summary"), "Playtest tools");
  await activateFocused(victoryPage.getByRole("button", { name: "Victory test", exact: true }), "temporary victory scenario");
  await waitForPhase((phase) => phase === "Move", "Move");
  const keyboardRoute = ["San Francisco", "Denver", "Seattle", "Chicago", "Infamy Site", "New York", "Los Angeles"];
  for (const destination of keyboardRoute) {
    await waitForPhase((phase) => phase === "Move", `${destination} Move`);
    await moveFocusToLocation(destination);
    if (await phaseName() === "Move") {
      const endMovement = victoryPage.locator(".end-movement:visible:not(:disabled)");
      if (await endMovement.count()) {
        await activateFocused(endMovement, "End movement");
        await waitForPhase((phase) => phase === "Fight" || phase === "Encounter", `${destination} Fight or Encounter`);
      } else if (await activateVisibleButton((label) => label === "Continue to Fight", "Continue to Fight")) {
        await waitForPhase((phase) => phase === "Fight" || phase === "Encounter", `${destination} Fight or Encounter`);
      }
    }
    if (await phaseName() === "Fight") {
      assert.equal(await victoryPage.locator(".hex-tile.battle:not(:disabled)").count(), 0, "the temporary-victory fixture has no combat decision to skip");
      assert.equal(await victoryPage.getByRole("button", { name: "Continue to Encounter", exact: true }).isEnabled(), true, "Fight continuation is accessible");
      await activateFocused(victoryPage.getByRole("button", { name: "Continue to Encounter", exact: true }), "Continue to Encounter");
      await waitForPhase((phase) => phase === "Encounter", `${destination} Encounter`);
    }
    if (await phaseName() === "Encounter") {
      for (let step = 0; step < 40 && await phaseName() === "Encounter"; step += 1) {
        if (await victoryPage.locator(".resolution-stage[open]").count()) {
          if (await activateVisibleButton((label) => label.startsWith("Reveal encounter"), "Reveal encounter")) continue;
          if (await activateVisibleButton((label) => label === "Reveal remaining rolls", "Reveal remaining rolls")) continue;
          const modalChoice = victoryPage.locator(".cinema-choice button:visible:not(:disabled)").first();
          if (await modalChoice.count()) {
            await activateFocused(modalChoice, "encounter reward");
            continue;
          }
          const modalReturn = victoryPage.locator(".resolution-stage .cinema-primary:visible:not(:disabled)").filter({ hasText: "Return to board" });
          if (await modalReturn.count()) {
            await activateFocused(modalReturn, "Return to board");
            continue;
          }
          await activateFocused(victoryPage.getByRole("button", { name: "Return to board", exact: true }), "close encounter playback");
          continue;
        }
        if (await victoryPage.locator(".cinema-intro:visible").count() && await activateVisibleButton((label) => label === "Reveal encounter", "Reveal encounter")) continue;
        if (await activateVisibleButton((label) => label === "Reveal remaining rolls", "Reveal remaining rolls")) continue;
        const cinemaChoice = victoryPage.locator(".cinema-choice button:visible:not(:disabled)").first();
        if (await cinemaChoice.count()) {
          await activateFocused(cinemaChoice, "encounter reward");
          continue;
        }
        const returnToBoard = victoryPage.locator(".cinema-primary:visible:not(:disabled)").filter({ hasText: "Return to board" });
        if (await returnToBoard.count()) {
          await activateFocused(returnToBoard, "Return to board");
          continue;
        }
        if (await activateVisibleButton((label) => label === "Resolve encounter", "Resolve encounter")) {
          await victoryPage.waitForTimeout(100);
          continue;
        }
        if (await activateVisibleButton((label) => /^Roll all \d+ dice\b|^Resolve city stomp$/.test(label), "resolve city encounter")) {
          await victoryPage.waitForTimeout(100);
          continue;
        }
        if (await activateVisibleButton((label) => label === "Choose encounter option", "Choose encounter option")) continue;
        if (await activateVisibleButton((label) => /^Take .* Health$|^Take \d+ Infamy instead$/.test(label), "choose encounter reward")) {
          await victoryPage.waitForTimeout(100);
          continue;
        }
        const encounterPrimary = victoryPage.locator(".action-dock > button:visible:not(:disabled)");
        if (await encounterPrimary.count()) {
          await activateFocused(encounterPrimary, "open or resolve the current Encounter decision");
          continue;
        }
        await wait(150);
        continue;
      }
      await waitForPhase((phase) => phase === "Deploy" || phase.startsWith("Victory · "), `${destination} encounter resolution`);
    }
    if (await phaseName() === "Deploy") {
      if (await victoryPage.locator(".resolution-stage[open]").count()) {
        await activateFocused(victoryPage.getByRole("button", { name: "Return to board", exact: true }), "finish encounter playback");
      }
      let passDeployment = victoryPage.getByRole("button", { name: "Pass deployment", exact: true });
      if (!(await passDeployment.count())) {
        const deploymentPrimary = victoryPage.locator(".action-dock > button:visible:not(:disabled)");
        if (await deploymentPrimary.count()) await activateFocused(deploymentPrimary, "open Deploy actions");
        passDeployment = victoryPage.getByRole("button", { name: "Pass deployment", exact: true });
      }
      if (!(await passDeployment.count())) {
        const phaseContext = victoryPage.locator("#phase-command-context");
        if (await phaseContext.count() && !(await phaseContext.evaluate((element) => element.open))) await activateFocused(phaseContext.locator("summary"), "open Deploy actions");
      }
      assert.equal(await passDeployment.count(), 1, `Deploy pass is exposed to keyboard users; actions=${JSON.stringify(await victoryPage.locator("button:visible:not(:disabled)").allInnerTexts())}`);
      assert.equal(await passDeployment.isEnabled(), true, "Deploy pass is an accessible pending decision");
      await activateFocused(passDeployment, "Pass deployment");
      await waitForPhase((phase) => phase === "Move" || phase.startsWith("Victory · "), `${destination} next turn`);
    }
  }
  await waitForPhase((phase) => phase.startsWith("Victory · "), "temporary victory");
  await victoryPage.getByRole("heading", { name: /^Victory · / }).waitFor({ state: "visible" });
  await victoryPage.getByRole("button", { name: "Start another local playtest", exact: true }).waitFor({ state: "visible" });
  assert.deepEqual(errors, [], "keyboard play should not produce runtime errors");
  console.log(JSON.stringify({ ok: true, viewport: "1280x720", keyboard: ["ordered setup and unused-branch base choices", "menu, settings, and board theme selection/persistence", "record-tab arrow navigation", "minimap arrow-key pan", "roving-focus board arrows", "complete temporary-victory route through Fight, Encounter, and Deploy"], route: keyboardRoute, nextAction: actionLabel.trim(), terminal: "accessible victory heading and restart control" }));
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
