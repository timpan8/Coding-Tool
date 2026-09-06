import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Binding, LanguageId, Settings, Version } from '../types/models';
import { languages } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { resolveBinding, resolveValue, suggestBinding, defaults } from '../domain/bindings';
import { expandToLiteral } from '../domain/bindings/literal';
import { render, usage } from '../domain/render';
import { auditForCopy, auditSelection, promptBlock } from '../domain/render/audit';
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
import { ProjectDetails } from './components/ProjectDetails';
import { BindingPanel, toRows } from './components/BindingPanel';
import { BindingsPage, useBindingUses } from './components/BindingsPage';
import { SettingsPage } from './components/SettingsPage';
import { CopyDialog } from './components/CopyDialog';
import { EditorToolbar, type Mode } from './components/EditorToolbar';
import { ProfileManager, ProfilePicker } from './components/ProfilePicker';
import { IngestDialog } from './components/IngestDialog';
import { editorShortcuts, match, shortcuts } from './shortcuts';
import { t } from './text';
import { detectLanguage, languageForFile } from '../domain/detect';
// Also lazy: it pulls in the same editor bundle, and version history is not on the first screen.
const DiffEditor = lazy(() => import('./editor/DiffEditor').then(m => ({ default: m.DiffEditor })));
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
        <small>Valfritt, men gör historiken läsbar. Datum och antal ändrade rader visas ändå.</small>
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
  const [notice, setNoticeText] = useState(''), [noticeTone, setNoticeTone] = useState<'info' | 'warn'>('info');
  /** Report U6. Every failure used to be a full-screen modal titled "Åtgärden behöver
   * uppmärksamhet", including ones the user can simply try again. The modal is for something that
   * needs a decision; a refusal or a failed convenience belongs in the strip. */
  const setNotice = (text: string) => { setNoticeText(text); setNoticeTone('info'); };
  const warn = (text: string) => { setNoticeText(text); setNoticeTone('warn'); };

  const [bindingDialog, setBindingDialog] = useState<{ binding: Binding; selection?: Selection } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false), [focusName, setFocusName] = useState(''), [focusLine, setFocusLine] = useState<number>();
  const [viewing, setViewing] = useState<{ version: Version; compareTo: Version | null } | null>(null), [labelling, setLabelling] = useState(false), [details, setDetails] = useState(false);
  const [copyMode, setCopyMode] = useState<'local' | 'ai' | null>(null), [reviewed, setReviewed] = useState(false), [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const [deviceName, setDeviceName] = useState(''), currentLine = useRef(1);
  const [theme, setTheme] = useState<ThemeChoice>(paintHint()), [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [storageInfo, setStorageInfo] = useState<StorageState | null>(null), asked = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const [offerUndo, undoBar] = useUndo(setNotice);
  const [rules, setRules] = useState<ScannerRule[]>([]), [profiles, setProfiles] = useState<Profile[]>([]), [managingProfiles, setManagingProfiles] = useState(false);
  const [ingesting, setIngesting] = useState(false), [showShortcuts, setShowShortcuts] = useState(false), [dropping, setDropping] = useState(false);
  const [dismissed, refreshDismissals] = useDismissals(() => project ? storage.listDismissals(project.id) : Promise.resolve([]), project?.id ?? '');
  const findings = useScanner(mode === 'template' ? template : '', rules, dismissed);
  const [countdown, setCountdown] = useState<number | null>(null), pendingClear = useRef<string | null>(null);
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
      } else if (!['#/', '#/projects', '#/bindings', '#/settings', '#/security'].includes(hash)) throw new Error(t.refusal.unknownPage);
      setShowSecrets(false); setDrawer(false); setNotice('');
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
        body: <><p>{version.label ? `"${version.label}"` : 'Versionen'} tas bort ur historiken för alltid.</p><p>{t.version.deleteDraftUnaffected}</p></> })) return;
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
        body: <><p>{t.project.deleteLead}</p><ul><li>{versions.length} sparade versioner</li><li>{scoped.length} bindings som hör till projektet, med sina privata värden</li><li>{t.project.deleteDraft}</li></ul><p>{t.project.deleteGlobalsSafe}</p></> })) return;
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
  async function dismissFinding(finding: Finding) {
    const current = controller.getSnapshot();
    if (!current.session.project || !current.settings) return;
    await storage.saveDismissal({ projectId: current.session.project.id, fingerprint: finding.fingerprint,
      ruleId: finding.ruleId, reason: '', createdAt: new Date().toISOString(), deviceId: current.settings.deviceId });
    refreshDismissals();
    setNotice(`${finding.ruleName} avfärdad i det här projektet.`);
  }
  function showIssue(issue: LocatedIssue) {
    // The offset belongs to the projection that produced it, so switch there before jumping.
    changeMode(issue.view === 'ai' ? 'ai' : 'template');
    setFocusLine(issue.line);
    if (issue.kind !== 'leak') setFocusName(issue.name);
  }
  function changeMode(next: Mode) { setMode(next); setShowSecrets(false); setFocusName(''); setFocusLine(undefined); }
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
      const hint = suggestBinding(selection.lineBefore, selection.text), time = new Date().toISOString();
      // The name heuristic reads only the variable name, so `$p = "Hunter2"` came out as identity
      // and a password rendered unmasked. Running the rules over the value itself is the missing
      // half: what a value looks like says more than what it was called.
      const matched = finding ?? scan(selection.text, rules, { skipRanges: [] })
        .sort((a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0))[0];
      const category = matched?.category ?? hint.category;
      const aiValue = matched?.suggestedAiReplacement ?? defaults[category];
      const binding: Binding = { id: crypto.randomUUID(), name: hint.name, category, scope: 'project', scopeRef: current.session.project.id,
        description: '', aiReplacement: mode === 'ai' ? selection.text : aiValue, values: mode === 'ai' ? {} : { __default__: selection.text },
        escapeMode: 'auto', matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] }, createdAt: time, updatedAt: time, deviceId: current.settings.deviceId };
      if (mode === 'ai') {
        const start = template.indexOf(selection.text);
        if (start < 0 || template.indexOf(selection.text, start + 1) >= 0) throw new Error(t.binding.selectInTemplate);
        selection = { ...selection, start, end: start + selection.text.length };
      }
      setBindingDialog({ binding, selection });
    });
  }
  /** Fires on a paste, not on typing: a guess from the first character is worthless, and after
   * that the file is no longer empty. A large jump in one change is what a paste looks like from
   * here, and it works for both editors. Never overrides a language the user picked, and stays
   * quiet unless the guess is unambiguous — the language decides how values are escaped. */
  function noteLanguage(text: string) {
    if (languageChosen.current.has(session.activeFileId) || text.length - template.length < 20) return;
    const guess = detectLanguage(text);
    if (guess && guess !== language) {
      controller.changeLanguage(guess);
      setNotice(t.workspace.languageSet(guess));
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
    // A rename has to rewrite every template that uses the placeholder, in one transaction, or the
    // templates end up pointing at a name that no longer resolves.
    if (previous && previous.name !== binding.name) {
      const { occurrences } = await storage.renameBinding(binding.id, binding.name);
      await controller.reloadTemplates();
      if (occurrences) setNotice(t.binding.renamed(previous.name, binding.name, occurrences));
    }
    await storage.saveBinding({ ...binding, updatedAt: new Date().toISOString() }); setBindings(await storage.listBindings());
    if (selection) {
      const source = controller.getSnapshot().session.text;
      if (source.slice(selection.start, selection.end) !== selection.text) throw new Error(t.binding.templateChanged);
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
          <p>{value ? t.binding.valueGone : t.binding.noValue} Sparade versioner behåller sina platshållare.</p></>,
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
      body: <><p>Det nuvarande arbetsutkastet ersätts av innehållet i v{version.number}.</p><p>{t.version.replaceDraftKept}</p></> })) return;
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
  async function writeClipboard(text: string, which: 'local' | 'ai') {
    try {
      await navigator.clipboard.writeText(text); setCopyMode(null);
      setNotice(which === 'local' ? t.copy.copiedLocal : t.copy.copiedAi);
      const seconds = settings?.clipboardAutoClearSeconds ?? 0;
      // Only the local copy carries real values, so only it is worth clearing.
      if (which === 'local' && seconds > 0) { pendingClear.current = text; setCountdown(seconds); }
    }
    catch { warn(t.refusal.clipboardDenied); }
  }
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) { const id = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(id); }
    const text = pendingClear.current;
    pendingClear.current = null; setCountdown(null);
    if (text) void clearClipboard(text).then(outcome => setNotice(
      outcome === 'cleared' ? t.copy.clipboardCleared
        : outcome === 'replaced-by-other' ? t.copy.clipboardReplaced
          : t.copy.clipboardStuck));
  }, [countdown]);
  async function copy(which: 'local' | 'ai') {
    if (!workspaceVisible) { warn(t.refusal.noFile); return; }
    if (!template.trim()) { warn(t.refusal.emptyFile); return; }
    if (busyRef.current) { warn(t.refusal.busy); return; }
    // Re-audited here rather than reusing the memoised value: the gate must have run on the text
    // being copied, not on whatever it last saw.
    const result = auditForCopy(template, bindings, { ...options, mode: which });
    if (!result.canCopy) { warn(t.refusal.copyBlocked); return; }
    if (which === 'ai' || result.secretRanges.length) { setReviewed(false); setCopyMode(which); return; }
    await writeClipboard(withPrompt(result.text, which, result.used.length), which);
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
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
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
      <nav className="top-navigation" aria-label={t.nav.main}><button disabled={busy} onClick={() => void navigate('#/')}>{t.nav.newCode}</button><button disabled={busy} onClick={openDrawer}>{t.nav.projects} <kbd>Ctrl P</kbd></button><button onClick={() => setShowShortcuts(true)} aria-label={t.nav.showShortcuts}>{t.nav.shortcuts}</button><button disabled={busy} onClick={() => void navigate('#/bindings')}>{t.nav.bindings}</button><button onClick={() => void navigate('#/security')}>{t.nav.security}</button><button onClick={() => void navigate('#/settings')}>{t.nav.settings}</button></nav>
      <ProfilePicker profiles={profiles} activeId={settings?.activeProfileId ?? null} onManage={() => setManagingProfiles(true)}
        onSelect={id => void run(async () => { if (settings) { await storage.saveSettings({ ...settings, activeProfileId: id }); await controller.reloadSettings(); } })} /><label className="theme-choice">Tema<select aria-label="Tema" value={theme} onChange={e => changeTheme(e.target.value as ThemeChoice)}><option value="system">System</option><option value="light">Ljust</option><option value="dark">Mörkt</option></select></label><span className={`save-state ${phase === 'error' ? 'danger-text' : ''}`} role="status">{saveStatus}</span></header>
    {state.error && <div className="persistence-error" role="alert"><strong>Fel vid sparning</strong><p>{state.error}</p><button onClick={() => { void controller.flush(true).catch(() => {}); }}>{t.dialog.retrySave}</button></div>}
    {countdown !== null && <div className="clipboard-countdown" role="status">{t.copy.clearingIn(countdown)}<button onClick={() => { pendingClear.current = null; setCountdown(null); setNotice(t.copy.clipboardKept); }}>Avbryt</button></div>}
    {notice && <div className={`inline-notice ${noticeTone}`} role="status">{notice}<button aria-label={t.dialog.closeNotice} onClick={() => setNotice('')}>×</button></div>}
    {updateReady && <div className="notice">{t.app.updateAvailable} <button onClick={() => void run(async () => { await controller.flush(); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); updateReady.waiting?.postMessage({ type: 'ACTIVATE' }); })}>Ladda om</button></div>}
    {/* Report U9. inert on the whole main froze the page during every write, including the parts a
        write cannot corrupt: reading a document, a filter, the version list. It is now on the
        editing surface alone, and the busy state is visible in the header. Anything the rest can
        start still goes through run(), which refuses politely while a write is in flight. */}
    <main id="huvudinnehall" aria-busy={busy}>
      <div className="workspace" hidden={!workspaceVisible} inert={busy}><section className="project-heading"><div className="project-identity"><span className="eyebrow">{project ? 'LOKALT ARBETSUTKAST' : t.app.startNow}</span>
        {project ? <ProjectName key={session.key} name={session.name} change={name => controller.rename(name)} /> : <h1>Klistra in din kod</h1>}
        <div className="file-info"><label>{t.workspace.language} <select aria-label={t.workspace.language} value={language} onChange={e => { languageChosen.current.add(session.activeFileId); controller.changeLanguage(e.target.value as LanguageId); }}>{languages.map(l => <option key={l}>{l}</option>)}</select></label><span>{project ? `${session.files.length} ${session.files.length === 1 ? 'fil' : 'filer'}` : t.workspace.newProjectHint}{session.baseVersionId && ` · baserad på v${versions.find(v => v.id === session.baseVersionId)?.number ?? '?'}`}</span></div>
      </div><div className="heading-actions">{!project && currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>{t.workspace.backToCurrent}</button>}{project && <button className="text-button" disabled={busy} onClick={() => setDetails(true)}>Om projektet</button>}{project && <button className="text-button danger-text" disabled={busy} onClick={() => void removeProject(project.id, session.name)}>Radera projekt</button>}<button className="primary" disabled={busy || !template.trim()} onClick={() => setLabelling(true)}>Spara version</button></div></section>
        <div className="work-grid" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false); }}
          onDrop={e => { e.preventDefault(); setDropping(false); void openFiles(e.dataTransfer.files); }}>
          {dropping && <div className="drop-hint" aria-hidden="true">{t.workspace.dropHint}</div>}<section className={`editor-panel mode-${mode}`}>
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
            hasText={Boolean(template.trim())} localIssues={local.issues} aiIssues={ai.issues} blockedCount={issues.length}
            canCopySelection={mode === 'template' && Boolean(selected)} onCopy={which => void copy(which)}
            onCopySelection={() => void copySelection()} />
          <div className="view-banner" key={mode}><strong>{mode === 'template' ? t.workspace.bannerTemplate : mode === 'local' ? t.workspace.bannerLocal : t.workspace.bannerAi}</strong><span>{mode === 'template' ? t.workspace.editableSource : t.workspace.readOnlyProjection}</span></div>
          {mode === 'local' && <div className="local-tools"><button onClick={() => { setMode('template'); setFocusLine(currentLine.current); }}>{t.workspace.editAsTemplate}</button><button onClick={() => setShowSecrets(!showSecrets)}>{showSecrets ? t.workspace.hideValues : t.workspace.showValues}</button></div>}
          <div className="editor-body" id="kodvy" role="tabpanel" aria-labelledby={`vy-${mode}`}>{!template && mode === 'template' && <div className="paste-prompt"><strong>Klistra in din kod här</strong><span>Projektet skapas automatiskt och sparas lokalt.</span>{samples[language] && <button className="text-button" onClick={() => controller.changeText(samples[language]!)}>eller prova med exempelkod</button>}</div>}
            <Editor key="primary-editor" documentKey={`${session.key}:${session.activeFileId}:${mode}`} active={workspaceVisible} autoFocus value={visible} language={language} readOnly={busy || mode !== 'template'} onChange={text => { noteLanguage(text); controller.changeText(text); }} onBinding={createBinding}
              onPlaceholder={name => { setFocusName(name); const b = resolveBinding(name, bindings, options.projectId, options.versionId); if (b) setBindingDialog({ binding: b }); }} describePlaceholder={name => { const b = resolveBinding(name, bindings, options.projectId, options.versionId); return b && { category: b.category, aiReplacement: b.aiReplacement, hasValue: Boolean(resolveValue(b, options.profileId)) }; }} theme={resolvedTheme} placeholderNames={activeBindings.map(b => b.name)} substitutions={mode === 'template' ? noSubstitutions : mode === 'ai' ? ai.substitutions : local.substitutions} focusName={focusName} focusLine={focusLine} onLine={line => { currentLine.current = line; }}
              fontSize={fontSize} wordWrap={wrap} onSelectionChange={setSelected} onFocused={() => setFocusName('')} />
          </div><div className="editor-footer"><span>{visible.split('\n').length} rader · {used.length} bindings</span>
            <div className="editor-tools" role="group" aria-label={t.workspace.editorSettings}>
              <button aria-label={t.workspace.smallerText} title={t.workspace.smallerText} disabled={fontSize <= 10} onClick={() => void changeEditor({ editorFontSize: fontSize - 1 }).catch(() => {})}>A−</button>
              <span aria-live="polite">{fontSize} px</span>
              <button aria-label={t.workspace.largerText} title={t.workspace.largerText} disabled={fontSize >= 24} onClick={() => void changeEditor({ editorFontSize: fontSize + 1 }).catch(() => {})}>A+</button>
              <button aria-pressed={wrap} onClick={() => void changeEditor({ editorWordWrap: !wrap }).catch(() => {})}>{t.workspace.wordWrap(wrap)}</button>
            </div>
            <span>{mode === 'local' ? t.workspace.localFooter : t.workspace.draftFooter}</span></div>
        </section><aside className="binding-panel"><BindingPanel rows={toRows(activeBindings, used, options.profileId)} canCreate={Boolean(project)}
            onFocus={b => { setMode('template'); setFocusName(b.name); }}
            onEdit={b => setBindingDialog({ binding: b })}
            onDelete={b => void removeBinding(b)}
            onCreate={() => void newBinding()} />
          <IssuePanel issues={issues} onSelect={showIssue} />
          <FindingsPanel findings={findings} onShow={f => { changeMode('template'); setFocusLine(f.line); }}
            onBind={bindFinding} onDismiss={f => void dismissFinding(f)} />
          <VersionPanel versions={versions} baseVersionId={session.baseVersionId} disabled={busy}
            onPreview={v => setViewing({ version: v, compareTo: null })}
            onCompare={v => setViewing({ version: v, compareTo: versions[versions.indexOf(v) + 1] ?? null })}
            onRestore={(v, asNew) => void applyVersion(v, asNew)}
            onDelete={v => void removeVersion(v)} />
          <div className="m1-note"><b>{t.app.notYetTitle}</b><p>{t.app.notYetBody}</p></div>
        </aside></div>
      </div>
      <div className="overview-scroll" ref={overview} hidden={route !== '#/projects'} onScroll={e => { if (route === '#/projects') overviewScroll.current = e.currentTarget.scrollTop; }}><section className="dashboard">
        <div className="dashboard-heading"><div><span className="eyebrow">DITT LOKALA VALV</span><h1>Alla projekt</h1><p>Ditt pågående arbete ligger kvar medan du letar.</p></div><div className="heading-actions">{currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>{t.workspace.backToCurrent}</button>}<button className="primary" onClick={() => void navigate('#/')}>{t.nav.newCode}</button></div></div>
        <ProjectFilters query={query} onQuery={setQuery} sort={sort} onSort={setSort} language={languageFilter} onLanguage={setLanguageFilter} status={statusFilter} onStatus={setStatusFilter} count={filtered.length} />
        <div className="project-cards">{filtered.map(p => <ProjectCard key={p.id} project={p} facts={facts[p.id]} current={p.id === currentId} open={() => void navigate(`#/project/${p.id}`)} />)}</div>
        {!filtered.length && <p className="empty-project-list">{projects.length ? t.project.noMatch : t.project.empty}</p>}
      </section></div>
      <div className="overview-scroll" hidden={route !== '#/bindings'}><BindingsPage bindings={bindings} uses={bindingUses} profileId={options.profileId}
        onEdit={b => setBindingDialog({ binding: b })} onDelete={b => void removeBinding(b)} onCreate={newBinding} /></div>
      <div hidden={route !== '#/security'}><Security /></div>
      <div hidden={route !== '#/settings'}><SettingsPage settings={settings} storage={storage} storageInfo={storageInfo}
        onStorageInfo={setStorageInfo} deviceName={deviceName} onDeviceName={setDeviceName} rules={rules}
        onRules={() => void storage.listScannerRules().then(setRules)} save={patch => changeEditor(patch)} notify={setNotice}
        confirm={confirm} showIntro={() => setIntro(true)} /></div>
    </main><footer className="app-footer"><span>AI Code Vault · {__APP_VERSION__}</span><span>Lokalt valv · M1</span></footer>
  </div>
    {drawer && <ProjectBrowser projects={projects} currentId={currentId} query={drawerQuery} onQuery={setDrawerQuery} close={() => setDrawer(false)} open={id => void navigate(`#/project/${id}`)} overview={() => void navigate('#/projects')} />}
    {bindingDialog && <BindingDialog initial={bindingDialog.binding} bindings={bindings} profiles={profiles} count={bindingDialog.selection ? template.split(bindingDialog.selection.text).length - 1 : 0}
      preview={bindingDialog.selection && (() => {
        const s = bindingDialog.selection!;
        const lineStart = template.lastIndexOf('\n', s.start - 1) + 1;
        const lineEnd = template.indexOf('\n', s.end) === -1 ? template.length : template.indexOf('\n', s.end);
        const line = template.slice(lineStart, lineEnd);
        return { before: line, after: line.slice(0, s.start - lineStart) + `{{${bindingDialog.binding.name}}}` + line.slice(s.end - lineStart) };
      })() || undefined}
      save={storeBinding} close={() => setBindingDialog(null)} />}
    {copyMode && <CopyDialog mode={copyMode} coverage={cover} issues={ai.issues.length} replaced={ai.used.length}
      findings={copyFindings} seriousFindings={seriousFindings} reviewed={reviewed} onReviewed={setReviewed}
      close={() => setCopyMode(null)} onDownload={() => downloadCopy(copyMode)}
      onCopy={() => {
        // Re-audited on the current text: the dialog must not be able to copy what it last saw.
        const result = auditForCopy(template, bindings, { ...options, mode: copyMode });
        if (result.canCopy) void writeClipboard(withPrompt(result.text, copyMode, result.used.length), copyMode);
      }} />}
    {viewing && <Modal title={viewing.compareTo ? `v${viewing.compareTo.number} → v${viewing.version.number}` : `v${viewing.version.number}${viewing.version.label ? ` · ${viewing.version.label}` : ''}`} close={() => setViewing(null)}>
      <div className="version-view">
        <Suspense fallback={<p className="muted">{t.version.loadingDiff}</p>}><DiffEditor language={language} theme={resolvedTheme}
          original={viewing.compareTo?.templates[session.activeFileId] ?? (viewing.compareTo ? '' : viewing.version.templates[session.activeFileId] ?? '')}
          modified={viewing.version.templates[session.activeFileId] ?? ''} /></Suspense>
      </div>
      <p className="notice">Skrivskyddad mall som den såg ut när versionen sparades. Ditt utkast är orört{viewing.version.files && viewing.version.files.length > 1 ? `. Visar ${session.files.find(f => f.id === session.activeFileId)?.name} av ${viewing.version.files.length} filer` : ''}.</p>
      <div className="dialog-actions"><button onClick={() => setViewing(null)}>Stäng</button><button className="primary" onClick={() => { const v = viewing.version; setViewing(null); void applyVersion(v); }}>{t.version.restoreThis}</button></div>
    </Modal>}
    {details && project && <ProjectDetails project={project} close={() => setDetails(false)} save={async patch => {
      await storage.saveProject({ ...project, ...patch, updatedAt: new Date().toISOString() });
      await controller.reloadProject();
      setNotice(t.project.detailsSaved);
    }} />}
    {showShortcuts && <Modal title={t.app.shortcutsTitle} close={() => setShowShortcuts(false)}>
      <table className="shortcut-table"><tbody>{shortcuts.map(s => <tr key={s.id}><th scope="row">{s.label}</th><td>{s.keys.map(k => <kbd key={k}>{k}</kbd>)}{s.note && <small>{s.note}</small>}</td></tr>)}</tbody></table>
      <h3>{t.app.inTheEditor}</h3>
      <table className="shortcut-table"><tbody>{editorShortcuts.map(s => <tr key={s.label}><th scope="row">{s.label}</th><td>{s.keys.map(k => <kbd key={k}>{k}</kbd>)}{s.note && <small>{s.note}</small>}</td></tr>)}</tbody></table>
      <div className="dialog-actions"><button className="primary" onClick={() => setShowShortcuts(false)}>Stäng</button></div>
    </Modal>}
    {ingesting && <IngestDialog bindings={bindings} close={() => setIngesting(false)} apply={next => {
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
    {intro && <Intro close={() => setIntro(false)} />}
    {error && <Modal title={t.dialog.attention} close={() => setError('')}><p role="alert">{error}</p><div className="dialog-actions"><button className="primary" onClick={() => setError('')}>Stäng</button></div></Modal>}
  </div>;
}
