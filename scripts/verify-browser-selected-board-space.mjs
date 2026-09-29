import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

const outputDir = join(process.cwd(), 'output/ui-review');
const reportPath = join(outputDir, 'selected-board-space-2026-09-29.json');
const reservePort = () => new Promise((resolve, reject) => {
  const server = createNetServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not reserve a browser-test port.'));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const port = process.env.BROWSER_TEST_URL ? undefined : await reservePort();
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = process.env.BROWSER_TEST_URL ? undefined : spawn(process.execPath, [join(process.cwd(), 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: join(process.cwd(), 'apps/web'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server?.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server?.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
const waitForServer = async () => {
  if (!server) return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      if (server.exitCode !== null) throw new Error(`Vite exited before ready.\n${serverOutput}`);
    }
    if (attempt === 119) throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const closeServer = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
};

const report = {
  run: 'selected board space disclosure on the production local-game route',
  date: '2026-09-29',
  route: 'Start local game → two monsters/branches/lairs → both Starting Choices → Move',
  states: {},
  failures: [],
};
let browser;
try {
  await mkdir(outputDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => report.failures.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start local game', exact: true }).click();

  // Complete monster, branch and lair setup through the application's controls.
  for (let choiceIndex = 0; choiceIndex < 6; choiceIndex += 1) {
    const lairSummary = page.locator('.lair-selection-prompt summary');
    if (await lairSummary.count() && !(await lairSummary.evaluate((node) => node.parentElement?.open))) {
      await lairSummary.click();
    }
    const choices = page.locator('.setup-panel .setup-options button:visible:enabled');
    await choices.first().waitFor({ state: 'visible' });
    await choices.first().click();
  }
  await page.getByRole('button', { name: 'Deploy starting troops', exact: true }).waitFor({ state: 'visible' });
  for (let seat = 0; seat < 2; seat += 1) {
    const drawResearch = page.getByRole('button', { name: 'Draw Research', exact: true });
    await drawResearch.waitFor({ state: 'visible' });
    await drawResearch.click();
  }
  await page.waitForFunction(() => document.querySelector('.action-card h2')?.textContent?.includes('Move'));
  const guide = page.getByRole('button', { name: 'Got it · hide guide', exact: true });
  if (await guide.isVisible().catch(() => false)) await guide.click();

  const panelToggle = page.locator('.game-screen > header .turn-hud-heading button');
  const selectedSpace = page.locator('#turn-hud-body details.hud-section').filter({ has: page.getByText('Selected board space', { exact: true }) });
  const selectedSummary = selectedSpace.locator('summary');
  if (await panelToggle.getAttribute('aria-expanded') === 'true') {
    await panelToggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await panelToggle.getAttribute('aria-expanded'), 'false', 'keyboard closes the initially open turn panel');
  }
  await panelToggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true', 'keyboard opens the turn panel');
  if (await selectedSpace.evaluate((node) => node.open)) {
    await selectedSummary.press('Enter');
  }
  await selectedSummary.press('Enter');
  assert.equal(await selectedSpace.evaluate((node) => node.open), true, 'keyboard opens Selected board space');
  const tray = page.locator('.board-context-tray');
  await tray.waitFor({ state: 'visible' });
  const initial = await page.evaluate(() => {
    const active = document.querySelector('.hex-tile.active');
    const trayNode = document.querySelector('.board-context-tray');
    return {
      activeHex: active?.getAttribute('data-hex-key') ?? null,
      activeName: active?.getAttribute('data-location-name') ?? null,
      title: trayNode?.querySelector('h3')?.textContent?.trim() ?? null,
      facts: trayNode?.querySelector('.board-context-facts')?.textContent?.trim() ?? null,
      focusIsOnBoardCell: document.activeElement?.matches('.hex-tile') ?? false,
    };
  });
  assert.ok(initial.title, 'without a manually selected board cell, disclosure falls back to the active monster hex');
  assert.match(initial.facts ?? '', /Zorb|Tomanagi|Konk|Megaclaw|Toxicor|Gargantis/, 'the initial selected-space facts identify the monster on the active hex');
  report.states.unselectedDesktop = initial;

  // The LA cell is a recorded feature and sea-edge case. Focus + Enter is the
  // board's keyboard activation path; it only changes the inspected hex here.
  await selectedSummary.press('Enter');
  const losAngeles = page.locator('.hex-tile[data-hex-key="2,7"]');
  await losAngeles.focus();
  await page.keyboard.press('Enter');
  await selectedSummary.press('Enter');
  await page.waitForFunction(() => document.querySelector('.board-context-tray h3')?.textContent?.trim() === 'Los Angeles');
  await tray.scrollIntoViewIfNeeded();
  const desktop = await page.evaluate(() => {
    const trayNode = document.querySelector('.board-context-tray');
    const panel = document.querySelector('.game-side-panel');
    const actionDock = document.querySelector('.board-action-bar');
    const facts = trayNode?.querySelector('.board-context-facts');
    const edges = trayNode?.querySelector('.board-context-edges');
    const note = trayNode?.querySelector('.board-context-note');
    const rect = (element) => {
      if (!element) return null;
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const withinViewport = (element) => {
      if (!element) return false;
      const { x, y, right, bottom } = element.getBoundingClientRect();
      return x >= -1 && y >= -1 && right <= innerWidth + 1 && bottom <= innerHeight + 1;
    };
    const overlaps = (first, second) => {
      if (!first || !second) return false;
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      title: trayNode?.querySelector('h3')?.textContent?.trim() ?? null,
      facts: facts?.textContent?.trim() ?? null,
      factsDisplay: facts ? getComputedStyle(facts).display : 'missing',
      edges: edges?.textContent?.trim() ?? null,
      edgesDisplay: edges ? getComputedStyle(edges).display : 'missing',
      noteDisplay: note ? getComputedStyle(note).display : 'missing',
      tray: rect(trayNode),
      panel: rect(panel),
      actionDock: rect(actionDock),
      panelOverlapsActionDock: overlaps(panel, actionDock),
      trayOverlapsActionDock: overlaps(trayNode, actionDock),
      panelLayout: panel ? {
        maxHeight: getComputedStyle(panel).maxHeight,
        overflowY: getComputedStyle(panel).overflowY,
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        pageScrollY: scrollY,
      } : null,
      contentVisible: {
        facts: Boolean(facts?.getClientRects().length && facts.getBoundingClientRect().height > 0),
        edges: Boolean(edges?.getClientRects().length && edges.getBoundingClientRect().height > 0),
        note: Boolean(note?.getClientRects().length && note.getBoundingClientRect().height > 0),
      },
      contentWithinViewport: {
        tray: withinViewport(trayNode),
        facts: withinViewport(facts),
        edges: withinViewport(edges),
        note: withinViewport(note),
      },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  report.states.selectedFeatureEdgeDesktop = desktop;
  await page.screenshot({ path: join(outputDir, 'selected-board-space-desktop-2026-09-29.png'), fullPage: false });

  // Touch path at the phone breakpoint, keeping the real route and game state.
  await page.setViewportSize({ width: 390, height: 844 });
  await selectedSummary.tap();
  if (await panelToggle.getAttribute('aria-expanded') === 'true') await panelToggle.tap();
  await losAngeles.tap();
  await page.waitForFunction(() => document.querySelector('.board-context-tray h3')?.textContent?.trim() === 'Los Angeles');
  await panelToggle.tap();
  await selectedSummary.tap();
  await tray.scrollIntoViewIfNeeded();
  const phone = await page.evaluate(() => {
    const trayNode = document.querySelector('.board-context-tray');
    const panel = document.querySelector('.game-side-panel');
    const facts = trayNode?.querySelector('.board-context-facts');
    const edges = trayNode?.querySelector('.board-context-edges');
    const note = trayNode?.querySelector('.board-context-note');
    const rect = (element) => {
      if (!element) return null;
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const withinViewport = (element) => {
      if (!element) return false;
      const { x, y, right, bottom } = element.getBoundingClientRect();
      return x >= -1 && y >= -1 && right <= innerWidth + 1 && bottom <= innerHeight + 1;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      title: trayNode?.querySelector('h3')?.textContent?.trim() ?? null,
      facts: facts?.textContent?.trim() ?? null,
      factsDisplay: facts ? getComputedStyle(facts).display : 'missing',
      edges: edges?.textContent?.trim() ?? null,
      edgesDisplay: edges ? getComputedStyle(edges).display : 'missing',
      noteDisplay: note ? getComputedStyle(note).display : 'missing',
      tray: rect(trayNode),
      panel: rect(panel),
      panelLayout: panel ? {
        maxHeight: getComputedStyle(panel).maxHeight,
        overflowY: getComputedStyle(panel).overflowY,
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        pageScrollY: scrollY,
      } : null,
      contentVisible: {
        facts: Boolean(facts?.getClientRects().length && facts.getBoundingClientRect().height > 0),
        edges: Boolean(edges?.getClientRects().length && edges.getBoundingClientRect().height > 0),
        note: Boolean(note?.getClientRects().length && note.getBoundingClientRect().height > 0),
      },
      contentWithinViewport: {
        tray: withinViewport(trayNode),
        facts: withinViewport(facts),
        edges: withinViewport(edges),
        note: withinViewport(note),
      },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      touchEnabled: matchMedia('(pointer: coarse)').matches,
    };
  });
  report.states.selectedFeatureEdgePhone = phone;
  await page.screenshot({ path: join(outputDir, 'selected-board-space-phone-2026-09-29.png'), fullPage: false });

  // A second production route creates a two-unit stack through deployment and
  // a legal move, leaving the disclosure independent of fixture state.
  const stackPage = await context.newPage();
  stackPage.setDefaultTimeout(12000);
  stackPage.on('pageerror', (error) => report.failures.push(`stack route: ${error.message}`));
  await stackPage.goto(url, { waitUntil: 'domcontentloaded' });
  await stackPage.getByRole('button', { name: 'Start local game', exact: true }).click();
  for (let choiceIndex = 0; choiceIndex < 6; choiceIndex += 1) {
    const lairSummary = stackPage.locator('.lair-selection-prompt summary');
    if (await lairSummary.count() && !(await lairSummary.evaluate((node) => node.parentElement?.open))) await lairSummary.click();
    await stackPage.locator('.setup-panel .setup-options button:visible:enabled').first().click();
  }
  await stackPage.getByRole('button', { name: 'Deploy starting troops', exact: true }).click();
  await stackPage.getByRole('button', { name: 'Deploy navy fighter piece 1', exact: true }).click();
  const firstDestination = stackPage.locator('.hex-tile.legal[data-hex-key="2,8"]');
  await firstDestination.focus();
  await stackPage.keyboard.press('Enter');
  await stackPage.getByRole('button', { name: 'Choose another starting unit', exact: true }).click();
  await stackPage.getByRole('button', { name: 'Deploy navy fighter piece 2', exact: true }).click();
  const secondDestination = stackPage.locator('.hex-tile.legal[data-hex-key="3,7"]');
  await secondDestination.focus();
  await stackPage.keyboard.press('Enter');
  const guardPiece = stackPage.getByRole('button', { name: 'Deploy national guard tank piece 1', exact: true });
  await guardPiece.click();
  const guardDestination = stackPage.locator('.hex-tile.legal:not(:disabled)').first();
  await guardDestination.focus();
  await stackPage.keyboard.press('Enter');
  await stackPage.getByRole('button', { name: 'Finish starting deployment', exact: true }).click();
  const researchChoice = stackPage.getByRole('button', { name: 'Draw Research', exact: true });
  await researchChoice.click();
  await stackPage.waitForFunction(() => document.querySelector('.action-card h2')?.textContent?.includes('Move'));
  const stackGuide = stackPage.getByRole('button', { name: 'Got it · hide guide', exact: true });
  if (await stackGuide.isVisible().catch(() => false)) await stackGuide.click();
  const stackToggle = stackPage.locator('.game-screen > header .turn-hud-heading button');
  const stackDisclosure = stackPage.locator('#turn-hud-body details.hud-section').filter({ has: stackPage.getByText('Selected board space', { exact: true }) });
  const stackSummary = stackDisclosure.locator('summary');
  if (await stackToggle.getAttribute('aria-expanded') === 'true') await stackToggle.click();
  const source = stackPage.locator('.hex-tile:has(.tile-piece)[aria-label*="select "]').first();
  await source.waitFor({ state: 'visible' });
  await source.click();
  const stackDestination = stackPage.locator('.hex-tile.legal:has(.tile-piece)').first();
  await stackDestination.waitFor({ state: 'visible' });
  const stackKey = await stackDestination.getAttribute('data-hex-key');
  await stackDestination.focus();
  await stackPage.keyboard.press('Enter');
  await stackPage.getByRole('button', { name: /Confirm move/ }).click();
  await stackPage.waitForFunction((key) => document.querySelectorAll(`.hex-tile[data-hex-key="${key}"] .tile-piece`).length >= 2, stackKey);
  await stackToggle.click();
  await stackSummary.press('Enter');
  const stackTray = stackPage.locator('.board-context-tray');
  await stackTray.scrollIntoViewIfNeeded();
  const stackFacts = await stackTray.locator('.board-context-facts').innerText();
  const stackCount = await stackPage.locator(`.hex-tile[data-hex-key="${stackKey}"] .tile-piece`).count();
  const stackedDisclosure = await stackPage.evaluate(() => {
    const trayNode = document.querySelector('.board-context-tray');
    const facts = trayNode?.querySelector('.board-context-facts');
    if (!trayNode) return null;
    const rect = trayNode.getBoundingClientRect();
    return {
      title: trayNode.querySelector('h3')?.textContent?.trim() ?? null,
      facts: facts?.textContent?.trim() ?? null,
      visible: Boolean(trayNode.getClientRects().length && rect.height > 0),
      withinViewport: rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    };
  });
  report.states.stackedOccupantDesktop = { hex: stackKey, unitCount: stackCount, facts: stackFacts.trim(), disclosure: stackedDisclosure };
  assert.ok(stackCount >= 2, `the ordinary move should create a visible two-unit stack at ${stackKey}`);
  assert.match(stackFacts, /Navy unit, National Guard unit/);
  assert.ok(stackedDisclosure?.visible && stackedDisclosure.withinViewport, 'the scrolled stacked-occupant disclosure is actually visible within the viewport');
  assert.match(stackedDisclosure?.facts ?? '', /Navy unit, National Guard unit/);
  await stackPage.screenshot({ path: join(outputDir, 'selected-board-space-stacked-2026-09-29.png'), fullPage: false });

  assert.equal(desktop.title, 'Los Angeles');
  assert.match(desktop.facts ?? '', /city · 3d6 Health/);
  assert.match(desktop.edges ?? '', /sea barrier/);
  const displayedEdges = (desktop.edges ?? '').replace(/^Edges:\s*/, '').split(' · ').filter(Boolean);
  assert.equal(new Set(displayedEdges).size, displayedEdges.length, 'reciprocal board records should appear once per neighbor/barrier');
  assert.match(desktop.edges ?? '', /no barrier/);
  assert.doesNotMatch(desktop.edges ?? '', /none barrier/);
  assert.equal(desktop.edgesDisplay, 'block');
  assert.deepEqual(desktop.contentVisible, { facts: true, edges: true, note: true }, 'desktop facts, recorded edges, and source note are visible after scrolling the disclosure into view');
  assert.equal(desktop.panelOverlapsActionDock, false, `desktop disclosure panel must clear the fixed action dock: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.trayOverlapsActionDock, false, `desktop selected-space details must clear the fixed action dock: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.horizontalOverflow, false);
  assert.equal(phone.title, 'Los Angeles');
  assert.match(phone.facts ?? '', /city · 3d6 Health/);
  assert.match(phone.edges ?? '', /sea barrier/);
  assert.equal(phone.factsDisplay, 'flex');
  assert.deepEqual(phone.contentVisible, { facts: true, edges: true, note: true }, 'phone facts, recorded edges, and source note are visible after touch-open and drawer scroll');
  assert.equal(phone.horizontalOverflow, false);
  assert.ok(phone.panel && phone.tray && phone.tray.x >= phone.panel.x - 1 && phone.tray.right <= phone.panel.right + 1, `phone tray should fit inside its panel: ${JSON.stringify(phone)}`);
  assert.deepEqual(phone.contentWithinViewport, { tray: true, facts: true, edges: true, note: true });
  assert.deepEqual(desktop.contentWithinViewport, { tray: true, facts: true, edges: true, note: true });
  assert.deepEqual(report.failures, [], 'the production route should have no uncaught runtime errors');
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await closeServer();
  console.log(JSON.stringify({ reportPath, ok: report.ok ?? false, states: Object.keys(report.states), error: report.error }));
}
