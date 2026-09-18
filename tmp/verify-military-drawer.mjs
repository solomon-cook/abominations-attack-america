import { chromium } from 'playwright';
import { chromePath } from '../scripts/chrome-path.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:chromePath,headless:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('abominations-onboarding-seen','1'));
await page.goto('http://127.0.0.1:5191');
await page.getByRole('button',{name:'Play audited board',exact:true}).click();
for(let i=0;i<20;i++) {
 if(await page.getByRole('button',{name:'Open Navy military sheet',exact:true}).count()) break;
 const list=page.getByText('Choose from list',{exact:true}); if(await list.count()) await list.click();
 const research=page.getByRole('button',{name:/Draw.*Research/i});
 const option=page.locator('.setup-options button:enabled').first();
 if(await research.count()) await research.first().click(); else if(await option.count()) await option.click(); else break;
 await page.waitForTimeout(250);
}
await page.getByRole('tab',{name:'Military',exact:true}).click();
console.log(await page.locator('.record-preview').getAttribute('aria-label')); await page.locator('.military-record-preview').click();
await page.locator('#military-sheet-title').waitFor();
await page.waitForTimeout(250);
const drawer=page.locator('.military-drawer');assert.ok((await drawer.boundingBox()).width<=390);
assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'),null);
assert.equal(await page.evaluate(()=>document.elementFromPoint(400,400)?.closest('.military-drawer-layer')!==null),false);
await page.getByRole('button',{name:'National Guard',exact:true}).click();await page.getByRole('heading',{name:'National Guard',exact:true}).waitFor();
await page.keyboard.press('ArrowLeft');await page.locator('#military-sheet-title').waitFor();
await page.screenshot({path:'tmp/military-drawer-desktop.png'});
await page.locator('.military-drawer-research>summary').click();assert.equal(await page.locator('.military-drawer-research').getAttribute('open'),'');
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
assert.ok((await drawer.boundingBox()).height<844/2);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.locator('.military-sheet').evaluate(el=>el.scrollTop=0);
await page.screenshot({path:'tmp/military-drawer-mobile.png'});
await page.getByRole('button',{name:'Close military sheets'}).focus();await page.keyboard.press('Escape');assert.equal(await drawer.count(),0);assert.deepEqual(errors,[]);
console.log('PASS: real game, desktop/mobile bounds, board pointer access, tabs, keyboard navigation, research, Escape, no overflow or runtime errors.');
} finally {await browser.close();}
