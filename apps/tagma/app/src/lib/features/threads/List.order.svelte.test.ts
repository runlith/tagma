// @vitest-environment jsdom

import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { Layer } from '@runlith/layer/Layer';
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

let app: TestApp | undefined;
const feed = liveFeed();
const roots = vi.fn();

function open(): ThreadList {
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(
      Layer.of(ThreadsRepo, threadsRepo({ roots: keyedBy(roots) })),
      Layer.of(ExecutionsRepo, {} as never),
      Layer.of(Live, feed.live),
      Layer.of(ThreadOnScreen, { page: null, host: null, shown: [] } as never),
    ),
  );
  return app.app.resolve(ThreadList);
}

async function close(): Promise<void> {
  if (app) await app.unmount();
  app = undefined;
  feed.frame = null;
}

afterEach(async () => {
  await close();
  roots.mockReset();
});

const row = (
  id: string,
  order: number,
  parentThreadId: string | null = null,
  life: RunLife = 'idle',
  runStartedAt = '2026-01-01T00:00:00.000Z',
  spellStartedAt = runStartedAt,
): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life,
  activeRunId: life === 'idle' ? null : `run:${id}`,
  activeRunStartedAt: life === 'idle' ? null : runStartedAt,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: life === 'idle' ? null : spellStartedAt,
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

const drawn = (list: ThreadList): readonly string[] => list.tree.map((node) => node.row.id);

test('reader words on a quiet thread move nothing, and the top arrives when the last agent goes quiet', async () => {
  const watched = row('watched', 1);
  const helper = row('helper', 1, watched.id, 'working');
  const quiet = row('quiet', 2);
  let rows: readonly ThreadListRow[] = [watched, helper, quiet];
  roots.mockImplementation(async () => ({
    rows,
    roots: rows.filter((entry) => entry.parentThreadId === null).length,
    windowBefore: null,
  }));

  const list = open();
  feed.frame?.({ type: 'list', rows, roots: 2, windowBefore: null });
  expect(drawn(list)).toEqual(['watched', 'quiet']);

  const written = { ...quiet, readerOrderAt: '2026-01-01T02:00:00.000Z' };
  rows = [watched, helper, written];
  feed.frame?.({ type: 'row', row: written });
  expect(drawn(list)).toEqual(['watched', 'quiet']);

  const finished = {
    ...helper,
    life: 'idle' as const,
    activeRunId: null,
    activeRunStartedAt: null,
    liveSpellStartedAt: null,
  };
  rows = [watched, finished, written];
  feed.frame?.({ type: 'row', row: finished });
  await waitFor(() => expect(drawn(list)).toEqual(['quiet', 'watched']));
});

test('a heartbeat, a tool row and an outcome leave the drawn order identical', () => {
  const worker = row('worker', 1, null, 'working');
  const quiet = row('quiet', 2);
  const rows = [worker, quiet];
  roots.mockResolvedValue({ rows, roots: 2, windowBefore: null });

  const list = open();
  feed.frame?.({ type: 'list', rows, roots: 2, windowBefore: null });
  expect(drawn(list)).toEqual(['worker', 'quiet']);

  feed.frame?.({ type: 'row', row: { ...worker, updatedAt: '2026-01-01T03:00:00.000Z' } });
  feed.frame?.({ type: 'row', row: { ...worker, phase: { toolName: 'read', state: 'running', title: 'threadTree.ts' } } });
  feed.frame?.({
    type: 'row',
    row: {
      ...quiet,
      outcome: {
        runId: 'run:quiet',
        status: 'completed',
        failureReason: null,
        failure: null,
        hostStateFailure: false,
        finishedAt: '2026-01-01T03:00:00.000Z',
        isSeen: true,
      },
    },
  });

  expect(drawn(list)).toEqual(['worker', 'quiet']);
});

test('the drawn order is a function of the rows, so a reload and a second window agree', async () => {
  const watched = row('watched', 1);
  const helper = row('helper', 1, watched.id, 'working');
  const quiet = row('quiet', 5);
  const over = async (rows: readonly ThreadListRow[]): Promise<readonly string[]> => {
    await close();
    const list = open();
    feed.frame?.({ type: 'list', rows, roots: 2, windowBefore: null });
    return drawn(list);
  };

  expect(await over([watched, helper, quiet])).toEqual(['watched', 'quiet']);
  expect(await over([quiet, helper, watched])).toEqual(['watched', 'quiet']);
});
