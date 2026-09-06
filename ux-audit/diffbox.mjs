import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:4173/';

const V1 = `$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
Connect-Database -User $adminUser -Password $adminPassword -Server $dbHost
Write-Host "Klar"
`;
// v2: two lines changed, one added, one removed
const V2 = `$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-02.internal.example.com"
$timeout = 30
Connect-Database -User $adminUser -Password $adminPassword -Server $dbHost -Timeout $timeout
`;

async function saveVersion(page, label) {
  await page.keyboard.press('Control+s'); await page.waitForTimeout(800);
  const f = page.locator('dialog[open] input[aria-label="Versionsetikett"]');
  if (await f.count()) { await f.fill(label); await page.locator('dialog[open] .dialog-actions button.primary').click(); await page.waitForTimeout(1500); }
}

const browser = await chromium.launch();
for (const [w, h, dark] of [[1440, 900, false], [768, 1024, false], [390, 844, false], [1440, 900, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(400);
  if (dark) { await page.locator('select[aria-label="Tema"]').selectOption('dark'); await page.waitForTimeout(700); }

  await page.locator('.editor-body').click();
  await page.keyboard.insertText(V1); await page.waitForTimeout(1500);
  await saveVersion(page, 'Innan omskrivningen');
  // replace the whole text with v2
  await page.locator('.editor-body').click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  await page.keyboard.insertText(V2); await page.waitForTimeout(1500);
  await saveVersion(page, 'Ny databas och timeout');

  const tag = `${w}${dark ? '-dark' : ''}`;
  // --- open the version accordion, then "Jämför"
  const item = page.locator('.version-item > button:first-child').first();
  await item.click({ force: true }); await page.waitForTimeout(600);
  const cmp = page.locator('.version-actions button', { hasText: 'Jämför' }).first();
  const cmpVisible = await cmp.count() ? await cmp.isVisible() : false;
  if (cmpVisible) {
    await cmp.click(); await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}40-diff-compare--${tag}.png` });
    const info = await page.evaluate(() => {
      const d = document.querySelector('dialog[open]'); const v = document.querySelector('.version-view');
      const de = document.querySelector('.diff-editor');
      const panes = document.querySelectorAll('.monaco-diff-editor .editor.original, .monaco-diff-editor .editor.modified');
      return {
        dialogW: Math.round(d?.getBoundingClientRect().width ?? 0),
        viewH: Math.round(v?.getBoundingClientRect().height ?? 0),
        diffW: Math.round(de?.getBoundingClientRect().width ?? 0),
        paneWidths: [...panes].map(p => Math.round(p.getBoundingClientRect().width)),
        title: d?.getAttribute('aria-label'),
        sideBySide: !!document.querySelector('.monaco-diff-editor.side-by-side'),
        headings: [...(d?.querySelectorAll('h1,h2,h3') ?? [])].map(x => x.textContent.trim()),
      };
    });
    console.log(tag, JSON.stringify(info));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  } else { console.log(tag, 'JÄMFÖR EJ SYNLIG (F-D.1)'); }

  // --- "Visa" (preview, compareTo === null)
  const item2 = page.locator('.version-item > button:first-child').first();
  if (!(await page.locator('.version-actions').count())) await item2.click({ force: true });
  await page.waitForTimeout(400);
  const show = page.locator('.version-actions button', { hasText: 'Visa' }).first();
  if (await show.count() && await show.isVisible()) {
    await show.click(); await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}41-diff-preview--${tag}.png` });
    const same = await page.evaluate(() => {
      const diff = document.querySelectorAll('dialog[open] .monaco-diff-editor').length;
      const text = document.querySelector('dialog[open] .view-lines')?.innerText ?? '';
      const ta = document.querySelector('dialog[open] textarea.plain-editor');
      return { diffWidgets: diff, synligText: (ta ? ta.value : text).trim().split('\n')[0] ?? '', tecken: (ta ? ta.value : text).length };
    });
    console.log(tag, 'VISA:', JSON.stringify(same));
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}
await browser.close();
