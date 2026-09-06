import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [390, 768, 1000, 1250, 1251, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('$user = "tim"\n');
  await page.waitForTimeout(1400);
  await page.keyboard.press('Control+s'); await page.waitForTimeout(800);
  const dlg = page.locator('dialog[open] .dialog-actions button.primary');
  if (await dlg.count()) { await dlg.click(); await page.waitForTimeout(1500); }
  // open the version accordion
  const item = page.locator('.version-item > button:first-child').first();
  let res = 'ingen versionspost';
  if (await item.count()) {
    await item.click({ force: true }); await page.waitForTimeout(700);
    res = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.version-actions button')];
      return { antal: btns.length, synliga: btns.filter(b => getComputedStyle(b).display !== 'none').length,
               display: btns.map(b => getComputedStyle(b).display).join(',') };
    });
    res = JSON.stringify(res);
  }
  console.log(String(w).padStart(5) + 'px  ' + res);
  await ctx.close();
}
await browser.close();
