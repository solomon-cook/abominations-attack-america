import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pending = process.argv.includes('--allow-pending-art');
const out = 'output/board-art';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const report = { started: new Date().toISOString(), pendingArtAllowed: pending, viewports: [] };
const sizes = [[320,740],[390,844],[844,390],[1440,900],[2560,1080]];
async function frame(page) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function snapshot(page) {
  return page.evaluate(() => {
    const map = document.querySelector('.board-viewport'), canvas = map.querySelector('.map-canvas');
    const a = map.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    return { zoom: +map.dataset.cameraZoom, transform: canvas.style.transform, cover: b.left <= a.left + .2 && b.top <= a.top + .2 && b.right >= a.right - .2 && b.bottom >= a.bottom - .2,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      pin: map.dataset.boardId === 'human-audited-north-america' && map.dataset.boardId === map.dataset.renderedBoardId && map.dataset.boardContentHash === map.dataset.renderedBoardContentHash,
      controls: [...document.querySelectorAll('.map-controls button')].filter(e => getComputedStyle(e).display !== 'none').map(e => { const r=e.getBoundingClientRect(); return { label:e.getAttribute('aria-label') || e.textContent, visible:r.left>=0 && r.top>=0 && r.right<=innerWidth+.1 && r.bottom<=innerHeight+.1 }; }) };
  });
}
async function check(page, label) { await frame(page); const s=await snapshot(page); assert.ok(s.cover, `${label}: cover`); assert.ok(s.zoom>=1 && s.zoom<=4, `${label}: zoom`); assert.ok(!s.overflow, `${label}: document overflow`); assert.ok(s.pin, `${label}: board pin`); assert.ok(s.controls.every(c=>c.visible), `${label}: clipped controls ${JSON.stringify(s.controls)}`); return s; }
try {
for (const [width,height] of sizes) {
 const item={width,height,checks:[],errors:[]}; report.viewports.push(item);
 const context=await browser.newContext({ viewport:{width,height}, hasTouch:true });
 const page=await context.newPage(); page.on('pageerror', e=>item.errors.push(e.message));
 await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
 try {
  await page.goto(process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button',{name:'Start local game',exact:true}).click();
  for(let i=0;i<8;i++) { const choices=page.locator('.setup-options button'); if (!await choices.count()) break; await choices.first().click(); }
  await page.locator('.setup-panel').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-audit-cell]').count(),336);
  item.checks.push('user setup completed; 336 cells');
  await check(page,'initial');
  const canvas=page.locator('.map-canvas'); const before=await canvas.getAttribute('style');
  await page.locator('header .game-panel-toggle').click(); await frame(page);
  assert.equal(await canvas.getAttribute('style'),before,'details drawer reframed map');
  await page.locator('header .game-panel-toggle').click(); item.checks.push('details preserves camera');
  await page.mouse.move(width*.5,height*.5); await page.mouse.wheel(0,-10000); await page.waitForTimeout(250);
  assert.equal((await check(page,'zoom maximum')).zoom,4);
  await page.mouse.move(width*.5,height*.5); await page.mouse.down(); await page.mouse.move(width*.3,height*.65,{steps:8}); await page.mouse.up();
  await check(page,'drag'); assert.equal(await page.getByRole('button',{name:'Confirm monster move',exact:true}).count(),0,'drag selected movement');
  const mini=page.getByRole('button',{name:'Board overview. Click to move camera; arrow keys pan.'});
  await mini.click({position:{x:8,y:8}}); await check(page,'minimap'); await mini.focus(); await page.keyboard.press('ArrowRight'); await check(page,'keyboard pan');
  await page.getByRole('button',{name:'Reset view',exact:true}).click();
  // Real browser touch events exercise pinch and touch pointer capture.
  const cdp=await context.newCDPSession(page); const y=Math.round(height*.5), x=Math.round(width*.5);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y,id:1},{x:x+20,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await check(page,'touch pinch')).zoom>1,'pinch did not zoom');
  await page.setViewportSize({width:height,height:width}); await check(page,'resize'); await page.setViewportSize({width,height}); await check(page,'restore');
  await page.getByRole('button',{name:'Reset view',exact:true}).click(); item.checks.push('bounds/wheel/drag/minimap/keyboard/touch/resize');
  // Keyboard selection is an actual tile action and also tests focus-driven camera panning.
  const tile=page.locator('.hex-tile.legal').first(); await tile.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Confirm monster move',exact:true}).first().click();
  await page.locator('header .game-panel-toggle').click();
  const resolve=page.getByRole('button',{name:'Resolve encounter',exact:true});
  await resolve.last().click();
  const benefit=page.getByRole('button',{name:'Take the city Health benefit',exact:true});
  if(await benefit.count()) await benefit.click();
  await page.getByRole('button',{name:'Pass deployment',exact:true}).first().click();
  item.checks.push('movement confirmed; encounter resolved; deployment passed');
  if(await page.locator('.layout.panel-open').count()) await page.locator('header .game-panel-toggle').click();
  await check(page,'completed turn'); await page.waitForTimeout(500);
  item.brokenImages=await page.locator('.audited-terrain').evaluateAll(images=>images.filter(i=>i.complete && !i.naturalWidth).map(i=>i.src));
  item.resources=await page.evaluate(() => {
    const navigation=performance.getEntriesByType('navigation')[0];
    const terrain=performance.getEntriesByType('resource').filter(entry=>/\/assets\/board\/audited\/(256|512|1024)\//.test(entry.name));
    const total=field=>terrain.reduce((sum,entry)=>sum+entry[field],0);
    const uniqueImages=new Map([...document.querySelectorAll('.audited-terrain')].filter(image=>image.complete && image.naturalWidth).map(image=>[image.currentSrc,image]));
    return {
      navigation: navigation ? { domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd-navigation.startTime), loadMs: Math.round(navigation.loadEventEnd-navigation.startTime) } : null,
      terrain: { measurement:'Cumulative after setup, camera interactions and a completed turn; viewport has a fresh browser context.',
        resourceCount:terrain.length, uniqueResourceCount:new Set(terrain.map(entry=>entry.name)).size,
        transferBytes:total('transferSize'), encodedBodyBytes:total('encodedBodySize'), decodedBodyBytes:total('decodedBodySize'),
        currentDecodedImageCount:uniqueImages.size,
        estimatedCurrentBitmapBytes:[...uniqueImages.values()].reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight*4,0),
        sizes:Object.fromEntries([256,512,1024].map(size=>[size,terrain.filter(entry=>entry.name.includes(`/audited/${size}/`)).length])) },
    };
  });
  if(!pending) assert.equal(item.brokenImages.length,0,'broken terrain images');
  assert.deepEqual(item.errors,[],'runtime errors');
  await page.screenshot({path:`${out}/browser-${width}x${height}.png`}); item.passed=true;
 } catch(error) { item.passed=false; item.failure=error.stack; await page.screenshot({path:`${out}/browser-${width}x${height}-failure.png`}); }
 await context.close();
}
} finally { await browser.close(); report.finished=new Date().toISOString(); await writeFile(`${out}/browser-verification.json`,JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify(report,null,2));
if(report.viewports.some(v=>!v.passed)) process.exitCode=1;
