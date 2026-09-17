import {chromium} from 'playwright';
import {chromePath} from '../scripts/chrome-path.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:chromePath,headless:true});
try {
const page=await browser.newPage({viewport:{width:1100,height:850},hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5191/military-sheet-check.html');
await page.getByRole('heading',{name:'Army',exact:true}).waitFor();
await page.getByRole('button',{name:'National Guard',exact:true}).click();
assert.equal(await page.locator('.military-sheet-pieces strong').textContent(),'national guard tank');
await page.keyboard.press('ArrowRight');
await page.getByRole('heading',{name:'X-Fighters',exact:true}).waitFor();
await page.getByRole('button',{name:'Next military sheet'}).click();
await page.getByRole('heading',{name:'Army',exact:true}).waitFor();
await page.screenshot({path:'tmp/military-hand-desktop.png'});
await page.setViewportSize({width:390,height:844});
await page.locator('.military-sheet').evaluate(el=>{const event=new Event('touchstart',{bubbles:true});Object.defineProperty(event,'touches',{value:[{clientX:300,clientY:300}]});el.dispatchEvent(event);});
await page.locator('.military-sheet').evaluate(el=>{const event=new Event('touchend',{bubbles:true});Object.defineProperty(event,'changedTouches',{value:[{clientX:100,clientY:310}]});el.dispatchEvent(event);});
await page.getByRole('heading',{name:'National Guard',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.selected),undefined);
// The click synthesized after a swipe must not select a piece.
await page.locator('.military-sheet-pieces button').evaluate(el=>el.click());
assert.equal(await page.evaluate(()=>window.selected),undefined);
await page.locator('.military-sheet-pieces button').click();
assert.equal(await page.evaluate(()=>window.selected),'national-guard-tank-1');
await page.screenshot({path:'tmp/military-hand-mobile.png'});
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(()=>window.closedSheet),true);
assert.deepEqual(errors,[]);
console.log('PASS: separate sheets, tabs, arrow keys, wraparound, swipe, accidental-click protection, selection, Escape; no browser errors.');
} finally { await browser.close(); }
