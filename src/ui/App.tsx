import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Binding, LanguageId, Version } from '../types/models';
import { languages } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { resolveBinding, resolveValue, suggestBinding, defaults } from '../domain/bindings';
import { render, usage } from '../domain/render';
import { WorkspaceController } from './WorkspaceController';
import { CodeEditor, type Selection } from './editor/CodeEditor';
import { BindingDialog } from './components/BindingDialog';
import { Modal } from './components/Modal';
import { ProjectBrowser, projectMatches } from './components/ProjectBrowser';
import { Security } from './pages/Security';
import { applyTheme, paintHint, resolveTheme, systemPrefersDark, watchSystemTheme, type ThemeChoice } from './theme';
import './code-first.css';

type Mode = 'template' | 'local' | 'ai';
const fixture = '$username = "example.user"\n$password = "<PASSWORD>"\n$exportPath = "C:\\Temp\\Example"\n';
function ProjectName({ name, change }: { name: string; change: (name: string) => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(name);
  const cancelled = useRef(false);
  if (!editing) return <button className="project-name" aria-label="Ändra projektnamn" onClick={() => { setText(name); cancelled.current = false; setEditing(true); }}>{name}<span>✎</span></button>;
  function finish() { if (!cancelled.current) change(text); setEditing(false); }
  return <input className="project-name-input" aria-label="Projektnamn" autoFocus value={text} onFocus={e => e.target.select()} onChange={e => setText(e.target.value)}
    onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { cancelled.current = true; setEditing(false); } }} />;
}

export function App({ storage }: { storage: StorageProvider }) {
  const [controller] = useState(() => new WorkspaceController(storage));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { session, projects, settings, phase } = state;
  const { project, text: template, language, versions } = session;
  const [route, setRoute] = useState(location.hash || '#/'), routeRef = useRef(route);
  const [bindings, setBindings] = useState<Binding[]>([]), [mode, setMode] = useState<Mode>('template');
  const [drawer, setDrawer] = useState(false), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [bindingDialog, setBindingDialog] = useState<{ binding: Binding; selection?: Selection } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false), [focusName, setFocusName] = useState(''), [focusLine, setFocusLine] = useState<number>();
  const [copyMode, setCopyMode] = useState<'local' | 'ai' | null>(null), [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const [deviceName, setDeviceName] = useState(''), currentLine = useRef(1);
  const [theme, setTheme] = useState<ThemeChoice>(paintHint()), [systemDark, setSystemDark] = useState(systemPrefersDark);
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
  const ai = render(template, bindings, { ...options, mode: 'ai' });
  const local = render(template, bindings, { ...options, mode: 'local', maskSecrets: !showSecrets });
  const visible = mode === 'template' ? template : mode === 'ai' ? ai.text : local.text;
  const issues = mode === 'ai' ? ai.issues : local.issues, used = usage(template);
  const activeBindings = bindings.filter(b => resolveBinding(b.name, bindings, options.projectId, options.versionId)?.id === b.id)
    .sort((a, b) => Number(Boolean(resolveValue(a, options.profileId))) - Number(Boolean(resolveValue(b, options.profileId))) || a.name.localeCompare(b.name));
  const saveStatus = phase === 'loading' ? 'Öppnar lokalt valv…' : phase === 'error' ? 'Fel vid sparning' : phase === 'saved' ? 'Sparat lokalt' : 'Sparar lokalt…';
  const currentId = controller.getLastProjectId(), filtered = projects.filter(p => projectMatches(p, query));
  function changeTheme(next: ThemeChoice) {
    setTheme(next); applyTheme(next);
    if (settings) void storage.saveSettings({ ...settings, theme: next }).catch(() => setNotice('Temat gäller nu men kunde inte sparas.'));
  }
  function changeMode(next: Mode) { setMode(next); setShowSecrets(false); setFocusName(''); setFocusLine(undefined); }
  function createBinding(selection: Selection) {
    if (mode === 'local' || !selection.text || /\{\{.*\}\}/.test(selection.text)) return;
    void run(async () => {
      await controller.flush();
      const current = controller.getSnapshot();
      if (!current.session.project || !current.settings) return;
      const hint = suggestBinding(selection.lineBefore, selection.text), time = new Date().toISOString();
      const binding: Binding = { id: crypto.randomUUID(), name: hint.name, category: hint.category, scope: 'project', scopeRef: current.session.project.id,
        description: '', aiReplacement: mode === 'ai' ? selection.text : defaults[hint.category], values: mode === 'ai' ? {} : { __default__: selection.text },
        escapeMode: 'auto', matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] }, createdAt: time, updatedAt: time, deviceId: current.settings.deviceId };
      if (mode === 'ai') {
        const start = template.indexOf(selection.text);
        if (start < 0 || template.indexOf(selection.text, start + 1) >= 0) throw new Error('Markera värdet i Mall-vyn så att rätt förekomst kan identifieras.');
        selection = { ...selection, start, end: start + selection.text.length };
      }
      setBindingDialog({ binding, selection });
    });
  }
  async function storeBinding(binding: Binding, all: boolean) {
    const selection = bindingDialog?.selection;
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
      await controller.flush(); const snapshot = await storage.exportAll();
      const locations = [...snapshot.versions, ...snapshot.drafts].filter(item => Object.values(item.templates).some(t => t.includes(`{{${binding.name}}}`)));
      if (!window.confirm(`Radera ${binding.name}? Används i ${locations.length} versioner/utkast. Berörda platshållare får saknade värden.`)) return;
      await storage.deleteBinding(binding.id); setBindings(await storage.listBindings());
    });
  }
  async function applyVersion(version: Version, save = false) {
    if (!window.confirm(`Använd v${version.number} i arbetsutkastet? Nuvarande utkast ersätts, men sparade versioner finns kvar.`)) return;
    await run(async () => { await controller.applyVersion(version); if (save) await controller.saveVersion(`Återgång till v${version.number}`); changeMode('template'); });
  }
  async function writeClipboard(text: string, which: 'local' | 'ai') {
    try { await navigator.clipboard.writeText(text); setCopyMode(null); setNotice(which === 'local' ? 'LOCAL kopierad · riktiga värden i urklippet' : 'AI-kod kopierad'); }
    catch { setError('Webbläsaren nekade urklippsåtkomst. Kontrollera sidans behörighet.'); }
  }
  async function copy(which: 'local' | 'ai') {
    if (!workspaceVisible || !template.trim() || busyRef.current) return;
    const result = render(template, bindings, { ...options, mode: which });
    if (result.issues.length) { setError('Kopiering blockerad. Åtgärda renderingsfelen i panelen.'); return; }
    if (which === 'ai' || result.secretRanges.length) { setCopyMode(which); return; }
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
      <span className="profile-badge">Profil: Standard</span><label className="theme-choice">Tema<select aria-label="Tema" value={theme} onChange={e => changeTheme(e.target.value as ThemeChoice)}><option value="system">System</option><option value="light">Ljust</option><option value="dark">Mörkt</option></select></label><span className={`save-state ${phase === 'error' ? 'danger-text' : ''}`} role="status">{saveStatus}</span></header>
    {state.error && <div className="persistence-error" role="alert"><strong>Fel vid sparning</strong><p>{state.error}</p><button onClick={() => { void controller.flush(true).catch(() => {}); }}>Försök spara igen</button></div>}
    {notice && <div className="inline-notice" role="status">{notice}<button aria-label="Stäng meddelande" onClick={() => setNotice('')}>×</button></div>}
    {updateReady && <div className="notice">Uppdatering tillgänglig <button onClick={() => void run(async () => { await controller.flush(); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); updateReady.waiting?.postMessage({ type: 'ACTIVATE' }); })}>Ladda om</button></div>}
    <main inert={busy}>
      <div className="workspace" hidden={!workspaceVisible}><section className="project-heading"><div className="project-identity"><span className="eyebrow">{project ? 'LOKALT ARBETSUTKAST' : 'BÖRJA DIREKT'}</span>
        {project ? <ProjectName key={session.key} name={session.name} change={name => controller.rename(name)} /> : <h1>Klistra in din kod</h1>}
        <div className="file-info"><label>Språk <select aria-label="Språk" value={language} onChange={e => controller.changeLanguage(e.target.value as LanguageId)}>{languages.map(l => <option key={l}>{l}</option>)}</select></label><span>{project?.files[0].name ?? 'Nytt projekt skapas när du börjar'}{session.baseVersionId && ` · baserad på v${versions.find(v => v.id === session.baseVersionId)?.number ?? '?'}`}</span></div>
      </div><div className="heading-actions">{!project && currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>Tillbaka till pågående projekt</button>}<button className="primary" disabled={busy || !template.trim()} onClick={() => void run(() => controller.saveVersion())}>Spara version</button></div></section>
        <div className="work-grid"><section className={`editor-panel mode-${mode}`}>
          <div className="editor-toolbar"><div className="view-tabs" role="tablist" aria-label="Kodvy">{(['template', 'local', 'ai'] as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => changeMode(m)}>{m === 'template' ? 'Mall' : m === 'local' ? 'Local' : 'AI'}</button>)}</div><div className="copy-actions"><button disabled={!template.trim() || Boolean(local.issues.length)} onClick={() => void copy('local')}>Copy Local</button><button className="ai-copy" disabled={!template.trim() || Boolean(ai.issues.length)} onClick={() => void copy('ai')}>Copy for AI ↗</button></div></div>
          <div className="view-banner" key={mode}><strong>{mode === 'template' ? '▤ MALL — KAN INNEHÅLLA KÄNSLIGA VÄRDEN' : mode === 'local' ? '⚠ LOCAL — INNEHÅLLER RIKTIGA VÄRDEN' : '◇ AI — SANERAD'}</strong><span>{mode === 'template' ? 'Redigerbar källa' : 'Skrivskyddad projektion'}</span></div>
          {mode === 'local' && <div className="local-tools"><button onClick={() => { setMode('template'); setFocusLine(currentLine.current); }}>Redigera som mall</button><button onClick={() => setShowSecrets(!showSecrets)}>{showSecrets ? 'Dölj secrets' : 'Visa secrets'}</button></div>}
          <div className="editor-body">{!template && mode === 'template' && <div className="paste-prompt" aria-hidden="true"><strong>Klistra in din kod här</strong><span>Ctrl+V · Projektet skapas automatiskt och sparas lokalt.</span></div>}
            <CodeEditor key="primary-editor" documentKey={`${session.key}:${mode}`} active={workspaceVisible} autoFocus value={visible} language={language} readOnly={busy || mode !== 'template'} onChange={text => controller.changeText(text)} onBinding={createBinding}
              onPlaceholder={name => { setFocusName(name); const b = resolveBinding(name, bindings, options.projectId, options.versionId); if (b) setBindingDialog({ binding: b }); }} theme={resolvedTheme} focusName={focusName} focusLine={focusLine} onLine={line => { currentLine.current = line; }} />
          </div><div className="editor-footer"><span>{visible.split('\n').length} rader · {used.length} bindings</span><span>{mode === 'local' ? 'Använd endast i din lokala kodmiljö' : 'Utkast sparas automatiskt · ingen kod körs'}</span></div>
        </section><aside className="binding-panel"><div className="panel-title"><h2>Bindings</h2><span className="count">{activeBindings.length}</span></div><p className="muted">Markera ett värde och tryck <kbd>Ctrl+B</kbd> för att koppla det till en platshållare.</p>
          {activeBindings.map(b => <div className="binding-card" key={b.id}><button className="binding-name" onClick={() => { setMode('template'); setFocusName(b.name); }}>{b.name}</button><div className="binding-meta"><span>{b.category}</span><span>{b.scope}</span></div><div className="binding-value">{resolveValue(b, options.profileId) ? b.category === 'secret' ? '••••••••' : 'Privat värde angivet' : <span className="danger-text">⚠ VÄRDE SAKNAS</span>}</div><div className="binding-example">AI: {b.aiReplacement}</div><div className="binding-actions"><small>{used.find(u => u.bindingName === b.name)?.occurrences ?? 0} förekomster</small><button className="text-button" onClick={() => setBindingDialog({ binding: b })}>Redigera</button><button className="text-button" aria-label={`Radera ${b.name}`} onClick={() => void removeBinding(b)}>×</button></div></div>)}
          {!activeBindings.length && <div className="bindings-empty">{'{{NAMN}}'}<p>Dina privata värden får en egen plats här.</p>{!template && language === 'powershell' && <button onClick={() => controller.changeText(fixture)}>Prova med exempelkod</button>}</div>}
          {issues.length > 0 && <div className="issue-panel" role="alert"><h3>{issues.length} renderingsproblem</h3>{issues.map((issue, i) => <p key={i}><b>{issue.name}</b><br />{issue.message}</p>)}</div>}
          <details className="version-history"><summary>Sparade versioner <span>{versions.length}</span></summary>{versions.map(v => <div className="version-item" key={v.id}><button onClick={() => void applyVersion(v)}><b>v{v.number}</b><span>{v.label || 'Sparad version'}<small>{new Date(v.createdAt).toLocaleDateString('sv-SE')}</small></span></button><button className="text-button" onClick={() => void applyVersion(v, true)}>Återgå som ny version</button></div>)}{!versions.length && <p>Utkastet sparas automatiskt. Spara en version när du vill behålla en punkt i historiken.</p>}</details>
          <div className="m1-note"><b>M1 · Kärnrundan</b><p>Full scanner, automatisk återmatchning och backup återstår. Använd testvärden tills backup finns.</p></div>
        </aside></div>
      </div>
      <div className="overview-scroll" ref={overview} hidden={route !== '#/projects'} onScroll={e => { if (route === '#/projects') overviewScroll.current = e.currentTarget.scrollTop; }}><section className="dashboard">
        <div className="dashboard-heading"><div><span className="eyebrow">DITT LOKALA VALV</span><h1>Alla projekt</h1><p>Ditt pågående arbete ligger kvar medan du letar.</p></div><div className="heading-actions">{currentId && <button onClick={() => void navigate(`#/project/${currentId}`)}>Tillbaka till pågående projekt</button>}<button className="primary" onClick={() => void navigate('#/')}>＋ Ny kod</button></div></div>
        <div className="search-wrap"><span>⌕</span><input aria-label="Sök i alla projekt" placeholder="Sök namn, tagg eller filnamn…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="section-title"><h2>Senast ändrade</h2><span>{filtered.length} projekt</span></div>
        <div className="project-cards">{filtered.map(p => <button className={`project-card ${p.id === currentId ? 'current-project' : ''}`} key={p.id} onClick={() => void navigate(`#/project/${p.id}`)}><div className="card-top"><span className="code-glyph">{'{ }'}</span><span className="language-pill">{p.language}</span></div><h3>{p.name}</h3><p>{p.files[0]?.name}</p><div className="card-footer"><span>{new Date(p.updatedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span><span>{p.id === currentId ? 'Pågående →' : 'Öppna →'}</span></div></button>)}</div>
        {!filtered.length && <p className="empty-project-list">{projects.length ? 'Inga projekt matchar sökningen.' : 'Inga projekt ännu. Välj Ny kod och klistra in för att börja.'}</p>}
      </section></div>
      <div hidden={route !== '#/security'}><Security /></div>
      <article className="document" hidden={route !== '#/settings'}><span className="eyebrow">DEN HÄR INSTALLATIONEN</span><h1>Inställningar</h1><p>Valvet delas inte mellan olika origin eller webbläsarprofiler.</p><dl><dt>Aktuellt origin</dt><dd>{location.origin}</dd><dt>App-sökväg</dt><dd>{location.pathname}</dd><dt>Enhets-ID</dt><dd>{settings?.deviceId}</dd><dt>Lagring</dt><dd>IndexedDB · lokal klartext</dd></dl><label>Enhetsnamn<input value={deviceName} onChange={e => setDeviceName(e.target.value)} /></label><button className="primary" onClick={() => void run(async () => { if (settings) { await storage.saveSettings({ ...settings, deviceName }); setNotice('Inställningar sparade lokalt'); } })}>Spara inställningar</button><p className="notice">Utkast sparas automatiskt på den här datorn. Det är ingen backup. Backup och återställning införs i M3.</p></article>
    </main><footer className="app-footer"><span>AI Code Vault · {__APP_VERSION__}</span><span>Lokalt valv · M1</span></footer>
  </div>
    {drawer && <ProjectBrowser projects={projects} currentId={currentId} query={query} onQuery={setQuery} close={() => setDrawer(false)} open={id => void navigate(`#/project/${id}`)} overview={() => void navigate('#/projects')} />}
    {bindingDialog && <BindingDialog initial={bindingDialog.binding} bindings={bindings} count={bindingDialog.selection ? template.split(bindingDialog.selection.text).length - 1 : 0} save={storeBinding} close={() => setBindingDialog(null)} />}
    {copyMode && <Modal title={copyMode === 'local' ? '⚠ Kopiera riktiga värden' : 'AI-export · granska före kopiering'} close={() => setCopyMode(null)}>{copyMode === 'local' ? <><p>Den lokala koden innehåller secrets. Kopiera den endast till din lokala kodmiljö, aldrig till en AI-chatt.</p><p className="notice">Urklippshistorik och molnsynk kan lagra eller överföra innehållet. Appen kontrollerar inte dessa funktioner.</p></> : <><p><b>{ai.issues.length ? 'Granskning krävs' : 'Inga kända problem hittades'}</b></p><p>{ai.used.length} ersatta förekomster. Kontroll av saknade bindings, stödd escaping och exakta kända privata värden har körts.</p><p className="notice">M1 saknar heuristisk scanner. Granska även kommentarer, nya värden och övrig kod.</p></>}<div className="dialog-actions"><button onClick={() => setCopyMode(null)}>Avbryt</button><button className={copyMode === 'local' ? 'danger' : 'primary'} onClick={() => { const result = render(template, bindings, { ...options, mode: copyMode }); if (!result.issues.length) void writeClipboard(result.text, copyMode); }}>{copyMode === 'local' ? 'Kopiera LOCAL med secrets' : 'Jag har granskat · kopiera för AI'}</button></div></Modal>}
    {error && <Modal title="Åtgärden behöver uppmärksamhet" close={() => setError('')}><p role="alert">{error}</p><div className="dialog-actions"><button className="primary" onClick={() => setError('')}>Stäng</button></div></Modal>}
  </div>;
}
