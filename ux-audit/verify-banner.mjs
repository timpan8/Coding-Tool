import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await p.waitForTimeout(500);
await p.locator('.editor-body').click();
await p.keyboard.insertText('$adminPassword = "Hunter2-Very-Secret!"\n$dbHost = "sql-prod-01.internal.example.com"\n');
await p.waitForTimeout(1800);

const read = async () => { await p.locator('#vy-ai').click(); await p.waitForTimeout(800);
  return p.evaluate(() => { const el = document.querySelector('.view-banner');
    const cs = getComputedStyle(el); return { text: el.querySelector('strong').textContent, bg: cs.backgroundColor, färg: cs.color }; }); };

console.log('UTAN bindings :', JSON.stringify(await read()));
// bind one value via the findings panel
await p.locator('#vy-template').click(); await p.waitForTimeout(500);
const mk = p.locator('.finding-actions button', { hasText: 'Skapa binding' }).first();
if (await mk.count()) { await mk.click(); await p.waitForTimeout(900);
  const s = p.locator('dialog[open] .dialog-actions button.primary'); if (await s.count()) { await s.click(); await p.waitForTimeout(1600); } }
console.log('MED 1 binding :', JSON.stringify(await read()));
await b.close();
