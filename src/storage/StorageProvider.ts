import type { Binding, BindingFilter, Dataset, DatasetFilter, ImportMode, ImportResult, Profile, Project, ProjectSummary, ScannerRule, Settings, Version, VersionSummary, WorkspaceSnapshot } from '../types/models';

export interface StorageProvider {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
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
  importAll(s: WorkspaceSnapshot, mode: ImportMode): Promise<ImportResult>;
  clearAll(): Promise<void>;
  /** Atomically creates a version and advances its project's pointer. */
  commitVersion(project: Project, version: Version): Promise<void>;
}
