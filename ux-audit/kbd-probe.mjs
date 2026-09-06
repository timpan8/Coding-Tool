import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b = await chromium.launch();
const ctx = await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page = await ctx.newPage();
const desc = () => page.evaluate(()=>{ const el=document.activeElement; if(!el) return 'null';
  return el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'')
   +' | "'+((el.getAttribute('aria-label')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,32))+'"'
   +(el.closest('[hidden]')?' [INSIDE HIDDEN]':'')+(el.closest('dialog')?' [in dialog]':'')+(el.closest('[inert]')?' [INSIDE INERT]':''); });

await page.goto(BASE,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
console.log('=== intro modal open. focus:', await desc());
console.log('--- tab 12x inside intro modal (focus trap check) ---');
for (let i=0;i<12;i++){ await page.keyboard.press('Tab'); console.log('  '+(i+1)+': '+await desc()); }
console.log('--- shift+tab 3x ---');
for (let i=0;i<3;i++){ await page.keyboard.press('Shift+Tab'); console.log('  '+await desc()); }

// remember what had focus before opening: nothing. Close it.
const c = page.locator('dialog[open] .dialog-head button'); await c.first().click(); await page.waitForTimeout(500);
console.log('=== after closing intro, focus:', await desc());

await page.locator('.editor-body').click();
await page.keyboard.type('$adminPassword = "Hunter2!"\n$host = "sql01.corp.local"\n',{delay:2});
await page.waitForTimeout(2600);

console.log('\n=== FULL TAB ORDER from top of #/ (40 stops) ===');
await page.evaluate(()=>{ document.activeElement?.blur?.(); window.scrollTo(0,0); });
await page.keyboard.press('Tab'); // may land in skip link
for (let i=0;i<40;i++){ console.log('  '+(i+1)+': '+await desc()); await page.keyboard.press('Tab'); }

console.log('\n=== hidden views reachable? ===');
console.log(await page.evaluate(()=>{
  const sel='a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const all=[...document.querySelectorAll(sel)];
  const inHidden=all.filter(e=>e.closest('[hidden]'));
  const styled = inHidden.map(e=>({tag:e.tagName, cls:String(e.className).slice(0,30), display:getComputedStyle(e).display,
     parentHiddenDisplay:getComputedStyle(e.closest('[hidden]')).display, offsetParent: e.offsetParent!==null}));
  return {total:all.length, inHidden:inHidden.length, sample: styled.slice(0,6),
    anyRendered: styled.filter(s=>s.parentHiddenDisplay!=='none').length};
}));

console.log('\n=== monaco tab behaviour ===');
await page.locator('.monaco-editor textarea').first().focus().catch(()=>{});
console.log(' focus in monaco:', await desc());
await page.keyboard.press('Tab'); await page.waitForTimeout(200);
console.log(' after Tab:', await desc());
console.log(' text now:', JSON.stringify(await page.evaluate(()=>document.querySelector('.editor-body')?.innerText.slice(0,60))));

await b.close();
