import {chromium} from 'playwright';import {chromePath} from '../scripts/chrome-path.mjs';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:chromePath,headless:true});
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5191/deploy-check.html');
await page.getByRole('dialog').getByRole('button',{name:'Finish deployment'}).click();
assert.equal(await page.evaluate(()=>window.choiceCount),0);
assert.deepEqual(await page.evaluate(()=>[window.result.phase,window.result.currentPlayer]),['move',1]);
await page.getByRole('button',{name:'Close',exact:true}).click();
await page.locator('.action-dock').getByRole('button',{name:'Finish deployment'}).click();
assert.deepEqual(await page.evaluate(()=>[window.result.phase,window.result.currentPlayer]),['move',1]);
assert.deepEqual(errors,[]);console.log('PASS: exhausted deployment can finish from sheet and board, advancing to next player.');
}finally{await browser.close();}
