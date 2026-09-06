import type { WorkspaceSnapshot } from '../../types/models';
import { validateBinding } from '../bindings';
import { redact, snapshotSchema, SNAPSHOT_VERSION, type PrivatePayload, type Snapshot, type SnapshotKind } from './schema';

export { SNAPSHOT_VERSION, type Snapshot, type SnapshotKind };

export interface AppIdentity {
  version: string;
  deviceId: string;
  deviceName: string;
}
export type EntityKind = 'projekt' | 'version' | 'utkast' | 'binding' | 'profil' | 'dataset' | 'regel' | 'blocklistterm';
/** The kinds an import can keep both copies of. A duplicate needs a fresh id that nothing else
 * points at, and only these two have one: a project carries its own name, a binding its own
 * placeholder. A version is numbered within its project and pointed at by `currentVersionId`; a
 * draft is keyed by its project; a profile's values live inside the bindings that key them by its
 * id; a dataset belongs to a project by id; a rule copied twice reports every finding twice. For
 * those, "keep both" cannot mean what it says — so the import keeps the vault's copy, and the
 * dialog says which kinds that applies to instead of quietly doing it. */
export const canDuplicate = (kind: EntityKind) => kind === 'projekt' || kind === 'binding';
export interface PlannedEntity {
  kind: EntityKind;
  id: string;
  name: string;
  action: 'add' | 'conflict' | 'identical';
}
export interface ImportPlan {
  entities: PlannedEntity[];
  summary: { added: number; conflicts: number; identical: number };
  blockers: string[];
}
export type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; problems: string[] };

export function toSnapshot(workspace: WorkspaceSnapshot, kind: SnapshotKind, app: AppIdentity): Snapshot {
  const head = { format: 'ai-code-vault.snapshot' as const, schemaVersion: SNAPSHOT_VERSION, exportedAt: new Date().toISOString(), app };
  if (kind === 'private') {
    const { bindings, profiles, rules, blocklist, settings }: PrivatePayload = workspace;
    return { ...head, kind: 'private', payload: { bindings, profiles, rules, blocklist, settings } };
  }
  return { ...head, kind: 'full', payload: workspace };
}

export function parseSnapshot(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['Filen är inte giltig JSON. Är den krypterad eller skadad?'] };
  }
  const version = (raw as { schemaVersion?: unknown })?.schemaVersion;
  if (typeof version === 'number' && version > SNAPSHOT_VERSION) {
    return {
      ok: false,
      problems: [`Filen är skriven av en nyare version (schema ${version}, den här förstår ${SNAPSHOT_VERSION}). Uppdatera appen först.`],
    };
  }
  const result = snapshotSchema.safeParse(raw);
  if (!result.success) return { ok: false, problems: result.error.issues.slice(0, 12).map(redact) };
  // Validated at the boundary, so the domain shape now holds.
  return { ok: true, snapshot: raw as Snapshot };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Works out what an import would do before anything is written, so conflicts are a choice the user
 * makes rather than an error thrown halfway through a transaction. */
export function planImport(snapshot: Snapshot, current: WorkspaceSnapshot): ImportPlan {
  const entities: PlannedEntity[] = [];
  const blockers: string[] = [];

  const classify = <T extends { id: string }>(kind: EntityKind, incoming: T[], existing: T[], name: (item: T) => string) => {
    for (const item of incoming) {
      const match = existing.find((e) => e.id === item.id);
      entities.push({ kind, id: item.id, name: name(item), action: !match ? 'add' : same(match, item) ? 'identical' : 'conflict' });
    }
  };

  const payload = snapshot.payload;
  const projects = 'projects' in payload ? payload.projects : [];
  const versions = 'versions' in payload ? payload.versions : [];
  const drafts = 'drafts' in payload ? payload.drafts : [];

  classify('projekt', projects, current.projects, (p) => p.name);
  classify('version', versions, current.versions, (v) => `v${v.number}`);
  classify('binding', payload.bindings, current.bindings, (b) => b.name);
  classify('profil', payload.profiles, current.profiles, (p) => p.name);
  classify('dataset', 'datasets' in payload ? payload.datasets : [], current.datasets, (d) => d.name);
  classify('regel', payload.rules, current.rules, (r) => r.name);
  classify('blocklistterm', payload.blocklist, current.blocklist, (e) => e.term);
  for (const draft of drafts) {
    const match = current.drafts.find((d) => d.projectId === draft.projectId);
    entities.push({
      kind: 'utkast',
      id: draft.projectId,
      name: projects.find((p) => p.id === draft.projectId)?.name ?? draft.projectId,
      action: !match ? 'add' : same(match, draft) ? 'identical' : 'conflict',
    });
  }

  // Refuse before touching the store rather than writing something the app's own rules reject.
  const knownProjects = new Set([...projects.map((p) => p.id), ...current.projects.map((p) => p.id)]);
  for (const version of versions) {
    if (!knownProjects.has(version.projectId)) blockers.push(`Version v${version.number} hör till ett projekt som saknas i både filen och valvet.`);
  }
  for (const draft of drafts) {
    if (!knownProjects.has(draft.projectId)) blockers.push('Ett utkast hör till ett projekt som saknas i både filen och valvet.');
  }
  const seen: WorkspaceSnapshot['bindings'] = [];
  for (const binding of payload.bindings) {
    const errors = validateBinding(binding, [...seen, ...current.bindings.filter((b) => b.id !== binding.id)]);
    if (errors.length) blockers.push(`Bindingen ${binding.name}: ${errors.join(' ')}`);
    seen.push(binding);
  }

  const summary = {
    added: entities.filter((e) => e.action === 'add').length,
    conflicts: entities.filter((e) => e.action === 'conflict').length,
    identical: entities.filter((e) => e.action === 'identical').length,
  };
  return { entities, summary, blockers: [...new Set(blockers)] };
}
