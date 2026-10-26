// @vitest-environment jsdom

import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { afterEach, expect, test, vi } from 'vitest';

import { keyedBy, liveFeed, mountShell, threadsRepo, type TestApp } from '$lib/app/testing.js';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { ThreadsRepo } from './Repo.js';
import { Live } from '$lib/wire/Live.js';
import { ThreadList } from './List.svelte.js';
import { FolderActs } from './FolderActs.js';
import { ThreadOnScreen } from './OnScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Refusal } from '$lib/wire/refusal.js';

let app: TestApp | undefined;
const feed = liveFeed();
const archiving = vi.fn();
const archived = vi.fn();
const reported: unknown[] = [];

function open(shown: readonly unknown[] = []): ThreadList {
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(
      Layer.of(ThreadsRepo, threadsRepo({ setArchived: { run: (input: unknown) => archiving(input) }, archived: keyedBy(archived) })),
      Layer.of(Live, feed.live),
      Layer.of(ThreadOnScreen, { page: null, host: null, shown } as never),
      Layer.of(ExecutionsRepo, {} as never),
      Layer.of(Failure, new Failure((reason) => void reported.push(reason))),
    ),
  );
  return app.app.resolve(ThreadList);
}

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  feed.frame = null;
  archiving.mockReset();
  archived.mockReset();
  reported.length = 0;
});

const row = (id: string, order: number, parentThreadId: string | null = null): ThreadListRow =>
  ({
    id,
    projectId: 1,
    scopeName: null,
    title: id,
    titleOrigin: 'random',
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    activeRunSelection: null,
    contextShare: null,
    cacheWarmth: null,
    liveSpellStartedAt: null,
    outcome: null,
    spawnRootId: parentThreadId ?? id,
    parentThreadId,
    name: id,
    agentId: 'tagma',
    profileId: null,
    harness: null,
    phase: null,
    held: { paths: 0, unproven: 0 },
    provider: 'openai-oauth',
    account: null,
    model: 'test',
    reasoning: null,
    switches: {},
    createdBySessionId: null,
    readerOrderAt: new Date(Date.UTC(2026, 0, 1, 0, order)).toISOString(),
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as ThreadListRow;

function listed(): ThreadListRow[] {
  return [row('root', 3), row('child', 2, 'root'), row('other', 1)];
}

function seed(list: ThreadList): void {
  feed.frame?.({ type: 'list', rows: listed(), roots: 2, windowBefore: null });
  expect(list.threads.map((one) => one.id).sort()).toEqual(['child', 'other', 'root']);
}

test('an archived root leaves the list with its subtree before the door answers and stays gone once it does', async () => {
  const list = open();
  seed(list);
  let answer: (value: unknown) => void = () => undefined;
  archiving.mockReturnValue(new Promise((resolve) => (answer = resolve)));

  const act = list.setArchived('root', true);

  expect(list.threads.map((one) => one.id)).toEqual(['other']);
  expect(list.tree.map((node) => node.row.id)).toEqual(['other']);

  answer({ status: 'archived' });
  expect(await act).toBe(true);
  feed.frame?.({ type: 'removed', threadId: 'child' });
  feed.frame?.({ type: 'removed', threadId: 'root' });

  expect(list.threads.map((one) => one.id)).toEqual(['other']);
  expect(archiving).toHaveBeenCalledWith({ id: 'root', projectId: 1, archived: true });
});

test('a refused archive returns the subtree to the list and tells the refusal as a card', async () => {
  const list = open();
  seed(list);
  const refusal = new Refusal({ gate: true, code: 'archive-refused', reason: 'the thread is working', unblock: [] });
  let refuse: (error: unknown) => void = () => undefined;
  archiving.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));

  const act = list.setArchived('root', true);
  expect(list.threads.map((one) => one.id)).toEqual(['other']);

  refuse(refusal);
  expect(await act).toBe(false);

  expect(list.threads.map((one) => one.id).sort()).toEqual(['child', 'other', 'root']);
  expect(list.node('root')?.children.map((node) => node.row.id)).toEqual(['child']);
  expect(app!.app.resolve(Notices).list).toMatchObject([{ kind: 'refusal', title: 'archive-refused' }]);
  expect(reported).toEqual([]);
});

test('a child born under the root while its archive is pending is back with the root when the archive is refused', async () => {
  const list = open();
  seed(list);
  let refuse: (error: unknown) => void = () => undefined;
  archiving.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));

  const act = list.setArchived('root', true);
  feed.frame?.({ type: 'row', row: row('late', 4, 'root') });
  expect(list.threads.map((one) => one.id)).toEqual(['other']);

  refuse(new Error('archive-refused'));
  await act;

  expect(
    list
      .node('root')
      ?.children.map((node) => node.row.id)
      .sort(),
  ).toEqual(['child', 'late']);
});

test('archiving the thread a pane shows sends that pane to a draft before the door answers', () => {
  const startDraft = vi.fn();
  const elsewhere = vi.fn();
  const list = open([
    { activeId: 'child', startDraft },
    { activeId: 'other', startDraft: elsewhere },
  ]);
  seed(list);
  archiving.mockReturnValue(new Promise(() => undefined));

  void list.setArchived('root', true);

  expect(startDraft).toHaveBeenCalledTimes(1);
  expect(elsewhere).not.toHaveBeenCalled();
});

test('an unarchived thread leaves the archived list before the door answers and returns when it refuses', async () => {
  const shelved = { ...row('shelved', 0), archivedAt: '2026-01-02T00:00:00.000Z' } as ThreadListRow;
  archived.mockResolvedValue({ status: 'rows', rows: [shelved], total: 1 });
  const list = open();
  await list.readArchived();
  expect(list.archived?.map((one) => one.id)).toEqual(['shelved']);
  expect(list.archivedTotal).toBe(1);
  let refuse: (error: unknown) => void = () => undefined;
  archiving.mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));

  const act = list.setArchived('shelved', false);
  expect(list.archived).toEqual([]);
  expect(list.archivedTotal).toBe(0);

  refuse(new Error('unarchive-refused'));
  expect(await act).toBe(false);

  expect(list.archived?.map((one) => one.id)).toEqual(['shelved']);
  expect(list.archivedTotal).toBe(1);
});

test('unarchiving a root takes the descendants archived with it out of the archived list and its count, not those archived apart', async () => {
  const stamp = '2026-01-02T00:00:00.000Z';
  const rows = [
    { ...row('shelved', 0), archivedAt: stamp },
    { ...row('together', 0, 'shelved'), archivedAt: stamp },
    { ...row('apart', 0, 'shelved'), archivedAt: '2026-01-01T12:00:00.000Z' },
  ] as ThreadListRow[];
  archived.mockResolvedValue({ status: 'rows', rows, total: 3 });
  const list = open();
  await list.readArchived();
  archiving.mockReturnValue(new Promise(() => undefined));

  void list.setArchived('shelved', false);

  expect(list.archived?.map((one) => one.id)).toEqual(['apart']);
  expect(list.archivedTotal).toBe(1);
});
