import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173/';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SAMPLE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
Connect-Database -User $adminUser -Password $adminPassword -Server $dbHost
`;

const browser = await chromium.launch();
const out = [];

async function scan(page, label, opts = {}) {
  let b = new AxeBuilder({ page }).withTags(TAGS).exclude('.monaco-editor');
  if (opts.include) b = b.include(opts.include);
  const r = await b.analyze();
  const rec = {
    label,
    violations: r.violations.map(v => ({
      id: v.id, impact: v.impact, n: v.nodes.length,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map(n => ({
        target: n.target.join(' '),
        summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 260),
      })),
    })),
    incomplete: r.incomplete.map(v => ({ id: v.id, n: v.nodes.length, help: v.help,
      nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target.join(' '), summary: (n.failureSummary||'').replace(/\s+/g,' ').slice(0,200) })) })),
    passes: r.passes.length,
  };
  out.push(rec);
  const v = rec.violations.length ? rec.violations.map(x => `${x.id}(${x.n})`).join(', ') : 'none';
  console.log(`[${label}] violations: ${v} | incomplete: ${rec.incomplete.map(x=>`${x.id}(${x.n})`).join(', ') || 'none'} | passes ${rec.passes}`);
}

async function ctxFor(theme) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addInitScript(t => { try { localStorage.setItem('acv:theme', t); } catch {} }, theme);
  return ctx;
}

for (const theme of ['light', 'dark']) {
  // ---- fresh vault: intro modal itself
  {
    const ctx = await ctxFor(theme);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await scan(page, `${theme} / intro modal (first visit)`);
    await ctx.close();
  }

  // ---- main routes on one context with content
  {
    const ctx = await ctxFor(theme);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const close = page.locator('dialog[open] .dialog-head button');
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(400);

    await scan(page, `${theme} / #/ empty workspace`);

    // Settings & security & bindings & projects before content
    for (const r of ['#/settings', '#/security']) {
      await page.goto(BASE + r); await page.waitForTimeout(900);
      await scan(page, `${theme} / ${r}`);
    }

    // back to workspace, paste code
    await page.goto(BASE + '#/'); await page.waitForTimeout(800);
    await page.locator('.editor-body').click();
    await page.keyboard.type(SAMPLE, { delay: 1 });
    await page.waitForTimeout(2500);
    await scan(page, `${theme} / workspace with code + findings`);

    // view tabs: local & ai
    for (const tab of ['Local', 'AI']) {
      const btn = page.locator(`.view-tabs button`, { hasText: new RegExp(`^${tab}`) });
      if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(700);
        await scan(page, `${theme} / workspace view=${tab}`); }
    }
    const tpl = page.locator('.view-tabs button').first();
    await tpl.click(); await page.waitForTimeout(400);

    // projects & bindings now that a project exists
    for (const r of ['#/projects', '#/bindings']) {
      await page.goto(BASE + r); await page.waitForTimeout(900);
      await scan(page, `${theme} / ${r}`);
    }

    // project route
    const pid = await page.evaluate(() => {
      const a = document.querySelector('.project-card');
      return a ? true : false;
    });
    await page.goto(BASE + '#/projects'); await page.waitForTimeout(700);
    if (pid) {
      await page.locator('.project-card').first().click();
      await page.waitForTimeout(900);
      await scan(page, `${theme} / #/project/:id`);
    }

    // shortcuts modal
    await page.getByRole('button', { name: /genvägar|Kortkommandon/i }).first().click().catch(()=>{});
    await page.waitForTimeout(500);
    if (await page.locator('dialog[open]').count()) {
      await scan(page, `${theme} / shortcuts modal`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }

    // copy dialog (AI)
    await page.goto(BASE + '#/'); await page.waitForTimeout(800);
    const aiCopy = page.locator('button.ai-copy');
    if (await aiCopy.count() && await aiCopy.first().isEnabled()) {
      await aiCopy.first().click(); await page.waitForTimeout(700);
      if (await page.locator('dialog[open]').count()) {
        await scan(page, `${theme} / copy dialog (AI)`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      }
    } else { console.log(`[${theme}] AI copy button disabled - copy dialog skipped`); }

    // binding dialog
    await page.goto(BASE + '#/bindings'); await page.waitForTimeout(800);
    const create = page.locator('.bindings-page button', { hasText: /Ny binding|Skapa/i });
    if (await create.count()) {
      await create.first().click(); await page.waitForTimeout(700);
      if (await page.locator('dialog[open]').count()) {
        await scan(page, `${theme} / binding dialog`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      }
    }
    await ctx.close();
  }
}

writeFileSync(new URL('./axe-results.json', import.meta.url), JSON.stringify(out, null, 1));
await browser.close();

// summary
const all = new Map();
for (const r of out) for (const v of r.violations) {
  const k = v.id; const e = all.get(k) ?? { id: k, impact: v.impact, help: v.help, where: [], nodes: [] };
  e.where.push(`${r.label} x${v.n}`); e.nodes.push(...v.nodes); all.set(k, e);
}
console.log('\n===== SUMMARY =====');
if (!all.size) console.log('No WCAG A/AA violations found by axe on any scanned state.');
for (const e of all.values()) {
  console.log(`\n## ${e.id} [${e.impact}] - ${e.help}`);
  console.log('   states: ' + e.where.join(' | '));
  for (const n of e.nodes.slice(0, 5)) console.log(`   - ${n.target} :: ${n.summary}`);
}
