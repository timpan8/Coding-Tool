export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Monaco cannot read CSS custom properties, so the handful of colours it needs are mirrored here.
 * theme.test.ts parses styles.css and fails if either side drifts from the other. */
export const editorColors: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    'editor.background': '#ffffff',
    'editor.foreground': '#21364a',
    'editorLineNumber.foreground': '#5f7185',
    'editorLineNumber.activeForeground': '#526375',
    'editor.lineHighlightBackground': '#f0f4f7',
    'editor.selectionBackground': '#bedfd1',
    'editorCursor.foreground': '#126956',
  },
  dark: {
    'editor.background': '#16242f',
    'editor.foreground': '#d3e0e9',
    'editorLineNumber.foreground': '#91a4b3',
    'editorLineNumber.activeForeground': '#a3b5c2',
    'editor.lineHighlightBackground': '#1c2c38',
    'editor.selectionBackground': '#24523f',
    'editorCursor.foreground': '#70dec3',
  },
};

/** Token in styles.css whose value each editor colour must equal. Mostly the same role in both
 * themes, except the current-line highlight: it has to step away from the editor surface, which
 * means darker on light and lighter on dark. */
export const editorColorTokens: Record<ResolvedTheme, Record<keyof (typeof editorColors)['light'], string>> = {
  light: {
    'editor.background': 'surface',
    'editor.foreground': 'text',
    'editorLineNumber.foreground': 'text-faint',
    'editorLineNumber.activeForeground': 'text-muted',
    'editor.lineHighlightBackground': 'surface-sunken',
    'editor.selectionBackground': 'accent-border',
    'editorCursor.foreground': 'accent',
  },
  dark: {
    'editor.background': 'surface',
    'editor.foreground': 'text',
    'editorLineNumber.foreground': 'text-faint',
    'editorLineNumber.activeForeground': 'text-muted',
    'editor.lineHighlightBackground': 'surface-raised',
    'editor.selectionBackground': 'accent-border',
    'editorCursor.foreground': 'accent-bright',
  },
};

export const themeName = (theme: ResolvedTheme) => (theme === 'dark' ? 'vault-dark' : 'vault');

const media = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export const systemPrefersDark = () => media()?.matches ?? false;

export function resolveTheme(choice: ThemeChoice, systemDark = systemPrefersDark()): ResolvedTheme {
  if (choice !== 'system') return choice;
  return systemDark ? 'dark' : 'light';
}

/** Applied to <html>. The choice is also mirrored to localStorage purely so the first paint after a
 * reload is not the wrong colour: IndexedDB is async, and the vault remains the source of truth. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem('acv:theme', choice);
  } catch {
    /* Private mode or blocked site data; the vault still holds the choice. */
  }
}

export function paintHint(): ThemeChoice {
  try {
    const stored = localStorage.getItem('acv:theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* Unreadable storage just means the system setting decides. */
  }
  return 'system';
}

export function watchSystemTheme(listener: (dark: boolean) => void): () => void {
  const query = media();
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  query?.addEventListener('change', handler);
  return () => query?.removeEventListener('change', handler);
}
