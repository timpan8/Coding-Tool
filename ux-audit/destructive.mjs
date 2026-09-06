import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('$user = "tim"\n$pw = "Hunter2-Very-Secret!"\n');
  await page.waitForTimeout(1800);
  const mk = page.locator('.finding-actions button', { hasText: 'Skapa binding' }).first();
  if (await mk.count()) { await mk.click(); await page.waitForTimeout(800);
    const s = page.locator('dialog[open] .dialog-actions button.primary'); if (await s.count()) { await s.click(); await page.waitForTimeout(1400); } }
  const out = await page.evaluate(() => {
    const want = ['Radera projekt', 'Radera', 'Ofarligt här', '×', 'Om projektet', 'Skapa binding'];
    const res = [];
    for (const el of document.querySelectorAll('button')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (!want.some(x => label === x || label.startsWith('Radera '))) continue;
      const r = el.getBoundingClientRect(); if (!r.height) continue;
      const cs = getComputedStyle(el);
      res.push({ label: label.slice(0,26), w: Math.round(r.width), h: Math.round(r.height),
                 cls: el.className.slice(0,24), size: cs.fontSize, color: cs.color });
    }
    return res;
  });
  console.log('--- ' + w + 'px ---');
  out.forEach(o => console.log(`  ${String(o.w)+'x'+o.h}`.padEnd(10) + ` ${o.size.padEnd(8)} "${o.label}"  .${o.cls}  ${o.color}`));
  await ctx.close();
}
await browser.close();
