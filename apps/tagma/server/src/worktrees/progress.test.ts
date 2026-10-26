import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import type { RootId } from '../workspace/contract/wire/ids.js';
import { makeActProgress } from './progress.js';

const root = 'root-a' as RootId;

it.effect('a nested act reports its phases on the act shown, and a second act on the root neither shows nor writes its phase', () =>
  Effect.gen(function* () {
    const progress = yield* makeActProgress;
    const shown = () => progress.of(1).map((act) => [act.act, act.phase]);
    const release = yield* Deferred.make<void>();
    const phased = yield* Deferred.make<void>();
    const outer = yield* Effect.forkChild(
      progress.during(
        1,
        root,
        'delete',
        Effect.gen(function* () {
          yield* progress.during(1, root, 'delete', progress.phase(root, 'removing'));
          yield* Deferred.succeed(phased, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    yield* Deferred.await(phased);
    expect(shown()).toEqual([['delete', 'removing']]);

    const landing = yield* Deferred.make<void>();
    const second = yield* Effect.forkChild(
      progress.during(
        1,
        root,
        'merge',
        Effect.gen(function* () {
          yield* progress.phase(root, 'landing');
          yield* Deferred.succeed(landing, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    yield* Deferred.await(landing);
    expect(shown()).toEqual([['delete', 'removing']]);

    yield* progress.during(2, 'root-b' as RootId, 'merge', progress.phase('root-b' as RootId, 'checking'), { deferred: true });
    expect(progress.of(2)).toEqual([]);

    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(outer);
    yield* Fiber.join(second);
    expect(shown()).toEqual([]);
  }),
);

it.effect('an act whose caller is interrupted runs to its end, and only then leaves the acts in flight', () =>
  Effect.gen(function* () {
    const progress = yield* makeActProgress;
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const finished = yield* Deferred.make<string>();
    const caller = yield* Effect.forkChild(
      progress.during(
        1,
        root,
        'delete',
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          yield* Deferred.succeed(finished, 'deleted');
        }),
      ),
    );
    yield* Deferred.await(started);

    yield* Fiber.interrupt(caller);
    expect(progress.of(1).map((act) => act.act)).toEqual(['delete']);

    yield* Deferred.succeed(release, undefined);
    expect(yield* Deferred.await(finished)).toBe('deleted');
    yield* Effect.yieldNow;
    expect(progress.of(1)).toEqual([]);
  }),
);
