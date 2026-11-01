// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { graphCatalogs } from '@tagma/server/catalogs/contract/wire/settings';
import { waitUntil } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Refusal } from '$lib/wire/refusal.js';
import { mountShell, soloWorkspace, type TestApp } from '../testing.js';
import CreationField from './CreationField.fixture.svelte';
import { CreationFields } from './creation.js';
import NewProjectDialog from './NewProjectDialog.svelte';
import { ProjectCreation, type ProjectDraft } from './ProjectCreation.svelte.js';

const refusal = (field: string) =>
  new Refusal({ gate: true, code: 'field-invalid', reason: 'this mark is refused', unblock: ['choose another mark'], field });

const create = vi.fn<(draft: ProjectDraft) => Promise<void>>();

const boot = Layer.mergeAll(
  Layer.of(ProjectCreation, { open: true, creating: false, offered: null, folders: undefined, create } as unknown as ProjectCreation),
  Layer.of(SettingsRepo, {
    catalog: stubFamily({
      data: { entries: [{ id: graphCatalogs.id, control: { kind: 'choice', choices: [] }, layers: {}, fallback: [] }] },
    }),
  } as never),
  Layer.of(Workspace, soloWorkspace({ projects: [{ id: 1, kind: 'global' }], contextProject: null })),
);

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  create.mockReset();
});

const typed = (input: HTMLInputElement | null, value: string) => {
  if (input === null) throw new Error('the dialog drew no such field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};

const catalogs = () => document.body.querySelector('[role="group"][aria-label="Catalogs"]');

const submitted = async (landed: () => boolean) => {
  const button = [...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Create project');
  button?.click();
  await waitUntil(landed);
};

test('the core dialog ends with its own fields, leaving no place drawn for contributions', async () => {
  app = mountShell(CreationFields, boot);
  app.draw(NewProjectDialog as never, { open: true });
  await waitUntil(() => catalogs() !== null);
  expect(catalogs()!.nextElementSibling).toBeNull();
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
  await waitUntil(() => catalogs() !== null);
  const field = document.body.querySelector('[data-testid="creation-field"]');
  expect(field).not.toBeNull();
  expect(catalogs()!.compareDocumentPosition(field!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  typed(document.body.querySelector('input[placeholder="runlith"]'), 'book');
  typed(document.body.querySelector('input[placeholder="/absolute/path/to/repo"]'), '/work/book');
  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');

  const underField = () => document.body.querySelector('[data-testid="creation-field-refused"]');
  const alert = () => document.body.querySelector('[role="alert"]');

  create.mockRejectedValueOnce(refusal('extension-mark'));
  await submitted(() => underField() !== null);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'book', rootPath: '/work/book', contributed: { 'extension-mark': 'oak' } }),
  );
  expect(underField()?.textContent).toBe('this mark is refused');
  expect(alert()).toBeNull();

  create.mockRejectedValueOnce(refusal('absent-mark'));
  await submitted(() => alert() !== null);
  expect(underField()).toBeNull();
  expect(alert()?.textContent).toContain('this mark is refused');
});

test('a field that leaves before the creation takes its value with it', async () => {
  app = mountShell(CreationFields, boot);
  const leave = app.get(CreationFields).register('passing', { id: 'passing-mark', order: 1, payload: { component: CreationField } });
  app.draw(NewProjectDialog as never, { open: true });
  await waitUntil(() => document.body.querySelector('input[aria-label="Mark"]') !== null);
  typed(document.body.querySelector('input[placeholder="runlith"]'), 'book');
  typed(document.body.querySelector('input[placeholder="/absolute/path/to/repo"]'), '/work/book');
  typed(document.body.querySelector('input[aria-label="Mark"]'), 'oak');
  leave();
  flushSync();

  create.mockResolvedValueOnce(undefined);
  await submitted(() => create.mock.calls.length > 0);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ contributed: {} }));
});
