import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4173/';
const TAGS=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
const out=[];
const browser=await chromium.launch();
async function scan(page,label){
  const r=await new AxeBuilder({page}).withTags(TAGS).exclude('.monaco-editor').analyze();
  out.push({label,violations:r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,help:v.help,
    nodes:v.nodes.slice(0,4).map(n=>({target:n.target.join(' '),summary:(n.failureSummary||'').replace(/\s+/g,' ').slice(0,300)}))}))});
  console.log(`[${label}] ${r.violations.map(v=>`${v.id}(${v.nodes.length})`).join(', ')||'none'}`);
}
for (const theme of ['light','dark']) {
 for (const width of [1440, 390]) {
  const ctx=await browser.newContext({viewport:{width,height:width<500?844:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
  await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
  const page=await ctx.newPage();
  const tag=`${theme}/${width}`;
  await page.goto(BASE,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
  const c=page.locator('dialog[open] .dialog-head button'); if(await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  await page.locator('.editor-body').click();
  await page.keyboard.type('$adminPassword = "Hunter2!"\n$host = "sql01.corp.local"\n',{delay:2});
  await page.waitForTimeout(2500);
  await scan(page,`${tag} workspace+findings`);

  // copy dialog AI
  await page.locator('button.ai-copy').click(); await page.waitForTimeout(700);
  if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} copy dialog AI`); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  // copy dialog Local
  await page.locator('.copy-actions button', {hasText:'Copy Local'}).click(); await page.waitForTimeout(700);
  if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} copy dialog Local`); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  // ingest dialog
  const ing = page.locator('.copy-actions button', {hasText:'Klistra in'});
  if (await ing.count() && await ing.first().isEnabled()) { await ing.first().click(); await page.waitForTimeout(600);
    if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} ingest dialog`); await page.keyboard.press('Escape'); await page.waitForTimeout(400);} }
  // save version dialog
  const sv = page.locator('.heading-actions button', {hasText:'Spara version'});
  if (await sv.count() && await sv.first().isEnabled()) { await sv.first().click(); await page.waitForTimeout(600);
    if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} save-version dialog`); await page.keyboard.press('Escape'); await page.waitForTimeout(500);} }
  // project drawer (Ctrl+P)
  await page.keyboard.press('Control+p'); await page.waitForTimeout(700);
  if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} project drawer`); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  // confirm delete project
  const del = page.locator('.heading-actions button', {hasText:'Radera projekt'});
  if (await del.count() && await del.first().isEnabled()) { await del.first().click(); await page.waitForTimeout(600);
    if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} confirm delete project`); await page.keyboard.press('Escape'); await page.waitForTimeout(500);} }
  // project details
  const om = page.locator('.heading-actions button', {hasText:'Om projektet'});
  if (await om.count() && await om.first().isEnabled()) { await om.first().click(); await page.waitForTimeout(600);
    if (await page.locator('dialog[open]').count()) { await scan(page,`${tag} project details`); await page.keyboard.press('Escape'); await page.waitForTimeout(400);} }
  // settings full (with storage info expanded)
  await page.goto(BASE+'#/settings'); await page.waitForTimeout(1200);
  for (const b of await page.locator('details summary').all()) { await b.click().catch(()=>{}); }
  await page.waitForTimeout(600);
  await scan(page,`${tag} settings expanded`);
  await ctx.close();
 }
}
writeFileSync(new URL('./axe-states.json',import.meta.url),JSON.stringify(out,null,1));
await browser.close();
const all=new Map();
for(const r of out) for(const v of r.violations){const e=all.get(v.id)??{id:v.id,impact:v.impact,help:v.help,where:[],nodes:[]};e.where.push(`${r.label} x${v.n}`);e.nodes.push(...v.nodes);all.set(v.id,e);}
console.log('\n===== SUMMARY (states) =====');
if(!all.size)console.log('none');
for(const e of all.values()){console.log(`\n## ${e.id} [${e.impact}] ${e.help}`);console.log('  states: '+e.where.join(' | '));
  const seen=new Set(); for(const n of e.nodes){ if(seen.has(n.target))continue; seen.add(n.target); console.log('   - '+n.target+' :: '+n.summary);} }
