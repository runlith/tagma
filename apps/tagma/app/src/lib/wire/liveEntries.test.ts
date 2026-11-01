import { it } from '@runlith/effect-test/vitest';
import { ThreadEntryUnreadable } from '@runlith/agent/transcript/kinds';
import type { ThreadWireFeedEvent } from '@tagma/server/threads/contract/wire/snapshot';
import empty from '@tagma/server/threads/contract/wire/feedPairs/empty.json';
import { CATALOG_MODULES } from '@tagma/server/composition/catalog';
import { makePoint } from '@runlith/layer/testing';
import { Effect } from 'effect';
import { expect } from 'vitest';
import { testWireKinds } from '$lib/features/threads/native/testing.js';
import { LiveConnection } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';
import { WireCatalog } from './WireCatalog.js';
import { wireEntries, WireEntryKinds } from './WireEntryKinds.js';

class FeedSocket extends EventTarget {
  readyState = 0;
  binaryType = 'arraybuffer';
  readonly requested = Promise.withResolvers<string>();

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(text: string): void {
    const frame = JSON.parse(text) as { _tag: string; id: string };
    if (frame._tag === 'Request') this.requested.resolve(frame.id);
  }

  reply(requestId: string, event: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Chunk', requestId, values: [event] }) }));
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}

it.live(
  'a feed of a catalog entry contributed after the connection was made subscribes, and decodes kinds that joined after it started beside an unknown entry diagnostic',
  () =>
    Effect.gen(function* () {
      const socket = new FeedSocket();
      const catalog = makePoint(WireCatalog);
      const kinds = makePoint(WireEntryKinds);
      const live = yield* LiveConnection.make(
        () => socket as unknown as WebSocket,
        new ServerOrigin('http://localhost'),
        catalog,
        wireEntries(kinds),
      );
      catalog.register('late', ...CATALOG_MODULES);
      const received = Promise.withResolvers<ThreadWireFeedEvent>();
      const held = live.hold(
        (client) => client['thread.subscribe']({ projectId: 1, threadId: 'thread' }),
        (event) => received.resolve(event),
        (failure) => received.reject(new Error(failure.message)),
      );
      yield* Effect.addFinalizer(() => Effect.sync(held.unsubscribe));
      const request = yield* Effect.promise(() => socket.requested.promise);
      kinds.register('late', ...testWireKinds().items);
      const first = empty.events[0]!;
      const installed = {
        type: 'start-cost',
        id: 'start:1',
        runId: 'run',
        occurredAt: '',
        chars: 100,
        parts: [],
        tokens: 25,
        window: 1000,
        share: 0.025,
        inputTokens: null,
        rewound: { by: 'rewind', scope: 'from' },
      };
      socket.reply(request, {
        ...first,
        payload: {
          status: 'loaded',
          snapshot: { ...first.payload.snapshot, transcript: [installed, { type: 'not-installed', id: 'unknown' }] },
        },
      });
      const event = yield* Effect.promise(() => received.promise);
      expect(event.type).toBe('snapshot');
      if (event.type !== 'snapshot') return;
      expect(event.payload.snapshot.transcript[0]).toEqual(installed);
      const unknown = event.payload.snapshot.transcript[1]!;
      expect(unknown).toBeInstanceOf(ThreadEntryUnreadable);
      if (unknown instanceof ThreadEntryUnreadable) expect(unknown.refusal).toMatchObject({ type: 'not-installed', id: 'unknown' });
    }),
);
