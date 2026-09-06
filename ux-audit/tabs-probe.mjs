import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
for(const theme of ['light','dark']){
const ctx=await b.newContext({viewport:{width:1440,height:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(500);
await page.locator('.editor-body').click();await page.keyboard.insertText('$a = "x"\n');await page.waitForTimeout(2000);
console.log('\n#### '+theme.toUpperCase());
console.log('tabs:',JSON.stringify(await page.evaluate(()=>{
 const px=s=>{const m=/rgba?\(([^)]+)\)/.exec(s);const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
 const over=(f,g)=>({r:f.r*f.a+g.r*(1-f.a),g:f.g*f.a+g.g*(1-f.a),b:f.b*f.a+g.b*(1-f.a),a:1});
 const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
 const cr=(a,g)=>{const[x,y]=[lum(a),lum(g)].sort((p,q)=>q-p);return +((x+.05)/(y+.05)).toFixed(2)};
 const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
 const list=document.querySelector('.view-tabs');
 const strip=px(getComputedStyle(list).backgroundColor);
 const parentBg=px(getComputedStyle(list.parentElement.parentElement).backgroundColor);
 const stripOn=over(strip,parentBg);
 const out=[...list.querySelectorAll('button')].map(bt=>{const cs=getComputedStyle(bt);
   const own=px(cs.backgroundColor);const eff=own.a>0?over(own,stripOn):stripOn;
   return {text:bt.textContent.trim(),selected:bt.getAttribute('aria-selected'),tabindex:bt.tabIndex,
    role:bt.getAttribute('role'),controls:bt.getAttribute('aria-controls'),id:bt.id,
    bg:hex(eff),color:hex(over(px(cs.color),eff)),_bg:eff,_c:over(px(cs.color),eff),shadow:cs.boxShadow.slice(0,40)};});
 const sel=out.find(o=>o.selected==='true'),other=out.find(o=>o.selected!=='true');
 return {strip:hex(stripOn),tabs:out.map(({_bg,_c,...r})=>r),selectedVsUnselectedBg:cr(sel._bg,other._bg),
   selTextVsBg:cr(sel._c,sel._bg), unselTextVsBg:cr(other._c,other._bg),
   selTextVsUnselText:cr(sel._c,other._c),
   panel:(()=>{const p=document.getElementById('kodvy');return{role:p.getAttribute('role'),labelledby:p.getAttribute('aria-labelledby'),tabindex:p.tabIndex};})()};
}),null,1));
// arrow key support
await page.locator('.view-tabs button').first().focus();
const d=()=>page.evaluate(()=>document.activeElement.textContent.trim()+' sel='+document.activeElement.getAttribute('aria-selected'));
console.log(' focus tab1:',await d());
await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);
console.log(' after ArrowRight:',await d());
await page.keyboard.press('End');await page.waitForTimeout(300);
console.log(' after End:',await d());
await page.keyboard.press('Tab');await page.waitForTimeout(200);
console.log(' after Tab from tab1:',await page.evaluate(()=>document.activeElement.textContent.trim().slice(0,25)));
await ctx.close();
}
await b.close();
