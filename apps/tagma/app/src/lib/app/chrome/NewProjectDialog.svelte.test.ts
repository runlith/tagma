// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { graphCatalogs } from '@tagma/server/catalogs/contract/wire/settings';
import { waitUntil } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Right } from '@tagma/server/platform/contract/wire/right';
import { Access } from '$lib/wire/access.js';
import { Refusal } from '$lib/wire/refusal.js';
import { mountShell, soloWorkspace, type TestApp } from '../testing.js';
import CreationField from './CreationField.fixture.svelte';
import CreationOffer from './CreationOffer.fixture.svelte';
import { CreationFields } from './creation.js';
import NewProjectDialog from './NewProjectDialog.svelte';
import { ProjectCreation, type ProjectDraft } from './ProjectCreation.svelte.js';

const refusal = (field: string) =>
  new Refusal({ gate: true, code: 'field-invalid', reason: 'this mark is refused', unblock: ['choose another mark'], field });

const create = vi.fn<(draft: ProjectDraft) => Promise<void>>();

const bootWith = (carries: boolean) =>
  Layer.mergeAll(
    Layer.of(ProjectCreation, { open: true, creating: false, offered: null, folders: undefined, create } as unknown as ProjectCreation),
    Layer.of(SettingsRepo, {
      catalog: stubFamily({
        data: { entries: [{ id: graphCatalogs.id, control: { kind: 'choice', choices: [] }, layers: {}, fallback: [] }] },
      }),
    } as never),
    Layer.of(ProjectsRepo, { folder: stubFamily({ data: { rootPath: '/work/book', carries, git: true } }) } as never),
    Layer.of(Workspace, soloWorkspace({ projects: [{ id: 1, kind: 'global' }], contextProject: null })),
  );

const boot = bootWith(false);

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  create.mockReset();
});

const typed = (input: Element | null, value: string) => {
  if (!(input instanceof HTMLInputElement)) throw new Error('the dialog drew no such field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
};

const catalogs = () => document.body.querySelector('[role="group"][aria-label="Catalogs"]');
const nameField = () => document.body.querySelector('input[placeholder="runlith"]');

const pathField = () => document.body.querySelector('input[placeholder="/absolute/path/to/repo"]');

const folderRead = async (path = '/work/book') => {
  await waitUntil(() => pathField() !== null);
  typed(pathField(), path);
  await waitUntil(() => nameField() !== null);
};

const submitted = async (landed: () => boolean) => {
  const button = [...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Add project');
  button?.click();
  await waitUntil(landed);
};

test('until a folder is read the dialog asks nothing else, then the core fields end it with no place drawn for contributions', async () => {
  app = mountShell(CreationFields, boot);
  app.draw(NewProjectDialog as never, { open: true });
  await waitUntil(() => pathField() !== null);
  expect(nameField()).toBeNull();
  expect(catalogs()).toBeNull();
  await folderRead();
  await waitUntil(() => catalogs() !== null);
  expect(catalogs()!.nextElementSibling).toBeNull();
});

test('a folder carrying its graph asks only the name and the fields placed beside it, and sends no storage or catalogs', async () => {
  app = mountShell(
    Layer.mergeAll(
      CreationFields,
      CreationFields.contribute('extension', { id: 'kept-mark', order: 1, places: ['carried'], payload: { component: CreationField } }),
      CreationFields.contribute('elsewhere', { id: 'new-mark', order: 2, payload: { component: CreationField } }),
    ),
    bootWith(true),
  );
  app.draw(NewProjectDialog as never, { open: true });
  await folderRead();
  expect(document.body.querySelector('[data-carried-graph]')).not.toBeNull();
  expect(document.body.querySelector('[role="radiogroup"][aria-label="Storage"]')).toBeNull();
  expect(catalogs()).toBeNull();
  expect(document.body.querySelectorAll('input[aria-label="Mark"]')).toHaveLength(1);
  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');

  create.mockResolvedValueOnce(undefined);
  await submitted(() => create.mock.calls.length > 0);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'book',
      rootPath: '/work/book',
      storage: undefined,
      catalogs: undefined,
      contributed: { 'kept-mark': 'oak' },
    }),
  );
});

test('a source field opens its own tab beside New graph, where storage and catalogs give way to it', async () => {
  app = mountShell(
    Layer.mergeAll(
      CreationFields,
      CreationFields.contribute('extension', { id: 'source-mark', order: 1, source: 'From a mark', payload: { component: CreationField } }),
    ),
    boot,
  );
  app.draw(NewProjectDialog as never, { open: true });
  await folderRead();
  await waitUntil(() => catalogs() !== null);
  expect(document.body.querySelector('input[aria-label="Mark"]')).toBeNull();

  const sourceTab = [...document.body.querySelectorAll('[role="tab"]')].find((one) => one.textContent?.trim() === 'From a mark');
  (sourceTab as HTMLElement | undefined)?.click();
  flushSync();
  expect(catalogs()).toBeNull();
  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');

  create.mockResolvedValueOnce(undefined);
  await submitted(() => create.mock.calls.length > 0);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ storage: undefined, catalogs: undefined, contributed: { 'source-mark': 'oak' } }),
  );
});

test('a contributed field draws after the core fields, its value rides the creation under its id, and a refusal naming it lands under it', async () => {
  app = mountShell(
    Layer.mergeAll(
      CreationFields,
      CreationFields.contribute('extension', { id: 'extension-mark', order: 1, payload: { component: CreationField } }),
    ),
    boot,
  );
  app.draw(NewProjectDialog as never, { open: true });
  await folderRead();
  await waitUntil(() => catalogs() !== null);
  const field = document.body.querySelector('[data-testid="creation-field"]');
  expect(field).not.toBeNull();
  expect(catalogs()!.compareDocumentPosition(field!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');

  const underField = () => document.body.querySelector('[data-testid="creation-field-refused"]');
  const alert = () => document.body.querySelector('[role="alert"]');

  create.mockRejectedValueOnce(refusal('extension-mark'));
  await submitted(() => underField() !== null);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'book', rootPath: '/work/book', storage: 'stealth', contributed: { 'extension-mark': 'oak' } }),
  );
  expect(underField()?.textContent).toBe('this mark is refused');
  expect(alert()).toBeNull();

  create.mockRejectedValueOnce(refusal('absent-mark'));
  await submitted(() => alert() !== null);
  expect(underField()).toBeNull();
  expect(alert()?.textContent).toContain('this mark is refused');
});

test('a field whose right the access grants only for reading draws its offer in its place, and a refusal naming it goes to the alert', async () => {
  const lacking: Right = { key: 'warmth', state: 'trial', access: 'read', unblock: ['renew warmth'] };
  app = mountShell(
    Layer.mergeAll(
      CreationFields,
      CreationFields.contribute('extension', {
        id: 'sealed-mark',
        order: 1,
        right: 'warmth',
        payload: { component: CreationField },
        offer: { component: CreationOffer },
      }),
    ),
    Layer.mergeAll(boot, Layer.of(Access, { right: () => lacking })),
  );
  app.draw(NewProjectDialog as never, { open: true });
  await folderRead();
  await waitUntil(() => document.body.querySelector('[data-testid="creation-offer"]') !== null);
  expect(document.body.querySelector('[data-testid="creation-field"]')).toBeNull();

  create.mockRejectedValueOnce(refusal('sealed-mark'));
  await submitted(() => document.body.querySelector('[role="alert"]') !== null);
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('this mark is refused');
});

test('a field that leaves before the creation takes its value with it', async () => {
  app = mountShell(CreationFields, boot);
  const leave = app.get(CreationFields).register('passing', { id: 'passing-mark', order: 1, payload: { component: CreationField } });
  app.draw(NewProjectDialog as never, { open: true });
  await folderRead();
  await waitUntil(() => document.body.querySelector('input[aria-label="Mark"]') !== null);
  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');
  leave();
  flushSync();

  create.mockResolvedValueOnce(undefined);
  await submitted(() => create.mock.calls.length > 0);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ contributed: {} }));
});
