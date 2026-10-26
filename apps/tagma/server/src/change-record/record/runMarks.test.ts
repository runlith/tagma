import { expect, test } from 'bun:test';
import type { StatusPublished } from '../../thread-record/contract/service/records.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { runEnded } from './runMarks.js';

const moved = (
  fromRunId: string | null,
  runningRunId: string | null,
  status: StatusPublished['status'] = runningRunId === null ? 'idle' : 'running',
): StatusPublished => ({
  threadId: 'thread' as ThreadId,
  status,
  fromRunId,
  runningRunId,
});

test('a start is no end', () => {
  expect(runEnded(moved(null, 'run-1'))).toBe(false);
});

test('a status move that leaves the run standing is no end', () => {
  expect(runEnded(moved('run-1', 'run-1', 'idle'))).toBe(false);
  expect(runEnded(moved(null, null, 'failed'))).toBe(false);
});

test('a run moving to none is its end', () => {
  expect(runEnded(moved('run-1', null))).toBe(true);
});

test('a run replaced by the next is the first run’s end', () => {
  expect(runEnded(moved('run-1', 'run-2'))).toBe(true);
});
