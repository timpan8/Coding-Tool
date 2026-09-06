import { chromium } from '@playwright/test';


const base = 'http://127.0.0.1:4173';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const log = [];
try{

const snap = async (tag) => {
  const h = page.url().split('#')[1] ?? '';
  const heading = await page.locator('.workspace h1, .project-name, .dashboard h1, main h1').first().textContent().catch(() => '?');
  const len = await page.evaluate(() => history.length);
  log.push(`${tag.padEnd(38)} hash=#${h.padEnd(42)} h1="${(heading||'').trim().slice(0,34)}" histLen=${len}`);
};

await page.goto(base + '/#/');
await page.waitForTimeout(900);
// close intro if present
const close = page.locator('dialog[aria-label="Så fungerar AI Code Vault"] button', { hasText: 'Hoppa över' }).first();
if (await close.isVisible().catch(()=>false)) { await close.click(); await page.waitForTimeout(300); }
await snap('1. start');

// paste code -> project A created
await page.locator('.editor-body').click();
await page.keyboard.type('$a = "hemligt-vaerde-1"\n$b = "server.example.test"\n');
await page.waitForTimeout(1200);
await snap('2. after typing (project A)');
const projA = page.url().split('#')[1];

// rename A so it is identifiable
await page.locator('.project-name').click();
await page.waitForTimeout(200);
await page.keyboard.press('Control+a');
await page.keyboard.type('PROJEKT-A');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
await snap('3. renamed A');

// go to settings
await page.locator('.top-navigation button', { hasText: 'Inställningar' }).click();
await page.waitForTimeout(700);
await snap('4. -> Inställningar');

// go to security
await page.locator('.top-navigation button', { hasText: 'Säkerhet' }).click();
await page.waitForTimeout(700);
await snap('5. -> Säkerhet');

// back once
await page.goBack(); await page.waitForTimeout(900);
await snap('6. Back (expect Inställningar)');
// back again
await page.goBack(); await page.waitForTimeout(900);
await snap('7. Back (expect PROJEKT-A)');
// back again
await page.goBack(); await page.waitForTimeout(900);
await snap('8. Back again');

// Now the "Ny kod" case
await page.goto(base + '/#' + projA); await page.waitForTimeout(1200);
await snap('9. reopened A directly');
await page.locator('.top-navigation button', { hasText: 'Ny kod' }).click();
await page.waitForTimeout(900);
await snap('10. -> Ny kod (empty)');
await page.goBack(); await page.waitForTimeout(1000);
await snap('11. Back from Ny kod');

// double-back stress
await page.locator('.top-navigation button', { hasText: 'Bindings' }).click(); await page.waitForTimeout(700);
await page.locator('.top-navigation button', { hasText: 'Säkerhet' }).click(); await page.waitForTimeout(700);
await snap('12. at Säkerhet');
await page.goBack(); await page.goBack();  // no wait between
await page.waitForTimeout(1500);
const notice = await page.locator('.inline-notice').textContent().catch(()=>'');
await snap('13. after two fast Backs');
log.push(`    notice after fast double-back: "${(notice||'').trim()}"`);

// how many projects exist now?
await page.locator('.top-navigation button', { hasText: 'Mina projekt' }).click();
await page.waitForTimeout(600);
const count = await page.locator('.drawer-project').count();
const names = await page.locator('.drawer-project strong').allTextContents();
log.push(`    projects in vault: ${count} -> ${JSON.stringify(names)}`);



}catch(e){ console.log('ERROR: '+e.message); }
console.log(log.join('\n'));
await b.close();
