import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
const route = process.argv[2] || '#/settings';
await page.goto(BASE + route); await page.waitForTimeout(1200);
const dump = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('main *')) {
    const own = [...el.childNodes].filter(n => n.nodeType===3 && n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');
    const isCtl = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    if (!own && !isCtl) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    out.push({ tag: el.tagName.toLowerCase(), cls: typeof el.className==='string'?el.className:'', text: (own||el.value||el.type||'').slice(0,44),
      fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, bd: cs.borderColor,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
});
console.log(JSON.stringify(dump));
await browser.close();
