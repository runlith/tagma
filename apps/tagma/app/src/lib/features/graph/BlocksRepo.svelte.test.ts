// @vitest-environment jsdom
import type { TreeBlock, WrittenBlock } from '@tagma/server/graph/contract/wire/rows';
import { QueryClient } from '@tanstack/query-core';
import { mountRepo } from '@runlith/query/testing';
import { afterEach, expect, test } from 'vitest';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { testDoor } from '$lib/wire/testing.js';
import { BlocksRepo } from './BlocksRepo.js';

function json(body: unknown): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { headers: { 'content-type': 'application/json' } }), {
    arrayBuffer: async () => buffer,
  });
}

let answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const fetch = (input: RequestInfo | URL, init?: RequestInit) => answer(input, init);

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of close.splice(0)) await unmount();
});

test('creation on a branch leaves the canonical tree unchanged', async () => {
  const trees = new Map<string, TreeBlock[]>();
  answer = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const key = `${url.searchParams.get('project') ?? '1'}:${url.searchParams.get('branch') ?? ''}`;
    if (url.pathname === '/api/op/read_tree') return json({ status: 'ok', blocks: trees.get(key) ?? [] });
    if (url.pathname !== '/api/op/create_block') throw new Error(`Unexpected request ${request.url}`);
    const payload = (await request.json()) as { title: string; parentId: string };
    const row: WrittenBlock = {
      name: '1234abcd',
      projectId: 1,
      parentName: payload.parentId,
      ord: 0,
      tags: ['task'],
      fields: { status: 'open' },
      actions: { moves: [], slots: [], offers: [], revision: 'test' },
      title: payload.title,
      superseded: false,
      blocked: false,
      building: false,
      answered: false,
      deletedAt: null,
      createdAt: '2026-09-05T00:00:00Z',
      updatedAt: '2026-09-05T00:00:00Z',
      body: '',
    };
    trees.set(key, [...(trees.get(key) ?? []), row]);
    return json({ status: 'ok', block: row });
  };
  const door = testDoor(fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const open = (branch: string | null) => {
    const aim = { projectId: 1, branch };
    const mounted = mountRepo(BlocksRepo, {
      door: new GraphDoor(door, aim),
      queryClient,
      ladder: [ProjectRung, GraphRung],
      at: { project: { projectId: aim.projectId }, graph: aim },
    });
    close.push(mounted.unmount);
    return mounted.repo;
  };
  const canonical = open(null);
  const branch = open('feature/one');
  expect(await canonical.tree.loadOrThrow()).toEqual([]);
  expect(await branch.tree.loadOrThrow()).toEqual([]);
  const created = await branch.create.run({ tags: ['task'], title: 'branch child', parentId: 'abcd1234' }, { throwOnError: true });
  expect(created?.parentName).toBe('abcd1234');
  expect((await branch.tree.refresh({ throwOnError: true }))?.map((row) => row.name)).toEqual(['1234abcd']);
  expect(await canonical.tree.refresh({ throwOnError: true })).toEqual([]);
});

test.each(['single', 'keyed', 'mutation'] as const)('closing a graph aborts its in-flight %s request', async (operation) => {
  const started = Promise.withResolvers<Request>();
  answer = (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).searchParams.get('branch') !== 'a') return Promise.resolve(json({ status: 'ok', blocks: [] }));
    started.resolve(request);
    return new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    });
  };
  const door = testDoor(fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const open = (branch: string) => {
    const aim = { projectId: 5, branch };
    const mounted = mountRepo(BlocksRepo, {
      door: new GraphDoor(door, aim),
      queryClient,
      ladder: [ProjectRung, GraphRung],
      at: { project: { projectId: aim.projectId }, graph: aim },
    });
    close.push(mounted.unmount);
    return mounted;
  };
  const a = open('a');
  const b = open('b');
  const pending =
    operation === 'single'
      ? a.repo.tree.loadOrThrow()
      : operation === 'keyed'
        ? a.repo.titles.key(['1234abcd']).loadOrThrow()
        : a.repo.create.run({ tags: ['task'], title: 'in flight', parentId: 'abcd1234' }, { throwOnError: true });
  const request = await started.promise;
  expect(request.signal.aborted).toBe(false);
  await a.unmount();
  close.splice(close.indexOf(a.unmount), 1);
  expect(request.signal.aborted).toBe(true);
  expect(await pending).toBeUndefined();
  expect(await b.repo.tree.loadOrThrow()).toEqual([]);
});
