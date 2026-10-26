// @vitest-environment jsdom
import type { CleanupCandidate } from '@tagma/server/worktrees/contract/wire/cleanup';
import { Scope } from '@runlith/layer/Scope';
import { expect, test } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Cleanup } from './Cleanup.svelte.js';

const merged = {
  rootId: 'root-merged',
  name: 'search-notes',
  folder: '/tmp/search-notes',
  branch: 'search-notes',
  hue: 1,
  reason: 'merged',
  idleDays: 0,
  blockers: [],
} as unknown as CleanupCandidate;

test('a clean-up that took the last candidate answers its result, and never that there was nothing to clean up', async () => {
  const scope = Scope.make();
  let standing: readonly CleanupCandidate[] = [merged];
  const repo = {
    cleanup: { run: async () => ({ candidates: standing, total: standing.length, next: null }) },
    clean: {
      run: async () => {
        standing = [];
        return { worktrees: [{ rootId: 'root-merged', name: 'search-notes', outcome: 'deleted', refusal: null, ended: [] }] };
      },
    },
  };
  const finishing = { consented: async () => false, readStanding: async () => null };
  const cleanup = new Cleanup({ projectId: 1 }, repo as never, finishing as never, new Notices(scope), scope);

  cleanup.show();
  await new Promise((settled) => setTimeout(settled, 0));
  expect(cleanup.nothing).toBe(false);
  cleanup.toggle('root-merged');
  await cleanup.clean();

  expect(cleanup.outcomes.map((one) => [one.name, one.outcome])).toEqual([['search-notes', 'deleted']]);
  expect(cleanup.candidates).toEqual([]);
  expect(cleanup.nothing).toBe(false);
  expect(cleanup.listed).toBe(false);
  await scope.close();
});
