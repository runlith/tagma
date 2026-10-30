// @vitest-environment jsdom
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
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
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { CallActivity } from './CallActivity.svelte.js';
import HomePeek from './HomePeek.fixture.svelte';
import { threadTree } from './forest.js';
import { ThreadList } from './List.svelte.js';
import { ThreadsRepo } from './Repo.js';

const STANDING = 42;
const MEMBER = 5;

const row = {
  id: 'thread-1',
  projectId: MEMBER,
  title: 'In the other member',
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
  saidLine: 'Settled in [[5b386d76]].',
  readerOrderAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as ThreadListRow;

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

test("a thread of another group member peeks in that member's graph while the window stands in its own", () => {
  const project = (id: number) => ({ id, name: id === MEMBER ? 'tagma' : 'runlith', rootPath: `/repo-${id}` });
  app = mountShell(
    Layer.mergeAll(WallClock, Notices, ThreadNames, CommandActivity, CallActivity, ExecutionActs, Visits),
    Layer.mergeAll(
      Layer.of(ExecutionsRepo, { inventory: stubFamily(), commands: stubFamily() } as never),
      Layer.of(Workspace, soloWorkspace({ contextProject: project(STANDING), find: project, tileIdOf: () => STANDING })),
      testShellOps,
      Layer.of(Live, liveFeed().live),
      Layer.of(Door, { ask: () => Promise.reject(new Error('this suite makes no call')) } as never),
      Layer.of(ThreadList, { threads: [], busy: () => false, covers: () => true } as never),
      Layer.of(ThreadsRepo, {} as never),
      Layer.of(ThreadChats, {} as never),
      Layer.of(Favorites, { list: [] } as never),
      Layer.provide(BlockTitles, function* () {
        const aim = yield* GraphRung.Current;
        return { peer: () => ({ title: `Decision of ${aim.projectId}`, project: 'tagma' }), open: async () => undefined } as never;
      }),
      Layer.of(CommitLinks, { peer: () => undefined } as never),
      Layer.of(Opening, { knows: () => true, tip: () => ({ text: null }) } as never),
      Layer.of(UsageAccounts, { rows: [], known: false, providers: [], of: () => [], signing: () => [] } as never),
      testProviders(),
    ),
    { at: { projectId: STANDING, branch: null } },
  );
  const anchor = document.createElement('a');
  document.body.append(anchor);
  app.draw(HomePeek as never, {
    peek: {
      node: threadTree([row])[0],
      peekKey: 'peek-1',
      host: testThreadSlot(),
      places: { ...testPlaces(), known: true, placeOf: () => null },
      member: MEMBER,
      anchor,
      label: row.title,
      time: '1m',
      processes: { lines: [], joined: () => [], watch: () => () => undefined },
    },
  });
  flushSync();
  expect(document.body.querySelector('[data-thread-said]')?.textContent).toContain(`Decision of ${MEMBER}`);
});
