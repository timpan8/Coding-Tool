// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as mount, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { IndexedDbProvider } from '../storage/IndexedDbProvider';
import { binding, project, version } from '../test/fixtures/factories';

// Minimal UI tests isolate Monaco's canvas rendering; real domain + IndexedDB are used.
vi.mock('./editor/Editor', () => ({ Editor: ({ value, readOnly, onChange, onBinding }: {
  value: string; readOnly: boolean; onChange: (v: string) => void;
  onBinding: (s: { text: string; start: number; end: number; lineBefore: string; line: number }) => void;
}) => <><textarea aria-label="Testkod" value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />
  <button onClick={() => { const start = value.indexOf('example.user'); onBinding({ text: 'example.user', start, end: start + 12, lineBefore: '$username = "', line: 1 }); }}>Testmarkering</button></> }));
let storage: IndexedDbProvider;
const clipboard = vi.fn(async (_text: string) => {});
beforeEach(() => {
  storage = new IndexedDbProvider('ui-test-' + crypto.randomUUID());
  location.hash = '#/';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  clipboard.mockClear();
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await storage.destroy(); });

it('creates a project from first input, binds a selected value, renders both views and persists a template version', async () => {
  mount(<App storage={storage} />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sparat lokalt'));
  const editor = await screen.findByLabelText('Testkod');
  fireEvent.change(editor, { target: { value: '$username = "example.user"' } });
  await waitFor(() => expect(storage.listProjects()).resolves.toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sparat lokalt'));
  const nameButton = await screen.findByRole('button', { name: 'Ändra projektnamn' });
  fireEvent.click(nameButton);
  fireEvent.change(screen.getByLabelText('Projektnamn'), { target: { value: 'Create-ADUsers' } });
  fireEvent.keyDown(screen.getByLabelText('Projektnamn'), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Testmarkering' }));
  fireEvent.change(await screen.findByLabelText('Bindingnamn'), { target: { value: 'ADMIN_USERNAME' } });
  fireEvent.change(screen.getByLabelText('Privat värde · standard'), { target: { value: 'synthetic.user' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spara binding' }));
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('{{ADMIN_USERNAME}}'));
  // Saving now asks for a label first, so the history is readable.
  fireEvent.click(screen.getByRole('button', { name: 'Spara version' }));
  const labelField = await screen.findByLabelText('Versionsetikett');
  fireEvent.change(labelField, { target: { value: 'första rundan' } });
  fireEvent.click(within(labelField.closest('dialog')!).getByRole('button', { name: 'Spara version' }));
  await waitFor(async () => expect(await storage.listVersions((await storage.listProjects())[0].id)).toHaveLength(1));
  expect((await storage.listVersions((await storage.listProjects())[0].id))[0].label).toBe('första rundan');
  fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
  // Masked by default whatever the category: the category is guessed from the variable name.
  expect((editor as HTMLTextAreaElement).value).not.toContain('synthetic.user');
  fireEvent.click(screen.getByRole('button', { name: 'Visa värden' }));
  expect((editor as HTMLTextAreaElement).value).toContain('synthetic.user');
  fireEvent.click(screen.getByRole('tab', { name: 'AI' }));
  expect((editor as HTMLTextAreaElement).value).toContain('example.user');
  expect((editor as HTMLTextAreaElement).value).not.toContain('synthetic.user');
  // One value bound and nothing that looks like a secret left over: the copy needs no review, so
  // one press writes the clipboard and no dialog opens.
  fireEvent.click(screen.getByRole('button', { name: /Kopiera för AI/ }));
  // The AI copy now carries an instruction block above the code, as a comment in the file's own
  // language, telling the model to leave the placeholders alone.
  await waitFor(() => expect(clipboard).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Jag har granskat · kopiera för AI' })).toBeNull();
  const copied = clipboard.mock.calls.at(-1)![0];
  expect(copied).toContain('$username = "example.user"');
  expect(copied).toContain('# Koden nedan har privata värden');
  const projects = await storage.listProjects(), versions = await storage.listVersions(projects[0].id);
  expect(versions[0].templates[projects[0].files[0].id]).toBe('$username = "{{ADMIN_USERNAME}}"');
});

it('masks local secrets and requires a second deliberate action to copy them', async () => {
  const p = project(), v = version(p), b = binding({ scopeRef: p.id });
  await storage.commitVersion({ ...p, currentVersionId: v.id }, v); await storage.saveBinding(b);
  location.hash = `#/project/${p.id}`;
  mount(<App storage={storage} />);
  const editor = await screen.findByLabelText('Testkod');
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('{{ADMIN_PASSWORD}}'));
  // Opening the project runs through the same guard as any other write, and a copy asked for
  // while that is in flight is refused rather than queued. Waiting for the workspace to settle is
  // what the other tests do; without it this one races the startup read of the vault.
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sparat lokalt'));
  fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
  expect((editor as HTMLTextAreaElement).value).toContain('••••••••');
  expect((editor as HTMLTextAreaElement).value).not.toContain('SuperSecret123!');
  // The first press only arms the button and shows the checklist; the second press copies.
  fireEvent.click(screen.getByRole('button', { name: /Kopiera RIKTIGT/ }));
  expect(clipboard).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Kopiera RIKTIGT · tryck igen' })).toBeTruthy();
  expect(screen.getByText(/1 riktigt värde skrivs in i klartext/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Kopiera RIKTIGT/ }));
  // The local copy starts with the line that says what it carries; the code follows it verbatim.
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('# [REAL VALUES - never paste into AI] v1\n$password = "SuperSecret123!"'));
});

it('blocks both copy actions when a binding is unresolved', async () => {
  const p = project(), v = version(p); await storage.commitVersion({ ...p, currentVersionId: v.id }, v);
  location.hash = `#/project/${p.id}`; mount(<App storage={storage} />);
  await screen.findByLabelText('Testkod');
  expect((screen.getByRole('button', { name: /Kopiera RIKTIGT/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /Kopiera för AI/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(clipboard).not.toHaveBeenCalled();
});
