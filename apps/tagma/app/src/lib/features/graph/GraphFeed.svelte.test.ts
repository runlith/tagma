// @vitest-environment jsdom
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import type { Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { Router } from '@runlith/layer/Router';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { QueryClient } from '@tanstack/query-core';
import { afterEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { testTagCatalog } from '$lib/app/testing.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { SessionRegistry } from './SessionRegistry.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Door } from '$lib/wire/Door.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { BlocksRepo } from './BlocksRepo.js';
import { GraphFeed } from './Feed.js';
import { JournalRepo } from './JournalRepo.js';
import { SessionsRepo } from './SessionsRepo.js';
import { TagCatalog } from './TagCatalog.svelte.js';
import { loadOperations } from '$lib/wire/operation.js';

await loadOperations();

function json(body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { ...init, headers: { 'content-type': 'application/json' } }), {
    arrayBuffer: async () => buffer,
  });
}

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of close.splice(0)) await unmount();
});

let respond: (url: URL) => Promise<Response>;
const fetch = (input: RequestInfo | URL, init?: RequestInit) => respond(new URL(new Request(input, init).url));

function open(answer: (url: URL) => Promise<Response>, readTags?: () => Promise<Vocabulary | undefined>) {
  let receive: ((frame: GraphFrame) => void) | undefined;
  const failures: unknown[] = [];
  const tags = testTagCatalog(1, readTags);
  respond = answer;
  const app = mountApp(
    Layer.mergeAll(SessionRegistry, ReaderMarks, SessionsRepo, JournalRepo, BlocksRepo, GraphFeed, GraphDoor, Door),
    Layer.mergeAll(
      Layer.of(Cache, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      Layer.of(Platform, makePlatform({ fetch })),
      ServerOrigin.of('http://localhost'),
      Layer.of(Router, makeRouter()),
      Layer.of(TagCatalog, tags),
      Layer.of(
        Failure,
        new Failure((error) => {
          failures.push(error);
        }),
      ),
      Layer.of(Live, {
        hold: (_open: unknown, frame: (frame: GraphFrame) => void) => {
          receive = frame;
          return {
            unsubscribe: () => {
              receive = undefined;
            },
          };
        },
      } as never),
    ),
    { ladder: [ProjectRung, GraphRung], at: { project: { projectId: 1 }, graph: { projectId: 1, branch: 'feature/one' } } },
  );
  close.push(() => app.unmount());
  return {
    app,
    failures,
    tags,
    frame: (frame: GraphFrame) => {
      if (!receive) throw new Error('No graph subscription');
      receive(frame);
    },
  };
}

const session = (id: number) => ({
  id,
  harness: 'tagma',
  key: `thread-${id}`,
  thread: `thread-${id}`,
  title: null,
  name: null,
  createdAt: '2026-09-05T00:00:00Z',
});
const writers = (sessions: ReturnType<typeof session>[]) => ({
  status: 'ok',
  sessions,
  shown: sessions.length,
  total: sessions.length,
  next: null,
});
const change = (over: Partial<Extract<GraphFrame, { type: 'change' }>> = {}): GraphFrame => ({
  type: 'change',
  projectId: 1,
  events: [],
  sessions: [],
  blocks: [],
  edges: [],
  refs: [],
  ready: [],
  trash: [],
  ...over,
});

const invoice: Tag = {
  id: 'invoice',
  fields: {},
  edges: ['relates'],
  gates: [],
  roles: {},
  body: { shape: 'content' },
  prompt: 'One invoice.',
};

test('a resync refreshes the vocabulary that could have changed while the graph feed was disconnected', async () => {
  const vocabulary: Vocabulary = {
    catalogs: ['software-development'],
    installed: [],
    findings: [],
    tags: [invoice],
    unreadable: [],
    actions: {},
    fieldNames: {},
    forms: {},
    laws: {},
    revision: { format: 2, revision: 'test' },
  };
  const world = open(
    async () => json([]),
    async () => vocabulary,
  );

  world.frame({ type: 'resync' });

  await waitUntil(() => world.tags.titleOnly.includes('invoice'));
});

test('live writers survive initial loading and a reconnect fills the sessions missed during the gap', async () => {
  const initial = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let rows = [session(1)];
  let first = true;
  let tail = false;
  const world = open(async (url) => {
    if (url.pathname !== '/api/op/list_sessions') return json([]);
    if (first) {
      first = false;
      started.resolve();
      return initial.promise;
    }
    if (tail) {
      tail = false;
      return json({ ...writers(rows.slice(1)), total: rows.length });
    }
    tail = rows.length > 1;
    return json({ ...writers(rows.slice(0, 1)), total: rows.length, next: tail ? 'writers-page-2' : null });
  });
  const registry = world.app.get(SessionRegistry);
  await started.promise;
  expect(registry.writerOf(null)).toBeNull();
  expect(registry.writerOf(2)).toBeUndefined();
  world.frame(change({ sessions: [session(2)] }));
  initial.resolve(json(writers([session(1)])));
  await waitUntil(() => registry.writerOf(1)?.key === 'thread-1');
  expect(registry.writerOf(2)?.key).toBe('thread-2');
  rows = [session(1), session(3)];
  world.frame({ type: 'resync' });
  await waitUntil(() => registry.writerOf(3)?.key === 'thread-3');
  expect(registry.writerOf(2)?.key).toBe('thread-2');
  expect(world.failures).toEqual([]);
});

test('a resync does not join the pre-subscription session read still in flight', async () => {
  const initial = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let first = true;
  const world = open(async (url) => {
    if (url.pathname !== '/api/op/list_sessions') return json([]);
    if (first) {
      first = false;
      started.resolve();
      return initial.promise;
    }
    return json(writers([session(2)]));
  });
  const registry = world.app.get(SessionRegistry);
  await started.promise;
  world.frame({ type: 'resync' });
  await waitUntil(() => registry.writerOf(2)?.key === 'thread-2');
  initial.resolve(json(writers([session(1)])));
  expect(registry.writerOf(2)?.key).toBe('thread-2');
});

test('a failed initial read is reported and a later resync recovers the copied state', async () => {
  let broken = true;
  const world = open(async (url) => {
    if (broken) return json({ code: 'database', reason: 'unavailable', unblock: ['retry'] }, { status: 500 });
    if (url.pathname === '/api/op/list_sessions') return json(writers([session(5)]));
    return json([]);
  });
  const registry = world.app.get(SessionRegistry);
  await waitUntil(() => world.failures.length === 1);
  expect(world.failures).toEqual([expect.objectContaining({ code: 'database', gate: false })]);
  broken = false;
  world.frame({ type: 'resync' });
  await waitUntil(() => registry.writerOf(5)?.key === 'thread-5');
});
