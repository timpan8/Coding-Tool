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

/** Setting `location.hash` is dropped without effect while the app is busy: a route change flushes
 * the draft first, and `navigate()` restores the address bar and says "not now" rather than
 * queueing. The test then waits forever for a button on a page it never reached. Clicking the
 * navigation button is what a user does, and Playwright waits for it to be enabled. */
export async function go(page: Page, name: string, marker: string) {
  await page.getByRole('navigation', { name: 'Huvudnavigation' }).getByRole('button', { name, exact: true }).click();
  await expect(page.locator(marker)).toBeVisible();
}
