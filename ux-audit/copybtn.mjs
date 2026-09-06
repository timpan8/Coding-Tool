import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1400);
const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await p.waitForTimeout(400);
await p.locator('.editor-body').click(); await p.keyboard.insertText('$a = "x"\n'); await p.waitForTimeout(1500);
console.log(await p.evaluate(() => ['button.ai-copy','.heading-actions button.primary','.top-navigation button']
  .map(s => { const e = document.querySelector(s); if (!e) return s + ': saknas';
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    return `${s}: ${cs.fontSize} / ${cs.fontWeight} / ${Math.round(r.width)}x${Math.round(r.height)}`; }).join('\n')));
await b.close();
