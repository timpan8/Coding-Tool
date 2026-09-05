import type { Binding, Project, Version } from '../../types/models';
export const deviceId = '11111111-1111-4111-8111-111111111111';
export const time = '2026-09-05T12:00:00.000Z';
export function binding(overrides: Partial<Binding> = {}): Binding {
  return { id: crypto.randomUUID(), name: 'ADMIN_PASSWORD', category: 'secret', scope: 'project', scopeRef: 'project',
    description: '', aiReplacement: '<PASSWORD>', values: { __default__: 'SuperSecret123!', work: 'OtherSecret987!' }, escapeMode: 'auto',
    matchHints: { lastVariableNames: [], previousAiValues: [], aliases: [] }, createdAt: time, updatedAt: time, deviceId, ...overrides };
}
export function project(overrides: Partial<Project> = {}): Project {
  return { id: crypto.randomUUID(), name: 'Create-ADUsers', slug: 'create-adusers', description: '', language: 'powershell', tags: [], status: 'experimental',
    files: [{ id: crypto.randomUUID(), name: 'Create-ADUsers.ps1', language: 'powershell', order: 0 }], currentVersionId: null,
    paths: { rootOverride: null, subfolders: ['Input', 'Output', 'Logs'] }, notes: '', createdAt: time, updatedAt: time, deviceId, ...overrides };
}
export function version(p: Project, overrides: Partial<Version> = {}): Version {
  return { id: crypto.randomUUID(), projectId: p.id, number: 1, label: '', parentVersionId: null, branchName: 'main', status: 'experimental', notes: '',
    templates: { [p.files[0].id]: '$password = "{{ADMIN_PASSWORD}}"' }, bindingUsage: [{ bindingName: 'ADMIN_PASSWORD', fileId: p.files[0].id, occurrences: 1 }],
    createdAt: time, deviceId, ...overrides };
}
