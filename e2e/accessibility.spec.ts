import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open } from './app';

/** Report T1–T6. Measured rather than reasoned about: the previous pass found the tab list had no
 * panel to control, several buttons shared the name "Redigera", and two greys sat below AA. */
async function audit(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // Monaco renders its own widget tree and is not this project's to fix.
  const results = await (context ? builder.include(context) : builder).exclude('.monaco-editor').analyze();
  return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
}

test('the workspace has no accessibility violations', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  expect(await audit(page)).toEqual([]);
});

test('the workspace stays clean with code, bindings and findings on screen', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.locator('.code-editor').click();
  await page.keyboard.type('$password = "Hunter2!"\n$host = "sql01.corp.local"\n');
  await expect(page.locator('.findings-panel')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('the armed real copy, its checklist and a toast stay clean', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.locator('.code-editor').click();
  await page.keyboard.type('$p = "Hunter2"\n');
  await page.getByText('Hunter2', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  await page.getByLabel('Kategori').selectOption('secret');
  await page.getByLabel('Privat värde · standard').fill('Hunter2');
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // Arming shows the checklist; Ctrl+B in the Local view raises a warning toast.
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ }).click();
  await expect(page.locator('.exit-checklist')).toBeVisible();
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.toast').last()).toContainText('Byt till Mall-vyn');
  expect(await audit(page)).toEqual([]);
});

test('the sanitise page has no accessibility violations', async ({ page }) => {
  await open(page, '#/sanitize');
  await expect(page.locator('.sanitize-page')).toBeVisible();
  await page.getByLabel('Text att sanera').fill('Password = "Hunter2-Very-Secret!"');
  await expect(page.locator('.sanitize-findings')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('the settings page has no accessibility violations', async ({ page }) => {
  await open(page, '#/settings');
  await expect(page.locator('.rules-panel')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('the backup page has no accessibility violations', async ({ page }) => {
  await open(page, '#/backup');
  await expect(page.locator('.backup-panel')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('the project list has no accessibility violations', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.locator('.code-editor').click();
  await page.keyboard.type('$a = "one"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.locator('.project-card')).toHaveCount(1);
  expect(await audit(page)).toEqual([]);
});

test('the bindings page has no accessibility violations', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.locator('.code-editor').click();
  await page.keyboard.type('$a = "one"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByRole('button', { name: 'Bindings' }).click();
  await expect(page.locator('.bindings-page')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('the security page has no accessibility violations', async ({ page }) => {
  await open(page, '#/security');
  await expect(page.locator('article.document').first()).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('offers a skip link that stays out of the way until it is focused', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  const skip = page.getByRole('link', { name: 'Hoppa till innehållet' });

  // Present for a keyboard, off-screen for everyone else.
  await expect(skip).toHaveCSS('position', 'absolute');
  const hidden = await skip.boundingBox();
  expect(hidden!.y).toBeLessThan(0);

  await skip.focus();
  // It slides in, so wait for the transition rather than measuring mid-flight.
  await expect(async () => {
    const shown = await skip.boundingBox();
    expect(shown!.y).toBeGreaterThanOrEqual(0);
  }).toPass({ timeout: 3000 });

  await page.keyboard.press('Enter');
  await expect(page.locator('#huvudinnehall')).toBeVisible();
});
