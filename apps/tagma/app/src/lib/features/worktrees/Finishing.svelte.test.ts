// @vitest-environment jsdom
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { expect, test } from 'vitest';
import { idleDays } from './Finishing.svelte.js';

const row = (rootId: string, kind: WorktreePlace['kind'], over: Partial<WorktreePlace> = {}): WorktreePlace =>
  ({
    rootId,
    kind,
    name: rootId,
    branch: rootId,
    base: kind === 'tagma' ? { branch: 'main', commit: 'c0ffee' } : null,
    threads: [],
    agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
    missing: false,
    movedAt: '2026-09-24T12:00:00.000Z',
    ...over,
  }) as unknown as WorktreePlace;

test('the idle hint counts whole days since the last movement, and only for a worktree Tagma made that nobody works in', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  expect(idleDays(row('tree', 'tagma'), now)).toBe(6);
  expect(idleDays(row('tree', 'tagma', { movedAt: '2026-09-27T12:00:00.000Z' }), now)).toBe(null);
  expect(idleDays(row('tree', 'tagma', { agents: { working: 1, waiting: 0, finished: 0, standing: 1 } }), now)).toBe(null);
  expect(idleDays(row('tree', 'tagma', { missing: true }), now)).toBe(null);
  expect(idleDays(row('main', 'main'), now)).toBe(null);
});
