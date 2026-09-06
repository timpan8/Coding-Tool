import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await page.waitForTimeout(600);

const btn = page.locator('.paste-prompt button');
console.log('sample button count:', await btn.count());
const geo = await btn.evaluate(el => {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  const top = document.elementFromPoint(cx, cy);
  const cs = getComputedStyle(el), parent = getComputedStyle(el.closest('.paste-prompt'));
  return { rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
           topElementAtCentre: top ? top.tagName.toLowerCase() + '.' + (top.className?.toString().slice(0,60)) : null,
           isTheButton: top === el || el.contains(top),
           btnPointerEvents: cs.pointerEvents, promptPointerEvents: parent.pointerEvents,
           promptZ: parent.zIndex, promptPos: parent.position };
});
console.log(JSON.stringify(geo, null, 1));

// try a real user click with a short timeout
let clicked = 'yes';
try { await btn.click({ timeout: 3000 }); } catch (e) { clicked = 'TIMEOUT: ' + e.message.split('\n')[0]; }
await page.waitForTimeout(800);
const filled = await page.evaluate(() => document.querySelector('.view-lines')?.innerText?.length ?? 0);
console.log('click:', clicked, '| editor text length after:', filled);

// force-click bypasses the interception check — does the handler itself work?
try { await btn.click({ force: true, timeout: 3000 }); } catch(e) { console.log('force click failed:', e.message.split('\n')[0]); }
await page.waitForTimeout(900);
console.log('editor text length after force click:', await page.evaluate(() => document.querySelector('.view-lines')?.innerText?.length ?? 0));
await page.screenshot({ path: new URL('./screens/30-sample-button-blocked--1440.png', import.meta.url).pathname });
await browser.close();
