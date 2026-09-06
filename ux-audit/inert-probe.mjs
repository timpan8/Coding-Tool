import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
const d=()=>page.evaluate(()=>{const e=document.activeElement;return e?e.tagName.toLowerCase()+' "'+((e.getAttribute('aria-label')||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,28))+'"':'null';});
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
await page.locator('.editor-body').click();await page.keyboard.insertText('$a = "x"\n');await page.waitForTimeout(2200);
// observe inert/aria-busy transitions
await page.evaluate(()=>{window.__t=[];const w=document.querySelector('.workspace'),m=document.querySelector('main');
 new MutationObserver(()=>{window.__t.push({inert:w.hasAttribute('inert'),busy:m.getAttribute('aria-busy'),active:document.activeElement?.tagName+':'+(document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent||'').trim().slice(0,20)});})
  .observe(w,{attributes:true,attributeFilter:['inert']});});
const add=page.locator('.file-add');
await add.focus();
console.log('before pressing "Lägg till fil":',await d());
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
console.log('during (t+120ms):',await d(),'inert=',await page.evaluate(()=>document.querySelector('.workspace').hasAttribute('inert')));
await page.waitForTimeout(1600);
console.log('after write done:',await d(),'inert=',await page.evaluate(()=>document.querySelector('.workspace').hasAttribute('inert')));
console.log('transitions:',JSON.stringify(await page.evaluate(()=>window.__t)));
// screen-reader relevant: does an aria-live region announce the write?
console.log('save-state text:',await page.locator('.save-state').innerText());
await b.close();
