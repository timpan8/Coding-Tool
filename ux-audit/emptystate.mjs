import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await p.waitForTimeout(600);
const r = await p.evaluate(() => {
  const vis = el => el.getBoundingClientRect().height > 0 && !el.closest('[hidden]');
  const btns = [...document.querySelectorAll('#huvudinnehall button')].filter(vis);
  return { totalt: btns.length,
    inaktiverade: btns.filter(x => x.disabled).map(x => (x.getAttribute('aria-label') || x.textContent).trim().slice(0,28)),
    aktiva: btns.filter(x => !x.disabled).map(x => (x.getAttribute('aria-label') || x.textContent).trim().slice(0,28)) };
});
console.log('TOMT LÄGE #/ — knappar i <main>:', r.totalt);
console.log('  INAKTIVERADE (' + r.inaktiverade.length + '):', r.inaktiverade.join(' · '));
console.log('  AKTIVA (' + r.aktiva.length + '):', r.aktiva.join(' · '));
await b.close();
