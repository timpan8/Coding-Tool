import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [390, 700, 768, 900, 1100, 1250, 1440, 1700]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const g = document.querySelector('.work-grid');
    return { cols: g ? getComputedStyle(g).gridTemplateColumns : null,
             shellHasCodeFirst: !!document.querySelector('.app-shell.code-first') };
  });
  console.log(String(w).padStart(5) + 'px  ' + r.cols + (r.shellHasCodeFirst ? '' : '  (ingen .code-first!)'));
  await ctx.close();
}
await browser.close();
