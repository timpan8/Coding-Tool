import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173';
const CODE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
$dbHost = "sql-prod-01.internal.example.com"
`;
const log = (...a) => console.log(...a);
const record = (n, d) => { log('\n### ' + n); log(JSON.stringify(d, null, 1)); };
async function boot(browser, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.editor-body', { timeout: 20000 });
  for (let i = 0; i < 40; i++) {
    if (await page.locator('dialog[open]').count()) { await page.locator('dialog[open] .dialog-head button').first().click({ force: true }); await page.waitForTimeout(200); }
    else await page.waitForTimeout(150);
    if (i > 6 && !(await page.locator('dialog[open]').count())) break;
  }
  await page.waitForTimeout(300);
  return { ctx, page };
}
const browser = await chromium.launch();

// N. dialog .check hit areas + CopyDialog layout at 390 px
{
  const { ctx, page } = await boot(browser, 390, 800);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(CODE);
  await page.waitForTimeout(1800);
  await page.locator('.ai-copy').click();
  await page.waitForTimeout(800);
  const d = await page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return null;
    const r = dlg.getBoundingClientRect();
    const chk = dlg.querySelector('label.check');
    const cr = chk?.getBoundingClientRect();
    const box = chk?.querySelector('input')?.getBoundingClientRect();
    const actions = dlg.querySelector('.dialog-actions')?.getBoundingClientRect();
    return {
      dialog: { top: Math.round(r.top), height: Math.round(r.height), scrollH: dlg.scrollHeight, clientH: dlg.clientHeight, scrolls: dlg.scrollHeight > dlg.clientHeight + 2 },
      innerH: window.innerHeight,
      acknowledgeLabel: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      acknowledgeBox: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      acknowledgeVisibleWithoutScrolling: cr ? cr.bottom <= r.bottom && cr.top >= r.top : null,
      actionsBelowFold: actions ? actions.bottom > window.innerHeight : null,
      actionButtons: [...dlg.querySelectorAll('.dialog-actions button')].map(b => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), disabled: b.disabled, w: Math.round(q.width), h: Math.round(q.height) }; }),
      focused: document.activeElement?.tagName + '.' + (document.activeElement?.className || '') + ' | ' + (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').slice(0, 30),
    };
  });
  record('N. CopyDialog (AI) at 390px', d);
  await ctx.close();
}

// O. does Enter in the CopyDialog copy or close? (1440, with critical findings)
{
  const { ctx, page } = await boot(browser);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(CODE);
  await page.waitForTimeout(1800);
  await page.locator('.ai-copy').click();
  await page.waitForTimeout(700);
  const focused = await page.evaluate(() => document.activeElement?.tagName + ' | ' + (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').slice(0, 40));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const afterEnter = { dialogOpen: await page.locator('dialog[open]').count(), notice: await page.locator('.inline-notice').first().textContent().catch(() => null), clip: await page.evaluate(() => navigator.clipboard.readText().catch(() => 'denied')) };
  record('O. focus + Enter inside the AI copy dialog (critical findings present)', { focusedOnOpen: focused, afterEnter });
  await ctx.close();
}

// P. keyboard: Escape / Enter behaviour in ConfirmDialog with typeToConfirm
{
  const { ctx, page } = await boot(browser);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(CODE);
  await page.waitForTimeout(1800);
  await page.locator('.heading-actions button.danger-text').click();
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const btn = [...d.querySelectorAll('.dialog-actions button')];
    return { focused: document.activeElement?.tagName + '.' + document.activeElement?.className, confirmDisabled: btn[1]?.disabled, label: btn[1]?.textContent };
  });
  await page.keyboard.type('radera');
  await page.waitForTimeout(300);
  const lower = await page.evaluate(() => { const b = [...document.querySelectorAll('dialog[open] .dialog-actions button')][1]; return { disabled: b.disabled, hint: document.querySelector('dialog[open] label')?.textContent }; });
  await page.locator('dialog[open] input').fill('RADERA');
  await page.waitForTimeout(200);
  const upper = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .dialog-actions button')][1].disabled);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const afterEnter = { dialogOpen: await page.locator('dialog[open]').count(), undoBar: await page.locator('.undo-bar').count() };
  record('P. ConfirmDialog with typeToConfirm', { onOpen: state, afterTypingLowercase: lower, afterTypingUppercase: { confirmDisabled: upper }, afterEnterInTheField: afterEnter });
  await ctx.close();
}

await browser.close();
log('\n\nDONE');
