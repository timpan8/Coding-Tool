import { useMemo, useState } from 'preact/hooks'
import { guard } from '@engine/guard'
import { kindFromBindingName } from '@engine/detectors'
import type { FieldRecord } from '@vault/model'
import { getSession, navigate, toast, useTick } from '../state'
import { insertSlot, layoutSegments, removeSlot, selectionInfo, type SlotLayout } from '../layout'
import { useShortcut } from '../keys'
import { Editor } from '../components/Editor'
import { Exits } from '../components/Exits'
import { FieldForm } from '../components/FieldForm'
import { FieldsPanel } from '../components/FieldsPanel'
import { Modal } from '../components/Modal'
import { PasteSheet } from '../components/PasteSheet'
import { Reveal } from '../components/Reveal'
import { VersionList } from '../components/VersionList'
import { kindLabel } from '../format'
import { t } from '@i18n/index'

export function ScriptView(props: { scriptId: string; versionId?: string }) {
  const tick = useTick()
  const session = getSession()
  const script = session.getScript(props.scriptId)
  const versions = script ? session.listVersions(script.id) : []
  const version = versions.find((v) => v.id === props.versionId) ?? versions[versions.length - 1]
  const fields = useMemo(() => session.fieldMap(), [tick])
  const layout = useMemo(() => (version ? layoutSegments(version.segments, fields) : { text: '', slots: [] }), [version, fields])
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [markOpen, setMarkOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [newVersion, setNewVersion] = useState<null | 'ai' | 'editor'>(null)
  const [pill, setPill] = useState<SlotLayout | null>(null)
  const [reveal, setReveal] = useState(false)

  const select = (id: string) => navigate({ view: 'script', scriptId: props.scriptId, versionId: id })

  useShortcut('ctrl+shift+n', () => setNewVersion('ai'), !newVersion)
  useShortcut('ctrl+shift+m', () => startMark(), !newVersion)
  useShortcut('alt+arrowup', () => {
    if (!version) return
    const i = versions.findIndex((v) => v.id === version.id)
    if (i < versions.length - 1) select(versions[i + 1]!.id)
  })
  useShortcut('alt+arrowdown', () => {
    if (!version) return
    const i = versions.findIndex((v) => v.id === version.id)
    if (i > 0) select(versions[i - 1]!.id)
  })

  if (!script || !version) {
    navigate({ view: 'scripts' })
    return null
  }

  const info = selection && selection.from !== selection.to ? selectionInfo(layout.text, selection.from, selection.to, script.language) : undefined

  const startMark = () => {
    if (!info) {
      toast(t('script.selectionRequired'), 'warn')
      return
    }
    if (layout.slots.some((s) => s.from < info.to && info.from < s.to)) {
      toast(t('script.selectionOverlaps'), 'warn')
      return
    }
    setMarkOpen(true)
  }

  const applyMark = async (field: FieldRecord) => {
    if (!info) return
    try {
      const segments = insertSlot(version.segments, fields, info.from, info.to, { fieldId: field.id, quote: info.quote, regex: info.regex })
      await session.updateVersion(version.id, { segments })
      toast(t('script.marked', { name: field.name }), 'ok')
    } catch (e) {
      toast(t('common.error', { message: e instanceof Error ? e.message : String(e) }), 'error')
    }
    setMarkOpen(false)
    setLinkOpen(false)
    setSelection(null)
  }

  const unmarkPill = async (slot: SlotLayout) => {
    const segments = removeSlot(version.segments, fields, slot.segmentIndex)
    await session.updateVersion(version.id, { segments })
    setPill(null)
  }

  const onCopyText = (selected: string): string | null => {
    const snap = session.snapshot(script.id)
    const r = guard({ text: selected, fields: snap.all, real: snap.real, retired: snap.retired, allowlist: snap.allowlist, ns: snap.ns, language: script.language })
    if (r.blocked) {
      toast(t('exit.copyForAiBlocked', { n: r.findings.length }), 'error')
      return null
    }
    return selected
  }

  const usedIds = new Set(layout.slots.map((s) => s.fieldId))
  const pillField = pill ? session.getField(pill.fieldId) : undefined
  const pillReal = pill ? session.realValue(pill.fieldId) : undefined

  return (
    <div class="cv-script">
      <aside class="cv-col cv-col-left">
        <VersionList script={script} versions={versions} selectedId={version.id} onSelect={select} />
      </aside>
      <section class="cv-col cv-col-main">
        <div class="cv-toolbar">
          <div class="cv-toolbar-title">
            <h2>{script.title}</h2>
            <span class="cv-muted">
              v{version.seq} · {t('script.lines', { n: layout.text.split('\n').length })} · {script.language}
            </span>
          </div>
          <div class="cv-toolbar-actions">
            <button type="button" class="cv-btn cv-btn-primary" onClick={() => setNewVersion('ai')} title="Ctrl+Shift+N">
              {t('script.newVersion')}
            </button>
            <button type="button" class="cv-btn" onClick={() => setNewVersion('editor')}>
              {t('script.importEditor')}
            </button>
            <button type="button" class="cv-btn" onClick={startMark} title={t('script.markHint')}>
              {t('script.mark')}
            </button>
          </div>
        </div>
        <Exits script={script} version={version} />
        <Editor
          text={layout.text}
          slots={layout.slots}
          fields={fields}
          language={script.language}
          onSelectionChange={(from, to) => setSelection({ from, to })}
          onPillClick={(slot) => {
            setReveal(false)
            setPill(slot)
          }}
          onCopyText={onCopyText}
        />
      </section>
      <aside class="cv-col cv-col-right">
        <FieldsPanel usedIds={usedIds} scriptId={script.id} />
      </aside>

      {newVersion && (
        <Modal title={t('paste.title')} onClose={() => setNewVersion(null)} wide>
          <PasteSheet
            scriptId={script.id}
            initialMode={newVersion}
            onDone={(sid, vid) => {
              setNewVersion(null)
              navigate({ view: 'script', scriptId: sid, versionId: vid })
            }}
            onCancel={() => setNewVersion(null)}
          />
        </Modal>
      )}

      {markOpen && info && (
        <Modal title={t('script.mark')} onClose={() => setMarkOpen(false)}>
          <p class="cv-muted">
            <code>{info.logical.length > 80 ? info.logical.slice(0, 80) + '…' : info.logical}</code> · {info.quote}
            {info.bindingName ? ` · ${info.bindingName}` : ''}
          </p>
          <div class="cv-actions">
            <button type="button" class="cv-btn cv-btn-small" onClick={() => setLinkOpen(true)}>
              {t('paste.linkField')}
            </button>
          </div>
          <FieldForm
            scriptId={script.id}
            initial={{
              kind: (info.bindingName ? kindFromBindingName(info.bindingName) : undefined) ?? 'custom',
              ...(info.bindingName ? { bindingName: info.bindingName } : {}),
            }}
            onDone={(f) => void applyMark(f)}
            onLink={(f) => void applyMark(f)}
            onCancel={() => setMarkOpen(false)}
          />
        </Modal>
      )}

      {linkOpen && (
        <Modal title={t('paste.linkField')} onClose={() => setLinkOpen(false)}>
          <ul class="cv-list cv-list-compact">
            {session.listFields().map((f) => (
              <li key={f.id}>
                <button type="button" class="cv-btn cv-btn-block" onClick={() => void applyMark(f)}>
                  <strong>{f.name}</strong> <span class="cv-muted">{kindLabel(f.kind)} · {f.example}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {pill && (
        <Modal title={pillField?.name ?? '?'} onClose={() => setPill(null)}>
          <p>
            <span class="cv-chip">{pillField ? kindLabel(pillField.kind) : '?'}</span> <code>{pillField?.example}</code> · {t('common.line', { n: layout.text.slice(0, pill.from).split('\n').length })}
          </p>
          <div class="cv-field-real" onContextMenu={(e) => e.preventDefault()}>
            {pillReal === undefined ? (
              <span class="cv-warn">{t('field.noReal')}</span>
            ) : reveal ? (
              <Reveal value={pillReal} onDone={() => setReveal(false)} />
            ) : (
              <button type="button" class="cv-btn cv-btn-small" onClick={() => setReveal(true)}>
                {t('field.reveal')}
              </button>
            )}
          </div>
          <div class="cv-actions">
            <button type="button" class="cv-btn cv-btn-ghost" onClick={() => void unmarkPill(pill)}>
              {t('script.unmarkPill')}
            </button>
            <button type="button" class="cv-btn" onClick={() => setPill(null)}>
              {t('common.close')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
