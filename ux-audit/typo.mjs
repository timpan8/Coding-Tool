import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173/';
const SAMPLE = `# deploy.ps1
$adminUser = "tim.andersson"
$adminPassword = "Hunter2-Very-Secret!"
$dbHost = "sql-prod-01.internal.example.com"
$apiKey = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"
Connect-Database -User $adminUser -Password $adminPassword -Server $dbHost
`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const c = page.locator('dialog[open] .dialog-head button'); if (await c.count()) await c.first().click();
await page.waitForTimeout(300);
await page.locator('.editor-body').click(); await page.waitForTimeout(200);
await page.keyboard.insertText(SAMPLE);
await page.waitForTimeout(1800);

const dump = await page.evaluate(() => {
  const seen = new Map();
  const els = document.querySelectorAll('main *, header *, footer *');
  const out = [];
  for (const el of els) {
    if (el.closest('.monaco-editor')) continue;
    // only elements with own direct text
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      text: own.slice(0, 46),
      fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, ls: cs.letterSpacing,
      tt: cs.textTransform, bg: cs.backgroundColor,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return out;
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
