import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:4173/#/settings', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) { await c.first().click(); await p.waitForTimeout(500); }
  const r = await p.evaluate(() => {
    const art = document.querySelector('#huvudinnehall article.document');
    const vis = el => el.getBoundingClientRect().height > 0;
    return { sidhojd: Math.round(art?.getBoundingClientRect().height ?? 0),
      viewport: window.innerHeight,
      primary: [...document.querySelectorAll('#huvudinnehall button.primary')].filter(vis).map(e => e.textContent.trim().slice(0,30)),
      danger: [...document.querySelectorAll('#huvudinnehall button.danger')].filter(vis).map(e => e.textContent.trim().slice(0,30)),
      notiser: [...document.querySelectorAll('#huvudinnehall .notice, #huvudinnehall .persistence-warning')].filter(vis).length,
      rubriker: [...document.querySelectorAll('#huvudinnehall h1,#huvudinnehall h2,#huvudinnehall h3')].filter(vis).map(h => h.tagName + ' ' + h.textContent.trim().slice(0,34)),
    };
  });
  console.log(`--- ${w}px --- sidhöjd ${r.sidhojd}px (${(r.sidhojd/r.viewport).toFixed(1)} skärmar)`);
  console.log('  .primary:', r.primary, '\n  .danger:', r.danger, '\n  varningsrutor:', r.notiser);
  console.log('  rubriker:', r.rubriker.join(' | '));
  await ctx.close();
}
await b.close();
