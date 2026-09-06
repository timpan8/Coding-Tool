import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Binding, BlocklistEntry, LanguageId, Settings, Version } from '../types/models';
import { languages } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { resolveBinding, resolveValue, suggestBinding, defaults, BindingRefusal } from '../domain/bindings';
import { expandToLiteral } from '../domain/bindings/literal';
import { applyBlocklist } from '../domain/blocklist';
import { render, usage } from '../domain/render';
import { auditForCopy, auditSelection, promptBlock, type CopyAudit } from '../domain/render/audit';
import { buildValueIndex } from '../domain/render/leak';
import { WorkspaceController } from './WorkspaceController';
import { Editor, type Selection } from './editor/Editor';
import { BindingDialog } from './components/BindingDialog';
import { Modal } from './components/Modal';
import { ProjectBrowser } from './components/ProjectBrowser';
import { filterProjects, ProjectCard, ProjectFilters, sortProjects, useProjectFacts, type SortKey } from './components/ProjectsPage';
import { useConfirm } from './components/ConfirmDialog';
import { useUndo } from './components/UndoBar';
import { Intro } from './components/Intro';
import { collectIssues, IssuePanel, type LocatedIssue } from './components/IssuePanel';
import { FindingsPanel, useDismissals, useScanner } from './components/FindingsPanel';
import { FileTabs } from './components/FileTabs';
import { VersionPanel } from './components/VersionPanel';
import { VersionViewer } from './components/VersionViewer';
import { ProjectDetails } from './components/ProjectDetails';
import { BindingPanel, toRows } from './components/BindingPanel';
import { BindingsPage, useBindingUses } from './components/BindingsPage';
import { SettingsPage } from './components/SettingsPage';
import { BackupPanel } from './components/BackupPanel';
import { CopyDialog } from './components/CopyDialog';
import { EditorToolbar, type Mode } from './components/EditorToolbar';
import { ProfileManager, ProfilePicker } from './components/ProfilePicker';
import { IngestDialog } from './components/IngestDialog';
import { Exits } from './components/Exits';
import { useToasts } from './components/Toasts';
import { ClipboardBanner, type ClipboardHold } from './components/ClipboardBanner';
import { editorShortcuts, match, shortcuts } from './shortcuts';
import { t } from './text';
import { detectLanguage, languageForFile } from '../domain/detect';
import { scan, type Finding } from '../domain/scanner';
import type { Profile, ScannerRule } from '../types/models';
import { Security } from './pages/Security';
import { applyTheme, paintHint, resolveTheme, systemPrefersDark, watchSystemTheme, type ThemeChoice } from './theme';
import { requestPersistence, storageState, type StorageState } from '../storage/persistence';
import { clearClipboard } from './clipboard';
import { download } from './download';
import './code-first.css';

/** A fresh [] here would be a new prop every render, re-running the editor's decoration effect and
 * replacing its DOM continuously. */
const noSubstitutions: { start: number; end: number; name: string }[] = [];
/** One per language: the empty state previously offered a sample only when the language happened
 * to be PowerShell, which is every language but one. */
const samples: Partial<Record<LanguageId, string>> = {
  powershell: '$username = "example.user"\n$password = "<PASSWORD>"\n$exportPath = "C:\\Temp\\Example"\n',
  python: 'username = "example.user"\npassword = "<PASSWORD>"\nexport_path = "/tmp/example"\n',
  javascript: 'const username = "example.user";\nconst password = "<PASSWORD>";\nconst host = "server.example.test";\n',
  typescript: 'const username: string = "example.user";\nconst password: string = "<PASSWORD>";\n',
  json: '{\n  "username": "example.user",\n  "password": "<PASSWORD>"\n}\n',
  yaml: 'username: example.user\npassword: "<PASSWORD>"\nhost: server.example.test\n',
  dotenv: 'DATABASE_URL="postgres://example.user@server.example.test/app"\nAPI_KEY=\'<API_KEY>\'\n',
  hcl: 'resource "aws_db_instance" "main" {\n  username = "example.user"\n  password = "<PASSWORD>"\n}\n',
  sql: "CREATE USER 'example.user' IDENTIFIED BY '<PASSWORD>';\nGRANT SELECT ON app.* TO 'example.user';\n",
  csharp: 'var user = "example.user";\nvar password = "<PASSWORD>";\nvar path = @"C:\\Temp\\Example";\n',
  go: 'user := "example.user"\npassword := "<PASSWORD>"\nhost := "server.example.test"\n',
  java: 'String user = "example.user";\nString password = "<PASSWORD>";\n',
  dockerfile: 'FROM node:22-alpine\nENV DB_USER="example.user"\nENV DB_PASSWORD="<PASSWORD>"\n',
  ini: '[database]\nuser=example.user\npassword=<PASSWORD>\n',
  toml: '[database]\nuser = "example.user"\npassword = "<PASSWORD>"\n',
  shell: 'USERNAME="example.user"\nPASSWORD="<PASSWORD>"\nHOST="server.example.test"\n',
  xml: '<config>\n  <user>example.user</user>\n  <password>&lt;PASSWORD&gt;</password>\n</config>\n',
  plaintext: 'anvandare: example.user\nlosenord: <PASSWORD>\n',
};
function ProjectName({ name, change }: { name: string; change: (name: string) => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(name);
  const cancelled = useRef(false);
  if (!editing) return <button className="project-name" aria-label={t.workspace.renameProject} onClick={() => { setText(name); cancelled.current = false; setEditing(true); }}>{name}<span>✎</span></button>;
  function finish() { if (!cancelled.current) change(text); setEditing(false); }
  return <input className="project-name-input" aria-label="Projektnamn" autoFocus value={text} onFocus={e => e.target.select()} onChange={e => setText(e.target.value)}
    onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { cancelled.current = true; setEditing(false); } }} />;
}

/** What the app actually checked, said plainly. The previous wording announced that no known
 * problems were found even when nothing had been bound and therefore nothing could be known,
 * which made the default paste-and-copy path read as a clean bill of health. */
/** Every version was previously saved with no label, so the history read "Sparad version" all the
 * way down and two saves on the same day were impossible to tell apart. */
function SaveVersionDialog({ next, save, close }: { next: number; save: (label: string) => void; close: () => void }) {
  const [label, setLabel] = useState('');
  return (
    <Modal title={`Spara v${next}`} close={close}>
      <label>
        Vad utmärker den här versionen?
        <input autoFocus aria-label="Versionsetikett" value={label} onChange={e => setLabel(e.target.value)}
          placeholder="t.ex. innan omskrivningen av inloggningen"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(label); } }} />
        <small>{t.version.labelHint}</small>
      </label>
      <div className="dialog-actions">
        <button onClick={close}>Avbryt</button>
        <button className="primary" onClick={() => save(label)}>Spara version</button>
      </div>
    </Modal>
  );
}

export function App({ storage }: { storage: StorageProvider }) {
  const [controller] = useState(() => new WorkspaceController(storage));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { session, projects, settings, phase } = state;
  const { project, text: template, language, versions } = session;
  const [route, setRoute] = useState(location.hash || '#/'), routeRef = useRef(route);
  const [bindings, setBindings] = useState<Binding[]>([]), [mode, setMode] = useState<Mode>('template');
  const [drawer, setDrawer] = useState(false), [query, setQuery] = useState(''), [drawerQuery, setDrawerQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated'), [languageFilter, setLanguageFilter] = useState(''), [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [error, setError] = useState('');
  const [toast, toasts] = useToasts();
  /** Report U6. Every failure used to be a full-screen modal titled "Åtgärden behöver
   * uppmärksamhet", including ones the user can simply try again. The modal is for something that
   * needs a decision; a refusal or a failed convenience is a toast — a warning one, which stays
   * longer and keeps its close button, but never a dialog in the way. */
  const setNotice = (text: string) => toast(text, 'ok');
  const warn = (text: string) => toast(text, 'warn');

  const [bindingDialog, setBindingDialog] = useState<{ binding: Binding; selection?: Selection; reuse?: string } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false), [focusName, setFocusName] = useState(''), [focusLine, setFocusLine] = useState<number>();
  const [viewing, setViewing] = useState<{ version: Version; compareTo: Version | null } | null>(null), [labelling, setLabelling] = useState(false), [details, setDetails] = useState(false);
  const [copyMode, setCopyMode] = useState<'local' | 'ai' | null>(null), [reviewed, setReviewed] = useState(false), [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const [deviceName, setDeviceName] = useState(''), currentLine = useRef(1);
  const [theme, setTheme] = useState<ThemeChoice>(paintHint()), [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [storageInfo, setStorageInfo] = useState<StorageState | null>(null), asked = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const [offerUndo, undoBar] = useUndo(setNotice);
  const [rules, setRules] = useState<ScannerRule[]>([]), [profiles, setProfiles] = useState<Profile[]>([]), [managingProfiles, setManagingProfiles] = useState(false);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [ingesting, setIngesting] = useState(false), [showShortcuts, setShowShortcuts] = useState(false), [dropping, setDropping] = useState(false);
  const [dismissed, refreshDismissals] = useDismissals(() => project ? storage.listDismissals(project.id) : Promise.resolve([]), project?.id ?? '');
  const findings = useScanner(mode === 'template' ? template : '', rules, dismissed);
  const [hold, setHold] = useState<ClipboardHold | null>(null), [armed, setArmed] = useState(false);
  const overview = useRef<HTMLDivElement>(null), overviewScroll = useRef(0);
  const navigateRef = useRef<(hash: string, replace?: boolean) => Promise<void>>(async () => {});
  /** File ids whose language came from the user or from a filename. Detection never overrides
   * one of those, and the memory is per file because the language is. */
  const languageChosen = useRef(new Set<string>());
  const workspaceVisible = route === '#/' || route.startsWith('#/project/');
  const fontSize = settings?.editorFontSize ?? 14, wrap = settings?.editorWordWrap ?? true;
  const [selected, setSelected] = useState<Selection | null>(null);
  const [intro, setIntro] = useState(false);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) { warn(t.refusal.busy); return; }
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch (e) { if (!controller.getSnapshot().error) setError(e instanceof Error ? e.message : t.refusal.actionFailed); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function setLocation(hash: string, replace = false) {
    if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) history.pushState(null, '', hash);
    routeRef.current = hash; setRoute(hash);
  }
  async function navigate(hash: string, replace = false) {
    // Report U6. Cancelling silently left the address bar snapping back with nothing said, which
    // reads as a broken link rather than as "not now".
    if (busyRef.current) {
      history.replaceState(null, '', routeRef.current);
      warn(t.refusal.navigating);
      return;
    }
    await run(async () => {
      await controller.flush();
      const id = /^#\/project\/([a-f0-9-]+)$/.exec(hash)?.[1];
      if (id) { await controller.open(id); setMode('template'); setFocusName(''); setFocusLine(undefined); }
      else if (hash === '#/' && (routeRef.current !== '#/' || controller.getSnapshot().session.project)) {
        await controller.newCode(); setMode('template'); setFocusName(''); setFocusLine(undefined);
      } else if (!['#/', '#/projects', '#/bindings', '#/backup', '#/settings', '#/security'].includes(hash)) throw new Error(t.refusal.unknownPage);
      setShowSecrets(false); setDrawer(false);
      setBindings(await storage.listBindings()); setLocation(hash, replace);
    });
  }
  navigateRef.current = navigate;
  useEffect(() => {
    let alive = true;
    void controller.initialize().then(async () => {
      if (!alive) return;
      const stored = controller.getSnapshot().settings!;
      setDeviceName(stored.deviceName); setTheme(stored.theme); applyTheme(stored.theme); setBindings(await storage.listBindings());
      if (routeRef.current.startsWith('#/project/')) await navigateRef.current(routeRef.current, true);
    }).catch(() => {});
    const changed = () => { const target = location.hash || '#/'; history.replaceState(null, '', routeRef.current); void navigateRef.current(target, true); };
    const unload = (e: BeforeUnloadEvent) => { if (controller.isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('hashchange', changed); window.addEventListener('beforeunload', unload);
    return () => { alive = false; window.removeEventListener('hashchange', changed); window.removeEventListener('beforeunload', unload); controller.dispose(); };
  }, [controller, storage]);
  useEffect(() => watchSystemTheme(setSystemDark), []);
  useEffect(() => { void storageState().then(setStorageInfo); }, []);
  useEffect(() => { void storage.listScannerRules().then(setRules).catch(() => {}); }, [storage]);
  useEffect(() => { void storage.listProfiles().then(setProfiles).catch(() => {}); }, [storage]);
  useEffect(() => { void storage.listBlocklist().then(setBlocklist).catch(() => {}); }, [storage]);
  // Asking on an empty first visit would prompt Firefox users before they have anything to lose.
  useEffect(() => {
    if (!project || asked.current) return;
    asked.current = true;
    void requestPersistence().then(setStorageInfo);
  }, [project]);
  useEffect(() => { if (project && routeRef.current === '#/') setLocation(`#/project/${project.id}`, true); }, [project]);
  useEffect(() => { if (route === '#/projects' && overview.current) overview.current.scrollTop = overviewScroll.current; }, [route]);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(reg => {
      if (reg.waiting) setUpdateReady(reg);
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', () => { if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(reg); }));
    }).catch(() => setNotice(t.app.offlineFailed));
  }, []);

  const resolvedTheme = resolveTheme(theme, systemDark);
  const options = { language, projectId: project?.id ?? '', versionId: session.baseVersionId, profileId: settings?.activeProfileId ?? null };
  // Every derived value below used to be recomputed on each keystroke, twice over the whole
  // template. The value index is the expensive part and only changes when the bindings do.
  const valueIndex = useMemo(() => buildValueIndex(bindings), [bindings]);
  const optionsKey = `${language}|${options.projectId}|${options.versionId}|${options.profileId}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsKey stands in for options.
  const ai = useMemo(() => auditForCopy(template, bindings, { ...options, mode: 'ai' }, valueIndex), [template, bindings, optionsKey, valueIndex]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsKey stands in for options.
  const local = useMemo(() => render(template, bindings, { ...options, mode: 'local', maskSecrets: !showSecrets }), [template, bindings, optionsKey, showSecrets]);
  const cover = ai.coverage;
  // Re-scanned synchronously here rather than reusing the idle-scheduled list, so the dialog
  // describes the text being copied and not what the panel last saw.
  const copyFindings = copyMode === 'ai' ? scan(template, rules).filter(f => !dismissed.has(f.fingerprint)) : [];
  const seriousFindings = copyFindings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
  const visible = mode === 'template' ? template : mode === 'ai' ? ai.text : local.text;
  const issues = useMemo(() => collectIssues(template, local, ai), [template, local, ai]);
  const used = useMemo(() => usage(template), [template]);
  /** What the second press of Copy RIKTIGT will write, counted from the local projection. */
  const localChecklist = useMemo(() => {
    const missing = [...new Set(local.issues.filter(i => i.kind === 'missing').map(i => i.name))];
    return { resolved: used.length - missing.length, total: used.length, missing,
      blocked: local.issues.filter(i => i.kind === 'context').length, secrets: local.secretRanges.length,
      profile: profiles.find(p => p.id === options.profileId)?.name };
  }, [used, local, profiles, options.profileId]);
  // The arming lapses on its own, and the text changing under it is a reason to start over.
  useEffect(() => { if (!armed) return; const id = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(id); }, [armed]);
  useEffect(() => { setArmed(false); }, [template, mode]);
  const activeBindings = bindings.filter(b => resolveBinding(b.name, bindings, options.projectId, options.versionId)?.id === b.id)
    .sort((a, b) => Number(Boolean(resolveValue(a, options.profileId))) - Number(Boolean(resolveValue(b, options.profileId))) || a.name.localeCompare(b.name));
  const saveStatus = phase === 'loading' ? t.save.loading : phase === 'error' ? t.save.failed : phase === 'saved' ? t.save.saved : t.save.saving;
  const currentId = controller.getLastProjectId();
  const filtered = sortProjects(filterProjects(projects, query, languageFilter, statusFilter), sort);
  const facts = useProjectFacts(storage, projects, route === '#/projects');
  const bindingUses = useBindingUses(storage, projects, route === '#/bindings');
  async function removeVersion(version: Version) {
    await run(async () => {
      if (version.id === session.baseVersionId) throw new Error(t.version.draftBasedOnIt);
      if (!await confirm({ title: t.version.deleteTitle(version.number), danger: true, confirmLabel: t.version.deleteConfirm,
        body: <><p>{t.version.deleteBody(version.label)}</p><p>{t.version.deleteDraftUnaffected}</p></> })) return;
      // The record itself is the way back. Version-scoped bindings go with it, so they are read
      // before the delete — afterwards there is nothing left to read.
      const scoped = (await storage.listBindings()).filter(b => b.scope === 'version' && b.scopeRef === version.id);
      await storage.deleteVersion(version.id);
      await controller.reloadVersions();
      setViewing(null);
      offerUndo({ label: t.version.deleted(version.number), restore: async () => {
        await storage.importAll({ versions: [version], bindings: scoped }, 'merge');
        await controller.reloadVersions();
        setBindings(await storage.listBindings());
      } });
    });
  }
  async function removeProject(id: string, name: string) {
    await run(async () => {
      const [versions, all] = await Promise.all([storage.listVersions(id), storage.listBindings()]);
      const scoped = all.filter(b => b.scope === 'project' && b.scopeRef === id);
      if (!await confirm({ title: t.project.deleteTitle(name), danger: true, confirmLabel: t.project.deleteConfirm, typeToConfirm: 'RADERA',
        body: <><p>{t.project.deleteLead}</p><ul><li>{t.project.deleteVersions(versions.length)}</li><li>{t.project.deleteBindings(scoped.length)}</li><li>{t.project.deleteDraft}</li></ul><p>{t.project.deleteGlobalsSafe}</p></> })) return;
      const wasOpen = controller.getSnapshot().session.project?.id === id;
      // Read before the delete: afterwards there is nothing left to read.
      const captured = await storage.captureProject(id);
      await storage.deleteProject(id);
      // The session still points at the deleted project, so it must be dropped before anything
      // else runs; a later flush would try to save a draft for a project that is gone.
      if (wasOpen) controller.reset();
      await controller.refreshProjects();
      setBindings(await storage.listBindings());
      if (wasOpen) setLocation('#/', true);
      offerUndo({ label: t.project.deleted(name), restore: async () => {
        await storage.importAll(captured, 'merge');
        await controller.refreshProjects();
        setBindings(await storage.listBindings());
      } });
    });
  }
  async function saveVersion(label: string) {
    setLabelling(false);
    await run(() => controller.saveVersion(label.trim()));
  }
  function changeTheme(next: ThemeChoice) {
    setTheme(next); applyTheme(next);
    if (settings) void storage.saveSettings({ ...settings, theme: next }).catch(() => setNotice(t.app.themeNotSaved));
  }
  function bindFinding(finding: Finding) {
    changeMode('template'); setFocusLine(finding.line);
    const value = template.slice(finding.start, finding.end);
    createBinding({ text: value, start: finding.start, end: finding.end, line: finding.line,
      lineBefore: template.slice(template.lastIndexOf('\n', finding.start) + 1, finding.start) }, finding);
  }
  /** Binding one finding at a time meant a dialog for each, and a file that arrives with a dozen of
   * them is exactly when that hurts most. Nothing here needs a decision the finding has not already
   * made: the rule says what the value is and what an AI may see instead. The dialog stays for the
   * one-at-a-time path, where the point is to look at it.
   *
   * Undoing removes the bindings as well as the substitution. They were created without anyone
   * seeing them, so leaving them behind would leave a mess nobody asked for. */
  async function bindFindings(chosen: Finding[]) {
    await run(async () => {
      await controller.flush();
      const current = controller.getSnapshot();
      if (!current.settings) return;
      const scope = current.session.project
        ? { scope: 'project' as const, scopeRef: current.session.project.id }
        : { scope: 'global' as const, scopeRef: null };
      const before = current.session.text;
      const created: Binding[] = [];
      const time = new Date().toISOString();
      let text = before;
      // Back to front, so replacing one value does not move the next one's offsets.
      for (const finding of [...chosen].sort((a, b) => b.start - a.start)) {
        const value = before.slice(finding.start, finding.end);
        // The same value twice is one binding, here as everywhere else.
        const owner = [...bindings, ...created].find(b => Object.values(b.values).includes(value)
          && (b.scope === 'global' || (b.scope === scope.scope && b.scopeRef === scope.scopeRef)));
        let name = owner?.name;
        if (!name) {
          const lineBefore = before.slice(before.lastIndexOf('\n', finding.start) + 1, finding.start);
          name = suggestBinding(lineBefore, value, [...bindings, ...created], scope).name;
          created.push({ id: crypto.randomUUID(), name, category: finding.category, ...scope, description: '',
            aiReplacement: finding.suggestedAiReplacement || defaults[finding.category],
            values: { __default__: value }, escapeMode: 'auto',
            matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] },
            createdAt: time, updatedAt: time, deviceId: current.settings.deviceId });
        }
        text = text.slice(0, finding.start) + `{{${name}}}` + text.slice(finding.end);
      }
      for (const binding of created) await storage.saveBinding(binding);
      setBindings(await storage.listBindings());
      controller.changeText(text); changeMode('template'); await controller.flush();
      setNotice(t.findings.boundMany(created.length));
      offerUndo({ label: t.findings.boundManyUndo(created.length), restore: async () => {
        for (const binding of created) await storage.deleteBinding(binding.id);
        setBindings(await storage.listBindings());
        controller.changeText(before); await controller.flush();
      } });
    });
  }
  /** Report F-2.7. One click on a 68×21 px button silenced a finding for good — in the panel and
   * in the copy dialog, which filters on the same set. There was no confirmation, no undo and no
   * list of what had been dismissed, while `deleteDismissal` sat implemented in the storage layer
   * without a single caller. The delete is what the other three destructive actions already do. */
  async function dismissFinding(finding: Finding) {
    const current = controller.getSnapshot();
    if (!current.session.project || !current.settings) return;
    const projectId = current.session.project.id;
    await storage.saveDismissal({ projectId, fingerprint: finding.fingerprint,
      ruleId: finding.ruleId, reason: '', createdAt: new Date().toISOString(), deviceId: current.settings.deviceId });
    refreshDismissals();
    offerUndo({ label: t.findings.dismissed(finding.ruleName), restore: async () => {
      await storage.deleteDismissal(projectId, finding.fingerprint);
      refreshDismissals();
    } });
  }
  function showIssue(issue: LocatedIssue) {
    // The offset belongs to the projection that produced it, so switch there before jumping.
    changeMode(issue.view === 'ai' ? 'ai' : 'template');
    setFocusLine(issue.line);
    if (issue.kind !== 'leak') setFocusName(issue.name);
  }
  function changeMode(next: Mode) { setMode(next); setShowSecrets(false); setFocusName(''); setFocusLine(undefined); }
  /** The private value a leak issue is about, when it is one the app can actually put right: the
   * binding has to resolve here, and its value has to still be in the template. A value that reaches
   * the AI output some other way — through another binding's AI value, say — is not fixed by
   * rewriting the template, so nothing is offered for it. */
  function leakedValue(issue: LocatedIssue): string | undefined {
    if (issue.kind !== 'leak') return undefined;
    const binding = resolveBinding(issue.name, bindings, options.projectId, options.versionId);
    const value = binding && resolveValue(binding, options.profileId);
    return value && template.includes(value) ? value : undefined;
  }
  /** The leak check has known which binding owns the value since it was written; it used that only
   * to refuse the copy. Here it offers the swap instead — a choice, not automatic matching. */
  function replaceLeak(issue: LocatedIssue) {
    const value = leakedValue(issue);
    if (!value) return;
    const before = template;
    // Placeholders are stepped over, so a value that happens to read like part of one is safe.
    const parts = template.split(/(\{\{[A-Z][A-Z0-9_]*\}\})/g);
    let count = 0;
    for (let i = 0; i < parts.length; i += 2) {
      count += parts[i].split(value).length - 1;
      parts[i] = parts[i].split(value).join(`{{${issue.name}}}`);
    }
    controller.changeText(parts.join(''));
    setNotice(t.issues.replaced(issue.name, count));
    offerUndo({ label: t.issues.replaceUndo(issue.name), restore: async () => { controller.changeText(before); await controller.flush(); } });
  }
  function createBinding(selection: Selection, finding?: Finding) {
    // Report U7. Ctrl+B in the Local view used to do nothing at all, with nothing said.
    if (mode === 'local') { warn(t.refusal.bindingInLocal); return; }
    if (!selection.text) { warn(t.refusal.bindingNoSelection); return; }
    if (/\{\{.*\}\}/.test(selection.text)) { warn(t.refusal.bindingOnPlaceholder); return; }
    void run(async () => {
      await controller.flush();
      const current = controller.getSnapshot();
      if (!current.session.project || !current.settings) return;
      // A selection cut short by a word boundary leaves part of the value in the template, and
      // everything after that looks like it worked. Widen it before anything else uses it.
      if (mode !== 'ai') {
        const widened = expandToLiteral(current.session.text, selection.start, selection.end, current.session.language);
        if (widened.widened) selection = { ...selection, start: widened.start, end: widened.end, text: widened.text };
      }
      const scope = { scope: 'project' as const, scopeRef: current.session.project.id };
      const hint = suggestBinding(selection.lineBefore, selection.text, bindings, scope), time = new Date().toISOString();
      // The name heuristic reads only the variable name, so `$p = "Hunter2"` came out as identity
      // and a password rendered unmasked. Running the rules over the value itself is the missing
      // half: what a value looks like says more than what it was called.
      //
      // Over the whole line, though, and not the selection alone. Several rules are about the
      // assignment rather than the value — `password = "…"` is what makes `Hunter2!` a secret, and
      // `Hunter2!` on its own is just a word with a digit in it. Only findings that cover the
      // selection count, so the variable on the same line cannot categorise it by accident.
      const source = current.session.text;
      const lineStart = source.lastIndexOf('\n', selection.start - 1) + 1;
      const lineEnd = source.indexOf('\n', selection.end);
      const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      const onLine = scan(line, rules, { skipRanges: [] })
        // Only a finding that covers the selection counts, so a value elsewhere on the line cannot
        // categorise this one. The assignment rule reports its captured value, not the whole line.
        .filter(f => f.start + lineStart <= selection.start && f.end + lineStart >= selection.end);
      const matched = finding ?? onLine
        .sort((a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0))[0];
      const category = matched?.category ?? hint.category;
      const aiValue = matched?.suggestedAiReplacement ?? defaults[category];
      const binding: Binding = { id: crypto.randomUUID(), name: hint.name, category, ...scope,
        description: '', aiReplacement: mode === 'ai' ? selection.text : aiValue, values: mode === 'ai' ? {} : { __default__: selection.text },
        escapeMode: 'auto', matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] }, createdAt: time, updatedAt: time, deviceId: current.settings.deviceId };
      if (mode === 'ai') {
        const start = template.indexOf(selection.text);
        if (start < 0 || template.indexOf(selection.text, start + 1) >= 0) throw new BindingRefusal(t.binding.selectInTemplate);
        selection = { ...selection, start, end: start + selection.text.length };
      }
      // A value already in the vault does not need a second binding. Project before global, the
      // order resolveBinding would resolve them in.
      const owner = [...bindings].sort((a, b) => (a.scope === 'global' ? 1 : 0) - (b.scope === 'global' ? 1 : 0))
        .find(b => resolveBinding(b.name, bindings, options.projectId, options.versionId)?.id === b.id
          && Object.values(b.values).includes(selection.text));
      setBindingDialog({ binding, selection, reuse: owner?.name });
    });
  }
  /** Neither editor gives us a paste event we can trust, so a large jump in one change is what a
   * paste looks like from here. A guess from the first character is worthless, and after that the
   * file is no longer empty. */
  const pasted = (next: string) => next.length - template.length >= 20;
  /** Never overrides a language the user picked, and stays quiet unless the guess is unambiguous —
   * the language decides how values are escaped. */
  function noteLanguage(text: string) {
    if (languageChosen.current.has(session.activeFileId)) return;
    const guess = detectLanguage(text);
    if (guess && guess !== language) {
      controller.changeLanguage(guess);
      setNotice(t.workspace.languageSet(guess));
    }
  }
  /** The blocklist runs on text that arrives whole — a paste or a dropped file — and never while
   * typing: half a term is not the term, and rewriting the line under the cursor mid-word is help
   * nobody asked for.
   *
   * The bindings it creates are global. A term on the blocklist is a decision about the whole vault,
   * not about one project, and making them global is also what lets the same term be recognised
   * again in the next project rather than collecting a binding per project.
   *
   * The pasted text is already in the tab before this runs, so a failure here leaves the user's text
   * where they put it and says so — it never swallows the paste. */
  async function screenForBlocklist(text: string) {
    const scope = { scope: 'global' as const, scopeRef: null };
    const result = applyBlocklist(text, blocklist, bindings, scope);
    if (!result.replacements) return;
    try {
      const current = controller.getSnapshot();
      if (!current.settings) return;
      const time = new Date().toISOString();
      for (const match of result.matches.filter(m => !m.existing)) {
        // Categorised from the value itself, the same way a binding made by hand is.
        const found = scan(match.matched, rules, { skipRanges: [] })[0];
        const category = found?.category ?? 'configuration';
        await storage.saveBinding({ id: crypto.randomUUID(), name: match.name, category, ...scope,
          description: t.blocklist.fromTerm(match.entry.term),
          aiReplacement: match.entry.replacement || found?.suggestedAiReplacement || defaults[category],
          values: { __default__: match.matched }, escapeMode: 'auto',
          matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] },
          createdAt: time, updatedAt: time, deviceId: current.settings.deviceId });
      }
      setBindings(await storage.listBindings());
      // Typing may have carried on while the bindings were being written. Replacing the text then
      // would take those keystrokes with it, so the substitution is dropped instead.
      if (controller.getSnapshot().session.text !== text) return;
      controller.changeText(result.text);
      setNotice(t.blocklist.replaced(result.replacements, result.matches.length));
      offerUndo({ label: t.blocklist.undoLabel(result.replacements), restore: async () => {
        controller.changeText(text); await controller.flush();
      } });
    } catch {
      warn(t.blocklist.failed);
    }
  }
  async function openFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    await run(async () => {
      const text = await file.text();
      const guess = languageForFile(file.name) ?? detectLanguage(text);
      if (template.trim()) await controller.addFile(guess ?? language);
      else if (guess && guess !== language) controller.changeLanguage(guess);
      controller.changeText(text);
      const fileId = controller.getSnapshot().session.activeFileId;
      if (languageForFile(file.name)) languageChosen.current.add(fileId);
      // Renaming goes through the same edit path as the text, so it works before the project
      // exists too; the first save writes both. The name is what a drop carries that typing does not.
      await controller.renameFile(fileId, file.name);
      setNotice(t.workspace.fileRead(file.name));
      await screenForBlocklist(text);
    });
  }
  /** No selection, so nothing is replaced in the template: the placeholder is typed by hand or
   * picked from the editor's completion. Useful for preparing a value before the code exists.
   *
   * Without an open project the new binding is global, which is the case the bindings page exists
   * for — a value shared across projects has nowhere else to be created. */
  function newBinding() {
    const current = controller.getSnapshot();
    if (!current.settings) { warn(t.refusal.settingsNotReady); return; }
    const time = new Date().toISOString();
    const project = current.session.project;
    setBindingDialog({ binding: { id: crypto.randomUUID(), name: '', category: 'secret',
      scope: project ? 'project' : 'global', scopeRef: project ? project.id : null,
      description: '', aiReplacement: defaults.secret, values: {},
      escapeMode: 'auto', matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] },
      createdAt: time, updatedAt: time, deviceId: current.settings.deviceId } });
  }
  async function storeBinding(binding: Binding, all: boolean) {
    const selection = bindingDialog?.selection;
    const previous = bindings.find(b => b.id === binding.id);
    // The guard belongs before the writes, not after them. It used to run once the binding was
    // already saved, so a template that had moved under the open dialog left a binding behind that
    // replaced nothing — and the dialog reported the generic save failure rather than saying so.
    const source = controller.getSnapshot().session.text;
    if (selection && source.slice(selection.start, selection.end) !== selection.text) throw new BindingRefusal(t.binding.templateChanged);
    // A rename has to rewrite every template that uses the placeholder, in one transaction, or the
    // templates end up pointing at a name that no longer resolves.
    if (previous && previous.name !== binding.name) {
      const { occurrences } = await storage.renameBinding(binding.id, binding.name);
      await controller.reloadTemplates();
      if (occurrences) setNotice(t.binding.renamed(previous.name, binding.name, occurrences));
    }
    await storage.saveBinding({ ...binding, updatedAt: new Date().toISOString() }); setBindings(await storage.listBindings());
    if (selection) {
      const token = `{{${binding.name}}}`;
      const text = all ? source.split(/(\{\{[A-Z][A-Z0-9_]*\}\})/g).map((part, index) => index % 2 ? part : part.split(selection.text).join(token)).join('')
        : source.slice(0, selection.start) + token + source.slice(selection.end);
      controller.changeText(text); changeMode('template'); setFocusName(binding.name); await controller.flush();
    }
  }
  async function removeBinding(binding: Binding) {
    await run(async () => {
      await controller.flush();
      // Version.bindingUsage is computed and stored on every save, so counting no longer needs to
      // read the entire vault back out.
      const versions = project ? await storage.listVersions(project.id) : [];
      const locations = versions.filter(v => v.bindingUsage.some(u => u.bindingName === binding.name));
      const value = resolveValue(binding, options.profileId);
      const here = template.split(`{{${binding.name}}}`).length - 1;
      const answer = await confirm({ title: t.binding.deleteTitle(binding.name), danger: true, confirmLabel: t.binding.deleteConfirm,
        body: <><p>Bindingen används i {locations.length} sparade versioner av det här projektet{here ? `, och ${here} gånger i den öppna filen` : ''}.</p>
          <p>{value ? t.binding.valueGone : t.binding.noValue} {t.binding.placeholdersKept}</p></>,
        // Deleting used to leave {{NAME}} behind with nothing to resolve it, which blocks copying
        // until the user tracks down every one by hand.
        option: value && here ? { label: `Skriv tillbaka det privata värdet på ${here === 1 ? 'platsen' : `de ${here} platserna`} i den här filen`, defaultChecked: true } : undefined });
      if (!answer) return;
      if (answer.optionChecked && value) controller.changeText(template.split(`{{${binding.name}}}`).join(value));
      const before = template;
      await storage.deleteBinding(binding.id); setBindings(await storage.listBindings());
      await controller.flush();
      offerUndo({ label: t.binding.deleted(binding.name), restore: async () => {
        await storage.importAll({ bindings: [binding] }, 'merge');
        setBindings(await storage.listBindings());
        // The value was written back into the template as part of the same action, so undoing one
        // without the other would leave the file and the vault disagreeing.
        if (answer.optionChecked && value) controller.changeText(before);
        await controller.flush();
      } });
    });
  }
  async function applyVersion(version: Version, save = false) {
    if (!await confirm({ title: `Använd v${version.number}?`, confirmLabel: t.version.replaceDraft,
      body: <><p>{t.version.replaceDraftBody(version.number)}</p><p>{t.version.replaceDraftKept}</p></> })) return;
    await run(async () => { await controller.applyVersion(version); if (save) await controller.saveVersion(t.version.restoredTo(version.number)); changeMode('template'); });
  }
  /** Editor preferences live in settings, not in component state: they should survive a reload and
   * a project switch, which is the whole point of changing them. */
  /** Returns the write so a caller that wants to say "saved" can wait for it to be true. */
  async function changeEditor(patch: Partial<Settings>) {
    if (!settings) return;
    try { await storage.saveSettings({ ...settings, ...patch }); await controller.reloadSettings(); }
    catch { warn(t.refusal.settingNotSaved); throw new Error('save failed'); }
  }
  /** Only the AI copy gets the instruction block, and only when something was actually substituted:
   * the text says private values have been replaced with placeholders, so putting it above code
   * that has none states something untrue in the copied artifact. The local copy goes into an
   * editor and gets nothing. */
  function withPrompt(text: string, which: 'local' | 'ai', replaced: number) {
    if (which !== 'ai' || !replaced || !settings?.includeAiPromptBlock || !settings.aiPromptText.trim()) return text;
    const block = promptBlock(settings.aiPromptText, language);
    return block ? `${block}\n\n${text}` : text;
  }
  /** Saving to a file goes through the same gate as the clipboard: a file is just as easy to hand
   * to an AI, so it must not be a way around the audit. */
  function downloadCopy(which: 'local' | 'ai') {
    const result = auditForCopy(template, bindings, { ...options, mode: which });
    if (!result.canCopy) { warn(t.refusal.downloadBlocked); return; }
    const name = session.files.find(f => f.id === session.activeFileId)?.name ?? 'kod.txt';
    download(`${which}-${name}`, withPrompt(result.text, which, result.used.length), 'text/plain');
    setCopyMode(null);
    setNotice(which === 'local' ? t.copy.downloadedLocal : t.copy.downloaded);
  }
  async function writeClipboard(text: string, which: 'local' | 'ai', message?: string) {
    try {
      await navigator.clipboard.writeText(text); setCopyMode(null);
      setNotice(message ?? (which === 'local' ? t.copy.copiedLocal : t.copy.copiedAi));
      // Only the local copy carries real values, so only it gets the banner and the clearing. With
      // auto-clear off the banner still says what is on the clipboard, with a button to clear it.
      if (which === 'local') { const seconds = settings?.clipboardAutoClearSeconds ?? 0; setHold({ text, seconds: seconds > 0 ? seconds : null, pending: false }); }
    }
    catch { warn(t.refusal.clipboardDenied); }
  }
  /** A failed clear is not a notice that scrolls away: the banner turns red and stays until the
   * clipboard is actually clean, retrying whenever the tab gets focus back. */
  async function clearHold(current: ClipboardHold) {
    const outcome = await clearClipboard(current.text);
    if (outcome === 'failed') { setHold({ ...current, seconds: null, pending: true }); return; }
    setHold(null);
    setNotice(outcome === 'cleared' ? t.copy.clipboardCleared : t.copy.clipboardReplaced);
  }
  useEffect(() => {
    if (!hold || hold.pending || hold.seconds === null) return;
    if (hold.seconds > 0) { const id = setTimeout(() => setHold(h => h && h.seconds !== null ? { ...h, seconds: h.seconds - 1 } : h), 1000); return () => clearTimeout(id); }
    void clearHold(hold);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearHold reads nothing but the hold it is given.
  }, [hold]);
  useEffect(() => {
    if (!hold?.pending) return;
    const retry = () => { if (document.visibilityState === 'visible') void clearHold(hold); };
    window.addEventListener('focus', retry); document.addEventListener('visibilitychange', retry);
    return () => { window.removeEventListener('focus', retry); document.removeEventListener('visibilitychange', retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearHold reads nothing but the hold it is given.
  }, [hold]);
  /** The dialog is for the cases that need a decision: something in the file looks like a secret,
   * or nothing is protected while the code has strings that could be. Everything else copies on
   * one press and says how many values were replaced. The scan runs here, synchronously, on the
   * text being copied — the panel's idle-scheduled list may be 400 ms behind. */
  function aiNeedsReview(result: CopyAudit) {
    const serious = scan(template, rules).filter(f => !dismissed.has(f.fingerprint) && (f.severity === 'critical' || f.severity === 'high')).length;
    return serious > 0 || (result.coverage.bound === 0 && result.coverage.literals > 0);
  }
  async function copy(which: 'local' | 'ai') {
    if (!workspaceVisible) { warn(t.refusal.noFile); return; }
    if (!template.trim()) { warn(t.refusal.emptyFile); return; }
    if (busyRef.current) { warn(t.refusal.busy); return; }
    // Re-audited here rather than reusing the memoised value: the gate must have run on the text
    // being copied, not on whatever it last saw.
    const result = auditForCopy(template, bindings, { ...options, mode: which });
    if (!result.canCopy) { warn(t.refusal.copyBlocked); return; }
    if (which === 'ai') {
      if (aiNeedsReview(result)) { setReviewed(false); setCopyMode('ai'); return; }
      await writeClipboard(withPrompt(result.text, 'ai', result.used.length), 'ai', t.exits.copiedAi(result.used.length));
      return;
    }
    // Invariant 9. The first press arms the button and shows what is about to leave; only the
    // second press, inside the window, writes real values to the clipboard.
    if (result.secretRanges.length && !armed) { setArmed(true); return; }
    setArmed(false);
    await writeClipboard(withPrompt(result.text, 'local', result.used.length), 'local');
  }
  /** The file goes through the same review as the clipboard, so when the review is needed the
   * dialog opens and holds the download behind its checkbox. */
  function downloadAi() {
    if (!workspaceVisible || !template.trim()) { warn(t.refusal.emptyFile); return; }
    const result = auditForCopy(template, bindings, { ...options, mode: 'ai' });
    if (!result.canCopy) { warn(t.refusal.downloadBlocked); return; }
    if (aiNeedsReview(result)) { setReviewed(false); setCopyMode('ai'); return; }
    downloadCopy('ai');
  }
  /** Report U19. Asking an AI about one function should not mean handing over the whole file. The
   * selection is audited on its own, so a missing binding elsewhere does not block it, but the
   * exact-value check still runs on precisely what goes to the clipboard. */
  async function copySelection() {
    if (!selected || busyRef.current) return;
    const result = auditSelection(template, bindings, { ...options, mode: 'ai' }, selected);
    if (!result.canCopy) { warn(t.refusal.selectionBlocked(result.blocking[0].message)); return; }
    try {
      await navigator.clipboard.writeText(withPrompt(result.text, 'ai', result.used.length));
      setNotice(t.copy.selectionCopied(result.used.length));
    }
    catch { warn(t.refusal.clipboardDenied); }
  }
  /** Recorded as seen when it is shown, not when it is closed. It has been seen either way, and
   * writing on close races a reload made moments afterwards — the introduction would come back for
   * someone who had just dismissed it. */
  useEffect(() => {
    if (!settings || settings.introSeen) return;
    setIntro(true);
    void storage.saveSettings({ ...settings, introSeen: true }).then(() => controller.reloadSettings()).catch(() => {});
  }, [settings, storage, controller]);
  function openDrawer() { setDrawer(true); void controller.refreshProjects().catch(() => setError(t.refusal.projectListFailed)); }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      // Report A.1. Monaco 0.56 takes input through an EditContext on a plain <div>, not a
      // textarea, so a tag-name test reported "not typing" inside the code editor: `?` opened the
      // shortcut modal and never reached the code, where it is ordinary PowerShell and regex.
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = Boolean(target && (/^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable
        || target.closest('.monaco-editor, .plain-editor, [role="textbox"]')));
      if (match(e, 'help') && !typing) { e.preventDefault(); setShowShortcuts(true); return; }
      if (match(e, 'projects')) { e.preventDefault(); openDrawer(); }
      if (match(e, 'copyAi')) { e.preventDefault(); void copy('ai'); }
      if (match(e, 'copyLocal')) { e.preventDefault(); void copy('local'); }
      if (match(e, 'save')) { e.preventDefault(); if (project && template.trim()) setLabelling(true); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  return <div className="app-shell code-first"><a className="skip-link" href="#huvudinnehall">{t.nav.skip}</a><div className="main-shell">
    <header className="topbar"><a className="brand" href="#/" onClick={e => { e.preventDefault(); void navigate('#/'); }}><span className="brand-icon">{'</>'}</span><span>AI Code Vault</span></a>
      <nav className="top-navigation" aria-label={t.nav.main}>
        <button className={workspaceVisible ? 'active' : ''} disabled={busy} onClick={() => void navigate('#/')}>{t.nav.newCode}</button>
        <button disabled={busy} onClick={openDrawer}>{t.nav.projects} <kbd>Ctrl P</kbd></button>
        <button className={route === '#/bindings' ? 'active' : ''} disabled={busy} onClick={() => void navigate('#/bindings')}>{t.nav.bindings}</button>
        <button className={route === '#/backup' ? 'active' : ''} disabled={busy} onClick={() => void navigate('#/backup')}>{t.nav.backup}</button>
        <button className={route === '#/settings' ? 'active' : ''} onClick={() => void navigate('#/settings')}>{t.nav.settings}</button>
        <button className={route === '#/security' ? 'active' : ''} onClick={() => void navigate('#/security')}>{t.nav.security}</button>
      </nav>
      <div className="topbar-right">
        <ProfilePicker profiles={profiles} activeId={settings?.activeProfileId ?? null} onManage={() => setManagingProfiles(true)}
          onSelect={id => void run(async () => { if (settings) { await storage.saveSettings({ ...settings, activeProfileId: id }); await controller.reloadSettings(); } })} />
        <label className="theme-choice">{t.app.theme}<select aria-label={t.app.theme} value={theme} onChange={e => changeTheme(e.target.value as ThemeChoice)}><option value="system">{t.app.themeSystem}</option><option value="light">{t.app.themeLight}</option><option value="dark">{t.app.themeDark}</option></select></label>
        <button className="icon-button" onClick={() => setShowShortcuts(true)} aria-label={t.nav.showShortcuts} title={t.nav.shortcuts}>?</button>
        <span className={`save-state ${phase === 'error' ? 'danger-text' : ''}`} role="status">{saveStatus}</span>
      </div></header>
    {state.error && <div className="persistence-error" role="alert"><strong>Fel vid sparning</strong><p>{state.error}</p><button onClick={() => { void controller.flush(true).catch(() => {}); }}>{t.dialog.retrySave}</button></div>}
    {hold && <ClipboardBanner hold={hold} onClear={() => void clearHold(hold)} onKeep={() => { setHold(null); setNotice(t.copy.clipboardKept); }} />}
    {updateReady &&<div className="notice">{t.app.updateAvailable} <button onClick={() => void run(async () => { await controller.flush(); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); updateReady.waiting?.postMessage({ type: 'ACTIVATE' }); })}>Ladda om</button></div>}
    {/* Report U9. inert on the whole main froze the page during every write, including the parts a
        write cannot corrupt: reading a document, a filter, the version list. It is now on the
        editing surface alone, and the busy state is visible in the header. Anything the rest can
        start still goes through run(), which refuses politely while a write is in flight. */}
    <main id="huvudinnehall" aria-busy={busy}>
      <div className="workspace" hidden={!workspaceVisible} inert={busy}><section className="project-heading"><div className="project-identity"><span className="eyebrow">{project ? 'LOKALT ARBETSUTKAST' : t.app.startNow}</span>
        {project ? <ProjectName key={session.key} name={session.name} change={name => controller.rename(name)} /> : <h1>Klistra in din kod</h1>}
        <div className="file-info"><label>{t.workspace.language} <select aria-label={t.workspace.language} value={language} onChange={e => { languageChosen.current.add(session.activeFileId); controller.changeLanguage(e.target.value as LanguageId); }}>{languages.map(l => <option key={l}>{l}</option>)}</select></label><span>{project ? t.workspace.files(session.files.length) : t.workspace.newProjectHint}{session.baseVersionId && t.workspace.basedOn(String(versions.find(v => v.id === session.baseVersionId)?.number ?? '?'))}</span></div>
      </div><div className="heading-actions">{!project && currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>{t.workspace.backToCurrent}</button>}{project && <button className="text-button" disabled={busy} onClick={() => setDetails(true)}>Om projektet</button>}{project && <button className="text-button danger-text" disabled={busy} onClick={() => void removeProject(project.id, session.name)}>Radera projekt</button>}<button disabled={busy || !template.trim()} onClick={() => setLabelling(true)}>Spara version</button></div></section>
        <div className="work-grid" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false); }}
          onDrop={e => { e.preventDefault(); setDropping(false); void openFiles(e.dataTransfer.files); }}>
          {dropping && <div className="drop-hint" aria-hidden="true">{t.workspace.dropHint}</div>}
          <aside className="version-column"><VersionPanel versions={versions} baseVersionId={session.baseVersionId} disabled={busy}
            onPreview={v => setViewing({ version: v, compareTo: null })}
            onCompare={v => setViewing({ version: v, compareTo: versions[versions.indexOf(v) + 1] ?? null })}
            onRestore={(v, asNew) => void applyVersion(v, asNew)}
            onDelete={v => void removeVersion(v)} /></aside>
          <section className={`editor-panel mode-${mode}`}>
          <FileTabs files={session.files} activeId={session.activeFileId} disabled={busy}
            onSelect={id => { controller.selectFile(id); changeMode('template'); }}
            onAdd={() => void run(async () => { await controller.addFile(); changeMode('template'); })}
            onRename={(id, name) => void controller.renameFile(id, name)}
            onRemove={id => void run(async () => {
              const file = session.files.find(f => f.id === id);
              if (!file) return;
              const hasText = (session.texts[id] ?? '').trim().length > 0;
              if (hasText && !await confirm({ title: t.project.removeFileTitle(file.name), danger: true, confirmLabel: t.project.removeFileConfirm,
                body: <><p>{t.project.removeFileBody}</p><p>{t.project.removeFileKept}</p></> })) return;
              await controller.removeFile(id);
            })} />
          <EditorToolbar mode={mode} onMode={changeMode} canIngest={Boolean(project)} onIngest={() => setIngesting(true)}
            canCopySelection={mode === 'template' && Boolean(selected)} onCopySelection={() => void copySelection()} />
          <Exits hasText={Boolean(template.trim())} aiIssues={ai.issues} localIssues={local.issues} blockedCount={issues.length}
            seriousFindings={findings.filter(f => f.severity === 'critical' || f.severity === 'high').length} armed={armed} checklist={localChecklist}
            onCopyAi={() => void copy('ai')} onDownloadAi={downloadAi} onCopyLocal={() => void copy('local')}
            onDetails={() => { setArmed(false); setReviewed(false); setCopyMode('local'); }} />
          {/* Report F-2.1. The AI banner claimed "SANERAD" unconditionally, in the strongest green
              in the editor, directly above unreplaced secrets whenever nothing was bound. */}
          <div className={`view-banner ${mode === 'ai' && !ai.used.length ? 'nothing-replaced' : ''}`} key={mode}><strong>{mode === 'template' ? t.workspace.bannerTemplate : mode === 'local' ? t.workspace.bannerLocal : ai.used.length ? t.workspace.bannerAi(ai.used.length) : t.workspace.bannerAiNothing}</strong><span>{mode === 'template' ? t.workspace.editableSource : t.workspace.readOnlyProjection}</span></div>
          {mode === 'local' && <div className="local-tools"><button onClick={() => { setMode('template'); setFocusLine(currentLine.current); }}>{t.workspace.editAsTemplate}</button><button onClick={() => setShowSecrets(!showSecrets)}>{showSecrets ? t.workspace.hideValues : t.workspace.showValues}</button></div>}
          <div className="editor-body" id="kodvy" role="tabpanel" aria-labelledby={`vy-${mode}`}>{!template && mode === 'template' && <div className="paste-prompt"><strong>{t.workspace.pasteHere}</strong><span>{t.workspace.pasteHereHint}</span>{samples[language] && <button className="text-button" onClick={() => controller.changeText(samples[language]!)}>{t.workspace.trySample}</button>}</div>}
            <Editor key="primary-editor" documentKey={`${session.key}:${session.activeFileId}:${mode}`} active={workspaceVisible} autoFocus value={visible} language={language} readOnly={busy || mode !== 'template'} onChange={text => { if (pasted(text)) { noteLanguage(text); void screenForBlocklist(text); } controller.changeText(text); }} onBinding={createBinding}
              onPlaceholder={name => { setFocusName(name); const b = resolveBinding(name, bindings, options.projectId, options.versionId); if (b) setBindingDialog({ binding: b }); }} describePlaceholder={name => { const b = resolveBinding(name, bindings, options.projectId, options.versionId); return b && { category: b.category, aiReplacement: b.aiReplacement, hasValue: Boolean(resolveValue(b, options.profileId)) }; }} theme={resolvedTheme} placeholderNames={activeBindings.map(b => b.name)} substitutions={mode === 'template' ? noSubstitutions : mode === 'ai' ? ai.substitutions : local.substitutions} focusName={focusName} focusLine={focusLine} onLine={line => { currentLine.current = line; }}
              fontSize={fontSize} wordWrap={wrap} onSelectionChange={setSelected} onFocused={() => setFocusName('')} />
          </div><div className="editor-footer"><span>{t.workspace.lines(visible.split('\n').length)} · {t.workspace.bindingCount(used.length)}</span>
            <div className="editor-tools" role="group" aria-label={t.workspace.editorSettings}>
              <button aria-label={t.workspace.smallerText} title={t.workspace.smallerText} disabled={fontSize <= 10} onClick={() => void changeEditor({ editorFontSize: fontSize - 1 }).catch(() => {})}>A−</button>
              <span aria-live="polite">{fontSize} px</span>
              <button aria-label={t.workspace.largerText} title={t.workspace.largerText} disabled={fontSize >= 24} onClick={() => void changeEditor({ editorFontSize: fontSize + 1 }).catch(() => {})}>A+</button>
              <button aria-pressed={wrap} onClick={() => void changeEditor({ editorWordWrap: !wrap }).catch(() => {})}>{t.workspace.wordWrap(wrap)}</button>
            </div>
            <span>{mode === 'local' ? t.workspace.localFooter : t.workspace.draftFooter}</span></div>
        </section><aside className="binding-panel">
          <IssuePanel issues={issues} onSelect={showIssue} fix={{ offered: issue => Boolean(leakedValue(issue)), apply: replaceLeak }} />
          <details className="side-section" open>
            <summary><h2>{t.bindingPanel.title}</h2><span className="count">{activeBindings.length}</span></summary>
            <BindingPanel rows={toRows(activeBindings, used, options.profileId)} canCreate={Boolean(project)}
              onFocus={b => { setMode('template'); setFocusName(b.name); }}
              onEdit={b => setBindingDialog({ binding: b })}
              onDelete={b => void removeBinding(b)}
              onCreate={() => void newBinding()} />
          </details>
          <FindingsPanel findings={findings} onShow={f => { changeMode('template'); setFocusLine(f.line); }}
            onBind={bindFinding} onBindMany={f => void bindFindings(f)} onDismiss={f => void dismissFinding(f)} />
        </aside></div>
      </div>
      <div className="overview-scroll" ref={overview} hidden={route !== '#/projects'} onScroll={e => { if (route === '#/projects') overviewScroll.current = e.currentTarget.scrollTop; }}><section className="dashboard">
        <div className="dashboard-heading"><div><span className="eyebrow">{t.project.vaultEyebrow}</span><h1>{t.project.allProjects}</h1><p>{t.project.listLead}</p></div><div className="heading-actions">{currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>{t.workspace.backToCurrent}</button>}<button className="primary" onClick={() => void navigate('#/')}>{t.nav.newCode}</button></div></div>
        <ProjectFilters query={query} onQuery={setQuery} sort={sort} onSort={setSort} language={languageFilter} onLanguage={setLanguageFilter} status={statusFilter} onStatus={setStatusFilter} count={filtered.length} />
        <div className="project-cards">{filtered.map(p => <ProjectCard key={p.id} project={p} facts={facts[p.id]} current={p.id === currentId} open={() => void navigate(`#/project/${p.id}`)} />)}</div>
        {!filtered.length && <p className="empty-project-list">{projects.length ? t.project.noMatch : t.project.empty}</p>}
      </section></div>
      <div className="overview-scroll" hidden={route !== '#/bindings'}><BindingsPage bindings={bindings} uses={bindingUses} profileId={options.profileId}
        onEdit={b => setBindingDialog({ binding: b })} onDelete={b => void removeBinding(b)} onCreate={newBinding} /></div>
      {/* Its own page rather than the last section of a long settings page. It is the only way back
          after a browser clears its storage, and it was three scroll-lengths below the fold. */}
      <div className="overview-scroll" hidden={route !== '#/backup'}><BackupPanel storage={storage} notify={setNotice} confirm={confirm}
        lastExportAt={settings?.lastExportAt} onExported={() => void controller.reloadSettings()} /></div>
      <div hidden={route !== '#/security'}><Security /></div>
      <div hidden={route !== '#/settings'}><SettingsPage settings={settings} storage={storage} storageInfo={storageInfo}
        onStorageInfo={setStorageInfo} deviceName={deviceName} onDeviceName={setDeviceName} rules={rules}
        onRules={() => void storage.listScannerRules().then(setRules)} save={patch => changeEditor(patch)} notify={setNotice}
        blocklist={blocklist} onBlocklist={() => void storage.listBlocklist().then(setBlocklist)}
        showIntro={() => setIntro(true)} /></div>
    </main><footer className="app-footer"><span>AI Code Vault · {__APP_VERSION__}</span><span>{t.app.footerNote}</span></footer>
  </div>
    {drawer && <ProjectBrowser projects={projects} currentId={currentId} query={drawerQuery} onQuery={setDrawerQuery} close={() => setDrawer(false)} open={id => void navigate(`#/project/${id}`)} overview={() => void navigate('#/projects')} />}
    {bindingDialog && <BindingDialog initial={bindingDialog.binding} bindings={bindings} profiles={profiles}
      // The other occurrences, not all of them: counting the selected one made a value that appears
      // exactly once offer to "replace all identical occurrences (1)".
      count={bindingDialog.selection ? template.split(bindingDialog.selection.text).length - 2 : 0}
      preview={bindingDialog.selection && (() => {
        const s = bindingDialog.selection!;
        const lineStart = template.lastIndexOf('\n', s.start - 1) + 1;
        const lineEnd = template.indexOf('\n', s.end) === -1 ? template.length : template.indexOf('\n', s.end);
        return { line: template.slice(lineStart, lineEnd), start: s.start - lineStart, end: s.end - lineStart };
      })() || undefined}
      reuse={bindingDialog.reuse && bindingDialog.selection ? { name: bindingDialog.reuse, use: () => {
        const s = bindingDialog.selection!;
        controller.changeText(template.slice(0, s.start) + `{{${bindingDialog.reuse!}}}` + template.slice(s.end));
        changeMode('template'); setFocusName(bindingDialog.reuse!);
      } } : undefined}
      save={storeBinding} close={() => setBindingDialog(null)} />}
    {copyMode && <CopyDialog mode={copyMode} coverage={cover} issues={ai.issues.length} replaced={ai.used.length}
      findings={copyFindings} seriousFindings={seriousFindings} reviewed={reviewed} onReviewed={setReviewed}
      profile={profiles.find(p => p.id === options.profileId)?.name}
      close={() => setCopyMode(null)} onDownload={() => downloadCopy(copyMode)}
      onCopy={() => {
        // Re-audited on the current text: the dialog must not be able to copy what it last saw.
        const result = auditForCopy(template, bindings, { ...options, mode: copyMode });
        if (result.canCopy) void writeClipboard(withPrompt(result.text, copyMode, result.used.length), copyMode);
      }} />}
    {viewing && <VersionViewer version={viewing.version} compareTo={viewing.compareTo} activeFileId={session.activeFileId}
      currentFiles={session.files} language={language} theme={resolvedTheme} close={() => setViewing(null)}
      restore={() => { const v = viewing.version; setViewing(null); void applyVersion(v); }} />}
    {details && project && <ProjectDetails project={project} close={() => setDetails(false)} save={async patch => {
      await storage.saveProject({ ...project, ...patch, updatedAt: new Date().toISOString() });
      await controller.reloadProject();
      setNotice(t.project.detailsSaved);
    }} />}
    {showShortcuts && <Modal title={t.app.shortcutsTitle} close={() => setShowShortcuts(false)}>
      <table className="shortcut-table"><tbody>{shortcuts.map(s => <tr key={s.id}><th scope="row">{s.label}</th><td>{s.keys.map(k => <kbd key={k}>{k}</kbd>)}{s.note && <small>{s.note}</small>}</td></tr>)}</tbody></table>
      <h3>{t.app.inTheEditor}</h3>
      <table className="shortcut-table"><tbody>{editorShortcuts.map(s => <tr key={s.label}><th scope="row">{s.label}</th><td>{s.keys.map(k => <kbd key={k}>{k}</kbd>)}{s.note && <small>{s.note}</small>}</td></tr>)}</tbody></table>
      <div className="dialog-actions"><button className="primary" onClick={() => setShowShortcuts(false)}>{t.dialog.close}</button></div>
    </Modal>}
    {ingesting && <IngestDialog bindings={bindings} template={template} close={() => setIngesting(false)} apply={next => {
      controller.changeText(next); setIngesting(false); changeMode('template');
      setNotice(t.version.templateReplaced);
    }} />}
    {managingProfiles && <ProfileManager profiles={profiles} close={() => setManagingProfiles(false)}
      onCreate={async name => { const time = new Date().toISOString();
        await storage.saveProfile({ id: crypto.randomUUID(), name, description: '', createdAt: time, updatedAt: time });
        setProfiles(await storage.listProfiles()); }}
      onRename={async (id, name) => { const existing = profiles.find(p => p.id === id); if (!existing) return;
        await storage.saveProfile({ ...existing, name, updatedAt: new Date().toISOString() });
        setProfiles(await storage.listProfiles()); }}
      onDelete={async profile => {
        const withValues = bindings.filter(b => profile.id in b.values).length;
        if (!await confirm({ title: t.project.removeProfileTitle(profile.name), danger: true, confirmLabel: t.project.removeProfileConfirm,
          body: <><p>{withValues} bindings har ett eget värde för den här profilen. De värdena raderas.</p><p>{t.binding.defaultsUnaffected}</p></> })) return;
        await storage.deleteProfile(profile.id);
        setProfiles(await storage.listProfiles()); setBindings(await storage.listBindings()); await controller.reloadSettings();
      }} />}
    {labelling && <SaveVersionDialog next={Math.max(0, ...versions.map(v => v.number)) + 1} save={label => void saveVersion(label)} close={() => setLabelling(false)} />}
    {confirmDialog}
    {undoBar}
    {toasts}
    {intro && <Intro close={() => setIntro(false)} />}
    {error && <Modal title={t.dialog.attention} close={() => setError('')}><p role="alert">{error}</p><div className="dialog-actions"><button className="primary" onClick={() => setError('')}>{t.dialog.close}</button></div></Modal>}
  </div>;
}
