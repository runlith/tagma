import { statSync } from 'node:fs';
import { Cause, Context, Data, Effect, Exit, FiberSet, Semaphore } from 'effect';
import { eventReason } from '@runlith/utils/worker';
import type { JournalAsk, JournalMemory, JournalReady, JournalReply, Queued, Restored, Waiting } from './journal.js';

export type QueuedCommit = typeof Queued.Type;
export const RECORD_BACKLOG = 1024;

export class CommitAdmissionRefused extends Data.TaggedError('CommitAdmissionRefused')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class CommitRecordFailed extends Data.TaggedError('CommitRecordFailed')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

class JournalUnavailable extends Data.TaggedError('JournalUnavailable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class CommitQueue extends Context.Service<
  CommitQueue,
  {
    readonly admit: (queued: QueuedCommit) => Effect.Effect<number, CommitAdmissionRefused>;
    readonly close: () => Effect.Effect<void>;
    readonly reopen: () => Effect.Effect<void>;
    readonly drained: () => Effect.Effect<{ readonly waiting: number; readonly unread: number }>;
  }
>()('tagma/enforcement/CommitQueue') {}

const openJournal = Effect.fn('CommitQueue.openJournal')(function* (path: string, memory: JournalMemory) {
  const client = yield* Effect.try({
    try: () => {
      const worker = new Worker(new URL('./journal.worker.ts', import.meta.url), { type: 'module' });
      const closed = new Promise<void>((resolve) => worker.addEventListener('close', () => resolve(), { once: true }));
      let failure: JournalUnavailable | undefined;
      let answer: ((reply: JournalReply) => void) | undefined;
      let refused: ((failure: JournalUnavailable) => void) | undefined;
      let ready!: () => void;
      let rejectReady!: (failure: JournalUnavailable) => void;
      const readiness = new Promise<void>((resolve, reject) => {
        ready = resolve;
        rejectReady = reject;
      });
      const fail = (reason: string): void => {
        if (failure !== undefined) return;
        failure = new JournalUnavailable({ reason });
        rejectReady(failure);
        refused?.(failure);
        worker.terminate();
      };
      worker.addEventListener('message', (event: MessageEvent<JournalReply | JournalReady>) => {
        if (event.data.kind === 'ready') ready();
        else answer?.(event.data);
      });
      worker.addEventListener('error', (event: ErrorEvent) => fail(eventReason(event, 'the commit journal worker failed')));
      worker.addEventListener('messageerror', () => fail('a commit journal reply could not be read'));
      worker.addEventListener('close', () => fail('the commit journal worker closed'));
      const ask = (request: JournalAsk): Effect.Effect<JournalReply, JournalUnavailable> =>
        Effect.callback((resume) => {
          if (failure !== undefined) {
            resume(Effect.fail(failure));
            return;
          }
          answer = (reply) =>
            resume(reply.kind === 'failed' ? Effect.fail(new JournalUnavailable({ reason: reply.reason })) : Effect.succeed(reply));
          refused = (cause) => resume(Effect.fail(cause));
          try {
            worker.postMessage(request);
          } catch (cause) {
            fail(`the commit journal worker took no request: ${String(cause)}`);
          }
          return Effect.sync(() => {
            answer = undefined;
            refused = undefined;
          });
        });
      return {
        readiness,
        ask,
        failed: () => failure !== undefined,
        shutdown: Effect.andThen(
          Effect.sync(() => fail('the commit journal owner closed')),
          Effect.promise(() => closed),
        ),
      };
    },
    catch: (cause) => new JournalUnavailable({ reason: String(cause) }),
  });
  return yield* Effect.gen(function* () {
    yield* Effect.tryPromise({ try: () => client.readiness, catch: (cause) => new JournalUnavailable({ reason: String(cause) }) });
    const opened = yield* client.ask({ kind: 'open', path, memory });
    if (opened.kind !== 'opened') return yield* new JournalUnavailable({ reason: 'the commit journal worker did not restore its queue' });
    return { restored: opened.restored, ask: client.ask, failed: client.failed, shutdown: client.shutdown };
  }).pipe(Effect.onError(() => client.shutdown));
});

const vacant = (path: string): boolean => {
  try {
    return statSync(path).size === 0;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ENOENT';
  }
};

export const commitQueue = Effect.fn('enforcement.commitQueue')(function* (options: {
  readonly path: string | null;
  readonly judge: (queued: QueuedCommit) => Effect.Effect<void, CommitRecordFailed>;
}) {
  const opening =
    options.path === null || vacant(options.path)
      ? Effect.succeed(null)
      : Effect.orDie(openJournal(options.path, { next: 0, unstruck: new Set() }));
  const owner = yield* Effect.acquireRelease(
    Effect.map(opening, (journal) => ({ journal })),
    (owner) => (owner.journal === null ? Effect.void : owner.journal.shutdown),
  );
  const fork = yield* FiberSet.makeRuntime<never, void, never>();
  const turn = yield* Semaphore.make(1);
  const read: Restored = owner.journal?.restored ?? { waiting: new Map(), held: new Map(), unread: 0, next: 0, unstruck: new Set() };
  if (read.unread > 0) {
    yield* Effect.logWarning('lines of the commit queue could not be read, so the commits they held are not recorded', {
      path: options.path,
      unread: read.unread,
    });
  }
  let waiting = read.waiting;
  let held = read.held;
  const counted = (projectId: number, by: number): void => {
    const now = (held.get(projectId) ?? 0) + by;
    if (now === 0) held.delete(projectId);
    else held.set(projectId, now);
  };
  let unstruck = read.unstruck;
  let unread = read.unread;
  let next = read.next;
  let uncertain = false;
  let closed = false;
  let draining = false;
  let again = false;

  const restore = Effect.fn('CommitQueue.restore')(function* () {
    if (options.path === null || (owner.journal !== null && !owner.journal.failed())) return;
    const previous = owner.journal;
    owner.journal = null;
    if (previous !== null) yield* previous.shutdown;
    const journal = yield* openJournal(options.path, { next, unstruck });
    owner.journal = journal;
    waiting = journal.restored.waiting;
    held = journal.restored.held;
    unstruck = journal.restored.unstruck;
    unread = journal.restored.unread;
    next = journal.restored.next;
    uncertain = false;
    drain();
  });
  const store = Effect.fn('CommitQueue.store')(function* (request: JournalAsk) {
    const journal = owner.journal;
    if (journal === null) return yield* new JournalUnavailable({ reason: 'the commit journal has not recovered' });
    return yield* journal.ask(request).pipe(
      Effect.catchTag('JournalUnavailable', (failure) =>
        Effect.gen(function* () {
          owner.journal = null;
          yield* journal.shutdown;
          return yield* restore().pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.fail(failure),
              onFailure: (recovery) =>
                Effect.fail(new JournalUnavailable({ reason: `${failure.reason}; restoration failed: ${recovery.reason}` })),
            }),
          );
        }),
      ),
    );
  });
  const forget = (item: Waiting): void => {
    if (waiting.delete(item.seq)) counted(item.queued.projectId, -1);
  };
  const settled = Effect.fn('CommitQueue.settled')(
    function* (item: Waiting) {
      forget(item);
      if (options.path === null) return;
      unstruck.add(item.seq);
      yield* Effect.gen(function* () {
        yield* restore();
        if (!unstruck.has(item.seq)) return;
        const reply = yield* store({ kind: 'settle', seq: item.seq });
        unstruck.delete(item.seq);
        if (reply.kind === 'stored' && reply.warning !== null) {
          yield* Effect.logWarning('settled commit markers could not be compacted; their durable queue remains readable', {
            path: options.path,
            cause: reply.warning,
          });
        }
      }).pipe(
        Effect.catchTag('JournalUnavailable', (failure) =>
          Effect.logWarning(
            unstruck.has(item.seq)
              ? 'a settled commit remains unstruck in the commit queue, so a restart judges it again'
              : 'a commit journal reply was lost; the restored journal confirms its settlement',
            { seq: item.seq, cause: failure.reason },
          ),
        ),
      );
    },
    Effect.uninterruptible,
    turn.withPermit,
  );

  const drain = (): void => {
    if (draining) {
      again = true;
      return;
    }
    if (waiting.size === 0) return;
    draining = true;
    again = false;
    fork(
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const failed = new Set<number>();
        let pending = waiting;
        let entries = pending.values();
        while (true) {
          if (pending !== waiting) {
            pending = waiting;
            entries = pending.values();
          }
          const entry = entries.next();
          if (entry.done) break;
          const item = entry.value;
          if (failed.has(item.queued.projectId)) continue;
          const judged = yield* Effect.exit(options.judge(item.queued));
          if (Exit.isFailure(judged)) {
            const current = waiting.get(item.seq) ?? item;
            current.failures += 1;
            failed.add(item.queued.projectId);
            yield* Effect.logWarning(
              'a queued commit could not be recorded yet; it and the commits of its project behind it wait for the next commit handed over, or the next start',
              {
                commit: item.queued.commit,
                root: item.queued.root,
                failures: current.failures,
                cause: Cause.pretty(judged.cause),
              },
            );
            continue;
          }
          yield* settled(item);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            draining = false;
            if (again) drain();
          }),
        ),
      ),
    );
  };

  drain();

  return CommitQueue.of({
    admit: Effect.fn('CommitQueue.admit')(
      function* (queued) {
        if (closed) return yield* new CommitAdmissionRefused({ reason: 'the commit queue is closed for a downgrade and admits no commit' });
        yield* restore().pipe(Effect.mapError((failure) => new CommitAdmissionRefused({ reason: failure.reason })));
        const standing = held.get(queued.projectId) ?? 0;
        if (standing >= RECORD_BACKLOG) {
          return yield* new CommitAdmissionRefused({
            reason: `the commit queue already holds ${standing} commits of this project waiting to be recorded`,
          });
        }
        const seq = next++;
        if (options.path !== null) {
          uncertain = true;
          yield* store({ kind: 'admit', seq, queued }).pipe(
            Effect.mapError((failure) => new CommitAdmissionRefused({ reason: failure.reason })),
          );
          uncertain = false;
        }
        waiting.set(seq, { seq, queued, failures: 0 });
        counted(queued.projectId, 1);
        drain();
        return standing + 1;
      },
      Effect.uninterruptible,
      turn.withPermit,
    ),
    close: () =>
      turn.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            closed = true;
            yield* restore().pipe(
              Effect.catchTag('JournalUnavailable', (failure) =>
                Effect.logWarning('the closed commit queue could not restore its journal; unresolved admissions still block draining', {
                  cause: failure.reason,
                }),
              ),
            );
            drain();
          }),
        ),
      ),
    reopen: () =>
      turn.withPermit(
        Effect.sync(() => {
          closed = false;
        }),
      ),
    drained: () => turn.withPermit(Effect.sync(() => ({ waiting: waiting.size + unstruck.size + Number(uncertain), unread }))),
  });
});
