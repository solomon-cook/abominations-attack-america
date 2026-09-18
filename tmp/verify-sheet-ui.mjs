import {chromium} from 'playwright';import {chromePath} from '../scripts/chrome-path.mjs';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:chromePath,headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5191/sheet-ui-check.html');
const detail=page.getByRole('region',{name:'Selected piece details'});assert.match(await detail.innerText(),/Nuclear Submarine/);assert.match(await detail.innerText(),/fly up to 8/);assert.match(await detail.innerText(),/attack roll is 1/);assert.ok(await detail.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0));
await page.getByRole('button',{name:'Deployment sheet',exact:true}).click();
assert.equal(await page.locator('.military-sheet-pieces').count(),0);
await page.locator('.record-reserve-slots button').first().click();assert.ok(await page.evaluate(()=>window.selected?.id));
await page.getByRole('button',{name:'Open Army military sheet',exact:true}).click();await page.locator('.record-reserve-slots button').first().click();assert.equal(await page.getByRole('dialog').count(),0);
await page.getByRole('button',{name:'Open Zorb monster sheet',exact:true}).click();
const record=await page.locator('.physical-monster-sheet').boundingBox(),cards=await page.getByRole('region',{name:'Your Mutation cards'}).boundingBox();assert.ok(cards.x>=record.x+record.width);assert.ok(Math.abs(cards.y-record.y)<25);
const radiation=page.getByRole('article',{name:'Radiation Field',exact:true});assert.ok(await radiation.locator('.sheet-card-rules').isVisible());assert.match(await radiation.locator('.sheet-card-rules').innerText(),/military unit/);
await page.screenshot({path:'tmp/monster-cards-beside.png'});
await page.goto('http://127.0.0.1:5191');await page.getByRole('button',{name:'Victory test',exact:true}).click();
const header=await page.locator('header').boundingBox(),phase=await page.getByRole('navigation',{name:'Turn progress'}).boundingBox();assert.ok(phase.y>=header.y&&phase.y+phase.height<=header.y+header.height);assert.equal(await page.locator('#game-side-panel .turn-hud-heading').count(),0);
await page.screenshot({path:'tmp/top-turn-strip.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/top-turn-strip-mobile.png'});assert.deepEqual(errors,[]);console.log('PASS: unit artwork/stats/submarine rules, direct reserve-slot deployment from both sheet entry points, adjacent readable mutations, top phase strip.');
}finally{await browser.close();}
