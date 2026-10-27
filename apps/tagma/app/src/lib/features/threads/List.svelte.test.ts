// @vitest-environment jsdom

import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { stubMutation } from '@runlith/query/testing';
import { afterEach, expect, test, vi } from 'vitest';
import { waitFor } from '@runlith/testing/flush';

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
const roots = vi.fn();
const reported: unknown[] = [];

function open(acts: Record<string, unknown> = {}): ThreadList {
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(
      Layer.of(ThreadsRepo, threadsRepo({ roots: keyedBy(roots), ...acts })),
      Layer.of(ExecutionsRepo, {} as never),
      Layer.of(Live, feed.live),
      Layer.of(ThreadOnScreen, { page: null, host: null, shown: [] } as never),
      Layer.of(Failure, new Failure((reason) => void reported.push(reason))),
    ),
  );
  return app.app.resolve(ThreadList);
}

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  feed.frame = null;
  roots.mockReset();
  reported.length = 0;
});

const row = (id: string, order: number, parentThreadId: string | null = null, life: RunLife = 'idle'): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life,
  activeRunId: life === 'working' ? `run:${id}` : null,
  activeRunStartedAt: life === 'working' ? '2026-01-01T00:00:00.000Z' : null,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: life === 'working' ? '2026-01-01T00:00:00.000Z' : null,
  outcome: null,
  spawnRootId: parentThreadId ?? id,
  parentThreadId,
  name: id,
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  provider: 'openai-oauth',
  account: null,
  processAccount: null,
  model: 'test',
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: new Date(Date.UTC(2026, 0, 1, 0, order)).toISOString(),
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('an off-window working child refreshes the bounded root family, then readMore reaches the evicted root', async () => {
  const initial = Array.from({ length: 50 }, (_unused, index) => row(`root-${index}`, index));
  const offRoot = row('off-root', -2);
  const offChild = row('off-child', -1, offRoot.id, 'working');
  const refreshed = [offRoot, offChild, ...initial.slice(1)];
  roots
    .mockResolvedValueOnce({ rows: refreshed, roots: 51, windowBefore: 'after-refreshed-window' })
    .mockResolvedValueOnce({ rows: [initial[0]], roots: 51, windowBefore: null });

  const list = open();
  feed.frame?.({ type: 'list', rows: initial, roots: 51, windowBefore: 'after-initial-window' });

  feed.frame?.({ type: 'row', row: offChild });

  await waitFor(() =>
    expect(new Set(list.threads.map((entry) => entry.id))).toEqual(
      new Set([offRoot.id, offChild.id, ...initial.slice(1).map((entry) => entry.id)]),
    ),
  );
  expect(roots).toHaveBeenCalledWith({ projectId: 1 });
  expect(list.tree).toHaveLength(50);
  expect(list.roots).toBe(51);
  expect(list.more).toBe(1);

  await list.readMore();

  expect(roots).toHaveBeenLastCalledWith({ projectId: 1, readerBefore: 'after-refreshed-window' });
  expect(list.tree).toHaveLength(51);
  expect(list.roots).toBe(51);
  expect(list.more).toBe(0);
});

test('a working root ending and a root birth each refresh membership and the root count', async () => {
  const window = Array.from({ length: 50 }, (_unused, index) => row(`root-${index}`, index));
  const oldWorker = row('old-worker', -1, null, 'working');
  const newborn = row('newborn', 100);
  roots
    .mockResolvedValueOnce({ rows: window, roots: 51, windowBefore: 'after-idle-window' })
    .mockResolvedValueOnce({ rows: [newborn, ...window.slice(1)], roots: 52, windowBefore: 'after-newborn-window' });

  const list = open();
  feed.frame?.({
    type: 'list',
    rows: [oldWorker, ...window.slice(1)],
    roots: 51,
    windowBefore: 'after-working-window',
  });

  feed.frame?.({
    type: 'row',
    row: { ...oldWorker, life: 'idle', activeRunId: null, activeRunStartedAt: null, liveSpellStartedAt: null },
  });
  await waitFor(() => expect(list.threads.some((entry) => entry.id === window[0]?.id)).toBe(true));
  expect(roots).toHaveBeenCalledTimes(1);
  expect(list.threads.some((entry) => entry.id === oldWorker.id)).toBe(false);
  expect(list.roots).toBe(51);

  feed.frame?.({ type: 'row', row: newborn });
  await waitFor(() => expect(list.roots).toBe(52));
  expect(roots).toHaveBeenCalledTimes(2);
  expect(list.threads.some((entry) => entry.id === newborn.id)).toBe(true);
  expect(list.roots).toBe(52);
  expect(list.more).toBe(2);
});

test('a run ending, a pin released and a move between held parents stay in the window without a window read', async () => {
  const worker = row('worker', 5, null, 'working');
  const pinned = { ...row('pinned', 4), pinnedAt: '2026-01-01T00:00:00.000Z' };
  const left = row('left', 3);
  const right = row('right', 2);
  const child = row('child', 1, left.id, 'working');
  const list = open();
  feed.frame?.({ type: 'list', rows: [worker, pinned, left, right, child], roots: 4, windowBefore: right.readerOrderAt });

  feed.frame?.({ type: 'row', row: { ...worker, life: 'idle', activeRunId: null, activeRunStartedAt: null, liveSpellStartedAt: null } });
  feed.frame?.({ type: 'row', row: { ...pinned, pinnedAt: null } });
  feed.frame?.({ type: 'row', row: { ...child, parentThreadId: right.id } });
  feed.frame?.({ type: 'row', row: { ...child, parentThreadId: right.id, life: 'idle', activeRunId: null } });

  await Promise.resolve();
  expect(roots).not.toHaveBeenCalled();
  expect(list.tree.map((node) => [node.row.id, node.children.map((below) => below.row.id)])).toEqual([
    ['worker', []],
    ['pinned', []],
    ['left', []],
    ['right', ['child']],
  ]);
  expect(list.roots).toBe(4);
});

test('a frame whose row no longer carries a field drops it from the held row', async () => {
  const halted: ThreadListRow = { ...row('halted', 1, null, 'working'), halt: { reason: 'The agent driver failed: the pipe closed.' } };
  const list = open();
  feed.frame?.({ type: 'list', rows: [halted], roots: 1, windowBefore: null });
  const { halt: _halt, ...moving } = halted;
  feed.frame?.({ type: 'row', row: moving });
  await Promise.resolve();
  expect(list.threads.find((entry) => entry.id === halted.id)).not.toHaveProperty('halt');
});

test('a window read that feed frames overtook still lands, and the frames win over its older answer', async () => {
  const worker = { ...row('worker', 1, null, 'working'), phase: { phase: 'reasoning', calls: [] } } as const;
  const newborn = row('newborn', 2);
  let answer: (window: unknown) => void = () => undefined;
  roots.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

  const list = open();
  feed.frame?.({ type: 'list', rows: [worker], roots: 1, windowBefore: null });
  feed.frame?.({ type: 'row', row: newborn });
  const calling = { ...worker, phase: { phase: 'tools', calls: [{ name: 'grep', title: null, since: 0 }] } } as const;
  feed.frame?.({ type: 'row', row: calling });
  answer({ rows: [newborn, worker], roots: 2, windowBefore: null });

  await waitFor(() => expect(list.threads.map((entry) => entry.id)).toEqual([newborn.id, worker.id]));
  expect(list.threads.find((entry) => entry.id === worker.id)?.phase).toEqual(calling.phase);
  expect(list.roots).toBe(2);
});

test('a root born after the window was read gets a read of its own', async () => {
  const first = row('first', 1);
  const second = row('second', 2);
  let answer: (window: unknown) => void = () => undefined;
  roots
    .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    .mockResolvedValueOnce({ rows: [second, first], roots: 2, windowBefore: null });

  const list = open();
  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });
  feed.frame?.({ type: 'row', row: first });
  feed.frame?.({ type: 'row', row: second });
  answer({ rows: [first], roots: 1, windowBefore: null });

  await waitFor(() => expect(list.threads.map((entry) => entry.id)).toEqual([second.id, first.id]));
  expect(list.roots).toBe(2);
});

test('a root born while a window read fails gets the read it asked for', async () => {
  const first = row('first', 1);
  const second = row('second', 2);
  let fail: (error: unknown) => void = () => undefined;
  roots
    .mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)))
    .mockResolvedValueOnce({ rows: [second, first], roots: 2, windowBefore: null });

  const list = open();
  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });
  feed.frame?.({ type: 'row', row: first });
  feed.frame?.({ type: 'row', row: second });
  const broke = new Error('the window read broke');
  fail(broke);

  await waitFor(() => expect(list.threads.map((entry) => entry.id)).toEqual([second.id, first.id]));
  expect(reported).toEqual([broke]);
});

test('a new root stands from its own frame before the window read answers; an idle root below the cut waits for the read', async () => {
  const first = row('first', 5);
  const newborn = row('newborn', 6);
  const old = row('old', 1);
  let answer: (window: unknown) => void = () => undefined;
  roots
    .mockResolvedValue({ rows: [newborn, first], roots: 3, windowBefore: first.readerOrderAt })
    .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

  const list = open();
  feed.frame?.({ type: 'list', rows: [first], roots: 2, windowBefore: first.readerOrderAt });
  feed.frame?.({ type: 'row', row: newborn });
  feed.frame?.({ type: 'row', row: old });

  expect(list.threads.map((entry) => entry.id)).toEqual([newborn.id, first.id]);
  expect(roots).toHaveBeenCalledTimes(1);
  answer({ rows: [newborn, first], roots: 3, windowBefore: first.readerOrderAt });
  await waitFor(() => expect(list.roots).toBe(3));
  expect(list.more).toBe(1);
});

const aim = { name: 'quiet-otter', agentId: 'tagma', provider: 'openai-oauth', model: 'test', reasoning: null, root: null };

test('a birth stands as an idle root from the press, takes its thread id, and draws only what its row reports', async () => {
  const held = row('held', 1);
  roots.mockResolvedValue({ rows: [row('born', 2), held], roots: 2, windowBefore: null });
  const list = open();
  feed.frame?.({ type: 'list', rows: [held], roots: 1, windowBefore: null });

  let answer: (id: string | null) => void = () => undefined;
  const bearing = list.births.bear(aim, () => new Promise((resolve) => (answer = resolve)));
  const unborn = list.tree[0]?.row.id ?? '';
  expect(list.tree.map((node) => [node.row.title, node.row.life])).toEqual([
    ['quiet-otter', 'idle'],
    ['held', 'idle'],
  ]);
  expect(list.births.unborn(unborn)).toBe(true);
  expect(list.more).toBe(0);

  answer('born');
  await bearing;
  expect(list.tree[0]?.row.id).toBe('born');
  expect(list.births.unborn('born')).toBe(false);

  feed.frame?.({ type: 'row', row: row('born', 2) });
  list.births.settle('born', 'run:born');
  expect(list.tree.map((node) => [node.row.id, node.row.life])).toEqual([
    ['born', 'idle'],
    ['held', 'idle'],
  ]);

  feed.frame?.({ type: 'row', row: row('born', 2, null, 'working') });
  expect(list.tree[0]?.row).toBe(list.threads.find((entry) => entry.id === 'born'));
});

test('a birth that never got a thread leaves no row, and one whose turn was refused leaves its thread at rest', async () => {
  roots.mockResolvedValue({ rows: [row('born', 1)], roots: 1, windowBefore: null });
  const list = open();
  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });

  await list.births.bear(aim, async () => null);
  expect(list.tree).toEqual([]);

  await list.births.bear(aim, async () => 'born');
  feed.frame?.({ type: 'row', row: row('born', 1) });
  list.births.settle('born', null);
  expect(list.tree.map((node) => [node.row.id, node.row.life])).toEqual([['born', 'idle']]);
});

test('a fork stands in the list from the press until its thread is born, and a refused fork leaves with its reason as a card, not an error', async () => {
  const source = row('source', 1);
  const forked = { ...row('forked', 2), title: 'fork (source)' };
  roots.mockResolvedValue({ rows: [forked, source], roots: 2, windowBefore: null });
  let answer: (value: { threadId: string; draft: null }) => void = () => undefined;
  const reason = 'The terminal transport of this thread cannot take a turn out of its conversation or branch it.';
  const refusal = new Refusal({ gate: true, code: 'transport-cannot', reason, unblock: [] });
  const branch = vi
    .fn()
    .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    .mockRejectedValueOnce(refusal);
  const list = open({ branch: stubMutation(branch) });
  feed.frame?.({ type: 'list', rows: [source], roots: 1, windowBefore: null });

  const forking = list.fork(source);
  expect(list.tree.map((node) => node.row.title)).toEqual(['fork (source)', 'source']);
  expect(list.births.unborn(list.tree[0]?.row.id ?? '')).toBe(true);
  expect(list.busy('source', 'fork')).toBe(true);

  feed.frame?.({ type: 'row', row: forked });
  answer({ threadId: 'forked', draft: null });
  expect(await forking).toBe('forked');
  expect(list.tree.map((node) => node.row.id)).toEqual(['forked', 'source']);

  expect(await list.fork(source)).toBeNull();
  expect(list.tree.map((node) => node.row.id)).toEqual(['forked', 'source']);
  const notices = app!.app.resolve(Notices);
  expect(notices.list).toMatchObject([{ kind: 'refusal', title: 'transport-cannot', body: reason }]);
  expect(notices.faults).toEqual([]);
  expect(reported).toEqual([]);
});

test('a fork of a thread this list does not hold leaves at the answer, and the answer still names the born thread', async () => {
  const archived = { ...row('archived', 1), archivedAt: '2026-01-02T00:00:00.000Z' };
  let answer: (value: { threadId: string; draft: null }) => void = () => undefined;
  const list = open({ branch: stubMutation(() => new Promise((resolve) => (answer = resolve))) });
  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });

  const forking = list.fork(archived);
  expect(list.tree.map((node) => node.row.title)).toEqual(['fork (archived)']);

  answer({ threadId: 'forked', draft: null });
  expect(await forking).toBe('forked');
  expect(list.tree).toEqual([]);
});

test('a held row whose parent the list does not carry takes its frames without a window read', async () => {
  const orphan = row('orphan', 1, 'archived-parent', 'working');
  const list = open();
  feed.frame?.({ type: 'list', rows: [orphan], roots: 1, windowBefore: null });

  const calling = { ...orphan, phase: { phase: 'tools', calls: [{ name: 'grep', title: null, since: 0 }] } } as const;
  feed.frame?.({ type: 'row', row: calling });

  expect(list.threads[0]?.phase).toEqual(calling.phase);
  await Promise.resolve();
  expect(roots).not.toHaveBeenCalled();
});

test('a spawn under a held thread stands in the list at once, without a window read', async () => {
  const root = row('root', 1);
  const child = row('child', 2, root.id, 'working');
  const grandchild = row('grandchild', 3, child.id, 'working');

  const list = open();
  feed.frame?.({ type: 'list', rows: [root], roots: 1, windowBefore: null });

  feed.frame?.({ type: 'row', row: child });
  expect(list.threads.map((entry) => entry.id)).toEqual([child.id, root.id]);
  expect(list.tree).toHaveLength(1);

  feed.frame?.({ type: 'row', row: grandchild });
  expect(list.threads.map((entry) => entry.id)).toEqual([grandchild.id, child.id, root.id]);
  expect(list.holdsUnder(grandchild.id, root.id)).toBe(true);

  await Promise.resolve();
  expect(roots).not.toHaveBeenCalled();
  expect(list.roots).toBe(1);
});

test('a refused subscription leaves the list unread with the reason, and a retry subscribes again until a window lands', () => {
  const list = open();
  expect(list.roots).toBeNull();

  feed.ended?.({ kind: 'subscription', message: 'The server refused the subscription.' });
  expect(list.roots).toBeNull();
  expect(list.refused).toBe('The server refused the subscription.');

  const asked = feed.asked.length;
  list.retry();
  expect(feed.asked.length).toBe(asked + 1);
  expect(list.refused).toBeNull();

  feed.frame?.({ type: 'list', rows: [], roots: 0, windowBefore: null });
  expect(list.roots).toBe(0);
});

test('a subscription refused after a window keeps the rows and the reason until a live window lands, whatever a window read answers', async () => {
  const shown = row('shown', 2);
  const off = row('off', 1, 'away', 'working');
  roots.mockResolvedValueOnce({ rows: [shown], roots: 2, windowBefore: null });
  const list = open();
  feed.frame?.({ type: 'list', rows: [shown], roots: 1, windowBefore: null });

  feed.frame?.({ type: 'row', row: off });
  feed.ended?.({ kind: 'subscription', message: 'refused' });
  await waitFor(() => expect(list.roots).toBe(2));
  expect(list.refused).toBe('refused');
  expect(list.threads.map((entry) => entry.id)).toEqual(['shown']);

  list.retry();
  feed.frame?.({ type: 'list', rows: [shown], roots: 1, windowBefore: null });
  expect(list.refused).toBeNull();
});

test('the list answers whether a thread stands under a root, through the rows it holds', () => {
  const root = row('root', 1);
  const child = row('child', 2, root.id);
  const grandchild = row('grandchild', 3, child.id);
  const other = row('other', 4);

  const list = open();
  feed.frame?.({ type: 'list', rows: [root, child, grandchild, other], roots: 2, windowBefore: null });

  expect(list.holdsUnder(grandchild.id, root.id)).toBe(true);
  expect(list.holdsUnder(root.id, root.id)).toBe(true);
  expect(list.holdsUnder(other.id, root.id)).toBe(false);
});

test('a finished thread the list already holds is marked seen once it comes on screen', async () => {
  const unseen: NonNullable<ThreadListRow['outcome']> = {
    runId: 'run:done',
    status: 'completed',
    failureReason: null,
    failure: null,
    hostStateFailure: false,
    finishedAt: '2026-01-01T05:00:00.000Z',
    isSeen: false,
  };
  const done: ThreadListRow = { ...row('done', 1), outcome: unseen };
  const screen = $state<{ page: null; host: null; shown: { activeId: string }[] }>({ page: null, host: null, shown: [] });
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(
      Layer.of(
        ThreadsRepo,
        threadsRepo({
          roots: keyedBy(roots),
          see: stubMutation(async () => ({ ...done, outcome: { ...unseen, isSeen: true } })),
        }),
      ),
      Layer.of(ExecutionsRepo, {} as never),
      Layer.of(Live, feed.live),
      Layer.of(ThreadOnScreen, screen as never),
      Layer.of(Failure, new Failure((reason) => void reported.push(reason))),
    ),
  );
  const list = app.app.resolve(ThreadList);
  feed.frame?.({ type: 'list', rows: [done], roots: 1, windowBefore: null });
  expect(list.threads[0]?.outcome?.isSeen).toBe(false);

  screen.shown = [{ activeId: 'done' }];
  await waitFor(() => expect(list.threads[0]?.outcome?.isSeen).toBe(true));
});

test('a frame merges the fields that moved onto the record and leaves the rest of the list standing', () => {
  const ended: NonNullable<ThreadListRow['outcome']> = {
    runId: 'run:second',
    status: 'completed',
    failureReason: null,
    failure: null,
    hostStateFailure: false,
    finishedAt: '2026-01-01T05:00:00.000Z',
    isSeen: true,
  };
  const first = row('first', 2);
  const second: ThreadListRow = { ...row('second', 1), outcome: ended };
  const list = open();
  feed.frame?.({ type: 'list', rows: [first, second], roots: 2, windowBefore: null });
  const held = list.threads;

  feed.frame?.({ type: 'row', row: { ...second, outcome: { ...ended } } });
  expect(list.threads).toBe(held);
  expect(list.threads[1]).toBe(held[1]);

  const moved = { ...second, updatedAt: '2026-01-01T09:00:00.000Z' };
  feed.frame?.({ type: 'row', row: moved });
  expect(list.threads.map((entry) => entry.id)).toEqual(['first', 'second']);
  expect(list.threads[0]).toBe(held[0]);
  expect(list.threads[1]).not.toBe(held[1]);
  expect(list.threads[1]?.updatedAt).toBe('2026-01-01T09:00:00.000Z');

  feed.frame?.({ type: 'row', row: { ...moved, readerOrderAt: '2026-01-01T10:00:00.000Z' } });
  expect(list.threads.map((entry) => entry.id)).toEqual(['second', 'first']);
});

test('a child’s identity retains the parent address even when the list has never seen the parent', () => {
  const list = open();
  const parent = { id: 'parent', projectId: 7, title: 'Read the module' };
  const shown = { id: 'child', title: 'child', agentId: 'tagma', parentThreadId: parent.id, parent } as WireThread;
  feed.frame?.({ type: 'list', rows: [row('child', 1, parent.id)], roots: 1, windowBefore: null });
  expect(list.row(parent.id)).toBeUndefined();
  expect(list.identityOf(shown.id, shown)?.parent).toEqual(parent);
  feed.frame?.({
    type: 'list',
    rows: [{ ...row(parent.id, 2), projectId: parent.projectId, title: 'Renamed parent' }, row('child', 1, parent.id)],
    roots: 1,
    windowBefore: null,
  });
  expect(list.identityOf(shown.id, shown)?.parent).toEqual({ ...parent, title: 'Renamed parent' });
  feed.frame?.({ type: 'row', row: { ...row(parent.id, 2), projectId: parent.projectId, title: 'Renamed again' } });
  expect(list.identityOf(shown.id, shown)?.parent).toEqual({ ...parent, title: 'Renamed again' });
});

test('an act on a team member homed in another project is addressed to that project, even after it left the window', async () => {
  const detached: { id: string; projectId: number }[] = [];
  const list = open({ detach: { run: async (input: { id: string; projectId: number }) => void detached.push(input) } });
  feed.frame?.({ type: 'list', rows: [row('parent', 2), { ...row('away', 1, 'parent'), projectId: 7 }], roots: 1, windowBefore: null });

  await list.detach('away', true);
  feed.frame?.({ type: 'list', rows: [row('parent', 2)], roots: 1, windowBefore: null });
  await list.detach('away', false);
  await list.detach('parent', true);

  expect(detached.map(({ id, projectId }) => [id, projectId])).toEqual([
    ['away', 7],
    ['away', 7],
    ['parent', 1],
  ]);
});
