import { useEffect, useMemo, useState } from 'react';
import type { Binding, Project } from '../../types/models';
import type { StorageProvider } from '../../storage/StorageProvider';
import { resolveValue } from '../../domain/bindings';
import { t } from '../text';

export interface BindingUse {
  /** How many saved versions across the whole vault still contain the placeholder. */
  versions: number;
  /** The project a project- or version-scoped binding belongs to, by name. */
  owner: string;
}

/** Reads usage across the whole vault, not only the open project — the point of this page is the
 * bindings you cannot see from where you are standing. */
export function useBindingUses(storage: StorageProvider, projects: Project[], active: boolean) {
  const [uses, setUses] = useState<Record<string, BindingUse>>({});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void (async () => {
      const all = await storage.exportAll();
      if (!alive) return;
      const names = new Map<string, number>();
      for (const version of all.versions) {
        for (const use of version.bindingUsage) {
          if (use.occurrences > 0) names.set(use.bindingName, (names.get(use.bindingName) ?? 0) + 1);
        }
      }
      const byId = new Map(projects.map((p) => [p.id, p.name]));
      const versionOwner = new Map(all.versions.map((v) => [v.id, byId.get(v.projectId) ?? t.bindingsPage.ownerUnknown]));
      const next: Record<string, BindingUse> = {};
      for (const binding of all.bindings) {
        next[binding.id] = {
          versions: names.get(binding.name) ?? 0,
          owner:
            binding.scope === 'global' ? t.bindingsPage.ownerGlobal
              : binding.scope === 'project' ? (byId.get(binding.scopeRef ?? '') ?? t.bindingsPage.ownerDeletedProject)
                : (versionOwner.get(binding.scopeRef ?? '') ?? t.bindingsPage.ownerDeletedVersion),
        };
      }
      setUses(next);
    })();
    return () => {
      alive = false;
    };
  }, [storage, projects, active]);
  return uses;
}

const scopeLabel = { global: t.bindingsPage.scopeGlobal, project: t.bindingsPage.scopeProject, version: t.bindingsPage.scopeVersion } as const;

/** Report F14. Bindings could only be reached through the project they belong to, so a global one —
 * the whole point of the global scope — was unreachable unless some project happened to use it, and
 * a value left behind by a deleted project was invisible rather than gone. */
export function BindingsPage({
  bindings,
  uses,
  profileId,
  onEdit,
  onDelete,
  onCreate,
}: {
  bindings: Binding[];
  uses: Record<string, BindingUse>;
  profileId: string | null;
  onEdit: (binding: Binding) => void;
  onDelete: (binding: Binding) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bindings
      .filter((b) => !scope || b.scope === scope)
      .filter((b) => !needle || b.name.toLowerCase().includes(needle) || b.description.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [bindings, query, scope]);

  const withoutValue = bindings.filter((b) => !resolveValue(b, profileId)).length;

  return (
    <section className="bindings-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t.project.vaultEyebrow}</span>
          <h1>{t.bindingsPage.title}</h1>
          <p>{t.bindingsPage.lead}</p>
        </div>
        <button className="primary" onClick={onCreate}>
          {t.bindingsPage.create}
        </button>
      </div>

      <div className="binding-filters">
        <label>
          {t.bindingsPage.search}
          <input
            aria-label={t.bindingsPage.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.bindingsPage.searchHint}
          />
        </label>
        <label>
          {t.bindingsPage.scope}
          <select aria-label={`Filtrera på ${t.bindingsPage.scope.toLowerCase()}`} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">{t.bindingsPage.scopeAll}</option>
            <option value="global">{t.bindingsPage.scopeGlobal}</option>
            <option value="project">{t.bindingsPage.scopeProject}</option>
            <option value="version">{t.bindingsPage.scopeVersion}</option>
          </select>
        </label>
        <span className="count">
          {t.bindingsPage.count(shown.length, bindings.length)}
          {withoutValue > 0 && t.bindingsPage.withoutValue(withoutValue)}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="empty-binding-list">
          {bindings.length ? t.bindingsPage.noMatch : t.bindingsPage.empty}
        </p>
      ) : (
        <table className="binding-table">
          <thead>
            <tr>
              <th scope="col">{t.bindingsPage.columnName}</th>
              <th scope="col">{t.bindingsPage.columnCategory}</th>
              <th scope="col">{t.bindingsPage.columnScope}</th>
              <th scope="col">{t.bindingsPage.columnValue}</th>
              <th scope="col">{t.bindingsPage.columnUsage}</th>
              <th scope="col">
                <span className="th-actions">{t.bindingsPage.columnActions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((binding) => {
              const use = uses[binding.id];
              const hasValue = Boolean(resolveValue(binding, profileId));
              return (
                <tr key={binding.id}>
                  <th scope="row">
                    <code>{binding.name}</code>
                    {binding.description && <small>{binding.description}</small>}
                  </th>
                  <td>{binding.category}</td>
                  <td>
                    {scopeLabel[binding.scope]}
                    <small>{use?.owner ?? '—'}</small>
                  </td>
                  <td className={hasValue ? '' : 'warn-text'}>{hasValue ? t.bindingsPage.valueSet : t.bindingsPage.valueMissing}</td>
                  <td>{use ? t.bindingsPage.usedIn(use.versions) : '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="text-button" onClick={() => onEdit(binding)}>
                        {t.bindingsPage.edit(binding.name)}
                      </button>
                      <button className="text-button danger-text" onClick={() => onDelete(binding)}>
                        {t.bindingsPage.remove(binding.name)}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
