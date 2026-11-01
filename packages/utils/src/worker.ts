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

export type WorkerLink<Ask extends { readonly id: number }, Answer extends { readonly id: number }, Note = never> = {
  readonly ask: (
    make: (id: number) => Ask,
    transfer?: readonly ArrayBuffer[],
    noted?: (note: Note) => void,
  ) => Effect.Effect<Answer, WorkerUnavailable>;
  readonly run: (
    make: (id: number) => Ask,
    transfer?: readonly ArrayBuffer[],
    noted?: (note: Note) => void,
  ) => Effect.Effect<Answer, WorkerUnavailable>;
  readonly tell: (message: unknown) => void;
  readonly close: (reason: string) => void;
};

type BunWorker = Worker & { ref(): void; unref(): void };

type Waiting<Answer, Note> = { readonly answered: (answer: Answer | WorkerUnavailable) => void; readonly noted?: (note: Note) => void };

export const workerLink = <
  Ask extends { readonly id: number },
  Answer extends { readonly id: number },
  Note extends { readonly id: number } = never,
>(
  label: string,
  spawn: () => Worker,
  isNote: (message: Answer | Note) => message is Note = (_message): _message is Note => false,
): WorkerLink<Ask, Answer, Note> => {
  let worker: BunWorker | undefined;
  let asked = 0;
  const waiting = new Map<number, Waiting<Answer, Note>>();

  const ended = (thread: BunWorker, gone: WorkerUnavailable, closed = false): void => {
    if (worker !== thread) return;
    worker = undefined;
    const standing = [...waiting.values()];
    waiting.clear();
    const settled = (): void => {
      for (const { answered } of standing) answered(gone);
    };
    if (closed) settled();
    else {
      thread.addEventListener('close', settled, { once: true });
      thread.terminate();
    }
  };

  const failed = (thread: BunWorker, reason: string, closed = false): void => {
    if (worker === thread) ended(thread, workerGone(label, reason), closed);
  };

  const started = (): BunWorker => {
    if (worker !== undefined) return worker;
    const thread = spawn() as BunWorker;
    worker = thread;
    thread.addEventListener('message', (event: MessageEvent<Answer | Note>) => {
      if (worker !== thread) return;
      const message = event.data;
      const standing = waiting.get(message.id);
      if (isNote(message)) {
        standing?.noted?.(message);
        return;
      }
      waiting.delete(message.id);
      if (waiting.size === 0) thread.unref();
      standing?.answered(message);
    });
    thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, `the ${label} failed`)));
    thread.addEventListener('messageerror', () => failed(thread, `an answer could not be read back from the ${label}`));
    thread.addEventListener('close', () => failed(thread, `the ${label} closed`, true));
    thread.unref();
    return thread;
  };

  const request = (
    make: (id: number) => Ask,
    transfer: readonly ArrayBuffer[],
    noted: ((note: Note) => void) | undefined,
    joined: boolean,
  ): Effect.Effect<Answer, WorkerUnavailable> =>
    Effect.callback<Answer, WorkerUnavailable>((resume) => {
      const id = ++asked;
      let thread: BunWorker;
      try {
        thread = started();
      } catch (cause) {
        resume(Effect.fail(workerGone(label, `it could not start: ${String(cause)}`)));
        return;
      }
      let settled = false;
      let released: (() => void) | undefined;
      waiting.set(id, {
        answered: (answer) => {
          settled = true;
          released?.();
          resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer));
        },
        noted,
      });
      thread.ref();
      try {
        thread.postMessage(make(id), [...transfer]);
      } catch (cause) {
        failed(thread, `it took no ask: ${String(cause)}`);
      }
      return joined
        ? Effect.callback<void>((done) => {
            if (settled) done(Effect.void);
            else released = () => done(Effect.void);
          })
        : Effect.sync(() => {
            waiting.delete(id);
            if (waiting.size === 0) thread.unref();
          });
    });

  return {
    run: (make, transfer = [], noted) => request(make, transfer, noted, true),
    ask: (make, transfer = [], noted) => request(make, transfer, noted, false),
    tell: (message) => {
      const thread = worker;
      if (thread === undefined) return;
      try {
        thread.postMessage(message);
      } catch (cause) {
        failed(thread, `it took no message: ${String(cause)}`);
      }
    },
    close: (reason) => {
      if (worker !== undefined) ended(worker, new WorkerUnavailable(label, reason));
    },
  };
};
