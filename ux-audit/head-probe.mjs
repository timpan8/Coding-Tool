import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const S=`$adminUser = "tim.andersson"\n$adminPassword = "Hunter2-Very-Secret!"\n$dbHost = "sql-prod-01.internal.example.com"\n`;
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
for(const n of ['Deploy','Backup','Migrering']){
 await page.goto(BASE+'#/');await page.waitForTimeout(700);
 await page.locator('.editor-body').click();await page.keyboard.insertText(S);await page.waitForTimeout(1500);
}
const H=()=>page.evaluate(()=>{const vis=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&r.height>0&&!e.closest('[hidden]');};
 return [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map(h=>h.tagName+' | '+h.textContent.trim().slice(0,44)+(h.closest('button')?'  <<inside a BUTTON>>':''));});
for(const r of ['#/','#/projects','#/bindings','#/settings','#/security']){
 await page.goto(BASE+r);await page.waitForTimeout(1400);
 console.log('\n### '+r+'   title="'+await page.title()+'"');
 for(const h of await H())console.log('   '+h);
}
// project card structure
await page.goto(BASE+'#/projects');await page.waitForTimeout(1200);
console.log('\nproject card outerHTML head:',(await page.locator('.project-card').first().evaluate(e=>e.outerHTML)).slice(0,420));
console.log('\naccessible name of card:',await page.locator('.project-card').first().evaluate(e=>e.textContent.replace(/\s+/g,' ').slice(0,120)));
await b.close();
