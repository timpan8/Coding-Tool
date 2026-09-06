import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900},colorScheme:'dark'})).newPage();
await p.goto(BASE,{waitUntil:'networkidle'}); await p.waitForTimeout(1200);
const c=p.locator('dialog[open] .dialog-head button'); if(await c.count()) await c.first().click();
await p.waitForTimeout(400);
// make a project so both buttons exist
await p.locator('.editor-body').click(); await p.keyboard.insertText('$a = "x"\n'); await p.waitForTimeout(1500);
await p.goto(BASE+'#/'); await p.waitForTimeout(1200);
const r = await p.evaluate(()=>{
  const px=(c)=>c.replace(/[^\d.,]/g,'').split(',').map(Number);
  const lum=(rgb)=>{const [r,g,bl]=rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*bl;};
  const blend=(fg,bg,a)=>fg.map((v,i)=>a*v+(1-a)*bg[i]);
  const pageBg=px(getComputedStyle(document.body).backgroundColor);
  const out=[];
  for(const el of document.querySelectorAll('.heading-actions button, .editor-toolbar button, .top-navigation button')){
    const cs=getComputedStyle(el); const a=parseFloat(cs.opacity);
    const fg=blend(px(cs.color).slice(0,3), pageBg, a);
    let bgc=px(cs.backgroundColor); if(cs.backgroundColor==='rgba(0, 0, 0, 0)') bgc=pageBg;
    const bg=blend(bgc.slice(0,3), pageBg, a);
    const L1=lum(fg),L2=lum(bg);
    out.push({txt:el.textContent.trim().slice(0,32), cls:el.className, disabled:el.disabled, opacity:a,
      color:cs.color, bgColor:cs.backgroundColor, borderColor:cs.borderColor,
      contrast:+(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)).toFixed(2)),
      vsPage:+(((Math.max(L2,lum(pageBg))+0.05)/(Math.min(L2,lum(pageBg))+0.05)).toFixed(2))});
  }
  return {pageBg, out};
});
console.log(JSON.stringify(r,null,1));
await b.close();
