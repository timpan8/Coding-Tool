import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StorageProvider } from './StorageProvider';
import { IndexedDbProvider } from './IndexedDbProvider';
import { binding, deviceId, project, time, version } from '../test/fixtures/factories';

/** Provider-independent contract. A future adapter supplies only factory + teardown. */
export function storageContract(factory: () => { storage: StorageProvider; cleanup: () => Promise<void> }) {
  let storage: StorageProvider, cleanup: () => Promise<void>;
  beforeEach(() => { ({ storage, cleanup } = factory()); });
  afterEach(async () => { await cleanup(); });
  it('persists projects and version templates without collapsing to local output', async () => {
    const p = project(); await storage.saveProject(p);
    expect(await storage.getProject(p.id)).toEqual(p);
    const v = version(p); await storage.commitVersion({ ...p, currentVersionId: v.id }, v);
    expect((await storage.getProject(p.id))?.currentVersionId).toBe(v.id);
    expect(await storage.getVersion(v.id)).toEqual(v);
    expect((await storage.listVersions(p.id))[0].templates[p.files[0].id]).toContain('{{ADMIN_PASSWORD}}');
    await expect(storage.saveVersion(v)).rejects.toThrow();
    expect(await storage.getVersion(v.id)).toEqual(v);
  });
  it('stores bindings and rejects unsafe updates without damaging prior value', async () => {
    const b = binding(); await storage.saveBinding(b);
    await expect(storage.saveBinding({ ...b, aiReplacement: 'SuperSecret123!' })).rejects.toThrow();
    expect(await storage.listBindings()).toEqual([b]);
    await storage.deleteBinding(b.id); expect(await storage.listBindings()).toEqual([]);
  });
  it('does not orphan a version if a transaction fails', async () => {
    const p = project(); await storage.saveProject(p);
    const v = version(p); await storage.commitVersion({ ...p, currentVersionId: v.id }, v);
    const collision = version(p);
    await expect(storage.commitVersion({ ...p, currentVersionId: collision.id }, collision)).rejects.toThrow();
    expect(await storage.getVersion(collision.id)).toBeUndefined();
    expect((await storage.getProject(p.id))?.currentVersionId).toBe(v.id);
  });
  it('settings have a stable device identity and survive rereads', async () => {
    const first = await storage.getSettings(); expect(first.deviceId).toMatch(/^[a-f0-9-]{36}$/);
    await storage.saveSettings({ ...first, deviceName: 'Test device' });
    expect((await storage.getSettings()).deviceId).toBe(first.deviceId);
    expect((await storage.getSettings()).deviceName).toBe('Test device');
  });
  it('project deletion cascades only its scoped data', async () => {
    const p = project(), other = project(); await storage.saveProject(p); await storage.saveProject(other);
    const v = version(p); await storage.commitVersion({ ...p, currentVersionId: v.id }, v);
    const global = binding({ scope: 'global', scopeRef: null });
    await storage.saveBinding(global); await storage.saveBinding(binding({ scopeRef: p.id }));
    await storage.deleteProject(p.id);
    expect(await storage.getProject(p.id)).toBeUndefined(); expect(await storage.listVersions(p.id)).toEqual([]);
    expect(await storage.getProject(other.id)).toEqual(other); expect(await storage.listBindings()).toEqual([global]);
  });
  // Import used to be required to reject outright; it now applies a payload the caller has already
  // validated and planned. This is the one existing expectation deliberately inverted.
  it('leaves the vault alone on re-import unless a conflict is explicitly resolved', async () => {
    const p = project(); await storage.saveProject(p);
    const snapshot = await storage.exportAll();
    expect(await storage.importAll(snapshot, 'merge')).toMatchObject({ added: 0, replaced: 0 });
    expect((await storage.getProject(p.id))?.name).toBe(p.name);
    const renamed = { ...snapshot, projects: [{ ...p, name: 'Från backup' }] };
    expect(await storage.importAll(renamed, 'merge', { [p.id]: 'replace' })).toMatchObject({ replaced: 1 });
    expect((await storage.getProject(p.id))?.name).toBe('Från backup');
  });
  it('writes nothing at all when any part of the import is invalid', async () => {
    const p = project(); await storage.saveProject(p);
    const other = project();
    const unsafe = binding({ aiReplacement: 'SuperSecret123!' });
    await expect(storage.importAll({ projects: [other], bindings: [unsafe] }, 'merge')).rejects.toThrow();
    expect(await storage.getProject(other.id)).toBeUndefined();
    expect(await storage.listBindings()).toEqual([]);
    expect((await storage.getProject(p.id))?.name).toBe(p.name);
  });
  it('merges built-in scanner rules with stored overrides', async () => {
    const all = await storage.listScannerRules();
    expect(all.length).toBeGreaterThan(5);
    const first = all[0];
    await storage.saveScannerRule({ ...first, enabled: false });
    const after = await storage.listScannerRules();
    expect(after.find(r => r.id === first.id)?.enabled).toBe(false);
    // Disabling one must not drop the rest, which a naive "stored rules only" read would do.
    expect(after.length).toBe(all.length);
  });
  it('scopes dismissals to their project and removes them with it', async () => {
    const p = project(), other = project();
    await storage.saveProject(p); await storage.saveProject(other);
    const made = (projectId: string, fingerprint: string) => ({ projectId, fingerprint, ruleId: 'email', reason: '', createdAt: time, deviceId });
    await storage.saveDismissal(made(p.id, 'aaa11111'));
    await storage.saveDismissal(made(other.id, 'bbb22222'));
    expect(await storage.listDismissals(p.id)).toHaveLength(1);
    await storage.deleteProject(p.id);
    expect(await storage.listDismissals(p.id)).toEqual([]);
    expect(await storage.listDismissals(other.id)).toHaveLength(1);
  });
  it('clears the entire local store explicitly', async () => {
    await storage.saveProject(project());
    await storage.clearAll(); expect(await storage.listProjects()).toEqual([]);
  });
}
describe('IndexedDB StorageProvider contract', () => storageContract(() => {
  const storage = new IndexedDbProvider('test-' + crypto.randomUUID()); return { storage, cleanup: () => storage.destroy() };
}));
