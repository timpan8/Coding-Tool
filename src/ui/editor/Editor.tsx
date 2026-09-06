import { lazy, Suspense, useEffect, useState } from 'react';
import { PlainEditor } from './PlainEditor';
import type { EditorProps } from './props';

export type { Selection } from './props';

/** Monaco is about nine tenths of the bundle, so it is fetched only once the page is up. Until it
 * arrives the plain textarea is shown, which means the workspace is usable immediately rather than
 * blank. */
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

const NARROW = '(max-width: 750px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => (typeof matchMedia === 'function' ? matchMedia(NARROW).matches : false));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(NARROW);
    const handler = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  return narrow;
}

export function Editor(props: EditorProps) {
  // On a narrow screen Monaco is not merely heavy: it has no touch selection handles and its own
  // scrolling fights the page's. The textarea is the better editor there, not a downgrade.
  if (useNarrow()) return <PlainEditor {...props} />;
  return (
    <Suspense fallback={<PlainEditor {...props} />}>
      <CodeEditor {...props} />
    </Suspense>
  );
}
