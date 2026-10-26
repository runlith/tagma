import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { expect, test } from 'vitest';
import { threadMark } from './Life.svelte';
import { runningSinceOf } from './rowKind.js';
import { isQuiet, threadTree } from './forest.js';

const row = (over: Partial<ThreadListRow> = {}): ThreadListRow =>
  ({
    id: 'thread-1',
    projectId: 1,
    scopeName: null,
    title: 'work',
    titleOrigin: 'random',
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    activeRunSelection: null,
    contextShare: null,
    cacheWarmth: null,
    liveSpellStartedAt: null,
    outcome: null,
    spawnRootId: 'thread-1',
    parentThreadId: null,
    name: null,
    agentId: 'harness',
    profileId: null,
    phase: null,
    held: { paths: 0, unproven: 0 },
    account: null,
    provider: 'external',
    model: null,
    reasoning: null,
    switches: {},
    createdBySessionId: null,
    readerOrderAt: '2026-01-01T10:00:00.000Z',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    harness: null,
    ...over,
  }) as ThreadListRow;

const finished = {
  runId: 'run-1',
  status: 'completed',
  failureReason: null,
  failure: null,
  hostStateFailure: false,
  finishedAt: '2026-01-01T10:00:00.000Z',
  isSeen: false,
} as const;

test('an unread finish marks a root alone: a child whose report went to its parent is quiet', () => {
  expect(threadMark(row({ outcome: finished })).state).toBe('unread');
  expect(threadMark(row({ outcome: finished, parentThreadId: 'parent-1' })).state).toBe('quiet');
  expect(threadMark(row({ outcome: { ...finished, isSeen: true } })).state).toBe('quiet');
});

test('a run in flight shows its own life, never the ending of the run before it', () => {
  const failed = { ...finished, status: 'failed', failureReason: 'boom' } as const;
  const running = { activeRunId: 'run-2', activeRunStartedAt: '2026-01-01T11:00:00.000Z', outcome: failed } as const;
  expect(threadMark(row({ ...running, life: 'working' })).state).toBe('working');
  expect(threadMark(row({ ...running, life: 'stalled' })).state).toBe('stalled');
  expect(threadMark(row({ ...running, life: 'awaiting' })).state).toBe('waiting');
  expect(threadMark(row({ life: 'idle', outcome: failed })).state).toBe('failed');
  for (const life of ['working', 'stalled'] as const) {
    expect(runningSinceOf(row({ ...running, life }))).toBe('2026-01-01T11:00:00.000Z');
    expect(isQuiet(threadTree([row({ ...running, life })])[0]!)).toBe(false);
  }
});
