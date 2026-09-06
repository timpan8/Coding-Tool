import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
const desc=()=>page.evaluate(()=>{const e=document.activeElement;if(!e)return'null';
 return e.tagName.toLowerCase()+'.'+(typeof e.className==='string'?e.className.trim().split(/\s+/).slice(0,2).join('.'):'')+' "'+((e.getAttribute('aria-label')||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,30))+'"'+(e.closest('dialog')?' [dialog]':'');});
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(500);
await page.locator('.editor-body').click();
await page.keyboard.type('let a = 1\nlet b = 2\n',{delay:2});await page.waitForTimeout(2500);

console.log('== MONACO TAB TRAP ==');
await page.locator('.view-lines').click({position:{x:60,y:10}});await page.waitForTimeout(300);
console.log(' focus after click in code:',await desc());
const before=await page.evaluate(()=>document.querySelector('.editor-body').innerText);
await page.keyboard.press('Tab');await page.waitForTimeout(300);
console.log(' after 1st Tab:',await desc());
const after=await page.evaluate(()=>document.querySelector('.editor-body').innerText);
console.log(' text changed by Tab?',before!==after, JSON.stringify(after.slice(0,80)));
for(let i=0;i<4;i++){await page.keyboard.press('Tab');await page.waitForTimeout(200);console.log('  Tab '+(i+2)+': '+await desc());}
console.log(' text after 5 tabs:',JSON.stringify((await page.evaluate(()=>document.querySelector('.editor-body').innerText)).slice(0,100)));

console.log('\n== FOCUS RESTORE AFTER MODAL ==');
// shortcuts modal opened from nav button
const navBtn=page.getByRole('button',{name:'Visa kortkommandon'});
await navBtn.focus();console.log(' before open:',await desc());
await page.keyboard.press('Enter');await page.waitForTimeout(600);
console.log(' modal open, focus:',await desc());
await page.keyboard.press('Escape');await page.waitForTimeout(600);
console.log(' after Escape close:',await desc());

// project drawer via Ctrl+P
await page.getByRole('button',{name:/Mina projekt/}).focus();console.log('\n before opening drawer:',await desc());
await page.keyboard.press('Enter');await page.waitForTimeout(700);
console.log(' drawer open focus:',await desc());
await page.keyboard.press('Escape');await page.waitForTimeout(600);
console.log(' after drawer close:',await desc());

// copy dialog
const ai=page.locator('button.ai-copy');await ai.focus();console.log('\n before copy dialog:',await desc());
await page.keyboard.press('Enter');await page.waitForTimeout(800);
console.log(' copy dialog focus:',await desc());
await page.keyboard.press('Escape');await page.waitForTimeout(600);
console.log(' after copy dialog close:',await desc());

console.log('\n== FOCUS ON ROUTE CHANGE ==');
for (const r of ['#/projects','#/bindings','#/settings','#/security','#/']) {
  const nav={'#/projects':null,'#/bindings':'Bindings','#/settings':'Inställningar','#/security':'Säkerhet','#/':'＋ Ny kod'}[r];
  if(nav){ await page.getByRole('button',{name:nav}).first().click(); await page.waitForTimeout(800);
    console.log(` after clicking nav "${nav}" -> ${r}: focus = ${await desc()}`);
    const h1=await page.evaluate(()=>{const vis=[...document.querySelectorAll('h1')].filter(h=>!h.closest('[hidden]'));return vis.map(h=>h.textContent.trim().slice(0,40));});
    console.log('   visible h1s:',JSON.stringify(h1), ' scrollY=',await page.evaluate(()=>window.scrollY));
  }
}
console.log('\n== SKIP LINK ==');
await page.goto(BASE+'#/');await page.waitForTimeout(900);
await page.evaluate(()=>window.scrollTo(0,0));
await page.keyboard.press('Tab');console.log(' first tab stop:',await desc());
await page.keyboard.press('Enter');await page.waitForTimeout(500);
console.log(' after activating skip link:',await desc(), 'hash=',await page.evaluate(()=>location.hash));

console.log('\n== INERT / BUSY ==');
const st=await page.evaluate(()=>({busy:document.querySelector('main')?.getAttribute('aria-busy'),
  inert:document.querySelector('.workspace')?.hasAttribute('inert')}));
console.log(' idle state:',st);
await b.close();
