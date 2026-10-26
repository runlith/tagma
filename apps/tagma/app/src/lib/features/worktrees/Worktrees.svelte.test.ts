import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { liveFeed } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { Worktrees } from './BoardState.svelte.js';

type Created = { status: 'ready' | 'failed' | 'uncertain'; rootId: string | null };

const focused = (): ProjectFocus => new ProjectFocus(() => ({ projectId: 1 }), { projectId: 1 });

const row = (rootId: string, kind: WorktreePlace['kind']): WorktreePlace => ({
  index: kind === 'main' ? 0 : 1,
  rootId: rootId as WorktreePlace['rootId'],
  kind,
  name: rootId,
  folder: `/repo/${rootId}`,
  branch: rootId,
  base: null,
  hue: null,
  head: 'abcdef',
  headTime: 0,
  missing: false,
  threads: [],
  agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
  setup: 'none',
  taskId: null,
  pending: null,
  movedAt: null,
});

function standing(created: Created) {
  const scope = Scope.make();
  const feed = liveFeed();
  const prepared: string[] = [];
  const repo = {
    stores: { run: async () => ({ repositories: [{ binding: { repositoryId: 'store', locationRevision: 0 } }] }) },
    prepare: {
      run: async (input: { operationId: string }) => {
        prepared.push(input.operationId);
        return {};
      },
    },
    create: { run: async () => ({ ...created, evidence: null }) },
  };
  const worktrees = new Worktrees(
    { projectId: 1 },
    feed.live,
    makeRouter(),
    focused(),
    repo as never,
    new Notices(scope),
    scope,
    new Failure(() => undefined),
  );
  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 1, places: [row('main', 'main')], elsewhere: [] });
  return { worktrees, feed, prepared };
}

test('a thread started into a new worktree stands in the creation, by name before its id is known, until the listing names it', async () => {
  const { worktrees, feed } = standing({ status: 'ready', rootId: null });
  let answer: (id: string) => void = () => undefined;
  const started = worktrees.placing(
    'new worktree',
    () => new Promise<string>((done) => (answer = done)),
    (id) => id,
    () => undefined,
    'quiet-otter',
  );

  expect(worktrees.creatingOf({ id: 'born', name: 'quiet-otter' })?.label).toBe('new worktree');
  expect(worktrees.creatingOf({ id: 'other', name: 'loud-crow' })).toBe(null);
  answer('born');
  await started;
  expect(worktrees.standingOf('born')?.kind).toBe('creating');
  expect(worktrees.placeOf('born')).toBe(null);

  const made = { ...row('made', 'tagma'), threads: ['born'] } as WorktreePlace;
  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 2, places: [row('main', 'main'), made], elsewhere: [] });
  expect(worktrees.standingOf('born')).toEqual({ kind: 'row', row: made });
  expect(worktrees.creations).toEqual([]);
});

test('a thread whose tree left the listing reads deleted with the branch its records name, never main', () => {
  const { worktrees, feed } = standing({ status: 'ready', rootId: null });
  feed.frame?.({
    kind: 'list',
    rows: [],
    start: 0,
    total: 1,
    places: [row('main', 'main')],
    elsewhere: [
      { threadId: 'live', rootId: 'gone' },
      { threadId: 'cleared', rootId: null },
    ],
  });

  expect(worktrees.standingOf('live', { rootId: 'gone', branch: 'tagma/demo' })).toEqual({
    kind: 'deleted',
    rootId: 'gone',
    branch: 'tagma/demo',
  });
  expect(worktrees.standingOf('cleared')).toEqual({ kind: 'nowhere' });
  expect(worktrees.standingOf('put-away', { rootId: 'gone', branch: 'tagma/demo' })?.kind).toBe('deleted');
  expect(worktrees.standingOf('put-away', { rootId: 'main', branch: null })?.kind).toBe('row');
});

test('a made worktree keeps its placeholder until the listing carries its root', async () => {
  const { worktrees, feed } = standing({ status: 'ready', rootId: 'made' });

  expect(await worktrees.create('tagma/made', 'main')).toBe('made');
  expect(worktrees.creations.map((creation) => creation.rootId)).toEqual(['made']);
  expect(worktrees.several).toBe(true);

  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 2, places: [row('main', 'main'), row('made', 'tagma')], elsewhere: [] });
  expect(worktrees.creations).toEqual([]);
});

test('a thread stands in the row naming it, nowhere when the listing places it elsewhere, and in main otherwise', () => {
  const { worktrees, feed } = standing({ status: 'ready', rootId: 'made' });
  const made = { ...row('made', 'tagma'), threads: ['in-tree'] } as WorktreePlace;
  feed.frame?.({
    kind: 'list',
    rows: [],
    start: 0,
    total: 2,
    places: [row('main', 'main'), made],
    elsewhere: [
      { threadId: 'gone-tree', rootId: 'removed' },
      { threadId: 'cleared', rootId: null },
    ],
  });

  expect(worktrees.placeOf('in-tree')?.rootId).toBe('made');
  expect(worktrees.placeOf('gone-tree')).toBe(null);
  expect(worktrees.placeOf('cleared')).toBe(null);
  expect(worktrees.placeOf('never-placed')?.rootId).toBe('main');
});

test('a creation git refused offers a retry under a fresh operation, and an uncertain one offers none', async () => {
  const refused = standing({ status: 'failed', rootId: null });
  expect(await refused.worktrees.create('tagma/refused', 'main')).toBe(null);
  const failed = refused.worktrees.creations[0];
  expect(failed?.phase).toBe('failed');
  failed?.retry?.();
  await new Promise((settled) => setTimeout(settled, 0));
  expect(new Set(refused.prepared).size).toBe(2);

  const unsure = standing({ status: 'uncertain', rootId: null });
  await unsure.worktrees.create('tagma/unsure', 'main');
  expect(unsure.worktrees.creations[0]?.phase).toBe('failed');
  expect(unsure.worktrees.creations[0]?.retry).toBe(null);
});

test('the board aims at the address’s branch only while its project is the window’s', () => {
  const at = $state({ projectId: 1 });
  const scope = Scope.make();
  const feed = liveFeed();
  const worktrees = new Worktrees(
    { projectId: 1 },
    feed.live,
    makeRouter({ url: new URL('http://localhost/p1?branch=side') }),
    new ProjectFocus(() => at, { projectId: 1 }),
    {} as never,
    new Notices(scope),
    scope,
    new Failure(() => undefined),
  );
  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 2, places: [row('main', 'main'), row('side', 'tagma')], elsewhere: [] });
  expect(worktrees.aimed?.rootId).toBe('side');

  at.projectId = 2;
  expect(worktrees.aimed).toBe(null);
});

test('an address naming a branch no worktree stands on strays once the listing is known, unless a creation of that branch is under way', async () => {
  const scope = Scope.make();
  const feed = liveFeed();
  const router = makeRouter({ url: new URL('http://localhost/p1?branch=merged') });
  const repo = {
    stores: { run: async () => ({ repositories: [{ binding: { repositoryId: 'store', locationRevision: 0 } }] }) },
    prepare: { run: async () => ({}) },
    create: { run: async () => ({ status: 'ready', rootId: 'made', evidence: null }) },
  };
  const worktrees = new Worktrees(
    { projectId: 1 },
    feed.live,
    router,
    focused(),
    repo as never,
    new Notices(scope),
    scope,
    new Failure(() => undefined),
  );
  expect(worktrees.stray).toBe(false);

  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 1, places: [row('main', 'main')], elsewhere: [] });
  expect(worktrees.stray).toBe(true);

  await worktrees.checkout('merged');
  expect(worktrees.stray).toBe(false);
});

test('a listing the server refuses is kept as a reason and is not reported as a failure of the app', () => {
  const scope = Scope.make();
  const feed = liveFeed();
  const reported: unknown[] = [];
  const worktrees = new Worktrees(
    { projectId: 1 },
    feed.live,
    makeRouter(),
    focused(),
    {} as never,
    new Notices(scope),
    scope,
    new Failure((error) => reported.push(error)),
  );
  feed.ended?.({ kind: 'subscription', message: 'This repository has no commit yet.', code: 'repository-unborn', unblock: [] });
  expect(worktrees.known).toBe(false);
  expect(worktrees.unread).not.toBe(null);
  expect(reported).toEqual([]);
});

test('a listing that breaks off after its rows keeps them, names why it stopped, and reports a failure that carries no refusal', () => {
  const reported: unknown[] = [];
  const scope = Scope.make();
  const feed = liveFeed();
  const worktrees = new Worktrees(
    { projectId: 1 },
    feed.live,
    makeRouter(),
    focused(),
    {} as never,
    new Notices(scope),
    scope,
    new Failure((error) => reported.push(error)),
  );
  feed.frame?.({ kind: 'list', rows: [], start: 0, total: 2, places: [row('main', 'main'), row('side', 'tagma')], elsewhere: [] });

  feed.ended?.({ kind: 'subscription', message: 'the worktree folder could not be read' });

  expect(worktrees.rows.map((one) => one.rootId)).toEqual(['main', 'side']);
  expect(worktrees.unread).toBe('the worktree folder could not be read');
  expect(reported).toHaveLength(1);
});
