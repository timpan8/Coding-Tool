import { useEffect, useState } from 'react';
import type { Project } from '../../types/models';
import { languages } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { projectMatches } from './ProjectBrowser';

export type SortKey = 'updated' | 'created' | 'name';

/** Counts that make a card worth reading. Loaded once per visit rather than per card, because the
 * list is the one place where "which project was that?" has to be answerable at a glance. */
export interface ProjectFacts {
  versions: number;
  bindings: number;
  missingValues: number;
}

export function useProjectFacts(storage: StorageProvider, projects: Project[], active: boolean) {
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void (async () => {
      const all = await storage.exportAll();
      if (!alive) return;
      const next: Record<string, ProjectFacts> = {};
      for (const project of projects) {
        const scoped = all.bindings.filter((b) => b.scope === 'project' && b.scopeRef === project.id);
        next[project.id] = {
          versions: all.versions.filter((v) => v.projectId === project.id).length,
          bindings: scoped.length,
          missingValues: scoped.filter((b) => !Object.values(b.values).some(Boolean)).length,
        };
      }
      setFacts(next);
    })();
    return () => {
      alive = false;
    };
  }, [storage, projects, active]);
  return facts;
}

export function sortProjects(projects: Project[], key: SortKey): Project[] {
  return [...projects].sort((a, b) =>
    key === 'name'
      ? a.name.localeCompare(b.name, 'sv')
      : key === 'created'
        ? b.createdAt.localeCompare(a.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
}

const statusLabel: Record<Project['status'], string> = {
  stable: 'Stabil',
  testing: 'Testas',
  experimental: 'Experiment',
  broken: 'Trasig',
  archived: 'Arkiverad',
};

export function ProjectFilters({
  query,
  onQuery,
  sort,
  onSort,
  language,
  onLanguage,
  status,
  onStatus,
  count,
}: {
  query: string;
  onQuery: (value: string) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  language: string;
  onLanguage: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  count: number;
}) {
  return (
    <>
      <div className="search-wrap">
        <span>⌕</span>
        <input
          aria-label="Sök i alla projekt"
          placeholder="Sök namn, tagg eller filnamn…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <div className="project-filters">
        <label>
          Sortera
          <select aria-label="Sortera" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
            <option value="updated">Senast ändrade</option>
            <option value="created">Senast skapade</option>
            <option value="name">Namn</option>
          </select>
        </label>
        <label>
          Språk
          <select aria-label="Filtrera på språk" value={language} onChange={(e) => onLanguage(e.target.value)}>
            <option value="">Alla</option>
            {languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select aria-label="Filtrera på status" value={status} onChange={(e) => onStatus(e.target.value)}>
            <option value="">Alla</option>
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="filter-count">{count} projekt</span>
      </div>
    </>
  );
}

export function filterProjects(projects: Project[], query: string, language: string, status: string): Project[] {
  return projects.filter(
    (p) =>
      projectMatches(p, query) && (!language || p.language === language) && (!status || p.status === status),
  );
}

export function ProjectCard({ project, facts, current, open }: { project: Project; facts?: ProjectFacts; current: boolean; open: () => void }) {
  return (
    <button className={`project-card ${current ? 'current-project' : ''}`} onClick={open}>
      <div className="card-top">
        <span className="code-glyph">{'{ }'}</span>
        <span className="language-pill">{project.language}</span>
      </div>
      <h3>{project.name}</h3>
      <p>{project.description || `${project.files.length} ${project.files.length === 1 ? 'fil' : 'filer'}`}</p>
      {project.tags.length > 0 && (
        <div className="card-tags">
          {project.tags.slice(0, 4).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      <div className="card-facts">
        <span>{facts?.versions ?? 0} versioner</span>
        <span>{facts?.bindings ?? 0} bindings</span>
        {Boolean(facts?.missingValues) && <span className="danger-text">⚠ {facts?.missingValues} utan värde</span>}
        <span className={`status-pill status-${project.status}`}>{statusLabel[project.status]}</span>
      </div>
      <div className="card-footer">
        <span>{new Date(project.updatedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <span>{current ? 'Pågående →' : 'Öppna →'}</span>
      </div>
    </button>
  );
}
