import { chromium } from '@playwright/test';
const base='http://127.0.0.1:4173';
const b = await chromium.launch();
const page = await b.newPage({ viewport:{width:1440,height:900} });
const out=[];
const state = async (tag) => {
  const s = await page.evaluate(() => ({
    hash: location.hash,
    mainText: (document.querySelector('main')?.innerText ?? '').trim().slice(0,120).replace(/\n/g,' | '),
    dialogs: [...document.querySelectorAll('dialog[open]')].map(d => (d.querySelector('h2,h3')?.textContent ?? d.getAttribute('aria-label') ?? '') + ' :: ' + (d.innerText||'').trim().slice(0,90).replace(/\n/g,' | ')),
  }));
  out.push(`${tag}\n   hash=${s.hash}\n   main="${s.mainText}"\n   dialogs=${JSON.stringify(s.dialogs)}`);
};
// 1: cold load on an unknown hash
await page.goto(base+'/#/nonsens'); await page.waitForTimeout(1500);
const skip = page.locator('dialog[aria-label="Så fungerar AI Code Vault"] button', { hasText:'Hoppa över' }).first();
if (await skip.isVisible().catch(()=>false)) { await skip.click(); await page.waitForTimeout(400); }
await state('1) COLD LOAD #/nonsens');
await page.screenshot({ path:'ux-audit/screens/zz-unknown-cold--1440.png' });

// 2: cold load on a project id that does not exist
await page.goto(base+'/#/project/00000000-0000-0000-0000-000000000000'); await page.waitForTimeout(1800);
await state('2) COLD LOAD unknown project id');
await page.screenshot({ path:'ux-audit/screens/zz-unknown-project--1440.png' });

// 3: in-app hash change to unknown
await page.goto(base+'/#/'); await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = '#/nonsens'; }); await page.waitForTimeout(1200);
await state('3) IN-APP hash -> #/nonsens');
await page.screenshot({ path:'ux-audit/screens/zz-unknown-inapp--1440.png' });

// 4: cold load #/projects directly (deep link)
await page.goto(base+'/#/projects'); await page.waitForTimeout(1500);
await state('4) COLD LOAD #/projects');
console.log(out.join('\n'));
await b.close();
