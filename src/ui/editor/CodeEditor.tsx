import { useEffect, useRef } from 'react';
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { language as powershell } from 'monaco-editor/languages/definitions/powershell/powershell.js';
import { language as javascript } from 'monaco-editor/languages/definitions/javascript/javascript.js';
import { language as typescript } from 'monaco-editor/languages/definitions/typescript/typescript.js';
import { language as python } from 'monaco-editor/languages/definitions/python/python.js';
import { language as xml } from 'monaco-editor/languages/definitions/xml/xml.js';
import { language as yaml } from 'monaco-editor/languages/definitions/yaml/yaml.js';
import { language as shell } from 'monaco-editor/languages/definitions/shell/shell.js';
import type { LanguageId } from '../../types/models';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
for (const [id, language] of Object.entries({ powershell, javascript, typescript, python, xml, yaml, shell })) {
  monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, language);
}
monaco.languages.register({ id: 'json' });
monaco.languages.setMonarchTokensProvider('json', { tokenizer: { root: [[/"(?:[^"\\]|\\.)*"/, 'string'], [/\b(?:true|false|null)\b/, 'keyword'], [/-?\d+(?:\.\d+)?/, 'number']] } });
monaco.editor.defineTheme('vault', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#ffffff', 'editorLineNumber.foreground': '#728296', 'editor.lineHighlightBackground': '#f3f7fa' } });
export interface Selection { text: string; start: number; end: number; lineBefore: string; line: number }
interface Props {
  value: string; language: LanguageId; readOnly?: boolean; onChange?: (value: string) => void;
  onBinding?: (selection: Selection) => void; onPlaceholder?: (name: string) => void;
  focusName?: string; focusLine?: number; onLine?: (line: number) => void;
}
export function CodeEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const updating = useRef(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    const model = monaco.editor.createModel(callbacks.current.value, callbacks.current.language);
    const instance = monaco.editor.create(host.current!, { model, theme: 'vault', automaticLayout: true,
      readOnly: callbacks.current.readOnly, minimap: { enabled: false }, fontSize: 14, lineHeight: 23,
      scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 16 }, contextmenu: true,
      links: false, hover: { enabled: 'off' }, unicodeHighlight: { ambiguousCharacters: false },
      quickSuggestions: false, parameterHints: { enabled: false }, renderValidationDecorations: 'off',
      ariaLabel: 'Kodredigerare', accessibilitySupport: 'auto' });
    editor.current = instance;
    const decorations = instance.createDecorationsCollection();
    const decorate = () => {
      decorations.set(model.findMatches('\\{\\{[A-Z][A-Z0-9_]{1,63}\\}\\}', false, true, false, null, false).map(match => ({ range: match.range, options: { inlineClassName: 'binding-chip' } })));
    };
    const binding = () => {
      const selected = instance.getSelection();
      if (!selected || selected.isEmpty()) return;
      callbacks.current.onBinding?.({ text: model.getValueInRange(selected), start: model.getOffsetAt(selected.getStartPosition()),
        end: model.getOffsetAt(selected.getEndPosition()), lineBefore: model.getLineContent(selected.startLineNumber).slice(0, selected.startColumn - 1), line: selected.startLineNumber });
    };
    const action = instance.addAction({ id: 'create-binding', label: 'Skapa binding', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB], contextMenuGroupId: 'vault', run: binding });
    const change = model.onDidChangeContent(() => { decorate(); if (!updating.current && !instance.getOption(monaco.editor.EditorOption.readOnly)) callbacks.current.onChange?.(model.getValue()); });
    const line = instance.onDidChangeCursorPosition(e => callbacks.current.onLine?.(e.position.lineNumber));
    const mouse = instance.onMouseDown(e => {
      const position = e.target.position;
      if (!position) return;
      const matches = model.findMatches('\\{\\{([A-Z][A-Z0-9_]{1,63})\\}\\}', false, true, false, null, true);
      const match = matches.find(m => m.range.containsPosition(position));
      if (match?.matches) callbacks.current.onPlaceholder?.(match.matches[1]);
    });
    decorate();
    return () => { action.dispose(); change.dispose(); line.dispose(); mouse.dispose(); instance.dispose(); model.dispose(); editor.current = null; };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    instance.updateOptions({ readOnly: props.readOnly });
    const model = instance.getModel()!;
    if (model.getValue() !== props.value) { updating.current = true; try { model.setValue(props.value); } finally { updating.current = false; } }
    if (model.getLanguageId() !== props.language) monaco.editor.setModelLanguage(model, props.language);
  }, [props.value, props.language, props.readOnly]);
  useEffect(() => {
    if (!props.focusName || !editor.current) return;
    const model = editor.current.getModel()!;
    const matches = model.findMatches(`{{${props.focusName}}}`, false, false, true, null, false);
    if (matches.length) { editor.current.setSelections(matches.map(m => new monaco.Selection(m.range.startLineNumber, m.range.startColumn, m.range.endLineNumber, m.range.endColumn))); editor.current.revealLineInCenter(matches[0].range.startLineNumber); }
  }, [props.focusName, props.value]);
  useEffect(() => { if (props.focusLine) { editor.current?.revealLineInCenter(props.focusLine); editor.current?.setPosition({ lineNumber: props.focusLine, column: 1 }); } }, [props.focusLine]);
  return <div className="code-editor" ref={host} />;
}
