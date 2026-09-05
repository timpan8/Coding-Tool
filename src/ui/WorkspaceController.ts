import type { LanguageId, Project, ProjectDraft, Settings, Version } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { DraftConflictError } from '../storage/StorageProvider';
import { usage } from '../domain/render';

const now = () => new Date().toISOString();
const extensions: Record<LanguageId, string> = { powershell: 'ps1', javascript: 'js', typescript: 'ts', python: 'py', json: 'json', xml: 'xml', yaml: 'yaml', shell: 'sh', plaintext: 'txt' };
export interface WorkSession {
  key: string; fileId: string; project: Project | null; draft: ProjectDraft | null;
  text: string; language: LanguageId; name: string; baseVersionId: string | null;
  versions: Version[]; changed: number; saved: number;
}
export interface WorkspaceState {
  session: WorkSession; settings: Settings | null; projects: Project[];
  phase: 'loading' | 'saved' | 'pending' | 'saving' | 'error'; error: string;
}
function blank(): WorkSession {
  return { key: crypto.randomUUID(), fileId: crypto.randomUUID(), project: null, draft: null,
    text: '', language: 'powershell', name: 'Namnlöst projekt', baseVersionId: null, versions: [], changed: 0, saved: 0 };
}
/** Serializes working-copy writes independently of React renders and routing.
 * A captured revision is acknowledged only after its transaction succeeds.
 * Edits made while a write is in flight remain pending and are drained next.
 */
export class WorkspaceController {
  private state: WorkspaceState = { session: blank(), settings: null, projects: [], phase: 'loading', error: '' };
  private sessions = new Map<string, WorkSession>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | null = null;
  private initialization: Promise<void> | null = null;
  private conflict = false;
  private lastProjectId: string | null = null;
  constructor(private storage: StorageProvider) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<WorkspaceState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private session(patch: Partial<WorkSession>) {
    const session = { ...this.state.session, ...patch };
    this.sessions.set(session.key, session);
    this.publish({ session });
  }
  initialize() {
    if (!this.initialization) this.initialization = Promise.all([this.storage.getSettings(), this.storage.listProjects()]).then(([settings, projects]) => {
      this.publish({ settings, projects, phase: this.isDirty() ? 'pending' : 'saved' });
    }).catch(error => { this.report(error); throw error; });
    return this.initialization;
  }
  isDirty() { return this.state.session.changed !== this.state.session.saved || this.writing !== null; }
  getLastProjectId() { return this.state.session.project?.id ?? this.lastProjectId; }
  private edit(patch: Partial<WorkSession>) {
    this.session({ ...patch, changed: this.state.session.changed + 1 });
    if (this.state.error) return; // Never blindly retry after a failed/conflicting write.
    this.publish({ phase: 'pending' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 500);
  }
  changeText(text: string) {
    if (text === this.state.session.text) return;
    if (!this.state.session.project && !text.trim() && !this.writing) { this.session({ text }); return; }
    this.edit({ text });
    // Creation starts at first meaningful input, not at a separate Create action.
    if (!this.state.session.project && !this.state.error) void this.flush().catch(() => {});
  }
  rename(name: string) {
    name = name.trim() || 'Namnlöst projekt';
    if (name === this.state.session.name) return;
    if (!this.state.session.project && !this.state.session.text.trim()) { this.session({ name }); return; }
    this.edit({ name });
  }
  changeLanguage(language: LanguageId) {
    if (language === this.state.session.language) return;
    if (!this.state.session.project && !this.state.session.text.trim()) { this.session({ language }); return; }
    this.edit({ language });
  }
  async flush(retry = false): Promise<void> {
    clearTimeout(this.timer);
    if (this.writing) return this.writing;
    if (this.state.error && (!retry || this.conflict)) throw new Error(this.state.error);
    if (retry) this.publish({ error: '' });
    if (this.state.session.changed === this.state.session.saved) return;
    this.writing = this.persist().finally(() => { this.writing = null; });
    return this.writing;
  }
  private async persist() {
    try {
      await this.initialize();
      while (this.state.session.changed !== this.state.session.saved) {
        this.publish({ phase: 'saving' });
        const s = this.state.session, time = now();
        const files = s.project?.files.map(f => f.id === s.fileId ? { ...f, language: s.language } : f)
          ?? [{ id: s.fileId, name: `script.${extensions[s.language]}`, language: s.language, order: 0 }];
        const project: Project = s.project ? { ...s.project, name: s.name, language: s.language, files, updatedAt: time } : {
          id: s.key, name: s.name, slug: `project-${s.key.slice(0, 8)}`, description: '', language: s.language, tags: [], status: 'experimental',
          files, currentVersionId: null, paths: { rootOverride: null, subfolders: ['Input', 'Output', 'Logs'] }, notes: '', createdAt: time, updatedAt: time, deviceId: this.state.settings!.deviceId,
        };
        const draft: ProjectDraft = { projectId: project.id, baseVersionId: s.baseVersionId,
          templates: { ...s.draft?.templates, [s.fileId]: s.text }, updatedAt: time, revision: s.draft?.revision ?? 0 };
        const saved = s.project ? await this.storage.saveDraft(draft, draft.revision, { name: project.name, language: project.language, files })
          : await this.storage.createProjectWithDraft(project, draft);
        this.session({ project, draft: saved, saved: s.changed });
        this.lastProjectId = project.id;
        this.publish({ projects: [project, ...this.state.projects.filter(p => p.id !== project.id)] });
      }
      this.publish({ phase: 'saved', error: '' });
    } catch (error) { this.report(error); throw error; }
  }
  private report(error: unknown) {
    this.conflict = error instanceof DraftConflictError;
    this.publish({ phase: 'error', error: this.conflict ? (error as Error).message : 'Lokal sparning misslyckades. Din text finns kvar i fliken. Försök igen eller kopiera mallen till en lokal fil innan du lämnar sidan.' });
  }
  async newCode() {
    await this.flush();
    if (this.state.session.project) this.lastProjectId = this.state.session.project.id;
    this.publish({ session: blank(), phase: 'saved', error: '' });
  }
  async open(id: string) {
    await this.flush();
    await this.initialize();
    if (this.state.session.project?.id === id) return;
    const [project, draft, versions] = await Promise.all([this.storage.getProject(id), this.storage.getDraft(id), this.storage.listVersions(id)]);
    if (!project?.files[0]) throw new Error('Projektet finns inte längre.');
    const previous = this.sessions.get(id);
    const baseVersionId = draft?.baseVersionId ?? project.currentVersionId;
    const templates = draft?.templates ?? versions.find(v => v.id === baseVersionId)?.templates ?? {};
    const session: WorkSession = { key: id, fileId: project.files[0].id, project, draft: draft ?? null,
      text: templates[project.files[0].id] ?? '', language: project.files[0].language, name: project.name, baseVersionId,
      versions, changed: previous?.changed ?? 0, saved: previous?.changed ?? 0 };
    this.sessions.set(id, session); this.lastProjectId = id;
    this.publish({ session, phase: 'saved', error: '' });
  }
  async saveVersion(label = '') {
    await this.flush();
    const s = this.state.session;
    if (!s.project || !s.draft) return;
    try {
      const versions = await this.storage.listVersions(s.project.id), time = now(), id = crypto.randomUUID();
      const version: Version = { id, projectId: s.project.id, number: Math.max(0, ...versions.map(v => v.number)) + 1,
        label, parentVersionId: s.baseVersionId, branchName: 'main', status: 'experimental', notes: '',
        templates: s.draft.templates, bindingUsage: Object.entries(s.draft.templates).flatMap(([fileId, template]) => usage(template).map(u => ({ ...u, fileId }))),
        createdAt: time, deviceId: this.state.settings!.deviceId };
      const project = { ...s.project, currentVersionId: id, updatedAt: time };
      await this.storage.commitVersion(project, version, s.draft.revision);
      this.session({ project, baseVersionId: id, versions: [version, ...versions], draft: { ...s.draft, baseVersionId: id, updatedAt: time, revision: s.draft.revision + 1 } });
      this.publish({ projects: [project, ...this.state.projects.filter(p => p.id !== project.id)] });
    } catch (error) { this.report(error); throw error; }
  }
  async applyVersion(version: Version) {
    await this.flush();
    this.edit({ text: version.templates[this.state.session.fileId] ?? '', baseVersionId: version.id });
    await this.flush();
  }
  async refreshProjects() { this.publish({ projects: await this.storage.listProjects() }); }
  dispose() { clearTimeout(this.timer); }
}
