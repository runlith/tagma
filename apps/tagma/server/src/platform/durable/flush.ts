import type { FileHandle } from 'node:fs/promises';
import { Effect, Layer } from 'effect';
import { eventReason, workerGone } from '@runlith/utils/worker';

export type Flushed = 'full' | 'degraded';

export type FlushAsk = { readonly id: number; readonly fd: number };
export type FlushReady = { readonly ready: true };
export type FlushAnswer =
  | { readonly id: number; readonly outcome: 'full' }
  | { readonly id: number; readonly outcome: 'errno'; readonly code: number }
  | { readonly id: number; readonly outcome: 'error'; readonly reason: string };

export const flushRoute = (platform: NodeJS.Platform): 'worker' | 'fsync' => (platform === 'darwin' ? 'worker' : 'fsync');

export const fullSyncOutcome = (reply: FlushAnswer): Flushed => {
  if (reply.outcome === 'full') return 'full';
  if (reply.outcome === 'errno' && [22, 25, 45, 102].includes(reply.code)) return 'degraded';
  throw new Error(reply.outcome === 'error' ? reply.reason : `F_FULLFSYNC failed with errno ${reply.code}`);
};

type Waiting = { readonly resolve: (reply: FlushAnswer) => void; readonly reject: (cause: Error) => void };
type Ready = { readonly thread: Worker; readonly closed: Promise<void> };
let worker: Worker | undefined;
let readiness: Promise<Ready> | undefined;
let rejectReadiness: ((cause: Error) => void) | undefined;
let nextId = 0;
const waiting = new Map<number, Waiting>();

const WORKER = 'full-fsync worker';

const fail = (thread: Worker, reason: string): void => {
  if (worker !== thread) return;
  worker = undefined;
  readiness = undefined;
  thread.terminate();
  const gone = workerGone(WORKER, reason);
  rejectReadiness?.(gone);
  rejectReadiness = undefined;
  for (const [id, entry] of waiting) {
    waiting.delete(id);
    entry.reject(gone);
  }
};

const started = (): Promise<Ready> => {
  if (readiness !== undefined) return readiness;
  const thread = new Worker(new URL('./flush.worker.ts', import.meta.url), { type: 'module' });
  worker = thread;
  const closed = new Promise<void>((resolve) => thread.addEventListener('close', () => resolve(), { once: true }));
  let ready!: (ready: Ready) => void;
  readiness = new Promise((resolve, reject) => {
    ready = resolve;
    rejectReadiness = reject;
  });
  thread.addEventListener('message', (event: MessageEvent<FlushAnswer | FlushReady>) => {
    if (worker !== thread) return;
    if ('ready' in event.data) {
      rejectReadiness = undefined;
      ready({ thread, closed });
      thread.unref();
      return;
    }
    const entry = waiting.get(event.data.id);
    if (entry === undefined) return;
    waiting.delete(event.data.id);
    entry.resolve(event.data);
    if (waiting.size === 0) thread.unref();
  });
  thread.addEventListener('error', (event: ErrorEvent) => fail(thread, eventReason(event, 'the worker failed')));
  thread.addEventListener('messageerror', () => fail(thread, 'a reply could not be read'));
  thread.addEventListener('close', () => fail(thread, 'the worker closed'));
  return readiness;
};

export const flushPreparationLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => (process.platform === 'darwin' ? started() : Promise.resolve(undefined)),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
    (ready) =>
      ready === undefined
        ? Effect.void
        : Effect.andThen(
            Effect.sync(() => {
              if (worker !== ready.thread) return;
              worker = undefined;
              readiness = undefined;
              ready.thread.terminate();
              const gone = new Error('the full-fsync owner closed');
              for (const entry of waiting.values()) entry.reject(gone);
              waiting.clear();
            }),
            Effect.promise(() => ready.closed),
          ),
  ),
);

const fullSync = async (fd: number): Promise<FlushAnswer> => {
  const { thread } = await started();
  return new Promise((resolve, reject) => {
    try {
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      thread.ref();
      thread.postMessage({ id, fd } satisfies FlushAsk);
    } catch (cause) {
      const reason = `it took no ask: ${String(cause)}`;
      if (worker === undefined) reject(workerGone(WORKER, reason));
      else fail(worker, reason);
    }
  });
};

export const flushDescriptor = Effect.fnUntraced(function* (handle: FileHandle) {
  if (flushRoute(process.platform) === 'fsync') {
    yield* Effect.tryPromise({ try: () => handle.sync(), catch: (cause) => new Error(String(cause)) });
    return 'full' as const;
  }
  return yield* Effect.tryPromise({
    try: async () => {
      const outcome = fullSyncOutcome(await fullSync(handle.fd));
      if (outcome === 'degraded') await handle.sync();
      return outcome;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
});
