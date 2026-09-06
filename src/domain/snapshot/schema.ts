import { z } from 'zod';
import { categories, languages } from '../../types/models';
import type { WorkspaceSnapshot } from '../../types/models';

/** Bumped only when a change cannot be read by the previous parser. A file from a newer version is
 * refused rather than partially understood, because a partial restore of a vault is worse than none. */
export const SNAPSHOT_VERSION = 1;

const iso = z.iso.datetime();
const id = z.string().min(1);

const projectFile = z.object({
  id,
  name: z.string(),
  language: z.enum(languages as [string, ...string[]]),
  order: z.number().int(),
});

export const projectSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  language: z.enum(languages as [string, ...string[]]),
  tags: z.array(z.string()),
  status: z.enum(['stable', 'testing', 'experimental', 'broken', 'archived']),
  files: z.array(projectFile),
  currentVersionId: id.nullable(),
  paths: z.object({ rootOverride: z.string().nullable(), subfolders: z.array(z.string()) }),
  notes: z.string(),
  createdAt: iso,
  updatedAt: iso,
  deviceId: z.string(),
});

export const versionSchema = z.object({
  id,
  projectId: id,
  number: z.number().int().positive(),
  label: z.string(),
  parentVersionId: id.nullable(),
  branchName: z.string(),
  status: z.enum(['stable', 'testing', 'experimental', 'broken']),
  notes: z.string(),
  templates: z.record(z.string(), z.string()),
  bindingUsage: z.array(z.object({ bindingName: z.string(), fileId: z.string(), occurrences: z.number().int() })),
  ingestReport: z.unknown().optional(),
  createdAt: iso,
  deviceId: z.string(),
});

export const draftSchema = z.object({
  projectId: id,
  baseVersionId: id.nullable(),
  templates: z.record(z.string(), z.string()),
  updatedAt: iso,
  revision: z.number().int().nonnegative(),
});

export const bindingSchema = z.object({
  id,
  name: z.string(),
  category: z.enum(categories as [string, ...string[]]),
  scope: z.enum(['global', 'project', 'version']),
  scopeRef: id.nullable(),
  description: z.string(),
  aiReplacement: z.string(),
  values: z.record(z.string(), z.string()),
  escapeMode: z.enum(['auto', 'raw']),
  matchHints: z.object({
    lastVariableNames: z.array(z.string()),
    previousAiValues: z.array(z.string()),
    aliases: z.array(z.string()),
  }),
  createdAt: iso,
  updatedAt: iso,
  deviceId: z.string(),
});

export const profileSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  isActive: z.boolean().optional(),
  createdAt: iso,
  updatedAt: iso,
});

export const datasetSchema = z.looseObject({ id, name: z.string() });
export const ruleSchema = z.looseObject({ id, name: z.string(), pattern: z.string() });

export const dismissalSchema = z.object({
  projectId: id,
  fingerprint: z.string(),
  ruleId: z.string(),
  reason: z.string(),
  createdAt: iso,
  deviceId: z.string(),
});

export const settingsSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  globalRootPath: z.string(),
  aiRootPath: z.string(),
  defaultSubfolders: z.array(z.string()),
  activeProfileId: id.nullable(),
  roundTripMarkers: z.boolean(),
  includeAiPromptBlock: z.boolean(),
  clipboardAutoClearSeconds: z.number().int().nonnegative(),
  maskSecretsInUi: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  aiPromptText: z.string().default(''),
  editorFontSize: z.number().int().min(10).max(24).default(14),
  editorWordWrap: z.boolean().default(true),
});

/** Everything needed to rebuild the vault. */
const fullPayload = z.strictObject({
  projects: z.array(projectSchema),
  versions: z.array(versionSchema),
  drafts: z.array(draftSchema),
  bindings: z.array(bindingSchema),
  profiles: z.array(profileSchema),
  datasets: z.array(datasetSchema),
  rules: z.array(ruleSchema),
  dismissals: z.array(dismissalSchema),
  settings: settingsSchema,
});

/** Private values and their configuration, and deliberately no project code — DECISIONS.md §14.2.
 * Strict rather than merely omitting the code keys: a payload that carries `projects` is then a
 * validation failure instead of a silently wider export.
 *
 * Dismissals are absent for the same reason. A fingerprint is derived from a value found in the
 * project's code, so it belongs with the code, not with the private configuration. */
const privatePayload = z.strictObject({
  bindings: z.array(bindingSchema),
  profiles: z.array(profileSchema),
  rules: z.array(ruleSchema),
  settings: settingsSchema,
});

export const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    format: z.literal('ai-code-vault.snapshot'),
    schemaVersion: z.number().int().min(1).max(SNAPSHOT_VERSION),
    kind: z.literal('full'),
    exportedAt: iso,
    app: z.object({ version: z.string(), deviceId: z.string(), deviceName: z.string() }),
    payload: fullPayload,
  }),
  z.object({
    format: z.literal('ai-code-vault.snapshot'),
    schemaVersion: z.number().int().min(1).max(SNAPSHOT_VERSION),
    kind: z.literal('private'),
    exportedAt: iso,
    app: z.object({ version: z.string(), deviceId: z.string(), deviceName: z.string() }),
    payload: privatePayload,
  }),
]);

/** Written by hand against the domain types rather than inferred from the schema. Zod's job here is
 * to validate untrusted input at the boundary; once it has, the value is a domain value, and
 * inferring a second near-identical set of types would only create friction between them. */
export interface SnapshotHead {
  format: 'ai-code-vault.snapshot';
  schemaVersion: number;
  exportedAt: string;
  app: { version: string; deviceId: string; deviceName: string };
}
export type PrivatePayload = Pick<WorkspaceSnapshot, 'bindings' | 'profiles' | 'rules' | 'settings'>;
export type Snapshot =
  | (SnapshotHead & { kind: 'full'; payload: WorkspaceSnapshot })
  | (SnapshotHead & { kind: 'private'; payload: PrivatePayload });
export type SnapshotKind = Snapshot['kind'];

/** Zod prints the offending value in its messages, and this file is full of secrets. Every message
 * shown to the user or written anywhere goes through here first. */
export function redact(issue: { path: PropertyKey[]; message: string }): string {
  const where = issue.path.length ? issue.path.join('.') : 'roten';
  const message = issue.message
    .replace(/"[^"]*"/g, '…')
    .replace(/received\s+\S+/gi, 'fel typ')
    .replace(/expected\s+/gi, 'förväntade ');
  return `${where}: ${message}`;
}
