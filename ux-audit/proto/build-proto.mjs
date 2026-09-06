import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = new URL('./', import.meta.url).pathname;
const pubCss = execSync('git show origin/gh-pages:assets/index-B_pd65IR.css', { cwd: '/home/user/Coding-Tool', maxBuffer: 1e8 }).toString();
const fix = readFileSync(OUT + 'diff-fix.css', 'utf8');

// Two cases: the dialog exactly as observed (one mapping), and a generated one with several
// mappings against a base version that already holds placeholders.
const { html: RICH } = await import('./scenario.mjs');
const CASES = { enkel: readFileSync(OUT + 'dialog.html', 'utf8'), flera: RICH };

const page = (css, dom) => `<!doctype html><meta charset="utf-8">
<style>${pubCss}\n${css}</style>
<body style="margin:0;background:#f3f6f9">${dom}</body>`;

for (const [c, dom] of Object.entries(CASES)) {
  writeFileSync(`${OUT}before-${c}.html`, page('', dom));
  writeFileSync(`${OUT}after-${c}.html`, page(fix, dom));
}

const b = await chromium.launch();
const runs = [];
for (const c of Object.keys(CASES)) for (const w of [390, 768]) for (const v of ['before', 'after']) runs.push([`${v}-${c}`, w, v]);
for (const [name, w, v] of runs) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1400 } });
  const p = await ctx.newPage();
  await p.goto('file://' + OUT + name + '.html');
  await p.waitForTimeout(300);
  // open the collapsed sections in the "after" page so both show the same content
  if (v === 'after') { await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(200); }
  const d = await p.evaluate(() => {
    const dlg = document.querySelector('dialog');
    const lay = document.querySelector('.reconciliation-layout');
    return { dialogW: Math.round(dlg.clientWidth), dialogScrollW: Math.round(dlg.scrollWidth),
             sidled: dlg.scrollWidth > dlg.clientWidth + 1,
             överskott: Math.round(dlg.scrollWidth - dlg.clientWidth),
             layoutW: Math.round(lay.scrollWidth), höjd: Math.round(dlg.getBoundingClientRect().height),
             lodrät: [...document.querySelectorAll('.version-diff')].filter(x => x.scrollHeight > x.clientHeight + 1).length };
  });
  console.log(`${name.padEnd(14)} @${w}: dialog ${d.dialogW}px, innehåll ${d.dialogScrollW}px -> sidled: ${d.sidled ? 'JA (+' + d.överskott + 'px)' : 'nej '} · höjd ${String(d.höjd).padStart(4)}px · rutor som rullar lodrätt: ${d.lodrät}`);
  await p.locator('dialog').screenshot({ path: `${OUT}proto-${name}--${w}.png` });
  await ctx.close();
}
await b.close();
