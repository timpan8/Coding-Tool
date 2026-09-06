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
test('explains why a copy button is disabled', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# the old value was Hunter2\n');
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ })).toBeDisabled();
  // Blocked is correct; blocked with no explanation anywhere on screen was the defect.
  await expect(page.locator('.issue-panel')).toBeVisible();
  await expect(page.locator('.issue-panel')).toContainText('blockerar Copy for AI');
  await expect(page.locator('.copy-blocked')).toBeVisible();
  // The problem is reachable: clicking it switches to the projection that has it.
  await page.locator('.issue-item').first().click();
  await expect(page.getByRole('tab', { name: 'AI' })).toHaveAttribute('aria-selected', 'true');
});

// Report U3. onMouseDown opens the edit dialog, so the caret can never be placed inside a
// placeholder and a stray click during editing throws up a modal.
test('lets the caret be placed inside a placeholder', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByText('{{', { exact: false }).first().click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // The deliberate gesture still opens it.
  await page.getByText('{{', { exact: false }).first().dblclick();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
});

// Report F19 and invariant 9. Masking and the second confirmation before Copy Local both key off
// category, and the name heuristic read only the variable name, so `$p = "Hunter2"` came out as
// identity and the password rendered in the clear. The scanner rules now read the value's shape.
test('masks a password-shaped value the heuristic would have mis-categorised', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Visa värden' }).click();
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
  await page.getByLabel('Versionsetikett').fill('inför backup');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
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

// Report F4. clipboardAutoClearSeconds existed in the model, defaulted to 0 and was never read, so
// a real password stayed on the clipboard until something else replaced it.
test('counts down and clears the clipboard after a local copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Rensa urklipp efter Copy Local').selectOption('30');
  await page.evaluate(() => (location.hash = '#/'));

  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.copy-actions').getByRole('button', { name: 'Copy Local' }).click();
  await page.getByRole('button', { name: 'Kopiera LOCAL med secrets' }).click();

  await expect(page.locator('.clipboard-countdown')).toContainText('Urklippet rensas om');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Hunter2');

  // Cancelling leaves it alone, which is the whole point of showing the countdown.
  await page.locator('.clipboard-countdown').getByRole('button', { name: 'Avbryt' }).click();
  await expect(page.locator('.clipboard-countdown')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Hunter2');
});

// Report F1. The rules exist to be adjusted: a value that is an example in one project is a real
// secret in another, and a company's own domain is not in any built-in list.
test('lets rules be turned off and a term of your own added', async ({ page }) => {
  await type(page, '$c = "https://intranet.mittforetag.se/api"\n$mail = "anna@example.com"\n');
  await expect(page.locator('.findings-panel')).toContainText('E-postadress');
  await expect(page.locator('.findings-panel')).not.toContainText('mittforetag.se');
  // '#/' means "new code", so returning has to be to this project's own route.
  const project = page.url();

  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Eget sökord').fill('mittforetag.se');
  await page.getByRole('button', { name: 'Lägg till sökord' }).click();
  await expect(page.locator('.import-result, .inline-notice')).toContainText('tillagt');

  await page.goto(project);
  await expect(page.locator('.findings-panel')).toContainText('mittforetag.se');

  // Turning a built-in off removes its findings without touching the others.
  await page.evaluate(() => (location.hash = '#/settings'));
  // click() rather than uncheck(): the new state arrives after a write to IndexedDB, which
  // uncheck()'s immediate re-read does not wait for.
  const emailRule = page.locator('.rule-row').filter({ hasText: 'E-postadress' }).getByRole('checkbox');
  await emailRule.click();
  await expect(emailRule).not.toBeChecked();
  await page.goto(project);
  await expect(page.locator('.findings-panel')).toContainText('mittforetag.se');
  await expect(page.locator('.findings-panel')).not.toContainText('E-postadress');
});

// Report F7. Project.files was already an array and draft templates were already keyed by file id,
// but the UI only ever used files[0], so a project could hold exactly one file.
test('keeps several files in a project, each with its own text and language', async ({ page }) => {
  await type(page, '$first = "one"\n');
  await page.getByRole('button', { name: 'Lägg till fil' }).click();
  await expect(page.getByRole('tab', { name: 'del2.ps1' })).toBeVisible();

  await page.locator('.code-editor').click();
  await page.keyboard.type('$second = "two"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByLabel('Språk').selectOption('python');
  await expect(page.getByRole('tab', { name: 'del2.py' })).toBeVisible();

  // Switching back shows the first file untouched, still PowerShell.
  await page.getByRole('tab', { name: 'script.ps1' }).click();
  await expect(page.locator('.editor-body')).toContainText('$first');
  await expect(page.locator('.editor-body')).not.toContainText('$second');
  await expect(page.getByLabel('Språk')).toHaveValue('powershell');

  // And it survives a reload, which is where a session-only file list would show.
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'script.ps1' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'del2.py' })).toBeVisible();
});

// Report F22-F25. Every version was saved without a label, so the list read the same line all the
// way down with a date and no time; there was no way to look at one without replacing the draft,
// no comparison, and no way to remove one.
test('labels versions, compares them and deletes one', async ({ page }) => {
  await type(page, '$a = "one"\n');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.getByLabel('Versionsetikett').fill('första');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('.version-history')).toContainText('första');

  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('$b = "two"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.getByLabel('Versionsetikett').fill('andra');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('.version-history')).toContainText('andra');

  // Looking at a version must not touch the draft, which was the only way to see one before.
  await page.locator('.version-item').filter({ hasText: 'första' }).getByRole('button').first().click();
  await page.locator('.version-actions').getByRole('button', { name: 'Visa' }).click();
  await expect(page.locator('.diff-editor')).toBeVisible();
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(page.locator('.editor-body')).toContainText('$b');

  // A version the draft is built on cannot be deleted out from under it.
  await page.locator('.version-item').filter({ hasText: 'andra' }).getByRole('button').first().click();
  await page.locator('.version-actions').getByRole('button', { name: 'Radera' }).click();
  await expect(page.locator('dialog[open]')).toContainText('Återställ en annan först');
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();

  await page.locator('.version-item').filter({ hasText: 'första' }).getByRole('button').first().click();
  await page.locator('.version-actions').getByRole('button', { name: 'Radera' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Radera versionen' }).click();
  await expect(page.locator('.version-history')).not.toContainText('första');
  await expect(page.locator('.version-history')).toContainText('andra');
});

// Report F20. Double-clicking a value stops at a word boundary, so `Hunter2!` selected `Hunter2`
// and the template kept the exclamation mark: half the password stayed, and everything after that
// looked like it had worked.
test('binds the whole string literal, not the part a double click caught', async ({ page }) => {
  await type(page, '$password = "Hunter2!"\n');
  await page.getByText('Hunter2', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');

  // The dialog shows what the line will become before anything is replaced.
  await expect(page.locator('.binding-preview .after')).toContainText('$password = "{{');
  await expect(page.locator('.binding-preview .after')).not.toContainText('!"');

  await page.getByLabel('Privat värde · standard').fill('Hunter2!');
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // Nothing of the value is left beside the placeholder.
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2');
  await expect(page.locator('.editor-body')).not.toContainText('}}!');

  // And the AI projection carries the placeholder's value, not a fragment of the real one.
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2');
});
