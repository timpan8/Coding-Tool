import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(1200);
const c=p.locator('dialog[open] .dialog-head button'); if(await c.count()) await c.first().click();
await p.waitForTimeout(500);
const r = await p.evaluate(()=>{
  const pp=document.querySelector('.paste-prompt'); if(!pp) return {err:'no paste-prompt'};
  const btn=pp.querySelector('button');
  const bb=btn.getBoundingClientRect(); const sb=pp.querySelector('strong').getBoundingClientRect();
  const hit=document.elementFromPoint(bb.x+bb.width/2, bb.y+bb.height/2);
  return { promptPE:getComputedStyle(pp).pointerEvents, btnPE:getComputedStyle(btn).pointerEvents,
    btnTextAlign:getComputedStyle(btn).textAlign, btnX:Math.round(bb.x), btnW:Math.round(bb.width),
    strongX:Math.round(sb.x), hitTag:hit?.tagName, hitCls:hit?.className,
    strongFs:getComputedStyle(pp.querySelector('strong')).fontSize };
});
console.log(JSON.stringify(r,null,1));
// try clicking it
const before = await p.evaluate(()=>document.querySelectorAll('.view-line').length);
try { await p.locator('.paste-prompt button').click({timeout:2500}); } catch(e){ console.log('CLICK FAILED:', String(e).split('\n')[0]); }
await p.waitForTimeout(900);
console.log('editor text after click:', JSON.stringify((await p.evaluate(()=>document.querySelector('.editor-body')?.innerText||'')).slice(0,90)));
await b.close();
