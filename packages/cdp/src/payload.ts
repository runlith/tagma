import { Data, Effect } from 'effect';
import { type WorkerUnavailable, workerLink } from '@runlith/utils/worker';
import { bytesText, type Chunk, type Job, type JobAnswer, type JobAsk, trimmed } from './jobs.js';

export const INLINE_CHARS = 1 << 20;

export class PayloadUnreadable extends Data.TaggedError('PayloadUnreadable')<{ readonly message: string }> {}

const link = workerLink<JobAsk, JobAnswer>(
  'CDP payload worker',
  () => new Worker(new URL('./cdp.worker.ts', import.meta.url), { type: 'module' }),
);

const offLoop = (job: Job): Effect.Effect<unknown, WorkerUnavailable | PayloadUnreadable> =>
  Effect.flatMap(
    link.ask((id) => ({ id, job })),
    (answer) =>
      'unreadable' in answer ? Effect.fail(new PayloadUnreadable({ message: answer.unreadable })) : Effect.succeed(answer.value),
  );

const inline = <A>(read: () => A): Effect.Effect<A, PayloadUnreadable> =>
  Effect.try({ try: read, catch: (cause) => new PayloadUnreadable({ message: `the payload is unreadable: ${String(cause)}` }) });

export const parsed = (text: string, trim: number | null = null): Effect.Effect<unknown, WorkerUnavailable | PayloadUnreadable> =>
  text.length <= INLINE_CHARS
    ? inline(() => (trim === null ? (JSON.parse(text) as unknown) : trimmed(JSON.parse(text), trim)))
    : offLoop({ kind: 'json', text, trim });

export const chunkOf = (text: string): Effect.Effect<Chunk, WorkerUnavailable | PayloadUnreadable> =>
  Effect.map(offLoop({ kind: 'chunk', text }), (value) => value as Chunk);

export const bytesOf = (text: string): Effect.Effect<Uint8Array, WorkerUnavailable | PayloadUnreadable> =>
  text.length <= INLINE_CHARS
    ? inline(() => bytesText(text))
    : Effect.map(offLoop({ kind: 'bytes', text }), (value) => value as Uint8Array);
