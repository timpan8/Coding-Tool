import { expect, test, type Page } from '@playwright/test';

/** Browser-level tests against the real Monaco editor.
 *
 * The unit suite mocks Monaco with a textarea, which is why several of the defects below survived
 * it: clicking a placeholder, dialog focus and the copy gate are all editor-level behaviour.
 *
 * Each scenario that describes a known defect is marked `test.fail()`. The commit that fixes the
 * defect removes the marker, so the history carries proof that the bug existed and then did not. */

async function type(page: Page, code: string) {
  await page.locator('.code-editor').click();
  await page.keyboard.type(code);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
}

async function bind(page: Page, word: string, privateValue: string, category?: string) {
  await page.getByText(word, { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  if (category) await page.getByLabel('Kategori').selectOption(category);
  await page.getByLabel('Privat värde · standard').fill(privateValue);
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
});

// Report K1. The headline defect: nothing is bound, so nothing is known, and the app says so in
// the affirmative and then copies the secret verbatim.
test('does not claim a clean review of code it has not checked', async ({ page }) => {
  await type(page, '$password = "Hunter2!"\n');
  await page.getByRole('button', { name: /Copy for AI/ }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('Inga kända problem hittades');
});

// Report U1. The leak check runs only in AI mode, so in the template view the copy button is
// disabled with the reason rendered nowhere on screen.
test.fail('explains why a copy button is disabled', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# the old value was Hunter2\n');
  await expect(page.getByRole('button', { name: /Copy for AI/ })).toBeDisabled();
  // Blocked is correct; blocked with no explanation anywhere on screen is the defect.
  await expect(page.locator('.issue-panel')).toBeVisible();
});

// Report U3. onMouseDown opens the edit dialog, so the caret can never be placed inside a
// placeholder and a stray click during editing throws up a modal.
test.fail('lets the caret be placed inside a placeholder', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByText('{{', { exact: false }).first().click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

// Report F19 and invariant 9. Masking and the second confirmation before Copy Local both key off
// category alone, and the suggestion heuristic reads only the variable name: `$p = "Hunter2"`
// becomes `identity`, so a password is rendered in the clear. The value's own shape is ignored.
test.fail('masks a password-shaped value the heuristic mis-categorised', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2');
  await page.getByRole('tab', { name: 'Local' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2');
});

// Guards that must keep passing throughout the rewrite.
test('keeps private values out of the AI projection', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2');
});

test('masks a value categorised as a secret until it is revealed', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByRole('tab', { name: 'Local' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2');
  await page.getByRole('button', { name: 'Visa secrets' }).click();
  await expect(page.locator('.editor-body')).toContainText('Hunter2');
});

// Report F2. The vault lives in one browser profile, so an export is the only way back from
// cleared site data. This drives the whole round trip: export, a fresh empty vault, restore.
test('restores a vault from an exported file', async ({ browser }) => {
  const source = await browser.newContext();
  const page = await source.newPage();
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Backup-provet');
  await page.getByLabel('Projektnamn').press('Enter');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await page.evaluate(() => (location.hash = '#/settings'));
  const download = await Promise.race([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportera hela valvet' }).click().then(() => page.waitForEvent('download')),
  ]);
  // Saved before the context closes: Playwright deletes a download's temp file with its context.
  const file = test.info().outputPath('vault-backup.json');
  await download.saveAs(file);
  await source.close();

  // A separate context is a separate origin storage: an empty vault, as after clearing site data.
  const restored = await browser.newContext();
  const fresh = await restored.newPage();
  await fresh.goto('/');
  await expect(fresh.getByRole('status').first()).toContainText('Sparat lokalt');
  await fresh.evaluate(() => (location.hash = '#/projects'));
  await expect(fresh.locator('.project-cards')).not.toContainText('Backup-provet');

  await fresh.evaluate(() => (location.hash = '#/settings'));
  await fresh.getByLabel('Välj en exporterad fil').setInputFiles(file);
  await expect(fresh.locator('.import-plan')).toContainText('0 krockar');
  await fresh.getByRole('button', { name: 'Slå ihop med valvet' }).click();
  await expect(fresh.locator('.import-result')).toBeVisible();

  await fresh.getByRole('button', { name: 'Ladda om appen' }).click();
  await expect(fresh.getByRole('status').first()).toContainText('Sparat lokalt');
  await fresh.evaluate(() => (location.hash = '#/projects'));
  await expect(fresh.locator('.project-cards')).toContainText('Backup-provet');
  await restored.close();
});

// Report F8 and U5. Deleting was not possible from the UI at all, and the confirmations that did
// exist were native dialogs, two of which opened on top of an already open <dialog>.
test('requires a typed confirmation before deleting a project', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Ska raderas');
  await page.getByLabel('Projektnamn').press('Enter');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await page.getByRole('button', { name: 'Radera projekt' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('försvinner för alltid');
  const remove = dialog.getByRole('button', { name: 'Radera projektet' });
  await expect(remove).toBeDisabled();

  await dialog.getByLabel(/Skriv RADERA/).fill('RADERA');
  await expect(remove).toBeEnabled();
  await remove.click();
  // Navigating before the delete settles would be cancelled, so wait for its acknowledgement.
  await expect(page.locator('.inline-notice')).toContainText('Ska raderas raderat');

  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.locator('.project-cards')).not.toContainText('Ska raderas');
  await expect(page.locator('.empty-project-list')).toBeVisible();
});
