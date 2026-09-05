// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as mount, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { IndexedDbProvider } from '../storage/IndexedDbProvider';
import { binding, project, version } from '../test/fixtures/factories';

// Minimal UI tests isolate Monaco's canvas rendering; real domain + IndexedDB are used.
vi.mock('./editor/CodeEditor', () => ({ CodeEditor: ({ value, readOnly, onChange, onBinding }: {
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
  fireEvent.change(await screen.findByLabelText('Namn'), { target: { value: 'ADMIN_USERNAME' } });
  fireEvent.change(screen.getByLabelText('Privat värde · standard'), { target: { value: 'synthetic.user' } });
  fireEvent.click(screen.getByRole('button', { name: 'Spara binding' }));
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('{{ADMIN_USERNAME}}'));
  fireEvent.click(screen.getByRole('button', { name: 'Spara version' }));
  await waitFor(async () => expect(await storage.listVersions((await storage.listProjects())[0].id)).toHaveLength(1));
  fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
  expect((editor as HTMLTextAreaElement).value).toContain('synthetic.user');
  fireEvent.click(screen.getByRole('tab', { name: 'AI' }));
  expect((editor as HTMLTextAreaElement).value).toContain('example.user');
  expect((editor as HTMLTextAreaElement).value).not.toContain('synthetic.user');
  fireEvent.click(screen.getByRole('button', { name: /Copy for AI/ }));
  expect(clipboard).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Jag har granskat · kopiera för AI' }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('$username = "example.user"'));
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
  fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
  expect((editor as HTMLTextAreaElement).value).toContain('••••••••');
  expect((editor as HTMLTextAreaElement).value).not.toContain('SuperSecret123!');
  fireEvent.click(screen.getByRole('button', { name: 'Copy Local' }));
  expect(clipboard).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Kopiera LOCAL med secrets' }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith('$password = "SuperSecret123!"'));
});

it('blocks both copy actions when a binding is unresolved', async () => {
  const p = project(), v = version(p); await storage.commitVersion({ ...p, currentVersionId: v.id }, v);
  location.hash = `#/project/${p.id}`; mount(<App storage={storage} />);
  await screen.findByLabelText('Testkod');
  expect((screen.getByRole('button', { name: 'Copy Local' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /Copy for AI/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(clipboard).not.toHaveBeenCalled();
});
