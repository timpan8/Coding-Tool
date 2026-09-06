import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const browser = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('$user = "tim"\n$pw = "hemligt"\n');
  await page.waitForTimeout(1500);
  // save 9 versions, some with long labels, some with none
  const labels = ['Första utkastet', '', 'Innan omskrivningen av inloggningen och hela certifikatshanteringen', 'v3', '', 'Efter code review', 'Fix', '', 'Sista'];
  for (const l of labels) {
    await page.keyboard.press('Control+s'); await page.waitForTimeout(700);
    const dlg = page.locator('dialog[open]');
    if (await dlg.count()) {
      if (l) await page.locator('dialog[open] input[aria-label="Versionsetikett"]').fill(l);
      await page.locator('dialog[open] .dialog-actions button.primary').click();
      await page.waitForTimeout(1000);
    }
    await page.locator('.editor-body').click();
    await page.keyboard.press('End'); await page.keyboard.type('#x\n'); await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}32-many-versions--${w}.png`, fullPage: true });
  const n = await page.locator('.version-item, .version-list > *').count();
  console.log(w + 'px: versionsposter i DOM =', n);
  await ctx.close();
}
await browser.close();
