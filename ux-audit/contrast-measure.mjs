import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4173/';

const MEASURE = () => {
  const px = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if(!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
  const over = (fg,bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a:1 });
  const lum = c => { const f = v => { v/=255; return v<=0.03928? v/12.92 : ((v+0.055)/1.055)**2.4; };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
  const hex = c => '#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');

  // effective background behind an element: walk ancestors compositing bg colors, applying each
  // ancestor's own opacity multiplier is skipped (rare); returns opaque color
  function bgOf(el){
    let acc = null;
    let n = el;
    while (n) {
      const cs = getComputedStyle(n);
      const c = px(cs.backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
      n = n.parentElement;
    }
    const body = px(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
    return acc ? over(acc, body) : body;
  }
  // effective foreground: color composited over background, multiplied by inherited opacity chain
  function fgOf(el, bg){
    const cs = getComputedStyle(el);
    let c = px(cs.color) || {r:0,g:0,b:0,a:1};
    let o = 1, n = el;
    while (n && n !== document.documentElement) { const v = parseFloat(getComputedStyle(n).opacity); if(!isNaN(v)) o*=v; n = n.parentElement; }
    return over({...c, a: c.a*o}, bg);
  }
  const visible = el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0 && r.height>0 && !el.closest('[hidden]') && !el.closest('.monaco-editor'); };

  const hasOwnText = el => [...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim().length);

  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    if (!hasOwnText(el)) continue;
    const cs = getComputedStyle(el);
    const bg = bgOf(el);
    const fg = fgOf(el, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg,bg);
    rows.push({ sel: el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):''),
      text: (el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40),
      fg: hex(fg), bg: hex(bg), size, weight, large, need, ratio: +r.toFixed(2), pass: r >= need - 0.005,
      disabled: el.matches(':disabled') || Boolean(el.closest('[disabled]')), opacity: cs.opacity });
  }

  // placeholders
  const ph = [];
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!visible(el)) continue;
    // ::placeholder colour is not readable via getComputedStyle pseudo in all engines; try it
    const cs = getComputedStyle(el, '::placeholder');
    const bg = bgOf(el);
    const c = px(cs.color);
    if (!c) { ph.push({sel: el.className, note:'placeholder colour unreadable'}); continue; }
    const fg = over({...c}, bg);
    ph.push({ sel: (el.className||el.name||'input'), placeholder: el.placeholder.slice(0,40), fg: hex(fg), bg: hex(bg),
      size: parseFloat(cs.fontSize||getComputedStyle(el).fontSize), ratio: +ratio(fg,bg).toFixed(2) });
  }

  // non-text: borders of inputs/buttons vs surrounding bg, focus ring
  const nonText = [];
  for (const el of document.querySelectorAll('input, select, textarea, button, .chip, .tag, .pill')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const bw = parseFloat(cs.borderTopWidth);
    if (!bw) continue;
    const bc = px(cs.borderTopColor); if (!bc || bc.a===0) continue;
    const outside = bgOf(el.parentElement || document.body);
    const inside = bgOf(el);
    const b = over(bc, outside);
    nonText.push({ sel: el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className.trim().split(/\s+/).join('.'):''),
      label: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,26),
      border: hex(b), outside: hex(outside), inside: hex(inside),
      vsOutside: +ratio(b,outside).toFixed(2), vsInside: +ratio(b,inside).toFixed(2), disabled: el.matches(':disabled') });
  }
  const ring = getComputedStyle(document.documentElement).getPropertyValue('--focus-ring').trim();
  return { rows, ph, nonText, ring, bodyBg: hex(bgOf(document.body)) };
};

const browser = await chromium.launch();
const out = {};
for (const theme of ['light','dark']) {
  const ctx = await browser.newContext({viewport:{width:1440,height:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
  await ctx.addInitScript(t=>{try{localStorage.setItem('acv:theme',t)}catch{}},theme);
  const page = await ctx.newPage();
  await page.goto(BASE,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
  out[theme] = {};
  out[theme]['intro'] = await page.evaluate(MEASURE);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(500);
  await page.locator('.editor-body').click();
  await page.keyboard.type('$adminPassword = "Hunter2!"\n$host = "sql01.corp.local"\n$apiKey = "sk-live-abc"\n',{delay:2});
  await page.waitForTimeout(2600);
  out[theme]['workspace'] = await page.evaluate(MEASURE);
  // local view + ai view
  for (const [tab,key] of [['Local','view-local'],['AI','view-ai']]) {
    const b = page.locator('.view-tabs button', {hasText:new RegExp('^'+tab)});
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(800); out[theme][key] = await page.evaluate(MEASURE); }
  }
  await page.locator('.view-tabs button').first().click(); await page.waitForTimeout(400);
  // copy dialog
  await page.locator('button.ai-copy').click(); await page.waitForTimeout(800);
  out[theme]['copy-dialog'] = await page.evaluate(MEASURE);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // confirm delete
  const del = page.locator('.heading-actions button', {hasText:'Radera projekt'});
  if (await del.count()) { await del.first().click(); await page.waitForTimeout(700); out[theme]['confirm-delete'] = await page.evaluate(MEASURE); await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  for (const r of ['#/projects','#/bindings','#/settings','#/security']) {
    await page.goto(BASE+r); await page.waitForTimeout(1100);
    out[theme][r] = await page.evaluate(MEASURE);
  }
  await ctx.close();
}
writeFileSync(new URL('./contrast-results.json',import.meta.url), JSON.stringify(out,null,1));
await browser.close();

// report
for (const theme of ['light','dark']) {
  console.log(`\n############ ${theme.toUpperCase()} ############`);
  const seen = new Set();
  const fails = [];
  for (const [state,d] of Object.entries(out[theme])) {
    for (const r of d.rows) { if (r.pass) continue; const k = r.sel+'|'+r.fg+'|'+r.bg; if (seen.has(k)) continue; seen.add(k); fails.push({state,...r}); }
  }
  fails.sort((a,b)=>a.ratio-b.ratio);
  console.log(`--- TEXT below threshold (${fails.length}) ---`);
  for (const f of fails) console.log(`  ${f.ratio}:1 (need ${f.need}) ${f.size}px/${f.weight}${f.disabled?' DISABLED':''} fg ${f.fg} on ${f.bg}  ${f.sel}  "${f.text}"  [${f.state}]`);
  // placeholders
  const phs = new Set();
  console.log('--- PLACEHOLDERS ---');
  for (const [state,d] of Object.entries(out[theme])) for (const p of d.ph) { const k=JSON.stringify(p); if(phs.has(k))continue; phs.add(k);
    console.log(`  ${p.ratio}:1 ${p.size}px fg ${p.fg} on ${p.bg}  ${p.sel}  "${p.placeholder}" [${state}]`); }
  // borders
  console.log('--- CONTROL BORDERS < 3:1 vs outside ---');
  const bs = new Set();
  for (const [state,d] of Object.entries(out[theme])) for (const n of d.nonText) { if (n.vsOutside>=3) continue; const k=n.sel+n.border+n.outside; if(bs.has(k))continue; bs.add(k);
    console.log(`  ${n.vsOutside}:1 border ${n.border} on ${n.outside} ${n.disabled?'DISABLED ':''} ${n.sel} "${n.label}" [${state}]`); }
  console.log('focus-ring token:', out[theme].workspace.ring, ' body bg:', out[theme].workspace.bodyBg);
}
