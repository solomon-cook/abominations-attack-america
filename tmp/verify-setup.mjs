import {chromium} from 'playwright';import {chromePath} from '../scripts/chrome-path.mjs';import assert from 'node:assert/strict';
async function clickOpenLocation(page){
 const tiles=page.locator('.hex-tile.deployment-legal');
 for(let i=0;i<await tiles.count();i++){
  const tile=tiles.nth(i);const clear=await tile.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});
  if(clear){await tile.click();return;}
 }
 throw new Error('No unobstructed legal location');
}
const browser=await chromium.launch({executablePath:chromePath,headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.goto('http://127.0.0.1:5191');await page.getByRole('button',{name:'Start local game',exact:true}).click();
for(let i=0;i<4;i++){console.log('setup step',i,await page.locator('body').innerText().then(t=>t.slice(-500)));await page.locator('.setup-options button').first().click();}
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
assert.deepEqual(errors,[]);console.log('PASS: named/glowing lairs, multiple chosen starting troops, undo, confirm, research alternative, game starts.');
}finally{await browser.close();}
