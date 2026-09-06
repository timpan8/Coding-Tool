import { chromium } from '@playwright/test';
const base='http://127.0.0.1:4173';
const b = await chromium.launch();
const out=[];
async function probe(tag, hash, shot) {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const page = await ctx.newPage();
  await page.goto(base+'/'+hash); await page.waitForTimeout(1600);
  const skip = page.locator('dialog[aria-label="Så fungerar AI Code Vault"] button', { hasText:'Hoppa över' }).first();
  if (await skip.isVisible().catch(()=>false)) { await skip.click({timeout:2500}).catch(()=>out.push('   [!] Intro "Hoppa över" BLOCKED by another dialog]')); await page.waitForTimeout(400); }
  const s = await page.evaluate(() => ({
    hash: location.hash,
    mainText: (document.querySelector('main')?.innerText ?? '').trim().slice(0,110).replace(/\n/g,' | '),
    mainH: document.querySelector('main')?.getBoundingClientRect().height,
    dialogs: [...document.querySelectorAll('dialog[open]')].map(d => (d.innerText||'').trim().slice(0,80).replace(/\n/g,' | ')),
  }));
  out.push(`${tag}\n   hash=${s.hash}  mainHeight=${Math.round(s.mainH)}\n   main="${s.mainText}"\n   dialogs=${JSON.stringify(s.dialogs)}`);
  if (shot) await page.screenshot({ path:'ux-audit/screens/'+shot });
  await ctx.close();
}
await probe('1) fresh cold load #/nonsens','#/nonsens','zz-unknown-cold--1440.png');
await probe('2) fresh cold load unknown project id','#/project/00000000-0000-0000-0000-000000000000','zz-unknown-project--1440.png');
await probe('3) fresh cold load #/projects','#/projects',null);
await probe('4) fresh cold load #/bindings','#/bindings',null);
await probe('5) fresh cold load no hash','',null);
console.log(out.join('\n'));
await b.close();
