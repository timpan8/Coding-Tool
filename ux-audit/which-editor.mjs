import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [390, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(600);
  const kind = await page.evaluate(() => ({
    monaco: !!document.querySelector('.monaco-editor'),
    plain: !!document.querySelector('.plain-editor, textarea'),
    matchesNarrow: matchMedia('(max-width: 750px)').matches,
  }));
  console.log(w + 'px ->', JSON.stringify(kind));
  await ctx.close();
}
await browser.close();
