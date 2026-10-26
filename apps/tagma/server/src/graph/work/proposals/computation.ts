import { Effect, Scope } from 'effect';
import { eventReason, WorkerUnavailable } from '@runlith/utils/worker';
import type { ReviewConflicts } from '../../contract/service/work.js';
import type { ConflictInput } from './overlaps.js';

export type ConflictJob =
  | { readonly kind: 'clear'; readonly revision: number }
  | { readonly kind: 'index'; readonly key: string; readonly revision: number; readonly input: ConflictInput }
  | { readonly kind: 'read'; readonly key: string; readonly names?: readonly string[] }
  | { readonly kind: 'compute'; readonly input: ConflictInput; readonly names?: readonly string[] };

export type ConflictRequest = { readonly id: number; readonly job: ConflictJob };
export type ConflictAnswer = { readonly id: number; readonly conflicts: ReviewConflicts | null };

type Pending = {
  readonly request: ConflictRequest;
  readonly resume: (answer: Effect.Effect<ReviewConflicts | null, WorkerUnavailable>) => void;
};

export const conflictComputation = Effect.gen(function* () {
  let current: Worker | undefined;
  let ready = false;
  let generation = 0;
  let sequence = 0;
  const pending = new Map<number, Pending>();

  const lost = (worker: Worker, reason: string) => {
    if (current !== worker) return;
    current = undefined;
    ready = false;
    generation += 1;
    worker.terminate();
    const failure = new WorkerUnavailable('proposal conflicts', reason);
    const waiting = [...pending.values()];
    pending.clear();
    for (const row of waiting) row.resume(Effect.fail(failure));
  };

  const send = (worker: Worker, request: ConflictRequest) => {
    try {
      worker.postMessage(request);
    } catch (cause) {
      lost(worker, String(cause));
    }
  };

  const started = () => {
    if (current !== undefined) return current;
    const worker = new Worker(new URL('./overlaps.worker.ts', import.meta.url), { type: 'module' });
    current = worker;
    ready = false;
    worker.addEventListener('message', (event: MessageEvent<ConflictAnswer | { readonly state: 'ready' }>) => {
      if (current !== worker) return;
      if ('state' in event.data) {
        ready = true;
        for (const row of pending.values()) send(worker, row.request);
        return;
      }
      const row = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (pending.size === 0) worker.unref();
      row?.resume(Effect.succeed(event.data.conflicts));
    });
    worker.addEventListener('error', (event: ErrorEvent) => lost(worker, eventReason(event, 'the conflict calculation failed')));
    worker.addEventListener('messageerror', () => lost(worker, 'the conflict answer could not be read'));
    worker.addEventListener('close', () => lost(worker, 'the conflict worker closed before answering'));
    return worker;
  };

  yield* Scope.addFinalizer(
    yield* Effect.scope,
    Effect.sync(() => {
      if (current !== undefined) lost(current, 'the graph closed');
    }),
  );

  const ask = (job: ConflictJob) =>
    Effect.callback<ReviewConflicts | null, WorkerUnavailable>((resume) => {
      let worker: Worker;
      try {
        worker = started();
      } catch (cause) {
        resume(Effect.fail(new WorkerUnavailable('proposal conflicts', String(cause))));
        return;
      }
      const id = ++sequence;
      const request = { id, job };
      pending.set(id, { request, resume });
      worker.ref();
      if (ready) send(worker, request);
      return Effect.sync(() => {
        pending.delete(id);
        if (pending.size === 0 && current === worker) worker.unref();
      });
    });

  return { ask, generation: () => generation, running: () => current !== undefined };
});
