import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { Worker } from 'node:worker_threads';
import type { HeapReport, HeapSummary } from './HeapSummary.js';
import type { HeapAnswer } from './heap/wire.js';

export type HeapReadOptions = {
  readonly previous?: string;
  readonly sidecar: string;
  readonly limit: number;
};

export class HeapUnreadable extends Data.TaggedError('HeapUnreadable')<{
  readonly file: string;
  readonly message: string;
}> {}

export const readHeap = Effect.fn('performance.readHeap')((file: string) => runHeap(file));
export const reportHeap = Effect.fn('performance.reportHeap')((file: string, options: HeapReadOptions) => runHeap(file, options));

function runHeap(file: string): Effect.Effect<HeapSummary, HeapUnreadable>;
function runHeap(file: string, options: HeapReadOptions): Effect.Effect<HeapReport, HeapUnreadable>;
function runHeap(file: string, options?: HeapReadOptions): Effect.Effect<HeapSummary | HeapReport, HeapUnreadable> {
  return Effect.suspend(() => {
    let worker: Worker | undefined;
    return Effect.callback<HeapSummary | HeapReport, HeapUnreadable>((resume) => {
      const failed = (message: string) => resume(Effect.fail(new HeapUnreadable({ file, message })));
      try {
        worker = new Worker(new URL('./heap.worker.ts', import.meta.url), { workerData: { file, options } });
      } catch {
        failed('the heap reader worker could not start');
        return;
      }
      worker.once('message', (answer: HeapAnswer) => {
        if (answer.status === 'read') resume(Effect.succeed(answer.summary));
        else if (answer.status === 'report') resume(Effect.succeed(answer.report));
        else failed(answer.message);
      });
      worker.once('error', () => failed('the heap reader worker failed'));
      worker.once('exit', () => failed('the heap reader worker exited before returning a summary'));
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          if (worker !== undefined) await worker.terminate();
        }),
      ),
    );
  });
}
