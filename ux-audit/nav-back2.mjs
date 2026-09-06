import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:4173';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const out = [];
const snap = async (tag) => {
  const url = page.url();
  const st = await page.evaluate(() => ({
    len: history.length,
    hash: location.hash,
    wsHidden: document.querySelector('.workspace')?.hasAttribute('hidden'),
    ovHidden: [...document.querySelectorAll('.overview-scroll')].map(e => e.hasAttribute('hidden')),
    secHidden: document.querySelector('main > div:nth-child(3)')?.hasAttribute('hidden'),
    visibleText: (document.querySelector('main')?.innerText ?? '').trim().slice(0, 90).replace(/\n/g, ' | '),
    notice: document.querySelector('.inline-notice')?.textContent ?? '',
  }));
  out.push(`${tag.padEnd(30)} url=${url.replace(base,'')}\n     len=${st.len} wsHidden=${st.wsHidden} ovHidden=${JSON.stringify(st.ovHidden)}\n     main="${st.visibleText}"\n     notice="${st.notice}"`);
};
await page.goto(base + '/#/'); await page.waitForTimeout(900);
const skip = page.locator('dialog[aria-label="Så fungerar AI Code Vault"] button', { hasText: 'Hoppa över' }).first();
if (await skip.isVisible().catch(()=>false)) { await skip.click(); await page.waitForTimeout(300); }
await page.locator('.editor-body').click();
await page.keyboard.type('$a = "x"\n'); await page.waitForTimeout(1300);
await snap('A. project created');
await page.locator('.top-navigation button', { hasText: 'Inställningar' }).click(); await page.waitForTimeout(700);
await snap('B. settings');
await page.goBack(); await page.waitForTimeout(1000); await snap('C. back 1');
await page.goBack(); await page.waitForTimeout(1200); await snap('D. back 2 (past start)');
await page.screenshot({ path: 'ux-audit/screens/zz-back-past-start.png' });
await page.goForward(); await page.waitForTimeout(1200); await snap('E. forward 1');
console.log(out.join('\n'));
await b.close();
