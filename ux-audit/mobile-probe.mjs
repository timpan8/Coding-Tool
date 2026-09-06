import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
for(const theme of ['light','dark']){
const ctx=await b.newContext({viewport:{width:390,height:844},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
const ta=page.locator('textarea.plain-editor');
console.log('\n#### '+theme+' @390  plain-editor present:',await ta.count());
if(await ta.count()){
 await ta.focus();await page.waitForTimeout(200);
 console.log(' computed on focus:',await page.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);
   return {tag:e.tagName,cls:String(e.className),outline:cs.outlineWidth+' '+cs.outlineStyle+' '+cs.outlineColor,boxShadow:cs.boxShadow,border:cs.borderTopWidth+' '+cs.borderTopColor,bg:cs.backgroundColor};}));
 await ta.type('$a = "x"',{delay:10});await page.waitForTimeout(1200);
 // does Tab escape the textarea?
 await page.keyboard.press('Tab');await page.waitForTimeout(200);
 console.log(' Tab from plain editor ->',await page.evaluate(()=>document.activeElement.tagName+' "'+(document.activeElement.getAttribute('aria-label')||document.activeElement.textContent||'').trim().slice(0,24)+'"'));
 // "?" in the plain editor
 await ta.focus(); await page.keyboard.press('End'); await page.keyboard.type('?',{delay:20}); await page.waitForTimeout(500);
 console.log(' "?" in plain editor -> dialog:',await page.locator('dialog[open]').count(),' value ends:',JSON.stringify((await ta.inputValue()).slice(-6)));
}
await ctx.close();
}
await b.close();
