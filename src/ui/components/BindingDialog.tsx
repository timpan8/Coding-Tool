import { useState } from 'react';
import type { Binding, Category, Profile } from '../../types/models';
import { categories } from '../../types/models';
import { defaults, validateBinding } from '../../domain/bindings';
import { Modal } from './Modal';
export function BindingDialog({ initial, bindings, count, preview, profiles, save, close }: {
  initial: Binding; bindings: Binding[]; count: number; profiles?: Profile[];
  /** The line as it stands and as it will read, so replacing the wrong span is visible before it
   * happens rather than after. */
  preview?: { before: string; after: string };
  save: (binding: Binding, all: boolean) => Promise<void>; close: () => void;
}) {
  const [value, setValue] = useState(initial), [show, setShow] = useState(false), [all, setAll] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const existing = bindings.some(b => b.id === initial.id);
  // An AI value that is not obviously a placeholder is the one field that leaves the vault, so it
  // gets a check the user has to answer rather than a dialog they can dismiss by reflex.
  const vagueSecret = value.category === 'secret' && !/^<[A-Z_]+>$/.test(value.aiReplacement);
  async function submit() {
    const errors = validateBinding(value, bindings);
    if (errors.length) { setError(errors.join(' ')); return; }
    if (vagueSecret && !acknowledged) { setError('Bekräfta att AI-värdet är granskat innan du sparar.'); return; }
    setBusy(true);
    try { await save(value, all); close(); } catch { setError('Bindingen kunde inte sparas. Ändringarna finns kvar i dialogen.'); } finally { setBusy(false); }
  }
  return <Modal title={existing ? 'Redigera binding' : 'Skapa binding'} close={close}>
    <div className="form-grid">
      <label>Namn<input aria-label="Bindingnamn" value={value.name} onChange={e => setValue({ ...value, name: e.target.value.toUpperCase() })} autoFocus />{existing && value.name !== initial.name && <small>Platshållaren skrivs om i alla versioner och utkast som använder den.</small>}</label>
      <label>Kategori<select value={value.category} onChange={e => { const category = e.target.value as Category; setValue({ ...value, category, aiReplacement: existing ? value.aiReplacement : defaults[category] }); }}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Scope<select value={value.scope} onChange={e => setValue({ ...value, scope: e.target.value as Binding['scope'], scopeRef: e.target.value === 'global' ? null : initial.scopeRef })} disabled={existing || initial.scope === 'version'}><option value="project">Projekt</option><option value="global">Globalt</option>{initial.scope === 'version' && <option value="version">Version</option>}</select></label>
      <label>AI-värde<input value={value.aiReplacement} onChange={e => setValue({ ...value, aiReplacement: e.target.value })} spellCheck={false} autoComplete="off" /></label>
      <label className="wide">Privat värde · standard<input type={show ? 'text' : 'password'} value={value.values.__default__ ?? ''} onChange={e => setValue({ ...value, values: { ...value.values, __default__: e.target.value } })} autoComplete="off" spellCheck={false} /></label>
      <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />Visa privat värde</label>
      {profiles?.map(profile => <label className="wide" key={profile.id}>Privat värde · {profile.name}<input type={show ? 'text' : 'password'} aria-label={`Privat värde för ${profile.name}`} value={value.values[profile.id] ?? ''} autoComplete="off" spellCheck={false}
        onChange={e => { const values = { ...value.values }; if (e.target.value) values[profile.id] = e.target.value; else delete values[profile.id]; setValue({ ...value, values }); }} /><small>Tomt betyder att standardvärdet används.</small></label>)}
      <label className="check"><input type="checkbox" checked={value.escapeMode === 'raw'} onChange={e => setValue({ ...value, escapeMode: e.target.checked ? 'raw' : 'auto' })} />Raw · ingen escaping</label>
      <label className="wide">Beskrivning<input value={value.description} onChange={e => setValue({ ...value, description: e.target.value })} /></label>
    </div>
    {value.escapeMode === 'raw' && <p className="inline-warning" role="status">Raw stänger av escaping. Värdet läggs in ordagrant och kan ändra kodens syntax och betydelse.</p>}
    {vagueSecret && <label className="check inline-warning"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />AI-värdet ser inte ut som en tydlig platshållare, till exempel <code>&lt;PASSWORD&gt;</code>. Jag har granskat att det är ofarligt att dela.</label>}
    {count > 0 && <label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />Ersätt alla identiska förekomster i filen ({count} st)</label>}
    {preview && <div className="binding-preview"><code className="before">{preview.before}</code><code className="after">{preview.after}</code></div>}
    <p className="muted">Ange privata värden utan kodens escaping. Endast AI-värdet visas i den sanerade vyn.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="dialog-actions"><button onClick={close}>Avbryt</button><button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Sparar…' : 'Spara binding'}</button></div>
  </Modal>;
}
