import type { LanguageId } from '../../types/models';
import type { ResolvedTheme } from '../theme';

export interface Selection {
  text: string;
  start: number;
  end: number;
  lineBefore: string;
  line: number;
}

/** Shared by the Monaco editor and the plain textarea that stands in for it, so the workspace does
 * not have to know which one it has. */
export interface EditorProps {
  documentKey?: string;
  active?: boolean;
  autoFocus?: boolean;
  value: string;
  language: LanguageId;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onBinding?: (selection: Selection) => void;
  onPlaceholder?: (name: string) => void;
  describePlaceholder?: (name: string) => { category: string; aiReplacement: string; hasValue: boolean } | undefined;
  placeholderNames?: string[];
  focusName?: string;
  focusLine?: number;
  /** Select and reveal a span. A command like `focusName`: the nonce makes the same span
   * requestable twice, which `focusLine` never could. */
  focusRange?: { start: number; end: number; nonce: number };
  onLine?: (line: number) => void;
  theme?: ResolvedTheme;
  substitutions?: { start: number; end: number; name: string }[];
  /** Spans the review panel is pointing at: every candidate faintly, the one under the pointer
   * strongly. Drawn in the template view only; the projections have substitutions instead. */
  highlights?: { start: number; end: number; tone: 'candidate' | 'active' }[];
  fontSize?: number;
  wordWrap?: boolean;
  /** Fires whenever the selection changes, with null when it is empty. Lets the workspace offer to
   * copy a selection without reaching into the editor. */
  onSelectionChange?: (selection: Selection | null) => void;
  /** Fires once `focusName` has actually been revealed, so the caller can clear the request.
   * `focusName` is a command, not state: left standing it would be re-applied on every edit. */
  onFocused?: () => void;
}
