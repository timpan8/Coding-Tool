import type { LanguageId, Project, ProjectDraft, ProjectFile, Settings, Version } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { DraftConflictError } from '../storage/StorageProvider';
import { usage } from '../domain/render';

const now = () => new Date().toISOString();
const extensions: Record<LanguageId, string> = { powershell: 'ps1', javascript: 'js', typescript: 'ts', python: 'py', json: 'json', xml: 'xml', yaml: 'yaml', shell: 'sh', dotenv: 'env', hcl: 'tf', sql: 'sql', plaintext: 'txt' };
export interface WorkSession {
  key: string; project: Project | null; draft: ProjectDraft | null;
  files: ProjectFile[]; activeFileId: string; texts: Record<string, string>;
  name: string; baseVersionId: string | null;
  versions: Version[]; changed: number; saved: number;
  /** Derived from the active file, recomputed in session(). Keeps the many call sites that only
   * ever care about the open file unchanged. */
  text: string; language: LanguageId;
}
export interface WorkspaceState {
  session: WorkSession; settings: Settings | null; projects: Project[];
  phase: 'loading' | 'saved' | 'pending' | 'saving' | 'error'; error: string;
}
// A dotenv file is named by its extension alone, so it gets the conventional name rather than
// script.env, which nothing would load.
const fileName = (language: LanguageId, index: number) =>
  language === 'dotenv' ? (index === 0 ? '.env' : `.env.del${index + 1}`)
    : `${index === 0 ? 'script' : `del${index + 1}`}.${extensions[language]}`;
function blank(): WorkSession {
  const file: ProjectFile = { id: crypto.randomUUID(), name: fileName('powershell', 0), language: 'powershell', order: 0 };
  return { key: crypto.randomUUID(), project: null, draft: null, files: [file], activeFileId: file.id, texts: { [file.id]: '' },
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
    const merged = { ...this.state.session, ...patch };
    const active = merged.files.find(f => f.id === merged.activeFileId) ?? merged.files[0];
    const session: WorkSession = { ...merged, activeFileId: active.id, text: merged.texts[active.id] ?? '', language: active.language };
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
    const s = this.state.session;
    if (text === s.text) return;
    const texts = { ...s.texts, [s.activeFileId]: text };
    if (!s.project && !text.trim() && !this.writing) { this.session({ texts }); return; }
    this.edit({ texts });
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
    const s = this.state.session;
    if (language === s.language) return;
    // The generated extension follows the language; a name the user chose is left alone.
    const files = s.files.map((f, index) => f.id !== s.activeFileId ? f
      : { ...f, language, name: f.name === fileName(f.language, index) ? fileName(language, index) : f.name });
    if (!s.project && !s.text.trim()) { this.session({ files }); return; }
    this.edit({ files });
  }
  selectFile(fileId: string) {
    if (this.state.session.files.some(f => f.id === fileId)) this.session({ activeFileId: fileId });
  }
  async addFile(language: LanguageId = this.state.session.language) {
    await this.flush();
    const s = this.state.session;
    const file: ProjectFile = { id: crypto.randomUUID(), name: fileName(language, s.files.length), language, order: s.files.length };
    const files = [...s.files, file], texts = { ...s.texts, [file.id]: '' };
    if (!s.project) { this.session({ files, texts, activeFileId: file.id }); return; }
    await this.writeFiles(files, texts, file.id);
  }
  async renameFile(fileId: string, name: string) {
    name = name.trim();
    if (!name) return;
    this.edit({ files: this.state.session.files.map(f => f.id === fileId ? { ...f, name } : f) });
  }
  async removeFile(fileId: string) {
    await this.flush();
    const s = this.state.session;
    if (s.files.length < 2) throw new Error('Ett projekt måste ha minst en fil.');
    const files = s.files.filter(f => f.id !== fileId).map((f, order) => ({ ...f, order }));
    const texts = { ...s.texts };
    delete texts[fileId];
    const active = s.activeFileId === fileId ? files[0].id : s.activeFileId;
    if (!s.project) { this.session({ files, texts, activeFileId: active }); return; }
    await this.writeFiles(files, texts, active);
  }
  /** Adding or removing a file cannot go through the draft autosave path, which deliberately
   * refuses a changed file set. */
  private async writeFiles(files: ProjectFile[], texts: Record<string, string>, activeFileId: string) {
    const s = this.state.session;
    try {
      const draft = await this.storage.changeFiles(s.project!.id, files, texts, s.draft?.revision ?? 0);
      const project = { ...s.project!, files, updatedAt: draft.updatedAt };
      this.session({ project, draft, files, texts, activeFileId, saved: s.changed });
      this.publish({ projects: [project, ...this.state.projects.filter(p => p.id !== project.id)], phase: 'saved' });
    } catch (error) { this.report(error); throw error; }
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
        const files = s.files;
        const project: Project = s.project ? { ...s.project, name: s.name, language: s.language, files, updatedAt: time } : {
          id: s.key, name: s.name, slug: `project-${s.key.slice(0, 8)}`, description: '', language: s.language, tags: [], status: 'experimental',
          files, currentVersionId: null, paths: { rootOverride: null, subfolders: ['Input', 'Output', 'Logs'] }, notes: '', createdAt: time, updatedAt: time, deviceId: this.state.settings!.deviceId,
        };
        // Only the files this session knows about: a template left over from a file removed in
        // another tab must not be written back.
        const templates = Object.fromEntries(files.map(f => [f.id, s.texts[f.id] ?? '']));
        const draft: ProjectDraft = { projectId: project.id, baseVersionId: s.baseVersionId, templates, updatedAt: time, revision: s.draft?.revision ?? 0 };
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
    if (!project) throw new Error('Projektet finns inte längre.');
    // A project with no files is repairable rather than permanently unopenable.
    const files = project.files.length ? [...project.files].sort((a, b) => a.order - b.order)
      : [{ id: crypto.randomUUID(), name: `script.${extensions[project.language]}`, language: project.language, order: 0 }];
    const previous = this.sessions.get(id);
    const baseVersionId = draft?.baseVersionId ?? project.currentVersionId;
    const templates = draft?.templates ?? versions.find(v => v.id === baseVersionId)?.templates ?? {};
    const active = previous?.activeFileId && files.some(f => f.id === previous.activeFileId) ? previous.activeFileId : files[0].id;
    const session: WorkSession = { key: id, project, draft: draft ?? null, files, activeFileId: active,
      texts: Object.fromEntries(files.map(f => [f.id, templates[f.id] ?? ''])),
      text: templates[active] ?? '', language: files.find(f => f.id === active)!.language, name: project.name, baseVersionId,
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
        templates: s.draft.templates, files: s.files, bindingUsage: Object.entries(s.draft.templates).flatMap(([fileId, template]) => usage(template).map(u => ({ ...u, fileId }))),
        createdAt: time, deviceId: this.state.settings!.deviceId };
      const project = { ...s.project, currentVersionId: id, updatedAt: time };
      await this.storage.commitVersion(project, version, s.draft.revision);
      this.session({ project, baseVersionId: id, versions: [version, ...versions], draft: { ...s.draft, baseVersionId: id, updatedAt: time, revision: s.draft.revision + 1 } });
      this.publish({ projects: [project, ...this.state.projects.filter(p => p.id !== project.id)] });
    } catch (error) { this.report(error); throw error; }
  }
  async applyVersion(version: Version) {
    await this.flush();
    const s = this.state.session;
    // Restores every file the version held, not just the open one; a version is a snapshot of the
    // whole project, and restoring half of it would be worse than not restoring at all.
    const files = version.files?.length ? version.files : s.files;
    const texts = Object.fromEntries(files.map(f => [f.id, version.templates[f.id] ?? '']));
    const active = files.some(f => f.id === s.activeFileId) ? s.activeFileId : files[0].id;
    if (files.length !== s.files.length || files.some(f => !s.files.some(existing => existing.id === f.id))) {
      await this.writeFiles(files, texts, active);
      this.edit({ baseVersionId: version.id });
    } else {
      this.edit({ texts, activeFileId: active, baseVersionId: version.id });
    }
    await this.flush();
  }
  /** Drops the in-memory session without writing it back. Needed after the open project is deleted
   * or the vault is replaced by an import: the session still holds a draft revision for a project
   * that no longer exists, so any later flush would throw. */
  reset() {
    clearTimeout(this.timer);
    this.sessions.clear();
    this.lastProjectId = null;
    this.publish({ session: blank(), phase: 'saved', error: '' });
  }
  /** Re-reads the project record after metadata changed outside the draft path. */
  async reloadProject() {
    const s = this.state.session;
    if (!s.project) return;
    const project = await this.storage.getProject(s.project.id);
    if (!project) return;
    this.session({ project });
    this.publish({ projects: [project, ...this.state.projects.filter(p => p.id !== project.id)] });
  }
  /** Re-reads the draft after something rewrote it underneath the session, so the in-memory text
   * and the stored revision line up again. */
  async reloadTemplates() {
    const s = this.state.session;
    if (!s.project) return;
    const [draft, versions] = await Promise.all([this.storage.getDraft(s.project.id), this.storage.listVersions(s.project.id)]);
    if (!draft) return;
    this.session({ draft, versions, texts: Object.fromEntries(s.files.map(f => [f.id, draft.templates[f.id] ?? ''])), saved: this.state.session.changed });
  }
  async reloadVersions() { const s = this.state.session; if (s.project) this.session({ versions: await this.storage.listVersions(s.project.id) }); }
  async reloadSettings() { this.publish({ settings: await this.storage.getSettings() }); }
  async refreshProjects() { this.publish({ projects: await this.storage.listProjects() }); }
  dispose() { clearTimeout(this.timer); }
}
