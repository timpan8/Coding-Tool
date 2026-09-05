import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IndexedDbProvider } from './storage/IndexedDbProvider';
import { App } from './ui/App';
import './ui/styles.css';
import { applyTheme, paintHint } from './ui/theme';

applyTheme(paintHint());
const storage = new IndexedDbProvider(`ai-code-vault:${location.pathname.replace(/index\.html$/, '').replace(/\/$/, '') || '/'}`);
createRoot(document.getElementById('root')!).render(<StrictMode><App storage={storage} /></StrictMode>);
