import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const LONGLINE = '$connectionString = "Server=sql-prod-01.internal.example.com,1433;Database=CustomerPortalProduction;User Id=svc_portal_reader;Password=Hunter2-Very-Secret-And-Also-Quite-Long;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30"';
const b = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await p.waitForTimeout(500);
  await p.locator('.editor-body').click();
  await p.keyboard.insertText(LONGLINE + '\n');
  await p.waitForTimeout(2000);
  // create a binding with a very long name via the findings panel
  const mk = p.locator('.finding-actions button', { hasText: 'Skapa binding' }).first();
  if (await mk.count()) {
    await mk.click(); await p.waitForTimeout(900);
    const nameField = p.locator('dialog[open] input').first();
    if (await nameField.count()) await nameField.fill('PRODUKTIONSDATABAS_ANSLUTNINGSSTRANG_FOR_KUNDPORTALEN_LASBEHORIGHET');
    const s = p.locator('dialog[open] .dialog-actions button.primary');
    if (await s.count()) { await s.click(); await p.waitForTimeout(1500); }
  }
  await p.screenshot({ path: `${OUT}35-long-strings--${w}.png`, fullPage: true });
  const over = await p.evaluate(() => {
    const vw = window.innerWidth, bad = [];
    for (const el of document.querySelectorAll('.binding-panel *, .finding *, .binding-card *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) bad.push(el.className?.toString().slice(0,40) + ' right=' + Math.round(r.right));
    }
    return { docScrollW: document.documentElement.scrollWidth, vw, bad: bad.slice(0,6) };
  });
  console.log(w + 'px:', JSON.stringify(over));
  await ctx.close();
}
await b.close();
