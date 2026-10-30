// @vitest-environment jsdom
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { ThreadChats } from './ThreadChats.js';
import { Favorites } from './Favorites.svelte.js';
import { liveFeed, mountShell, soloWorkspace, type TestApp, testShellOps, testPlaces } from '$lib/app/testing.js';
import { testThreadSlot } from '$lib/app/slotWorld.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { testProviders } from '$lib/features/providers/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import { ExecutionActs } from '$lib/features/executions/acts.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { CallActivity } from './CallActivity.svelte.js';
import ThreadPeek from './Peek.svelte';
import { threadTree } from './forest.js';
import { ThreadList } from './List.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';

const row = {
  id: 'thread-1',
  projectId: 1,
  title: 'In a tree',
  titleOrigin: 'random',
  life: 'idle',
  activeRunId: null,
  contextShare: null,
  cacheWarmth: null,
  outcome: null,
  spawnRootId: 'thread-1',
  parentThreadId: null,
  name: null,
  agentId: 'tagma',
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  account: null,
  provider: 'subscription',
  model: 'claude-opus-5',
  reasoning: null,
  switches: {},
  pinnedAt: null,
  archivedAt: null,
  readerOrderAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as ThreadListRow;

const tree = { rootId: 'tree', kind: 'tagma', name: 'tagma-wt', branch: 'tagma/wt', hue: 2 } as unknown as WorktreePlace;

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

const recapOf = (status: 'current' | 'stale' | 'void') => ({
  summary: 'Settled the search design.',
  next: 'Write the tasks.',
  generatedAt: '2026-01-01T00:00:00.000Z',
  status,
});

function peek(
  placeOf: (threadId: string) => WorktreePlace | null,
  recap: ReturnType<typeof recapOf> | null = null,
  saidLine: string | null = null,
  member: number | null = null,
): HTMLElement {
  app = mountShell(
    Layer.mergeAll(WallClock, Notices, ThreadNames, CommandActivity, CallActivity, ExecutionActs),
    Layer.mergeAll(
      Layer.of(ExecutionsRepo, { inventory: stubFamily(), commands: stubFamily() } as never),
      Layer.of(Workspace, soloWorkspace({ contextProject: { rootPath: '/repo' }, find: () => ({ rootPath: '/repo' }) })),
      testShellOps,
      Layer.of(Live, liveFeed().live),
      Layer.of(Door, { ask: () => Promise.reject(new Error('this suite makes no call')) } as never),
      Layer.of(ThreadList, { threads: [], busy: () => false } as never),
      Layer.of(ThreadsRepo, {} as never),
      Layer.of(ThreadChats, {} as never),
      Layer.of(Favorites, { list: [] } as never),
      Layer.of(BlockTitles, { peer: () => undefined } as never),
      Layer.of(CommitLinks, { peer: () => undefined } as never),
      Layer.of(Opening, { knows: () => true, tip: () => ({ text: null }) } as never),
      Layer.of(UsageAccounts, { rows: [], known: false, providers: [], of: () => [], signing: () => [] } as never),
      testProviders(),
    ),
  );
  const anchor = document.createElement('a');
  document.body.append(anchor);
  app.draw(ThreadPeek as never, {
    node: threadTree([recap === null ? { ...row, saidLine } : { ...row, saidLine, recap }])[0],
    peekKey: 'peek-1',
    host: testThreadSlot(),
    places: { ...testPlaces(), known: true, placeOf },
    member,
    anchor,
    label: row.title,
    time: '1m',
    processes: { lines: [], joined: () => [], watch: () => () => undefined },
  });
  flushSync();
  return document.body;
}

test('the peek names the worktree the listing places the thread in, the one its group and chip read', () => {
  const page = peek((threadId) => (threadId === 'thread-1' ? tree : null));
  const cell = page.querySelector('[data-thread-peek-worktree]');
  expect(cell?.getAttribute('data-thread-peek-worktree')).toBe('tagma-wt');
});

test('a thread of another member names that member and still the worktree it stands in there', () => {
  const page = peek((threadId) => (threadId === 'thread-1' ? tree : null), null, null, 2);
  expect(page.querySelector('[data-project-mark]')?.getAttribute('data-project-mark')).toBe('2');
  expect(page.querySelector('[data-thread-peek-worktree]')?.getAttribute('data-thread-peek-worktree')).toBe('tagma-wt');
});

test('a thread the listing places in no tree reads as none, never as main', () => {
  const page = peek(() => null);
  expect(page.querySelector('[data-thread-peek-worktree]')?.getAttribute('data-thread-peek-worktree')).toBe('');
});

test('a current recap stands under the title in place of the last said line', () => {
  const page = peek(() => null, recapOf('current'), 'Done with the search.');
  const shown = page.querySelector('[data-thread-peek-recap]');
  expect(shown?.textContent).toContain('Settled the search design.');
  expect(shown?.textContent).toContain('Write the tasks.');
  expect(page.querySelector('[data-thread-said]')).toBeNull();
});

test('a recap that messages have outrun gives way to the last said line', () => {
  const page = peek(() => null, recapOf('stale'), 'Done with the search.');
  expect(page.querySelector('[data-thread-peek-recap]')).toBeNull();
  expect(page.querySelector('[data-thread-said]')?.textContent).toContain('Done with the search.');
});

test('a void recap leaves the peek without one', () => {
  expect(peek(() => null, recapOf('void')).querySelector('[data-thread-peek-recap]')).toBeNull();
});

test('a thread with no recap leaves the peek without one', () => {
  expect(peek(() => null).querySelector('[data-thread-peek-recap]')).toBeNull();
});
