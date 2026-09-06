import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { go, open } from './app';

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

/** The app treats a large jump in one change as a paste — no editor gives it a paste event it can
 * trust — so the tests that exercise that path have to paste for real rather than type. */
async function paste(page: Page, code: string) {
  await page.locator('.code-editor').click();
  await page.evaluate(text => navigator.clipboard.writeText(text), code);
  await page.keyboard.press('Control+v');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
}

/** `all` ticks "replace the other identical occurrences too", which is off by default: rewriting
 * every occurrence of a value across the file is a choice, and the preview shows only one line. */
async function bind(page: Page, word: string, privateValue: string, category?: string, all = false) {
  await page.getByText(word, { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  if (category) await page.getByLabel('Kategori').selectOption(category);
  await page.getByLabel('Privat värde · standard').fill(privateValue);
  if (all) await page.getByLabel(/Ersätt även/).check();
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** The editor's text as the model holds it: the rendered lines in order, without the badges a
 * pill injects after a placeholder (they are not in the model) and with Monaco's no-break spaces
 * turned back into spaces. */
async function modelText(page: Page) {
  return page.locator('.view-lines').evaluate(el => Array.from(el.querySelectorAll<HTMLElement>('.view-line'))
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .map(line => { const copy = line.cloneNode(true) as HTMLElement; copy.querySelectorAll('.chip-badge').forEach(n => n.remove()); return copy.textContent ?? ''; })
    .join('\n').replace(/ /g, ' '));
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
  await page.getByRole('button', { name: /Kopiera för AI/ }).click();
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
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ })).toBeDisabled();
  // Blocked is correct; blocked with no explanation anywhere on screen was the defect.
  await expect(page.locator('.issue-panel')).toBeVisible();
  await expect(page.locator('.issue-panel')).toContainText('blockerar Kopiera för AI');
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

  await go(page, 'Backup', '.backup-panel');
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

  await go(fresh, 'Backup', '.backup-panel');
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

// Punkt 8. Ersätt-läget fanns i lagret men UI:t skickade hårdkodat 'merge', så en fil kunde bara
// slås ihop: det gick inte att komma tillbaka till exakt det valv filen beskriver. "Behåll båda"
// föll dessutom tillbaka till "behåll valvets" för allt utom projekt och bindings, utan ett ord.
test('replaces the vault with a file instead of merging into it', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await open(page);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Fanns i filen');
  await page.getByLabel('Projektnamn').press('Enter');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await page.getByLabel('Versionsetikett').fill('exporterad');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  // '#/' means "new code", so getting back to this project has to be through its own route.
  const projectUrl = page.url();

  await go(page, 'Backup', '.backup-panel');
  const download = await Promise.race([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportera hela valvet' }).click().then(() => page.waitForEvent('download')),
  ]);
  const file = test.info().outputPath('replace-source.json');
  await download.saveAs(file);

  // The vault moves on after the export: this project's draft changes, and a second project appears.
  await page.goto(projectUrl);
  await type(page, '$q = "efter exporten"\n');
  await page.evaluate(() => (location.hash = '#/'));
  await type(page, '$r = "annat projekt"\n');
  await page.getByRole('button', { name: 'Ändra projektnamn' }).click();
  await page.getByLabel('Projektnamn').fill('Fanns inte i filen');
  await page.getByLabel('Projektnamn').press('Enter');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');

  await go(page, 'Backup', '.backup-panel');
  await page.getByLabel('Välj en exporterad fil').setInputFiles(file);
  // "Keep both" says which kinds it will not apply to instead of quietly keeping the vault's copy.
  await expect(page.locator('.import-plan')).toContainText('Utkast kan inte importeras som kopior');

  await page.getByLabel('Ersätt hela valvet med filen i stället för att slå ihop').check();
  await expect(page.locator('.import-plan')).toContainText('Valvet töms först');
  await expect(page.locator('.import-plan')).not.toContainText('Vid krock');

  await page.getByRole('button', { name: 'Ersätt valvet med filen' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Ersätta hela valvet?');
  await dialog.getByLabel(/Skriv ERSÄTT/).fill('ERSÄTT');
  await dialog.getByRole('button', { name: 'Ersätt valvet' }).click();
  await expect(page.locator('.import-result')).toBeVisible();

  await page.getByRole('button', { name: 'Ladda om appen' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.locator('.project-cards')).toContainText('Fanns i filen');
  await expect(page.locator('.project-cards')).not.toContainText('Fanns inte i filen');
  await context.close();
});

// Replacing the vault with a private export would clear the projects, versions and drafts and put
// nothing back, because the file does not carry them.
test('refuses to replace the vault with a file that holds only private values', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await go(page, 'Backup', '.backup-panel');
  const download = await Promise.race([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportera bara privata värden' }).click().then(() => page.waitForEvent('download')),
  ]);
  const file = test.info().outputPath('private-only.json');
  await download.saveAs(file);

  await page.getByLabel('Välj en exporterad fil').setInputFiles(file);
  await expect(page.getByLabel('Ersätt hela valvet med filen i stället för att slå ihop')).toBeDisabled();
  await expect(page.locator('.import-plan')).toContainText('bara privata värden');
});

// Punkt 9. "Tar bort allt som hör till den här appen i den här webbläsaren" var inte sant: clearAll()
// tömmer Dexie-tabellerna och ingenting annat. Temavalet låg kvar i localStorage och service workern
// med sin cachade kopia av appen var kvar registrerad.
test('clears what it says it clears, and says what it does not', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.getByLabel('Tema').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('acv:theme'))).toBe('dark');

  await go(page, 'Backup', '.backup-panel');
  await page.getByRole('button', { name: 'Rensa hela valvet' }).click();
  const dialog = page.locator('dialog[open]');
  // The boundary of the claim belongs in the dialog rather than in the user's guess.
  await expect(dialog).toContainText('Temavalet');
  await expect(dialog).toContainText('filer du redan exporterat');
  await dialog.getByLabel(/Skriv RENSA/).fill('RENSA');
  await dialog.getByRole('button', { name: 'Rensa valvet' }).click();

  // The clear reloads the page, and a vault with no settings meets the introduction again — which
  // is the signal that the reload has landed and the assertions below read the new page.
  await page.getByRole('button', { name: 'Hoppa över' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  expect(await page.evaluate(() => localStorage.getItem('acv:theme'))).not.toBe('dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.locator('.project-card')).toHaveCount(0);
  await expect(page.locator('.empty-project-list')).toBeVisible();
});

// Punkt 7. Granskningsreglerna pekar ut och låter dig avgöra, en i taget. Blocklistan är den andra
// halvan: termer där beslutet redan är fattat byts mot en platshållare i samma stund de landar i
// arbetsytan, så företagsnamnet inte hinner följa med in i en AI-kopia.
test('puts a blocklisted term away by itself when code is pasted', async ({ page }) => {
  await go(page, 'Inställningar', '.blocklist-panel');
  await page.getByLabel('Term', { exact: true }).fill('mittforetag.se');
  await page.getByLabel('Vad AI:n ser (valfritt)').fill('example.com');
  await page.getByRole('button', { name: 'Lägg till term' }).click();
  await expect(page.locator('.blocklist-panel')).toContainText('{{MITTFORETAG_SE}}');

  await go(page, '＋ Ny kod', '.code-editor');
  // A real paste, not typing: the blocklist runs on text that arrives whole, and keyboard.type()
  // delivers one character at a time.
  await paste(page, '$url = "https://mittforetag.se/api"\n$mail = "post@mittforetag.se"\n');
  await expect(page.locator('.editor-body')).toContainText('{{MITTFORETAG_SE}}');
  await expect(page.locator('.editor-body')).not.toContainText('mittforetag.se');
  await expect(page.locator('.toast', { hasText: 'förekomster' })).toBeVisible();

  // The AI view carries the harmless value, the Local view the real one — the term became an
  // ordinary binding, so nothing else in the app had to learn about the blocklist.
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).toContainText('example.com');
  await expect(page.locator('.editor-body')).not.toContainText('mittforetag.se');
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('mittforetag.se');

  // And code that comes home from an AI finds its way back onto the placeholder.
  await page.getByRole('tab', { name: 'Mall' }).click();
  await page.getByRole('button', { name: 'Klistra in från AI ↙' }).click();
  await page.locator('textarea[aria-label="Kod från AI"]').fill('$url = "https://example.com/api"\n');
  await expect(page.locator('.ingest-decisions')).toContainText('Återställd');
  await page.getByRole('button', { name: 'Ersätt mallen' }).click();
  await expect(page.locator('.editor-body')).toContainText('{{MITTFORETAG_SE}}');
});

// The substitution is one act and has to come back in one step, with the pasted text as it stood.
test('takes back a blocklist substitution in one step', async ({ page }) => {
  await go(page, 'Inställningar', '.blocklist-panel');
  await page.getByLabel('Term', { exact: true }).fill('mittforetag.se');
  await page.getByRole('button', { name: 'Lägg till term' }).click();

  await go(page, '＋ Ny kod', '.code-editor');
  await paste(page, '$url = "https://mittforetag.se/api"\n');
  await expect(page.locator('.editor-body')).toContainText('{{MITTFORETAG_SE}}');

  await page.locator('.undo-bar').getByRole('button', { name: 'Ångra', exact: true }).click();
  await expect(page.locator('.editor-body')).toContainText('mittforetag.se');
  await expect(page.locator('.editor-body')).not.toContainText('{{MITTFORETAG_SE}}');
});

// Punkterna 10 och 2. Appen har hela tiden vetat vilken binding som äger ett värde — läckagekollen
// är byggd på det — men använde kunskapen till att vägra i stället för att erbjuda.
test('offers the binding that already holds the value instead of a second one', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n$backup = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');
  await expect(page.locator('.editor-body')).toContainText('{{HOST}}');

  // The second occurrence was left alone: replacing every occurrence is a choice now, not the
  // default, so it is still there to be bound.
  await page.getByText('sql01', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.reuse-offer')).toContainText('HOST');
  await page.getByRole('button', { name: 'Använd {{HOST}}' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // One binding, two placeholders — not a second binding holding the same private value.
  await expect(page.locator('.editor-body')).not.toContainText('sql01.corp.local');
  await page.evaluate(() => (location.hash = '#/bindings'));
  await expect(page.locator('.binding-card')).toHaveCount(1);
});

// The leak check blocked the copy and said what was wrong. Saying it is one thing; the app knows
// enough to put it right, and now offers to.
test('puts a known value back behind its placeholder from the issue panel', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');

  // Code coming back with the real value in it — what happens when it is pasted from somewhere else.
  await paste(page, '$host = "{{HOST}}"\n$backup = "sql01.corp.local"\n$port = 1433\n');
  await expect(page.locator('.issue-panel')).toContainText('HOST');

  await page.locator('.issue-row').getByRole('button', { name: 'Byt mot {{HOST}}' }).click();
  await expect(page.locator('.issue-panel')).toHaveCount(0);
  await expect(page.locator('.editor-body')).not.toContainText('sql01.corp.local');
  await expect(page.locator('.toast', { hasText: 'byttes mot platshållaren' })).toBeVisible();
});

// Punkt 4. Den farligaste händelsen i hela rundturen, och tidigare helt tyst: AI:n ger tillbaka det
// riktiga värdet där platshållaren stod. Ingenting matchar någon nivå, så rapporten löd "0
// platshållare på plats, 0 att granska" och "Ersätt mallen" tog bort skyddet utan ett ord.
test('says which placeholders the code from the AI no longer has', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');
  await expect(page.locator('.editor-body')).toContainText('{{HOST}}');

  await page.getByRole('button', { name: 'Klistra in från AI ↙' }).click();
  await page.locator('textarea[aria-label="Kod från AI"]').fill('$host = "prod-sql-07.acme.internal"\n');
  await expect(page.locator('dialog[open]')).toContainText('En platshållare försvinner');
  await expect(page.locator('dialog[open]')).toContainText('HOST');

  // The button says what it would do rather than reading like the ordinary path.
  await page.getByRole('button', { name: 'Ersätt mallen ändå' }).click();
  await expect(page.locator('.editor-body')).toContainText('prod-sql-07.acme.internal');

  // And when everything comes home it says nothing at all.
  await page.getByRole('button', { name: 'Klistra in från AI ↙' }).click();
  await page.locator('textarea[aria-label="Kod från AI"]').fill('$host = "{{HOST}}"\n$port = 1433\n');
  await expect(page.locator('dialog[open]')).not.toContainText('försvinner');
  await page.getByRole('button', { name: 'Ersätt mallen', exact: true }).click();
  await expect(page.locator('.editor-body')).toContainText('{{HOST}}');
});

// Punkt 1. Ett fynd i taget betydde en dialog per fynd, och en fil som kommer in med ett dussin av
// dem är precis när det är värst. Punkt 3: kategorin läses ur raden, inte ur markeringen ensam.
test('binds a whole set of findings in one go', async ({ page }) => {
  await type(page, '$password = "Hunter2!"\n$host = "sql01.corp.local"\n$mail = "anna@company.se"\n');
  await expect(page.locator('.finding')).toHaveCount(3);

  await page.getByLabel('Markera alla').check();
  await page.getByRole('button', { name: 'Skapa 3 bindings' }).click();
  await expect(page.locator('.finding')).toHaveCount(0);
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2!');
  await expect(page.locator('.editor-body')).not.toContainText('sql01.corp.local');
  await expect(page.locator('.editor-body')).not.toContainText('anna@company.se');

  // The password was categorised from the assignment on its line, not from the word Hunter2 alone,
  // so its AI value masks rather than reading like a name.
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).toContainText('<PASSWORD>');

  // Undo takes the bindings with it: they were made without anyone seeing them.
  await page.locator('.undo-bar').getByRole('button', { name: 'Ångra', exact: true }).click();
  await page.getByRole('tab', { name: 'Mall' }).click();
  await expect(page.locator('.editor-body')).toContainText('Hunter2!');
  await page.evaluate(() => (location.hash = '#/bindings'));
  await expect(page.locator('.binding-card')).toHaveCount(0);
});

// Punkt 5 och 6. Copy Local skriver riktiga värden, och vilka beror på en väljare i ett annat hörn
// av skärmen. Backupsidan sa ingenting om hur gammal den senaste filen är.
test('names the profile it is about to copy and says how old the last backup is', async ({ page }) => {
  await go(page, 'Backup', '.backup-panel');
  await expect(page.locator('.backup-panel')).toContainText('aldrig exporterats');

  await go(page, '＋ Ny kod', '.code-editor');
  await type(page, '$host = "prod.example.test"\n');
  await bind(page, 'prod', 'prod.internal', 'infrastructure');
  // The first press arms the real copy and shows the checklist, which names the profile.
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ }).click();
  await expect(page.locator('.exit-checklist')).toContainText('Ingen profil är vald');
  // The arming lapses by itself; wait for it so the next press arms again rather than copies.
  await expect(page.locator('.exit-checklist')).toBeHidden({ timeout: 8000 });

  await page.getByLabel('Aktiv profil').selectOption('__manage__');
  await page.getByLabel('Ny profil').fill('Test');
  await page.locator('dialog[open]').getByRole('button', { name: 'Lägg till' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();
  await page.getByLabel('Aktiv profil').selectOption({ label: 'Test' });
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ }).click();
  await expect(page.locator('.exit-checklist')).toContainText('profilen Test');
  // The details dialog is still there for anyone who wants the long version.
  await page.locator('.exit-checklist').getByRole('button', { name: 'Visa detaljer' }).click();
  await expect(page.locator('dialog[open]')).toContainText('profilen Test');
  await page.locator('dialog[open]').getByRole('button', { name: 'Avbryt' }).click();

  await go(page, 'Backup', '.backup-panel');
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportera hela valvet' }).click(),
  ]);
  await expect(page.locator('.backup-panel')).toContainText('Senast exporterat i dag');
});

// Punkt 11b. Det vanligaste fallet är värde markerat → namn → klart. Allt annat har ett fungerande
// standardvärde och ligger bakom progressive disclosure — men AI-värdet står kvar på skärmen som
// text, eftersom det är det enda fält som lämnar valvet.
test('asks only for a name in the ordinary case', async ({ page }) => {
  await type(page, '$password = "Hunter2!"\n');
  await page.getByText('Hunter2', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');

  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Bindingnamn')).toBeVisible();
  await expect(dialog.getByLabel('Scope')).toBeHidden();
  await expect(dialog.getByLabel('AI-värde')).toBeHidden();
  // Folded away, not hidden: what an AI would see is on screen either way.
  await expect(dialog.locator('.ai-sees')).toContainText('<PASSWORD>');

  await dialog.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.editor-body')).toContainText('{{PASSWORD}}');

  // Opening an existing binding is opening it for one of those fields, so they start unfolded.
  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await expect(page.locator('dialog[open]').getByLabel('AI-värde')).toBeVisible();
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
  // Two presses: the first arms and shows the checklist, the second writes the clipboard.
  const real = page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ });
  await real.click();
  await expect(page.locator('.exit-checklist')).toBeVisible();
  expect(await clipboard(page)).not.toContain('Hunter2');
  await real.click();

  await expect(page.locator('.clipboard-countdown')).toContainText('rensas om');
  expect(await clipboard(page)).toContain('Hunter2');

  // Cancelling leaves it alone, which is the whole point of showing the countdown.
  await page.locator('.clipboard-countdown').getByRole('button', { name: 'Avbryt' }).click();
  await expect(page.locator('.clipboard-countdown')).toHaveCount(0);
  expect(await clipboard(page)).toContain('Hunter2');
});

// Report F1. The rules exist to be adjusted: a value that is an example in one project is a real
// secret in another, and a company's own domain is not in any built-in list.
test('lets rules be turned off and a term of your own added', async ({ page }) => {
  // A real-looking address: one at example.com is the tool's own stand-in and is never a finding.
  await type(page, '$c = "https://intranet.mittforetag.se/api"\n$mail = "anna@company.se"\n');
  await expect(page.locator('.findings-panel')).toContainText('E-postadress');
  await expect(page.locator('.findings-panel')).not.toContainText('mittforetag.se');
  // '#/' means "new code", so returning has to be to this project's own route.
  const project = page.url();

  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Eget sökord').fill('mittforetag.se');
  await page.getByRole('button', { name: 'Lägg till sökord' }).click();
  await expect(page.locator('.toast', { hasText: 'tillagt' })).toBeVisible();

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
  // A preview is one version, not a comparison: it used to render in the diff widget with the same
  // text in both panes, so this asserts the content rather than the widget.
  await page.locator('.version-item').filter({ hasText: 'första' }).getByRole('button').first().click();
  await page.locator('.version-actions').getByRole('button', { name: 'Visa' }).click();
  await expect(page.locator('dialog[open] .version-view')).toContainText('$a = "one"');
  await expect(page.locator('dialog[open] .version-view')).not.toContainText('$b');
  await expect(page.locator('dialog[open] .diff-editor')).toHaveCount(0);
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(page.locator('.editor-body')).toContainText('$b');

  // Comparing is where the diff belongs, and each pane says which version it is.
  await page.locator('.version-item').filter({ hasText: 'andra' }).getByRole('button').first().click();
  await page.locator('.version-actions').getByRole('button', { name: 'Jämför med v1' }).click();
  await expect(page.locator('dialog[open] .diff-editor')).toBeVisible();
  await expect(page.locator('dialog[open] .version-panes')).toContainText('v1 · tidigare');
  await expect(page.locator('dialog[open] .version-delta')).toContainText('ändrad');
  await page.locator('dialog[open]').getByRole('button', { name: 'Stäng', exact: true }).click();
  // The row toggles, so collapse it again: the next section opens it itself.
  await page.locator('.version-item').filter({ hasText: 'andra' }).getByRole('button').first().click();

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

// Punkt 11a. The name is derived from the variable to the left of the selection, so two lines that
// assign to the same variable produced the same name twice. The second one was proposed anyway and
// then rejected on save with "Namnet används redan i detta scope." — an error the user had not
// caused and could not clear without inventing a name themselves.
test('proposes a name that is free when the obvious one is taken', async ({ page }) => {
  await type(page, '$username = "anna"\n$username = "bertil"\n');
  await bind(page, 'anna', 'anna');

  await page.getByText('bertil', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  await expect(page.getByLabel('Bindingnamn', { exact: true })).toHaveValue('USERNAME_2');

  // The preview follows the field. It used to keep showing the suggestion the dialog opened with,
  // so a renamed binding previewed a placeholder that was never written.
  await page.getByLabel('Bindingnamn', { exact: true }).fill('USERNAME_ALT');
  await expect(page.locator('.binding-preview .after')).toContainText('{{USERNAME_ALT}}');

  await page.getByLabel('Privat värde · standard').fill('bertil');
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.editor-body')).toContainText('{{USERNAME_ALT}}');
  await expect(page.locator('.editor-body')).not.toContainText('bertil');
});

// The name rule is checked while the user types, not only when they press save, and a rejection
// clears as soon as they start correcting it.
test('says a name is taken while it is being typed, and stops saying so once it is fixed', async ({ page }) => {
  await type(page, '$username = "anna"\n$host = "srv1"\n');
  await bind(page, 'anna', 'anna');

  await page.getByText('srv1', { exact: false }).first().dblclick();
  await page.keyboard.press('Control+b');
  await page.getByLabel('Bindingnamn', { exact: true }).fill('USERNAME');
  await expect(page.locator('dialog[open]')).toContainText('Namnet används redan i detta scope.');

  await page.getByLabel('Bindingnamn', { exact: true }).fill('HOSTNAME');
  await expect(page.locator('dialog[open]')).not.toContainText('Namnet används redan i detta scope.');
  await page.getByLabel('Privat värde · standard').fill('srv1');
  await page.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
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
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ })).toBeEnabled();
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
  await bind(page, 'Hunter2', 'Hunter2!', 'secret', true);
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
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ })).toBeEnabled();
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
  // The pill's badge shows the AI value beside the placeholder; the literal itself is gone.
  await expect(page.locator('.editor-body')).not.toContainText('"server.example.test"');
  expect(await modelText(page)).not.toContain('server.example.test');

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

  await type(page, '$password = "Hunter2!"\n');

  // Ctrl+Enter opens the AI copy review when something looks like a secret, rather than copying
  // blind. (When the file is bound and clean it copies on the spot — see the unit test.)
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
  await expect(page.locator('.toast', { hasText: 'deploy.ps1 inläst' })).toBeVisible();
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
  // Bound and clean, so the file needs no review dialog either: the button beside the AI exit
  // writes it directly, through the same audit.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.copy-actions').getByRole('button', { name: 'Spara AI-kopia som fil' }).click(),
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
  const text = await modelText(page);
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
  // The newest toast: a refusal is a warning toast, not a strip and not a modal.
  const strip = page.locator('.toast').last();
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
  // Scope is behind the disclosure now: the common case is a value in the open project, and naming
  // it is the only decision that case has left.
  await page.getByRole('button', { name: /Fler val/ }).click();
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

// Report F13, the config half. A Dockerfile is where a build secret gets written down, and RUN is
// the line where escaping cannot be promised — the shell parses it after the builder has.
test('refuses a placeholder on a Dockerfile RUN line but takes one in ENV', async ({ page }) => {
  await page.getByLabel('Språk', { exact: true }).selectOption('dockerfile');
  await type(page, 'FROM alpine\nENV TOKEN="abc123"\n');
  await bind(page, 'abc123', 'real-token-value', 'secret');
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('real-token-value');

  await page.getByRole('tab', { name: 'Mall' }).click();
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('RUN echo "{{TOKEN}}"\n');
  await expect(page.locator('.issue-panel')).toContainText('RUN, CMD, ENTRYPOINT och SHELL');
});

// Report F13, the C family. A verbatim string is where a Windows path lives, and it is the one
// place in C# where escaping the backslash would corrupt the value rather than protect it.
test('leaves the backslash alone in a C# verbatim string', async ({ page }) => {
  await page.getByLabel('Språk', { exact: true }).selectOption('csharp');
  await type(page, 'var path = @"C:\\Temp\\Secret";\n');
  await bind(page, 'Secret', 'C:\\Temp\\Real Value', 'infrastructure');

  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  const shown = (await page.locator('.editor-body').innerText()).replace(/\u00a0/g, ' ');
  // Not C:\\Temp: a verbatim string has no escape sequences, so doubling would be written literally.
  expect(shown).toContain('C:\\Temp\\Real Value');
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
  await expect(page.locator('.toast', { hasText: 'Ångrat' })).toBeVisible();
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
  await expect(page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ })).toBeDisabled();

  await page.getByText('second line').first().dblclick();
  const button = page.getByRole('button', { name: 'Kopiera markering ↗' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('.toast', { hasText: 'Markeringen kopierad' })).toBeVisible();
  await context.grantPermissions(['clipboard-read']);
  const clipped = await clipboard(page);
  // No placeholders in this fragment, so no instruction block claiming there are any.
  expect(clipped).toBe('second');

  // A fragment that does carry one is sanitised and gets the instruction.
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: 'Kopiera markering ↗' }).click();
  await expect(page.locator('.toast', { hasText: '1 värde utbytta' })).toBeVisible();
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

  // Ctrl+H does work; it was undiscoverable. The overview now names it. Inside Monaco, Ctrl+/ is
  // the editor's own comment toggle, so the overview is asked for from outside it: where focus
  // lands after a reload is a race between the lazy editor and the settings, not something to lean on.
  await page.locator('.app-footer').click();
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
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ }).click();
  const dialog = page.locator('dialog[open]');
  const save = dialog.getByRole('button', { name: 'Ladda ned som fil' });
  await expect(save).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(save).toBeEnabled();
});

// PR 2. A pasted script lists what it carries, with the line and where on it, ticked in advance
// where the line itself said what the value is. One press binds the ticked ones, each with an AI
// value nothing else in the vault uses.
test('reviews the values a pasted script carries and binds the ticked ones in one go', async ({ page }) => {
  await paste(page, [
    '$UserName = "svc_adsync"',
    '$Password = "Hunter2-Very-Secret!"',
    'Get-ADUser -Identity tlindqvist -Server dc01.corp.local',
    '$share = "\\\\fs01\\payroll\\2026"',
    '$log = "C:\\Scripts\\AdSync\\run.log"',
    '',
  ].join('\n'));
  const panel = page.locator('.findings-panel');
  await expect(panel).toContainText('Hittade');
  await expect(panel).toContainText('rad 2');
  // The context says where on the line, with the value itself masked.
  await expect(panel.locator('.finding-context').first()).toBeVisible();
  await expect(panel).not.toContainText('Hunter2-Very-Secret!');
  await expect(panel).toContainText('Hemlighet');
  // Ticked in advance: the assigned secret and usernames. A bare path match is not.
  await expect(panel.getByLabel(/Välj Tilldelning till hemlighet/)).toBeChecked();
  await expect(panel.getByLabel(/Välj Tilldelning till användarnamn/)).toBeChecked();
  await expect(panel.getByLabel(/Välj Användarnamn som parameter/)).toBeChecked();
  await expect(panel.getByLabel(/Välj Windows-sökväg/)).not.toBeChecked();

  // Pointing at a row lights its span up in the editor; the head button selects it there.
  await panel.locator('.finding').first().hover();
  await expect(page.locator('.monaco-editor .candidate-active')).toHaveCount(1);
  await panel.getByRole('button', { name: /Visa Tilldelning till hemlighet på rad 2/ }).click();
  await expect(page.locator('.monaco-editor .selected-text').first()).toBeVisible();

  await panel.getByRole('button', { name: /^Skapa \d+ bindings$/ }).click();
  await expect(page.locator('.editor-body')).toContainText('{{PASSWORD}}');
  await expect(page.locator('.editor-body')).toContainText('{{USER_NAME}}');
  await expect(page.locator('.editor-body')).toContainText('{{USERNAME}}');
  await expect(page.locator('.editor-body')).toContainText('{{SERVER}}');
  await expect(page.locator('.editor-body')).not.toContainText('Hunter2-Very-Secret!');
  await expect(page.locator('.editor-body')).not.toContainText('tlindqvist');

  // Different stand-ins for the two usernames, a full name for the full server name.
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.editor-body')).toContainText('<PASSWORD>');
  // Each substituted value carries its binding's name as a badge, so the text is not adjacent
  // to the closing quote any more; the word boundary tells example.user from example.user2.
  await expect(page.locator('.editor-body')).toContainText(/example\.user\b/);
  await expect(page.locator('.editor-body')).toContainText('example.user2');
  await expect(page.locator('.editor-body')).toContainText('server.example.test');
  // And Local gives the file back as it was pasted.
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  await expect(page.locator('.editor-body')).toContainText('svc_adsync');
  await expect(page.locator('.editor-body')).toContainText('dc01.corp.local');
});

// A value the vault already holds is offered as its placeholder rather than as a second binding.
test('offers the existing placeholder for a pasted value the vault already knows', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');
  await paste(page, '$backup = "sql01.corp.local"\n');
  const panel = page.locator('.findings-panel');
  await panel.getByRole('button', { name: 'Använd {{HOST}}' }).click();
  await expect(page.locator('.editor-body')).not.toContainText('sql01.corp.local');
  await expect(page.locator('.toast', { hasText: '{{HOST}}' })).toBeVisible();
  await page.evaluate(() => (location.hash = '#/bindings'));
  await expect(page.locator('.binding-card')).toHaveCount(1);
});

// PR 2. Error messages and transcripts carry the same values as scripts but are not scripts: the
// sanitise page runs the vault over any text and saves nothing.
test('sanitises pasted text against the vault without saving anything', async ({ page }) => {
  await type(page, '$host = "sql01.corp.local"\n');
  await bind(page, 'sql01', 'sql01.corp.local', 'infrastructure');
  await go(page, 'Sanera', '.sanitize-page');
  await page.getByLabel('Text att sanera').fill('Connection to sql01.corp.local failed for svc_adsync\nPassword = "Hunter2-Very-Secret!"\n');
  const output = page.getByLabel('Saniterad text');
  await expect(output).toHaveValue(/server\.example\.test/);
  await expect(output).not.toHaveValue(/sql01\.corp\.local/);
  await expect(page.locator('.sanitize-findings')).toContainText('Tilldelning till hemlighet');

  await page.locator('.sanitize-page').getByRole('button', { name: 'Kopiera för AI' }).click();
  await expect(page.locator('.toast', { hasText: 'Saniterad text kopierad' })).toBeVisible();
  expect(await clipboard(page)).toContain('server.example.test');

  // Binding from here makes a global binding, and the output follows it at once.
  await page.locator('.sanitize-findings').getByRole('button', { name: 'Bind nu' }).first().click();
  await expect(page.locator('dialog[open]')).toContainText('Skapa binding');
  await expect(page.locator('dialog[open]').getByLabel('Bindingnamn')).toHaveValue('PASSWORD');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();
  await expect(output).toHaveValue(/<PASSWORD>/);
  await expect(output).not.toHaveValue(/Hunter2/);

  // Nothing else was saved: still the one project from the start.
  await page.evaluate(() => (location.hash = '#/projects'));
  await expect(page.locator('.project-card')).toHaveCount(1);
});

// PR 3. A placeholder reads as a pill: braces dimmed, the name on a category-coloured ground and
// the AI value as a badge after it. The badge opens a card; the real value shows only on request
// and hides again by itself.
test('reads a placeholder as a pill and opens its card from the badge', async ({ page }) => {
  await type(page, '$password = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await expect(page.locator('.monaco-editor .binding-chip').first()).toBeVisible();
  const badge = page.locator('.monaco-editor .chip-badge').first();
  await expect(badge).toHaveText(/<PASSWORD>/);
  await badge.click();
  const card = page.getByRole('dialog', { name: 'PASSWORD' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Hemlighet');
  await expect(card).toContainText('rad 1');
  await expect(card).toContainText('<PASSWORD>');
  await expect(card).not.toContainText('Hunter2');
  await card.getByRole('button', { name: 'Visa riktigt värde' }).click();
  await expect(card).toContainText('Hunter2');
  await expect(card).toContainText('döljs om');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // In a projection the substituted value carries the name instead, and the card has no unbind.
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.locator('.monaco-editor .chip-badge').first()).toHaveText(/PASSWORD/);
  await page.locator('.monaco-editor .chip-badge').first().click();
  await expect(page.getByRole('dialog', { name: 'PASSWORD' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'PASSWORD' }).getByRole('button', { name: 'Ta bort platshållaren' })).toHaveCount(0);
});

// Removing one placeholder from its card writes the value back in that one place — the binding
// and its other occurrences stay — and the undo bar takes it back.
test('writes the value back for one placeholder from its card, with undo', async ({ page }) => {
  await type(page, '$password = "Hunter2"\n$backup = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret', true);
  await expect(page.locator('.monaco-editor .chip-badge')).toHaveCount(2);
  await page.locator('.monaco-editor .view-line', { hasText: '$backup' }).locator('.chip-badge').click();
  await page.getByRole('dialog', { name: 'PASSWORD' }).getByRole('button', { name: 'Ta bort platshållaren' }).click();
  await expect(page.locator('.toast', { hasText: 'är borttagen' })).toBeVisible();
  await expect(page.locator('.monaco-editor .chip-badge')).toHaveCount(1);
  expect(await modelText(page)).toContain('$password = "{{PASSWORD}}"\n$backup = "Hunter2"');
  await page.getByRole('button', { name: 'Ångra', exact: true }).click();
  await expect(page.locator('.monaco-editor .chip-badge')).toHaveCount(2);
  expect(await modelText(page)).not.toContain('Hunter2');
});

// The badge is injected text, not model text: the caret steps over it and typing right after the
// pill lands after the placeholder, with the placeholder intact.
test('keeps a placeholder intact when typing right after its pill', async ({ page }) => {
  await type(page, '$password = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('X');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  expect(await modelText(page)).toContain('$password = "{{PASSWORD}}X"');
  await expect(page.locator('.monaco-editor .chip-badge')).toHaveCount(1);
});

// A version saved without a label gets its line diff against the version the draft builds on,
// so two saves on the same day are told apart; the first one gets the size of the file.
test('labels an unlabelled version with its line diff', async ({ page }) => {
  await type(page, '$a = 1\n');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('dialog[open]')).toContainText('"2 rader"');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('.version-item').first()).toContainText('2 rader');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('$b = 2\n$c = 3\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await page.getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('dialog[open]')).toContainText('"+2 −0"');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara version' }).click();
  await expect(page.locator('.version-item').first()).toContainText('+2 −0');
  await expect(page.locator('.version-item').first().locator('.version-stats')).toContainText('+2 −0');
});

/** Turns encryption on through the settings page and hands back the recovery key it showed. */
async function encrypt(page: Page, password: string) {
  await go(page, 'Inställningar', '.encryption-panel');
  await page.getByRole('button', { name: 'Kryptera valvet' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Nytt lösenord', { exact: true }).fill(password);
  await dialog.getByLabel('Upprepa lösenordet', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Kryptera', exact: true }).click();
  await expect(dialog).toContainText('Din återställningsnyckel');
  const key = (await dialog.locator('.recovery-key code').innerText()).replace(/-/g, '').toLowerCase();
  await dialog.getByLabel(/Jag har sparat nyckeln/).check();
  await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  return key;
}

// PR 4. Encryption is optional and off by default. Turning it on re-encrypts what is already
// there, a reload asks for the password, and the wrong one gets nowhere.
test('encrypts the vault, locks it and opens it again with the password', async ({ page }) => {
  await type(page, '$password = "Hunter2-Very-Secret!"\n');
  await bind(page, 'Hunter2-Very-Secret!', 'Hunter2-Very-Secret!', 'secret');
  // '#/' is "new code", so coming back to this project is through its own route.
  const projectUrl = page.url();
  const recoveryKey = await encrypt(page, 'ett-langt-losenord');
  expect(recoveryKey).toMatch(/^[0-9a-f]{32}$/);
  await expect(page.locator('.encryption-panel')).toContainText('Valvet är krypterat');

  // What is on disk carries no private value any more, only the ids the database indexes.
  const stored = await page.evaluate(async () => {
    const name = (await indexedDB.databases()).map(d => d.name!).find(n => n?.startsWith('ai-code-vault'))!;
    const db = await new Promise<IDBDatabase>(resolve => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); });
    const rows = await Promise.all([...db.objectStoreNames].map(store => new Promise<unknown>(resolve => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
    })));
    return JSON.stringify(rows);
  });
  expect(stored).not.toContain('Hunter2-Very-Secret!');
  expect(stored).not.toContain('PASSWORD');
  expect(stored).toContain('enc');

  // A reload meets the lock screen, and nothing of the vault is on it. The hash is put back
  // first: changing only the hash never reloads, so the reload has to come after it.
  await page.goto(projectUrl);
  await page.reload();
  await expect(page.locator('.unlock-page')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Hunter2');
  await expect(page.locator('.work-grid')).toHaveCount(0);
  await page.getByLabel('Lösenord', { exact: true }).fill('fel-losenord');
  await page.getByRole('button', { name: 'Lås upp' }).click();
  await expect(page.locator('.unlock-card')).toContainText('Fel lösenord');
  await page.getByLabel('Lösenord', { exact: true }).fill('ett-langt-losenord');
  await page.getByRole('button', { name: 'Lås upp' }).click();
  await expect(page.locator('.work-grid')).toBeVisible();
  await expect(page.locator('.editor-body')).toContainText('{{PASSWORD}}');

  // The lock button empties the app again, and the recovery key opens it just as the password does.
  await page.getByRole('button', { name: 'Lås valvet' }).click();
  await expect(page.locator('.unlock-page')).toBeVisible();
  await page.getByRole('button', { name: 'Använd återställningsnyckel i stället' }).click();
  await page.getByLabel('Återställningsnyckel', { exact: true }).fill(recoveryKey);
  await page.getByRole('button', { name: 'Lås upp' }).click();
  await expect(page.locator('.editor-body')).toContainText('{{PASSWORD}}');
});

// The backup from an encrypted vault is encrypted too, and restoring it asks for the same secret.
test('exports an encrypted backup and restores it with the password', async ({ page }) => {
  await type(page, '$password = "Hunter2-Very-Secret!"\n');
  await bind(page, 'Hunter2-Very-Secret!', 'Hunter2-Very-Secret!', 'secret');
  await encrypt(page, 'ett-langt-losenord');

  await go(page, 'Backup', '.backup-panel');
  await expect(page.locator('.backup-panel')).toContainText('Exportfilen krypteras');
  const download = await Promise.race([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportera hela valvet' }).click().then(() => page.waitForEvent('download')),
  ]);
  const file = test.info().outputPath('encrypted-backup.json');
  await download.saveAs(file);
  expect(await readFile(file, 'utf8')).not.toContain('Hunter2-Very-Secret!');

  await page.getByLabel('Välj en exporterad fil').setInputFiles(file);
  await expect(page.locator('dialog[open]')).toContainText('Filen är krypterad');
  await page.locator('dialog[open]').getByLabel('Lösenord', { exact: true }).fill('fel-losenord');
  await page.locator('dialog[open]').getByRole('button', { name: 'Öppna filen' }).click();
  await expect(page.locator('dialog[open]')).toContainText('Fel lösenord');
  await page.locator('dialog[open]').getByLabel('Lösenord', { exact: true }).fill('ett-langt-losenord');
  await page.locator('dialog[open]').getByRole('button', { name: 'Öppna filen' }).click();
  await expect(page.locator('.import-plan')).toBeVisible();
  await expect(page.locator('.import-plan')).toContainText('redan identiska');
});

// Encryption comes off again, with the password, and the vault is readable in the clear.
test('turns encryption off again and goes back to plaintext', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  const projectUrl = page.url();
  await encrypt(page, 'ett-langt-losenord');
  await page.getByRole('button', { name: 'Stäng av kryptering' }).click();
  await page.getByRole('button', { name: 'Stäng av kryptering', exact: true }).last().click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Lösenord', { exact: true }).fill('ett-langt-losenord');
  await dialog.getByRole('button', { name: 'Stäng av kryptering', exact: true }).click();
  await expect(page.locator('.toast', { hasText: 'Krypteringen är avstängd' })).toBeVisible();
  await expect(page.locator('.encryption-panel')).toContainText('klartext');
  await page.goto(projectUrl);
  await page.reload();
  await expect(page.locator('.unlock-page')).toHaveCount(0);
  await expect(page.locator('.editor-body')).toContainText('{{P_VALUE}}');
});

// PR 5. The gate stays exact but knows the shapes a value can be written in: base64 on its way to
// an AI is still the value, and blocks the copy.
test('blocks a copy that carries a known value in base64', async ({ page }) => {
  await type(page, '$p = "Hunter2-Very-Secret!"\n');
  await bind(page, 'Hunter2-Very-Secret!', 'Hunter2-Very-Secret!', 'secret');
  const encoded = Buffer.from('Hunter2-Very-Secret!', 'utf8').toString('base64');
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`$b = "${encoded}"\n`);
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await expect(page.locator('.issue-panel')).toContainText('base64-kodat');
  // The AI exit is refused outright, the same as for a value in the clear.
  const ai = page.locator('.copy-actions').getByRole('button', { name: /Kopiera för AI/ });
  await expect(ai).toBeDisabled();
  await expect(ai).toHaveAttribute('title', /Blockerad/);
  await expect(page.locator('#copy-blocked')).toBeVisible();
});

// A value the binding used to have is still out there in code written while it was current.
test('keeps watching a value after it has been replaced', async ({ page }) => {
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  await page.getByLabel('Privat värde · standard').fill('Hunter3-New');
  await page.locator('dialog[open]').getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('.code-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# the old one was Hunter2\n');
  await expect(page.getByRole('status').first()).toContainText('Sparat lokalt');
  await expect(page.locator('.issue-panel')).toContainText('haft tidigare');
});

// Copy Local says what it carries, and the app recognises that line coming back.
test('marks the real copy and notices it coming back as an AI answer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await type(page, '$p = "Hunter2"\n');
  await bind(page, 'Hunter2', 'Hunter2', 'secret');
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ }).click();
  await page.locator('.copy-actions').getByRole('button', { name: /Kopiera RIKTIGT/ }).click();
  const copied = await clipboard(page);
  expect(copied).toContain('[REAL VALUES - never paste into AI]');
  expect(copied).toContain('$p = "Hunter2"');

  await page.getByRole('button', { name: 'Klistra in från AI ↙' }).click();
  await page.locator('textarea[aria-label="Kod från AI"]').fill(copied);
  await expect(page.locator('dialog[open]')).toContainText('ser ut att komma från din editor');
  await expect(page.locator('dialog[open]')).toContainText('Ett riktigt värde står i texten');
  await page.locator('dialog[open]').getByRole('button', { name: /Ersätt mallen/ }).click();
  // The binding is flagged as exposed, and stays flagged until the value is changed.
  await expect(page.locator('.binding-exposed')).toContainText('Exponerad');
  await page.locator('.binding-exposed').getByRole('button', { name: /Markera roterad/ }).click();
  await expect(page.locator('.binding-exposed')).toHaveCount(0);
});

// A path written against the root follows it, and a found file path binds its folder only.
test('writes a path against the root and binds only the folder', async ({ page }) => {
  await paste(page, '$log = "C:\\Temp\\AdSync\\run.log"\n');
  const projectUrl = page.url();
  const panel = page.locator('.findings-panel');
  await panel.getByLabel(/Välj Windows-sökväg/).check();
  await panel.getByRole('button', { name: /^Skapa (binding för den valda|\d+ bindings)$/ }).click();
  // The file name stays in the template: an AI may rename the log, the folder is not its business.
  expect(await modelText(page)).toContain('\\run.log"');
  expect(await modelText(page)).not.toContain('C:\\Temp\\AdSync\\run.log');

  await page.locator('.binding-card').getByLabel(/^Redigera /).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.root-offer')).toContainText('C:\\Temp');
  await dialog.getByRole('button', { name: 'Skriv mot roten' }).click();
  await expect(dialog.locator('.root-offer')).toContainText('{{ROOT}}');
  await dialog.getByRole('button', { name: 'Spara binding' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // Moving the root moves the path with it, without touching the binding.
  await go(page, 'Inställningar', '.encryption-panel');
  await page.getByLabel('Rot för arbetsmappar').fill('D:\\Projekt');
  await page.getByLabel('Rot för arbetsmappar').blur();
  await expect(page.locator('.toast', { hasText: 'Roten är ändrad' })).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.locator('.work-grid')).toBeVisible();
  await page.getByRole('tab', { name: 'Local' }).click();
  await page.getByRole('button', { name: 'Visa värden' }).click();
  // Read from the model: in a projection the substituted value carries its binding's name as an
  // injected badge, which sits between the value and the rest of the line on screen.
  await expect(async () => expect(await modelText(page)).toContain('D:\\Projekt\\AdSync\\run.log')).toPass({ timeout: 5000 });
});
