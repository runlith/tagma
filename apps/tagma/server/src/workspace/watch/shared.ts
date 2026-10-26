import { totalmem } from 'node:os';
import { Deferred, Effect, FiberSet, Queue, Semaphore, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import type { TreeShift, TreeWatch } from '../../platform/watch/tree.js';
import { CheckoutWatch, type CheckoutShift, type Following } from '../contract/service/watch.js';
import { FileRoots } from '../contract/service/roots.js';
import type { RootId } from '../contract/wire/ids.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import { Pending } from './pending.js';
import { watchingCheckout } from './tree.js';

const LINGER_MS = 30_000;

const REOPEN_MS = 2_000;

const REOPEN_CEILING_MS = 60_000;

const PENDING_FLOOR = 256;

const PENDING_CEILING = 65_536;

export const pendingLimit = (memory: number = totalmem()): number =>
  Math.max(PENDING_FLOOR, Math.min(PENDING_CEILING, Math.floor(memory / 2 ** 20)));

type Timer = ReturnType<typeof setTimeout>;

type Subscriber = {
  readonly pending: Pending;
  wake: (() => void) | null;
};

type Entry = {
  readonly rootId: RootId;
  path: string;
  readonly subscribers: Set<Subscriber>;
  readonly ready: Deferred.Deferred<void>;
  readonly lock: Semaphore.Semaphore;
  watch: TreeWatch | null;
  closer: Timer | null;
  healing: boolean;
  failed: boolean;
};

export type CheckoutWatchOptions = { readonly limit?: number; readonly reopenMs?: number };

const lost = (shift: TreeShift): boolean =>
  'rescan' in shift && (shift.rescan === 'lost' || shift.rescan === 'error' || shift.rescan === 'polling');

export type CheckoutWatches = CheckoutWatch['Service'];

export const makeCheckoutWatches = Effect.fnUntraced(function* ({
  limit = pendingLimit(),
  reopenMs = REOPEN_MS,
}: CheckoutWatchOptions = {}) {
  const git = yield* Git;
  const roots = yield* FileRoots;
  const entries = new Map<RootId, Entry>();
  const run = yield* FiberSet.makeRuntime<never, void, never>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const entry of [...entries.values()]) close(entry);
    }),
  );

  const follow = Effect.fn('CheckoutWatch.follow')(function* (rootId: RootId): Effect.fn.Return<Following, RootResolutionFailure> {
    const root = yield* roots.read(rootId);
    for (;;) {
      const subscriber: Subscriber = { pending: new Pending(limit), wake: null };
      const standing = entries.get(rootId);
      if (standing !== undefined) {
        attach(standing, subscriber);
        yield* Deferred.await(standing.ready);
        if (standing.failed) continue;
        if (standing.path !== root.path) {
          standing.path = root.path;
          heal(standing, 0);
        } else if (standing.watch === null || !standing.watch.watching()) heal(standing, 0);
        return following(standing, subscriber);
      }
      const entry: Entry = {
        rootId,
        path: root.path,
        subscribers: new Set(),
        ready: Deferred.makeUnsafe<void>(),
        lock: Semaphore.makeUnsafe(1),
        watch: null,
        closer: null,
        healing: false,
        failed: false,
      };
      entries.set(rootId, entry);
      attach(entry, subscriber);
      const opened = yield* Effect.exit(entry.lock.withPermit(openWatch(entry)));
      if (opened._tag === 'Failure') {
        entry.failed = true;
        close(entry);
        yield* Deferred.succeed(entry.ready, undefined);
        return yield* Effect.failCause(opened.cause);
      }
      yield* Deferred.succeed(entry.ready, undefined);
      return following(entry, subscriber);
    }
  });

  function attach(entry: Entry, subscriber: Subscriber): void {
    if (entry.closer !== null) clearTimeout(entry.closer);
    entry.closer = null;
    entry.subscribers.add(subscriber);
  }

  function deliver(entry: Entry, shift: TreeShift): void {
    for (const subscriber of entry.subscribers) {
      subscriber.pending.add(shift);
      if (subscriber.pending.waiting) subscriber.wake?.();
    }
  }

  const openWatch = Effect.fn('CheckoutWatch.openWatch')(function* (entry: Entry): Effect.fn.Return<void> {
    entry.watch?.close();
    entry.watch = null;
    for (;;) {
      const path = entry.path;
      const watching = yield* watchingCheckout(git, { tree: path, gitFrom: path }, (shift) => {
        deliver(entry, shift);
        if (lost(shift) && entries.get(entry.rootId) === entry) heal(entry, reopenMs);
      });
      if (entries.get(entry.rootId) !== entry) {
        watching.close();
        return;
      }
      if (entry.path !== path) {
        watching.close();
        continue;
      }
      entry.watch = watching;
      if (!watching.watching()) heal(entry, reopenMs);
      return;
    }
  });

  function heal(entry: Entry, first: number): void {
    if (entry.healing) return;
    entry.healing = true;
    run(
      Effect.gen(function* () {
        let wait = first;
        for (;;) {
          if (wait > 0) yield* Effect.sleep(wait);
          if (entries.get(entry.rootId) !== entry || entry.subscribers.size === 0) return;
          if (wait > 0 && entry.watch?.watching() === true) return;
          yield* entry.lock.withPermit(openWatch(entry));
          if (entry.watch?.watching() === true) {
            for (const subscriber of entry.subscribers) {
              subscriber.pending.reopened();
              subscriber.wake?.();
            }
            return;
          }
          wait = Math.min(Math.max(wait * 2, reopenMs), REOPEN_CEILING_MS);
        }
      }).pipe(Effect.ensuring(Effect.sync(() => void (entry.healing = false)))),
    );
  }

  function following(entry: Entry, subscriber: Subscriber): Following {
    let released = false;
    return {
      shifts: subscriptionStream(subscriber),
      watching: () => !released && entry.watch !== null && entry.watch.watching(),
      release: () => {
        if (released) return;
        released = true;
        leave(entry, subscriber);
      },
    };
  }

  function leave(entry: Entry, subscriber: Subscriber): void {
    entry.subscribers.delete(subscriber);
    if (entry.subscribers.size > 0) return;
    if (entry.watch === null || !entry.watch.watching()) {
      close(entry);
      return;
    }
    entry.closer = setTimeout(() => close(entry), LINGER_MS);
    entry.closer.unref();
  }

  function close(entry: Entry): void {
    if (entry.closer !== null) clearTimeout(entry.closer);
    entry.closer = null;
    if (entries.get(entry.rootId) === entry) entries.delete(entry.rootId);
    entry.watch?.close();
    entry.watch = null;
  }

  return CheckoutWatch.of({ follow });
});

const subscriptionStream = (subscriber: Subscriber): Stream.Stream<CheckoutShift> =>
  Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          subscriber.wake = () => void Queue.offerUnsafe(queue, undefined);
          if (subscriber.pending.waiting) subscriber.wake();
        }),
        () => Effect.sync(() => void (subscriber.wake = null)),
      ),
    { bufferSize: 1, strategy: 'sliding' },
  ).pipe(
    Stream.map((): CheckoutShift | null => subscriber.pending.take()),
    Stream.filter((shift): shift is CheckoutShift => shift !== null),
  );
