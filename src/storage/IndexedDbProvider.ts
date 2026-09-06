import Dexie, { type Table } from 'dexie';
import type { StorageProvider } from './StorageProvider';
import { DraftConflictError } from './StorageProvider';
import type { ProjectDraft, ProjectDraftMetadata, ProjectFile } from '../types/models';
import type { Binding, BindingFilter, Dataset, DatasetFilter, ImportMode, ImportResolution, ImportResult, Profile, Project, ScanDismissal, ScannerRule, Settings, Version, WorkspaceSnapshot } from '../types/models';
import { validateBinding } from '../domain/bindings';
import { mergeRules } from '../domain/scanner/rules';
import { renameInTemplates } from '../domain/bindings/rewrite';

class VaultDatabase extends Dexie {
  projects!: Table<Project, string>; versions!: Table<Version, string>; bindings!: Table<Binding, string>;
  profiles!: Table<Profile, string>; datasets!: Table<Dataset, string>; rules!: Table<ScannerRule, string>;
  settings!: Table<Settings & { key: string }, string>;
  drafts!: Table<ProjectDraft, string>;
  dismissals!: Table<ScanDismissal, [string, string]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id,updatedAt', versions: 'id,projectId,[projectId+number]',
      bindings: 'id,[scope+scopeRef],name', profiles: 'id', datasets: 'id,projectId', rules: 'id', settings: 'key' });
    this.version(2).stores({ drafts: 'projectId,updatedAt' });
    this.version(3).stores({ dismissals: '[projectId+fingerprint],projectId' });
  }
}
export class IndexedDbProvider implements StorageProvider {
  private db: VaultDatabase;
  constructor(name = 'ai-code-vault') { this.db = new VaultDatabase(name); }
  async listProjects() { return this.db.projects.orderBy('updatedAt').reverse().toArray(); }
  async getProject(id: string) { return this.db.projects.get(id); }
  async saveProject(p: Project) { await this.db.projects.put(p); }
  async deleteProject(id: string) {
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.bindings, this.db.datasets, this.db.drafts, this.db.dismissals], async () => {
      const ids = (await this.listVersions(id)).map(v => v.id);
      await this.db.bindings.filter(b => b.scope === 'project' && b.scopeRef === id || b.scope === 'version' && ids.includes(b.scopeRef || '')).delete();
      await this.db.versions.where('projectId').equals(id).delete();
      await this.db.datasets.where('projectId').equals(id).delete();
      await this.db.projects.delete(id);
      await this.db.drafts.delete(id);
      await this.db.dismissals.where('projectId').equals(id).delete();
    });
  }
  async getDraft(projectId: string) { return this.db.drafts.get(projectId); }
  async createProjectWithDraft(project: Project, draft: ProjectDraft): Promise<ProjectDraft> {
    if (draft.projectId !== project.id || draft.baseVersionId !== null || draft.revision !== 0 || project.currentVersionId !== null) throw new Error('Ogiltigt nytt projektutkast.');
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const saved = { ...draft, revision: 1 };
      await this.db.projects.add(project);
      await this.db.drafts.add(saved);
      return saved;
    });
  }
  async saveDraft(draft: ProjectDraft, expectedRevision: number, metadata: ProjectDraftMetadata): Promise<ProjectDraft> {
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const current = await this.db.drafts.get(draft.projectId);
      const project = await this.db.projects.get(draft.projectId);
      if (!project) throw new Error('Projektet finns inte längre. Din text finns kvar i fliken.');
      if ((current?.revision ?? 0) !== expectedRevision) throw new DraftConflictError();
      if (metadata.files.length !== project.files.length || metadata.files.some(f => !project.files.some(p => p.id === f.id))) throw new Error('Filreferenser får inte ändras vid utkastssparning.');
      const saved = { ...draft, revision: expectedRevision + 1 };
      await this.db.drafts.put(saved);
      await this.db.projects.put({ ...project, ...metadata, updatedAt: draft.updatedAt });
      return saved;
    });
  }
  async changeFiles(projectId: string, files: ProjectFile[], templates: Record<string, string>, expectedRevision: number): Promise<ProjectDraft> {
    if (!files.length) throw new Error('Ett projekt måste ha minst en fil.');
    if (new Set(files.map(f => f.id)).size !== files.length) throw new Error('Filerna måste ha unika id:n.');
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const project = await this.db.projects.get(projectId);
      if (!project) throw new Error('Projektet finns inte längre.');
      const current = await this.db.drafts.get(projectId);
      if ((current?.revision ?? 0) !== expectedRevision) throw new DraftConflictError();
      const known = new Set(files.map(f => f.id));
      // Templates for removed files are dropped here, not kept as orphans. Saved versions keep
      // their own copies, so a deleted file is still recoverable from history.
      const kept = Object.fromEntries(Object.entries(templates).filter(([fileId]) => known.has(fileId)));
      const time = new Date().toISOString();
      const saved: ProjectDraft = { projectId, baseVersionId: current?.baseVersionId ?? null, templates: kept, updatedAt: time, revision: expectedRevision + 1 };
      await this.db.drafts.put(saved);
      await this.db.projects.put({ ...project, files, updatedAt: time });
      return saved;
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
  async renameBinding(id: string, name: string): Promise<{ occurrences: number }> {
    return this.db.transaction('rw', [this.db.bindings, this.db.versions, this.db.drafts], async () => {
      const binding = await this.db.bindings.get(id);
      if (!binding) throw new Error('Bindingen finns inte längre.');
      if (binding.name === name) return { occurrences: 0 };
      const errors = validateBinding({ ...binding, name }, (await this.db.bindings.toArray()).filter(b => b.id !== id));
      if (errors.length) throw new Error(errors.join('\n'));
      let occurrences = 0;
      for (const version of await this.db.versions.toArray()) {
        const rewritten = renameInTemplates(version.templates, binding.name, name);
        if (!rewritten.occurrences) continue;
        occurrences += rewritten.occurrences;
        await this.db.versions.put({ ...version, templates: rewritten.templates,
          bindingUsage: version.bindingUsage.map(u => u.bindingName === binding.name ? { ...u, bindingName: name } : u) });
      }
      for (const draft of await this.db.drafts.toArray()) {
        const rewritten = renameInTemplates(draft.templates, binding.name, name);
        if (!rewritten.occurrences) continue;
        occurrences += rewritten.occurrences;
        // The revision advances: a tab holding the old text must not write it back over this.
        await this.db.drafts.put({ ...draft, templates: rewritten.templates, revision: draft.revision + 1, updatedAt: new Date().toISOString() });
      }
      await this.db.bindings.put({ ...binding, name, updatedAt: new Date().toISOString() });
      return { occurrences };
    });
  }
  async listProfiles() { return this.db.profiles.toArray(); }
  async saveProfile(p: Profile) { await this.db.profiles.put(p); }
  async listDatasets(filter?: DatasetFilter) { return this.db.datasets.filter(d => !filter || d.scope === 'global' || d.projectId === filter.projectId).toArray(); }
  async saveDataset(d: Dataset) { await this.db.datasets.put(d); }
  // Built-ins are not written to the table: merging on read means a new built-in appears on
  // upgrade, and one the user disabled stays disabled, with no migration either way.
  async listScannerRules() { return mergeRules(await this.db.rules.toArray()); }
  async deleteScannerRule(id: string) { await this.db.rules.delete(id); }
  async listDismissals(projectId: string) { return this.db.dismissals.where('projectId').equals(projectId).toArray(); }
  async saveDismissal(d: ScanDismissal) { await this.db.dismissals.put(d); }
  async deleteDismissal(projectId: string, fingerprint: string) { await this.db.dismissals.delete([projectId, fingerprint]); }
  async saveScannerRule(r: ScannerRule) { await this.db.rules.put(r); }
  async getSettings(): Promise<Settings> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const existing = await this.db.settings.get('settings');
      // A vault written before the theme setting existed has no such field; fill it on read.
      if (existing) { const { key: _key, ...settings } = existing; return { ...settings, theme: settings.theme ?? 'system' }; }
      const settings: Settings = { deviceId: crypto.randomUUID(), deviceName: 'Min dator', globalRootPath: 'C:\\Temp', aiRootPath: 'C:\\Temp\\Example',
        defaultSubfolders: ['Input', 'Output', 'Logs'], activeProfileId: null, roundTripMarkers: true,
        includeAiPromptBlock: true, clipboardAutoClearSeconds: 0, maskSecretsInUi: true, theme: 'system' };
      await this.db.settings.add({ ...settings, key: 'settings' });
      return settings;
    });
  }
  async saveSettings(s: Settings) { await this.db.settings.put({ ...s, key: 'settings' }); }
  async exportAll(): Promise<WorkspaceSnapshot> {
    await this.getSettings();
    return this.db.transaction('r', this.db.tables, async () => ({ projects: await this.listProjects(), versions: await this.db.versions.toArray(), drafts: await this.db.drafts.toArray(),
      bindings: await this.listBindings(), profiles: await this.listProfiles(), datasets: await this.listDatasets(),
      rules: await this.db.rules.toArray(), dismissals: await this.db.dismissals.toArray(), settings: (await this.db.settings.get('settings'))! }));
  }
  /** One transaction over every table: either the whole payload lands or none of it does, so a
   * failure halfway through cannot leave a vault that is part one backup and part another. */
  async importAll(payload: Partial<WorkspaceSnapshot>, mode: ImportMode, resolutions: Record<string, ImportResolution> = {}): Promise<ImportResult> {
    const result: ImportResult = { added: 0, replaced: 0, duplicated: 0, skipped: 0 };
    await this.db.transaction('rw', this.db.tables, async () => {
      if (mode === 'replace') for (const table of this.db.tables) await table.clear();

      const apply = async <T extends object>(table: Table<T, string>, items: T[] | undefined, key: (item: T) => string, rekey?: (item: T, id: string) => T) => {
        for (const item of items ?? []) {
          const id = key(item);
          const existing = await table.get(id);
          if (!existing) { await table.put(item); result.added++; continue; }
          const choice = resolutions[id] ?? 'keep';
          if (choice === 'keep') { result.skipped++; continue; }
          if (choice === 'replace') { await table.put(item); result.replaced++; continue; }
          // 'duplicate' only makes sense where a fresh id is harmless; otherwise keep the vault's.
          if (rekey) { await table.put(rekey(item, crypto.randomUUID())); result.duplicated++; }
          else result.skipped++;
        }
      };

      // The planner already rejects these, but a bad caller must not be able to write a binding the
      // app's own rules forbid. Failing here aborts the whole transaction.
      for (const b of payload.bindings ?? []) {
        const errors = validateBinding(b, (payload.bindings ?? []).filter(other => other.id !== b.id));
        if (errors.length) throw new Error(`Importen avbröts. Bindingen ${b.name}: ${errors.join(' ')}`);
      }

      await apply(this.db.projects, payload.projects, p => p.id, (p, id) => ({ ...p, id, name: `${p.name} (importerad)`, currentVersionId: null }));
      await apply(this.db.versions, payload.versions, v => v.id);
      await apply(this.db.bindings, payload.bindings, b => b.id, (b, id) => ({ ...b, id, name: `${b.name}_IMPORTERAD`.slice(0, 64) }));
      await apply(this.db.profiles, payload.profiles, p => p.id);
      await apply(this.db.datasets, payload.datasets, d => d.id);
      await apply(this.db.rules, payload.rules, r => r.id);
      for (const dismissal of payload.dismissals ?? []) {
        if (!await this.db.dismissals.get([dismissal.projectId, dismissal.fingerprint])) { await this.db.dismissals.put(dismissal); result.added++; }
        else result.skipped++;
      }
      for (const draft of payload.drafts ?? []) {
        const existing = await this.db.drafts.get(draft.projectId);
        if (!existing) { await this.db.drafts.put(draft); result.added++; }
        else if (resolutions[draft.projectId] === 'replace') { await this.db.drafts.put({ ...draft, revision: existing.revision + 1 }); result.replaced++; }
        else result.skipped++;
      }
      // Device identity stays this device's; importing it would make two machines claim one id.
      if (payload.settings) {
        const current = await this.db.settings.get('settings');
        await this.db.settings.put({ ...payload.settings, deviceId: current?.deviceId ?? payload.settings.deviceId, deviceName: current?.deviceName ?? payload.settings.deviceName, key: 'settings' });
      }
    });
    return result;
  }
  async clearAll() { await this.db.transaction('rw', this.db.tables, async () => { for (const table of this.db.tables) await table.clear(); }); }
  async commitVersion(project: Project, version: Version, expectedDraftRevision?: number) {
    if (version.projectId !== project.id || project.currentVersionId !== version.id) throw new Error('Projekt och version stämmer inte överens.');
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.drafts], async () => {
      const draft = await this.db.drafts.get(project.id);
      if (draft && draft.revision !== expectedDraftRevision || !draft && expectedDraftRevision !== undefined && expectedDraftRevision !== 0) throw new DraftConflictError();
      const versions = await this.listVersions(project.id);
      if (versions.some(v => v.number === version.number)) throw new Error('Versionen har ändrats i en annan flik. Öppna projektet igen.');
      await this.db.versions.add(version);
      await this.db.projects.put(project);
      if (draft) await this.db.drafts.put({ ...draft, baseVersionId: version.id, templates: version.templates, updatedAt: version.createdAt, revision: draft.revision + 1 });
    });
  }
  async destroy() { await this.db.delete(); }
}
