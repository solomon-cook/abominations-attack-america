import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';

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

let browser;
const closeServer = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
};

try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto(url);
  await page.getByRole('button', { name: 'Start local game', exact: true }).click();

  // Complete two-player monster, branch, and lair selection through the UI.
  for (let choiceIndex = 0; choiceIndex < 6; choiceIndex += 1) {
    const lairList = page.locator('.lair-selection-prompt summary');
    if (await lairList.count()) await lairList.click();
    await page.locator('.setup-options button:enabled').first().click();
  }

  await page.getByRole('button', { name: 'Deploy starting troops', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy navy fighter piece 1', exact: true }).click();
  const first = page.locator('.hex-tile.legal[data-hex-key="2,8"]');
  await first.focus();
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Choose another starting unit', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy navy fighter piece 2', exact: true }).click();
  const second = page.locator('.hex-tile.legal[data-hex-key="3,7"]');
  await second.focus();
  await page.keyboard.press('Enter');

  // The current digital setup allowance adds a Guard placement after its two
  // Navy pieces. Wait for that separate record-sheet tab and finish the choice.
  const guardPiece = page.getByRole('button', { name: 'Deploy national guard tank piece 1', exact: true });
  await guardPiece.waitFor({ state: 'visible' });
  await guardPiece.click();
  const guardDestination = page.locator('.hex-tile.legal:not(:disabled)').first();
  await guardDestination.waitFor({ state: 'visible' });
  const guardDestinationKey = await guardDestination.getAttribute('data-hex-key');
  await guardDestination.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Finish starting deployment', exact: true }).click();
  await page.getByRole('button', { name: 'Draw Research', exact: true }).click();

  const pieces = page.locator('.tile-piece');
  assert.ok(await pieces.count() >= 3, 'the three starting units should be placed on the board');
  const sourceTile = page.locator('.hex-tile:has(.tile-piece)[aria-label*="select "]').first();
  await sourceTile.focus();
  await sourceTile.click();
  await page.waitForTimeout(250);
  const contextTab = page.locator('details.piece-context-tab');
  await contextTab.locator('summary').click();
  assert.equal(await contextTab.evaluate((node) => node.open), true, 'selected unit details disclosure opens');
  await page.locator('.piece-detail-tray.unit-command-record').waitFor({ state: 'visible' });
  const focusOffset = await sourceTile.evaluate((node) => {
    const sourceRect = node.getBoundingClientRect();
    const viewportRect = document.querySelector('.board-viewport').getBoundingClientRect();
    return Math.hypot(sourceRect.x + sourceRect.width / 2 - viewportRect.x - viewportRect.width * .42, sourceRect.y + sourceRect.height / 2 - viewportRect.y - viewportRect.height / 2);
  });
  assert.ok(focusOffset < 4, 'selected unit focuses in the clear left lane beside the command HUD');

  const camera = await page.locator('.map-canvas').getAttribute('style');
  const destination = page.locator('.hex-tile.legal:has(.tile-piece)').first();
  await destination.focus();
  await destination.locator('.tile-piece').click();
  assert.equal(await page.locator('.map-canvas').getAttribute('style'), camera, 'destination preview preserves camera');
  assert.match(await page.locator('.action-dock').innerText(), /Confirm move/);
  await page.locator('.action-dock button').first().click();
  assert.equal(await destination.locator('.tile-piece').count(), 2);

  console.log(JSON.stringify({
    ok: true,
    viewport: '1440x900',
    startingPlacement: ['two Navy fighters', `one National Guard tank at ${guardDestinationKey}`],
    unitMove: 'selection centers; occupied artwork path preview preserves camera; move commits as a stack',
  }));
} finally {
  await browser?.close();
  await closeServer();
}
