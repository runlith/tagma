import { it } from '@runlith/effect-test';
import { expect, test } from 'bun:test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { declare } from './Held.js';
import { lane } from './Lane.js';
import { section } from './Section.js';

const declared = (name = 'test-section', rank = 100, wait = 200, hold = 300) =>
  section<string>({
    name,
    owner: 'test',
    rank,
    key: (key) => key,
    threshold: Math.min(100, hold),
    ceilings: { hold, wait, leaves: 'nothing' },
    external: 'none',
  });

const causeOf = (exit: Exit.Exit<unknown, unknown>): string => (Exit.isFailure(exit) ? JSON.stringify(exit.cause) : '');

it.live('entries of one key run one at a time in arrival order, and other keys do not wait', () =>
  Effect.gen(function* () {
    const order = yield* Effect.gen(function* () {
      const root = declared();
      const order: string[] = [];
      const gate = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        root.enter(
          'a',
          Effect.andThen(
            Deferred.await(gate),
            Effect.sync(() => order.push('first')),
          ),
        ),
      );
      yield* Effect.yieldNow;
      const second = yield* Effect.forkChild(
        root.enter(
          'a',
          Effect.sync(() => order.push('second')),
        ),
      );
      yield* Effect.yieldNow;
      yield* root.enter(
        'b',
        Effect.sync(() => order.push('other')),
      );
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      return { order, standing: root.standing() };
    });
    expect(order).toEqual({ order: ['other', 'first', 'second'], standing: [] });
  }),
);

it.live('a lane is entered inside a section, and a section inside a lane step dies as a wait under a hold', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.scoped(
      Effect.gen(function* () {
        const root = declared();
        const commits = yield* lane({
          name: 'test-lane',
          owner: 'test',
          rank: 290,
          threshold: 100,
          ceilings: { step: 300, wait: 200, leaves: 'nothing' },
          external: 'none',
        });
        const inner = yield* root.enter('a', commits.enter('c', Effect.succeed('laned')));
        const under = yield* Effect.exit(commits.enter('c', root.enter('a', Effect.void)));
        return { inner, under: causeOf(under).includes('WaitUnderHold') };
      }),
    );
    expect(outcome).toEqual({ inner: 'laned', under: true });
  }),
);

it.live('a section entered under a held resource dies as a wait under a hold', () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      declare<string>({
        name: 'test-held',
        owner: 'test',
        rank: 10,
        key: (key) => key,
        concurrency: 1,
        threshold: 100,
        ceilings: { hold: 300, wait: 200, leaves: 'nothing' },
        external: 'none',
      }).hold('h', declared().enter('a', Effect.void)),
    );
    expect(causeOf(exit)).toContain('WaitUnderHold');
  }),
);

it.live('reentering a held section dies, and sections nest only upward in rank', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const low = declared('low', 100);
      const high = declared('high', 200);
      const nested = yield* low.enter('a', high.enter('a', Effect.succeed('nested')));
      const reentered = yield* Effect.exit(low.enter('a', low.enter('a', Effect.void)));
      const inverted = yield* Effect.exit(high.enter('a', low.enter('b', Effect.void)));
      return { nested, reentered: causeOf(reentered).includes('ReentrantCall'), inverted: causeOf(inverted).includes('LockOrderViolated') };
    });
    expect(outcome).toEqual({ nested: 'nested', reentered: true, inverted: true });
  }),
);

it.live('a fiber that outlives the section it was forked in may enter that section once it is released', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const root = declared();
      const released = yield* Deferred.make<void>();
      const child = yield* root.enter(
        'a',
        Effect.forkDetach(Effect.andThen(Deferred.await(released), root.enter('a', Effect.succeed('entered')))),
      );
      yield* Deferred.succeed(released, undefined);
      return yield* Fiber.join(child);
    });
    expect(outcome).toBe('entered');
  }),
);

it.live('a wait past its ceiling stalls with nothing done, and a hold past its ceiling is cut and frees the key', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const root = declared('timed', 100, 30, 60);
      const gate = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(root.enter('a', Deferred.await(gate)));
      yield* Effect.yieldNow;
      const stalled = yield* Effect.exit(root.enter('a', Effect.void));
      const cut = yield* Effect.exit(Fiber.join(first));
      const after = yield* root.enter('a', Effect.succeed('served'));
      return { stalled: causeOf(stalled).includes('HoldStalled'), cut: causeOf(cut).includes('HoldCut'), after, standing: root.standing() };
    });
    expect(outcome).toEqual({ stalled: true, cut: true, after: 'served', standing: [] });
  }),
);

it.live('an interrupted waiter leaves the queue and an interrupted holder frees the key', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const root = declared();
      const gate = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(root.enter('a', Deferred.await(gate)));
      yield* Effect.yieldNow;
      const waiter = yield* Effect.forkChild(root.enter('a', Effect.void));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(waiter);
      yield* Fiber.interrupt(holder);
      const after = yield* root.enter('a', Effect.succeed('served'));
      return { after, standing: root.standing() };
    });
    expect(outcome).toEqual({ after: 'served', standing: [] });
  }),
);

test('a declaration past the 15-minute cap is refused', () => {
  expect(() => declared('too-long', 100, 200, 16 * 60_000)).toThrow();
});
