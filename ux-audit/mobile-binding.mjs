import { chromium } from '@playwright/test';
const SAMPLE = `$adminUser = "tim.andersson"\n$adminPassword = "Hunter2-Very-Secret!"\n$dbHost = "sql-prod-01.internal.example.com"\n$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"\n`;
const browser = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(500);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(SAMPLE);
  await page.waitForTimeout(1800);
  // create a binding through the findings panel
  const mk = page.locator('.finding-actions button', { hasText: 'Skapa binding' }).first();
  if (await mk.count()) { await mk.click(); await page.waitForTimeout(900);
    const save = page.locator('dialog[open] .dialog-actions button.primary');
    if (await save.count()) { await save.click(); await page.waitForTimeout(1400); } }

  const before = await page.evaluate(() => {
    const ta = document.querySelector('textarea.plain-editor');
    return { editor: ta ? 'textarea' : 'monaco',
      sel: ta ? [ta.selectionStart, ta.selectionEnd] : null,
      focused: document.activeElement?.className?.toString().slice(0,30) ?? null,
      decorations: document.querySelectorAll('.substituted, .binding-decoration, [class*=substit]').length };
  });
  const nameBtn = page.locator('.binding-card button.binding-name').first();
  const has = await nameBtn.count();
  if (has) { await nameBtn.click(); await page.waitForTimeout(900); }
  const after = await page.evaluate(() => {
    const ta = document.querySelector('textarea.plain-editor');
    return { sel: ta ? [ta.selectionStart, ta.selectionEnd] : null,
      focused: document.activeElement?.className?.toString().slice(0,30) ?? null,
      decorations: document.querySelectorAll('.substituted, .binding-decoration, [class*=substit]').length };
  });
  // now look at the AI view: are substitutions marked?
  const aiTab = page.locator('#vy-ai'); if (await aiTab.count()) { await aiTab.click(); await page.waitForTimeout(900); }
  const aiMarks = await page.evaluate(() => document.querySelectorAll('[class*=substit], .binding-decoration').length);
  await page.screenshot({ path: new URL(`./screens/31-ai-view-marks--${w}.png`, import.meta.url).pathname });
  console.log(w + 'px | editor=' + before.editor + ' | bindingNameBtn=' + has +
    ' | before=' + JSON.stringify(before) + ' | after=' + JSON.stringify(after) + ' | AI-vy markeringar=' + aiMarks);
  await ctx.close();
}
await browser.close();
