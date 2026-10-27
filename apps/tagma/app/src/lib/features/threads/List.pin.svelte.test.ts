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
  pinnedAt: string | null = null,
): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life,
  activeRunId: life === 'idle' ? null : `run:${id}`,
  activeRunStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
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
  liveSpellStartedAt: life === 'idle' ? null : '2026-01-01T00:00:00.000Z',
  pinnedAt,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const drawn = (list: ThreadList): readonly string[] => list.tree.map((node) => node.row.id);

test('a pinned tree holds the top through reader words, a working neighbour, and a reload', async () => {
  const held = row('held', 1, null, 'idle', '2026-01-01T09:00:00.000Z');
  const worker = row('worker', 2, null, 'working');
  const quiet = row('quiet', 3);
  let rows: readonly ThreadListRow[] = [held, worker, quiet];
  roots.mockImplementation(async () => ({ rows, roots: rows.length, windowBefore: null }));

  let list = open();
  feed.frame?.({ type: 'list', rows, roots: 3, windowBefore: null });
  expect(drawn(list)).toEqual(['held', 'worker', 'quiet']);

  const written = { ...quiet, readerOrderAt: '2026-01-01T04:00:00.000Z' };
  rows = [held, worker, written];
  feed.frame?.({ type: 'row', row: written });
  feed.frame?.({ type: 'row', row: { ...worker, phase: { toolName: 'read', state: 'running', title: 'x.ts' } } });
  expect(drawn(list)).toEqual(['held', 'worker', 'quiet']);

  await close();
  list = open();
  feed.frame?.({ type: 'list', rows: [written, worker, held], roots: 3, windowBefore: null });
  expect(drawn(list)).toEqual(['held', 'worker', 'quiet']);
});

test('releasing the last pinned sub-agent under an old root re-reads the window, so the root it held leaves', async () => {
  const old = row('old', 1);
  const kept = row('kept', 2, 'old', 'idle', '2026-01-01T09:00:00.000Z');
  const fresh = row('fresh', 30);
  roots.mockResolvedValue({ rows: [old, kept, fresh], roots: 9, windowBefore: fresh.readerOrderAt });

  const list = open();
  feed.frame?.({ type: 'list', rows: [old, kept, fresh], roots: 9, windowBefore: fresh.readerOrderAt });
  expect(drawn(list)).toEqual(expect.arrayContaining(['old', 'fresh']));

  roots.mockResolvedValue({ rows: [fresh], roots: 9, windowBefore: fresh.readerOrderAt });
  feed.frame?.({ type: 'row', row: { ...kept, pinnedAt: null } });

  await waitFor(() => expect(drawn(list)).toEqual(['fresh']));
});

test('a released pin re-reads the window, so a row it alone was holding on screen leaves', async () => {
  const held = row('held', 1, null, 'idle', '2026-01-01T09:00:00.000Z');
  const fresh = row('fresh', 30);
  roots.mockResolvedValue({ rows: [held, fresh], roots: 9, windowBefore: fresh.readerOrderAt });

  const list = open();
  feed.frame?.({ type: 'list', rows: [held, fresh], roots: 9, windowBefore: fresh.readerOrderAt });
  expect(drawn(list)).toEqual(['held', 'fresh']);

  roots.mockResolvedValue({ rows: [fresh], roots: 9, windowBefore: fresh.readerOrderAt });
  feed.frame?.({ type: 'row', row: { ...held, pinnedAt: null } });

  await waitFor(() => expect(drawn(list)).toEqual(['fresh']));
});
