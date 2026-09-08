export type Iso = string;
export type LanguageId = 'powershell' | 'javascript' | 'typescript' | 'python' | 'json' | 'xml' | 'yaml' | 'shell' | 'dotenv' | 'hcl' | 'sql' | 'csharp' | 'go' | 'java' | 'dockerfile' | 'ini' | 'toml' | 'plaintext';
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
  /** The file list as it stood when the version was saved. Without it a diff across a rename shows
   * a phantom delete and add, and a preview cannot label its tabs. Absent on older records. */
  files?: ProjectFile[];
  createdAt: Iso; deviceId: string;
}
export interface Binding {
  id: string; name: string; category: Category; scope: 'global' | 'project' | 'version'; scopeRef: string | null;
  description: string; aiReplacement: string; values: Record<string, string>; escapeMode: 'auto' | 'raw';
  matchHints: { lastVariableNames: string[]; previousAiValues: string[]; aliases: string[] };
  /** A path written against the shared root, e.g. `{{ROOT}}\\AdSync`. When set, and when the
   * renderer knows the root, it decides the value: changing the root moves every path at once.
   * The stored value is kept in step so a context without a root still resolves. */
  pathTemplate?: string;
  /** Values this binding used to have. A rotated password is still the password that was on the
   * account last week, and code written then still carries it, so the leak check keeps watching
   * them for good. Absent on records written before this existed. */
  retired?: string[];
  /** When a real value of this binding was last found in code coming back from an AI. A fact
   * about what happened, not a judgement: the panel shows it until the value is rotated. */
  exposedAt?: Iso;
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
/** A term that must never reach an AI. Unlike a scanner rule, which points at what looks sensitive
 * and leaves the judgement to you, this is a decision already made: the term becomes a binding the
 * moment it lands in the workspace. `replacement` is the harmless value the AI sees; empty means the
 * category's default. A literal, never an expression — the reason is in domain/scanner/rules.ts. */
export interface BlocklistEntry { id: string; term: string; replacement: string; enabled: boolean; createdAt: Iso }
export interface ScannerRule {
  id: string; name: string; pattern: string; flags: string; severity: 'critical' | 'high' | 'medium' | 'low';
  category: Category; suggestedAiReplacement?: string; enabled: boolean; builtIn: boolean; explanation: string;
}
/** A finding the user has judged harmless in this project. Keyed by a hash of the value, never the
 * value, so the record is safe to store and to include in a backup. */
export interface ScanDismissal { projectId: string; fingerprint: string; ruleId: string; reason: string; createdAt: Iso; deviceId: string }
export interface Settings {
  deviceId: string; deviceName: string; globalRootPath: string; aiRootPath: string; defaultSubfolders: string[];
  activeProfileId: string | null; roundTripMarkers: boolean; includeAiPromptBlock: boolean; aiPromptText: string;
  clipboardAutoClearSeconds: number; maskSecretsInUi: boolean; theme: 'system' | 'light' | 'dark';
  editorFontSize: number; editorWordWrap: boolean; introSeen: boolean;
  /** Whether Copy Local starts with the line that says the text carries real values. On by
   * default; absent means on, so a vault written before this existed gets it. */
  localSentinel?: boolean;
  /** Minutes of inactivity before an encrypted vault locks itself; 0 or absent means never. Kept
   * in plaintext with the other lock-screen settings, since it has to be read to arm the timer. */
  autoLockMinutes?: number;
  /** When the vault was last exported. The only way back from cleared browser data is a file the
   * user made, so the app has to be able to say how old that file is. Absent means never. */
  lastExportAt?: Iso;
}
export interface WorkspaceSnapshot { projects: Project[]; versions: Version[]; drafts: ProjectDraft[]; bindings: Binding[]; profiles: Profile[]; datasets: Dataset[]; rules: ScannerRule[]; blocklist: BlocklistEntry[]; dismissals: ScanDismissal[]; settings: Settings }
export type ProjectSummary = Project;
export type VersionSummary = Version;
export interface BindingFilter { projectId?: string; versionId?: string }
export interface DatasetFilter { projectId?: string }
export type ImportMode = 'merge' | 'replace';
/** What to do with an entity the vault already has: keep the vault's, take the file's, or keep both. */
export type ImportResolution = 'keep' | 'replace' | 'duplicate';
export interface ImportResult { added: number; replaced: number; duplicated: number; skipped: number }
export const languages: LanguageId[] = ['powershell', 'javascript', 'typescript', 'python', 'json', 'xml', 'yaml', 'shell', 'dotenv', 'hcl', 'sql', 'csharp', 'go', 'java', 'dockerfile', 'ini', 'toml', 'plaintext'];
export const categories: Category[] = ['secret', 'identity', 'infrastructure', 'environment', 'configuration', 'testdata'];
