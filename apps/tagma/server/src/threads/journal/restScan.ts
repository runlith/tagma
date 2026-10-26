import { Effect } from 'effect';
import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';
import { RolloutReads, type RolloutRead, type ReadRollout } from '../contract/service/rolloutReads.js';

export type RestScanAsk = { readonly id: number; readonly path: string };

export type RestScan = {
  readonly bytes: number;
  readonly torn: boolean;
  readonly unreadable: boolean;
  readonly checkpoints: readonly string[];
  readonly pruned: readonly string[];
};

export type RestScanAnswer = { readonly id: number } & (
  | ({ readonly kind: 'scanned' } & RestScan)
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'failed'; readonly reason: string }
);

export type RestScanRead = { readonly id: number; readonly kind: 'read'; readonly reads: readonly RolloutRead[] };
type Waiting = { readonly answer: (answer: RestScanAnswer | WorkerUnavailable) => void; readonly read: ReadRollout };

const WORKER = 'rollout rest scan worker';

let worker: Worker | undefined;
let asked = 0;
const waiting = new Map<number, Waiting>();

const failed = (thread: Worker, reason: string): void => {
  if (worker !== thread) return;
  worker = undefined;
  thread.terminate();
  const gone = workerGone(WORKER, reason);
  const standing = [...waiting.values()];
  waiting.clear();
  for (const answer of standing) answer.answer(gone);
};

const started = (): Worker => {
  if (worker !== undefined) return worker;
  const thread = new Worker(new URL('./restScan.worker.ts', import.meta.url), { type: 'module' });
  worker = thread;
  thread.addEventListener('message', (event: MessageEvent<RestScanAnswer | RestScanRead>) => {
    const answer = waiting.get(event.data.id);
    if (event.data.kind === 'read') {
      for (const read of event.data.reads) answer?.read(read);
      return;
    }
    waiting.delete(event.data.id);
    if (waiting.size === 0) thread.unref();
    answer?.answer(event.data);
  });
  thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, 'the rest scan worker failed')));
  thread.addEventListener('messageerror', () => failed(thread, 'a rest scan answer could not be read'));
  thread.addEventListener('close', () => failed(thread, 'the rest scan worker closed'));
  thread.unref();
  return thread;
};

export const scanForRest = (path: string): Effect.Effect<RestScan | null, WorkerUnavailable> =>
  Effect.flatMap(RolloutReads, (read) =>
    Effect.callback<RestScanAnswer, WorkerUnavailable>((resume) => {
      const id = ++asked;
      let thread: Worker;
      try {
        thread = started();
      } catch (cause) {
        resume(Effect.fail(workerGone(WORKER, `it could not start: ${String(cause)}`)));
        return;
      }
      waiting.set(id, {
        read,
        answer: (answer) => resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer)),
      });
      thread.ref();
      try {
        thread.postMessage({ id, path } satisfies RestScanAsk);
      } catch (cause) {
        failed(thread, `it took no ask: ${String(cause)}`);
      }
      return Effect.sync(() => {
        waiting.delete(id);
        if (waiting.size === 0) thread.unref();
      });
    }),
  ).pipe(
    Effect.flatMap((answer) => {
      if (answer.kind === 'scanned') return Effect.succeed(answer);
      if (answer.kind === 'unreadable') return Effect.succeed(null);
      return Effect.fail(workerGone(WORKER, answer.reason));
    }),
    Effect.withSpan('ThreadRollout.rest.scan', { attributes: { path } }),
  );
