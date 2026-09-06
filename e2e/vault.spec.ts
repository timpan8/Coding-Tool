import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { open } from './app';

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

async function clipboard(page: Page) {
  // readText() rejects when the document is not focused, which is a timing-dependent way for a
  // clipboard assertion to fail for reasons that have nothing to do with the clipboard.
  await page.bringToFront();
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ page }) => {
  await open(page);
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
  // Scoped to the editor: '{{' also appears in the settings page's AI instruction, which is in the
  // DOM but hidden, and an unscoped match picked it up whenever it rendered first.
  const placeholder = page.locator('.monaco-editor').getByText('{{', { exact: false }).first();
  await placeholder.click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // The deliberate gesture still opens it.
  await placeholder.dblclick();
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
  await open(page);
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
  await open(fresh);
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
  // Navigating before the delete settles would be cancelled, so wait for its acknowledgement — the
  // undo bar, which is what reports a delete now.
  await expect(page.locator('.undo-bar')).toContainText('Ska raderas är raderat');

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
  expect(await clipboard(page)).toContain('Hunter2');

  // Cancelling leaves it alone, which is the whole point of showing the countdown.
  await page.locator('.clipboard-countdown').getByRole('button', { name: 'Avbryt' }).click();
  await expect(page.locator('.clipboard-countdown')).toHaveCount(0);
  expect(await clipboard(page)).toContain('Hunter2');
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
  await expect(page.locator('.file-tab').filter({ hasText: 'del2.ps1' })).toBeVisible();

  await page.locator('.code-editor').click();
  await page.keyboard.type('$second = "two"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByLabel('Språk', { exact: true }).selectOption('python');
  await expect(page.locator('.file-tab').filter({ hasText: 'del2.py' })).toBeVisible();

  // Switching back shows the first file untouched, still PowerShell.
  await page.locator('.file-tab').filter({ hasText: 'script.ps1' }).click();
  await expect(page.locator('.editor-body')).toContainText('$first');
  await expect(page.locator('.editor-body')).not.toContainText('$second');
  await expect(page.getByLabel('Språk', { exact: true })).toHaveValue('powershell');

  // And it survives a reload, which is where a session-only file list would show.
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.reload();
  await expect(page.locator('.file-tab').filter({ hasText: 'script.ps1' })).toBeVisible();
  await expect(page.locator('.file-tab').filter({ hasText: 'del2.py' })).toBeVisible();
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

// Report F9 and F10. description, tags and status were set once at creation and never editable,
// while the project search matched against tags the user had no way to add.
test('makes project metadata editable and the list worth reading', async ({ page }) => {
  await type(page, '$a = "one"\n');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Rapportskript');
  await page.getByLabel('Projektnamn').press('Enter');

  await page.getByRole('button', { name: 'Om projektet' }).click();
  await page.getByLabel('Beskrivning').fill('Plockar ut månadsrapporten');
  await page.getByLabel('Taggar').fill('rapport, drift');
  await page.getByLabel('Projektstatus').selectOption('stable');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.evaluate(() => (location.hash = '#/projects'));
  const card = page.locator('.project-card').filter({ hasText: 'Rapportskript' });
  await expect(card).toContainText('Plockar ut månadsrapporten');
  await expect(card).toContainText('rapport');
  await expect(card).toContainText('Stabil');

  // The search now matches a tag, which it always claimed to do.
  await page.getByLabel('Sök i alla projekt').fill('drift');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.getByLabel('Sök i alla projekt').fill('');

  // And a status filter that excludes it empties the list.
  await page.getByLabel('Filtrera på status').selectOption('broken');
  await expect(page.locator('.project-card')).toHaveCount(0);
});

// Report F14, F16 and F17. Deleting a binding left {{NAME}} behind with nothing to resolve it, so
// copying stayed blocked until every one was found by hand.
test('offers to write the value back when a binding is deleted', async ({ page }) => {
  await type(page, '$p = "Hunter2!"\n');
  await bind(page, 'Hunter2', 'Hunter2!', 'secret');
  await expect(page.locator('.editor-body')).toContainText('{{');

  await page.locator('.binding-card').getByLabel(/^Radera /).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Skriv tillbaka det privata värdet');
  await dialog.getByRole('button', { name: 'Radera bindingen' }).click();

  // The value is back in the template rather than an unresolvable placeholder.
  await expect(page.locator('.editor-body')).toContainText('Hunter2!');
  await expect(page.locator('.editor-body')).not.toContainText('{{');
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ })).toBeEnabled();
});

// A binding can also be prepared before the code that uses it exists.
test('creates a binding without a selection and warns when it is unused', async ({ page }) => {
  await type(page, '$p = "placeholder"\n');
  await page.locator('.binding-panel').getByRole('button', { name: '＋ Ny' }).click();
  await page.getByLabel('Bindingnamn').fill('FUTURE_TOKEN');
  await page.getByLabel('Privat värde · standard').fill('abc123');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();

  await expect(page.locator('.binding-card')).toContainText('FUTURE_TOKEN');
  await expect(page.locator('.binding-card')).toContainText('0 förekomster');
  await expect(page.locator('.orphan-note')).toBeVisible();
});

// Report F15. The name was locked after creation "to preserve the templates' references", which
// solved the problem by removing the feature.
test('renames a binding and rewrites its placeholder everywhere', async ({ page }) => {
  await type(page, '$a = "Hunter2!"\n$b = "Hunter2!"\n');
  await bind(page, 'Hunter2', 'Hunter2!', 'secret');
  await expect(page.locator('.binding-card')).toContainText('2 förekomster');

  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await page.getByLabel('Bindingnamn').fill('DB_PASSWORD');
  await expect(page.locator('dialog[open]')).toContainText('skrivs om i alla versioner');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await expect(page.locator('.editor-body')).toContainText('{{DB_PASSWORD}}');
  await expect(page.locator('.editor-body')).not.toContainText('PASSWORD}}"\n$b = "{{P');
  await expect(page.locator('.binding-card')).toContainText('DB_PASSWORD');
  await expect(page.locator('.binding-card')).toContainText('2 förekomster');

  // Still resolvable, so copying is not blocked by a dangling name.
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ })).toBeEnabled();
});

// Report F18. Binding.values was keyed by profile and resolveValue already had the fallback, but
// the top bar showed a fixed "Profil: Standard" label that looked like a control and was not one.
test('holds a separate value per profile and falls back to the default', async ({ page }) => {
  await type(page, '$host = "prod.example.test"\n');
  await bind(page, 'prod', 'prod.internal', 'infrastructure');

  await page.getByLabel('Aktiv profil').selectOption('__manage__');
  await page.getByLabel('Ny profil').fill('Test');
  await page.locator('dialog[open]').getByRole('button', { name: 'Lägg till' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();

  // Give the binding a value for that profile only.
  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await page.getByLabel('Privat värde för Test').fill('test.internal');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();

  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('prod.internal');

  await page.getByLabel('Aktiv profil').selectOption({ label: 'Test' });
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('test.internal');
  await expect(page.locator('.editor-body')).not.toContainText('prod.internal');
});

// Report F21. A placeholder had to be typed from memory, exactly, or it silently resolved to
// nothing and blocked the copy.
test('completes placeholder names in the editor', async ({ page }) => {
  await type(page, '$a = "Hunter2!"\n');
  await bind(page, 'Hunter2', 'Hunter2!', 'secret');
  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await page.getByLabel('Bindingnamn').fill('DB_PASSWORD');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n$b = "{{');
  await expect(page.locator('.suggest-widget')).toBeVisible();
  await expect(page.locator('.suggest-widget')).toContainText('DB_PASSWORD');
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor-body')).toContainText('$b = "{{DB_PASSWORD}}');
});

// Report P6 and U15. Monaco was almost the whole bundle and loaded before anything could be typed.
test.describe('narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  // The introduction is the first thing a phone sees. Nothing was wrong with it — a narrow-screen
  // failure here turned out to be a duplicated navigation in the test, not a layout bug — but it is
  // the one dialog every new user meets on whatever device they have, so it is held in place.
  test('keeps the introduction usable on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toContainText('Mall — den du redigerar');
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    for (const name of ['Hoppa över', 'Nästa']) {
      const button = dialog.getByRole('button', { name });
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }
    await dialog.getByRole('button', { name: 'Hoppa över' }).click();
    await expect(dialog).toHaveCount(0);
    await context.close();
  });

  test('uses the plain editor instead of Monaco', async ({ page }) => {
    // beforeEach already opened the app at this viewport; navigating again would only repeat it.
    await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
    // Monaco has no touch selection handles and its scrolling fights the page's; the textarea is
    // the better editor here, not a downgrade.
    await expect(page.locator('.plain-editor')).toBeVisible();
    await expect(page.locator('.monaco-editor')).toHaveCount(0);

    await page.locator('.plain-editor').fill('$p = "Hunter2!"\n');
    await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
    await page.reload();
    await expect(page.locator('.plain-editor')).toHaveValue(/Hunter2/);
  });
});

// Report F5 and F6. Code went out with placeholders and came back changed, and the values had to
// be put back by hand — which is where they get lost.
test('puts placeholders back into code that comes home from an AI', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');
  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await page.getByLabel('AI-värde').fill('server.example.test');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Klistra in från AI ↙' }).click();
  // What an AI typically returns: the example value back in place, plus new code around it.
  await page.locator('textarea[aria-label="Kod från AI"]').fill('$host = "server.example.test"\n$port = 1433\n');
  await expect(page.locator('.ingest-decisions')).toContainText('Återställd');
  await page.getByRole('button', { name: 'Ersätt mallen' }).click();

  await expect(page.locator('.editor-body')).toContainText('$host = "{{');
  await expect(page.locator('.editor-body')).toContainText('$port = 1433');
  await expect(page.locator('.editor-body')).not.toContainText('server.example.test');

  // And the private value is behind the placeholder again, not lost.
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('sql01.corp.local');
});

// Report F28. The shortcuts were documented only in the README, and two of them were taken by the
// browser: Ctrl+K by Firefox's search bar, Ctrl+Shift+C by the element inspector.
test('lists its shortcuts and uses combinations the browser leaves alone', async ({ page }) => {
  await page.getByRole('button', { name: 'Visa kortkommandon' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Ctrl+Enter');
  await expect(dialog).toContainText('utvecklarverktygen');
  await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();

  await type(page, '$p = "Hunter2!"\n');
  await bind(page, 'Hunter2', 'Hunter2!', 'secret');

  // Ctrl+Enter opens the AI copy review rather than copying blind.
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('dialog[open]')).toContainText('AI-export');
  await page.locator('dialog[open]').getByRole('button', { name: 'Avbryt' }).click();

  // Ctrl+S asks for a version label.
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Versionsetikett')).toBeVisible();
});

// Report U14 and F11. The language was always PowerShell until changed by hand, and code could
// only arrive by paste and only leave through the clipboard.
// Report F11. A dropped file is the shortest way in for code that already lives on disk, and the
// extension is a better signal for the language than any guess from the contents.
test('reads a file dropped onto the workspace', async ({ page }) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['$db = "sql01.corp.local"\n'], 'deploy.ps1', { type: 'text/plain' }));
    const grid = document.querySelector('.work-grid')!;
    grid.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true }));
    grid.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  });
  await expect(page.locator('.inline-notice')).toContainText('deploy.ps1 inläst');
  await expect(page.getByLabel('Språk', { exact: true })).toHaveValue('powershell');
  await expect(page.locator('.file-tabs')).toContainText('deploy.ps1');
  await expect(page.locator('.editor-body')).toContainText('sql01.corp.local');
});

test('recognises the language of pasted code and can write the result to a file', async ({ page }) => {
  await expect(page.getByLabel('Språk', { exact: true })).toHaveValue('powershell');
  // A real paste, not typing: a guess from the first character would be worthless.
  await page.locator('.code-editor').click();
  await page.evaluate(() => navigator.clipboard.writeText('def main():\n    password = "Hunter2!"\n'));
  await page.keyboard.press('Control+v');
  await expect(page.getByLabel('Språk', { exact: true })).toHaveValue('python');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await bind(page, 'Hunter2', 'Hunter2!', 'secret');
  await page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ }).click();
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.locator('dialog[open]').getByRole('button', { name: 'Ladda ned som fil' }).click(),
  ]).then(([d]) => d);

  expect(download.suggestedFilename()).toContain('ai-');
  const file = test.info().outputPath('ai-copy.py');
  await download.saveAs(file);
  const written = await readFile(file, 'utf8');
  expect(written).toContain('<PASSWORD>');
  expect(written).not.toContain('Hunter2!');
});

// Saving a binding asked the editor to reveal the new placeholder, but the request stayed set, and
// the reveal effect also runs when the text changes — so every keystroke afterwards re-selected the
// placeholder and the next character overwrote it. Typing a line after creating a binding scrambled
// the file: `$p = "{{P_VALUE}}"` became `$p = "q = "plain value here"`.
test('does not eat the placeholder when you keep typing after creating a binding', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('$q = "plain value here"\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  // Monaco renders no-break spaces, so the text is normalised before it is compared.
  const text = (await page.locator('.view-lines').innerText()).replace(/\u00a0/g, ' ');
  expect(text).toContain('$p = "{{P_VALUE}}"');
  expect(text).toContain('$q = "plain value here"');
});

// The reveal itself must still work: clicking a binding in the panel selects its placeholder.
test('still reveals a placeholder when its binding is clicked', async ({ page }) => {
  await type(page, '$p = "Hunter2"\nWrite-Host "padding"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.locator('.binding-panel').getByRole('button', { name: /P_VALUE/ }).first().click();
  await expect(page.locator('.monaco-editor .selected-text').first()).toBeVisible();
});

// Report U6, U7 and U10. Actions that were refused did nothing and said nothing, and every failure
// that was reported at all arrived as a full-screen modal.
test('says why an action was refused instead of doing nothing', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');

  // Ctrl+B in the Local view was the clearest case: nothing happened, with nothing said.
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  const strip = page.locator('.inline-notice');
  await expect(strip).toContainText('Byt till Mall-vyn');
  // A refusal is not a modal: the page stays usable.
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(strip).toHaveClass(/warn/);

  await page.getByRole('tab', { name: 'Mall' }).click();
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+b');
  await expect(strip).toContainText('Markera värdet');
});

// Report U10. One search box behind two views: typing in the drawer changed the overview's filter.
test('keeps the two project searches apart', async ({ page }) => {
  await type(page, '$a = "one"\n');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Alfa');
  await page.getByLabel('Projektnamn').press('Enter');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await page.getByRole('button', { name: 'Mina projekt' }).click();
  await page.getByLabel('Sök projekt').fill('hittar-ingenting');
  await expect(page.locator('.drawer-projects')).toContainText('Inga projekt matchar');
  await page.getByRole('button', { name: 'Stäng projektpanelen' }).click();

  // The overview's own field is untouched, so the project is still listed there.
  await page.getByRole('button', { name: 'Bindings' }).click();
  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.getByLabel('Sök i alla projekt')).toHaveValue('');
  await expect(page.locator('.project-card')).toHaveCount(1);
});

// Report F14. Bindings were reachable only through the project they belong to, which left a global
// binding — the whole point of the global scope — unreachable unless some project happened to use
// it, and a value from a deleted project invisible rather than gone.
test('lists every binding in the vault, including global ones', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');

  await page.getByRole('button', { name: 'Bindings' }).click();
  const table = page.locator('.binding-table');
  await expect(table).toContainText('P_VALUE');
  await expect(table).toContainText('Projekt');

  // A global binding can be made here. With a project open it still defaults to that project — the
  // scope is a choice, and the page is what makes the global one reachable at all.
  await page.getByRole('button', { name: '＋ Ny binding' }).click();
  await page.getByLabel('Bindingnamn').fill('SHARED_TOKEN');
  await page.getByLabel('Scope').selectOption('global');
  await page.getByLabel('Privat värde · standard').fill('token-abc-123');
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(table).toContainText('SHARED_TOKEN');

  // Filtering by scope is what makes a global one findable at all.
  await page.getByLabel('Filtrera på räckvidd').selectOption('global');
  await expect(table).toContainText('SHARED_TOKEN');
  await expect(table).not.toContainText('P_VALUE');
  await expect(page.locator('.binding-filters')).toContainText('1 av 2');

  await page.getByLabel('Sök binding').fill('inget som finns');
  await expect(page.locator('.empty-binding-list')).toBeVisible();
});

// Report F13. Adding a language means adding its escaping rule, or values fall through to the
// generic one and are escaped for the wrong syntax. This is the end-to-end half of that.
test('handles a Terraform file end to end, interpolation and all', async ({ page }) => {
  await page.getByLabel('Språk', { exact: true }).selectOption('hcl');
  await type(page, 'resource "aws_db" "main" {\n  password = "s3cret"\n}\n');
  await bind(page, 's3cret', '${var.injected}', 'secret');

  // The private value is an interpolation. Terraform would evaluate it, so Local must write it
  // with the sigil doubled rather than live.
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('$${var.injected}');

  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('var.injected');
});

// A .env file is the most likely thing a user brings to this tool, and it is named by its
// extension alone.
test('names a dotenv file the way a dotenv file is named', async ({ page }) => {
  await page.getByLabel('Språk', { exact: true }).selectOption('dotenv');
  await type(page, 'API_KEY=abc123\n');
  await expect(page.locator('.file-tabs')).toContainText('.env');
  await expect(page.locator('.file-tabs')).not.toContainText('script.env');
});

// Report U13. Mall/Local/AI is the whole idea of the tool and was explained only by three banner
// lines. Shown once on a fresh vault, and never again after it is closed.
test('introduces the three views once, and can be brought back', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Mall — den du redigerar');

  await dialog.getByRole('button', { name: 'Nästa' }).click();
  await expect(dialog).toContainText('Local — koden med riktiga värden');
  await dialog.getByRole('button', { name: 'Nästa' }).click();
  await expect(dialog).toContainText('AI — koden utan dina värden');
  await expect(dialog).toContainText('Ingenting lämnar den här datorn');
  await dialog.getByRole('button', { name: 'Sätt igång' }).click();
  await expect(dialog).toHaveCount(0);

  // Closing it counts as having seen it, so a reload does not put it back.
  await page.reload();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // But it is still reachable for someone who wants it again.
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('button', { name: 'Visa introduktionen igen' }).click();
  await expect(page.locator('dialog[open]')).toContainText('Mall — den du redigerar');
  await context.close();
});

// Report U17. A delete is irreversible once the records are gone, so the way back is captured
// before the delete and offered for ten seconds.
test('undoes a deleted project, with its versions and bindings', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Ångra-provet');
  await page.getByLabel('Projektnamn').press('Enter');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await page.getByRole('button', { name: 'Radera projekt' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel(/Skriv RADERA/).fill('RADERA');
  await dialog.getByRole('button', { name: 'Radera projektet' }).click();
  // Wait for the delete to settle before navigating: a navigation while the app is busy is
  // refused, and the projects page is only hidden, so assertions would pass against stale markup.
  await expect(page.locator('.undo-bar')).toContainText('Ångra-provet är raderat');
  await page.getByRole('button', { name: 'Mina projekt' }).click();
  await page.getByRole('button', { name: 'Visa alla projekt →' }).click();
  await expect(page.locator('.empty-project-list')).toBeVisible();

  await page.locator('.undo-bar').getByRole('button', { name: 'Ångra', exact: true }).click();
  await expect(page.locator('.inline-notice')).toContainText('Ångrat');
  const card = page.locator('.project-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Ångra-provet');
  // The version and the binding came back with it, not just the project row.
  await expect(card).toContainText('1 versioner');
  await expect(card).toContainText('1 bindings');
});

// The offer disappears on its own, so it can never be mistaken for a lasting way back.
test('withdraws the undo offer when the window has passed', async ({ page }) => {
  await type(page, '$a = "one"\n');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('.version-item')).toHaveCount(2);

  // v1 rather than v2: the draft is based on the newest version, which cannot be deleted.
  await page.locator('.version-item').last().getByRole('button', { name: /^v1/ }).click();
  await page.locator('.version-item').last().getByRole('button', { name: /Radera/ }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Radera versionen' }).click();
  await expect(page.locator('.undo-bar')).toBeVisible();
  await expect(page.locator('.undo-bar')).toBeHidden({ timeout: 15000 });
});

// Report U19. Asking an AI about one function should not mean handing over the whole file.
test('copies a selection in sanitised form without the rest of the file', async ({ page, context }) => {
  await type(page, '$p = "Hunter2"\nWrite-Host "second line"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  // A hole further down blocks a whole-file copy but must not block the selection.
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('$q = "{{NO_SUCH_BINDING}}"\n');
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ })).toBeDisabled();

  await page.getByText('second line').first().dblclick();
  const button = page.getByRole('button', { name: 'Kopiera markering ↗' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('.inline-notice')).toContainText('Markeringen kopierad');
  await context.grantPermissions(['clipboard-read']);
  const clipped = await clipboard(page);
  // No placeholders in this fragment, so no instruction block claiming there are any.
  expect(clipped).toBe('second');

  // A fragment that does carry one is sanitised and gets the instruction.
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'Kopiera markering ↗' }).click();
  await expect(page.locator('.inline-notice')).toContainText('1 värde utbytta');
  const second = await clipboard(page);
  expect(second).toContain('<PASSWORD>');
  expect(second).toContain('Behåll dem exakt');
  expect(second).not.toContain('Hunter2');
  expect(second).not.toContain('NO_SUCH_BINDING');
});

// Report U18. Font size and wrap were hardcoded; find and replace worked but nothing said so.
test('keeps editor preferences and points at the editor commands', async ({ page }) => {
  await type(page, '$a = "one"\n');
  const tools = page.getByRole('group', { name: 'Editorinställningar' });
  await expect(tools).toContainText('14 px');
  await tools.getByRole('button', { name: 'Större text' }).click();
  await expect(tools).toContainText('15 px');
  // The editor itself, not just the label: the option has to reach Monaco.
  await expect(page.locator('.monaco-editor .view-line').first()).toHaveCSS('font-size', '15px');
  const wrap = tools.getByRole('button', { name: /Radbrytning/ });
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');

  // Settings, not component state: they survive a reload.
  await page.reload();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await expect(page.getByRole('group', { name: 'Editorinställningar' })).toContainText('15 px');
  await expect(page.locator('.monaco-editor .view-line').first()).toHaveCSS('font-size', '15px');
  await expect(page.getByRole('group', { name: 'Editorinställningar' }).getByRole('button', { name: /Radbrytning/ }))
    .toHaveAttribute('aria-pressed', 'false');

  // Ctrl+H does work; it was undiscoverable. The overview now names it.
  await page.keyboard.press('Control+/');
  await expect(page.locator('dialog[open]')).toContainText('Sök och ersätt');
  await page.getByRole('button', { name: 'Stäng', exact: true }).click();
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+h');
  await expect(page.locator('.monaco-editor .find-widget')).toHaveClass(/replaceToggled/);
});

// A file is as easy to paste into a chat as the clipboard is, so it goes through the same gate.
test('holds the download behind the same review as the clipboard', async ({ page }) => {
  await type(page, '$db = "AKIAIOSFODNN7EXAMPLE"\n');
  await page.locator('.copy-actions').getByRole('button', { name: /Copy for AI/ }).click();
  const dialog = page.locator('dialog[open]');
  const save = dialog.getByRole('button', { name: 'Ladda ned som fil' });
  await expect(save).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(save).toBeEnabled();
});
