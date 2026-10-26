import { threadWireFeedEventSchema } from '@tagma/server/threads/contract/wire/snapshot';
import { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import { FeedReader } from '@runlith/chat-ui/session/FeedReader';
import type { ChatFeedEvent } from '@runlith/chat-ui/wire/ChatConnection';
import { Effect, Schema } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { ThreadEntryKinds, ThreadEntryUnreadable } from '@runlith/agent/transcript/kinds';
import { entryFromTranscript } from '@runlith/chat-ui/entryProjection';
import { createFeedKinds } from './feedRecords.js';
import { describe, expect } from 'vitest';
import bounded from '@tagma/server/threads/contract/wire/feedPairs/bounded.json';
import empty from '@tagma/server/threads/contract/wire/feedPairs/empty.json';
import interruption from '@tagma/server/threads/contract/wire/feedPairs/interruption.json';
import pending from '@tagma/server/threads/contract/wire/feedPairs/pending.json';
import product from '@tagma/server/threads/contract/wire/feedPairs/product.json';
import reconnect from '@tagma/server/threads/contract/wire/feedPairs/reconnect.json';
import refused from '@tagma/server/threads/contract/wire/feedPairs/refused.json';
import restore from '@tagma/server/threads/contract/wire/feedPairs/restore.json';
import rewind from '@tagma/server/threads/contract/wire/feedPairs/rewind.json';
import withdraw from '@tagma/server/threads/contract/wire/feedPairs/withdraw.json';

type Pair = {
  readonly events: readonly unknown[];
  readonly folded: { readonly at: { position: number; seq: number }; transcript: unknown[]; open: unknown[]; progress: unknown };
};

const pairs: Record<string, Pair> = {
  empty,
  bounded,
  pending,
  product,
  refused,
  interruption,
  withdraw,
  rewind,
  restore,
  reconnect,
} as never;
const kinds = createFeedKinds().wire();
const decode = Schema.decodeUnknownEffect(threadWireFeedEventSchema);

const shown = (fold: ChatFold) => fold.entries.map((entry) => ({ ...entry }));

describe('a session fed the producer events equals a session fed the independent snapshot at the same position', () => {
  it.effect.each(Object.keys(pairs))('%s', (name) =>
    Effect.gen(function* () {
      const { events, folded } = pairs[name]!;
      const wire = (yield* Effect.forEach(events, (event) => decode(event)).pipe(
        Effect.provideService(ThreadEntryKinds, kinds),
      )) as unknown as ChatFeedEvent<never>[];
      const fed = new ChatFold();
      const reader = new FeedReader(fed);
      for (const event of wire) expect(reader.read(event).kind).toBe('applied');

      const first = wire[0] as { payload: { snapshot: Record<string, unknown> } };
      const state = reader.state as unknown as Record<string, unknown>;
      const fresh = new ChatFold();
      new FeedReader(fresh).read({
        type: 'snapshot',
        at: folded.at,
        payload: {
          status: 'loaded',
          snapshot: {
            ...state,
            transcript: folded.transcript,
            before: first.payload.snapshot.before,
            open: folded.open,
            progress: folded.progress,
          },
        },
      } as never);
      expect(shown(fed)).toEqual(shown(fresh));
    }),
  );
});

it.effect('an unreadable entry keeps its diagnostic row between readable snapshot entries', () =>
  Effect.gen(function* () {
    const first = empty.events[0]!;
    expect(first.type).toBe('snapshot');
    if (first.type !== 'snapshot') return;
    const transcript = [
      { type: 'message', id: 'before', role: 'assistant', text: 'before' },
      {
        type: 'not-installed',
        id: 'unknown',
        secret: 'not a decoded product',
        runId: 42,
        occurredAt: null,
        rewound: { by: 12, scope: 'from' },
      },
      { type: 'message', id: 'after', role: 'assistant', text: 'after' },
    ];
    const event = yield* decode({ ...first, payload: { status: 'loaded', snapshot: { ...first.payload.snapshot, transcript } } }).pipe(
      Effect.provideService(ThreadEntryKinds, kinds),
    );
    expect(event.type).toBe('snapshot');
    if (event.type !== 'snapshot') return;
    const entries = event.payload.snapshot.transcript;
    expect(entries.map((entry) => entry.id)).toEqual(['before', 'unknown', 'after']);
    const unreadable = entries[1]!;
    expect(unreadable).toBeInstanceOf(ThreadEntryUnreadable);
    if (!(unreadable instanceof ThreadEntryUnreadable)) return;
    expect(unreadable.refusal).toMatchObject({ _tag: 'ThreadEntryUndecodable', type: 'not-installed', id: 'unknown' });
    expect(unreadable.refusal.issue).toBe('no installed kind reads it');
    expect(entryFromTranscript(unreadable)).toMatchObject([{ kind: 'unreadable', id: 'unknown', refusal: unreadable.refusal }]);
  }),
);
