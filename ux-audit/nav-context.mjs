import { chromium } from '@playwright/test';
const base='http://127.0.0.1:4173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const page = await ctx.newPage();
const out=[];
const now = async (tag) => {
  const s = await page.evaluate(() => ({ hash: location.hash,
    heading: (document.querySelector('.workspace h1')?.textContent) ?? (document.querySelector('.project-name')?.textContent) ?? (document.querySelector('main h1')?.textContent) ?? '(none)',
    backBtn: !!([...document.querySelectorAll('button')].find(x=>x.textContent.includes('Tillbaka till pågående'))),
    docTitle: document.title }));
  out.push(`${tag.padEnd(34)} hash=${s.hash.padEnd(44)} heading="${s.heading.trim()}" "Tillbaka till pågående"=${s.backBtn} title="${s.docTitle}"`);
};
await page.goto(base+'/#/'); await page.waitForTimeout(1000);
const skip = page.locator('dialog[aria-label="Så fungerar AI Code Vault"] button', { hasText:'Hoppa över' }).first();
if (await skip.isVisible().catch(()=>false)) { await skip.click(); await page.waitForTimeout(400); }
await page.locator('.editor-body').click();
await page.keyboard.type('$a = "hemlighet"\n'); await page.waitForTimeout(1400);
await page.locator('.project-name').click(); await page.waitForTimeout(200);
await page.keyboard.press('Control+a'); await page.keyboard.type('MITT-PROJEKT'); await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
await now('1. project open');

// click brand logo
await page.locator('a.brand').click(); await page.waitForTimeout(1200);
await now('2. clicked brand logo');

// back to project, then Settings, then look for a way back
await page.goBack(); await page.waitForTimeout(1200); await now('3. back to project');
await page.locator('.top-navigation button', { hasText:'Inställningar' }).click(); await page.waitForTimeout(900);
await now('4. on Inställningar');
const waysBack = await page.evaluate(() => [...document.querySelectorAll('main button, main a')].filter(e=>e.offsetParent).map(e=>e.textContent.trim()).filter(t=>/projekt|Tillbaka|arbets/i.test(t)));
out.push(`   ways back to the project from Inställningar (visible in <main>): ${JSON.stringify(waysBack)}`);

// drawer search state loss
await page.locator('.top-navigation button', { hasText:'Ny kod' }).click(); await page.waitForTimeout(1000);
await now('5. clicked "＋ Ny kod" from Inställningar');
await page.locator('.top-navigation button', { hasText:'Mina projekt' }).click(); await page.waitForTimeout(600);
await page.locator('.project-drawer input').fill('MITT');
await page.waitForTimeout(400);
const drawerCount = await page.locator('.drawer-project').count();
await page.locator('.project-drawer button.primary').click(); await page.waitForTimeout(1200);
const pageQuery = await page.locator('.dashboard input[type=search], .dashboard input').first().inputValue().catch(()=>'(no input)');
const pageCount = await page.locator('.project-cards > *').count();
out.push(`6. drawer search "MITT" matched ${drawerCount}; after "Visa alla projekt" the page search box = "${pageQuery}", cards shown = ${pageCount}`);
await now('7. on Alla projekt');
console.log(out.join('\n'));
await b.close();
