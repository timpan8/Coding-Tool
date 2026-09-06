import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173/';
const SAMPLE = `$adminUser = "tim.andersson"\n$adminPassword = "Hunter2-Very-Secret!"\n$dbHost = "sql-prod-01.internal.example.com"\n$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"\n`;
// Anything that destroys data or leaves the page is probed for reachability only, never clicked.
const NEVER_CLICK = /radera|ta bort|rensa|återställ|importera|exportera|ersätt|glöm|nollställ|^×$/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read','clipboard-write'] });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const close = page.locator('dialog[open] .dialog-head button'); if (await close.count()) await close.first().click();
await page.waitForTimeout(400);
await page.locator('.editor-body').click();
await page.keyboard.insertText(SAMPLE);
await page.waitForTimeout(1800);

const fingerprint = () => page.evaluate(() => {
  const main = document.querySelector('#huvudinnehall');
  const vis = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden';
  }).length;
  return JSON.stringify({
    url: location.hash,
    dialog: document.querySelector('dialog[open]')?.getAttribute('aria-label') ?? null,
    notice: document.querySelector('.inline-notice')?.textContent ?? null,
    visibleCount: vis,
    // the rendered text of main, normalised: the cheapest true "did anything change"
    text: (main?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 6000),
    active: document.activeElement?.className?.toString().slice(0, 30) ?? null,
  });
});

const results = [];
async function probeRoute(route, label) {
  await page.goto(BASE + route); await page.waitForTimeout(1000);
  const handles = await page.locator('button:visible, a[href]:visible').elementHandles();
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    const meta = await h.evaluate(el => ({
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      cls: el.className?.toString().slice(0, 46), tag: el.tagName.toLowerCase(),
      disabled: el.disabled === true, href: el.getAttribute('href') ?? null,
    })).catch(() => null);
    if (!meta) continue;
    if (meta.disabled) { results.push({ route: label, ...meta, verdict: 'DISABLED' }); continue; }
    if (NEVER_CLICK.test(meta.text)) { results.push({ route: label, ...meta, verdict: 'SKIPPED-destructive' }); continue; }
    const before = await fingerprint();
    try { await h.click({ timeout: 2500 }); } catch { results.push({ route: label, ...meta, verdict: 'NOT-CLICKABLE' }); continue; }
    await page.waitForTimeout(650);
    const after = await fingerprint();
    results.push({ route: label, ...meta, verdict: before === after ? 'NO-CHANGE' : 'ok' });
    // return to a clean state
    if (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.goto(BASE + route); await page.waitForTimeout(800);
  }
}

await probeRoute('#/', 'workspace');
await probeRoute('#/projects', 'projects');
await probeRoute('#/bindings', 'bindings');
await probeRoute('#/settings', 'settings');
await probeRoute('#/security', 'security');

const interesting = results.filter(r => r.verdict !== 'ok');
console.log(`Probade ${results.length} element. Icke-triviala: ${interesting.length}\n`);
for (const r of interesting) console.log(`${r.verdict.padEnd(20)} ${r.route.padEnd(10)} ${r.tag} "${r.text}" .${r.cls}`);
console.log('\n--- duplicate labels within a route ---');
const seen = {};
for (const r of results) { const k = r.route + '|' + r.text; seen[k] = (seen[k] || 0) + 1; }
for (const [k, n] of Object.entries(seen)) if (n > 1 && k.split('|')[1]) console.log(`  ${n}x  ${k}`);
await browser.close();
