import { chromium } from 'playwright';
import { chromePath } from '../scripts/chrome-path.mjs';
const browser=await chromium.launch({executablePath:chromePath,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',console.error);
await page.addInitScript(()=>localStorage.setItem('abominations-onboarding-seen','1'));
await page.goto('http://127.0.0.1:5191');
await page.getByRole('button',{name:'Play audited board',exact:true}).click();
for(let i=0;i<8;i++) {
 const setup=page.locator('.setup-options');
 if(!await setup.count()) break;
 const deploy=setup.getByRole('button',{name:'Deploy units',exact:true});
 await (await deploy.count()?deploy:setup.locator('button').first()).click();
 await page.waitForTimeout(150);
}

await page.screenshot({path:'tmp/sheet-peeks-board.png'});
await page.getByRole('button',{name:'Open Zorb monster sheet',exact:true}).click();
await page.getByRole('heading',{name:'Zorb',exact:true}).waitFor();
if(!(await page.getByRole('dialog').textContent()).includes('Starting health')) throw Error('Missing monster stats');
await page.screenshot({path:'tmp/monster-physical-record.png'});
await page.getByText('View original physical sheet',{exact:true}).click();
await page.locator('.sheet-source img').evaluate(img=>img.decode());
await page.screenshot({path:'tmp/monster-reference-sheet.png'});
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Open Navy military sheet',exact:true}).click();
const reference=await page.getByRole('dialog').textContent();
for(const text of ['Nuclear Submarine','4 / 8 as missile','Defense','Damage','Attacks']) if(!reference.includes(text)) throw Error('Missing '+text);
await page.getByText('View original physical sheet',{exact:true}).click();
await page.locator('.sheet-source img').evaluate(img=>img.decode());
await page.getByText('View original physical sheet',{exact:true}).click();
await page.screenshot({path:'tmp/military-reference-sheet.png'});
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'tmp/military-reference-mobile.png'});
await page.keyboard.press('Escape');
if(await page.getByRole('dialog').count()) throw Error('Dialog did not close');
console.log('PASS: visible sheet controls, monster and military stats, source photos, mobile layout, Escape dismissal.');
await browser.close();
