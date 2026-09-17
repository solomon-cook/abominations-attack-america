import {chromium} from 'playwright';import {chromePath} from '../scripts/chrome-path.mjs';import assert from 'node:assert/strict';
async function clickOpenLocation(page){
 const tiles=page.locator('.hex-tile.legal');
 for(let i=0;i<await tiles.count();i++){
  const tile=tiles.nth(i);const clear=await tile.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});
  if(clear){await tile.click();return;}
 }
 throw new Error('No unobstructed legal location');
}
const browser=await chromium.launch({executablePath:chromePath,headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.goto('http://127.0.0.1:5191');await page.getByRole('button',{name:'Start local game',exact:true}).click();
for(let i=0;i<4;i++){await page.locator('.setup-options button').first().click();await page.waitForTimeout(80);}
assert.match(await page.locator('.setup-panel h2').innerText(),/lair selection/i);
assert.equal(await page.locator('.hex-tile.deployment-legal').count(),3);
assert.doesNotMatch(await page.locator('.setup-options').innerText(),/Cell \d/);
await page.screenshot({path:'tmp/setup-lairs.png'});
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'tmp/setup-lairs-mobile.png'});
await page.setViewportSize({width:1440,height:900});
await clickOpenLocation(page);
await page.locator('.setup-options button').first().click();
await page.getByRole('button',{name:'Deploy starting troops',exact:true}).click();
await page.getByRole('region',{name:'Reserve pieces'}).locator('button').first().click();
assert.ok(await page.locator('.hex-tile.deployment-legal').count()>0);
await clickOpenLocation(page);
assert.match(await page.locator('.setup-options').innerText(),/1 starting troop placed/);
await page.getByRole('button',{name:'Choose another starting unit'}).click();
await page.getByRole('region',{name:'Reserve pieces'}).locator('button').first().click();
await clickOpenLocation(page);
assert.match(await page.locator('.setup-options').innerText(),/2 starting troops placed/);
await page.getByRole('button',{name:'Undo last placement'}).click();
assert.match(await page.locator('.setup-options').innerText(),/1 starting troop placed/);
await page.getByRole('button',{name:'Finish starting deployment'}).click();
await page.getByRole('button',{name:'Draw Research',exact:true}).click();
await page.getByRole('button',{name:'Minimize turn panel'}).waitFor();
assert.equal(await page.locator('.setup-panel').count(),0);

const checklist=page.getByRole('region',{name:'Movement checklist'});
assert.equal(await checklist.locator('.movement-piece').count(),2);
await checklist.locator('.movement-piece').first().click();
await clickOpenLocation(page);
await page.getByRole('button',{name:'Confirm path',exact:true}).click();
assert.match(await page.locator('.turn-hud-heading h2').innerText(),/Move/);
assert.equal(await checklist.locator('.movement-piece.completed').count(),1);
await checklist.locator('.movement-piece').nth(1).click();
await clickOpenLocation(page);
await page.getByRole('button',{name:'Confirm unit path',exact:true}).click();
assert.equal(await checklist.locator('.movement-piece.completed').count(),2);
await page.screenshot({path:'tmp/movement-desktop.png'});
const panel=await page.locator('#game-side-panel').boundingBox();assert.ok(Math.abs(panel.y+panel.height-884)<3);
const sheets=await page.locator('.player-sheet-peeks').boundingBox();assert.ok(Math.abs(sheets.x+sheets.width/2-720)<3);
assert.ok(sheets.x+sheets.width<panel.x);
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'tmp/movement-mobile.png'});
const mobilePanel=await page.locator('#game-side-panel').boundingBox(),mobileSheets=await page.locator('.player-sheet-peeks').boundingBox();
assert.ok(mobilePanel.y+mobilePanel.height<=mobileSheets.y);
await page.getByRole('button',{name:'End movement →',exact:true}).click();
assert.doesNotMatch(await page.locator('.turn-hud-heading h2').innerText(),/Move/);
assert.deepEqual(errors,[]);console.log('PASS: monster then military move, completed checklist, explicit end movement, bottom-right HUD and centered sheets, mobile separation.');

}finally{await browser.close();}
