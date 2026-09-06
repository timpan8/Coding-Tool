import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const CODE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
$exportPath = "C:\\Users\\tim\\Export"
$more = "rad sju"
$more2 = "rad atta"
$more3 = "rad nio"
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

// ---- G. control: is a screenshot of the workspace stable without touching inert?
if (want('G')) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  const h = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
  const a = h(await page.locator('.workspace').screenshot());
  await page.waitForTimeout(300);
  const b = h(await page.locator('.workspace').screenshot());
  await page.evaluate(() => document.querySelector('.workspace').setAttribute('inert', ''));
  await page.waitForTimeout(300);
  const c = h(await page.locator('.workspace').screenshot());
  record('G. control — workspace screenshot stability (caret blink) vs [inert]', { noChange1: a, noChange2: b, withInert: c, verdict: a === b ? 'screenshots stable, so any diff is real' : 'screenshots unstable (blinking caret) — pixel diff is meaningless, use computed style instead' });
  await ctx.close();
}

// ---- H. clipboard countdown strip position after Copy Local at 390px
if (want('H')) {
  const { ctx, page } = await boot(browser, 390, 800);
  await typeCode(page);
  // turn on auto-clear
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(700);
  await page.selectOption('select[aria-label="Rensa urklipp efter Copy Local"]', '30');
  await page.waitForTimeout(500);
  await page.locator('a.brand').click();
  await page.waitForTimeout(900);
  // scroll down to the binding panel, then use the keyboard shortcut for Copy Local
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Shift+Enter');
  await page.waitForTimeout(700);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return d ? { title: d.querySelector('h2')?.textContent, buttons: [...d.querySelectorAll('.dialog-actions button')].map(b => ({ t: b.textContent.trim(), cls: b.className, disabled: b.disabled })) } : null;
  });
  if (dlg) { await page.locator('dialog[open] .dialog-actions button.danger').click(); await page.waitForTimeout(800); }
  const strip = await page.evaluate(() => {
    const out = {};
    for (const sel of ['.clipboard-countdown', '.inline-notice']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      out[sel] = { text: el.textContent.slice(0, 80), top: Math.round(r.top), inViewport: r.bottom > 0 && r.top < window.innerHeight };
    }
    out.scrollY = Math.round(window.scrollY);
    out.innerH = window.innerHeight;
    return out;
  });
  record('H. Copy Local via Ctrl+Shift+Enter while scrolled down (390px)', { dialog: dlg, strips: strip });
  await ctx.close();
}

// ---- I. Backup import with "replace" resolution
if (want('I')) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(900);
  // export first
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.backup-actions button.primary').click(),
  ]);
  const file = '/tmp/claude-0/-home-user-Coding-Tool/de8f9e1c-cd86-5882-89ff-6b225eee7501/scratchpad/vault.acv.json';
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
  await dl.saveAs(file);
  // change something so the import conflicts
  await page.locator('a.brand').click();
  await page.waitForTimeout(800);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('\n# lokal ändring efter exporten\n');
  await page.waitForTimeout(1500);
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(900);
  await page.setInputFiles('.file-picker input[type=file]', file);
  await page.waitForTimeout(1500);
  const plan = await page.evaluate(() => {
    const p = document.querySelector('.import-plan');
    if (!p) return null;
    const sel = p.querySelector('select');
    return {
      summary: p.querySelector('p')?.textContent,
      resolutionOptions: sel ? [...sel.options].map(o => ({ v: o.value, t: o.textContent })) : null,
      defaultResolution: sel?.value ?? null,
      buttons: [...p.querySelectorAll('.dialog-actions button')].map(b => b.textContent.trim()),
    };
  });
  let afterReplace = null;
  if (plan?.resolutionOptions) {
    await page.selectOption('.import-plan select', 'replace');
    await page.waitForTimeout(300);
    await page.locator('.import-plan .dialog-actions button.primary').click();
    await page.waitForTimeout(1500);
    afterReplace = await page.evaluate(() => ({
      confirmDialogShown: document.querySelectorAll('dialog[open]').length,
      result: document.querySelector('.import-result')?.textContent?.slice(0, 200) ?? null,
      undoBar: document.querySelectorAll('.undo-bar').length,
    }));
  }
  record('I. Backup import with "Ta filens version" (replace)', { plan, afterReplace });
  await ctx.close();
}

// ---- J. empty states across routes with an empty vault
if (want('J')) {
  const { ctx, page } = await boot(browser, 1440, 900);
  const out = {};
  for (const [route, label] of [['#/projects', 'projects'], ['#/bindings', 'bindings']]) {
    await page.evaluate(r => { location.hash = r; }, route);
    await page.waitForTimeout(900);
    out[label] = await page.evaluate(() => {
      const empty = document.querySelector('.empty-project-list, .empty-binding-list');
      return empty ? { text: empty.textContent, actionButtons: [...empty.querySelectorAll('button,a')].map(b => b.textContent) } : { text: null };
    });
  }
  record('J. empty states', out);
  await ctx.close();
}

await browser.close();
log('\n\nDONE');
