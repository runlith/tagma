import { Effect } from 'effect';
import { makeChat, openEvent, snapshotEvent } from '@feed/testing/chatHarness.svelte';
import type { TestSession } from '@feed/testing/chatHarness.svelte';
import type { TurnCommands } from '@feed/session/TurnCommands.svelte';
import type { TestDraft } from '@feed/testing/chatHarness.svelte';
import type { TestThread } from '@feed/testing/chatConnection';
import { corpus, PAGE_SIZE, STREAM_ID, STREAM_RUN, streamChunk } from './corpus';

export type Rig = {
  readonly turns: TurnCommands<TestDraft, TestThread>;
  readonly session: TestSession['session'];
  readonly paging: { requested: number; landed: number; latency: number };
  stream(chunks?: number): Promise<void>;
  loadOlder(): Promise<boolean>;
  pageLatency(ms: number): void;
};

export const makeRig = Effect.fnUntraced(function* (loaded = PAGE_SIZE): Effect.fn.Return<Rig, never, import('effect').Scope.Scope> {
  const entries = corpus();
  const chat = yield* makeChat();
  const paging = $state({ requested: 0, landed: 0, latency: 350 });
  chat.connection.stub('entriesBefore', ({ before }) =>
    Effect.gen(function* () {
      paging.requested += 1;
      yield* Effect.sleep(paging.latency);
      const start = Math.max(0, before - PAGE_SIZE);
      paging.landed += 1;
      return { entries: entries.slice(start, before), before: start === 0 ? null : start };
    }),
  );
  const { session } = yield* chat.open('thread-1', { handlers: { attachmentUrl: (url) => url } });
  const before = Math.max(0, entries.length - loaded);
  chat.connection.emit(
    snapshotEvent({
      activeRunId: STREAM_RUN,
      transcript: entries.slice(before),
      before: before === 0 ? null : before,
      open: [
        { type: 'message', role: 'assistant', id: STREAM_ID, runId: STREAM_RUN, text: 'A scripted answer is arriving below the reader.' },
      ],
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
    paging,
    stream: (chunks = 30) => turns.run(streaming(chunks), undefined),
    loadOlder: () => turns.run(turns.loadOlder(), false),
    pageLatency: (ms) => {
      paging.latency = ms;
    },
  };
});
