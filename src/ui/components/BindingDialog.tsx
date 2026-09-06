import { useState } from 'react';
import type { Binding, Category, Profile } from '../../types/models';
import { t } from '../text';
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
    if (vagueSecret && !acknowledged) { setError(t.bindingDialog.acknowledgeFirst); return; }
    setBusy(true);
    try { await save(value, all); close(); } catch { setError(t.bindingDialog.saveFailed); } finally { setBusy(false); }
  }
  return <Modal title={existing ? 'Redigera binding' : 'Skapa binding'} close={close}>
    <div className="form-grid">
      <label>{t.bindingDialog.name}<input aria-label={t.bindingDialog.nameLabel} value={value.name} onChange={e => setValue({ ...value, name: e.target.value.toUpperCase() })} autoFocus />{existing && value.name !== initial.name && <small>{t.bindingDialog.renameNote}</small>}</label>
      <label>{t.bindingDialog.category}<select value={value.category} onChange={e => { const category = e.target.value as Category; setValue({ ...value, category, aiReplacement: existing ? value.aiReplacement : defaults[category] }); }}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>{t.bindingDialog.scope}<select value={value.scope} onChange={e => setValue({ ...value, scope: e.target.value as Binding['scope'], scopeRef: e.target.value === 'global' ? null : initial.scopeRef })} disabled={existing || initial.scope === 'version'}><option value="project">{t.bindingDialog.scopeProject}</option><option value="global">{t.bindingDialog.scopeGlobal}</option>{initial.scope === 'version' && <option value="version">{t.bindingDialog.scopeVersion}</option>}</select></label>
      <label>{t.bindingDialog.aiValue}<input value={value.aiReplacement} onChange={e => setValue({ ...value, aiReplacement: e.target.value })} spellCheck={false} autoComplete="off" /></label>
      <label className="wide">{t.bindingDialog.defaultValue}<input type={show ? 'text' : 'password'} value={value.values.__default__ ?? ''} onChange={e => setValue({ ...value, values: { ...value.values, __default__: e.target.value } })} autoComplete="off" spellCheck={false} /></label>
      <label className="check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />{t.bindingDialog.showValue}</label>
      {profiles?.map(profile => <label className="wide" key={profile.id}>{t.bindingDialog.profileValue(profile.name)}<input type={show ? 'text' : 'password'} aria-label={t.bindingDialog.profileValue(profile.name)} value={value.values[profile.id] ?? ''} autoComplete="off" spellCheck={false}
        onChange={e => { const values = { ...value.values }; if (e.target.value) values[profile.id] = e.target.value; else delete values[profile.id]; setValue({ ...value, values }); }} /><small>{t.bindingDialog.emptyMeansDefault}</small></label>)}
      <label className="check"><input type="checkbox" checked={value.escapeMode === 'raw'} onChange={e => setValue({ ...value, escapeMode: e.target.checked ? 'raw' : 'auto' })} />{t.bindingDialog.raw}</label>
      <label className="wide">{t.bindingDialog.description}<input value={value.description} onChange={e => setValue({ ...value, description: e.target.value })} /></label>
    </div>
    {value.escapeMode === 'raw' && <p className="inline-warning" role="status">{t.bindingDialog.rawNote}</p>}
    {vagueSecret && <label className="check inline-warning"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />{t.bindingDialog.vagueBefore}<code>&lt;PASSWORD&gt;</code>{t.bindingDialog.vagueAfter}</label>}
    {count > 0 && <label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />{t.bindingDialog.replaceAll(count)}</label>}
    {preview && <div className="binding-preview"><code className="before">{preview.before}</code><code className="after">{preview.after}</code></div>}
    <p className="muted">{t.bindingDialog.lead}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="dialog-actions"><button onClick={close}>{t.dialog.cancel}</button><button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? t.bindingDialog.saving : t.bindingDialog.save}</button></div>
  </Modal>;
}
