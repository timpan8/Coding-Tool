export type Iso = string;
export type LanguageId = 'powershell' | 'javascript' | 'typescript' | 'python' | 'json' | 'xml' | 'yaml' | 'shell' | 'plaintext';
export type Category = 'secret' | 'identity' | 'infrastructure' | 'environment' | 'configuration' | 'testdata';
export interface ProjectPathConfig { rootOverride: string | null; subfolders: string[] }
export interface ProjectFile { id: string; name: string; language: LanguageId; order: number }
export interface Project {
  id: string; name: string; slug: string; description: string; language: LanguageId;
  tags: string[]; status: 'stable' | 'testing' | 'experimental' | 'broken' | 'archived';
  files: ProjectFile[]; currentVersionId: string | null; paths: ProjectPathConfig; notes: string;
  createdAt: Iso; updatedAt: Iso; deviceId: string;
}
export interface BindingUsage { bindingName: string; fileId: string; occurrences: number }
export interface ProjectDraft {
  projectId: string; baseVersionId: string | null; templates: Record<string, string>;
  updatedAt: Iso; revision: number;
}
export type ProjectDraftMetadata = Pick<Project, 'name' | 'language' | 'files'>;
export interface IngestReport { decisions: { bindingName: string; tier: number; start: number; end: number; accepted: boolean; reason: string }[] }
export interface Version {
  id: string; projectId: string; number: number; label: string; parentVersionId: string | null;
  branchName: string; status: 'stable' | 'testing' | 'experimental' | 'broken'; notes: string;
  templates: Record<string, string>; bindingUsage: BindingUsage[]; ingestReport?: IngestReport;
  createdAt: Iso; deviceId: string;
}
export interface Binding {
  id: string; name: string; category: Category; scope: 'global' | 'project' | 'version'; scopeRef: string | null;
  description: string; aiReplacement: string; values: Record<string, string>; escapeMode: 'auto' | 'raw';
  matchHints: { lastVariableNames: string[]; previousAiValues: string[]; aliases: string[] };
  createdAt: Iso; updatedAt: Iso; deviceId: string;
}
export interface Profile { id: string; name: string; description: string; isActive?: boolean; createdAt: Iso; updatedAt: Iso }
export interface DatasetColumn {
  name: string; type: 'string' | 'number' | 'boolean' | 'date';
  rule?: { kind: 'listRandom'; values: string[] } | { kind: 'template'; pattern: string }
    | { kind: 'sequence'; start: number; step: number; pad?: number }
    | { kind: 'randomInt'; min: number; max: number } | { kind: 'constant'; value: string };
}
export interface Dataset {
  id: string; name: string; description: string; scope: 'global' | 'project'; projectId: string | null;
  sensitive: boolean; columns: DatasetColumn[]; rows: string[][]; generator?: { seed: string; count: number };
  createdAt: Iso; updatedAt: Iso;
}
export interface ScannerRule {
  id: string; name: string; pattern: string; flags: string; severity: 'critical' | 'high' | 'medium' | 'low';
  category: Category; suggestedAiReplacement?: string; enabled: boolean; builtIn: boolean; explanation: string;
}
export interface Settings {
  deviceId: string; deviceName: string; globalRootPath: string; aiRootPath: string; defaultSubfolders: string[];
  activeProfileId: string | null; roundTripMarkers: boolean; includeAiPromptBlock: boolean;
  clipboardAutoClearSeconds: number; maskSecretsInUi: boolean; theme: 'system' | 'light' | 'dark';
}
export interface WorkspaceSnapshot { projects: Project[]; versions: Version[]; drafts: ProjectDraft[]; bindings: Binding[]; profiles: Profile[]; datasets: Dataset[]; rules: ScannerRule[]; settings: Settings }
export type ProjectSummary = Project;
export type VersionSummary = Version;
export interface BindingFilter { projectId?: string; versionId?: string }
export interface DatasetFilter { projectId?: string }
export type ImportMode = 'merge' | 'replace';
/** What to do with an entity the vault already has: keep the vault's, take the file's, or keep both. */
export type ImportResolution = 'keep' | 'replace' | 'duplicate';
export interface ImportResult { added: number; replaced: number; duplicated: number; skipped: number }
export const languages: LanguageId[] = ['powershell', 'javascript', 'typescript', 'python', 'json', 'xml', 'yaml', 'shell', 'plaintext'];
export const categories: Category[] = ['secret', 'identity', 'infrastructure', 'environment', 'configuration', 'testdata'];
