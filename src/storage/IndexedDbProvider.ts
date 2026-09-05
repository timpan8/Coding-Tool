import Dexie, { type Table } from 'dexie';
import type { StorageProvider } from './StorageProvider';
import type { Binding, BindingFilter, Dataset, DatasetFilter, ImportMode, ImportResult, Profile, Project, ScannerRule, Settings, Version, WorkspaceSnapshot } from '../types/models';
import { validateBinding } from '../domain/bindings';

class VaultDatabase extends Dexie {
  projects!: Table<Project, string>; versions!: Table<Version, string>; bindings!: Table<Binding, string>;
  profiles!: Table<Profile, string>; datasets!: Table<Dataset, string>; rules!: Table<ScannerRule, string>;
  settings!: Table<Settings & { key: string }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id,updatedAt', versions: 'id,projectId,[projectId+number]',
      bindings: 'id,[scope+scopeRef],name', profiles: 'id', datasets: 'id,projectId', rules: 'id', settings: 'key' });
  }
}
export class IndexedDbProvider implements StorageProvider {
  private db: VaultDatabase;
  constructor(name = 'ai-code-vault') { this.db = new VaultDatabase(name); }
  async listProjects() { return this.db.projects.orderBy('updatedAt').reverse().toArray(); }
  async getProject(id: string) { return this.db.projects.get(id); }
  async saveProject(p: Project) { await this.db.projects.put(p); }
  async deleteProject(id: string) {
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.bindings, this.db.datasets], async () => {
      const ids = (await this.listVersions(id)).map(v => v.id);
      await this.db.bindings.filter(b => b.scope === 'project' && b.scopeRef === id || b.scope === 'version' && ids.includes(b.scopeRef || '')).delete();
      await this.db.versions.where('projectId').equals(id).delete();
      await this.db.datasets.where('projectId').equals(id).delete();
      await this.db.projects.delete(id);
    });
  }
  async listVersions(projectId: string) { return (await this.db.versions.where('projectId').equals(projectId).toArray()).sort((a, b) => b.number - a.number); }
  async getVersion(id: string) { return this.db.versions.get(id); }
  async saveVersion(v: Version) { await this.db.versions.add(v); }
  async deleteVersion(id: string) {
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.bindings], async () => {
      const version = await this.getVersion(id);
      if (!version) return;
      const project = await this.getProject(version.projectId);
      if (project?.currentVersionId === id) throw new Error('Aktuell version får inte raderas. Återgå till en annan först.');
      await this.db.versions.delete(id);
      await this.db.bindings.filter(b => b.scope === 'version' && b.scopeRef === id).delete();
    });
  }
  async listBindings(filter?: BindingFilter) {
    const all = await this.db.bindings.toArray();
    if (!filter) return all;
    return all.filter(b => b.scope === 'global' || b.scope === 'project' && b.scopeRef === filter.projectId || b.scope === 'version' && b.scopeRef === filter.versionId);
  }
  async saveBinding(b: Binding) {
    await this.db.transaction('rw', this.db.bindings, async () => {
      const errors = validateBinding(b, await this.db.bindings.toArray());
      if (errors.length) throw new Error(errors.join('\n'));
      await this.db.bindings.put(b);
    });
  }
  async deleteBinding(id: string) { await this.db.bindings.delete(id); }
  async listProfiles() { return this.db.profiles.toArray(); }
  async saveProfile(p: Profile) { await this.db.profiles.put(p); }
  async listDatasets(filter?: DatasetFilter) { return this.db.datasets.filter(d => !filter || d.scope === 'global' || d.projectId === filter.projectId).toArray(); }
  async saveDataset(d: Dataset) { await this.db.datasets.put(d); }
  async listScannerRules() { return this.db.rules.toArray(); }
  async saveScannerRule(r: ScannerRule) { await this.db.rules.put(r); }
  async getSettings(): Promise<Settings> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const existing = await this.db.settings.get('settings');
      if (existing) { const { key: _key, ...settings } = existing; return settings; }
      const settings: Settings = { deviceId: crypto.randomUUID(), deviceName: 'Min dator', globalRootPath: 'C:\\Temp', aiRootPath: 'C:\\Temp\\Example',
        defaultSubfolders: ['Input', 'Output', 'Logs'], activeProfileId: null, roundTripMarkers: true,
        includeAiPromptBlock: true, clipboardAutoClearSeconds: 0, maskSecretsInUi: true };
      await this.db.settings.add({ ...settings, key: 'settings' });
      return settings;
    });
  }
  async saveSettings(s: Settings) { await this.db.settings.put({ ...s, key: 'settings' }); }
  async exportAll(): Promise<WorkspaceSnapshot> {
    await this.getSettings();
    return this.db.transaction('r', this.db.tables, async () => ({ projects: await this.listProjects(), versions: await this.db.versions.toArray(),
      bindings: await this.listBindings(), profiles: await this.listProfiles(), datasets: await this.listDatasets(),
      rules: await this.listScannerRules(), settings: (await this.db.settings.get('settings'))! }));
  }
  async importAll(_snapshot: WorkspaceSnapshot, _mode: ImportMode): Promise<ImportResult> {
    // M3 introduces schema validation + preview + explicit conflict choices. No unsafe bypass in M1.
    throw new Error('Import aktiveras i M3 efter validering och förhandsgranskning.');
  }
  async clearAll() { await this.db.transaction('rw', this.db.tables, async () => { for (const table of this.db.tables) await table.clear(); }); }
  async commitVersion(project: Project, version: Version) {
    if (version.projectId !== project.id || project.currentVersionId !== version.id) throw new Error('Projekt och version stämmer inte överens.');
    await this.db.transaction('rw', [this.db.projects, this.db.versions], async () => {
      const versions = await this.listVersions(project.id);
      if (versions.some(v => v.number === version.number)) throw new Error('Versionen har ändrats i en annan flik. Öppna projektet igen.');
      await this.db.versions.add(version);
      await this.db.projects.put(project);
    });
  }
  async destroy() { await this.db.delete(); }
}
