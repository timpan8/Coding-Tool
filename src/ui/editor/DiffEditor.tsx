import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution.js';
import type { LanguageId } from '../../types/models';
import { themeName, type ResolvedTheme } from '../theme';

/** Read-only side-by-side comparison. Shares the themes and language registrations that
 * CodeEditor sets up at module load, so this file only owns the diff widget itself. */
export function DiffEditor({
  original,
  modified,
  language,
  theme,
}: {
  original: string;
  modified: string;
  language: LanguageId;
  theme: ResolvedTheme;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);

  useEffect(() => {
    const instance = monaco.editor.createDiffEditor(host.current!, {
      theme: themeName(theme),
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 21,
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      ignoreTrimWhitespace: false,
    });
    editor.current = instance;
    models.current = {
      original: monaco.editor.createModel('', language),
      modified: monaco.editor.createModel('', language),
    };
    instance.setModel(models.current);
    return () => {
      instance.dispose();
      models.current?.original.dispose();
      models.current?.modified.dispose();
      models.current = null;
      editor.current = null;
    };
    // Created once; content, language and theme are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!models.current) return;
    if (models.current.original.getValue() !== original) models.current.original.setValue(original);
    if (models.current.modified.getValue() !== modified) models.current.modified.setValue(modified);
    monaco.editor.setModelLanguage(models.current.original, language);
    monaco.editor.setModelLanguage(models.current.modified, language);
  }, [original, modified, language]);

  useEffect(() => {
    monaco.editor.setTheme(themeName(theme));
  }, [theme]);

  return <div className="diff-editor" ref={host} />;
}
