import { useEffect, useRef } from 'react';
import type { Project } from '../../types/models';
import { t } from '../text';

export function projectMatches(project: Project, query: string) {
  return `${project.name} ${project.tags.join(' ')} ${project.files.map(f => f.name).join(' ')}`.toLocaleLowerCase('sv').includes(query.toLocaleLowerCase('sv'));
}
export function ProjectBrowser({ projects, currentId, query, onQuery, open, close, overview }: {
  projects: Project[]; currentId: string | null; query: string; onQuery: (query: string) => void;
  open: (id: string) => void; close: () => void; overview: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null);
  useEffect(() => { dialog.current?.showModal(); search.current?.focus(); }, []);
  const filtered = projects.filter(p => projectMatches(p, query));
  return <dialog ref={dialog} className="project-drawer" aria-label="Mina projekt" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="dialog-head"><h2>{t.drawer.title}</h2><button aria-label={t.drawer.close} onClick={close}>×</button></header>
    <label>{t.drawer.search}<input ref={search} value={query} onChange={e => onQuery(e.target.value)} placeholder={t.drawer.searchHint} /></label>
    <div className="drawer-projects">{filtered.map(p => <button className={p.id === currentId ? 'drawer-project current' : 'drawer-project'} key={p.id} onClick={() => open(p.id)}>
      <strong>{p.name}</strong><span>{p.id === currentId ? t.drawer.currentPrefix : ''}{new Date(p.updatedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
    </button>)}{!filtered.length && <p>{projects.length ? t.drawer.noMatch : t.drawer.empty}</p>}</div>
    <button className="primary" onClick={overview}>{t.drawer.seeAll}</button>
  </dialog>;
}
