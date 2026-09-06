import Dexie, { type Table } from 'dexie';
import type { StorageProvider, VaultStatus } from './StorageProvider';
import { DraftConflictError } from './StorageProvider';
import type { EncryptedSnapshotFile, VaultHeader, VaultSecret } from './crypto';
import { changePassword, createVault, decryptRecord, encryptRecord, revealRecoveryKey, sealSnapshot, unlockVault, VaultLockedError } from './crypto';
import type { ProjectDraft, ProjectDraftMetadata, ProjectFile } from '../types/models';
import type { Binding, BindingFilter, BlocklistEntry, Dataset, DatasetFilter, ImportMode, ImportResolution, ImportResult, Profile, Project, ScanDismissal, ScannerRule, Settings, Version, WorkspaceSnapshot } from '../types/models';
import { validateBinding } from '../domain/bindings';
import { mergeRules } from '../domain/scanner/rules';
import { renameInTemplates } from '../domain/bindings/rewrite';

/** A stored row: the fields Dexie indexes stay readable, everything else moves into `enc`.
 *
 * Encryption is per row rather than per database because Dexie has to be able to find a row
 * without a key — `versions.where('projectId')` cannot ask a locked vault what a row contains.
 * The index fields are ids and timestamps, which say that a project exists and when it changed,
 * never what it holds. */
interface Sealed { enc: string }
const isSealed = (row: unknown): row is Sealed => typeof (row as Sealed | undefined)?.enc === 'string';

/** The plaintext fields of each table: its key path, plus whatever Dexie queries or sorts on. */
const OPEN_FIELDS: Record<string, readonly string[]> = {
  projects: ['id', 'updatedAt'],
  versions: ['id', 'projectId', 'number'],
  bindings: ['id'],
  profiles: ['id'],
  datasets: ['id', 'projectId'],
  rules: ['id'],
  blocklist: ['id'],
  drafts: ['projectId', 'updatedAt', 'revision'],
  // A dismissal is a project id and a hash of a value. There is nothing in it to encrypt.
  dismissals: ['projectId', 'fingerprint', 'ruleId', 'reason', 'createdAt', 'deviceId'],
  // Settings the app must read before it can ask for a password: first paint, the lock screen.
  settings: ['key', 'deviceId', 'theme', 'introSeen', 'editorFontSize', 'editorWordWrap', 'autoLockMinutes'],
};

class VaultDatabase extends Dexie {
  projects!: Table<Project, string>; versions!: Table<Version, string>; bindings!: Table<Binding, string>;
  profiles!: Table<Profile, string>; datasets!: Table<Dataset, string>; rules!: Table<ScannerRule, string>;
  blocklist!: Table<BlocklistEntry, string>;
  settings!: Table<Settings & { key: string }, string>;
  drafts!: Table<ProjectDraft, string>;
  dismissals!: Table<ScanDismissal, [string, string]>;
  vault!: Table<VaultHeader, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id,updatedAt', versions: 'id,projectId,[projectId+number]',
      bindings: 'id,[scope+scopeRef],name', profiles: 'id', datasets: 'id,projectId', rules: 'id', settings: 'key' });
    this.version(2).stores({ drafts: 'projectId,updatedAt' });
    this.version(3).stores({ dismissals: '[projectId+fingerprint],projectId' });
    this.version(4).stores({ blocklist: 'id' });
    // The vault header is a table of its own so clearAll() and a replacing import can skip it: a
    // vault that is emptied stays encrypted, and a restore does not silently unlock it.
    // `bindings.name` and `[scope+scopeRef]` go: nothing queried them, and an encrypted binding
    // has neither field to index.
    this.version(5).stores({ bindings: 'id', vault: 'key' });
  }
  /** Every table except the header, which is never encrypted and never cleared with the rest. */
  get contentTables() { return this.tables.filter(table => table.name !== 'vault'); }
}
export class IndexedDbProvider implements StorageProvider {
  private db: VaultDatabase;
  /** The data key, held only while unlocked. Null means either "plaintext vault" or "locked";
   * `header` tells those apart. */
  private dek: CryptoKey | null = null;
  private header: VaultHeader | null = null;
  private headerRead: Promise<VaultHeader | null> | null = null;
  constructor(name = 'ai-code-vault') { this.db = new VaultDatabase(name); }

  // ---- encryption ------------------------------------------------------------------------
  private async readHeader(): Promise<VaultHeader | null> {
    if (this.header) return this.header;
    this.headerRead ??= this.db.vault.get('header').then(row => { this.header = row ?? null; return this.header; });
    return this.headerRead;
  }
  /** Splits a record into what Dexie may index and what only a key may read. */
  private async seal<T extends object>(table: string, row: T): Promise<T> {
    if (!this.dek) return row;
    const open = OPEN_FIELDS[table] ?? [];
    const id = open.map(field => String((row as Record<string, unknown>)[field] ?? '')).join('|');
    const hidden: Record<string, unknown> = {}, kept: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(row)) (open.includes(field) ? kept : hidden)[field] = value;
    if (!Object.keys(hidden).length) return row;
    return { ...kept, enc: await encryptRecord(this.dek, JSON.stringify(hidden), `${table}:${id}`) } as T;
  }
  private async open<T extends object>(table: string, row: T | undefined): Promise<T | undefined> {
    if (!row || !isSealed(row)) return row;
    if (!this.dek) throw new VaultLockedError();
    const open = OPEN_FIELDS[table] ?? [];
    const id = open.map(field => String((row as Record<string, unknown>)[field] ?? '')).join('|');
    const { enc, ...kept } = row as Sealed & Record<string, unknown>;
    return { ...kept, ...JSON.parse(await decryptRecord(this.dek, enc, `${table}:${id}`)) } as T;
  }
  private async openAll<T extends object>(table: string, rows: T[]): Promise<T[]> {
    return rows.some(isSealed) ? Promise.all(rows.map(row => this.open(table, row) as Promise<T>)) : rows;
  }
  async vaultStatus(): Promise<VaultStatus> {
    const header = await this.readHeader();
    const settings = await this.db.settings.get('settings');
    return { encrypted: Boolean(header), locked: Boolean(header) && !this.dek,
      theme: settings?.theme ?? 'system', autoLockMinutes: settings?.autoLockMinutes ?? 0 };
  }
  /** Reads every row, then writes every row back in the new form, in one transaction: a failure
   * halfway cannot leave half a vault encrypted. The crypto runs outside the transaction, since a
   * `crypto.subtle` await inside one drops it. */
  private async rewriteEverything(next: CryptoKey | null, header: VaultHeader | null) {
    const tables = this.db.contentTables;
    const before = await Promise.all(tables.map(async table => [table, await this.openAll(table.name, await table.toArray())] as const));
    const previous = this.dek;
    this.dek = next;
    try {
      const after = await Promise.all(before.map(async ([table, rows]) => [table, await Promise.all(rows.map(row => this.seal(table.name, row)))] as const));
      await this.db.transaction('rw', [...tables, this.db.vault], async () => {
        for (const [table, rows] of after) { await table.clear(); await table.bulkPut(rows); }
        if (header) await this.db.vault.put(header); else await this.db.vault.clear();
      });
      this.header = header;
      this.headerRead = Promise.resolve(header);
    } catch (error) { this.dek = previous; throw error; }
  }
  async enableEncryption(password: string, options: { iterations?: number } = {}): Promise<{ recoveryKey: string }> {
    if (await this.readHeader()) throw new Error('Valvet är redan krypterat.');
    const { header, dek, recoveryKey } = await createVault(password, options);
    await this.rewriteEverything(dek, header);
    return { recoveryKey };
  }
  async disableEncryption(secret: VaultSecret) {
    const header = await this.readHeader();
    if (!header) return;
    // Proves the caller holds the secret before anything is written back in the clear.
    await unlockVault(header, secret);
    if (!this.dek) this.dek = await unlockVault(header, secret);
    await this.rewriteEverything(null, null);
  }
  async changePassword(current: VaultSecret, next: string) {
    const header = await this.readHeader();
    if (!header) throw new Error('Valvet är inte krypterat.');
    const updated = await changePassword(header, current, next);
    await this.db.vault.put(updated);
    this.header = updated;
    this.headerRead = Promise.resolve(updated);
  }
  async revealRecoveryKey(password: string) {
    const header = await this.readHeader();
    if (!header) throw new Error('Valvet är inte krypterat.');
    return revealRecoveryKey(header, await unlockVault(header, { password }));
  }
  async unlock(secret: VaultSecret) {
    const header = await this.readHeader();
    if (!header) return;
    this.dek = await unlockVault(header, secret);
  }
  lock() { this.dek = null; }
  async sealSnapshot(json: string): Promise<EncryptedSnapshotFile> {
    const header = await this.readHeader();
    if (!header || !this.dek) throw new VaultLockedError();
    return sealSnapshot(header, this.dek, json);
  }
  async resetVault() {
    await this.db.transaction('rw', this.db.tables, async () => { for (const table of this.db.tables) await table.clear(); });
    this.dek = null; this.header = null; this.headerRead = Promise.resolve(null);
  }
  // ---- reads and writes ------------------------------------------------------------------
  /** Dexie.waitFor keeps a transaction alive across a `crypto.subtle` await, which is not an
   * IndexedDB operation and would otherwise let the transaction commit underneath us. Outside a
   * transaction it hands the promise straight back, so every call site can use one form. */
  private sealed<T extends object>(table: string, row: T): Promise<T> { return Dexie.waitFor(this.seal(table, row)); }
  private opened<T extends object>(table: string, row: T | undefined): Promise<T | undefined> { return Dexie.waitFor(this.open(table, row)); }
  private openedAll<T extends object>(table: string, rows: T[]): Promise<T[]> { return Dexie.waitFor(this.openAll(table, rows)); }

  async listProjects() { return this.openedAll('projects', await this.db.projects.orderBy('updatedAt').reverse().toArray()); }
  async getProject(id: string) { return this.opened('projects', await this.db.projects.get(id)); }
  async saveProject(p: Project) { await this.db.projects.put(await this.sealed('projects', p)); }
  async captureProject(id: string): Promise<Partial<WorkspaceSnapshot>> {
    return this.db.transaction('r', [this.db.projects, this.db.versions, this.db.bindings, this.db.datasets, this.db.drafts, this.db.dismissals], async () => {
      const project = await this.opened('projects', await this.db.projects.get(id));
      if (!project) return {};
      const versions = await this.listVersions(id), versionIds = versions.map(v => v.id);
      const draft = await this.opened('drafts', await this.db.drafts.get(id));
      // `scope` is encrypted, so the filter runs on decrypted rows rather than inside the query.
      const bindings = await this.openedAll('bindings', await this.db.bindings.toArray());
      return {
        projects: [project],
        versions,
        drafts: draft ? [draft] : [],
        bindings: bindings.filter(b => b.scope === 'project' && b.scopeRef === id || b.scope === 'version' && versionIds.includes(b.scopeRef || '')),
        datasets: await this.openedAll('datasets', await this.db.datasets.where('projectId').equals(id).toArray()),
        dismissals: await this.db.dismissals.where('projectId').equals(id).toArray(),
      };
    });
  }
  async deleteProject(id: string) {
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.bindings, this.db.datasets, this.db.drafts, this.db.dismissals], async () => {
      const ids = (await this.listVersions(id)).map(v => v.id);
      const bindings = await this.openedAll('bindings', await this.db.bindings.toArray());
      await this.db.bindings.bulkDelete(bindings.filter(b => b.scope === 'project' && b.scopeRef === id || b.scope === 'version' && ids.includes(b.scopeRef || '')).map(b => b.id));
      await this.db.versions.where('projectId').equals(id).delete();
      await this.db.datasets.where('projectId').equals(id).delete();
      await this.db.projects.delete(id);
      await this.db.drafts.delete(id);
      await this.db.dismissals.where('projectId').equals(id).delete();
    });
  }
  async getDraft(projectId: string) { return this.opened('drafts', await this.db.drafts.get(projectId)); }
  async createProjectWithDraft(project: Project, draft: ProjectDraft): Promise<ProjectDraft> {
    if (draft.projectId !== project.id || draft.baseVersionId !== null || draft.revision !== 0 || project.currentVersionId !== null) throw new Error('Ogiltigt nytt projektutkast.');
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const saved = { ...draft, revision: 1 };
      await this.db.projects.add(await this.sealed('projects', project));
      await this.db.drafts.add(await this.sealed('drafts', saved));
      return saved;
    });
  }
  async saveDraft(draft: ProjectDraft, expectedRevision: number, metadata: ProjectDraftMetadata): Promise<ProjectDraft> {
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const current = await this.db.drafts.get(draft.projectId);
      const project = await this.opened('projects', await this.db.projects.get(draft.projectId));
      if (!project) throw new Error('Projektet finns inte längre. Din text finns kvar i fliken.');
      if ((current?.revision ?? 0) !== expectedRevision) throw new DraftConflictError();
      if (metadata.files.length !== project.files.length || metadata.files.some(f => !project.files.some(p => p.id === f.id))) throw new Error('Filreferenser får inte ändras vid utkastssparning.');
      const saved = { ...draft, revision: expectedRevision + 1 };
      await this.db.drafts.put(await this.sealed('drafts', saved));
      await this.db.projects.put(await this.sealed('projects', { ...project, ...metadata, updatedAt: draft.updatedAt }));
      return saved;
    });
  }
  async changeFiles(projectId: string, files: ProjectFile[], templates: Record<string, string>, expectedRevision: number): Promise<ProjectDraft> {
    if (!files.length) throw new Error('Ett projekt måste ha minst en fil.');
    if (new Set(files.map(f => f.id)).size !== files.length) throw new Error('Filerna måste ha unika id:n.');
    return this.db.transaction('rw', [this.db.projects, this.db.drafts], async () => {
      const project = await this.opened('projects', await this.db.projects.get(projectId));
      if (!project) throw new Error('Projektet finns inte längre.');
      const current = await this.opened('drafts', await this.db.drafts.get(projectId));
      if ((current?.revision ?? 0) !== expectedRevision) throw new DraftConflictError();
      const known = new Set(files.map(f => f.id));
      // Templates for removed files are dropped here, not kept as orphans. Saved versions keep
      // their own copies, so a deleted file is still recoverable from history.
      const kept = Object.fromEntries(Object.entries(templates).filter(([fileId]) => known.has(fileId)));
      const time = new Date().toISOString();
      const saved: ProjectDraft = { projectId, baseVersionId: current?.baseVersionId ?? null, templates: kept, updatedAt: time, revision: expectedRevision + 1 };
      await this.db.drafts.put(await this.sealed('drafts', saved));
      await this.db.projects.put(await this.sealed('projects', { ...project, files, updatedAt: time }));
      return saved;
    });
  }
  async listVersions(projectId: string) { return (await this.openedAll('versions', await this.db.versions.where('projectId').equals(projectId).toArray())).sort((a, b) => b.number - a.number); }
  async getVersion(id: string) { return this.opened('versions', await this.db.versions.get(id)); }
  async saveVersion(v: Version) { await this.db.versions.add(await this.sealed('versions', v)); }
  async deleteVersion(id: string) {
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.bindings], async () => {
      const version = await this.getVersion(id);
      if (!version) return;
      const project = await this.getProject(version.projectId);
      if (project?.currentVersionId === id) throw new Error('Aktuell version får inte raderas. Återgå till en annan först.');
      await this.db.versions.delete(id);
      const bindings = await this.openedAll('bindings', await this.db.bindings.toArray());
      await this.db.bindings.bulkDelete(bindings.filter(b => b.scope === 'version' && b.scopeRef === id).map(b => b.id));
    });
  }
  async listBindings(filter?: BindingFilter) {
    const all = await this.openedAll('bindings', await this.db.bindings.toArray());
    if (!filter) return all;
    return all.filter(b => b.scope === 'global' || b.scope === 'project' && b.scopeRef === filter.projectId || b.scope === 'version' && b.scopeRef === filter.versionId);
  }
  async saveBinding(b: Binding) {
    await this.db.transaction('rw', this.db.bindings, async () => {
      const errors = validateBinding(b, await this.openedAll('bindings', await this.db.bindings.toArray()));
      if (errors.length) throw new Error(errors.join('\n'));
      await this.db.bindings.put(await this.sealed('bindings', b));
    });
  }
  async deleteBinding(id: string) { await this.db.bindings.delete(id); }
  async renameBinding(id: string, name: string): Promise<{ occurrences: number }> {
    return this.db.transaction('rw', [this.db.bindings, this.db.versions, this.db.drafts], async () => {
      const binding = await this.opened('bindings', await this.db.bindings.get(id));
      if (!binding) throw new Error('Bindingen finns inte längre.');
      if (binding.name === name) return { occurrences: 0 };
      const errors = validateBinding({ ...binding, name }, (await this.openedAll('bindings', await this.db.bindings.toArray())).filter(b => b.id !== id));
      if (errors.length) throw new Error(errors.join('\n'));
      let occurrences = 0;
      for (const version of await this.openedAll('versions', await this.db.versions.toArray())) {
        const rewritten = renameInTemplates(version.templates, binding.name, name);
        if (!rewritten.occurrences) continue;
        occurrences += rewritten.occurrences;
        await this.db.versions.put(await this.sealed('versions', { ...version, templates: rewritten.templates,
          bindingUsage: version.bindingUsage.map(u => u.bindingName === binding.name ? { ...u, bindingName: name } : u) }));
      }
      for (const draft of await this.openedAll('drafts', await this.db.drafts.toArray())) {
        const rewritten = renameInTemplates(draft.templates, binding.name, name);
        if (!rewritten.occurrences) continue;
        occurrences += rewritten.occurrences;
        // The revision advances: a tab holding the old text must not write it back over this.
        await this.db.drafts.put(await this.sealed('drafts', { ...draft, templates: rewritten.templates, revision: draft.revision + 1, updatedAt: new Date().toISOString() }));
      }
      await this.db.bindings.put(await this.sealed('bindings', { ...binding, name, updatedAt: new Date().toISOString() }));
      return { occurrences };
    });
  }
  async listProfiles() { return this.openedAll('profiles', await this.db.profiles.toArray()); }
  async saveProfile(p: Profile) { await this.db.profiles.put(await this.sealed('profiles', p)); }
  async deleteProfile(id: string) {
    await this.db.transaction('rw', [this.db.profiles, this.db.bindings, this.db.settings], async () => {
      await this.db.profiles.delete(id);
      for (const binding of await this.openedAll('bindings', await this.db.bindings.toArray())) {
        if (!(id in binding.values)) continue;
        const values = { ...binding.values };
        delete values[id];
        await this.db.bindings.put(await this.sealed('bindings', { ...binding, values, updatedAt: new Date().toISOString() }));
      }
      const settings = await this.opened('settings', await this.db.settings.get('settings'));
      if (settings?.activeProfileId === id) await this.db.settings.put(await this.sealed('settings', { ...settings, activeProfileId: null }));
    });
  }
  async listDatasets(filter?: DatasetFilter) {
    const all = await this.openedAll('datasets', await this.db.datasets.toArray());
    return all.filter(d => !filter || d.scope === 'global' || d.projectId === filter.projectId);
  }
  async saveDataset(d: Dataset) { await this.db.datasets.put(await this.sealed('datasets', d)); }
  // Built-ins are not written to the table: merging on read means a new built-in appears on
  // upgrade, and one the user disabled stays disabled, with no migration either way.
  async listBlocklist() { return (await this.openedAll('blocklist', await this.db.blocklist.toArray())).sort((a, b) => a.term.localeCompare(b.term, 'sv')); }
  async saveBlocklistEntry(e: BlocklistEntry) { await this.db.blocklist.put(await this.sealed('blocklist', e)); }
  async deleteBlocklistEntry(id: string) { await this.db.blocklist.delete(id); }
  async listScannerRules() { return mergeRules(await this.openedAll('rules', await this.db.rules.toArray())); }
  async deleteScannerRule(id: string) { await this.db.rules.delete(id); }
  async listDismissals(projectId: string) { return this.db.dismissals.where('projectId').equals(projectId).toArray(); }
  async saveDismissal(d: ScanDismissal) { await this.db.dismissals.put(d); }
  async deleteDismissal(projectId: string, fingerprint: string) { await this.db.dismissals.delete([projectId, fingerprint]); }
  async saveScannerRule(r: ScannerRule) { await this.db.rules.put(await this.sealed('rules', r)); }
  async getSettings(): Promise<Settings> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const existing = await this.opened('settings', await this.db.settings.get('settings'));
      // A vault written before a setting existed has no such field; fill it on read. introSeen is
      // deliberately true here and false for a new vault: an existing vault belongs to someone who
      // has already used the tool, and an introduction is only worth showing before the first use.
      if (existing) { const { key: _key, ...settings } = existing; return { ...settings, theme: settings.theme ?? 'system', editorFontSize: settings.editorFontSize ?? 14, editorWordWrap: settings.editorWordWrap ?? true, introSeen: settings.introSeen ?? true, aiPromptText: settings.aiPromptText ?? 'Koden nedan har privata värden utbytta mot platshållare i formen {{NAMN}}.\nBehåll dem exakt som de står — ändra inte namnen och fyll inte i några värden.' }; }
      const settings: Settings = { deviceId: crypto.randomUUID(), deviceName: 'Min dator', globalRootPath: 'C:\\Temp', aiRootPath: 'C:\\Temp\\Example',
        defaultSubfolders: ['Input', 'Output', 'Logs'], activeProfileId: null, roundTripMarkers: true,
        includeAiPromptBlock: true, clipboardAutoClearSeconds: 0, maskSecretsInUi: true, theme: 'system',
        editorFontSize: 14, editorWordWrap: true, introSeen: false,
        aiPromptText: 'Koden nedan har privata värden utbytta mot platshållare i formen {{NAMN}}.\nBehåll dem exakt som de står — ändra inte namnen och fyll inte i några värden.' };
      await this.db.settings.add(await this.sealed('settings', { ...settings, key: 'settings' }));
      return settings;
    });
  }
  async saveSettings(s: Settings) { await this.db.settings.put(await this.sealed('settings', { ...s, key: 'settings' })); }
  async exportAll(): Promise<WorkspaceSnapshot> {
    await this.getSettings();
    return this.db.transaction('r', this.db.contentTables, async () => ({ projects: await this.listProjects(), versions: await this.openedAll('versions', await this.db.versions.toArray()), drafts: await this.openedAll('drafts', await this.db.drafts.toArray()),
      bindings: await this.listBindings(), profiles: await this.listProfiles(), datasets: await this.listDatasets(),
      rules: await this.openedAll('rules', await this.db.rules.toArray()), blocklist: await this.openedAll('blocklist', await this.db.blocklist.toArray()),
      dismissals: await this.db.dismissals.toArray(), settings: (await this.opened('settings', await this.db.settings.get('settings')))! }));
  }
  /** One transaction over every table: either the whole payload lands or none of it does, so a
   * failure halfway through cannot leave a vault that is part one backup and part another. */
  async importAll(payload: Partial<WorkspaceSnapshot>, mode: ImportMode, resolutions: Record<string, ImportResolution> = {}): Promise<ImportResult> {
    const result: ImportResult = { added: 0, replaced: 0, duplicated: 0, skipped: 0 };
    // The vault header is not in this transaction: a replacing import restores content, never the
    // key that opens it, so importing a file cannot turn an encrypted vault into a plaintext one.
    await this.db.transaction('rw', this.db.contentTables, async () => {
      if (mode === 'replace') for (const table of this.db.contentTables) await table.clear();

      const apply = async <T extends object>(table: Table<T, string>, items: T[] | undefined, key: (item: T) => string, rekey?: (item: T, id: string) => T) => {
        for (const item of items ?? []) {
          const id = key(item);
          const existing = await table.get(id);
          if (!existing) { await table.put(await this.sealed(table.name, item)); result.added++; continue; }
          const choice = resolutions[id] ?? 'keep';
          if (choice === 'keep') { result.skipped++; continue; }
          if (choice === 'replace') { await table.put(await this.sealed(table.name, item)); result.replaced++; continue; }
          // 'duplicate' only makes sense where a fresh id is harmless; otherwise keep the vault's.
          if (rekey) { await table.put(await this.sealed(table.name, rekey(item, crypto.randomUUID()))); result.duplicated++; }
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
      await apply(this.db.blocklist, payload.blocklist, e => e.id);
      for (const dismissal of payload.dismissals ?? []) {
        if (!await this.db.dismissals.get([dismissal.projectId, dismissal.fingerprint])) { await this.db.dismissals.put(dismissal); result.added++; }
        else result.skipped++;
      }
      for (const draft of payload.drafts ?? []) {
        const existing = await this.db.drafts.get(draft.projectId);
        if (!existing) { await this.db.drafts.put(await this.sealed('drafts', draft)); result.added++; }
        else if (resolutions[draft.projectId] === 'replace') { await this.db.drafts.put(await this.sealed('drafts', { ...draft, revision: existing.revision + 1 })); result.replaced++; }
        else result.skipped++;
      }
      // Device identity stays this device's; importing it would make two machines claim one id.
      // So does the auto-lock setting: it belongs to this installation's key, not to the file.
      if (payload.settings) {
        const current = await this.opened('settings', await this.db.settings.get('settings'));
        await this.db.settings.put(await this.sealed('settings', { ...payload.settings, deviceId: current?.deviceId ?? payload.settings.deviceId,
          deviceName: current?.deviceName ?? payload.settings.deviceName, autoLockMinutes: current?.autoLockMinutes ?? payload.settings.autoLockMinutes, key: 'settings' }));
      }
    });
    return result;
  }
  /** Empties the vault but keeps its header: a vault someone chose to encrypt stays encrypted
   * after "clear everything", so the next thing written is not written in the clear. */
  async clearAll() { await this.db.transaction('rw', this.db.contentTables, async () => { for (const table of this.db.contentTables) await table.clear(); }); }
  async commitVersion(project: Project, version: Version, expectedDraftRevision?: number) {
    if (version.projectId !== project.id || project.currentVersionId !== version.id) throw new Error('Projekt och version stämmer inte överens.');
    await this.db.transaction('rw', [this.db.projects, this.db.versions, this.db.drafts], async () => {
      const draft = await this.opened('drafts', await this.db.drafts.get(project.id));
      if (draft && draft.revision !== expectedDraftRevision || !draft && expectedDraftRevision !== undefined && expectedDraftRevision !== 0) throw new DraftConflictError();
      const versions = await this.listVersions(project.id);
      if (versions.some(v => v.number === version.number)) throw new Error('Versionen har ändrats i en annan flik. Öppna projektet igen.');
      await this.db.versions.add(await this.sealed('versions', version));
      await this.db.projects.put(await this.sealed('projects', project));
      if (draft) await this.db.drafts.put(await this.sealed('drafts', { ...draft, baseVersionId: version.id, templates: version.templates, updatedAt: version.createdAt, revision: draft.revision + 1 }));
    });
  }
  async destroy() { await this.db.delete(); }
}
