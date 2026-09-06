import { chromium } from '@playwright/test';

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

async function boot(browser, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => log('   [pageerror]', e.message));
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.editor-body', { timeout: 20000 });
  // The intro opens once settings load, which is after the first paint.
  for (let i = 0; i < 40; i++) {
    const d = page.locator('dialog[open]');
    if (await d.count()) { await page.locator('dialog[open] .dialog-head button').first().click({ force: true }); await page.waitForTimeout(200); }
    else await page.waitForTimeout(150);
    if (i > 6 && !(await page.locator('dialog[open]').count())) break;
  }
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function typeCode(page, code = CODE) {
  await page.locator('.editor-body').click();
  await page.keyboard.insertText(code);
  await page.waitForTimeout(1200);
}

const results = [];
function record(name, data) { results.push({ name, data }); log('\n### ' + name); log(JSON.stringify(data, null, 1)); }

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = n => !ONLY || ONLY.includes(String(n));
const browser = await chromium.launch();

// ---------------------------------------------------------------- 1. busy affordance
if (want(1)) {
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  // Instrument: watch for any class/attr change that signals busy while a run() action is going.
  const seen = await page.evaluate(async () => {
    const out = { workspaceInert: [], mainBusy: [], cursor: null, cssRulesForBusy: [] };
    // collect every CSS rule mentioning aria-busy / inert / [disabled] on workspace
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        const s = r.cssText || '';
        if (/aria-busy|\[inert\]|:disabled|\.busy/.test(s)) out.cssRulesForBusy.push(s.slice(0, 160));
      }
    }
    const ws = document.querySelector('.workspace');
    const main = document.querySelector('main');
    const obs = new MutationObserver(() => {
      out.workspaceInert.push(ws.hasAttribute('inert'));
      out.mainBusy.push(main.getAttribute('aria-busy'));
    });
    obs.observe(ws, { attributes: true });
    obs.observe(main, { attributes: true });
    window.__stop = () => obs.disconnect();
    return out;
  });
  // trigger a run(): add a file
  await page.locator('.file-add').click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => { window.__stop?.(); return { ok: true }; });
  record('1. CSS rules that could express busy/disabled state', { cssRulesForBusy: seen.cssRulesForBusy, note: after });
  await ctx.close();
}

// ---------------------------------------------------------------- 2. loading state on boot
if (want(2)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/#/', { waitUntil: 'commit' });
  const snaps = [];
  for (let i = 0; i < 8; i++) {
    snaps.push(await page.evaluate(() => ({
      t: Math.round(performance.now()),
      save: document.querySelector('.save-state')?.textContent ?? null,
      hasEditor: Boolean(document.querySelector('.editor-body')),
      monacoReady: Boolean(document.querySelector('.monaco-editor')),
      editorBodyText: (document.querySelector('.editor-body')?.textContent ?? '').slice(0, 60),
      skeleton: document.querySelectorAll('[class*=skeleton],[class*=spinner],[role=progressbar]').length,
    })).catch(() => null));
    await page.waitForTimeout(120);
  }
  record('2. boot timeline (first ~1s)', snaps);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. notice strip behaviour
if (want(3)) {
  const { ctx, page } = await boot(browser, 390, 800);
  await typeCode(page);
  await page.waitForTimeout(1500);
  // scroll to bottom so the findings panel is on screen
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const dismiss = page.getByRole('button', { name: 'Ofarligt här' }).first();
  const had = await dismiss.count();
  let info = { hadDismissButton: had };
  if (had) {
    await dismiss.click();
    await page.waitForTimeout(400);
    info = await page.evaluate(() => {
      const n = document.querySelector('.inline-notice');
      if (!n) return { notice: null };
      const r = n.getBoundingClientRect();
      return {
        text: n.textContent,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
        inViewport: r.bottom > 0 && r.top < window.innerHeight,
        scrollY: Math.round(window.scrollY),
        role: n.getAttribute('role'),
        tone: n.className,
      };
    });
    info.hadDismissButton = had;
    await page.waitForTimeout(12000);
    info.stillThereAfter12s = await page.locator('.inline-notice').count();
    info.undoBarPresent = await page.locator('.undo-bar').count();
  }
  record('3. notice after "Ofarligt här" at 390px, scrolled to bottom', info);
  await ctx.close();
}

// ---------------------------------------------------------------- 4. Ctrl+S with no project
if (want(4)) {
  const { ctx, page } = await boot(browser);
  const before = await page.evaluate(() => ({ dialogs: document.querySelectorAll('dialog[open]').length, notice: document.querySelectorAll('.inline-notice').length }));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ dialogs: document.querySelectorAll('dialog[open]').length, notice: document.querySelectorAll('.inline-notice').length, noticeText: document.querySelector('.inline-notice')?.textContent ?? null }));
  record('4. Ctrl+S on empty workspace (no project yet)', { before, after, verdict: after.dialogs === 0 && after.notice === 0 ? 'silent no-op, browser Save suppressed' : 'something happened' });
  await ctx.close();
}

// ---------------------------------------------------------------- 5. shortcuts fire while typing in form fields
{
  const { ctx, page } = await boot(browser);
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(500);
  const nameInput = page.locator('article.document label input').first();
  await nameInput.click();
  await nameInput.type('Min dator');
  const r1 = { typedValue: await nameInput.inputValue() };
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(400);
  r1.afterCtrlEnter = { noticeCount: await page.locator('.inline-notice').count(), notice: await page.locator('.inline-notice').first().textContent().catch(() => null) };
  await nameInput.click();
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(400);
  r1.afterCtrlP = { drawerOpen: await page.locator('.project-browser, .drawer, [class*=drawer]').count(), anyOverlay: await page.evaluate(() => document.body.innerHTML.includes('Mina projekt') ) };
  r1.drawerVisible = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div,aside,section')].find(e => /project-browser|drawer/.test(e.className));
    return el ? { cls: el.className, rect: el.getBoundingClientRect().width } : null;
  });
  record('5. app shortcuts while focus is in a text input (settings page)', r1);
  await ctx.close();
}

// ---------------------------------------------------------------- 6. binding dialog validation
{
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  await page.locator('nav.top-navigation button', { hasText: 'Bindings' }).click();
  await page.waitForTimeout(600);
  const createBtn = page.locator('.bindings-page .dashboard-heading button.primary').first();
  await createBtn.click();
  await page.waitForTimeout(400);
  const dlg = page.locator('dialog[open]');
  const nameField = dlg.locator('input').first();
  const state0 = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const n = d.querySelector('input');
    return {
      title: d.querySelector('h2')?.textContent,
      nameValue: n.value, nameRequired: n.hasAttribute('required'), ariaInvalid: n.getAttribute('aria-invalid'),
      pattern: n.getAttribute('pattern'), ariaDescribedby: n.getAttribute('aria-describedby'),
      saveDisabled: [...d.querySelectorAll('button')].find(b => /Spara binding/.test(b.textContent))?.disabled,
      errorShown: Boolean(d.querySelector('.error')),
    };
  });
  // press save with empty name
  await dlg.locator('button.primary').click();
  await page.waitForTimeout(300);
  const state1 = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const err = d.querySelector('.error');
    const n = d.querySelector('input');
    const dr = d.getBoundingClientRect();
    return {
      errorText: err?.textContent ?? null,
      errorRect: err ? { top: Math.round(err.getBoundingClientRect().top), bottom: Math.round(err.getBoundingClientRect().bottom) } : null,
      errorInViewport: err ? err.getBoundingClientRect().bottom < window.innerHeight && err.getBoundingClientRect().top > 0 : null,
      dialogScrollable: d.scrollHeight > d.clientHeight,
      nameAriaInvalid: n.getAttribute('aria-invalid'),
      nameFocused: document.activeElement === n,
      activeElement: document.activeElement?.tagName + '.' + document.activeElement?.className,
      dialogTop: Math.round(dr.top), dialogBottom: Math.round(dr.bottom), innerH: window.innerHeight,
    };
  });
  // now type a 1-char name (invalid per regex) and check live feedback
  await nameField.fill('A');
  await page.waitForTimeout(250);
  const state2 = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return { errorStillShown: d.querySelector('.error')?.textContent ?? null, saveDisabled: [...d.querySelectorAll('button')].find(b => /Spara binding/.test(b.textContent))?.disabled };
  });
  record('6. BindingDialog validation', { onOpen: state0, afterSaveWithEmptyName: state1, afterTypingOneChar: state2 });
  await ctx.close();
}

// ---------------------------------------------------------------- 7. file delete
{
  const { ctx, page } = await boot(browser);
  await typeCode(page);
  await page.locator('.file-add').click();
  await page.waitForTimeout(900);
  const tabsBefore = await page.locator('.file-tab').count();
  // second (new, empty) file is active -> close it, no text
  const closers = page.locator('.file-close');
  await closers.nth(1).click();
  await page.waitForTimeout(600);
  const afterEmpty = { dialogOpen: await page.locator('dialog[open]').count(), tabs: await page.locator('.file-tab').count(), undoBar: await page.locator('.undo-bar').count() };
  // now add a file WITH text and close it
  await page.locator('.file-add').click();
  await page.waitForTimeout(900);
  await page.locator('.editor-body').click();
  await page.keyboard.insertText('viktig kod som inte får försvinna\n');
  await page.waitForTimeout(1200);
  await page.locator('.file-close').nth(1).click();
  await page.waitForTimeout(500);
  const confirmShown = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return d ? { title: d.querySelector('h2')?.textContent, body: d.querySelector('.confirm-body')?.textContent, typeToConfirm: Boolean(d.querySelector('code')) } : null;
  });
  if (confirmShown) await page.locator('dialog[open] button.danger, dialog[open] button.primary').first().click();
  await page.waitForTimeout(800);
  const afterText = { undoBar: await page.locator('.undo-bar').count(), tabs: await page.locator('.file-tab').count(), notice: await page.locator('.inline-notice').textContent().catch(() => null) };
  record('7. deleting a file', { tabsBefore, closingEmptyFile: afterEmpty, confirmForFileWithText: confirmShown, afterConfirmedDelete: afterText });
  await ctx.close();
}

// ---------------------------------------------------------------- 8. tap target real hit areas (settings checkboxes)
{
  const { ctx, page } = await boot(browser, 390, 800);
  await page.locator('nav.top-navigation button', { hasText: 'Inställningar' }).click();
  await page.waitForTimeout(800);
  const boxes = await page.evaluate(() => {
    const out = [];
    for (const input of document.querySelectorAll('input[type=checkbox]')) {
      const ir = input.getBoundingClientRect();
      const label = input.closest('label');
      const lr = label?.getBoundingClientRect();
      out.push({
        text: (label?.textContent ?? '').trim().slice(0, 48),
        input: { w: Math.round(ir.width), h: Math.round(ir.height) },
        label: lr ? { w: Math.round(lr.width), h: Math.round(lr.height), cls: label.className } : null,
        clickableLabel: Boolean(label),
      });
    }
    return out;
  });
  // and the small editor-tool buttons on the workspace
  await page.locator('a.brand').click();
  await page.waitForTimeout(600);
  const small = await page.evaluate(() => {
    const pick = ['.editor-tools button', '.file-close', '.file-add', '.view-tabs button', '.finding-actions button', '.inline-notice button', '.undo-bar button', '.text-button'];
    const out = [];
    for (const sel of pick) for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      out.push({ sel, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  record('8a. settings checkbox real hit area (390px)', boxes);
  record('8b. small controls on workspace (390px)', small);
  await ctx.close();
}

await browser.close();
log('\n\nDONE');
