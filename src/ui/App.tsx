import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Binding, LanguageId, Version } from '../types/models';
import { languages } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { resolveBinding, resolveValue, suggestBinding, defaults } from '../domain/bindings';
import { expandToLiteral } from '../domain/bindings/literal';
import { render, usage } from '../domain/render';
import { auditForCopy } from '../domain/render/audit';
import { buildValueIndex } from '../domain/render/leak';
import { type Coverage } from '../domain/render/coverage';
import { WorkspaceController } from './WorkspaceController';
import { CodeEditor, type Selection } from './editor/CodeEditor';
import { BindingDialog } from './components/BindingDialog';
import { Modal } from './components/Modal';
import { ProjectBrowser } from './components/ProjectBrowser';
import { filterProjects, ProjectCard, ProjectFilters, sortProjects, useProjectFacts, type SortKey } from './components/ProjectsPage';
import { BackupPanel } from './components/BackupPanel';
import { RulesPanel } from './components/RulesPanel';
import { useConfirm } from './components/ConfirmDialog';
import { collectIssues, IssuePanel, type LocatedIssue } from './components/IssuePanel';
import { FindingsPanel, useDismissals, useScanner } from './components/FindingsPanel';
import { FileTabs } from './components/FileTabs';
import { VersionPanel } from './components/VersionPanel';
import { ProjectDetails } from './components/ProjectDetails';
import { BindingPanel, toRows } from './components/BindingPanel';
import { ProfileManager, ProfilePicker } from './components/ProfilePicker';
import { DiffEditor } from './editor/DiffEditor';
import { scan, type Finding } from '../domain/scanner';
import type { Profile, ScannerRule } from '../types/models';
import { Security } from './pages/Security';
import { applyTheme, paintHint, resolveTheme, systemPrefersDark, watchSystemTheme, type ThemeChoice } from './theme';
import { formatBytes, requestPersistence, storageState, type StorageState } from '../storage/persistence';
import { clearClipboard } from './clipboard';
import './code-first.css';

type Mode = 'template' | 'local' | 'ai';
/** One per language: the empty state previously offered a sample only when the language happened
 * to be PowerShell, which is every language but one. */
const samples: Partial<Record<LanguageId, string>> = {
  powershell: '$username = "example.user"\n$password = "<PASSWORD>"\n$exportPath = "C:\\Temp\\Example"\n',
  python: 'username = "example.user"\npassword = "<PASSWORD>"\nexport_path = "/tmp/example"\n',
  javascript: 'const username = "example.user";\nconst password = "<PASSWORD>";\nconst host = "server.example.test";\n',
  typescript: 'const username: string = "example.user";\nconst password: string = "<PASSWORD>";\n',
  json: '{\n  "username": "example.user",\n  "password": "<PASSWORD>"\n}\n',
  yaml: 'username: example.user\npassword: "<PASSWORD>"\nhost: server.example.test\n',
  shell: 'USERNAME="example.user"\nPASSWORD="<PASSWORD>"\nHOST="server.example.test"\n',
  xml: '<config>\n  <user>example.user</user>\n  <password>&lt;PASSWORD&gt;</password>\n</config>\n',
  plaintext: 'anvandare: example.user\nlosenord: <PASSWORD>\n',
};
function ProjectName({ name, change }: { name: string; change: (name: string) => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(name);
  const cancelled = useRef(false);
  if (!editing) return <button className="project-name" aria-label="Ändra projektnamn" onClick={() => { setText(name); cancelled.current = false; setEditing(true); }}>{name}<span>✎</span></button>;
  function finish() { if (!cancelled.current) change(text); setEditing(false); }
  return <input className="project-name-input" aria-label="Projektnamn" autoFocus value={text} onFocus={e => e.target.select()} onChange={e => setText(e.target.value)}
    onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { cancelled.current = true; setEditing(false); } }} />;
}

/** What the app actually checked, said plainly. The previous wording announced that no known
 * problems were found even when nothing had been bound and therefore nothing could be known,
 * which made the default paste-and-copy path read as a clean bill of health. */
function AiCopyReview({ coverage, issues, replaced, findings }: { coverage: Coverage; issues: number; replaced: number; findings: Finding[] }) {
  const { bound, literals, unbound } = coverage;
  const serious = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const headline = issues
    ? 'Granskning krävs'
    : serious.length
      ? `${serious.length} misstänkta värden hittades`
      : bound === 0
      ? literals === 0
        ? 'Ingenting att skydda hittades i koden'
        : 'Inga värden är skyddade'
      : 'Inga kända problem hittades';
  return (
    <>
      <p className={issues || serious.length || bound === 0 ? 'danger-text' : ''}><b>{headline}</b></p>
      <p>
        <b>{bound} av {literals}</b> strängvärden är kopplade till bindings. {replaced} förekomster ersätts vid kopiering.
      </p>
      {bound === 0 && literals > 0 && (
        <p>Inget värde är kopplat till en binding, så allt nedan skickas som det står.</p>
      )}
      {findings.length > 0 && (
        <ul className="unbound-values">
          {findings.slice(0, 8).map((finding, index) => (
            <li key={index}>
              rad {finding.line} · {finding.ruleName} · <code>{finding.maskedExcerpt}</code>
            </li>
          ))}
          {findings.length > 8 && <li>och {findings.length - 8} till</li>}
        </ul>
      )}
      {unbound.length > 0 && (
        <ul className="unbound-values">
          {unbound.slice(0, 6).map((literal, index) => (
            <li key={index}><code>{literal.text.length > 60 ? literal.text.slice(0, 60) + '…' : literal.text}</code></li>
          ))}
          {unbound.length > 6 && <li>och {unbound.length - 6} till</li>}
        </ul>
      )}
      <p className="notice">
        Kontrollen omfattar saknade bindings, stödd escaping, exakta kända privata värden och {findings.length > 0 ? 'de misstänkta värden som listas ovan' : 'en genomsökning efter misstänkta värden'}. Mönstren fångar det som liknar
        hemligheter — inte allt som är känsligt i just din miljö. Läs igenom koden själv innan du delar den.
      </p>
    </>
  );
}

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
  const [drawer, setDrawer] = useState(false), [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated'), [languageFilter, setLanguageFilter] = useState(''), [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [bindingDialog, setBindingDialog] = useState<{ binding: Binding; selection?: Selection } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false), [focusName, setFocusName] = useState(''), [focusLine, setFocusLine] = useState<number>();
  const [viewing, setViewing] = useState<{ version: Version; compareTo: Version | null } | null>(null), [labelling, setLabelling] = useState(false), [details, setDetails] = useState(false);
  const [copyMode, setCopyMode] = useState<'local' | 'ai' | null>(null), [reviewed, setReviewed] = useState(false), [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const [deviceName, setDeviceName] = useState(''), currentLine = useRef(1);
  const [theme, setTheme] = useState<ThemeChoice>(paintHint()), [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [storageInfo, setStorageInfo] = useState<StorageState | null>(null), asked = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const [rules, setRules] = useState<ScannerRule[]>([]), [profiles, setProfiles] = useState<Profile[]>([]), [managingProfiles, setManagingProfiles] = useState(false);
  const [dismissed, refreshDismissals] = useDismissals(() => project ? storage.listDismissals(project.id) : Promise.resolve([]), project?.id ?? '');
  const findings = useScanner(mode === 'template' ? template : '', rules, dismissed);
  const [countdown, setCountdown] = useState<number | null>(null), pendingClear = useRef<string | null>(null);
  const overview = useRef<HTMLDivElement>(null), overviewScroll = useRef(0);
  const navigateRef = useRef<(hash: string, replace?: boolean) => Promise<void>>(async () => {});
  const workspaceVisible = route === '#/' || route.startsWith('#/project/');

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); }
    catch (e) { if (!controller.getSnapshot().error) setError(e instanceof Error ? e.message : 'Åtgärden kunde inte slutföras. Din text finns kvar.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function setLocation(hash: string, replace = false) {
    if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) history.pushState(null, '', hash);
    routeRef.current = hash; setRoute(hash);
  }
  async function navigate(hash: string, replace = false) {
    if (busyRef.current) { history.replaceState(null, '', routeRef.current); return; }
    await run(async () => {
      await controller.flush();
      const id = /^#\/project\/([a-f0-9-]+)$/.exec(hash)?.[1];
      if (id) { await controller.open(id); setMode('template'); setFocusName(''); setFocusLine(undefined); }
      else if (hash === '#/' && (routeRef.current !== '#/' || controller.getSnapshot().session.project)) {
        await controller.newCode(); setMode('template'); setFocusName(''); setFocusLine(undefined);
      } else if (!['#/', '#/projects', '#/settings', '#/security'].includes(hash)) throw new Error('Sidan finns inte. Öppna Mina projekt för att fortsätta.');
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
    }).catch(() => setNotice('Offline-cache kunde inte aktiveras. Behåll appen öppen.'));
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
  const saveStatus = phase === 'loading' ? 'Öppnar lokalt valv…' : phase === 'error' ? 'Fel vid sparning' : phase === 'saved' ? 'Sparat lokalt' : 'Sparar lokalt…';
  const currentId = controller.getLastProjectId();
  const filtered = sortProjects(filterProjects(projects, query, languageFilter, statusFilter), sort);
  const facts = useProjectFacts(storage, projects, route === '#/projects');
  async function removeVersion(version: Version) {
    await run(async () => {
      if (version.id === session.baseVersionId) throw new Error('Utkastet bygger på den här versionen. Återställ en annan först.');
      if (!await confirm({ title: `Radera v${version.number}?`, danger: true, confirmLabel: 'Radera versionen',
        body: <><p>{version.label ? `"${version.label}"` : 'Versionen'} tas bort ur historiken för alltid.</p><p>Utkastet du arbetar i påverkas inte.</p></> })) return;
      await storage.deleteVersion(version.id);
      await controller.reloadVersions();
      setViewing(null);
      setNotice(`v${version.number} raderad.`);
    });
  }
  async function removeProject(id: string, name: string) {
    await run(async () => {
      const [versions, all] = await Promise.all([storage.listVersions(id), storage.listBindings()]);
      const scoped = all.filter(b => b.scope === 'project' && b.scopeRef === id);
      if (!await confirm({ title: `Radera ${name}?`, danger: true, confirmLabel: 'Radera projektet', typeToConfirm: 'RADERA',
        body: <><p>Följande försvinner för alltid från den här datorn:</p><ul><li>{versions.length} sparade versioner</li><li>{scoped.length} bindings som hör till projektet, med sina privata värden</li><li>Det pågående utkastet</li></ul><p>Globala bindings påverkas inte. Exportera en backup först om du är osäker.</p></> })) return;
      const wasOpen = controller.getSnapshot().session.project?.id === id;
      await storage.deleteProject(id);
      // The session still points at the deleted project, so it must be dropped before anything
      // else runs; a later flush would try to save a draft for a project that is gone.
      if (wasOpen) controller.reset();
      await controller.refreshProjects();
      setBindings(await storage.listBindings());
      if (wasOpen) setLocation('#/', true);
      setNotice(`${name} raderat.`);
    });
  }
  async function saveVersion(label: string) {
    setLabelling(false);
    await run(() => controller.saveVersion(label.trim()));
  }
  function changeTheme(next: ThemeChoice) {
    setTheme(next); applyTheme(next);
    if (settings) void storage.saveSettings({ ...settings, theme: next }).catch(() => setNotice('Temat gäller nu men kunde inte sparas.'));
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
    if (mode === 'local' || !selection.text || /\{\{.*\}\}/.test(selection.text)) return;
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
        if (start < 0 || template.indexOf(selection.text, start + 1) >= 0) throw new Error('Markera värdet i Mall-vyn så att rätt förekomst kan identifieras.');
        selection = { ...selection, start, end: start + selection.text.length };
      }
      setBindingDialog({ binding, selection });
    });
  }
  function newBinding() {
    const current = controller.getSnapshot();
    if (!current.session.project || !current.settings) return;
    const time = new Date().toISOString();
    // No selection, so nothing is replaced in the template: the placeholder is typed by hand or
    // picked from the editor's completion. Useful for preparing a value before the code exists.
    setBindingDialog({ binding: { id: crypto.randomUUID(), name: '', category: 'secret', scope: 'project',
      scopeRef: current.session.project.id, description: '', aiReplacement: defaults.secret, values: {},
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
      if (occurrences) setNotice(`${previous.name} heter nu ${binding.name}. ${occurrences} platshållare skrevs om.`);
    }
    await storage.saveBinding({ ...binding, updatedAt: new Date().toISOString() }); setBindings(await storage.listBindings());
    if (selection) {
      const source = controller.getSnapshot().session.text;
      if (source.slice(selection.start, selection.end) !== selection.text) throw new Error('Mallen har ändrats. Bindingen är sparad; markera rätt text igen.');
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
      const answer = await confirm({ title: `Radera ${binding.name}?`, danger: true, confirmLabel: 'Radera bindingen',
        body: <><p>Bindingen används i {locations.length} sparade versioner av det här projektet{here ? `, och ${here} gånger i den öppna filen` : ''}.</p>
          <p>{value ? 'Det privata värdet försvinner ur valvet.' : 'Bindingen har inget privat värde.'} Sparade versioner behåller sina platshållare.</p></>,
        // Deleting used to leave {{NAME}} behind with nothing to resolve it, which blocks copying
        // until the user tracks down every one by hand.
        option: value && here ? { label: `Skriv tillbaka det privata värdet på ${here === 1 ? 'platsen' : `de ${here} platserna`} i den här filen`, defaultChecked: true } : undefined });
      if (!answer) return;
      if (answer.optionChecked && value) controller.changeText(template.split(`{{${binding.name}}}`).join(value));
      await storage.deleteBinding(binding.id); setBindings(await storage.listBindings());
      await controller.flush();
    });
  }
  async function applyVersion(version: Version, save = false) {
    if (!await confirm({ title: `Använd v${version.number}?`, confirmLabel: 'Ersätt utkastet',
      body: <><p>Det nuvarande arbetsutkastet ersätts av innehållet i v{version.number}.</p><p>Sparade versioner påverkas inte och går att gå tillbaka till.</p></> })) return;
    await run(async () => { await controller.applyVersion(version); if (save) await controller.saveVersion(`Återgång till v${version.number}`); changeMode('template'); });
  }
  async function writeClipboard(text: string, which: 'local' | 'ai') {
    try {
      await navigator.clipboard.writeText(text); setCopyMode(null);
      setNotice(which === 'local' ? 'LOCAL kopierad · riktiga värden i urklippet' : 'AI-kod kopierad');
      const seconds = settings?.clipboardAutoClearSeconds ?? 0;
      // Only the local copy carries real values, so only it is worth clearing.
      if (which === 'local' && seconds > 0) { pendingClear.current = text; setCountdown(seconds); }
    }
    catch { setError('Webbläsaren nekade urklippsåtkomst. Kontrollera sidans behörighet.'); }
  }
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) { const id = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(id); }
    const text = pendingClear.current;
    pendingClear.current = null; setCountdown(null);
    if (text) void clearClipboard(text).then(outcome => setNotice(
      outcome === 'cleared' ? 'Urklippet är rensat.'
        : outcome === 'replaced-by-other' ? 'Urklippet innehåller något annat nu och lämnades orört.'
          : 'Urklippet kunde inte rensas. Kopiera något ofarligt för att skriva över det.'));
  }, [countdown]);
  async function copy(which: 'local' | 'ai') {
    if (!workspaceVisible || !template.trim() || busyRef.current) return;
    // Re-audited here rather than reusing the memoised value: the gate must have run on the text
    // being copied, not on whatever it last saw.
    const result = auditForCopy(template, bindings, { ...options, mode: which });
    if (!result.canCopy) { setError('Kopiering blockerad. Åtgärda problemen i panelen.'); return; }
    if (which === 'ai' || result.secretRanges.length) { setReviewed(false); setCopyMode(which); return; }
    await writeClipboard(result.text, which);
  }
  function openDrawer() { setDrawer(true); void controller.refreshProjects().catch(() => setError('Projektlistan kunde inte läsas. Din kod finns kvar.')); }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('dialog[open]')) return;
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); openDrawer(); }
      if (e.key.toLowerCase() === 'c' && e.shiftKey) { e.preventDefault(); void copy('ai'); }
      if (e.key.toLowerCase() === 'c' && e.altKey) { e.preventDefault(); void copy('local'); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  return <div className="app-shell code-first"><div className="main-shell">
    <header className="topbar"><a className="brand" href="#/" onClick={e => { e.preventDefault(); void navigate('#/'); }}><span className="brand-icon">{'</>'}</span><span>AI Code Vault</span></a>
      <nav className="top-navigation" aria-label="Huvudnavigation"><button disabled={busy} onClick={() => void navigate('#/')}>＋ Ny kod</button><button disabled={busy} onClick={openDrawer}>Mina projekt <kbd>Ctrl K</kbd></button><button onClick={() => void navigate('#/security')}>Säkerhet</button><button onClick={() => void navigate('#/settings')}>Inställningar</button></nav>
      <ProfilePicker profiles={profiles} activeId={settings?.activeProfileId ?? null} onManage={() => setManagingProfiles(true)}
        onSelect={id => void run(async () => { if (settings) { await storage.saveSettings({ ...settings, activeProfileId: id }); await controller.reloadSettings(); } })} /><label className="theme-choice">Tema<select aria-label="Tema" value={theme} onChange={e => changeTheme(e.target.value as ThemeChoice)}><option value="system">System</option><option value="light">Ljust</option><option value="dark">Mörkt</option></select></label><span className={`save-state ${phase === 'error' ? 'danger-text' : ''}`} role="status">{saveStatus}</span></header>
    {state.error && <div className="persistence-error" role="alert"><strong>Fel vid sparning</strong><p>{state.error}</p><button onClick={() => { void controller.flush(true).catch(() => {}); }}>Försök spara igen</button></div>}
    {countdown !== null && <div className="clipboard-countdown" role="status">Urklippet rensas om {countdown} s<button onClick={() => { pendingClear.current = null; setCountdown(null); setNotice('Urklippet lämnas kvar.'); }}>Avbryt</button></div>}
    {notice && <div className="inline-notice" role="status">{notice}<button aria-label="Stäng meddelande" onClick={() => setNotice('')}>×</button></div>}
    {updateReady && <div className="notice">Uppdatering tillgänglig <button onClick={() => void run(async () => { await controller.flush(); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); updateReady.waiting?.postMessage({ type: 'ACTIVATE' }); })}>Ladda om</button></div>}
    <main inert={busy}>
      <div className="workspace" hidden={!workspaceVisible}><section className="project-heading"><div className="project-identity"><span className="eyebrow">{project ? 'LOKALT ARBETSUTKAST' : 'BÖRJA DIREKT'}</span>
        {project ? <ProjectName key={session.key} name={session.name} change={name => controller.rename(name)} /> : <h1>Klistra in din kod</h1>}
        <div className="file-info"><label>Språk <select aria-label="Språk" value={language} onChange={e => controller.changeLanguage(e.target.value as LanguageId)}>{languages.map(l => <option key={l}>{l}</option>)}</select></label><span>{project ? `${session.files.length} ${session.files.length === 1 ? 'fil' : 'filer'}` : 'Nytt projekt skapas när du börjar'}{session.baseVersionId && ` · baserad på v${versions.find(v => v.id === session.baseVersionId)?.number ?? '?'}`}</span></div>
      </div><div className="heading-actions">{!project && currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>Tillbaka till pågående projekt</button>}{project && <button className="text-button" disabled={busy} onClick={() => setDetails(true)}>Om projektet</button>}{project && <button className="text-button danger-text" disabled={busy} onClick={() => void removeProject(project.id, session.name)}>Radera projekt</button>}<button className="primary" disabled={busy || !template.trim()} onClick={() => setLabelling(true)}>Spara version</button></div></section>
        <div className="work-grid"><section className={`editor-panel mode-${mode}`}>
          <FileTabs files={session.files} activeId={session.activeFileId} disabled={busy}
            onSelect={id => { controller.selectFile(id); changeMode('template'); }}
            onAdd={() => void run(async () => { await controller.addFile(); changeMode('template'); })}
            onRename={(id, name) => void controller.renameFile(id, name)}
            onRemove={id => void run(async () => {
              const file = session.files.find(f => f.id === id);
              if (!file) return;
              const hasText = (session.texts[id] ?? '').trim().length > 0;
              if (hasText && !await confirm({ title: `Ta bort ${file.name}?`, danger: true, confirmLabel: 'Ta bort filen',
                body: <><p>Filens innehåll försvinner ur arbetsutkastet.</p><p>Sparade versioner behåller sin kopia, så den går att få tillbaka därifrån.</p></> })) return;
              await controller.removeFile(id);
            })} />
          <div className="editor-toolbar"><div className="view-tabs" role="tablist" aria-label="Kodvy">{(['template', 'local', 'ai'] as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => changeMode(m)}>{m === 'template' ? 'Mall' : m === 'local' ? 'Local' : 'AI'}</button>)}</div><div className="copy-actions">{Boolean(issues.length) && <span id="copy-blocked" className="copy-blocked">{issues.length} problem hindrar kopiering — se panelen</span>}<button disabled={!template.trim() || Boolean(local.issues.length)} aria-describedby={local.issues.length ? 'copy-blocked' : undefined} title={local.issues.length ? `Blockerad: ${local.issues.length} problem i Local-vyn` : undefined} onClick={() => void copy('local')}>Copy Local</button><button className="ai-copy" disabled={!template.trim() || Boolean(ai.issues.length)} aria-describedby={ai.issues.length ? 'copy-blocked' : undefined} title={ai.issues.length ? `Blockerad: ${ai.issues.length} problem i AI-vyn` : undefined} onClick={() => void copy('ai')}>Copy for AI ↗</button></div></div>
          <div className="view-banner" key={mode}><strong>{mode === 'template' ? '▤ MALL — KAN INNEHÅLLA KÄNSLIGA VÄRDEN' : mode === 'local' ? '⚠ LOCAL — INNEHÅLLER RIKTIGA VÄRDEN' : '◇ AI — SANERAD'}</strong><span>{mode === 'template' ? 'Redigerbar källa' : 'Skrivskyddad projektion'}</span></div>
          {mode === 'local' && <div className="local-tools"><button onClick={() => { setMode('template'); setFocusLine(currentLine.current); }}>Redigera som mall</button><button onClick={() => setShowSecrets(!showSecrets)}>{showSecrets ? 'Dölj värden' : 'Visa värden'}</button></div>}
          <div className="editor-body">{!template && mode === 'template' && <div className="paste-prompt"><strong>Klistra in din kod här</strong><span>Projektet skapas automatiskt och sparas lokalt.</span>{samples[language] && <button className="text-button" onClick={() => controller.changeText(samples[language]!)}>eller prova med exempelkod</button>}</div>}
            <CodeEditor key="primary-editor" documentKey={`${session.key}:${session.activeFileId}:${mode}`} active={workspaceVisible} autoFocus value={visible} language={language} readOnly={busy || mode !== 'template'} onChange={text => controller.changeText(text)} onBinding={createBinding}
              onPlaceholder={name => { setFocusName(name); const b = resolveBinding(name, bindings, options.projectId, options.versionId); if (b) setBindingDialog({ binding: b }); }} describePlaceholder={name => { const b = resolveBinding(name, bindings, options.projectId, options.versionId); return b && { category: b.category, aiReplacement: b.aiReplacement, hasValue: Boolean(resolveValue(b, options.profileId)) }; }} theme={resolvedTheme} placeholderNames={activeBindings.map(b => b.name)} substitutions={mode === 'template' ? [] : mode === 'ai' ? ai.substitutions : local.substitutions} focusName={focusName} focusLine={focusLine} onLine={line => { currentLine.current = line; }} />
          </div><div className="editor-footer"><span>{visible.split('\n').length} rader · {used.length} bindings</span><span>{mode === 'local' ? 'Använd endast i din lokala kodmiljö' : 'Utkast sparas automatiskt · ingen kod körs'}</span></div>
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
          <div className="m1-note"><b>Vad som ännu inte finns</b><p>Kod som kommer tillbaka från en AI matchas inte om mot dina värden automatiskt, och ett projekt rymmer bara en fil. Granskningsreglerna fångar det som liknar hemligheter, inte allt som är känsligt hos dig.</p></div>
        </aside></div>
      </div>
      <div className="overview-scroll" ref={overview} hidden={route !== '#/projects'} onScroll={e => { if (route === '#/projects') overviewScroll.current = e.currentTarget.scrollTop; }}><section className="dashboard">
        <div className="dashboard-heading"><div><span className="eyebrow">DITT LOKALA VALV</span><h1>Alla projekt</h1><p>Ditt pågående arbete ligger kvar medan du letar.</p></div><div className="heading-actions">{currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>Tillbaka till pågående projekt</button>}<button className="primary" onClick={() => void navigate('#/')}>＋ Ny kod</button></div></div>
        <ProjectFilters query={query} onQuery={setQuery} sort={sort} onSort={setSort} language={languageFilter} onLanguage={setLanguageFilter} status={statusFilter} onStatus={setStatusFilter} count={filtered.length} />
        <div className="project-cards">{filtered.map(p => <ProjectCard key={p.id} project={p} facts={facts[p.id]} current={p.id === currentId} open={() => void navigate(`#/project/${p.id}`)} />)}</div>
        {!filtered.length && <p className="empty-project-list">{projects.length ? 'Inga projekt matchar sökningen.' : 'Inga projekt ännu. Välj Ny kod och klistra in för att börja.'}</p>}
      </section></div>
      <div hidden={route !== '#/security'}><Security /></div>
      <article className="document" hidden={route !== '#/settings'}><span className="eyebrow">DEN HÄR INSTALLATIONEN</span><h1>Inställningar</h1><p>Valvet delas inte mellan olika origin eller webbläsarprofiler.</p><dl><dt>Aktuellt origin</dt><dd>{location.origin}</dd><dt>App-sökväg</dt><dd>{location.pathname}</dd><dt>Enhets-ID</dt><dd>{settings?.deviceId}</dd><dt>Lagring</dt><dd>IndexedDB · lokal klartext</dd><dt>Beständig lagring</dt><dd>{!storageInfo ? 'Läser…' : !storageInfo.supported ? 'Stöds inte av webbläsaren' : storageInfo.persisted ? 'Ja · valvet vräks inte vid diskbrist' : 'Nej · webbläsaren får radera valvet'}</dd><dt>Utrymme</dt><dd>{storageInfo?.supported ? `${formatBytes(storageInfo.usedBytes)} av ${formatBytes(storageInfo.quotaBytes)}` : 'okänt'}</dd></dl>{storageInfo && !storageInfo.persisted && <div className="persistence-warning" role="alert"><strong>Valvet kan raderas av webbläsaren</strong><p>Utan beständig lagring får webbläsaren slänga valvet när enheten får ont om utrymme. Det finns ingen backup att återställa från.</p><button onClick={() => void requestPersistence().then(state => { setStorageInfo(state); setNotice(state.persisted ? 'Beständig lagring beviljad.' : 'Webbläsaren nekade beständig lagring.'); })}>Begär beständig lagring</button></div>}<label>Enhetsnamn<input value={deviceName} onChange={e => setDeviceName(e.target.value)} /></label>
      <label>Rensa urklipp efter Copy Local<select aria-label="Rensa urklipp efter Copy Local" value={settings?.clipboardAutoClearSeconds ?? 0} onChange={e => void run(async () => { if (settings) await storage.saveSettings({ ...settings, clipboardAutoClearSeconds: Number(e.target.value) }); await controller.reloadSettings(); })}><option value={0}>Aldrig</option><option value={30}>Efter 30 sekunder</option><option value={60}>Efter 1 minut</option><option value={300}>Efter 5 minuter</option></select><small>Skriver över urklippet när tiden gått. Nedräkningen visas och går att avbryta. Urklippshistorik och molnsynk ligger utanför appens kontroll.</small></label><button className="primary" onClick={() => void run(async () => { if (settings) { await storage.saveSettings({ ...settings, deviceName }); setNotice('Inställningar sparade lokalt'); } })}>Spara inställningar</button><p className="notice">Utkast sparas automatiskt på den här datorn. Automatisk sparning är ingen backup — exportera en fil nedan.</p><RulesPanel storage={storage} rules={rules} notify={setNotice} onChange={() => void storage.listScannerRules().then(setRules)} /><BackupPanel storage={storage} notify={setNotice} confirm={confirm} /></article>
    </main><footer className="app-footer"><span>AI Code Vault · {__APP_VERSION__}</span><span>Lokalt valv · M1</span></footer>
  </div>
    {drawer && <ProjectBrowser projects={projects} currentId={currentId} query={query} onQuery={setQuery} close={() => setDrawer(false)} open={id => void navigate(`#/project/${id}`)} overview={() => void navigate('#/projects')} />}
    {bindingDialog && <BindingDialog initial={bindingDialog.binding} bindings={bindings} profiles={profiles} count={bindingDialog.selection ? template.split(bindingDialog.selection.text).length - 1 : 0}
      preview={bindingDialog.selection && (() => {
        const s = bindingDialog.selection!;
        const lineStart = template.lastIndexOf('\n', s.start - 1) + 1;
        const lineEnd = template.indexOf('\n', s.end) === -1 ? template.length : template.indexOf('\n', s.end);
        const line = template.slice(lineStart, lineEnd);
        return { before: line, after: line.slice(0, s.start - lineStart) + `{{${bindingDialog.binding.name}}}` + line.slice(s.end - lineStart) };
      })() || undefined}
      save={storeBinding} close={() => setBindingDialog(null)} />}
    {copyMode && <Modal title={copyMode === 'local' ? '⚠ Kopiera riktiga värden' : 'AI-export · granska före kopiering'} close={() => setCopyMode(null)}>{copyMode === 'local' ? <><p>Den lokala koden innehåller secrets. Kopiera den endast till din lokala kodmiljö, aldrig till en AI-chatt.</p><p className="notice">Urklippshistorik och molnsynk kan lagra eller överföra innehållet. Appen kontrollerar inte dessa funktioner.</p></> : <AiCopyReview coverage={cover} issues={ai.issues.length} replaced={ai.used.length} findings={copyFindings} />}{copyMode === 'ai' && Boolean(seriousFindings) && <label className="check inline-warning"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Jag har tittat på de {seriousFindings} misstänkta värdena och vill ändå kopiera.</label>}<div className="dialog-actions"><button onClick={() => setCopyMode(null)}>Avbryt</button><button className={copyMode === 'local' ? 'danger' : cover.bound && !seriousFindings ? 'primary' : ''} disabled={copyMode === 'ai' && Boolean(seriousFindings) && !reviewed} onClick={() => { const result = auditForCopy(template, bindings, { ...options, mode: copyMode }); if (result.canCopy) void writeClipboard(result.text, copyMode); }}>{copyMode === 'local' ? 'Kopiera LOCAL med secrets' : cover.bound && !seriousFindings ? 'Jag har granskat · kopiera för AI' : 'Kopiera oskyddad kod ändå'}</button></div></Modal>}
    {viewing && <Modal title={viewing.compareTo ? `v${viewing.compareTo.number} → v${viewing.version.number}` : `v${viewing.version.number}${viewing.version.label ? ` · ${viewing.version.label}` : ''}`} close={() => setViewing(null)}>
      <div className="version-view">
        <DiffEditor language={language} theme={resolvedTheme}
          original={viewing.compareTo?.templates[session.activeFileId] ?? (viewing.compareTo ? '' : viewing.version.templates[session.activeFileId] ?? '')}
          modified={viewing.version.templates[session.activeFileId] ?? ''} />
      </div>
      <p className="notice">Skrivskyddad mall som den såg ut när versionen sparades. Ditt utkast är orört{viewing.version.files && viewing.version.files.length > 1 ? `. Visar ${session.files.find(f => f.id === session.activeFileId)?.name} av ${viewing.version.files.length} filer` : ''}.</p>
      <div className="dialog-actions"><button onClick={() => setViewing(null)}>Stäng</button><button className="primary" onClick={() => { const v = viewing.version; setViewing(null); void applyVersion(v); }}>Återställ den här versionen</button></div>
    </Modal>}
    {details && project && <ProjectDetails project={project} close={() => setDetails(false)} save={async patch => {
      await storage.saveProject({ ...project, ...patch, updatedAt: new Date().toISOString() });
      await controller.reloadProject();
      setNotice('Projektuppgifterna är sparade.');
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
        if (!await confirm({ title: `Ta bort ${profile.name}?`, danger: true, confirmLabel: 'Ta bort profilen',
          body: <><p>{withValues} bindings har ett eget värde för den här profilen. De värdena raderas.</p><p>Standardvärdena påverkas inte.</p></> })) return;
        await storage.deleteProfile(profile.id);
        setProfiles(await storage.listProfiles()); setBindings(await storage.listBindings()); await controller.reloadSettings();
      }} />}
    {labelling && <SaveVersionDialog next={Math.max(0, ...versions.map(v => v.number)) + 1} save={label => void saveVersion(label)} close={() => setLabelling(false)} />}
    {confirmDialog}
    {error && <Modal title="Åtgärden behöver uppmärksamhet" close={() => setError('')}><p role="alert">{error}</p><div className="dialog-actions"><button className="primary" onClick={() => setError('')}>Stäng</button></div></Modal>}
  </div>;
}
