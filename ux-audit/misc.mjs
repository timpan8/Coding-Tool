import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(1200);
const c=p.locator('dialog[open] .dialog-head button'); if(await c.count()) await c.first().click(); await p.waitForTimeout(400);
// seed 6 projects
for (const n of ['Alfa','Beta','Gamma','Delta','Epsilon','Zeta']) {
  await p.goto(BASE+'#/'); await p.waitForTimeout(500);
  await p.locator('.editor-body').click(); await p.keyboard.insertText('$a="'+n+'"\n'); await p.waitForTimeout(1100);
  const rn=p.locator('button.project-name'); if(await rn.count()){ await rn.click(); await p.locator('input.project-name-input').fill(n); await p.keyboard.press('Enter'); await p.waitForTimeout(400);}
}
await p.goto(BASE+'#/projects'); await p.waitForTimeout(1200);
const card = await p.evaluate(()=>{
  const c=document.querySelector('.project-card'); const out=[];
  for(const el of c.querySelectorAll('*')){
    const own=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' ');
    if(!own) continue; const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
    out.push({t:own.slice(0,30),cls:typeof el.className==='string'?el.className:'',fs:cs.fontSize,fw:cs.fontWeight,color:cs.color,bg:cs.backgroundColor,y:Math.round(r.y-c.getBoundingClientRect().y),h:Math.round(r.height)});
  }
  const cr=c.getBoundingClientRect();
  return {cardH:Math.round(cr.height), cardW:Math.round(cr.width), out};
});
console.log('CARD', JSON.stringify(card,null,1));
// drawer position
await p.goto(BASE+'#/'); await p.waitForTimeout(600);
await p.keyboard.press('Control+p'); await p.waitForTimeout(700);
const dr = await p.evaluate(()=>{const d=document.querySelector('.project-drawer'); if(!d) return null; const r=d.getBoundingClientRect(); const cs=getComputedStyle(d);
  return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),left:cs.left,right:cs.right,position:cs.position, isModal:d.matches(':modal')};});
console.log('DRAWER', JSON.stringify(dr));
// topbar inventory
const tb = await p.evaluate(()=>{const h=document.querySelector('.topbar'); return [...h.querySelectorAll('button,select,a,span.save-state')].map(e=>({tag:e.tagName,t:(e.textContent||'').trim().slice(0,26),x:Math.round(e.getBoundingClientRect().x)}));});
console.log('TOPBAR', JSON.stringify(tb));
await b.close();
