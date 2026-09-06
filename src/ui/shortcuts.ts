export interface Shortcut {
  id: 'projects' | 'copyAi' | 'copyLocal' | 'save' | 'help';
  keys: string[];
  label: string;
  /** Why the obvious key was not used, where that is not obvious. */
  note?: string;
}

/** The original bindings collided with things the browser owns.
 *
 * Ctrl+K focuses the search bar in Firefox, and Ctrl+Shift+C opens the element inspector in both
 * Chrome and Firefox — a shortcut that opens devtools instead of copying is worse than none. The
 * primary binding avoids the collision; the old one stays as an alias where it still works. */
export const shortcuts: Shortcut[] = [
  { id: 'projects', keys: ['Ctrl+P', 'Ctrl+K'], label: 'Mina projekt', note: 'Ctrl+K tas av sökfältet i Firefox.' },
  { id: 'copyAi', keys: ['Ctrl+Enter'], label: 'Copy for AI', note: 'Ctrl+Shift+C öppnar utvecklarverktygen i Chrome och Firefox.' },
  { id: 'copyLocal', keys: ['Ctrl+Shift+Enter'], label: 'Copy Local' },
  { id: 'save', keys: ['Ctrl+S'], label: 'Spara version' },
  { id: 'help', keys: ['Ctrl+/', '?'], label: 'Visa genvägar' },
];

/** The editor's own bindings. Listed rather than matched: Monaco registers these itself, and the
 * app must not intercept them. They were undiscoverable, which is what made the report record
 * Ctrl+H as missing — the widget it opens is there, nothing pointed at it. The plain editor on a
 * narrow screen has neither, so the overview says which are the editor's. */
export const editorShortcuts: { keys: string[]; label: string; note?: string }[] = [
  { keys: ['Ctrl+B'], label: 'Skapa binding', note: 'Markera ett värde i editorn först.' },
  { keys: ['Ctrl+F'], label: 'Sök i koden', note: 'Editorns egen sökruta, inte webbläsarens.' },
  { keys: ['Ctrl+H'], label: 'Sök och ersätt' },
  { keys: ['{{'], label: 'Föreslå platshållarnamn', note: 'Skriv två klammer så listas dina bindings.' },
  // Report A.2. Tab indents inside Monaco and never moves focus, so a keyboard user who tabbed in
  // could not tab out. The way out exists; it was listed nowhere, which is what made it a trap.
  { keys: ['Ctrl+M'], label: 'Låt Tab lämna editorn', note: 'Växlar mellan att Tab gör indrag och att Tab flyttar fokus vidare.' },
];

/** Matches a keyboard event against a shortcut. Kept away from the components so the bindings can
 * be read, listed and tested in one place. */
export function match(event: KeyboardEvent, id: Shortcut['id']): boolean {
  const meta = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  switch (id) {
    case 'projects':
      return meta && !event.shiftKey && !event.altKey && (key === 'p' || key === 'k');
    case 'copyAi':
      return meta && !event.shiftKey && key === 'enter';
    case 'copyLocal':
      return meta && event.shiftKey && key === 'enter';
    case 'save':
      return meta && !event.shiftKey && key === 's';
    case 'help':
      return (meta && key === '/') || (key === '?' && !meta);
    default:
      return false;
  }
}
