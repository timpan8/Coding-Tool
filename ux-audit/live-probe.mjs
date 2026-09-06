import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(500);
await page.evaluate(()=>{
  window.__live=[];
  const watch=()=>{
    const nodes=[...document.querySelectorAll('[role=alert],[role=status],[aria-live]')];
    for(const n of nodes){ if(n.__w) continue; n.__w=true;
      const role=n.getAttribute('role')||('aria-live='+n.getAttribute('aria-live'));
      const cls=String(n.className).slice(0,26);
      new MutationObserver(()=>{window.__live.push({role,cls,text:(n.textContent||'').trim().replace(/\s+/g,' ').slice(0,60),t:Date.now()});})
        .observe(n,{childList:true,subtree:true,characterData:true});
    }
  };
  watch(); setInterval(watch,300);
  window.__start=Date.now();
});
await page.locator('.editor-body').click();
await page.keyboard.type('$adminPassword = "Hunter2-Secret!"\n$dbHost = "sql-prod-01.internal.example.com"\n$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"\n',{delay:35});
await page.waitForTimeout(3000);
const live=await page.evaluate(()=>window.__live);
const byRole={};
for(const e of live){const k=e.role+' .'+e.cls;byRole[k]=(byRole[k]||0)+1;}
console.log('typed 3 lines (~110 chars). live-region announcements fired:');
for(const [k,v] of Object.entries(byRole).sort((a,b)=>b[1]-a[1])) console.log('  '+v+'x  '+k);
console.log('\nsample of last 12 (role=alert only):');
for(const e of live.filter(e=>e.role==='alert').slice(-12)) console.log('  alert .'+e.cls+' :: '+e.text);
console.log('\nsample of last 10 status:');
for(const e of live.filter(e=>e.role==='status').slice(-10)) console.log('  status .'+e.cls+' :: '+e.text);
console.log('\nlive-region elements present now:');
console.log(await page.evaluate(()=>[...document.querySelectorAll('[role=alert],[role=status],[aria-live]')].filter(n=>!n.closest('[hidden]')).map(n=>({role:n.getAttribute('role')||n.getAttribute('aria-live'),cls:String(n.className).slice(0,30),text:(n.textContent||'').trim().slice(0,50),atomic:n.getAttribute('aria-atomic')}))));
await b.close();
