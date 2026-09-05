import type { Binding, BindingFilter, Dataset, DatasetFilter, ImportMode, ImportResolution, ImportResult, Profile, Project, ProjectSummary, ScannerRule, Settings, Version, VersionSummary, WorkspaceSnapshot } from '../types/models';
import type { ProjectDraft, ProjectDraftMetadata } from '../types/models';

export class DraftConflictError extends Error {
  constructor() { super('Projektet har ändrats i en annan flik. Din text finns kvar här. Kopiera mallen till en lokal fil innan du laddar om projektet.'); this.name = 'DraftConflictError'; }
}

export interface StorageProvider {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  getDraft(projectId: string): Promise<ProjectDraft | undefined>;
  createProjectWithDraft(project: Project, draft: ProjectDraft): Promise<ProjectDraft>;
  saveDraft(draft: ProjectDraft, expectedRevision: number, metadata: ProjectDraftMetadata): Promise<ProjectDraft>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  getVersion(id: string): Promise<Version | undefined>;
  saveVersion(v: Version): Promise<void>;
  deleteVersion(id: string): Promise<void>;
  listBindings(filter?: BindingFilter): Promise<Binding[]>;
  saveBinding(b: Binding): Promise<void>;
  deleteBinding(id: string): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  saveProfile(p: Profile): Promise<void>;
  listDatasets(filter?: DatasetFilter): Promise<Dataset[]>;
  saveDataset(d: Dataset): Promise<void>;
  listScannerRules(): Promise<ScannerRule[]>;
  saveScannerRule(r: ScannerRule): Promise<void>;
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
