import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = new URL('./', import.meta.url).pathname;
const pubCss = execSync('git show origin/gh-pages:assets/index-B_pd65IR.css', { cwd: '/home/user/Coding-Tool', maxBuffer: 1e8 }).toString();
const fix = readFileSync(OUT + 'diff-fix.css', 'utf8');

// The dialog exactly as it renders today, taken from the running app.
const DOM = readFileSync(OUT + 'dialog.html', 'utf8');

const page = (css, title) => `<!doctype html><meta charset="utf-8">
<style>${pubCss}\n${css}</style>
<body style="margin:0;background:#f3f6f9">
<div style="padding:10px 0 4px;font:600 12px system-ui;color:#333">${title}</div>
${DOM}
</body>`;

writeFileSync(OUT + 'before.html', page('', 'FÖRE'));
writeFileSync(OUT + 'after.html', page(fix, 'EFTER'));

const b = await chromium.launch();
for (const [name, w] of [['before', 390], ['after', 390], ['before', 768], ['after', 768]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1400 } });
  const p = await ctx.newPage();
  await p.goto('file://' + OUT + name + '.html');
  await p.waitForTimeout(300);
  // open the collapsed sections in the "after" page so both show the same content
  if (name === 'after') { await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(200); }
  const d = await p.evaluate(() => {
    const dlg = document.querySelector('dialog');
    const lay = document.querySelector('.reconciliation-layout');
    return { dialogW: Math.round(dlg.clientWidth), dialogScrollW: Math.round(dlg.scrollWidth),
             sidled: dlg.scrollWidth > dlg.clientWidth + 1,
             överskott: Math.round(dlg.scrollWidth - dlg.clientWidth),
             layoutW: Math.round(lay.scrollWidth), höjd: Math.round(dlg.getBoundingClientRect().height) };
  });
  console.log(`${name.padEnd(6)} @${w}: dialog ${d.dialogW}px, innehåll ${d.dialogScrollW}px -> sidled-rullning: ${d.sidled ? 'JA (+' + d.överskott + 'px)' : 'nej'} · höjd ${d.höjd}px`);
  await p.locator('dialog').screenshot({ path: `${OUT}proto-${name}--${w}.png` });
  await ctx.close();
}
await b.close();
