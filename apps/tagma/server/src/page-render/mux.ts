import { eventReason, workerGone } from '@runlith/utils/worker';
import { Effect, Queue } from 'effect';
import type { Chunk } from './encoder.js';

export type MuxAsk =
  | { readonly kind: 'open'; readonly file: string; readonly fps: number; readonly total: number }
  | { readonly kind: 'add'; readonly chunks: readonly Chunk[] }
  | { readonly kind: 'finish' };

export type MuxReply = { readonly kind: 'ready' } | { readonly kind: 'done' } | { readonly kind: 'failed'; readonly reason: string };

export const muxer = Effect.fnUntraced(function* (open: { readonly file: string; readonly fps: number; readonly total: number }) {
  const replies = yield* Queue.unbounded<MuxReply>();
  const thread = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const worker = new Worker(new URL('./mux.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent<MuxReply>) => Queue.offerUnsafe(replies, event.data));
      worker.addEventListener('error', (event: ErrorEvent) =>
        Queue.offerUnsafe(replies, { kind: 'failed', reason: eventReason(event, 'the muxer worker failed') }),
      );
      worker.addEventListener('close', () =>
        Queue.offerUnsafe(replies, { kind: 'failed', reason: 'the muxer worker closed before answering' }),
      );
      return worker;
    }),
    (worker) => Effect.sync(() => worker.terminate()),
  );
  const answered = Effect.flatMap(Queue.take(replies), (reply) =>
    reply.kind === 'failed' ? Effect.die(workerGone('video muxer worker', reply.reason)) : Effect.void,
  );
  const ask = (message: MuxAsk) =>
    Effect.andThen(
      Effect.sync(() => thread.postMessage(message)),
      answered,
    );
  yield* answered;
  yield* ask({ kind: 'open', ...open });
  return {
    add: (chunks: readonly Chunk[]) => (chunks.length === 0 ? Effect.void : ask({ kind: 'add', chunks })),
    finish: ask({ kind: 'finish' }),
  };
});
