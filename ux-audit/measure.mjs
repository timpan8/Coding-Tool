import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173/';
const out = {};

const browser = await chromium.launch();

async function fresh(width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read','clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const close = page.locator('dialog[open] .dialog-head button');
  if (await close.count()) await close.first().click();
  await page.waitForTimeout(300);
  return { ctx, page };
}

// ---------- A. horizontal overflow + nav reachability ----------
out.overflow = {};
for (const w of [390, 768, 1440]) {
  const { ctx, page } = await fresh(w);
  const routes = ['#/', '#/projects', '#/bindings', '#/settings', '#/security'];
  out.overflow[w] = {};
  for (const r of routes) {
    await page.goto(BASE + r); await page.waitForTimeout(700);
    out.overflow[w][r] = await page.evaluate(() => {
      const de = document.documentElement;
      const nav = document.querySelector('.top-navigation');
      const navBox = nav?.getBoundingClientRect();
      const items = nav ? [...nav.querySelectorAll('button')].map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim().slice(0, 24), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
                 clippedByViewport: r.right > window.innerWidth + 1 };
      }) : [];
      return {
        docScrollW: de.scrollWidth, innerW: window.innerWidth,
        bodyOverflowsX: de.scrollWidth > window.innerWidth + 1,
        navScrollW: nav ? nav.scrollWidth : null, navClientW: nav ? Math.round(navBox.width) : null,
        navOverflows: nav ? nav.scrollWidth > nav.clientWidth + 1 : null,
        navOverflowStyle: nav ? getComputedStyle(nav).overflowX : null,
        navItems: items,
      };
    });
  }
  await ctx.close();
}

// ---------- B. tap targets < 44px ----------
out.tapTargets = {};
for (const w of [390, 1440]) {
  const { ctx, page } = await fresh(w);
  out.tapTargets[w] = {};
  for (const r of ['#/', '#/projects', '#/bindings', '#/settings', '#/security']) {
    await page.goto(BASE + r); await page.waitForTimeout(700);
    out.tapTargets[w][r] = await page.evaluate(() => {
      const sel = 'button, a[href], select, input:not([type=hidden]), [role=tab], [role=button], summary';
      return [...document.querySelectorAll(sel)]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; })
        .map(el => { const r = el.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0,40),
                   label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
                   w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(e => e.h < 44 || e.w < 44)
        .sort((a,b) => (a.h*a.w) - (b.h*b.w));
    });
  }
  await ctx.close();
}

// ---------- C. focus visibility + tab order ----------
{
  const { ctx, page } = await fresh(1440);
  out.focus = {};
  for (const r of ['#/', '#/settings']) {
    await page.goto(BASE + r); await page.waitForTimeout(700);
    await page.evaluate(() => document.body.focus());
    const seq = [];
    for (let i = 0; i < 28; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return null;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0,40),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0,34),
          outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow.slice(0, 60), inViewport: r.top >= 0 && r.bottom <= window.innerHeight };
      });
      if (info) seq.push(info);
    }
    out.focus[r] = seq;
  }
  await ctx.close();
}

// ---------- D. headings & landmarks ----------
{
  const { ctx, page } = await fresh(1440);
  out.semantics = {};
  for (const r of ['#/', '#/projects', '#/bindings', '#/settings', '#/security']) {
    await page.goto(BASE + r); await page.waitForTimeout(700);
    out.semantics[r] = await page.evaluate(() => {
      const visible = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0 && !el.closest('[hidden]'); };
      return {
        headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible)
          .map(h => `${h.tagName} ${h.textContent.trim().slice(0,50)}`),
        h1count: [...document.querySelectorAll('h1')].filter(visible).length,
        landmarks: [...document.querySelectorAll('header,nav,main,aside,footer,[role=navigation],[role=main]')]
          .filter(visible).map(l => `${l.tagName}${l.getAttribute('aria-label') ? ':'+l.getAttribute('aria-label') : ''}`),
        ariaCurrent: [...document.querySelectorAll('[aria-current]')].map(e => e.textContent.trim().slice(0,20)),
        title: document.title, lang: document.documentElement.lang,
        imagesNoAlt: [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length,
        unlabelledControls: [...document.querySelectorAll('input,select,textarea')].filter(visible).filter(el =>
          !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') &&
          !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest('label')
        ).map(el => `${el.tagName}.${el.className}`),
        emptyNameButtons: [...document.querySelectorAll('button')].filter(visible)
          .filter(b => !(b.getAttribute('aria-label') || b.textContent.trim())).length,
      };
    });
  }
  await ctx.close();
}

writeFileSync(new URL('./measure.json', import.meta.url), JSON.stringify(out, null, 1));
await browser.close();
console.log('written');
