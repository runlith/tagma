import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { expect, test } from 'vitest';
import { nodeIndex } from './tree.js';
import { threadTree } from './forest.js';
import { crewOf } from './team.js';

const crew = (rows: readonly ThreadListRow[], parentId: string) => crewOf(nodeIndex(threadTree(rows)).get(parentId));

const row = (id: string, parentThreadId: string | null, over: { life?: RunLife; startedAt?: string } = {}): ThreadListRow => ({
  id,
  projectId: 1,
  scopeName: null,
  title: id,
  titleOrigin: 'random',
  life: over.life ?? 'idle',
  activeRunId: null,
  activeRunStartedAt: over.startedAt ?? null,
  activeRunSelection: null,
  contextShare: null,
  cacheWarmth: null,
  liveSpellStartedAt: null,
  outcome: null,
  spawnRootId: 'root',
  parentThreadId,
  name: id,
  agentId: 'tagma',
  profileId: null,
  harness: null,
  cli: null,
  capabilities: NATIVE_CAPABILITIES,
  phase: null,
  held: { paths: 0, unproven: 0 },
  provider: 'subscription',
  account: null,
  processAccount: null,
  model: null,
  reasoning: null,
  switches: {},
  createdBySessionId: null,
  readerOrderAt: '2026-01-01T00:00:00.000Z',
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('the crew is every direct child with a run going, earliest run first, out of all the children', () => {
  const read = crew(
    [
      row('parent', null),
      row('late', 'parent', { life: 'working', startedAt: '2026-01-01T10:05:00.000Z' }),
      row('done', 'parent'),
      row('stuck', 'parent', { life: 'stalled', startedAt: '2026-01-01T09:00:00.000Z' }),
      row('asking', 'parent', { life: 'awaiting', startedAt: '2026-01-01T10:00:00.000Z' }),
      row('grandchild', 'late', { life: 'working', startedAt: '2026-01-01T08:00:00.000Z' }),
    ],
    'parent',
  );

  expect(read.running.map((node) => node.row.id)).toEqual(['stuck', 'asking', 'late']);
  expect(read.total).toBe(4);
});
