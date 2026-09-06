import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173';
const CODE=`# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
$awsKey = "AKIAIOSFODNN7EXAMPLE"
$token = "ghp_16C7e42F292c6912E7710c838347Ae178B4a"
$dbHost = "sql-prod-01.internal.example.com"
$path = "C:\\Users\\tim\\Export"
$unc = "\\\\fileserver\\share\\rapport"
$mail = "tim.andersson@example.com"
`;
const rec=(n,d)=>{console.log('\n### '+n);console.log(JSON.stringify(d,null,1));};
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
await page.goto(BASE+'/#/');
await page.waitForSelector('.editor-body');
for(let i=0;i<40;i++){if(await page.locator('dialog[open]').count()){await page.locator('dialog[open] .dialog-head button').first().click({force:true});await page.waitForTimeout(200);}else await page.waitForTimeout(150);if(i>6&&!(await page.locator('dialog[open]').count()))break;}
await page.locator('.editor-body').click();
await page.keyboard.insertText(CODE);
await page.waitForTimeout(2000);
await page.locator('.ai-copy').click();
await page.waitForTimeout(900);
const r=await page.evaluate(()=>{
  const d=document.querySelector('dialog[open]');
  const head=d.querySelector('.dialog-head');
  const act=d.querySelector('.dialog-actions');
  const hb=d.querySelector('.dialog-head button').getBoundingClientRect();
  return {
    scrollTop:d.scrollTop, scrollH:d.scrollHeight, clientH:d.clientHeight,
    headlineVisible: head.getBoundingClientRect().top >= d.getBoundingClientRect().top - 1,
    firstParagraph: d.querySelector('p b')?.textContent,
    firstParagraphTop: Math.round(d.querySelector('p b').getBoundingClientRect().top),
    dialogTop: Math.round(d.getBoundingClientRect().top),
    actionsTop: Math.round(act.getBoundingClientRect().top),
    actionsVisible: act.getBoundingClientRect().bottom <= window.innerHeight,
    closeBtn: {w:Math.round(hb.width),h:Math.round(hb.height)},
    focused: document.activeElement?.tagName,
  };
});
rec('Q. AI copy dialog at 390px with many findings — scroll position on open', r);
// notice close button size
await page.locator('dialog[open] .dialog-head button').click();
await page.waitForTimeout(300);
await page.keyboard.press('Control+Shift+Enter');
await page.waitForTimeout(600);
const n=await page.evaluate(()=>{
  const el=document.querySelector('.inline-notice button')||document.querySelector('dialog[open] .dialog-head button');
  const r=el?.getBoundingClientRect();
  return r?{w:Math.round(r.width),h:Math.round(r.height),ctx:el.closest('.inline-notice')?'notice':'dialog'}:null;
});
rec('Q2. close-button sizes', n);
await b.close();
