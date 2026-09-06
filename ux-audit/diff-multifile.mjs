import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:4173/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const c = p.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await p.waitForTimeout(400);

// file 1 with content, save v1
await p.locator('.editor-body').click();
await p.keyboard.insertText('$a = "ett"\n$b = "tva"\n'); await p.waitForTimeout(1500);
await p.keyboard.press('Control+s'); await p.waitForTimeout(800);
let f = p.locator('dialog[open] input[aria-label="Versionsetikett"]');
if (await f.count()) { await f.fill('Bara fil 1'); await p.locator('dialog[open] .dialog-actions button.primary').click(); await p.waitForTimeout(1500); }

// add a SECOND file, put different content in it
await p.locator('button.file-add, .file-tabs button[aria-label="Lägg till fil"]').first().click();
await p.waitForTimeout(1200);
await p.locator('.editor-body').click();
await p.keyboard.insertText('# helt annan fil\nWrite-Host "fil tva"\n'); await p.waitForTimeout(1600);

const state = await p.evaluate(() => ({
  flikar: [...document.querySelectorAll('.file-tabs button')].map(x => x.textContent.trim()).slice(0, 4),
}));
console.log('flikar:', JSON.stringify(state));

// now view v1 (which only ever contained file 1) while file 2 is active
const item = p.locator('.version-item > button:first-child').first();
await item.click({ force: true }); await p.waitForTimeout(600);
const show = p.locator('.version-actions button', { hasText: 'Visa' }).first();
if (await show.count() && await show.isVisible()) {
  await show.click(); await p.waitForTimeout(1800);
  const r = await p.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const ta = d?.querySelector('textarea.plain-editor');
    const text = ta ? ta.value : (d?.querySelector('.view-lines')?.innerText ?? '');
    return {
      innehall: text.trim().split('\n')[0] ?? '(tomt)',
      tecken: text.length,
      filnamn: d?.querySelector('.version-file-name')?.textContent ?? d?.querySelector('.version-file-pick select')?.value ?? '',
      valjare: d?.querySelectorAll('.version-file-pick option').length ?? 0,
      notiser: [...(d?.querySelectorAll('.notice') ?? [])].map(n => n.textContent.trim()),
      delta: d?.querySelector('.version-delta')?.textContent.trim() ?? '',
    };
  });
  console.log('VISA v1 medan fil 2 är aktiv:');
  console.log('  innehåll :', JSON.stringify(r.innehall), '(' + r.tecken + ' tecken)');
  console.log('  filväljare:', r.valjare, 'alternativ · delta:', JSON.stringify(r.delta));
  console.log('  notiser  :', JSON.stringify(r.notiser));
  await p.screenshot({ path: `${OUT}42-diff-wrong-file--1440.png` });
}
await b.close();
