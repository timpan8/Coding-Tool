import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbProvider } from '../storage/IndexedDbProvider';
import { WorkspaceController } from './WorkspaceController';

async function setup() {
  const storage = new IndexedDbProvider('controller-' + crypto.randomUUID());
  const controller = new WorkspaceController(storage);
  await controller.initialize();
  return { storage, controller };
}

describe('WorkspaceController', () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => { await teardown?.(); teardown = undefined; });

  it('creates exactly one unnamed project on first meaningful input and autosaves the draft', async () => {
    const { storage, controller } = await setup(); teardown = () => storage.destroy();
    controller.changeText('Write-Output "hello"');
    await controller.flush();
    const projects = await storage.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Namnlöst projekt');
    expect(await storage.getDraft(projects[0].id)).toMatchObject({ templates: { [projects[0].files[0].id]: 'Write-Output "hello"' } });
    controller.changeText('Write-Output "hello world"');
    controller.changeText('Write-Output "hello world!"');
    await controller.flush();
    expect(await storage.listProjects()).toHaveLength(1);
    expect((await storage.getDraft(projects[0].id))?.templates[projects[0].files[0].id]).toContain('world!');
    expect(await storage.listVersions(projects[0].id)).toHaveLength(0);
  });

  it('keeps an explicit version separate from later draft edits and preserves rename', async () => {
    const { storage, controller } = await setup(); teardown = () => storage.destroy();
    controller.changeText('one'); await controller.flush();
    controller.rename('My Script'); await controller.flush();
    await controller.saveVersion();
    controller.changeText('two'); await controller.flush();
    const project = (await storage.listProjects())[0], versions = await storage.listVersions(project.id), draft = await storage.getDraft(project.id);
    expect(project.name).toBe('My Script');
    expect(versions).toHaveLength(1);
    expect(versions[0].templates[project.files[0].id]).toBe('one');
    expect(draft?.templates[project.files[0].id]).toBe('two');
  });

  it('rejects a stale second writer without overwriting the first draft', async () => {
    const { storage, controller } = await setup(); teardown = () => storage.destroy();
    controller.changeText('first'); await controller.flush();
    const project = (await storage.listProjects())[0], draft = await storage.getDraft(project.id);
    if (!draft) throw new Error('Expected a draft');
    await expect(storage.saveDraft({ ...draft, templates: { [project.files[0].id]: 'stale' }, updatedAt: new Date().toISOString() }, draft.revision - 1, { name: project.name, language: project.language, files: project.files })).rejects.toThrow(/annan flik/);
    expect((await storage.getDraft(project.id))?.templates[project.files[0].id]).toBe('first');
  });

  it('keeps the in-memory text after a storage failure', async () => {
    const { storage, controller } = await setup(); teardown = () => storage.destroy();
    const original = storage.createProjectWithDraft.bind(storage);
    storage.createProjectWithDraft = async () => { throw new Error('synthetic quota failure'); };
    controller.changeText('private local draft');
    await expect(controller.flush()).rejects.toThrow('synthetic quota failure');
    expect(controller.getSnapshot().session.text).toBe('private local draft');
    expect(controller.getSnapshot().phase).toBe('error');
    storage.createProjectWithDraft = original;
  });
});
