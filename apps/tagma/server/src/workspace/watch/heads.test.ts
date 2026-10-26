import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Exit, Fiber, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Git, GitUnavailable, type GitAnswer } from '@runlith/git/Git';
import type { HeadMoved } from '../contract/service/checkouts.js';
import { makeHeadWatches } from './heads.js';

const answered = (stdout: string, status = 0): GitAnswer => ({ status, stdout, stderr: '', overflow: false, messageOverflow: false });

const fixture = Effect.fnUntraced(function* (initial: string | null = 'a'.repeat(40)) {
  let head = initial;
  let unreadable = false;
  const git = Git.of({
    run: (args) =>
      Effect.suspend(() => {
        if (args.some((arg) => arg === 'HEAD' || arg.startsWith('HEAD^')) && !unreadable)
          return Effect.succeed(answered(head === null ? '' : `${head}\n`, head === null ? 1 : 0));
        return Effect.fail(new GitUnavailable({ command: args, reason: 'resource unavailable' }));
      }),
  });
  const scope = yield* Scope.make();
  const watches = yield* makeHeadWatches.pipe(Effect.provideService(Git, git), Effect.provideService(Scope.Scope, scope));
  const events = yield* Queue.unbounded<HeadMoved>();
  const subscriber = yield* Stream.runForEach(watches.moved('/checkout'), (event) => Queue.offer(events, event)).pipe(Effect.forkScoped);
  return {
    events,
    subscriber,
    scope,
    watches,
    move: (value: string | null) => {
      head = value;
    },
    readable: (value: boolean) => {
      unreadable = !value;
    },
  };
});

const next = (events: Queue.Queue<HeadMoved>) => Effect.map(Queue.take(events), (event) => event.head);

const pending = (events: Queue.Queue<HeadMoved>) => {
  expect(Queue.takeUnsafe(events)).toBeUndefined();
};

it.effect('an unreadable HEAD preserves the last observation until a later read proves a movement or absence', () =>
  Effect.gen(function* () {
    const state = yield* fixture();
    expect(yield* next(state.events)).toBe('a'.repeat(40));
    state.readable(false);
    yield* TestClock.adjust(2000);
    pending(state.events);
    state.readable(true);
    state.move('b'.repeat(40));
    yield* TestClock.adjust(3999);
    pending(state.events);
    yield* TestClock.adjust(1);
    expect(yield* next(state.events)).toBe('b'.repeat(40));
    state.move(null);
    yield* TestClock.adjust(7999);
    pending(state.events);
    yield* TestClock.adjust(1);
    expect(yield* next(state.events)).toBeNull();
    yield* Scope.close(state.scope, Exit.void);
  }),
);

it.effect('both the opening subscriber and a later subscriber receive proven absence of HEAD', () =>
  Effect.gen(function* () {
    const state = yield* fixture(null);
    expect(yield* next(state.events)).toBeNull();
    const later = yield* Stream.runHead(state.watches.moved('/checkout')).pipe(Effect.forkScoped);
    yield* TestClock.adjust(2000);
    const observed = yield* Fiber.join(later);
    expect(observed._tag === 'Some' && observed.value.head).toBeNull();
    pending(state.events);
    yield* Scope.close(state.scope, Exit.void);
  }),
);
