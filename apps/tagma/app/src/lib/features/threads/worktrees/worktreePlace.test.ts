import { expect, test } from 'vitest';
import { feedRecord } from '../native/feedRecords.js';

const at = '2026-09-24T00:00:00.000Z';

test('decoded worktree records project to move and place rows without normalizing their body', () => {
  expect(feedRecord({ type: 'worktree', id: 'moved', event: 'moved', rootId: 'root-b', occurredAt: at })).toMatchObject([
    { kind: 'product', product: 'worktree-move', payload: { rootId: 'root-b', status: 'published', detail: null } },
  ]);
  const entry = {
    type: 'worktree',
    id: 'setup',
    event: 'setup',
    rootId: 'root-b',
    setup: 'failed',
    step: 'run',
    execution: { installation: 'here', execution: 'exec-1', incarnation: 2 },
    reason: 'exit 3',
    occurredAt: at,
    updatedAt: at,
  };
  expect(feedRecord(entry)).toMatchObject([{ kind: 'product', product: 'worktree-place', payload: entry }]);
});
