// @vitest-environment jsdom
import { QueryClient } from '@tanstack/query-core';
import { mountRepo } from '@runlith/query/testing';
import { afterEach, expect, test } from 'vitest';
import { testDoor } from '$lib/wire/testing.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { TileRung } from '$lib/features/workspace/TileRung.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { JournalRepo } from './JournalRepo.js';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

const sent: Record<string, unknown>[] = [];
const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  sent.push((await request.json()) as Record<string, unknown>);
  return json({ status: 'ok', batches: [], blocks: [], sessions: [], nextBefore: null });
};

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of close.splice(0)) await unmount();
  sent.length = 0;
});

const open = () => {
  const aim = { projectId: 1, branch: null };
  const mounted = mountRepo(JournalRepo, {
    door: new GraphDoor(testDoor(fetch), aim),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    ladder: [TileRung, ProjectRung, GraphRung],
    at: { tile: { tileId: aim.projectId }, project: { projectId: aim.projectId }, graph: aim },
  });
  close.push(mounted.unmount);
  return mounted.repo;
};

test('an empty pick list leaves the read unnarrowed, since an empty list narrows to nothing', async () => {
  await open().batches.key({ tags: [], sessions: [], ops: [], limit: 100 }).refresh({ throwOnError: true });
  expect(sent).toEqual([{ limit: 100 }]);
});

test('a picked list narrows the read as picked', async () => {
  await open()
    .batches.key({ tags: ['idea'], sessions: [7], ops: [], limit: 100 })
    .refresh({ throwOnError: true });
  expect(sent).toEqual([{ limit: 100, tags: ['idea'], sessions: [7] }]);
});
