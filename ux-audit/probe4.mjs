import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const OUT = '/tmp/claude-0/-home-user-Coding-Tool/de8f9e1c-cd86-5882-89ff-6b225eee7501/scratchpad';
fs.mkdirSync(OUT, { recursive: true });
const CODE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
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
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = n => !ONLY || ONLY.includes(String(n));
const browser = await chromium.launch();

// K. what exactly changes visually under inert
if (want('K')) {
  const { ctx, page } = await boot(browser);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(CODE);
  await page.waitForTimeout(1500);
  await page.locator('.workspace').screenshot({ path: OUT + '/inert-off.png' });
  await page.evaluate(() => document.querySelector('.workspace').setAttribute('inert', ''));
  await page.waitForTimeout(400);
  await page.locator('.workspace').screenshot({ path: OUT + '/inert-on.png' });
  // per-element computed style comparison
  const diff = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.workspace button, .workspace select, .workspace input, .workspace .editor-body')];
    const props = ['opacity', 'filter', 'cursor', 'color', 'backgroundColor', 'borderColor', 'pointerEvents'];
    return els.slice(0, 200).map(e => { const cs = getComputedStyle(e); const o = {}; for (const p of props) o[p] = cs[p]; return { tag: e.tagName, cls: e.className.slice(0, 24), ...o }; });
  });
  await page.evaluate(() => document.querySelector('.workspace').removeAttribute('inert'));
  await page.waitForTimeout(400);
  const diff2 = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.workspace button, .workspace select, .workspace input, .workspace .editor-body')];
    const props = ['opacity', 'filter', 'cursor', 'color', 'backgroundColor', 'borderColor', 'pointerEvents'];
    return els.slice(0, 200).map(e => { const cs = getComputedStyle(e); const o = {}; for (const p of props) o[p] = cs[p]; return { tag: e.tagName, cls: e.className.slice(0, 24), ...o }; });
  });
  const changed = diff.filter((d, i) => JSON.stringify(d) !== JSON.stringify(diff2[i]));
  record('K. computed-style differences on every control inside .workspace with/without inert', { elementsChecked: diff.length, changed });
  await ctx.close();
}

// L. empty states, only what is actually visible
if (want('L')) {
  const { ctx, page } = await boot(browser);
  const out = {};
  for (const [route, label] of [['#/projects', 'projects'], ['#/bindings', 'bindings']]) {
    await page.evaluate(r => { location.hash = r; }, route);
    await page.waitForTimeout(900);
    out[label] = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.empty-project-list, .empty-binding-list')].filter(e => e.getBoundingClientRect().height > 0);
      return vis.map(e => ({ cls: e.className, text: e.textContent, buttons: [...e.querySelectorAll('button,a')].length }));
    });
  }
  // and the versions panel / findings panel when empty
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForTimeout(900);
  out.workspaceEmpty = await page.evaluate(() => ({
    pastePrompt: document.querySelector('.paste-prompt')?.textContent ?? null,
    bindingPanelEmpty: document.querySelector('.binding-panel')?.textContent?.slice(0, 200) ?? null,
    findingsPanel: Boolean(document.querySelector('.findings-panel')),
    versionPanel: document.querySelector('.version-panel, .binding-panel details')?.textContent?.slice(0, 120) ?? null,
  }));
  record('L. visible empty states', out);
  await ctx.close();
}

// M. force a real import conflict and take the "replace" path
if (want('M')) {
  const { ctx, page } = await boot(browser);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(CODE);
  await page.waitForTimeout(1800);
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(900);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.backup-actions button.primary').click()]);
  const file = OUT + '/vault.acv.json';
  await dl.saveAs(file);
  // rewrite the snapshot so the same project id carries different content and a newer timestamp
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const later = new Date(Date.now() + 3600_000).toISOString();
  for (const p of snap.payload.projects ?? []) { p.name = 'Namn ur filen'; p.updatedAt = later; }
  for (const d of snap.payload.drafts ?? []) { for (const k of Object.keys(d.templates)) d.templates[k] = '# ur backupfilen\n'; d.updatedAt = later; }
  const conflictFile = OUT + '/vault-conflict.acv.json';
  fs.writeFileSync(conflictFile, JSON.stringify(snap, null, 2));
  await page.setInputFiles('.file-picker input[type=file]', conflictFile);
  await page.waitForTimeout(1800);
  const plan = await page.evaluate(() => {
    const p = document.querySelector('.import-plan');
    if (!p) return null;
    const sel = p.querySelector('select');
    return { summary: p.querySelector('p')?.textContent, options: sel ? [...sel.options].map(o => o.value + '=' + o.textContent) : null,
      def: sel?.value ?? null, buttons: [...p.querySelectorAll('.dialog-actions button')].map(b => b.textContent.trim()) };
  });
  let after = null;
  if (plan?.options) {
    await page.selectOption('.import-plan select', 'replace');
    await page.waitForTimeout(300);
    await page.locator('.import-plan .dialog-actions button.primary').click();
    await page.waitForTimeout(1800);
    after = await page.evaluate(() => ({
      extraConfirmDialog: document.querySelectorAll('dialog[open]').length,
      result: document.querySelector('.import-result')?.textContent?.slice(0, 240) ?? null,
      undoBar: document.querySelectorAll('.undo-bar').length,
    }));
  }
  record('M. import with a real conflict, resolution = "Ta filens version"', { plan, after });
  await ctx.close();
}

await browser.close();
log('\n\nDONE');
