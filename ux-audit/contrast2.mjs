import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const SAMPLE=`$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
`;
const M=()=>{
 const px=s=>{const m=/rgba?\(([^)]+)\)/.exec(s);if(!m)return null;const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
 const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
 const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
 const ratio=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
 const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
 const bgOf=el=>{let acc=null,n=el;while(n){const c=px(getComputedStyle(n).backgroundColor);if(c&&c.a>0){acc=acc?over(acc,c):c;if(acc.a>=.999)return acc;}n=n.parentElement;}
   const b=px(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1};return acc?over(acc,b):b;};
 const fgOf=(el,bg)=>{const cs=getComputedStyle(el);let c=px(cs.color)||{r:0,g:0,b:0,a:1};let o=1,n=el;
   while(n&&n!==document.documentElement){const v=parseFloat(getComputedStyle(n).opacity);if(!isNaN(v))o*=v;n=n.parentElement;}
   return over({...c,a:c.a*o},bg);};
 const vis=el=>{const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0&&!el.closest('[hidden]')&&!el.closest('.monaco-editor');};
 const own=el=>[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length);
 const rows=[];
 for(const el of document.querySelectorAll('body *')){ if(!vis(el)||!own(el))continue;
  const cs=getComputedStyle(el),bg=bgOf(el),fg=fgOf(el,bg),size=parseFloat(cs.fontSize),w=parseInt(cs.fontWeight)||400;
  const large=size>=24||(size>=18.66&&w>=700),need=large?3:4.5,r=ratio(fg,bg);
  rows.push({sel:el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\s+/).join('.'):''),
   text:(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,34),fg:hex(fg),bg:hex(bg),size,weight:w,need,ratio:+r.toFixed(2),
   pass:r>=need-0.005,disabled:el.matches(':disabled')||!!el.closest('[disabled]')}); }
 return rows;
};
const b=await chromium.launch();
for(const theme of ['light','dark']){
 const ctx=await b.newContext({viewport:{width:1440,height:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
 await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
 const page=await ctx.newPage();
 await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
 await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
 await page.locator('.editor-body').click();await page.keyboard.insertText(SAMPLE);await page.waitForTimeout(2200);
 // create a binding from the first finding
 for(let i=0;i<3;i++){
  const mk=page.locator('.finding-actions button',{hasText:'Skapa binding'}).first();
  if(!await mk.count())break;
  await mk.click();await page.waitForTimeout(900);
  const save=page.locator('dialog[open] .dialog-actions button.primary');
  if(await save.count()){await save.click();await page.waitForTimeout(1200);} else break;
 }
 await page.waitForTimeout(1500);
 const states={};
 states['workspace+bindings']=await page.evaluate(M);
 // local view (shows values), ai view
 for(const [tab,k] of [['Local','local'],['AI','ai']]){const t2=page.locator('.view-tabs button',{hasText:new RegExp('^'+tab)});
  if(await t2.count()){await t2.first().click();await page.waitForTimeout(900);states['view-'+k]=await page.evaluate(M);}}
 await page.locator('.view-tabs button').first().click();await page.waitForTimeout(400);
 for(const r of ['#/bindings','#/projects']){await page.goto(BASE+r);await page.waitForTimeout(1300);states[r]=await page.evaluate(M);}
 const seen=new Set(),fails=[];
 for(const [s,rows] of Object.entries(states))for(const r of rows){if(r.pass)continue;const k=r.sel+r.fg+r.bg;if(seen.has(k))continue;seen.add(k);fails.push({s,...r});}
 fails.sort((a,c)=>a.ratio-c.ratio);
 console.log(`\n######## ${theme.toUpperCase()} (bindings created) — ${fails.length} below threshold`);
 for(const f of fails)console.log(`  ${String(f.ratio).padStart(5)}:1 need ${f.need} ${f.size}px/${f.weight}${f.disabled?' DISABLED':''}  ${f.fg} on ${f.bg}  ${f.sel}  "${f.text}" [${f.s}]`);
 // report specific classes even if passing
 console.log('  -- named classes --');
 const want=/binding-example|binding-value|eyebrow|muted|count|severity|tag|chip|pill|copy-blocked|finding-excerpt|save-state|view-banner|intro-step|kbd/;
 const shown=new Set();
 for(const [s,rows] of Object.entries(states))for(const r of rows){ if(!want.test(r.sel))continue; const k=r.sel+r.fg+r.bg; if(shown.has(k))continue; shown.add(k);
   console.log(`   ${r.pass?'ok  ':'FAIL'} ${String(r.ratio).padStart(5)}:1 (need ${r.need}) ${r.size}px ${r.fg} on ${r.bg}  ${r.sel} "${r.text}"`); }
 await ctx.close();
}
await b.close();
