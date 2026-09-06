import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../types/models';
import { binding, project, version } from '../../test/fixtures/factories';
import { parseSnapshot, planImport, toSnapshot, SNAPSHOT_VERSION } from './index';

const app = { version: '0.1.0', deviceId: 'device', deviceName: 'Test' };
const settings = {
  deviceId: 'device',
  deviceName: 'Test',
  globalRootPath: 'C:\\Temp',
  aiRootPath: 'C:\\Temp\\Example',
  defaultSubfolders: ['Input'],
  activeProfileId: null,
  roundTripMarkers: true,
  includeAiPromptBlock: true,
  clipboardAutoClearSeconds: 0,
  maskSecretsInUi: true,
  theme: 'system' as const,
  aiPromptText: 'Behåll platshållarna.',
  editorFontSize: 14,
  editorWordWrap: true,
};

function workspace(): WorkspaceSnapshot {
  const p = project();
  return {
    projects: [p],
    versions: [version(p)],
    drafts: [{ projectId: p.id, baseVersionId: null, templates: { [p.files[0].id]: '$p = "{{ADMIN_PASSWORD}}"' }, updatedAt: '2026-09-05T12:00:00.000Z', revision: 1 }],
    bindings: [binding({ scopeRef: p.id })],
    profiles: [],
    datasets: [],
    rules: [],
    dismissals: [{ projectId: p.id, fingerprint: 'abc12345', ruleId: 'email', reason: 'exempelvärde', createdAt: '2026-09-05T12:00:00.000Z', deviceId: 'd' }],
    settings,
  };
}
const empty = (): WorkspaceSnapshot => ({ projects: [], versions: [], drafts: [], bindings: [], profiles: [], datasets: [], rules: [], dismissals: [], settings });

describe('export', () => {
  it('round-trips a full snapshot through parsing', () => {
    const source = workspace();
    const parsed = parseSnapshot(JSON.stringify(toSnapshot(source, 'full', app)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot.payload).toMatchObject({ projects: source.projects, versions: source.versions });
  });

  it('keeps project code out of a private backup', () => {
    const source = workspace();
    const text = JSON.stringify(toSnapshot(source, 'private', app));
    // Not merely "projects is absent": no template body may appear anywhere in the file.
    for (const template of Object.values(source.drafts[0].templates)) expect(text).not.toContain(template);
    for (const template of Object.values(source.versions[0].templates)) expect(text).not.toContain(template);
    expect(text).not.toContain(source.projects[0].name);
    expect(JSON.parse(text).payload).not.toHaveProperty('projects');
    // A fingerprint is derived from the project's code, so it belongs with the code.
    expect(JSON.parse(text).payload).not.toHaveProperty('dismissals');
  });

  it('does carry the private values, which is the point of that file', () => {
    const source = workspace();
    const text = JSON.stringify(toSnapshot(source, 'private', app));
    expect(text).toContain('SuperSecret123!');
  });

  it('refuses a payload that smuggles extra keys past the private shape', () => {
    const source = toSnapshot(workspace(), 'private', app) as unknown as { payload: Record<string, unknown> };
    source.payload.projects = workspace().projects;
    expect(parseSnapshot(JSON.stringify(source)).ok).toBe(false);
  });
});

describe('parse', () => {
  it('rejects non-JSON and unknown shapes without leaking values', () => {
    expect(parseSnapshot('not json').ok).toBe(false);
    const bad = parseSnapshot(JSON.stringify({ format: 'ai-code-vault.snapshot', schemaVersion: 1, kind: 'full', exportedAt: 'x', app, payload: {} }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.join(' ')).not.toContain('SuperSecret123!');
  });

  it('refuses a newer schema rather than half-understanding it', () => {
    const future = { ...toSnapshot(workspace(), 'full', app), schemaVersion: SNAPSHOT_VERSION + 1 };
    const result = parseSnapshot(JSON.stringify(future));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('nyare version');
  });
});

describe('planImport', () => {
  it('counts additions into an empty vault', () => {
    const snapshot = toSnapshot(workspace(), 'full', app);
    const plan = planImport(snapshot, empty());
    expect(plan.summary.conflicts).toBe(0);
    expect(plan.summary.added).toBeGreaterThan(0);
    expect(plan.blockers).toEqual([]);
  });

  it('calls an unchanged re-import identical rather than a conflict', () => {
    const source = workspace();
    const plan = planImport(toSnapshot(source, 'full', app), source);
    expect(plan.summary.conflicts).toBe(0);
    expect(plan.summary.added).toBe(0);
  });

  it('flags a changed entity with the same id as a conflict', () => {
    const source = workspace();
    const changed = { ...source, projects: [{ ...source.projects[0], name: 'Renamed' }] };
    const plan = planImport(toSnapshot(changed, 'full', app), source);
    expect(plan.entities.find((e) => e.kind === 'projekt')?.action).toBe('conflict');
  });

  it('blocks a version whose project exists nowhere', () => {
    const source = workspace();
    const orphan = { ...source, projects: [] };
    expect(planImport(toSnapshot(orphan, 'full', app), empty()).blockers.join(' ')).toContain('saknas');
  });

  it('blocks a binding the app would reject on write', () => {
    const source = workspace();
    const unsafe = { ...source, bindings: [binding({ aiReplacement: 'SuperSecret123!' })] };
    expect(planImport(toSnapshot(unsafe, 'full', app), empty()).blockers.length).toBeGreaterThan(0);
  });
});
