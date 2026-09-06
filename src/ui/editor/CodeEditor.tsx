import { useEffect, useRef } from 'react';
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { language as powershell } from 'monaco-editor/languages/definitions/powershell/powershell.js';
import { language as javascript } from 'monaco-editor/languages/definitions/javascript/javascript.js';
import { language as typescript } from 'monaco-editor/languages/definitions/typescript/typescript.js';
import { language as python } from 'monaco-editor/languages/definitions/python/python.js';
import { language as xml } from 'monaco-editor/languages/definitions/xml/xml.js';
import { language as yaml } from 'monaco-editor/languages/definitions/yaml/yaml.js';
import { language as shell } from 'monaco-editor/languages/definitions/shell/shell.js';
import type { LanguageId } from '../../types/models';
import { editorColors, themeName, type ResolvedTheme } from '../theme';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
for (const [id, language] of Object.entries({ powershell, javascript, typescript, python, xml, yaml, shell })) {
  monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, language);
}
const languageIds = ['powershell', 'javascript', 'typescript', 'python', 'xml', 'yaml', 'shell', 'json', 'plaintext'];
monaco.languages.register({ id: 'json' });
monaco.languages.setMonarchTokensProvider('json', { tokenizer: { root: [[/"(?:[^"\\]|\\.)*"/, 'string'], [/\b(?:true|false|null)\b/, 'keyword'], [/-?\d+(?:\.\d+)?/, 'number']] } });
monaco.editor.defineTheme('vault', { base: 'vs', inherit: true, rules: [], colors: editorColors.light });
monaco.editor.defineTheme('vault-dark', { base: 'vs-dark', inherit: true, rules: [], colors: editorColors.dark });
export interface Selection { text: string; start: number; end: number; lineBefore: string; line: number }
interface Props {
  documentKey?: string; active?: boolean; autoFocus?: boolean;
  value: string; language: LanguageId; readOnly?: boolean; onChange?: (value: string) => void;
  onBinding?: (selection: Selection) => void; onPlaceholder?: (name: string) => void;
  describePlaceholder?: (name: string) => { category: string; aiReplacement: string; hasValue: boolean } | undefined;
  focusName?: string; focusLine?: number; onLine?: (line: number) => void; theme?: ResolvedTheme;
  /** Character ranges to mark as substituted. Empty in the template view, where the placeholders
   * are visible as themselves. */
  substitutions?: { start: number; end: number; name: string }[];
}
export function CodeEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const updating = useRef(false);
  const documents = useRef(new Map<string, { model: monaco.editor.ITextModel; view: monaco.editor.ICodeEditorViewState | null }>());
  const activeKey = useRef('');
  const callbacks = useRef(props);
  const decorateRef = useRef<(() => void) | null>(null);
  callbacks.current = props;
  useEffect(() => {
    const model = monaco.editor.createModel(callbacks.current.value, callbacks.current.language);
    activeKey.current = callbacks.current.documentKey ?? 'default';
    documents.current.set(activeKey.current, { model, view: null });
    const instance = monaco.editor.create(host.current!, { model, theme: themeName(callbacks.current.theme ?? 'light'), automaticLayout: true,
      readOnly: callbacks.current.readOnly, minimap: { enabled: false }, fontSize: 14, lineHeight: 23,
      scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 16 }, contextmenu: true,
      links: false, hover: { enabled: 'on', delay: 250 }, unicodeHighlight: { ambiguousCharacters: false },
      quickSuggestions: false, parameterHints: { enabled: false }, renderValidationDecorations: 'off',
      ariaLabel: 'Kodredigerare', accessibilitySupport: 'auto' });
    editor.current = instance;
    const decorations = instance.createDecorationsCollection();
    const decorate = () => {
      const model = instance.getModel()!;
      const substitutions = callbacks.current.substitutions ?? [];
      if (substitutions.length) {
        decorations.set(substitutions.map(range => ({
          range: monaco.Range.fromPositions(model.getPositionAt(range.start), model.getPositionAt(range.end)),
          options: { inlineClassName: 'substituted-value', hoverMessage: { value: `Utbytt: **${range.name}**` } },
        })));
        return;
      }
      decorations.set(model.findMatches('\\{\\{[A-Z][A-Z0-9_]{1,63}\\}\\}', false, true, false, null, false).map(match => ({ range: match.range, options: { inlineClassName: 'binding-chip' } })));
    };
    const binding = () => {
      const model = instance.getModel()!;
      const selected = instance.getSelection();
      if (!selected || selected.isEmpty()) return;
      callbacks.current.onBinding?.({ text: model.getValueInRange(selected), start: model.getOffsetAt(selected.getStartPosition()),
        end: model.getOffsetAt(selected.getEndPosition()), lineBefore: model.getLineContent(selected.startLineNumber).slice(0, selected.startColumn - 1), line: selected.startLineNumber });
    };
    const action = instance.addAction({ id: 'create-binding', label: 'Skapa binding', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB], contextMenuGroupId: 'vault', run: binding });
    const change = instance.onDidChangeModelContent(() => { decorate(); if (!updating.current && !instance.getOption(monaco.editor.EditorOption.readOnly)) callbacks.current.onChange?.(instance.getValue()); });
    const modelChange = instance.onDidChangeModel(decorate);
    const line = instance.onDidChangeCursorPosition(e => callbacks.current.onLine?.(e.position.lineNumber));
    const placeholderAt = (position: monaco.Position) => {
      const matches = instance.getModel()!.findMatches('\\{\\{([A-Z][A-Z0-9_]{1,63})\\}\\}', false, true, false, null, true);
      return matches.find(m => m.range.containsPosition(position))?.matches?.[1];
    };
    // Opening the editor on a single click made it impossible to put the caret inside a placeholder,
    // and threw up a modal on a stray click while typing. A double click is the deliberate gesture.
    const mouse = instance.onMouseUp(e => {
      if (e.event.browserEvent.detail !== 2 || !e.target.position) return;
      const name = placeholderAt(e.target.position);
      if (name) callbacks.current.onPlaceholder?.(name);
    });
    // A single click should still tell you what is behind the placeholder, without opening anything
    // and without showing the private value: this is the view people screen-share.
    const hover = monaco.languages.registerHoverProvider(
      [...languageIds],
      {
        provideHover(model, position) {
          if (model !== instance.getModel()) return null;
          const name = placeholderAt(position);
          const info = name ? callbacks.current.describePlaceholder?.(name) : undefined;
          if (!name) return null;
          const lines = info
            ? [`**${name}** · ${info.category}`, info.aiReplacement ? `AI-värde: \`${info.aiReplacement}\`` : '', info.hasValue ? 'Privat värde är angivet.' : '⚠ Privat värde saknas.']
            : [`**${name}**`, '⚠ Ingen binding med det här namnet.'];
          return { contents: lines.filter(Boolean).map(value => ({ value })) };
        },
      },
    );
    decorateRef.current = decorate;
    decorate();
    if (callbacks.current.autoFocus) instance.focus();
    return () => { action.dispose(); change.dispose(); modelChange.dispose(); line.dispose(); mouse.dispose(); hover.dispose(); instance.dispose(); documents.current.forEach(d => d.model.dispose()); documents.current.clear(); editor.current = null; };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    instance.updateOptions({ readOnly: props.readOnly });
    const key = props.documentKey ?? 'default';
    const switched = activeKey.current !== key;
    if (switched) {
      const old = documents.current.get(activeKey.current);
      if (old) old.view = instance.saveViewState();
      let next = documents.current.get(key);
      if (!next) { next = { model: monaco.editor.createModel(props.value, props.language), view: null }; documents.current.set(key, next); }
      // The map was unbounded and only cleared on unmount. Bounded by projects × views before
      // multiple files existed; now projects × files × views, which grows without limit in a long
      // session. Map preserves insertion order, so the oldest entry that is not in use is evicted.
      activeKey.current = key;
      while (documents.current.size > 12) {
        const oldest = [...documents.current.keys()].find(k => k !== key);
        if (!oldest) break;
        documents.current.get(oldest)?.model.dispose();
        documents.current.delete(oldest);
      }
      documents.current.delete(key); documents.current.set(key, next);
      instance.setModel(next.model);
      if (next.view) instance.restoreViewState(next.view);
      if (props.active) instance.focus();
    }
    const model = instance.getModel()!;
    if (model.getValue() !== props.value) {
      updating.current = true;
      try { model.pushStackElement(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text: props.value }], () => null); model.pushStackElement(); }
      finally { updating.current = false; }
    }
    if (model.getLanguageId() !== props.language) monaco.editor.setModelLanguage(model, props.language);
  }, [props.value, props.language, props.readOnly, props.documentKey, props.active]);
  useEffect(() => { monaco.editor.setTheme(themeName(props.theme ?? 'light')); }, [props.theme]);
  useEffect(() => { decorateRef.current?.(); }, [props.substitutions, props.value]);
  useEffect(() => { if (props.active) { editor.current?.layout(); if (props.autoFocus) editor.current?.focus(); } }, [props.active, props.autoFocus]);
  useEffect(() => {
    if (!props.focusName || !editor.current) return;
    const model = editor.current.getModel()!;
    const matches = model.findMatches(`{{${props.focusName}}}`, false, false, true, null, false);
    if (matches.length) { editor.current.setSelections(matches.map(m => new monaco.Selection(m.range.startLineNumber, m.range.startColumn, m.range.endLineNumber, m.range.endColumn))); editor.current.revealLineInCenter(matches[0].range.startLineNumber); }
  }, [props.focusName, props.value]);
  useEffect(() => { if (props.focusLine) { editor.current?.revealLineInCenter(props.focusLine); editor.current?.setPosition({ lineNumber: props.focusLine, column: 1 }); } }, [props.focusLine]);
  return <div className="code-editor" ref={host} />;
}
