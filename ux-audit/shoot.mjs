import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = new URL('./screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173/';
const WIDTHS = [390, 768, 1440];
const notes = [];

const SAMPLE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
$exportPath = "C:\\\\Users\\\\tim\\\\Export"
Connect-Database -User $adminUser -Password $adminPassword -Server $dbHost
`;

async function shot(page, name, w, opts = {}) {
  const file = `${OUT}${name}--${w}.png`;
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  return file;
}

async function dismissIntro(page) {
  // The intro modal opens on a fresh vault; close it so it does not cover every other shot.
  const close = page.locator('dialog[open] .dialog-head button');
  if (await close.count()) { await close.first().click(); await page.waitForTimeout(200); }
}

async function run(width) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 },
    deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  // ---- 1. First visit: intro modal over the empty workspace
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '01-first-visit-intro', width);
  await dismissIntro(page);

  // ---- 2. Empty workspace
  await page.waitForTimeout(400);
  await shot(page, '02-workspace-empty', width);
  await shot(page, '02b-workspace-empty-full', width, { fullPage: true });

  // ---- 3. Security page
  await page.goto(BASE + '#/security', { waitUntil: 'load' }); await page.waitForTimeout(600);
  await shot(page, '03-security', width);
  await shot(page, '03b-security-full', width, { fullPage: true });

  // ---- 4. Settings
  await page.goto(BASE + '#/settings'); await page.waitForTimeout(800);
  await shot(page, '04-settings', width);
  await shot(page, '04b-settings-full', width, { fullPage: true });

  // ---- 5. Projects overview (empty)
  await page.goto(BASE + '#/projects'); await page.waitForTimeout(600);
  await shot(page, '05-projects-empty', width);

  // ---- 6. Bindings page (empty)
  await page.goto(BASE + '#/bindings'); await page.waitForTimeout(600);
  await shot(page, '06-bindings-empty', width);

  // ---- 7. Paste code -> project is created automatically
  await page.goto(BASE + '#/'); await page.waitForTimeout(800);
  const editor = page.locator('.editor-body');
  await editor.click();
  await page.waitForTimeout(300);
  await page.keyboard.insertText(SAMPLE);
  await page.waitForTimeout(1500);
  await shot(page, '07-workspace-with-code', width);
  await shot(page, '07b-workspace-with-code-full', width, { fullPage: true });
  notes.push(`${width}: url after paste = ${page.url()}`);

  // ---- 8. Findings panel (scanner should flag the api key / password)
  await page.waitForTimeout(1200);
  const findings = page.locator('.findings-panel');
  if (await findings.count()) {
    await findings.scrollIntoViewIfNeeded();
    await shot(page, '08-findings-panel', width);
  } else notes.push(`${width}: no .findings-panel rendered`);

  // ---- 9. Local + AI views
  for (const m of ['local', 'ai']) {
    const tab = page.locator(`#vy-${m}`);
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(800); await shot(page, `09-view-${m}`, width); }
  }
  await page.locator('#vy-template').click(); await page.waitForTimeout(500);

  // ---- 10. Copy dialog (AI) — the gate
  const copyAi = page.locator('button.ai-copy');
  if (await copyAi.count() && await copyAi.isEnabled()) {
    await copyAi.click(); await page.waitForTimeout(700);
    await shot(page, '10-copy-dialog-ai', width);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  } else notes.push(`${width}: ai-copy disabled`);

  // ---- 11. Shortcuts modal
  await page.locator('.top-navigation button', { hasText: 'Kortkommandon' }).first().click().catch(()=>{});
  await page.waitForTimeout(600);
  if (await page.locator('dialog[open]').count()) { await shot(page, '11-shortcuts-modal', width); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(400);

  // ---- 12. Project drawer (Ctrl+P)
  await page.keyboard.press('Control+p'); await page.waitForTimeout(600);
  await shot(page, '12-project-drawer', width);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const closeDrawer = page.locator('.project-browser button', { hasText: 'Stäng' });
  if (await closeDrawer.count()) await closeDrawer.first().click().catch(()=>{});
  await page.waitForTimeout(300);

  await ctx.close(); await browser.close();
  return errors;
}

for (const w of WIDTHS) {
  const errors = await run(w);
  console.log(`--- ${w}px done. console errors: ${errors.length}`);
  errors.slice(0, 8).forEach(e => console.log(`   ! ${e.slice(0, 200)}`));
}
console.log(notes.join('\n'));
