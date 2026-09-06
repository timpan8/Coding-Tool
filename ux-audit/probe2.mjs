import { chromium } from '@playwright/test';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:4173';
const CODE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
$exportPath = "C:\\Users\\tim\\Export"
Connect-Database -User $adminUser -Password $adminPassword
`;
const log = (...a) => console.log(...a);
const record = (n, d) => { log('\n### ' + n); log(JSON.stringify(d, null, 1)); };

async function boot(browser, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('   [pageerror]', e.message));
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
async function typeCode(page, code = CODE) {
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(code);
  await page.waitForTimeout(1500);
}
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = n => !ONLY || ONLY.includes(String(n));
const browser = await chromium.launch();

// ---- A. does `inert` change anything visually?
if (want('A')) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  const before = await page.locator('.workspace').screenshot();
  const styleBefore = await page.evaluate(() => {
    const w = document.querySelector('.workspace');
    const cs = getComputedStyle(w);
    return { opacity: cs.opacity, filter: cs.filter, cursor: cs.cursor, pointerEvents: cs.pointerEvents };
  });
  await page.evaluate(() => document.querySelector('.workspace').setAttribute('inert', ''));
  await page.waitForTimeout(300);
  const after = await page.locator('.workspace').screenshot();
  const styleAfter = await page.evaluate(() => {
    const w = document.querySelector('.workspace');
    const cs = getComputedStyle(w);
    return { opacity: cs.opacity, filter: cs.filter, cursor: cs.cursor, pointerEvents: cs.pointerEvents };
  });
  const h = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
  record('A. workspace with vs without [inert] (what busy looks like)', {
    screenshotHashIdentical: h(before) === h(after), before: h(before), after: h(after), styleBefore, styleAfter,
  });
  await ctx.close();
}

// ---- B. BindingDialog: does the error clear when you fix the field? duplicate names?
if (want('B')) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  await page.locator('nav.top-navigation button', { hasText: 'Bindings' }).click();
  await page.waitForTimeout(700);
  const open = async () => { await page.locator('.bindings-page .dashboard-heading button.primary').click(); await page.waitForTimeout(400); };
  await open();
  const dlg = page.locator('dialog[open]');
  const name = dlg.locator('input').first();
  await dlg.locator('button.primary').click(); await page.waitForTimeout(250);
  const step1 = await page.evaluate(() => document.querySelector('dialog[open] .error')?.textContent ?? null);
  await name.fill('MITT_VARDE');
  await page.waitForTimeout(250);
  const step2 = await page.evaluate(() => ({ errorStillShown: document.querySelector('dialog[open] .error')?.textContent ?? null }));
  await dlg.locator('button.primary').click(); await page.waitForTimeout(700);
  const step3 = { dialogClosed: (await page.locator('dialog[open]').count()) === 0 };
  // create a duplicate
  await open();
  await page.locator('dialog[open] input').first().fill('MITT_VARDE');
  await page.waitForTimeout(200);
  const dupLive = await page.evaluate(() => ({ error: document.querySelector('dialog[open] .error')?.textContent ?? null, saveDisabled: [...document.querySelectorAll('dialog[open] button')].find(b => /Spara/.test(b.textContent))?.disabled }));
  await page.locator('dialog[open] button.primary').click(); await page.waitForTimeout(400);
  const dupAfterSave = await page.evaluate(() => document.querySelector('dialog[open] .error')?.textContent ?? null);
  record('B. BindingDialog error lifecycle', { afterEmptySave: step1, afterFillingValidName: step2, savedOk: step3, duplicateWhileTyping: dupLive, duplicateAfterSave: dupAfterSave });
  await ctx.close();
}

// ---- C. CopyDialog: accidental copy paths + feedback
if (want('C')) {
  const { ctx, page } = await boot(browser);
  // code with only LOW/MEDIUM findings -> no acknowledge checkbox
  await typeCode(page, '# rapport.ps1\n$exportPath = "C:\\\\Users\\\\tim\\\\Export"\n$mail = "tim.andersson@example.com"\n');
  await page.locator('.ai-copy').click();
  await page.waitForTimeout(600);
  const mild = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    if (!d) return null;
    const btns = [...d.querySelectorAll('.dialog-actions button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled, cls: b.className }));
    return {
      title: d.querySelector('h2')?.textContent,
      headline: d.querySelector('p b')?.textContent,
      hasAcknowledgeCheckbox: Boolean(d.querySelector('input[type=checkbox]')),
      buttons: btns,
      firstFocusable: document.activeElement?.tagName + '.' + (document.activeElement?.className || ''),
      lists: [...d.querySelectorAll('ul.unbound-values')].map(u => ({ heading: u.previousElementSibling?.tagName + ':' + (u.previousElementSibling?.textContent ?? '').slice(0, 40), items: [...u.querySelectorAll('li')].map(li => li.textContent).slice(0, 4) })),
    };
  });
  // press Enter and see whether anything copies
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const afterEnter = { dialogStillOpen: await page.locator('dialog[open]').count(), notice: await page.locator('.inline-notice').first().textContent().catch(() => null) };
  // now actually copy
  if (await page.locator('dialog[open]').count()) {
    await page.locator('dialog[open] .dialog-actions button').last().click();
    await page.waitForTimeout(600);
  }
  const afterCopy = {
    dialogOpen: await page.locator('dialog[open]').count(),
    notice: await page.locator('.inline-notice').first().textContent().catch(() => null),
    clipboard: await page.evaluate(() => navigator.clipboard.readText().catch(() => 'denied')),
  };
  record('C. CopyDialog with only low/medium findings', { dialog: mild, afterEnter, afterCopy });
  await ctx.close();
}

// ---- D. small controls with real findings at 390 px (real hit areas incl. padding)
if (want('D')) {
  const { ctx, page } = await boot(browser, 390, 800);
  await typeCode(page);
  await page.waitForTimeout(1600);
  const sizes = await page.evaluate(() => {
    const sel = ['.finding-actions button', '.finding-head', '.file-close', '.inline-notice button', '.binding-panel .text-button', '.row-actions button', '.local-tools button', '.heading-actions button', '.copy-actions button', '.issue-item', 'summary'];
    const out = [];
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      out.push({ sel: s, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out.filter(o => o.h < 44 || o.w < 44);
  });
  record('D. real hit areas under 44px at 390px, workspace with findings', sizes);
  await ctx.close();
}

// ---- E. destructive: project delete undo, profile delete, ingest replace
if (want('E')) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  // ingest: replace the whole template, look for undo
  await page.locator('.copy-actions button').first().click(); // "Klistra in från AI"
  await page.waitForTimeout(400);
  await page.locator('dialog[open] textarea').fill('# helt annan kod\nWrite-Host "hej"\n');
  await page.waitForTimeout(400);
  const ingestBtn = page.locator('dialog[open] .dialog-actions button.primary');
  const ingestState = { label: await ingestBtn.textContent(), disabled: await ingestBtn.isDisabled() };
  await ingestBtn.click();
  await page.waitForTimeout(900);
  const afterIngest = {
    undoBar: await page.locator('.undo-bar').count(),
    notice: await page.locator('.inline-notice').first().textContent().catch(() => null),
    editorFirstLine: await page.evaluate(() => document.querySelector('.view-lines')?.textContent?.slice(0, 40) ?? null),
  };
  // profile delete
  await page.selectOption('select[aria-label="Aktiv profil"]', '__manage__');
  await page.waitForTimeout(400);
  await page.locator('dialog[open] input[aria-label="Ny profil"]').fill('Produktion');
  await page.locator('dialog[open] .dialog-actions button.primary').click();
  await page.waitForTimeout(700);
  await page.locator('dialog[open] .profile-row button').first().click();
  await page.waitForTimeout(600);
  const profileConfirm = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('dialog[open]')];
    const d = ds[ds.length - 1];
    return d ? { title: d.querySelector('h2')?.textContent, body: d.querySelector('.confirm-body')?.textContent, typeToConfirm: Boolean(d.querySelector('.confirm-body ~ label code')) } : null;
  });
  if (profileConfirm) { await page.locator('dialog[open] button.danger').last().click(); await page.waitForTimeout(700); }
  const afterProfileDelete = { undoBar: await page.locator('.undo-bar').count(), notice: await page.locator('.inline-notice').first().textContent().catch(() => null) };
  record('E. ingest + profile delete', { ingestState, afterIngest, profileConfirm, afterProfileDelete });
  await ctx.close();
}

// ---- F. undo bar for project delete: presence, timing, position
if (want('F')) {
  const { ctx, page } = await boot(browser, 390, 800);
  await typeCode(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.heading-actions button.danger-text').click();
  await page.waitForTimeout(500);
  await page.locator('dialog[open] input').fill('RADERA');
  await page.locator('dialog[open] button.danger').click();
  await page.waitForTimeout(800);
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.undo-bar');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), inViewport: r.top < window.innerHeight && r.bottom > 0, role: b.getAttribute('role'),
      buttons: [...b.querySelectorAll('button')].map(x => { const rr = x.getBoundingClientRect(); return { t: (x.getAttribute('aria-label') || x.textContent).trim(), w: Math.round(rr.width), h: Math.round(rr.height) }; }) };
  });
  await page.waitForTimeout(11000);
  const gone = await page.locator('.undo-bar').count();
  record('F. undo bar after project delete (390px)', { bar, presentAfter11s: gone });
  await ctx.close();
}

await browser.close();
log('\n\nDONE');
