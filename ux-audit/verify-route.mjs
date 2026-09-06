import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// cold start straight onto an unknown route
await page.goto('http://127.0.0.1:4173/#/nonsens', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const m = document.querySelector('#huvudinnehall');
  return { hash: location.hash, mainText: (m?.innerText ?? '').trim().slice(0, 120),
           mainHeight: Math.round(m?.getBoundingClientRect().height ?? 0),
           dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.getAttribute('aria-label')),
           visibleSections: [...document.querySelectorAll('#huvudinnehall > div')].filter(d => !d.hasAttribute('hidden')).length };
});
console.log('KALLSTART #/nonsens:', JSON.stringify(r, null, 1));
await page.screenshot({ path: new URL('./screens/33-unknown-route-cold--1440.png', import.meta.url).pathname });
await browser.close();
