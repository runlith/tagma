import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Cause, Deferred, Effect, Exit } from 'effect';
import { ResourceInvalid } from './failures.js';
import { type PassDeclaration, passes } from './Passes.js';

const declaration: PassDeclaration = {
  name: 'drain',
  owner: 'test',
  triggers: [{ event: 'marked' }],
  class: 'background',
  cost: 'light',
  source: { durable: 'measure_pending' },
};

it.live('a trigger during a run earns exactly one more run of that key, and an idle key is forgotten', () =>
  Effect.gen(function* () {
    const runs: string[] = [];
    const exit = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const done = yield* Deferred.make<void>();
          const scheduler = yield* passes([
            {
              declaration,
              run: Effect.fnUntraced(function* (key) {
                runs.push(key);
                if (runs.length === 1) yield* Deferred.await(gate);
                if (runs.length === 2) yield* Deferred.succeed(done, undefined);
              }),
            },
          ]);
          yield* scheduler.event('marked', 'tree');
          yield* Effect.yieldNow;
          yield* scheduler.trigger('drain', 'tree');
          yield* scheduler.trigger('drain', 'tree');
          const during = scheduler.standing();
          yield* Deferred.succeed(gate, undefined);
          yield* Deferred.await(done);
          yield* Effect.sleep(1);
          return { during, after: scheduler.standing(), last: scheduler.lastRuns() };
        }),
      ),
    );
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    expect(runs).toEqual(['tree', 'tree']);
    expect(exit.value.during).toMatchObject([{ pass: 'drain', key: 'tree', running: true, standing: 1 }]);
    expect(exit.value.after).toEqual([]);
    expect(exit.value.last).toMatchObject([{ pass: 'drain', key: 'tree', outcome: 'done' }]);
  }),
);

it.effect('a duplicate pass name refuses before any pass starts', () =>
  Effect.gen(function* () {
    const pass = { declaration, run: () => Effect.void };
    const exit = yield* Effect.exit(passes([pass, pass]));
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(ResourceInvalid);
  }),
);
