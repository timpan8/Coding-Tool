import { expect, type Page } from '@playwright/test';

/** Opens the app and gets past the introduction.
 *
 * Every test gets its own browser context and so its own empty vault, which means the introduction
 * is always shown — it is waited for rather than probed for, so a missing one fails the test here
 * instead of surfacing as a mystery click timeout later. Dismissing it is what a real first-time
 * user does once; the test that covers the introduction itself uses its own context. */
export async function open(page: Page, hash = '#/') {
  await page.goto(`/${hash}`);
  await page.getByRole('button', { name: 'Hoppa över' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
