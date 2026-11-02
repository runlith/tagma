import { Clock, Deferred, Effect } from 'effect';
import { makeChat, openEvent, snapshotEvent } from '@feed/testing/chatHarness.svelte';
import type { TestSession } from '@feed/testing/chatHarness.svelte';
import type { TurnCommands } from '@feed/session/TurnCommands.svelte';
import type { TestDraft } from '@feed/testing/chatHarness.svelte';
import type { TestThread } from '@feed/testing/chatConnection';
import { corpus, ENTRY_COUNT, observations, PAGE_SIZE, STREAM_ID, STREAM_RUN, streamChunk } from './corpus';
import type { ObservedEntries } from './recording';

export type Rig = {
  readonly turns: TurnCommands<TestDraft, TestThread>;
  readonly session: TestSession['session'];
  readonly observations: ObservedEntries;
  readonly paging: { requested: number; landed: number; latency: number; requestedAt: number | null; landedAt: number | null };
  stream(chunks?: number): Promise<void>;
  loadOlder(): Promise<boolean>;
  pageLatency(ms: number): void;
  holdPages(): void;
  releasePages(): void;
};

type RigOptions = { readonly active?: boolean; readonly count?: number };

export const makeRig = Effect.fnUntraced(function* (
  loaded = PAGE_SIZE,
  { active = true, count = ENTRY_COUNT }: RigOptions = {},
): Effect.fn.Return<Rig, never, import('effect').Scope.Scope> {
  const entries = corpus(count);
  const chat = yield* makeChat();
  const paging = $state<Rig['paging']>({ requested: 0, landed: 0, latency: 350, requestedAt: null, landedAt: null });
  let gate: Deferred.Deferred<void> | null = null;
  chat.connection.stub('entriesBefore', ({ before }) =>
    Effect.gen(function* () {
      paging.requested += 1;
      paging.requestedAt = yield* Clock.currentTimeMillis;
      if (gate !== null) yield* Deferred.await(gate);
      yield* Effect.sleep(paging.latency);
      const start = Math.max(0, before - PAGE_SIZE);
      paging.landed += 1;
      paging.landedAt = yield* Clock.currentTimeMillis;
      return { entries: entries.slice(start, before), before: start === 0 ? null : start };
    }),
  );
  const { session } = yield* chat.open('thread-1', { handlers: { attachmentUrl: (url) => url } });
  const before = Math.max(0, entries.length - loaded);
  chat.connection.emit(
    snapshotEvent({
      activeRunId: active ? STREAM_RUN : null,
      transcript: entries.slice(before),
      before: before === 0 ? null : before,
      open: active
        ? [
            {
              type: 'message',
              role: 'assistant',
              id: STREAM_ID,
              runId: STREAM_RUN,
              text: 'A scripted answer is arriving below the reader.',
            },
          ]
        : [],
    }),
  );
  yield* session.opened();
  const turns = yield* chat.holder(session);
  let sequence = 1;
  const streaming = Effect.fnUntraced(function* (chunks: number) {
    for (let index = 0; index < chunks; index += 1) {
      yield* Effect.sleep(32);
      chat.connection.emit(openEvent({ op: 'append', id: STREAM_ID, text: streamChunk(index) }, { position: 0, seq: ++sequence }));
    }
  });
  return {
    turns,
    session,
    observations: observations(count),
    paging,
    stream: (chunks = 30) => turns.run(streaming(chunks), undefined),
    loadOlder: () => turns.run(turns.loadOlder(), false),
    pageLatency: (ms) => {
      paging.latency = ms;
    },
    holdPages: () => {
      gate ??= Deferred.makeUnsafe<void>();
    },
    releasePages: () => {
      if (gate !== null) Deferred.doneUnsafe(gate, Effect.void);
      gate = null;
    },
  };
});
