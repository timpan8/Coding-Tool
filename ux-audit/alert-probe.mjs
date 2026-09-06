import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(500);
await page.locator('.editor-body').click();
await page.keyboard.type('$key = {{MISSING_ONE}}\n',{delay:5});
await page.waitForTimeout(2500);
console.log('issue-panel present:', await page.locator('.issue-panel').count());
console.log('issue-panel html:', (await page.locator('.issue-panel').innerText().catch(()=>'-')).replace(/\n/g,' | '));
await page.evaluate(()=>{
  window.__a=[];
  const n=document.querySelector('.issue-panel');
  if(!n) return;
  new MutationObserver(m=>{window.__a.push({n:m.length,text:(n.textContent||'').replace(/\s+/g,' ').slice(0,70)});}).observe(n,{childList:true,subtree:true,characterData:true,attributes:true});
});
// keep typing on new lines -> the issue line number stays, but new placeholder added
await page.keyboard.type('\n$b = {{SECOND_ONE}}\n$c = 1\n$d = 2\n',{delay:40});
await page.waitForTimeout(2500);
const a=await page.evaluate(()=>window.__a);
console.log('\nmutations inside role="alert" .issue-panel while typing 40 chars:', a.length);
for(const e of a.slice(0,10)) console.log('   -> '+e.text);
console.log('...');
for(const e of a.slice(-4)) console.log('   -> '+e.text);
// insert a newline ABOVE to shift line numbers
await page.keyboard.press('Control+Home');
await page.evaluate(()=>window.__a.length=0);
await page.keyboard.type('# header\n',{delay:40});
await page.waitForTimeout(2000);
const a2=await page.evaluate(()=>window.__a);
console.log('\nmutations after inserting one line at the top (shifts all line numbers):',a2.length);
for(const e of a2.slice(-4)) console.log('   -> '+e.text);
await b.close();
