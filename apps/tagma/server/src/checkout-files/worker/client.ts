import { Effect } from 'effect';
import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';
import { CANCEL_SLOTS, type FilesAnswer, type FilesAsk, type FilesEnvelope, type FilesReply } from './protocol.js';

const WORKER = 'checkout files worker';

const ANSWER_CEILING_MS = 20_000;

type Waiting = (answer: FilesReply | WorkerUnavailable) => void;

export const makeFilesWorker = () => {
  let worker: Worker | undefined;
  let asked = 0;
  const waiting = new Map<number, Waiting>();
  const cancelled = new SharedArrayBuffer(CANCEL_SLOTS * Int32Array.BYTES_PER_ELEMENT);
  const flags = new Int32Array(cancelled);

  const failed = (thread: Worker, reason: string): void => {
    if (worker !== thread) return;
    worker = undefined;
    thread.terminate();
    const gone = workerGone(WORKER, reason);
    const standing = [...waiting.values()];
    for (const answered of standing) answered(gone);
    waiting.clear();
  };

  const started = (): Worker => {
    if (worker !== undefined) return worker;
    const thread = new Worker(new URL('./files.worker.ts', import.meta.url), { type: 'module' });
    worker = thread;
    thread.addEventListener('message', (event: MessageEvent<FilesAnswer>) => {
      waiting.get(event.data.id)?.(event.data.reply);
    });
    thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, 'the checkout files worker failed')));
    thread.addEventListener('messageerror', () => failed(thread, 'an answer could not be read back from its worker'));
    thread.addEventListener('close', () => failed(thread, 'the checkout files worker closed'));
    thread.unref();
    return thread;
  };

  return {
    ask: (ask: FilesAsk): Effect.Effect<FilesReply, WorkerUnavailable> =>
      Effect.callback<FilesReply, WorkerUnavailable>((resume) => {
        const id = ++asked;
        let thread: Worker;
        try {
          thread = started();
        } catch (cause) {
          resume(Effect.fail(workerGone(WORKER, `it could not start: ${String(cause)}`)));
          return;
        }
        const stuck = setTimeout(() => failed(thread, `it did not answer within ${ANSWER_CEILING_MS} ms`), ANSWER_CEILING_MS);
        const settle = (): void => {
          clearTimeout(stuck);
          waiting.delete(id);
          if (waiting.size === 0) thread.unref();
        };
        waiting.set(id, (answer) => {
          settle();
          resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer));
        });
        thread.ref();
        try {
          thread.postMessage({ id, cancelled, ask } satisfies FilesEnvelope);
        } catch (cause) {
          failed(thread, `it took no ask: ${String(cause)}`);
        }
        return Effect.sync(() => {
          if (!waiting.has(id)) return;
          Atomics.store(flags, id % CANCEL_SLOTS, id);
          settle();
        });
      }),

    close: () => void (worker !== undefined && failed(worker, 'the server is closing')),
  };
};

export type FilesWorker = ReturnType<typeof makeFilesWorker>;
