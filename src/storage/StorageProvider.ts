import type { Binding, BindingFilter, BlocklistEntry, Dataset, DatasetFilter, ImportMode, ImportResolution, ImportResult, Profile, Project, ProjectSummary, ScanDismissal, ScannerRule, Settings, Version, VersionSummary, WorkspaceSnapshot } from '../types/models';
import type { ProjectDraft, ProjectDraftMetadata, ProjectFile } from '../types/models';

export class DraftConflictError extends Error {
  constructor() { super('Projektet har ändrats i en annan flik. Din text finns kvar här. Kopiera mallen till en lokal fil innan du laddar om projektet.'); this.name = 'DraftConflictError'; }
}

export interface StorageProvider {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Everything a delete of this project would take with it, in the shape importAll accepts. Read
   * before the delete so the action can be undone by putting the same records back. */
  captureProject(id: string): Promise<Partial<WorkspaceSnapshot>>;
  getDraft(projectId: string): Promise<ProjectDraft | undefined>;
  createProjectWithDraft(project: Project, draft: ProjectDraft): Promise<ProjectDraft>;
  saveDraft(draft: ProjectDraft, expectedRevision: number, metadata: ProjectDraftMetadata): Promise<ProjectDraft>;
  /** Adds or removes files. saveDraft deliberately refuses a changed file set, so that a stale tab
   * cannot resurrect a deleted file through the autosave path; this is the one operation allowed to
   * change it, and it carries the same revision check. */
  changeFiles(projectId: string, files: ProjectFile[], templates: Record<string, string>, expectedRevision: number): Promise<ProjectDraft>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  getVersion(id: string): Promise<Version | undefined>;
  saveVersion(v: Version): Promise<void>;
  deleteVersion(id: string): Promise<void>;
  listBindings(filter?: BindingFilter): Promise<Binding[]>;
  saveBinding(b: Binding): Promise<void>;
  deleteBinding(id: string): Promise<void>;
  /** Renames a binding and rewrites its placeholder everywhere in one transaction. Doing it in two
   * steps would leave templates pointing at a name that no longer resolves. */
  renameBinding(id: string, name: string): Promise<{ occurrences: number }>;
  listProfiles(): Promise<Profile[]>;
  saveProfile(p: Profile): Promise<void>;
  /** Removes a profile and the per-profile values that referenced it, so no binding is left with a
   * value keyed by a profile that no longer exists. */
  deleteProfile(id: string): Promise<void>;
  listDatasets(filter?: DatasetFilter): Promise<Dataset[]>;
  saveDataset(d: Dataset): Promise<void>;
  /** Terms that become bindings on their own the moment they land in the workspace. Sorted by term,
   * because the list is read far more often than it is written. */
  listBlocklist(): Promise<BlocklistEntry[]>;
  saveBlocklistEntry(e: BlocklistEntry): Promise<void>;
  deleteBlocklistEntry(id: string): Promise<void>;
  /** Returns the built-ins merged with any stored overrides, so disabling one sticks and new
   * built-ins appear without a migration. */
  listScannerRules(): Promise<ScannerRule[]>;
  saveScannerRule(r: ScannerRule): Promise<void>;
  deleteScannerRule(id: string): Promise<void>;
  listDismissals(projectId: string): Promise<ScanDismissal[]>;
  saveDismissal(d: ScanDismissal): Promise<void>;
  deleteDismissal(projectId: string, fingerprint: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  exportAll(): Promise<WorkspaceSnapshot>;
  /** Applies a validated payload. The caller has already parsed the file and shown the user a plan,
   * so this only writes; it never decides. `resolutions` is keyed by entity id, and anything absent
   * keeps what the vault already has. A private backup carries no project code, so its payload is
   * partial by design. */
  importAll(payload: Partial<WorkspaceSnapshot>, mode: ImportMode, resolutions?: Record<string, ImportResolution>): Promise<ImportResult>;
  clearAll(): Promise<void>;
  /** Atomically creates a version and advances its project's pointer. */
  commitVersion(project: Project, version: Version, expectedDraftRevision?: number): Promise<void>;
}
