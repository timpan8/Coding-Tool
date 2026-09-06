import { useEffect, useRef } from 'react';
import type { EditorProps } from './props';

/** A textarea standing in for Monaco.
 *
 * Two jobs: it is what the page shows while the editor loads, which matters because Monaco is
 * almost the whole bundle; and it is the editor on a narrow screen, where Monaco has no touch
 * selection handles and its own scrolling fights the page's. It supports the parts of the interface
 * that carry meaning — text, read-only, selection for Ctrl+B — and quietly ignores decorations,
 * hovers and completion, which have nowhere to go here. */
export function PlainEditor({ value, readOnly, autoFocus, onChange, onBinding, focusLine, onLine, fontSize, wordWrap, onSelectionChange }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && !readOnly) ref.current?.focus();
  }, [autoFocus, readOnly]);

  useEffect(() => {
    const area = ref.current;
    if (!area || !focusLine) return;
    const offset = area.value.split('\n').slice(0, focusLine - 1).join('\n').length;
    area.focus();
    area.setSelectionRange(offset, offset);
  }, [focusLine]);

  function selection() {
    const area = ref.current;
    if (!area || area.selectionStart === area.selectionEnd) return null;
    const start = area.selectionStart;
    const before = area.value.slice(0, start);
    return {
      text: area.value.slice(start, area.selectionEnd),
      start,
      end: area.selectionEnd,
      lineBefore: before.slice(before.lastIndexOf('\n') + 1),
      line: before.split('\n').length,
    };
  }

  return (
    <textarea
      ref={ref}
      className="plain-editor"
      aria-label="Kodredigerare"
      style={{ fontSize: `${fontSize ?? 14}px`, lineHeight: 1.65, whiteSpace: wordWrap === false ? 'pre' : 'pre-wrap' }}
      wrap={wordWrap === false ? 'off' : 'soft'}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          // An empty selection is reported too, so the workspace can say why nothing happened.
          onBinding?.(selection() ?? { text: '', start: 0, end: 0, lineBefore: '', line: 1 });
        }
      }}
      onSelect={(e) => {
        const area = e.currentTarget;
        onLine?.(area.value.slice(0, area.selectionStart).split('\n').length);
        onSelectionChange?.(selection());
      }}
    />
  );
}
