import { Effect, Exit, Fiber, Queue, Scope, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { actingGit } from '../../platform/git/ownGit.js';
import type { HeadMoved, HeadObservation } from '../contract/service/checkouts.js';
import { watchingHead } from './tree.js';

const REOPEN_MS = 2_000;
const REOPEN_CEILING_MS = 60_000;

type Listener = (observation: HeadObservation) => void;

type Watched = {
  readonly listeners: Set<Listener>;
  readonly owed: Set<Listener>;
  readonly scope: Scope.Closeable;
  wake: (() => void) | null;
  head: string | null | undefined;
};

export type HeadWatches = Effect.Success<typeof makeHeadWatches>;

export const makeHeadWatches = Effect.gen(function* () {
  const git = actingGit(yield* Git, 'head-moved');
  const scope = yield* Effect.scope;

  const watched = new Map<string, Watched>();

  const following = <A>(checkout: string, select: (event: HeadObservation) => A | undefined): Stream.Stream<A> =>
    Stream.callback<A>(
      (queue) =>
        Effect.acquireRelease(
          join(checkout, (event) => {
            const selected = select(event);
            if (selected !== undefined) Queue.offerUnsafe(queue, selected);
          }),
          (listener) => leave(checkout, listener),
        ),
      { bufferSize: 1, strategy: 'sliding' },
    );

  const join = Effect.fn('heads.join')(function* (checkout: string, listener: Listener): Effect.fn.Return<Listener> {
    const standing = watched.get(checkout);
    if (standing !== undefined) {
      standing.listeners.add(listener);
      standing.owed.add(listener);
      standing.wake?.();
      return listener;
    }
    const entry: Watched = {
      listeners: new Set([listener]),
      owed: new Set([listener]),
      scope: Scope.forkUnsafe(scope),
      wake: null,
      head: undefined,
    };
    watched.set(checkout, entry);
    yield* observe(checkout, entry).pipe(Effect.forkIn(entry.scope));
    return listener;
  });

  function leave(checkout: string, listener: Listener): Effect.Effect<void> {
    return Effect.suspend(() => {
      const standing = watched.get(checkout);
      if (standing === undefined) return Effect.void;
      standing.listeners.delete(listener);
      standing.owed.delete(listener);
      if (standing.listeners.size > 0) return Effect.void;
      watched.delete(checkout);
      return Scope.close(standing.scope, Exit.void);
    });
  }

  const observe = Effect.fnUntraced(function* (checkout: string, entry: Watched): Effect.fn.Return<void> {
    const due = yield* Queue.sliding<void>(1);
    const wake = () => void Queue.offerUnsafe(due, undefined);
    entry.wake = wake;
    let wait = REOPEN_MS;
    for (;;) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watching = yield* Effect.acquireRelease(watchingHead(git, checkout, wake), (watching) =>
            Effect.sync(() => watching.close()),
          );
          if (watching.watching()) wait = REOPEN_MS;
          let readingWait = REOPEN_MS;
          yield* Queue.take(due);
          for (;;) {
            const proved = yield* read(checkout, entry);
            if (!watching.watching()) return;
            if (proved) {
              readingWait = REOPEN_MS;
              yield* Queue.take(due);
            } else {
              yield* Effect.race(Effect.sleep(readingWait), Queue.take(due));
              readingWait = Math.min(readingWait * 2, REOPEN_CEILING_MS);
            }
          }
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reopening = yield* Effect.sleep(wait).pipe(Effect.as(false), Effect.forkScoped);
          for (;;) {
            const reading = yield* Effect.race(Fiber.join(reopening), Queue.take(due).pipe(Effect.as(true)));
            if (!reading) return;
            yield* read(checkout, entry);
          }
        }),
      );
      wait = Math.min(wait * 2, REOPEN_CEILING_MS);
    }
  });

  const read = Effect.fn('heads.read')(function* (checkout: string, entry: Watched): Effect.fn.Return<boolean> {
    const answer = yield* Effect.result(commitOf(git, checkout, 'HEAD'));
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning('HEAD could not be read; observation will recover', { checkout, failure: answer.failure });
      for (const listener of entry.listeners) listener({ kind: 'unread', checkout, reason: answer.failure.message });
      return false;
    }
    const head = answer.success;
    const changed = head !== entry.head;
    entry.head = head;
    for (const listener of entry.listeners) if (changed || entry.owed.has(listener)) listener({ kind: 'read', checkout, head });
    entry.owed.clear();
    return true;
  });

  return {
    moved: (checkout: string): Stream.Stream<HeadMoved> =>
      following(checkout, (event) => (event.kind === 'read' ? { checkout: event.checkout, head: event.head } : undefined)),
    observed: (checkout: string): Stream.Stream<HeadObservation> => following(checkout, (event) => event),
  };
});
