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
  onLine?: (line: number) => void;
  theme?: ResolvedTheme;
  substitutions?: { start: number; end: number; name: string }[];
  fontSize?: number;
  wordWrap?: boolean;
}
