import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { declare } from '@runlith/held/Held';
import { CostLedger, costLedgerLayer, CurrentCost } from '@runlith/performance/CostLedger';
import { Clock, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import { writerPermit } from './writerPermit.js';

const permitOver = (journal: string[], settle?: (level: string | undefined) => Effect.Effect<void, SqlError>) => {
  const held = declare<string>({
    name: 'sqlite-writer-test',
    owner: 'sqlite-process',
    rank: 500,
    key: (key) => key,
    concurrency: 1,
    threshold: 200,
    ceilings: { hold: 400, wait: 300, leaves: 'the scope closes before another statement starts' },
    external: 'none',
  });
  return writerPermit(
    'writer',
    held,
    'file',
    settle ?? ((level: string | undefined) => Effect.sync(() => void journal.push(`level ${level}`))),
    'full',
    Effect.succeed(null),
    Effect.void,
  );
};

it.effect('a bare statement waits for an open unit to end instead of running inside its transaction', () =>
  Effect.gen(function* () {
    const journal: string[] = [];
    const permit = permitOver(journal);
    const release = yield* Deferred.make<void>();
    const unit = yield* Effect.forkChild(
      Effect.scoped(
        Effect.andThen(
          permit.transaction,
          Effect.andThen(
            Effect.sync(() => void journal.push('unit begins')),
            Effect.andThen(
              Deferred.await(release),
              Effect.sync(() => void journal.push('unit ends')),
            ),
          ),
        ),
      ),
    );
    yield* Effect.yieldNow;
    const bare = yield* Effect.forkChild(
      Effect.scoped(
        Effect.andThen(
          permit.statement,
          Effect.sync(() => void journal.push('bare statement')),
        ),
      ),
    );
    yield* Effect.yieldNow;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(unit);
    yield* Fiber.join(bare);
    expect(journal.filter((line) => !line.startsWith('level'))).toEqual(['unit begins', 'unit ends', 'bare statement']);
  }),
);

it.effect('a unit waits for a bare statement already running to finish', () =>
  Effect.gen(function* () {
    const journal: string[] = [];
    const permit = permitOver(journal);
    const release = yield* Deferred.make<void>();
    const bare = yield* Effect.forkChild(
      Effect.scoped(
        Effect.andThen(
          permit.statement,
          Effect.andThen(
            Deferred.await(release),
            Effect.sync(() => void journal.push('bare statement')),
          ),
        ),
      ),
    );
    yield* Effect.yieldNow;
    const unit = yield* Effect.forkChild(
      Effect.scoped(
        Effect.andThen(
          permit.transaction,
          Effect.sync(() => void journal.push('unit begins')),
        ),
      ),
    );
    yield* Effect.yieldNow;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(bare);
    yield* Fiber.join(unit);
    expect(journal.filter((line) => !line.startsWith('level'))).toEqual(['bare statement', 'unit begins']);
  }),
);

it.live('a failed writer acquisition records physical wait without a hold', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const cause = ledger.open('waiting');
    const permit = permitOver([]);
    const entered = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(
      Effect.scoped(Effect.andThen(permit.statement, Effect.andThen(Deferred.succeed(entered, undefined), Effect.never))),
    );
    yield* Deferred.await(entered);
    const before = yield* Clock.monotonicTimeNanos;
    const result = yield* Effect.scoped(permit.statement).pipe(Effect.provideService(CurrentCost, cause), Effect.result);
    const elapsed = Number((yield* Clock.monotonicTimeNanos) - before) / 1_000_000;
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure._tag).toBe('SqlError');
    expect(cause.counts.writerWaitMs).toBeGreaterThan(0);
    expect(cause.counts.writerWaitMs).toBeLessThanOrEqual(elapsed);
    expect(cause.counts.writerHoldMs).toBe(0);
    yield* Fiber.interrupt(holder);
  }),
);

it.live('an early release records its hold once even when its owning scope closes later', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const cause = ledger.open('rejected');
    const refused = new SqlError({ reason: classifySqliteError(new Error('rejected'), { operation: 'execute' }) });
    let first = true;
    const permit = permitOver([], () =>
      Effect.suspend(() => {
        if (!first) return Effect.void;
        first = false;
        return Effect.fail(refused);
      }),
    );
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const result = yield* Scope.provide(permit.statement, scope).pipe(Effect.provideService(CurrentCost, cause), Effect.result);
    expect(result._tag).toBe('Failure');
    const heldMs = cause.counts.writerHoldMs;
    expect(heldMs).toBeGreaterThan(0);
    expect(yield* Effect.scoped(permit.statement)).toBe('writer');
    yield* Scope.close(scope, Exit.void);
    expect(cause.counts.writerHoldMs).toBe(heldMs);
  }),
);
