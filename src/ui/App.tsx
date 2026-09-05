import { useCallback, useEffect, useRef, useState } from 'react';
import type { Binding, LanguageId, Project, Settings, Version } from '../types/models';
import { languages } from '../types/models';
import type { StorageProvider } from '../storage/StorageProvider';
import { resolveBinding, resolveValue, suggestBinding, defaults } from '../domain/bindings';
import { render, usage } from '../domain/render';
import { CodeEditor, type Selection } from './editor/CodeEditor';
import { BindingDialog } from './components/BindingDialog';
import { Modal } from './components/Modal';
import { Security } from './pages/Security';

const now = () => new Date().toISOString();
const fixture = '$username = "example.user"\n$password = "<PASSWORD>"\n$exportPath = "C:\\Temp\\Example"\n\n# Markera ett exempelvärde och tryck Ctrl+B.\nWrite-Output "Användare: $username"\n';
type Mode = 'template' | 'local' | 'ai';
export function App({ storage }: { storage: StorageProvider }) {
  const [route, setRoute] = useState(location.hash || '#/');
  const [projects, setProjects] = useState<Project[]>([]), [settings, setSettings] = useState<Settings | null>(null);
  const [project, setProject] = useState<Project | null>(null), [versions, setVersions] = useState<Version[]>([]), [version, setVersion] = useState<Version | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]), [template, setTemplate] = useState(''), [mode, setMode] = useState<Mode>('template');
  const [dirty, setDirty] = useState(false), [status, setStatus] = useState('Öppnar lokalt valv…'), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [create, setCreate] = useState(false), [name, setName] = useState(''), [language, setLanguage] = useState<LanguageId>('powershell');
  const [bindingDialog, setBindingDialog] = useState<{ binding: Binding; selection?: Selection } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false), [focusName, setFocusName] = useState(''), [focusLine, setFocusLine] = useState(1);
  const [copyMode, setCopyMode] = useState<'local' | 'ai' | null>(null), [busy, setBusy] = useState(false), [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const loadSequence = useRef(0), currentLine = useRef(1), search = useRef<HTMLInputElement>(null);
  const currentState = useRef({ dirty }); currentState.current = { dirty };
  const fail = useCallback(() => { setError('Lokal lagring misslyckades. Behåll fliken öppen och kopiera din mall till en lokal fil. M1 har ännu ingen backupfunktion.'); setStatus('Fel vid sparning'); }, []);
  const reload = useCallback(async () => { const [p, b, s] = await Promise.all([storage.listProjects(), storage.listBindings(), storage.getSettings()]); setProjects(p); setBindings(b); setSettings(s); }, [storage]);
  useEffect(() => { void reload().then(() => setStatus('Sparat lokalt')).catch(fail); }, [reload, fail]);
  useEffect(() => {
    const change = () => setRoute(location.hash || '#/');
    const unload = (e: BeforeUnloadEvent) => { if (currentState.current.dirty) { e.preventDefault(); } };
    window.addEventListener('hashchange', change); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => {
    const id = /^#\/project\/([a-f0-9-]+)$/.exec(route)?.[1];
    const seq = ++loadSequence.current;
    if (!id) return;
    void (async () => {
      const p = await storage.getProject(id);
      if (!p || seq !== loadSequence.current) return;
      const vs = await storage.listVersions(id), bs = await storage.listBindings();
      if (seq !== loadSequence.current) return;
      const v = vs.find(v => v.id === p.currentVersionId) ?? null;
      setProject(p); setVersions(vs); setVersion(v); setBindings(bs); setTemplate(v?.templates[p.files[0].id] ?? '');
      setMode('template'); setDirty(false); setShowSecrets(false); setStatus('Sparat lokalt');
    })().catch(fail);
  }, [route, storage, fail]);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(reg => {
      if (reg.waiting) setUpdateReady(reg);
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => { if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(reg); });
      });
    }).catch(() => setStatus('Offline-cache kunde inte aktiveras. Behåll appen öppen.'));
  }, []);
  const file = project?.files[0];
  const options = { language: file?.language ?? 'powershell' as LanguageId, projectId: project?.id ?? '', versionId: version?.id ?? null, profileId: settings?.activeProfileId ?? null };
  const ai = render(template, bindings, { ...options, mode: 'ai' });
  const local = render(template, bindings, { ...options, mode: 'local', maskSecrets: !showSecrets });
  const visible = mode === 'template' ? template : mode === 'ai' ? ai.text : local.text;
  const issues = mode === 'ai' ? ai.issues : local.issues;
  const used = usage(template);
  const activeBindings = bindings.filter(b => resolveBinding(b.name, bindings, options.projectId, options.versionId)?.id === b.id)
    .sort((a, b) => Number(Boolean(resolveValue(a, options.profileId))) - Number(Boolean(resolveValue(b, options.profileId))) || a.name.localeCompare(b.name));
  function navigate(hash: string) {
    if (dirty && hash !== route && !window.confirm('Du har osparade malländringar. Lämna dem utan att spara?')) return;
    if (hash !== route) { setDirty(false); location.hash = hash; }
  }
  function changeMode(next: Mode) { setMode(next); setShowSecrets(false); }
  function changeTemplate(next: string) { setTemplate(next); setDirty(true); setStatus('Osparade ändringar'); }
  async function createProject() {
    if (!name.trim() || !settings) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID(), time = now();
      const extension: Record<LanguageId, string> = { powershell: 'ps1', javascript: 'js', typescript: 'ts', python: 'py', json: 'json', xml: 'xml', yaml: 'yaml', shell: 'sh', plaintext: 'txt' };
      const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'projekt';
      const p: Project = { id, name: name.trim(), slug, description: '', language, tags: [], status: 'experimental',
        files: [{ id: crypto.randomUUID(), name: `${slug}.${extension[language]}`, language, order: 0 }],
        currentVersionId: null, paths: { rootOverride: null, subfolders: ['Input', 'Output', 'Logs'] }, notes: '', createdAt: time, updatedAt: time, deviceId: settings.deviceId };
      await storage.saveProject(p); await reload(); setCreate(false); setName(''); navigate(`#/project/${id}`);
    } catch { fail(); } finally { setBusy(false); }
  }
  async function saveVersion(content = template, label = '') {
    if (!project || !settings || !file) return;
    setBusy(true);
    try {
      const latest = await storage.listVersions(project.id), time = now(), id = crypto.randomUUID();
      const v: Version = { id, projectId: project.id, number: Math.max(0, ...latest.map(v => v.number)) + 1, label,
        parentVersionId: version?.id ?? null, branchName: 'main', status: 'experimental', notes: '',
        templates: { ...(version?.templates ?? {}), [file.id]: content }, bindingUsage: usage(content).map(u => ({ ...u, fileId: file.id })), createdAt: time, deviceId: settings.deviceId };
      const p = { ...project, currentVersionId: id, updatedAt: time };
      await storage.commitVersion(p, v); setProject(p); setVersion(v); setVersions([v, ...latest]); setTemplate(content); setDirty(false); setStatus('Sparat lokalt'); await reload();
    } catch { fail(); } finally { setBusy(false); }
  }
  function createBinding(selection: Selection) {
    if (!project || !settings || mode === 'local') return;
    if (!selection.text || /\{\{.*\}\}/.test(selection.text)) return;
    const hint = suggestBinding(selection.lineBefore, selection.text), time = now();
    const b: Binding = { id: crypto.randomUUID(), name: hint.name, category: hint.category, scope: 'project', scopeRef: project.id,
      description: '', aiReplacement: mode === 'ai' ? selection.text : defaults[hint.category],
      values: mode === 'ai' ? {} : { __default__: selection.text }, escapeMode: 'auto',
      matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] }, createdAt: time, updatedAt: time, deviceId: settings.deviceId };
    // AI selections refer to a projection; locate only uniquely identifiable literal template text.
    if (mode === 'ai') {
      const start = template.indexOf(selection.text);
      if (start < 0) { setError('Markeringen kommer från en befintlig binding. Öppna den i panelen för att redigera.'); return; }
      selection = { ...selection, start, end: start + selection.text.length };
    }
    setBindingDialog({ binding: b, selection });
  }
  async function storeBinding(binding: Binding, all: boolean) {
    const selection = bindingDialog?.selection;
    await storage.saveBinding({ ...binding, updatedAt: now() });
    setBindings(await storage.listBindings());
    if (selection) {
      if (template.slice(selection.start, selection.end) !== selection.text) { setError('Mallen har ändrats. Bindingen är sparad; placera dess platshållare manuellt.'); return; }
      const token = `{{${binding.name}}}`;
      const text = all ? template.split(/(\{\{[A-Z][A-Z0-9_]*\}\})/g).map((part, index) => index % 2 ? part : part.split(selection.text).join(token)).join('')
        : template.slice(0, selection.start) + token + template.slice(selection.end);
      changeTemplate(text); changeMode('template'); setFocusName(binding.name);
    }
    setStatus(selection ? 'Binding sparad lokalt · mall har osparade ändringar' : 'Binding sparad lokalt');
  }
  async function removeBinding(binding: Binding) {
    const allVersions = await storage.exportAll();
    const locations = allVersions.versions.flatMap(v => Object.entries(v.templates).filter(([, t]) => t.includes(`{{${binding.name}}}`)).map(([fileId]) => `v${v.number} · ${allVersions.projects.find(p => p.id === v.projectId)?.files.find(f => f.id === fileId)?.name ?? 'fil'}`));
    if (!window.confirm(`Radera ${binding.name}?\nAnvänds i ${locations.length} sparade filer${template.includes(`{{${binding.name}}}`) ? ' och aktuell mall' : ''}.\n${locations.slice(0, 10).join('\n')}\nBerörda platshållare får saknade värden.`)) return;
    try { await storage.deleteBinding(binding.id); setBindings(await storage.listBindings()); } catch { fail(); }
  }
  async function copy(which: 'local' | 'ai') {
    const result = render(template, bindings, { ...options, mode: which });
    if (result.issues.length) { setError('Kopiering blockerad. Åtgärda renderingsfelen i panelen.'); return; }
    if (which === 'local' && result.secretRanges.length) { setCopyMode('local'); return; }
    if (which === 'ai') { setCopyMode('ai'); return; }
    await writeClipboard(result.text, which);
  }
  async function writeClipboard(text: string, which: 'local' | 'ai') {
    try { await navigator.clipboard.writeText(text); setCopyMode(null); setStatus(which === 'local' ? 'LOCAL kopierad · riktiga värden i urklippet' : 'AI-kod kopierad'); }
    catch { setError('Webbläsaren nekade urklippsåtkomst. Kontrollera sidans behörighet. Ingen automatisk reservkopiering gjordes.'); }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('dialog[open]')) return;
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); }
      if (e.key.toLowerCase() === 'c' && e.shiftKey) { e.preventDefault(); if (project) void copy('ai'); }
      if (e.key.toLowerCase() === 'c' && e.altKey) { e.preventDefault(); if (project) void copy('local'); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const isProject = route.startsWith('#/project/');
  return <div className="app-shell">
    <aside className="rail"><a className="brand" href="#/" onClick={e => { e.preventDefault(); navigate('#/'); }}><span className="brand-icon">{'</>'}</span><span>AI Code Vault<small>LOKALT KODVALV</small></span></a>
      <nav><button className={!isProject && route === '#/' ? 'nav-active' : ''} onClick={() => navigate('#/')}>▦ &nbsp; Projekt</button><button onClick={() => navigate('#/security')}>◇ &nbsp; Säkerhet</button><button onClick={() => navigate('#/settings')}>⚙ &nbsp; Inställningar</button></nav>
      <div className="rail-label">SENASTE PROJEKT</div><div className="project-links">{projects.slice(0, 8).map(p => <button className={project?.id === p.id && isProject ? 'selected' : ''} key={p.id} onClick={() => navigate(`#/project/${p.id}`)}><span>⌑</span>{p.name}</button>)}</div>
      <div className="rail-bottom"><span className="local-dot" /> Lokalt i den här webbläsaren<p>Ingen AI-anslutning.<br />Ingen kod körs.</p></div>
    </aside>
    <div className="main-shell"><header className="topbar"><span className="breadcrumb">Mitt valv <span>/</span> {isProject ? project?.name ?? 'Projekt' : route.includes('security') ? 'Säkerhet' : route.includes('settings') ? 'Inställningar' : 'Projekt'}</span><span className="profile-badge">Profil: Standard</span><span className={status.startsWith('Fel') ? 'save-state danger-text' : 'save-state'} role="status">{status}</span></header>
      {updateReady && <div className="notice">Uppdatering tillgänglig <button onClick={() => { if (dirty && !window.confirm('Osparade ändringar försvinner vid omladdning. Fortsätta?')) return; updateReady.waiting?.postMessage({ type: 'ACTIVATE' }); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); }}>Ladda om</button></div>}
      <main inert={busy}>
        {route === '#/security' ? <Security /> : route === '#/settings' ? <article className="document"><span className="eyebrow">DEN HÄR INSTALLATIONEN</span><h1>Inställningar</h1><p>Välj ett primärt origin. Valvet delas inte mellan olika origin eller webbläsarprofiler.</p><dl><dt>Aktuellt origin</dt><dd>{location.origin}</dd><dt>App-sökväg</dt><dd>{location.pathname}</dd><dt>Enhets-ID</dt><dd>{settings?.deviceId}</dd><dt>Lagring</dt><dd>IndexedDB · lokal klartext</dd></dl><label>Enhetsnamn<input value={settings?.deviceName ?? ''} onChange={e => settings && setSettings({ ...settings, deviceName: e.target.value })} /></label><button className="primary" onClick={() => { if (settings) void storage.saveSettings(settings).then(() => setStatus('Sparat lokalt')).catch(fail); }}>Spara inställningar</button><p className="notice">Backup och datarensning införs i M3 tillsammans, för att minska risken för oåterkallelig förlust.</p></article>
        : isProject && project && file ? <div className="workspace"><section className="project-heading"><div><span className="eyebrow">PROJEKT</span><h1>{project.name}</h1><p>{file.name} <span className="dot-separator">·</span> {file.language} <span className="dot-separator">·</span> {version ? `Version ${version.number}` : 'Ny mall'}{dirty ? ' · osparad' : ''}</p></div><div className="heading-actions"><button onClick={() => { if (dirty && !window.confirm('Börja en tom mall? Osparade ändringar försvinner.')) return; changeTemplate(''); changeMode('template'); }}>Ny version</button><button className="primary" disabled={busy || !template.trim()} onClick={() => void saveVersion()}>Spara som v{Math.max(0, ...versions.map(v => v.number)) + 1}</button></div></section>
          <div className="work-grid"><aside className="file-panel"><h2>Filer <small>1</small></h2><div className="file-current">▤ {file.name}</div><h2>Versioner <small>{versions.length}</small></h2>{versions.length ? versions.map(v => <div className="version-item" key={v.id}><button className={v.id === version?.id ? 'current' : ''} onClick={() => { if (dirty && !window.confirm('Öppna versionen utan att spara dina ändringar?')) return; setVersion(v); setTemplate(v.templates[file.id] ?? ''); setDirty(false); setShowSecrets(false); }}><b>v{v.number}</b><span>{v.label || 'Sparad version'}<small>{new Date(v.createdAt).toLocaleDateString('sv-SE')}</small></span></button>{v.id !== version?.id && <button className="text-button" onClick={() => { if (window.confirm(`Skapa en ny version med innehållet från v${v.number}?`)) void saveVersion(v.templates[file.id] ?? '', `Återgång till v${v.number}`); }}>Återgå som ny</button>}</div>) : <p className="muted panel-note">Spara mallen för att skapa den första versionen.</p>}</aside>
            <section className={`editor-panel mode-${mode}`}><div className="editor-toolbar"><div className="view-tabs" role="tablist" aria-label="Kodvy">{(['template', 'local', 'ai'] as Mode[]).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => changeMode(m)}>{m === 'template' ? 'Mall' : m === 'local' ? 'Local' : 'AI'}</button>)}</div><div className="copy-actions"><button disabled={Boolean(local.issues.length)} onClick={() => void copy('local')}>Copy Local</button><button className="ai-copy" disabled={Boolean(ai.issues.length)} onClick={() => void copy('ai')}>Copy for AI ↗</button></div></div>
              <div className="view-banner" key={mode}><strong>{mode === 'template' ? '▤ MALL' : mode === 'local' ? '⚠ LOCAL — INNEHÅLLER RIKTIGA VÄRDEN' : '◇ AI — SANERAD'}</strong><span>{mode === 'template' ? 'Den enda redigerbara källan' : 'Skrivskyddad projektion'}</span></div>
              {mode === 'local' && <div className="local-tools"><button onClick={() => { setMode('template'); setFocusLine(currentLine.current); }}>Redigera som mall</button><button onClick={() => setShowSecrets(!showSecrets)}>{showSecrets ? 'Dölj secrets' : 'Visa secrets'}</button></div>}
              {!template && mode === 'template' && <div className="editor-empty"><b>Klistra in din kod här nedanför</b><span>Markera ett värde → Ctrl+B → ange privat värde och AI-exempel.</span>{file.language === 'powershell' && <button onClick={() => changeTemplate(fixture)}>Lägg in ofarlig exempelkod</button>}</div>}
              <CodeEditor value={visible} language={file.language} readOnly={busy || mode !== 'template'} onChange={changeTemplate} onBinding={createBinding} onPlaceholder={name => { setFocusName(name); const b = resolveBinding(name, bindings, project.id, version?.id ?? null); if (b) setBindingDialog({ binding: b }); }} focusName={focusName} focusLine={focusLine} onLine={line => { currentLine.current = line; }} />
              <div className="editor-footer"><span>{visible.split('\n').length} rader · {used.length} bindings</span><span>{mode === 'local' ? 'Kopiera endast till din lokala kodmiljö' : 'Ingen kod exekveras'}</span></div></section>
            <aside className="binding-panel"><div className="panel-title"><h2>Bindings</h2><span className="count">{activeBindings.length}</span></div><p className="muted">Markera text i editorn och tryck <kbd>Ctrl+B</kbd>.</p>{activeBindings.length ? activeBindings.map(b => <div className="binding-card" key={b.id}><button className="binding-name" onClick={() => { setMode('template'); setFocusName(b.name); }}>{b.name}</button><div className="binding-meta"><span>{b.category}</span><span>{b.scope}</span></div><div className="binding-value">{resolveValue(b, options.profileId) ? b.category === 'secret' ? '••••••••' : 'Privat värde angivet' : <span className="danger-text">⚠ VÄRDE SAKNAS</span>}</div><div className="binding-example">AI: {b.aiReplacement}</div><div className="binding-actions"><small>{used.find(u => u.bindingName === b.name)?.occurrences ?? 0} förekomster</small><button className="text-button" onClick={() => setBindingDialog({ binding: b })}>Redigera</button><button className="text-button" aria-label={`Radera ${b.name}`} onClick={() => void removeBinding(b)}>×</button></div></div>) : <div className="bindings-empty">{'{{NAMN}}'}<p>Dina privata värden får en egen plats här.</p></div>}
              {issues.length > 0 && <div className="issue-panel" role="alert"><h3>{issues.length} renderingsproblem</h3>{issues.map((issue, i) => <p key={i}><b>{issue.name}</b><br />{issue.message}</p>)}</div>}<div className="m1-note"><b>M1 · Kärnrundan</b><p>Scanner och automatisk matchning av AI-uppdateringar kommer i M2. Granska all text före kopiering.</p></div>
            </aside></div></div>
        : isProject ? <p className="loading">Öppnar projekt…</p> : <section className="dashboard"><div className="dashboard-heading"><div><span className="eyebrow">DITT LOKALA ARBETSBORD</span><h1>Projekt</h1><p>Kodmallar för AI. Riktiga värden för dig.</p></div><button className="primary" onClick={() => setCreate(true)}>＋ Skapa projekt</button></div><div className="search-wrap"><span>⌕</span><input ref={search} placeholder="Sök projekt, taggar, filnamn eller bindings…" aria-label="Sök projekt" value={query} onChange={e => setQuery(e.target.value)} /><kbd>Ctrl K</kbd></div><div className="section-title"><h2>Senaste projekt</h2><span>{projects.length} projekt i den här webbläsaren</span></div>
          {projects.length ? <div className="project-cards">{projects.filter(p => `${p.name} ${p.tags.join(' ')} ${p.files.map(f => f.name).join(' ')} ${bindings.filter(b => b.scopeRef === p.id || b.scope === 'global').map(b => b.name).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(p => <button className="project-card" key={p.id} onClick={() => navigate(`#/project/${p.id}`)}><div className="card-top"><span className="code-glyph">{'{ }'}</span><span className="language-pill">{p.language}</span></div><h3>{p.name}</h3><p>{p.files[0]?.name}</p><div className="card-footer"><span>{new Date(p.updatedAt).toLocaleDateString('sv-SE')}</span><span>Öppna →</span></div></button>)}</div> : <div className="empty-vault"><div className="empty-symbol">{'{{ }}'}</div><h2>Börja med en kodmall</h2><p>Skapa ett projekt, klistra in kod och koppla känsliga värden till platshållare. Växla sedan mellan Mall, Local och AI.</p><button className="primary" onClick={() => setCreate(true)}>Skapa ditt första projekt</button><div className="flow"><span>01 &nbsp; Klistra in kod</span><span>02 &nbsp; Skapa bindings</span><span>03 &nbsp; Kopiera rätt vy</span></div></div>}
          <div className="dashboard-note"><span>◇</span><div><b>GitHub hostar appen. Valvet finns här.</b><p>Inget konto och ingen AI-anslutning. M1 är en första testbar milstolpe; backup och full scanner är ännu inte tillgängliga.</p></div><button onClick={() => navigate('#/security')}>Läs säkerhetsgränserna →</button></div></section>}
      </main><footer className="app-footer"><span>AI Code Vault · {__APP_VERSION__}</span><span>Lokalt valv · M1</span></footer>
    </div>
    {create && <Modal title="Skapa projekt" close={() => setCreate(false)}><label>Projektnamn<input autoFocus placeholder="Create-ADUsers" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createProject(); }} /></label><label>Språk<select value={language} onChange={e => setLanguage(e.target.value as LanguageId)}>{languages.map(l => <option key={l}>{l}</option>)}</select></label><p className="muted">Projektet sparas i den här webbläsaren.</p><div className="dialog-actions"><button onClick={() => setCreate(false)}>Avbryt</button><button className="primary" disabled={busy || !settings || !name.trim()} onClick={() => void createProject()}>Skapa projekt</button></div></Modal>}
    {bindingDialog && <BindingDialog initial={bindingDialog.binding} bindings={bindings} count={bindingDialog.selection ? template.split(bindingDialog.selection.text).length - 1 : 0} save={storeBinding} close={() => setBindingDialog(null)} />}
    {copyMode && <Modal title={copyMode === 'local' ? '⚠ Kopiera riktiga värden' : 'AI-export · granska före kopiering'} close={() => setCopyMode(null)}>{copyMode === 'local' ? <><p>Den lokala koden innehåller secrets. Kopiera den endast till din lokala kodmiljö, aldrig till en AI-chatt.</p><p className="notice">Urklippshistorik och molnsynk kan lagra eller överföra innehållet. Appen kontrollerar inte dessa funktioner.</p></> : <><p><b>{ai.issues.length ? 'Granskning krävs' : 'Inga kända problem hittades'}</b></p><p>{ai.used.length} ersatta förekomster. Kontroll av saknade bindings, stödd escaping och exakta kända privata värden har körts.</p><p className="notice">M1 saknar heuristisk scanner. Granska även kommentarer, nya värden och övrig kod.</p></>}<div className="dialog-actions"><button onClick={() => setCopyMode(null)}>Avbryt</button><button className={copyMode === 'local' ? 'danger' : 'primary'} onClick={() => { const result = render(template, bindings, { ...options, mode: copyMode }); if (!result.issues.length) void writeClipboard(result.text, copyMode); }}>{copyMode === 'local' ? 'Kopiera LOCAL med secrets' : 'Jag har granskat · kopiera för AI'}</button></div></Modal>}
    {error && <Modal title="Åtgärden behöver uppmärksamhet" close={() => setError('')}><p role="alert">{error}</p><div className="dialog-actions"><button className="primary" onClick={() => setError('')}>Stäng</button></div></Modal>}
  </div>;
}
