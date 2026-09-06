import { chromium } from '@playwright/test';
const OUT = new URL('./screens/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:4173/';
const LONG = 'Produktionsdeploy för kundmiljön Norra Regionen inklusive databasmigrering och certifikatsrotation steg två';

const SAMPLE = `$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
`;

async function boot(width, height) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read','clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
  await page.waitForTimeout(300);
  return { browser, page };
}
const shot = (page, n, w, full=false) => page.screenshot({ path: `${OUT}${n}--${w}.png`, fullPage: full });

async function makeProject(page, text, name) {
  await page.goto(BASE + '#/'); await page.waitForTimeout(700);
  await page.locator('.editor-body').click(); await page.waitForTimeout(200);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1200);
  const rename = page.locator('button.project-name');
  if (await rename.count()) {
    await rename.click(); await page.waitForTimeout(200);
    await page.locator('input.project-name-input').fill(name);
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  }
}

for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
  const { browser, page } = await boot(w, h);

  // --- seed a set of projects, one with a very long name
  const names = ['Deploy skript', LONG, 'API-nyckelrotation', 'Backup-jobb', 'DB-migrering', 'Nginx-konfig',
                 'Terraform prod', 'Cron-städning', 'SSO-test', 'Rapportexport', 'Fakturaimport', 'Loggrotation'];
  for (const n of names) await makeProject(page, SAMPLE, n);

  // --- many rows: project overview
  await page.goto(BASE + '#/projects'); await page.waitForTimeout(1200);
  await shot(page, '20-projects-many', w);
  await shot(page, '20b-projects-many-full', w, true);

  // --- long project name in the workspace heading
  await page.locator('.project-card, .project-cards button').first().click().catch(()=>{});
  await page.waitForTimeout(1000);
  await shot(page, '21-long-name-workspace', w);

  // --- create bindings via Ctrl+B on a selection
  await page.goto(BASE + '#/'); await page.waitForTimeout(600);
  await page.locator('.editor-body').click(); await page.waitForTimeout(200);
  await page.keyboard.insertText(SAMPLE); await page.waitForTimeout(1200);
  // select the password literal by double-clicking it
  const mk = page.locator('.finding-actions button', { hasText: 'Skapa binding' }).first();
  if (await mk.count()) { await mk.click(); await page.waitForTimeout(900); }
  if (await page.locator('dialog[open]').count()) {
    await shot(page, '22-binding-dialog', w);
    await shot(page, '22b-binding-dialog-full', w, true);
    const save = page.locator('dialog[open] .dialog-actions button.primary');
    if (await save.count()) { await save.click(); await page.waitForTimeout(1000); }
  }
  await shot(page, '23-workspace-with-binding', w);

  // --- destructive confirm: delete project (typeToConfirm)
  const del = page.locator('button', { hasText: 'Radera projekt' });
  if (await del.count()) {
    await del.first().click(); await page.waitForTimeout(900);
    await shot(page, '24-confirm-delete-project', w);
    const cancel = page.locator('dialog[open] .dialog-actions button').first();
    if (await cancel.count()) await cancel.click();
    await page.waitForTimeout(500);
  }

  // --- bindings page with rows
  await page.goto(BASE + '#/bindings'); await page.waitForTimeout(1000);
  await shot(page, '25-bindings-list', w);
  await shot(page, '25b-bindings-list-full', w, true);

  // --- settings, expanded
  await page.goto(BASE + '#/settings'); await page.waitForTimeout(1200);
  await shot(page, '26-settings-full', w, true);

  // --- dark theme on the workspace
  await page.goto(BASE + '#/'); await page.waitForTimeout(700);
  const themeSel = page.locator('select[aria-label="Tema"]');
  if (await themeSel.count()) { await themeSel.selectOption('dark'); await page.waitForTimeout(900); }
  await shot(page, '27-dark-workspace', w);
  await page.goto(BASE + '#/projects'); await page.waitForTimeout(900);
  await shot(page, '27b-dark-projects', w);
  await page.goto(BASE + '#/security'); await page.waitForTimeout(700);
  await shot(page, '27c-dark-security', w, true);
  if (await themeSel.count()) { await themeSel.selectOption('light'); await page.waitForTimeout(600); }

  // --- search with no match (empty result state)
  await page.goto(BASE + '#/projects'); await page.waitForTimeout(900);
  const q = page.locator('input[aria-label="Sök i alla projekt"]').first();
  if (await q.count()) { await q.fill('zzzzz-finns-inte'); await page.waitForTimeout(700); await shot(page, '28-projects-no-match', w); }

  // --- shortcuts modal (by aria-label)
  await page.goto(BASE + '#/'); await page.waitForTimeout(700);
  const sc = page.locator('button[aria-label="Visa kortkommandon"]');
  if (await sc.count()) { await sc.click(); await page.waitForTimeout(700); await shot(page, '29-shortcuts-modal', w, true); await page.keyboard.press('Escape'); }

  await browser.close();
  console.log('done ' + w);
}
