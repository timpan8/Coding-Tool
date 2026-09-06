// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render as mount, screen } from '@testing-library/react';
import { VersionViewer, versionFiles } from './VersionViewer';
import { project, version } from '../../test/fixtures/factories';
import type { ProjectFile } from '../../types/models';

// Monaco renders to a canvas and owns its own layout; the file the viewer decides to show is the
// behaviour under test, so both editors are stood in for by something readable.
vi.mock('../editor/Editor', () => ({ Editor: ({ value }: { value: string }) => <textarea readOnly aria-label="Versionsinnehåll" value={value} /> }));
vi.mock('../editor/DiffEditor', () => ({ DiffEditor: ({ original, modified }: { original: string; modified: string }) =>
  <div data-testid="diff" data-original={original} data-modified={modified} /> }));

afterEach(cleanup);

const shown = () => (screen.getByLabelText('Versionsinnehåll') as HTMLTextAreaElement).value;
const file = (name: string): ProjectFile => ({ id: crypto.randomUUID(), name, language: 'powershell', order: 0 });
const show = (props: Partial<Parameters<typeof VersionViewer>[0]>) => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  const p = project();
  return mount(<VersionViewer version={version(p)} compareTo={null} activeFileId={p.files[0].id} currentFiles={p.files}
    language="powershell" theme="light" close={() => {}} restore={() => {}} {...props} />);
};

it('falls back to the file ids in templates when the version predates the recorded file list', () => {
  const p = project();
  const v = version(p);
  expect(v.files).toBeUndefined();
  // The name is borrowed from the project, so a version written before `files` existed still reads
  // as a file rather than as a uuid.
  expect(versionFiles(v, p.files)).toEqual([{ ...p.files[0] }]);
});

it('names a file the project no longer has rather than dropping it', () => {
  const p = project();
  const gone = crypto.randomUUID();
  expect(versionFiles(version(p, { templates: { [gone]: 'x' } }), p.files)).toEqual([
    { id: gone, name: 'Fil 1', language: 'plaintext', order: 0 },
  ]);
});

/** Report U-diff. The viewer used to read `templates[activeFileId]` and fall back to an empty
 * string, so opening a version saved before the open file showed a blank pane under the words
 * "så här såg versionen ut". */
it('shows a file the version actually holds when the open file is not one of them, and says so', async () => {
  const p = project();
  const second = file('del2.ps1');
  const v = version(p, { templates: { [p.files[0].id]: '$a = "ett"' }, files: [p.files[0]] });
  show({ version: v, activeFileId: second.id, currentFiles: [p.files[0], second] });

  expect(shown()).toBe('$a = "ett"');
  expect(screen.getByText(/del2\.ps1 fanns inte i v1/)).toBeTruthy();
  expect(screen.getByText(/Visar Create-ADUsers\.ps1/)).toBeTruthy();
});

it('keeps the open file when the version has it', () => {
  const p = project();
  const v = version(p, { templates: { [p.files[0].id]: '$kvar = "ja"' }, files: [p.files[0]] });
  show({ version: v, activeFileId: p.files[0].id, currentFiles: p.files });
  expect(shown()).toBe('$kvar = "ja"');
  expect(screen.queryByText(/fanns inte i/)).toBeNull();
});

it('renders a plain read-only view for a preview and a diff only when there is something to compare', async () => {
  const p = project();
  const v1 = version(p, { number: 1, templates: { [p.files[0].id]: 'ett\n' }, files: p.files });
  const v2 = version(p, { number: 2, templates: { [p.files[0].id]: 'tva\n' }, files: p.files });

  show({ version: v2, compareTo: null, activeFileId: p.files[0].id, currentFiles: p.files });
  // A preview has nothing to compare against; the diff widget put the same text in both panes.
  expect(screen.queryByTestId('diff')).toBeNull();
  expect(shown()).toBe('tva\n');
  cleanup();

  show({ version: v2, compareTo: v1, activeFileId: p.files[0].id, currentFiles: p.files });
  // The diff editor is lazy: it is not on the first screen and pulls in the whole editor bundle.
  const diff = await screen.findByTestId('diff');
  expect(diff.getAttribute('data-original')).toBe('ett\n');
  expect(diff.getAttribute('data-modified')).toBe('tva\n');
});

it('names the version on the restore button so a comparison cannot be read backwards', () => {
  const p = project();
  const v1 = version(p, { number: 1, files: p.files });
  const v2 = version(p, { number: 2, files: p.files });
  show({ version: v2, compareTo: v1, activeFileId: p.files[0].id, currentFiles: p.files });
  expect(screen.getByRole('button', { name: 'Återställ v2' })).toBeTruthy();
});

it('reports a file that only exists on the newer side as entirely added', () => {
  const p = project();
  const added = file('nytt.ps1');
  const v1 = version(p, { number: 1, templates: { [p.files[0].id]: 'ett\n' }, files: p.files });
  const v2 = version(p, { number: 2, templates: { [added.id]: 'nytt\n' }, files: [added] });
  show({ version: v2, compareTo: v1, activeFileId: added.id, currentFiles: [added] });
  expect(screen.getByText(/Filen fanns inte i v1/)).toBeTruthy();
});
