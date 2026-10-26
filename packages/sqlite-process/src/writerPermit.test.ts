import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { declare } from '@runlith/held/Held';
import { Deferred, Effect, Fiber } from 'effect';
import { writerPermit } from './writerPermit.js';

const permitOver = (journal: string[]) => {
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
    (level: string | undefined) => Effect.sync(() => void journal.push(`level ${level}`)),
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
