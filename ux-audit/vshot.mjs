import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const browser = await chromium.launch();
for (const w of [768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('$user = "tim"\n');
  await page.waitForTimeout(1400);
  for (const l of ['Första', 'Andra']) {
    await page.keyboard.press('Control+s'); await page.waitForTimeout(800);
    const d = page.locator('dialog[open] input[aria-label="Versionsetikett"]');
    if (await d.count()) { await d.fill(l); await page.locator('dialog[open] .dialog-actions button.primary').click(); await page.waitForTimeout(1400); }
    await page.locator('.editor-body').click(); await page.keyboard.press('End'); await page.keyboard.type('#\n'); await page.waitForTimeout(600);
  }
  const item = page.locator('.version-item > button:first-child').first();
  if (await item.count()) { await item.click({ force: true }); await page.waitForTimeout(700); }
  await page.locator('.version-history').scrollIntoViewIfNeeded().catch(()=>{});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}34-version-actions-open--${w}.png`, fullPage: true });
  console.log('shot ' + w);
  await ctx.close();
}
await browser.close();
