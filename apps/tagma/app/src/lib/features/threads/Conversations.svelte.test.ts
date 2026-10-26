// @vitest-environment jsdom
import type { ConversationHit } from '@tagma/server/threads/contract/wire/conversation';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { keyed } from '@runlith/query/builders/keyed';
import { QueryClient } from '@tanstack/query-core';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import Conversations from './Conversations.svelte';
import { ThreadsRepo } from './Repo.js';

type Asked = { readonly projectId: number; readonly query: string };

const hit: ConversationHit = {
  project: { id: 3, name: 'there' },
  threadId: 'thread-a',
  title: 'Summer plans',
  name: null,
  parentId: null,
  archived: false,
  match: {
    entryId: 'message:1',
    position: 4,
    runId: 'run-1',
    role: 'operator',
    occurredAt: '2026-10-03T20:00:00.000Z',
    snippet: 'a trip to Montenegro',
    highlights: [{ start: 10, end: 20 }],
  },
};

const answer = {
  status: 'ok',
  matches: [hit],
  total: 1,
  coverage: { complete: true, unindexed: 0 },
  excluded: null,
  cut: null,
  cursor: null,
};

const windowOf = {
  threadId: 'thread-a',
  at: 'message:1',
  messages: [
    { entryId: 'message:1', position: 4, runId: 'run-1', role: 'operator', occurredAt: hit.match.occurredAt, text: 'a trip to Montenegro' },
  ],
};

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

function draw(search: (key: Asked, signal: AbortSignal) => Promise<unknown>, props: { query: string; projectId: number }): HTMLElement {
  const scope = Scope.make();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const family = <Key, Data>(name: string, loader: (key: Key, signal: AbortSignal) => Promise<Data>) =>
    keyed<Key, Data>({
      name,
      scope,
      queryClient,
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: ({ key, signal }) => loader(key, signal),
    });
  app = mountShell(
    Layer.mergeAll(),
    Layer.of(ThreadsRepo, {
      conversations: family('conversations', search),
      conversationWindow: family('conversation-window', async () => [windowOf]),
    } as never),
  );
  const host = app.draw(Conversations as never, props);
  flushSync();
  return host;
}

test('a new input aborts the search of the input before it', async () => {
  const signals: AbortSignal[] = [];
  const props = $state({ query: 'monte', projectId: 1 });
  draw((_key, signal) => {
    signals.push(signal);
    return new Promise(() => undefined);
  }, props);
  await vi.waitFor(() => expect(signals).toHaveLength(1));

  props.query = 'montene';
  await vi.waitFor(() => expect(signals).toHaveLength(2));

  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
});

test('a refined query that finds the same thread does not open its window on its own', async () => {
  const props = $state({ query: 'monte', projectId: 1 });
  const host = draw(async () => answer, props);
  await vi.waitFor(() => expect(host.querySelector('[data-conversation-hit]')).not.toBeNull());

  host.querySelector<HTMLElement>('[data-conversation-hit]')?.click();
  await vi.waitFor(() => expect(host.querySelector('[data-conversation-window]')).not.toBeNull());

  props.query = 'montene';
  await vi.waitFor(() => expect(host.querySelector('[data-conversation-hit]')).not.toBeNull());
  flushSync();

  expect(host.querySelector('[data-conversation-window]')).toBeNull();
});
