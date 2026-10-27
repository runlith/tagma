import { Data, Effect } from 'effect';

export class WorkerUnavailable extends Data.TaggedError('WorkerUnavailable')<{
  readonly message: string;
  readonly worker: string;
  readonly reason: string;
}> {
  constructor(worker: string, reason: string) {
    super({ message: `the ${worker} is unavailable: ${reason}`, worker, reason });
    this.name = 'WorkerUnavailable';
  }
}

export const workerGone = (worker: string, reason: string): WorkerUnavailable => {
  const gone = new WorkerUnavailable(worker, reason);
  console.error(`[worker] ${gone.message}`);
  return gone;
};

export const eventReason = (event: ErrorEvent, fallback: string): string =>
  event.message || (event.error === undefined ? fallback : String(event.error));

export type WorkerLink<Ask extends { readonly id: number }, Answer extends { readonly id: number }> = {
  readonly ask: (make: (id: number) => Ask, transfer?: readonly ArrayBuffer[]) => Effect.Effect<Answer, WorkerUnavailable>;
  readonly close: (reason: string) => void;
};

type BunWorker = Worker & { ref(): void; unref(): void };

export const workerLink = <Ask extends { readonly id: number }, Answer extends { readonly id: number }>(
  label: string,
  spawn: () => Worker,
): WorkerLink<Ask, Answer> => {
  let worker: BunWorker | undefined;
  let asked = 0;
  const waiting = new Map<number, (answer: Answer | WorkerUnavailable) => void>();

  const ended = (thread: BunWorker, gone: WorkerUnavailable): void => {
    if (worker !== thread) return;
    worker = undefined;
    thread.terminate();
    const standing = [...waiting.values()];
    waiting.clear();
    for (const answered of standing) answered(gone);
  };

  const failed = (thread: BunWorker, reason: string): void => {
    if (worker === thread) ended(thread, workerGone(label, reason));
  };

  const started = (): BunWorker => {
    if (worker !== undefined) return worker;
    const thread = spawn() as BunWorker;
    worker = thread;
    thread.addEventListener('message', (event: MessageEvent<Answer>) => {
      const answered = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      if (waiting.size === 0) thread.unref();
      answered?.(event.data);
    });
    thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, `the ${label} failed`)));
    thread.addEventListener('messageerror', () => failed(thread, `an answer could not be read back from the ${label}`));
    thread.addEventListener('close', () => failed(thread, `the ${label} closed`));
    thread.unref();
    return thread;
  };

  return {
    ask: (make, transfer = []) =>
      Effect.callback<Answer, WorkerUnavailable>((resume) => {
        const id = ++asked;
        let thread: BunWorker;
        try {
          thread = started();
        } catch (cause) {
          resume(Effect.fail(workerGone(label, `it could not start: ${String(cause)}`)));
          return;
        }
        waiting.set(id, (answer) => resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer)));
        thread.ref();
        try {
          thread.postMessage(make(id), [...transfer]);
        } catch (cause) {
          failed(thread, `it took no ask: ${String(cause)}`);
        }
        return Effect.sync(() => {
          waiting.delete(id);
          if (waiting.size === 0) thread.unref();
        });
      }),
    close: (reason) => {
      if (worker !== undefined) ended(worker, new WorkerUnavailable(label, reason));
    },
  };
};
