import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await page.waitForTimeout(500);
for (const r of ['#/', '#/projects', '#/settings']) {
  await page.goto('http://127.0.0.1:4173/' + r); await page.waitForTimeout(800);
  const res = await page.evaluate(() => {
    const vw = window.innerWidth, bad = [];
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > vw + 1) {
        const cs = getComputedStyle(el);
        bad.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          right: Math.round(b.right), width: Math.round(b.width), minW: cs.minWidth, ovf: cs.overflowX,
          parent: el.parentElement?.className?.toString().slice(0,40) });
      }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 14) };
  });
  console.log('\n### ' + r, 'vw', res.vw, 'scrollW', res.scrollW);
  res.bad.forEach(b => console.log('  ', b.right, 'w=' + b.width, b.sel.slice(0, 80), '| minW:' + b.minW, 'ovfX:' + b.ovf));
}
await browser.close();
