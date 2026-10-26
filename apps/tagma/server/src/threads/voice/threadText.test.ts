import { expect, test } from 'bun:test';
import type { ThreadFacts } from '../contract/wire/evidence.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { threadFactsLine } from './threadText.js';

const row = (outcome: ThreadFacts['outcome']): ThreadFacts => ({
  id: ThreadId.make('thread-1'),
  title: 'Claude Code launch',
  agentId: 'harness:claude-code',
  name: null,
  parentThreadId: null,
  spawnRootId: 'thread-1',
  status: 'failed',
  activeRunId: null,
  outcome,
  thread: { provider: 'subscription', model: null, reasoning: null },
  run: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T01:00:00.000Z',
  readerOrderAt: '2026-09-14T01:00:00.000Z',
  pinnedAt: null,
  archivedAt: null,
  harness: null,
});

test('a failed thread names its failure reason on its line', () => {
  const line = threadFactsLine(
    row({ runId: 'run-1', status: 'failed', failureReason: 'the old host still holds live work', finishedAt: '2026-09-14T01:00:00.000Z' }),
  );
  expect(line).toContain('[failed]');
  expect(line).toContain('the old host still holds live work');
});

test('any other ending leaves the line as it was', () => {
  const line = threadFactsLine(row({ runId: 'run-1', status: 'completed', failureReason: null, finishedAt: '2026-09-14T01:00:00.000Z' }));
  expect(line).toContain('[completed]');
  expect(line).not.toContain('failure details unavailable');
});
