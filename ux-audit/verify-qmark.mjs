import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1600);
const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await p.waitForTimeout(600);
await p.locator('.editor-body').click(); await p.waitForTimeout(400);
await p.keyboard.insertText('$x = 1'); await p.waitForTimeout(1200);
const focusBefore = await p.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className.toString().slice(0,40));
await p.keyboard.type('?');
await p.waitForTimeout(800);
const after = await p.evaluate(() => ({
  dialogOpen: document.querySelectorAll('dialog[open]').length,
  dialogLabel: document.querySelector('dialog[open]')?.getAttribute('aria-label') ?? null,
  code: document.querySelector('.view-lines')?.innerText?.trim() ?? '',
}));
console.log('fokus i editorn:', focusBefore);
console.log('efter att ha skrivit "?":', JSON.stringify(after));
// Tab trap check
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
await p.locator('.editor-body').click(); await p.waitForTimeout(400);
const f0 = await p.evaluate(() => document.activeElement.className.toString().slice(0,40));
for (let i = 0; i < 3; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(200); }
const f1 = await p.evaluate(() => ({ el: document.activeElement.className.toString().slice(0,40),
  code: document.querySelector('.view-lines')?.innerText ?? '' }));
console.log('fokus före 3xTab:', f0, '\nefter:', JSON.stringify(f1));
await b.close();
