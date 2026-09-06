import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const OUT=new URL('./screens/',import.meta.url).pathname;
const b=await chromium.launch();
for(const theme of ['light','dark']){
 const ctx=await b.newContext({viewport:{width:1440,height:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
 await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
 const page=await ctx.newPage();
 await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
 await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
 await page.locator('.editor-body').click();await page.keyboard.insertText('$a = "x"\n$b = "y"\n');await page.waitForTimeout(2200);
 // focus a set of controls and record outline + clipping
 const targets=[['.heading-actions button.primary','Spara version'],['.top-navigation button:nth-child(1)','nav Ny kod'],
   ['.view-tabs button:nth-child(2)','tab Local'],['.copy-actions button.ai-copy','Copy for AI'],
   ['.editor-tools button:nth-child(1)','A-'],['.binding-panel .text-button','+ Ny'],['select[aria-label="Språk"]','Språk'],
   ['.file-tabs button','file tab'],['a.skip-link','skip link']];
 console.log('\n#### '+theme.toUpperCase());
 for(const [sel,name] of targets){
  const loc=page.locator(sel).first();
  if(!await loc.count()){console.log('  (missing) '+name);continue;}
  await loc.focus().catch(()=>{});
  await page.waitForTimeout(150);
  const info=await page.evaluate(()=>{
   const e=document.activeElement;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
   // find clipping ancestors
   let clip=[],n=e.parentElement;
   while(n&&n!==document.documentElement){const c=getComputedStyle(n);
     if(/hidden|auto|scroll/.test(c.overflow+c.overflowX+c.overflowY)){const nr=n.getBoundingClientRect();
       clip.push({cls:String(n.className).slice(0,24),ov:c.overflow||c.overflowX+'/'+c.overflowY,
        clipsRing: r.top-5<nr.top-0.5||r.bottom+5>nr.bottom+0.5||r.left-5<nr.left-0.5||r.right+5>nr.right+0.5});}
     n=n.parentElement;}
   return {outline:cs.outlineWidth+' '+cs.outlineStyle+' '+cs.outlineColor,offset:cs.outlineOffset,shadow:cs.boxShadow.slice(0,40),
     clipped:clip.filter(c=>c.clipsRing).slice(0,2), inView:r.top>=0&&r.bottom<=innerHeight};
  });
  console.log(`  ${name.padEnd(14)} outline=${info.outline} offset=${info.offset} clippedBy=${JSON.stringify(info.clipped)}`);
 }
 // screenshot with focus on a primary button + a nav button for visual evidence
 await page.locator('.heading-actions button.primary').first().focus();
 await page.locator('.project-heading').screenshot({path:`${OUT}zz-focus-primary-${theme}--1440.png`});
 await page.locator('.top-navigation button').first().focus();
 await page.locator('header.topbar').screenshot({path:`${OUT}zz-focus-nav-${theme}--1440.png`});
 await ctx.close();
}
await b.close();
console.log('\nscreens written: zz-focus-*');
