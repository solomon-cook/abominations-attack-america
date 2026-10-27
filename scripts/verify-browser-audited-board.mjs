import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { chromePath } from './chrome-path.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pending = process.argv.includes('--allow-pending-art');
const inspectionOnly = process.argv.includes('--inspection-only');
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not reserve an audited-board browser-test port.'));
    probe.close(error => error ? reject(error) : resolve(address.port));
  });
});
const ownsServer = !process.env.BROWSER_TEST_URL;
const port = Number(process.env.BROWSER_AUDITED_PORT ?? await freePort());
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const server = ownsServer
  ? spawn(process.execPath, [join(process.cwd(), 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port)], { cwd: join(process.cwd(), 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'] })
  : undefined;
let serverOutput = '';
server?.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server?.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const stopServer = () => new Promise(resolve => {
  if (!server || server.exitCode !== null) return resolve();
  const forceStop = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 2000);
  server.once('exit', () => { clearTimeout(forceStop); resolve(); });
  server.kill('SIGTERM');
});
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      ready = (await fetch(url)).ok;
      if (ready) break;
    } catch {
      if (server.exitCode !== null) break;
    }
    await wait(100);
  }
  if (!ready) {
    await stopServer();
    throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
  }
}
const out = 'output/board-art';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const report = { started: new Date().toISOString(), pendingArtAllowed: pending, inspectionOnly, viewports: [] };
const sizes = process.env.BROWSER_VIEWPORTS
  ? process.env.BROWSER_VIEWPORTS.split(',').map(size=>size.split('x').map(Number))
  : [[320,740],[390,844],[844,390],[768,1024],[1024,768],[1440,900],[2560,1080]];
assert.ok(sizes.every(size=>size.length===2&&size.every(value=>Number.isInteger(value)&&value>0)), 'Invalid BROWSER_VIEWPORTS');
async function frame(page) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function toggleDetails(page) {
 const expand=page.getByRole('button',{name:'Expand turn panel',exact:true});
 if(await expand.count()) await expand.click();
 else await page.getByRole('button',{name:'Minimize turn panel',exact:true}).click();
}
async function resetView(page) {
 const controls=page.locator('.board-map-controls');
 if(!(await controls.evaluate(node=>node.open))) await controls.locator('summary').click();
 await page.getByRole('button',{name:'Reset view',exact:true}).click();
}
async function snapshot(page) {
  return page.evaluate(() => {
    const map = document.querySelector('.board-viewport'), canvas = map.querySelector('.map-canvas');
    const a = map.getBoundingClientRect(), b = (canvas.querySelector(':scope > svg') ?? canvas).getBoundingClientRect();
    const headerBottom=document.querySelector('.game-screen>header')?.getBoundingClientRect().bottom ?? a.top;
    const tiles=[...map.querySelectorAll('.hex-tile')].map(tile=>tile.getBoundingClientRect());
    return { zoom: +map.dataset.cameraZoom, transform: canvas.style.transform, cover: b.left <= a.left + .2 && b.top <= a.top + .2 && b.right >= a.right - .2 && b.bottom >= a.bottom - .2,
      boardCellCount:tiles.length, allBoardCellsFit:tiles.length===336&&tiles.every(tile=>tile.left>=a.left-.5&&tile.top>=a.top-.5&&tile.right<=a.right+.5&&tile.bottom<=a.bottom+.5),
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      pin: map.dataset.boardId === 'human-audited-north-america' && map.dataset.boardId === map.dataset.renderedBoardId && map.dataset.boardContentHash === map.dataset.renderedBoardContentHash,
      controls: [...document.querySelectorAll('.map-controls button')].filter(e => getComputedStyle(e).display !== 'none').map(e => { const r=e.getBoundingClientRect(); return { label:e.getAttribute('aria-label') || e.textContent, visible:r.left>=0 && r.top>=0 && r.right<=innerWidth+.1 && r.bottom<=innerHeight+.1 }; }),
      playback: [...document.querySelectorAll('.board-event-playback')].map(e => { const r=e.getBoundingClientRect(); const obstructedControls=[...document.querySelectorAll('.game-screen > header,.game-screen .movement-checklist,.game-screen .board-action-bar,.game-screen .map-controls,.game-screen .persistent-record,.game-screen .opponent-portrait-rail,.game-screen .board-minimap,.game-screen .board-context-tray')].filter(control=>{const s=getComputedStyle(control),c=control.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&c.width>0&&c.height>0&&r.left<c.right&&r.right>c.left&&r.top<c.bottom&&r.bottom>c.top}).map(control=>control.className||control.tagName); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,inBounds:r.left>=a.left-.1 && r.top>=Math.max(a.top,headerBottom)-.1 && r.right<=a.right+.1 && r.bottom<=a.bottom+.1, unobstructed:obstructedControls.length===0, obstructedControls }; }) };
  });
}
async function check(page, label) { await frame(page); const s=await snapshot(page); assert.ok(s.cover, `${label}: cover`); assert.ok(s.zoom>=1 && s.zoom<=4, `${label}: zoom`); assert.ok(!s.overflow, `${label}: document overflow`); assert.ok(s.pin, `${label}: board pin`); assert.ok(s.controls.every(c=>c.visible), `${label}: clipped controls ${JSON.stringify(s.controls)}`); assert.ok(s.playback.every(p=>p.inBounds), `${label}: clipped board playback ${JSON.stringify(s.playback)}`); assert.ok(s.playback.every(p=>p.unobstructed), `${label}: board playback obscures fixed gameplay controls or the active-hex context tray ${JSON.stringify(s.playback)}`); return s; }
try {
for (const [width,height] of sizes) {
 const item={width,height,checks:[],errors:[]}; report.viewports.push(item);
 console.log(`Audited-board browser viewport ${width}x${height}: start`);
 const context=await browser.newContext({ viewport:{width,height}, hasTouch:true });
 const page=await context.newPage(); page.on('pageerror', e=>item.errors.push(e.message));
 await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
 try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  console.log(`Audited-board browser viewport ${width}x${height}: document ready`);
  const startLocal=page.getByRole('button',{name:'Start local game',exact:true});
  await startLocal.waitFor({state:'visible',timeout:15000});
  console.log(`Audited-board browser viewport ${width}x${height}: start control visible`);
  await startLocal.click({timeout:15000});
  console.log(`Audited-board browser viewport ${width}x${height}: start control clicked`);
  for(let i=0;i<16;i++) {
   const setupHeading=(await page.locator('.setup-panel h2').textContent().catch(()=>''))?.trim();
   if(process.env.BROWSER_DEBUG) console.log(`Audited-board browser viewport ${width}x${height}: setup step ${i+1}, ${setupHeading||'no setup panel'}`);
   if(setupHeading==='Place unused branches') {
    for(const select of await page.locator('.unused-branch-placement select').all()) {
     const available=select.locator('option:not([disabled])[value]:not([value=""])');
     const count=await available.count();
     if(process.env.BROWSER_DEBUG) console.log(`Audited-board browser viewport ${width}x${height}: ${await select.getAttribute('aria-label')} has ${count} available bases`);
     const option=count?await available.first().getAttribute('value'):null;
     if(option) await select.selectOption(option);
    }
    await page.getByRole('button',{name:'Place units and continue'}).click(); continue;
   }
   const choices=page.locator('.setup-panel:visible .setup-options button:visible:not(:disabled)');
   if(await choices.count()) {
    const longNameMobileChoice=width<=360&&setupHeading==='monster selection'?await page.locator('.setup-panel .monster-options button:not(:disabled)').evaluateAll(buttons=>buttons.sort((a,b)=>(b.querySelector('strong')?.textContent?.trim().length??0)-(a.querySelector('strong')?.textContent?.trim().length??0))[0]?.getAttribute('aria-label')):null;
    const choice=longNameMobileChoice?page.getByRole('button',{name:longNameMobileChoice,exact:true}):choices.first();
    assert.ok(await choice.count(),`no available setup choice at step ${i+1}`);
    await choice.click(); continue;
   }
   if(await page.getByText(/Choose your lair/).isVisible().catch(()=>false)) {
    const list=page.locator('.lair-selection-prompt details > summary');
    await list.click();
    await page.locator('.lair-selection-prompt .setup-options button:visible:not(:disabled)').first().click(); continue;
   }
   break;
  }
  await page.locator('.setup-panel').waitFor({state:'detached'});
  console.log(`Audited-board browser viewport ${width}x${height}: setup complete`);
  assert.equal(await page.locator('[data-audit-cell]').count(),336);
  item.checks.push('user setup completed; 336 cells');
  if(width<=600) {
   const commandName=await page.locator('.mobile-command-toggle strong').evaluate(label=>({text:label.textContent?.trim()??'',visible:label.getClientRects().length>0,scrollWidth:label.scrollWidth,clientWidth:label.clientWidth}));
   const commandLabel=await page.locator('.mobile-command-toggle').getAttribute('aria-label');
   const accessibleMonsterName=commandLabel?.match(/^Open (.+) player record$/)?.[1];
   assert.ok(commandName.visible&&commandName.text&&commandName.scrollWidth<=commandName.clientWidth+1,`compact phone player control truncates the active monster name: ${JSON.stringify(commandName)}`);
   assert.ok(accessibleMonsterName===commandName.text,`compact phone player control does not show the full accessible monster name: ${JSON.stringify({commandName,commandLabel,accessibleMonsterName})}`);
   item.checks.push('compact phone player control shows the full active monster name');
  }
  const cellDescriptions=await page.locator('[data-audit-cell]').evaluateAll(buttons=>buttons.map(button=>({
   auditCell:button.dataset.auditCell,
   feature:button.dataset.featureDescription??'',
   accessibleName:button.getAttribute('aria-label')??'',
   label:button.querySelector('.audited-city-name')?.textContent?.trim()??'',
   labelVisible:(()=>{const label=button.querySelector('.audited-city-name');return !!label&&getComputedStyle(label).display!=='none'})(),
   tile:button.getBoundingClientRect().toJSON(),
   labelBounds:(()=>{const label=button.querySelector('.audited-city-name');return label&&getComputedStyle(label).display!=='none'?label.getBoundingClientRect().toJSON():null})(),
   labelContentFits:(()=>{const label=button.querySelector('.audited-city-name');return !label||getComputedStyle(label).display==='none'||(label.scrollWidth<=label.clientWidth+1&&label.scrollHeight<=label.clientHeight+1)})(),
  })));
  assert.ok(cellDescriptions.every(cell=>cell.auditCell&&cell.accessibleName.includes(`physical cell ${cell.auditCell.replace('/', ', ')}`)), 'audited cell coordinates are missing from accessible names');
  assert.ok(cellDescriptions.every(cell=>cell.accessibleName.includes(cell.feature)), 'a cell accessible name is missing its full feature detail');
  assert.ok(cellDescriptions.filter(cell=>cell.feature.startsWith('City,')).every(cell=>/^City, (\+\d Health|[123] dice for Health)(;|$)/.test(cell.feature)), 'city accessible details are missing exact health benefits');
  assert.ok(cellDescriptions.filter(cell=>cell.feature.includes(' base')).every(cell=>/(^|; )(Army|Navy|Air Force|Marines) base(;|$)/.test(cell.feature)), 'base accessible details are missing branch ownership');
  assert.ok(cellDescriptions.filter(cell=>cell.labelBounds).every(cell=>cell.labelBounds.left>=cell.tile.left-.1&&cell.labelBounds.right<=cell.tile.right+.1&&cell.labelBounds.top>=cell.tile.top-.1&&cell.labelBounds.bottom<=cell.tile.bottom+.1), 'a visible city name spills outside its hex');
  assert.ok(cellDescriptions.every(cell=>cell.labelContentFits), `a city name is clipped at board fit: ${JSON.stringify(cellDescriptions.filter(cell=>!cell.labelContentFits).map(({auditCell,label,tile,labelBounds})=>({auditCell,label,tile,labelBounds})))}`);
  if(width<=600) {
   assert.ok(cellDescriptions.every(cell=>!cell.labelVisible), 'full-board phone fit should suppress unreadably small city names');
   assert.ok(await page.locator('.audited-grid .hex-feature-symbol').count()>0, 'phone fit should retain the prominent city/site benefit symbols');
  }
  const cityFont=await page.locator('.audited-city-name').first().evaluate(label=>{
   const screen=label.closest('.game-screen');
   screen.classList.remove('large-text');
   const regular=parseFloat(getComputedStyle(label).fontSize);
   screen.classList.add('large-text');
   const larger=parseFloat(getComputedStyle(label).fontSize);
   screen.classList.remove('large-text');
   return {regular,larger};
  });
  assert.ok(cityFont.larger>cityFont.regular, `larger-text preference does not enlarge audited city labels: ${JSON.stringify(cityFont)}`);
  if(width>=1280) {
   const singleWordCityLines=await page.locator('.audited-city-name').evaluateAll(labels=>{
    const screen=document.querySelector('.game-screen');
    screen?.classList.add('large-text');
    const result=labels.filter(label=>!label.textContent?.trim().includes(' ')).map(label=>{
     const range=document.createRange();
     range.selectNodeContents(label);
     return {name:label.textContent?.trim(),lines:range.getClientRects().length};
    });
    screen?.classList.remove('large-text');
    return result;
   });
   assert.ok(singleWordCityLines.every(city=>city.lines<=1), `larger-text preference splits a single-word city name: ${JSON.stringify(singleWordCityLines.filter(city=>city.lines>1))}`);
  }
  if(width>=1280) assert.ok(cityFont.regular>=6, `full-board desktop fit city labels are too small: ${JSON.stringify(cityFont)}`);
  const inspectionTile=page.locator('.hex-tile[data-audit-cell][data-feature-description^="City,"]:not(:disabled)').first();
  const inspectionFeature=await inspectionTile.getAttribute('data-feature-description');
  const inspectionName=await inspectionTile.getAttribute('data-location-name');
  await inspectionTile.focus();
  const contextTray=page.locator('.board-context-tray-focus');
  await contextTray.waitFor({state:'visible',timeout:3000}).catch(async()=>{
   const diagnostics=await page.evaluate(()=>({activeCell:document.activeElement?.getAttribute('data-audit-cell'),screenClass:document.querySelector('.game-screen')?.className,display:getComputedStyle(document.querySelector('.board-context-tray')).display}));
   throw new Error(`focused-hex inspection did not become visible: ${JSON.stringify(diagnostics)}`);
  });
  assert.ok((await contextTray.innerText()).includes(inspectionFeature), 'focused-hex inspection does not show the selected feature detail');
  if(width<=600) assert.ok(inspectionName&&(await contextTray.innerText()).includes(inspectionName), 'phone fit must expose the full city name in the focused detail tray');
  const inspectionBounds=await contextTray.evaluate(node=>{const rect=node.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}});
  assert.ok(inspectionBounds.left>=0&&inspectionBounds.top>=0&&inspectionBounds.right<=width+.5&&inspectionBounds.bottom<=height+.5&&inspectionBounds.scrollWidth<=inspectionBounds.clientWidth+1&&inspectionBounds.scrollHeight<=inspectionBounds.clientHeight+1,`focused-hex inspection is clipped or outside the viewport: ${JSON.stringify(inspectionBounds)}`);
  if(width<=600) {
   const detailTextSizes=await contextTray.evaluate(node=>({title:parseFloat(getComputedStyle(node.querySelector('.board-context-heading h3')).fontSize),feature:parseFloat(getComputedStyle(node.querySelector('.board-context-facts span:nth-child(2)')).fontSize)}));
   assert.ok(detailTextSizes.title>=14&&detailTextSizes.feature>=9,`focused phone detail text is too small: ${JSON.stringify(detailTextSizes)}`);
  }
  item.checks.push(width<=600
   ? 'all 336 accessible names include cell identity and full feature detail; city benefits and base branches are explicit; phone fit suppresses city microtext while focused inspection provides readable names and benefits'
   : 'all 336 accessible names include cell identity and full feature detail; city benefits and base branches are explicit; visible city labels fit without clipping and honor larger-text preference; focused hex opens visible feature inspection');
  const mobileCommandToggle=page.locator('.mobile-command-toggle');
  const expandedForLabelReview=width<=700&&await mobileCommandToggle.isVisible().catch(()=>false);
  if(expandedForLabelReview) await mobileCommandToggle.click();
  const movementLabels=await page.locator('.movement-piece').evaluateAll(buttons=>buttons.map(button=>{
   const label=button.querySelector('.movement-piece-label strong');
   const style=label?getComputedStyle(label):null;
   const rect=label?.getBoundingClientRect();
   const accessibleName=button.getAttribute('aria-label')??'';
   return {text:label?.textContent?.trim()??'',accessibleName,pressed:button.getAttribute('aria-pressed')==='true',announcesSelected:accessibleName.endsWith(', selected'),wraps:style?.whiteSpace==='normal'&&style.textOverflow!=='ellipsis',visible:!!rect&&rect.width>0&&rect.height>0,contentFits:!!label&&label.scrollWidth<=label.clientWidth+1&&label.scrollHeight<=label.clientHeight+1};
  }));
  assert.ok(movementLabels.length>0,'movement order strip has no piece labels');
  assert.ok(movementLabels.every(label=>label.wraps&&label.accessibleName.includes(label.text)),`movement order names are truncated or inaccessible: ${JSON.stringify(movementLabels)}`);
  assert.ok(movementLabels.every(label=>label.pressed===label.announcesSelected),`movement order selection label disagrees with control state: ${JSON.stringify(movementLabels)}`);
  assert.ok(movementLabels.every(label=>label.visible&&label.contentFits),`movement order name is hidden or overflows: ${JSON.stringify(movementLabels)}`);
  if(expandedForLabelReview) await mobileCommandToggle.click();
  item.checks.push('movement-order names wrap without clipping and expose full accessible labels');
  if(inspectionOnly) {
   await resetView(page);
   const fit=await check(page,'inspection-only board fit');
   assert.ok(fit.allBoardCellsFit,`inspection-only board fit does not contain all 336 cells: ${JSON.stringify(fit)}`);
   await inspectionTile.focus();
   await frame(page);
   await contextTray.waitFor({state:'visible',timeout:3000});
   const inspectionCapture=`${out}/board-inspection-${width}x${height}.png`;
   await page.screenshot({path:inspectionCapture,timeout:10000});
   const reviewStyle=await page.addStyleTag({content:`.game-screen>header,.game-screen>.board-map-controls,.game-screen .panel-heading,.game-screen .map-controls,.game-screen .board-minimap,.game-screen .board-context-tray,.game-screen .command-station,.game-screen .movement-checklist,.game-screen .board-action-bar,.game-screen .action-dock,.game-screen .player-sheet-peeks,.game-screen .player-public-status,.game-screen .mobile-command-toggle,.game-screen .bot-turn-guidance{display:none!important}`});
   const capture=`${out}/board-fit-${width}x${height}.png`;
   await page.screenshot({path:capture,timeout:10000});
   await reviewStyle.evaluate(style=>style.remove());
   item.focusedInspectionCapture=inspectionCapture;
   item.fullBoardFit={zoom:fit.zoom,cellCount:fit.boardCellCount,allCellsInsideViewport:fit.allBoardCellsFit,capture};
   item.passed=true;
  item.checks.push(width<=600?'board-fit screenshot saved with readable feature symbols and no microtext; focused detail remains available':'board-fit screenshot saved after accessible-detail and label-containment checks');
   await context.close();
   console.log(`Audited-board browser viewport ${width}x${height}: fit inspection passed`);
   continue;
  }
  const initialView=await check(page,'initial');
  if(width<=600&&height>width) {
   assert.ok(initialView.zoom>=2.3,`portrait gameplay should scale the board to use the viewport height; observed ${initialView.zoom} at ${width}x${height}`);
   item.checks.push('portrait gameplay uses a height-aware tactical board scale');
  }
  const canvas=page.locator('.map-canvas'); const before=await canvas.getAttribute('style');
  await toggleDetails(page); await frame(page);
  assert.equal(await canvas.getAttribute('style'),before,'details drawer reframed map');
  await toggleDetails(page); item.checks.push('details preserves camera');
  const mapBounds=await page.locator('.board-viewport').boundingBox();
  assert.ok(mapBounds,'board viewport bounds are available');
  const wheelPoint={x:mapBounds.x+mapBounds.width*.5,y:mapBounds.y+mapBounds.height*.5};
  await page.mouse.move(wheelPoint.x,wheelPoint.y); await page.mouse.wheel(0,-10000); await page.waitForTimeout(250);
  const zoomedView=await check(page,'wheel zoom');
  item.checks.push(zoomedView.zoom>initialView.zoom?'wheel zoom changes scale':'wheel remains clamped at landscape fit scale');
  await page.mouse.move(width*.5,height*.5); await page.mouse.down(); await page.mouse.move(width*.3,height*.65,{steps:8}); await page.mouse.up();
  await check(page,'drag'); assert.equal(await page.getByRole('button',{name:'Confirm move',exact:true}).count(),0,'drag selected movement');
  if(width>900) {
   await page.locator('.persistent-record .mobile-record-toggle').click();
   await page.getByRole('tab',{name:'Map'}).click();
   const mini=page.getByRole('button',{name:'Board overview. Click to move camera; arrow keys pan.'});
   await mini.waitFor({state:'visible'});
   await mini.click({position:{x:8,y:8}}); await check(page,'minimap'); await mini.focus(); await page.keyboard.press('ArrowRight'); await check(page,'keyboard pan');
   await page.getByRole('button',{name:'Minimize monster, military and map record'}).click();
   assert.equal(await mini.isVisible(),false,'minimap remained open after closing the Map tab');
  }
  await resetView(page);
  // Browser-emulated touch events exercise one-finger panning and two-finger zoom.
  await page.getByRole('button',{name:'Zoom board in',exact:true}).click();
  assert.ok((await check(page,'touch pan zoom-in')).zoom>1,'touch pan must start above the centered full-board fit zoom');
  const cdp=await context.newCDPSession(page);
  const touchBounds=await page.locator('.board-viewport').boundingBox();
  assert.ok(touchBounds,'board viewport bounds are available for touch');
  const x=Math.round(touchBounds.x+touchBounds.width*.5);
  const y=Math.round(touchBounds.y+touchBounds.height*.6);
  const beforeTouchPan=(await check(page,'touch pan start')).transform;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+52,y:y+24,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const touchPan=await check(page,'touch pan');
  assert.notEqual(touchPan.transform,beforeTouchPan,'one-finger touch drag should pan the board without selecting a tile');
  item.checks.push('one-finger touch pan changes camera without issuing a tile action');
  const beforePinch=(await check(page,'touch pinch start')).zoom;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y,id:1},{x:x+20,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await check(page,'touch pinch')).zoom>beforePinch,'two-finger pinch did not zoom in');
  item.checks.push('two-finger touch pinch changes camera zoom');
  await page.setViewportSize({width:height,height:width}); await check(page,'resize'); await page.setViewportSize({width,height}); await check(page,'restore');
  await resetView(page);
  const fitView=await check(page,'full-board fit');
  assert.equal(fitView.allBoardCellsFit,true,`Reset must fit all 336 cells inside the ${width}x${height} board viewport; found ${fitView.boardCellCount} cells.`);
  item.fullBoardFit={zoom:fitView.zoom,cellCount:fitView.boardCellCount,allCellsInsideViewport:fitView.allBoardCellsFit,
    capture:width===1440&&height===900?`${out}/board-fit-${width}x${height}.png`:undefined};
  item.checks.push(width>900?'bounds/wheel/drag/minimap/keyboard/touch/resize/full-board-fit':'bounds/wheel/drag/touch/resize/full-board-fit');
  if(width===1440&&height===900) {
   const reviewStyle=await page.addStyleTag({content:`.game-screen>header,.game-screen>.board-map-controls,.game-screen .panel-heading,.game-screen .map-controls,.game-screen .board-minimap,.game-screen .board-secondary,.game-screen .board-context-tray,.game-screen .command-station,.game-screen .movement-checklist,.game-screen .board-action-bar,.game-screen .action-dock,.game-screen .player-sheet-peeks,.game-screen .player-public-status,.game-screen .mobile-command-toggle,.game-screen .bot-turn-guidance{display:none!important}`});
   await page.screenshot({path:`${out}/board-fit-${width}x${height}.png`,timeout:10000});
   await reviewStyle.evaluate(style=>style.remove());
  }
  console.log(`Audited-board browser viewport ${width}x${height}: camera checks complete`);
  // Keyboard selection is an actual tile action and also tests focus-driven camera panning.
  const tile=page.locator('.hex-tile.legal').first(); await tile.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Confirm move',exact:true}).first().click();
  for(let moveStep=0;moveStep<32;moveStep++) {
   if((await page.locator('.action-card h2').textContent())?.trim()!=='Move') break;
   const pass=page.getByRole('button',{name:'Continue to Fight',exact:true});
   if(await pass.isVisible().catch(()=>false)) { await pass.click(); continue; }
   const hold=page.getByRole('button',{name:/^Hold /}).last();
   if(await hold.isVisible().catch(()=>false)) { await hold.click(); continue; }
   const selectable=page.locator('.hex-tile.selectable:not(:disabled)').first();
   if(await selectable.count()) { await selectable.click(); continue; }
   throw new Error(`Move phase had no legal hold/pass/selection control: ${await page.locator('.action-dock').innerText().catch(()=>'<no action dock>')}`);
  }
  if((await page.locator('.action-card h2').textContent())?.trim()==='Move') throw new Error('Move phase did not finish after all pieces were held or passed.');
  console.log(`Audited-board browser viewport ${width}x${height}: movement complete`);
  await toggleDetails(page);
  const compactStompRoll=page.locator('.board-event-playback.is-interactive .board-event-roll-all');
  if(await compactStompRoll.isVisible().catch(()=>false)) {
   assert.equal(await page.locator('.resolution-stage[open]').count(),0,'a routine city stomp should not open the full Encounter panel');
   await compactStompRoll.click();
   const cityReward=page.locator('.board-event-choice-actions button').first();
   if(await cityReward.isVisible().catch(()=>false)) await cityReward.click();
   await page.waitForFunction(()=>document.querySelector('.board-event-playback[data-event-action="encounter.resolved"]')?.dataset.outcomeVisible==='true');
   assert.equal(await page.locator('.resolution-stage[open]').count(),0,'routine city rewards should resolve in board playback');
  } else {
   const resolve=page.getByRole('button',{name:'Resolve encounter',exact:true});
   await resolve.last().click();
   await page.getByRole('button',{name:'Reveal encounter',exact:true}).click();
   const encounterBoardAction=page.locator('.resolution-encounter .cinema-primary').filter({hasText:'Return to board'}).last();
   // Follow the actual encounter result: reveal remaining dice/cards and choose any offered reward.
   for(let i=0;i<6;i++) {
    const revealRolls=page.getByRole('button',{name:'Reveal remaining rolls',exact:true});
    if(await revealRolls.isVisible().catch(()=>false)) { await revealRolls.click(); continue; }
    const revealCard=page.getByRole('button',{name:'Reveal card',exact:true});
    if(await revealCard.isVisible().catch(()=>false)) { await revealCard.click(); continue; }
    const reward=page.locator('.resolution-encounter .cinema-choice button:visible').first();
    if(await reward.isVisible().catch(()=>false)) { await reward.click(); continue; }
    if(await encounterBoardAction.isVisible().catch(()=>false)) break;
    await page.waitForTimeout(120);
   }
   await encounterBoardAction.waitFor({state:'visible'});
   await encounterBoardAction.click();
  }
  const deploy=page.getByRole('button',{name:'Deploy military',exact:true}).filter({visible:true}).first();
  if(await deploy.isVisible()) await deploy.click();
  if(width<=360) {
   const beforeUnits=await page.locator('.tile-occupant').count();
   await page.getByRole('button',{name:/^Deploy .* piece/}).first().click();
   const destinations=page.locator('.hex-tile.deployment-legal:not(:disabled)');
   await destinations.first().waitFor({state:'visible'});
   const available=await destinations.evaluateAll(nodes=>nodes.map((node,index)=>{
    const rect=node.getBoundingClientRect();
    const clear=[...document.querySelectorAll('.game-screen > header,.opponent-portrait-rail,.map-controls,.board-action-bar')].every(overlay=>{
     const other=overlay.getBoundingClientRect();
     return rect.right<=other.left || rect.left>=other.right || rect.bottom<=other.top || rect.top>=other.bottom;
    });
    return {index,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,clear};
   }).filter(rect=>rect.clear&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight));
   assert.ok(available.length,`phone view should expose a deployment location clear of the HUD: ${JSON.stringify(available)}`);
   const destination=destinations.nth(available[0].index);
   await destination.click();
   await page.waitForFunction(count=>document.querySelectorAll('.tile-occupant').length>count,beforeUnits);
   assert.ok(await page.locator('.deployment-prompt').count()===0,'deployment prompt should clear after placement');
   item.checks.push('movement confirmed; encounter resolved; legal unit deployed on the board');
   if(await page.locator('.military-drawer').isVisible().catch(()=>false)) await page.locator('.military-sheet-close').click();
  } else {
   const researchTab=page.getByRole('button',{name:/Military research/}).last();
   await researchTab.click();
   const drawResearch=page.getByRole('button',{name:'Draw a Military Research card instead of deploying a unit'});
   await drawResearch.waitFor({state:'visible'});
   assert.ok(await drawResearch.isEnabled(),'research action is unavailable before deployment');
   await drawResearch.click();
   await page.locator('dialog.resolution-research').waitFor({state:'visible'});
   assert.match(await page.locator('.top-turn-summary').innerText(),/PLAYER 2/i,'drawing research did not pass the turn');
   await page.locator('dialog.resolution-research .resolution-close').click();
   item.checks.push('movement confirmed; encounter resolved; research alternative used');
  }
  console.log(`Audited-board browser viewport ${width}x${height}: encounter and Deploy complete`);
  if(await page.locator('.layout.panel-open').count()) await toggleDetails(page);
  await check(page,'research action resolved'); await page.waitForTimeout(500);
  item.brokenImages=await page.locator('.audited-terrain').evaluateAll(images=>images.filter(i=>i.complete && !i.naturalWidth).map(i=>i.src));
  item.resources=await page.evaluate(() => {
    const navigation=performance.getEntriesByType('navigation')[0];
    const terrain=performance.getEntriesByType('resource').filter(entry=>/\/assets\/board\/audited\/(256|512|1024)\//.test(entry.name));
    const total=field=>terrain.reduce((sum,entry)=>sum+entry[field],0);
    const uniqueImages=new Map([...document.querySelectorAll('.audited-terrain')].filter(image=>image.complete && image.naturalWidth).map(image=>[image.currentSrc,image]));
    return {
      navigation: navigation ? { domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd-navigation.startTime), loadMs: Math.round(navigation.loadEventEnd-navigation.startTime) } : null,
      terrain: { measurement:'Cumulative after setup, camera interactions, movement, encounter and research alternative; viewport has a fresh browser context.',
        resourceCount:terrain.length, uniqueResourceCount:new Set(terrain.map(entry=>entry.name)).size,
        transferBytes:total('transferSize'), encodedBodyBytes:total('encodedBodySize'), decodedBodyBytes:total('decodedBodySize'),
        currentDecodedImageCount:uniqueImages.size,
        estimatedCurrentBitmapBytes:[...uniqueImages.values()].reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight*4,0),
        sizes:Object.fromEntries([256,512,1024].map(size=>[size,terrain.filter(entry=>entry.name.includes(`/audited/${size}/`)).length])) },
    };
  });
  if(!pending) assert.equal(item.brokenImages.length,0,'broken terrain images');
  assert.deepEqual(item.errors,[],'runtime errors');
  await page.screenshot({path:`${out}/browser-${width}x${height}.png`,timeout:10000}); item.passed=true;
  console.log(`Audited-board browser viewport ${width}x${height}: passed`);
 } catch(error) { item.passed=false; item.failure=error.stack; await page.screenshot({path:`${out}/browser-${width}x${height}-failure.png`,timeout:5000}).catch(()=>{}); }
 await context.close();
}
} finally { await browser.close(); await stopServer(); report.finished=new Date().toISOString(); await writeFile(process.env.BROWSER_REPORT_PATH ?? `${out}/browser-verification.json`,JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify(report,null,2));
if(report.viewports.some(v=>!v.passed)) process.exitCode=1;
