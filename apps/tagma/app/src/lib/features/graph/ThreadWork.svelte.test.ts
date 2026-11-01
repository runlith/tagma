// @vitest-environment jsdom
import type { ThreadWork as Work } from '@tagma/server/graph/contract/wire/threadWork';
import type { threadWorkFrameSchema } from '@tagma/server/graph/contract/wire/feed';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { Router } from '@runlith/layer/Router';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { observe } from '@runlith/query/test-utils/observe.svelte';
import { QueryClient } from '@tanstack/query-core';
import { afterEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ShellOps } from '$lib/features/workspace/ShellOps.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { loadCatalog, TestCatalog } from '$lib/wire/testing.js';
import { ThreadWork } from './ThreadWork.svelte.js';
import { ThreadWorkRepo } from './ThreadWorkRepo.js';

await loadCatalog();

const THREAD = 'thread-1';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

const close: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const stop of close.splice(0)) await stop();
});

const held = (title: string, spec = 'Floors stand'): Work => ({
  copies: [{ projectId: 1, project: 'shop', branch: null }],
  unread: [],
  works: [{ copy: 0, name: '9ac665e5', title, tags: ['task'], status: 'in_work', spec: { name: '5c12013b', title: spec, tags: ['spec'] } }],
  did: [],
  total: 0,
  next: null,
});

type WorkFrame = typeof threadWorkFrameSchema.Type;

const change = (own: boolean, names: readonly string[] = []): WorkFrame => ({ type: 'change', own, names });

test('a thread’s work, followed by one feed however many surfaces show it, is read again on an act of that thread or on a block or spec it shows', async () => {
  let answer = held('Lay the floor');
  const feeds: ((frame: WorkFrame) => void)[] = [];
  const app = mountApp(
    Layer.mergeAll(ThreadWorkRepo, ThreadWork, Door),
    Layer.mergeAll(
      Layer.of(Cache, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      Layer.of(Platform, makePlatform({ fetch: async () => json({ status: 'ok', ...answer }) })),
      TestCatalog,
      ServerOrigin.of('http://localhost'),
      Layer.of(Router, makeRouter()),
      Layer.of(Notices, {} as never),
      Layer.of(ShellOps, {} as never),
      Layer.of(Live, {
        hold: (_open: unknown, frame: (frame: WorkFrame) => void) => {
          feeds.push(frame);
          return { unsubscribe: () => feeds.splice(feeds.indexOf(frame), 1) };
        },
      } as never),
    ),
    { ladder: [] },
  );
  close.push(() => app.unmount());
  const work = app.get(ThreadWork);
  const query = work.of(1, THREAD);
  close.push(observe(() => query.data));
  await waitUntil(() => query.data?.works[0]?.title === 'Lay the floor');
  close.push(work.follow(1, THREAD, query.data!.copies, () => query.data));
  close.push(work.follow(1, THREAD, query.data!.copies, () => query.data));
  expect(feeds).toHaveLength(1);

  answer = held('Lay the floor tiles');
  feeds[0]!(change(true));
  await waitUntil(() => query.data?.works[0]?.title === 'Lay the floor tiles');

  answer = held('Lay the floor tiles', 'Floors stand level');
  feeds[0]!(change(false, ['5c12013b']));
  await waitUntil(() => query.data?.works[0]?.spec?.title === 'Floors stand level');

  answer = { ...held('Lay the floor tiles'), works: [] };
  feeds[0]!(change(false, ['9ac665e5']));
  await waitUntil(() => query.data?.works.length === 0);
});
