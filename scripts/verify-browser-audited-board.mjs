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
const sizes = process.env.BROWSER_VIEWPORTS
  ? process.env.BROWSER_VIEWPORTS.split(',').map(size=>size.split('x').map(Number))
  : [[320,740],[390,844],[844,390],[768,1024],[1024,768],[1440,900],[2560,1080]];
assert.ok(sizes.every(size=>size.length===2&&size.every(value=>Number.isInteger(value)&&value>0)), 'Invalid BROWSER_VIEWPORTS');
async function frame(page) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function unobstructedMapPoint(page) {
 return page.locator('.board-viewport').evaluate(node=>{
  const rect=node.getBoundingClientRect();
  for(const y of [.5,.25,.75,.1,.9]) for(const x of [.5,.25,.75,.1,.9]) {
   const point={x:rect.left+rect.width*x,y:rect.top+rect.height*y};
   if(document.elementFromPoint(point.x,point.y)?.closest('.board-viewport')===node) return point;
  }
  return null;
 });
}
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
  for(let i=0;i<16;i++) {
   const choices=page.locator('.setup-panel:visible .setup-options button:visible:not(:disabled)');
   if(await choices.count()) { await choices.first().click(); continue; }
   if(await page.getByText(/Choose your lair/).isVisible().catch(()=>false)) {
    const list=page.locator('.lair-selection-prompt details > summary');
    await list.click();
    await page.locator('.lair-selection-prompt .setup-options button:visible:not(:disabled)').first().click(); continue;
   }
   break;
  }
  await page.locator('.setup-panel').waitFor({state:'detached'});
  const guideDismiss=page.getByRole('button',{name:'Got it · hide guide',exact:true});
  if(await guideDismiss.isVisible().catch(()=>false)) {
   await guideDismiss.click();
   await page.locator('.onboarding').waitFor({state:'detached'});
   item.checks.push('first-match guide dismissed before board pointer input');
  }
  assert.equal(await page.locator('.onboarding').count(),0,'camera input must target the board after the first-match guide is dismissed');
  assert.equal(await page.locator('[data-audit-cell]').count(),336);
  item.checks.push('user setup completed; 336 cells');
  await check(page,'initial');
  const canvas=page.locator('.map-canvas'); const before=await canvas.getAttribute('style');
  await toggleDetails(page); await frame(page);
  assert.equal(await canvas.getAttribute('style'),before,'details drawer reframed map');
  await toggleDetails(page); item.checks.push('details preserves camera');
  const wheelPoint=await unobstructedMapPoint(page);
  assert.ok(wheelPoint,'board viewport should expose an unobstructed pointer target for camera input');
  await page.mouse.move(wheelPoint.x,wheelPoint.y); await page.mouse.wheel(0,-10000); await page.waitForTimeout(250);
  assert.equal((await check(page,'zoom maximum')).zoom,4);
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
  // Real browser touch events exercise pinch and touch pointer capture.
  const cdp=await context.newCDPSession(page); const gesturePoint=await unobstructedMapPoint(page);
  assert.ok(gesturePoint,'board viewport should expose an unobstructed pointer target for touch camera input');
  const y=Math.round(gesturePoint.y), x=Math.round(gesturePoint.x);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y,id:1},{x:x+20,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await check(page,'touch pinch')).zoom>1,'pinch did not zoom');
  await page.setViewportSize({width:height,height:width}); await check(page,'resize'); await page.setViewportSize({width,height}); await check(page,'restore');
  await resetView(page); item.checks.push(width>900?'bounds/wheel/drag/minimap/keyboard/touch/resize':'bounds/wheel/drag/touch/resize');
  // Keyboard selection is an actual tile action and also tests focus-driven camera panning.
  const tile=page.locator('.hex-tile.legal').first(); await tile.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Confirm move',exact:true}).first().click();
  const continueFromMove=page.getByRole('button',{name:'Continue to Fight',exact:true});
  if(await continueFromMove.isVisible()) await continueFromMove.click();
  await toggleDetails(page);
  const compactStompRoll=page.locator('.board-event-playback.is-interactive .board-event-roll-all');
  if(await compactStompRoll.isVisible().catch(()=>false)) {
   assert.equal(await page.locator('.resolution-stage[open]').count(),0,'a routine city stomp should not open the full Encounter panel');
   await compactStompRoll.click();
   const boardReward=page.locator('.board-event-choice-actions button:visible').first();
   if(await boardReward.isVisible().catch(()=>false)) await boardReward.click();
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
  await page.locator('.board-event-playback').waitFor({state:'detached',timeout:5000});
  const deploy=page.getByRole('button',{name:'Deploy military',exact:true}).last();
  if(await deploy.isVisible()) await deploy.click();
  const deploymentCountViewport=width<=360||width>=1000||(width===768&&height===600)||(width===834&&height===1112);
  if(deploymentCountViewport) {
   const deploymentTray=page.locator('.deployment-tray-shortcut');
   const countsFromLabel=label=>{ const match=label?.match(/(\d+) deployed, (\d+) in reserve/); return match?{deployed:Number(match[1]),reserve:Number(match[2])}:null; };
   const countsBefore=countsFromLabel(await deploymentTray.getAttribute('aria-label'));
   assert.ok(countsBefore&&countsBefore.reserve>0,'deployment tray should expose a reserve piece before placement');
   const beforeUnits=await page.locator('.tile-occupant').count();
   await page.getByRole('button',{name:/^Deploy .* piece/}).first().click();
   const destinations=page.locator('.hex-tile.deployment-legal:not(:disabled)');
   await destinations.first().waitFor({state:'visible'});
   const inspectLocations=()=>destinations.evaluateAll(nodes=>nodes.map((node,index)=>{
    const rect=node.getBoundingClientRect();
    const blockedBy=[...document.querySelectorAll('.game-screen > header,.opponent-portrait-rail,.map-controls,.board-action-bar,.board-event-playback,.deployment-prompt')].filter(overlay=>{
     const other=overlay.getBoundingClientRect();
     return !(rect.right<=other.left || rect.left>=other.right || rect.bottom<=other.top || rect.top>=other.bottom);
    }).map(overlay=>overlay.className||overlay.tagName);
    return {index,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,blockedBy};
   }));
   let locations=await inspectLocations();
   let available=locations.filter(rect=>rect.blockedBy.length===0&&rect.left>=0&&rect.top>=0&&rect.right<=width&&rect.bottom<=height);
   if(!available.length&&width===768&&height===600) {
    await page.mouse.move(width*.65,height*.45); await page.mouse.down();
    await page.mouse.move(width*.85,height*.22,{steps:10}); await page.mouse.up();
    locations=await inspectLocations();
    available=locations.filter(rect=>rect.blockedBy.length===0&&rect.left>=0&&rect.top>=0&&rect.right<=width&&rect.bottom<=height);
   }
   if(!available.length&&width===2560&&height===1080) {
    const target=locations.find(rect=>rect.left>=0&&rect.right<=width&&rect.bottom-rect.top<height);
    assert.ok(target,'wide viewport should retain a legal deployment target within the board width');
    const desiredTop=Math.min(Math.max(target.top,160),height-(target.bottom-target.top)-80);
    const deltaY=Math.round(desiredTop-target.top);
    const dragStart=await page.locator('.board-viewport').evaluate((node,delta)=>{
     const rect=node.getBoundingClientRect();
     for(const y of [.25,.35,.45,.55,.65,.75,.15,.85]) for(const x of [.5,.35,.65,.2,.8]) {
      const point={x:rect.left+rect.width*x,y:rect.top+rect.height*y};
      const endY=point.y+delta;
      if(endY<rect.top+1||endY>rect.bottom-1) continue;
      if(document.elementFromPoint(point.x,point.y)?.closest('.board-viewport')===node) return point;
     }
     return null;
    },deltaY);
    assert.ok(dragStart,'wide viewport should allow a captured map drag to pan the target into view');
    await page.mouse.move(dragStart.x,dragStart.y); await page.mouse.down();
    await page.mouse.move(dragStart.x,dragStart.y+deltaY,{steps:Math.max(10,Math.ceil(Math.abs(deltaY)/30))}); await page.mouse.up();
    await frame(page);
    locations=await inspectLocations();
    available=locations.filter(rect=>rect.blockedBy.length===0&&rect.left>=0&&rect.top>=0&&rect.right<=width&&rect.bottom<=height);
   }
   assert.ok(available.length,`${width}x${height} should expose a deployment location clear of the HUD; legal locations: ${JSON.stringify(locations)}`);
   const destination=destinations.nth(available[0].index);
   await destination.click();
   await page.waitForFunction(count=>document.querySelectorAll('.tile-occupant').length>count,beforeUnits);
   await page.waitForFunction(({deployed,reserve})=>{
    const label=document.querySelector('.deployment-tray-shortcut')?.getAttribute('aria-label');
    const match=label?.match(/(\d+) deployed, (\d+) in reserve/);
    return match&&Number(match[1])===deployed&&Number(match[2])===reserve;
   },{deployed:countsBefore.deployed+1,reserve:countsBefore.reserve-1});
   assert.ok(await page.locator('.deployment-prompt').count()===0,'deployment prompt should clear after placement');
   item.checks.push(`movement confirmed; encounter resolved; legal unit deployed; deployment tray counts refreshed at ${width}x${height}`);
   if(await page.locator('.military-drawer').isVisible().catch(()=>false)) await page.locator('.military-sheet-close').click();
  } else {
   const deploymentTray=page.locator('.deployment-tray-shortcut');
   const trayCounts=label=>{ const match=label?.match(/Open (.+) military sheet, (\d+) deployed, (\d+) in reserve/); return match?{branch:match[1],deployed:Number(match[2]),reserve:Number(match[3])}:null; };
   const countsBeforeHandoff=trayCounts(await deploymentTray.getAttribute('aria-label'));
   assert.ok(countsBeforeHandoff,'deployment tray should name its active branch and counts before the player transition');
   const researchTab=page.getByRole('button',{name:/Military research/}).last();
   await researchTab.click();
   const drawResearch=page.getByRole('button',{name:'Draw a Military Research card instead of deploying a unit'});
   await drawResearch.waitFor({state:'visible'});
   assert.ok(await drawResearch.isEnabled(),'research action is unavailable before deployment');
   await drawResearch.click();
   await page.locator('dialog.resolution-research').waitFor({state:'visible'});
   assert.match(await page.locator('.top-turn-summary').innerText(),/PLAYER 2/i,'drawing research did not pass the turn');
   await page.locator('dialog.resolution-research .resolution-close').click();
   await page.waitForFunction(previousBranch=>{
    const tray=document.querySelector('.deployment-tray-shortcut');
    return tray?.dataset.branch&&tray.dataset.branch!==previousBranch&&tray.getAttribute('aria-label')?.startsWith(`Open ${tray.dataset.branch} military sheet,`);
   },countsBeforeHandoff.branch);
   const countsAfterHandoff=trayCounts(await deploymentTray.getAttribute('aria-label'));
   const recordBranch=await page.locator('.persistent-record .record-medallion[data-branch]').getAttribute('data-branch');
   assert.ok(countsAfterHandoff&&countsAfterHandoff.branch!==countsBeforeHandoff.branch,'deployment tray should follow the next player’s distinct branch');
   assert.equal(await deploymentTray.getAttribute('data-branch'),countsAfterHandoff.branch,'tray branch marker should match its accessible name');
   assert.equal(recordBranch,countsAfterHandoff.branch,'player record and deployment tray should follow the same branch');
   await deploymentTray.click();
   const branchSheet=page.locator('.military-sheet.physical-military-sheet');
   await branchSheet.waitFor({state:'visible'});
   assert.equal(await branchSheet.getAttribute('data-branch'),countsAfterHandoff.branch,'tray should open the current player’s branch sheet');
   const recordCounts=await branchSheet.locator('.record-reserve').evaluateAll(nodes=>nodes.reduce((totals,node)=>{
    const match=node.getAttribute('aria-label')?.match(/^(\d+) of (\d+) .* pieces in reserve$/);
    if(match){totals.reserve+=Number(match[1]);totals.total+=Number(match[2]);}
    return totals;
   },{reserve:0,total:0}));
   assert.equal(countsAfterHandoff.reserve,recordCounts.reserve,'tray reserve count should match the open branch record slots');
   assert.equal(countsAfterHandoff.deployed,recordCounts.total-recordCounts.reserve,'tray deployed count should match active branch pieces outside reserve');
   await page.getByRole('button',{name:'Close military sheets'}).click();
   item.checks.push('movement confirmed; encounter resolved; research alternative passed the turn; branch/player tray followed Player 2 and matched its branch sheet counts');
  }
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
      terrain: { measurement:'Cumulative after setup, camera interactions, movement, encounter and the selected follow-up action; viewport has a fresh browser context.',
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
} finally { await browser.close(); report.finished=new Date().toISOString(); await writeFile(process.env.BROWSER_REPORT_PATH ?? `${out}/browser-verification.json`,JSON.stringify(report,null,2)+'\n'); }
console.log(JSON.stringify(report,null,2));
if(report.viewports.some(v=>!v.passed)) process.exitCode=1;
