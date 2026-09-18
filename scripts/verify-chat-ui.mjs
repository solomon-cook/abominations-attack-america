import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from './chrome-path.mjs';
const browser = await chromium.launch({ executablePath: chromePath });
try {
  for (const [width, height] of [[1440,900],[390,844]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 700 });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5191');
    await page.getByRole('button', { name: 'Start local game', exact: true }).click();
    const cards = page.locator('.monster-choice');
    assert.equal(await cards.count(), 6);
    await cards.first().hover();
    assert.ok((await cards.first().innerText()).includes('May get 2 Infamy'));
    await page.waitForFunction(() => [...document.querySelectorAll('.monster-choice img')].every(i => i.complete && i.naturalWidth));
    const rows = await cards.evaluateAll(nodes => nodes.map(n => n.offsetTop));
    assert.equal(new Set(rows).size, 1, 'monsters form one row');
    for (let i=0;i<8;i++) await page.locator('.setup-options button:enabled').first().click();
    await page.locator('.setup-panel').waitFor({state:'detached'});
    assert.ok(await page.locator('.piece-detail-tray').isVisible());
    const tile = page.locator('.hex-tile.legal').first();
    await tile.focus(); await page.keyboard.press('Enter');
    await page.locator('.action-dock button').first().click();
    for (let i=0;i<8;i++) {
      const label = await page.locator('.action-dock button').first().innerText();
      if (/Continue to Fight|Resolve fight|Resolve encounter/.test(label)) await page.locator('.action-dock button').first().click();
      else if (await page.getByRole('button',{name:'Take the city Health benefit',exact:true}).isVisible()) await page.getByRole('button',{name:'Take the city Health benefit',exact:true}).click();
      else break;
    }
    assert.match(await page.locator('.action-dock').innerText(), /Deploy|deployment/);
    await page.locator('.action-dock').getByRole('button',{name:'Finish deployment',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('header')?.textContent.includes('PLAYER 2'));
    assert.deepEqual(errors, []);
    assert.ok(await page.locator('.action-dock').isVisible());
    const toggle=page.getByRole('button',{name:'Expand turn panel',exact:true});
    await toggle.click();
    assert.ok(await page.locator('.action-dock').isVisible(),'next action survives opening menu');
    await page.getByRole('button',{name:'Minimize turn panel',exact:true}).click();
    const bounds=await page.evaluate(()=>{
      const a=document.querySelector('.bottom-context-dock').getBoundingClientRect();
      const b=document.querySelector('.board-action-bar').getBoundingClientRect();
      return {overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(bounds.overlap,false,'profile and next action do not overlap');
    assert.equal(bounds.overflow,false,'no horizontal overflow');
    await page.screenshot({path:`/tmp/chat-ui-${width}.png`});
    console.log(`${width}x${height}: lineup, artwork, setup, profile, move, encounter and next player passed`);
    await page.close();
  }
} finally { await browser.close(); }
