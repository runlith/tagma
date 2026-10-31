import type { Held } from '@runlith/held/Held';
import { CurrentCost } from '@runlith/performance/CostLedger';
import { CurrentWriter } from '@runlith/performance/WriterMetrics';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';

export type WriterPermit<C> = {
  readonly statement: Effect.Effect<C, SqlError, Scope.Scope>;
  readonly transaction: Effect.Effect<C, SqlError, Scope.Scope>;
  readonly drain: Effect.Effect<void, SqlError>;
};

export const writerPermit = <C, L>(
  writer: C,
  held: Held<string>,
  key: string,
  settle: (level: L | undefined) => Effect.Effect<void, SqlError>,
  standing: L | undefined,
  marked: Effect.Effect<L | null>,
  checkConnection: Effect.Effect<void, SqlError>,
): WriterPermit<C> => {
  const physical = Context.get(Context.empty(), Clock.Clock);
  const now = () => Number(physical.monotonicTimeNanosUnsafe()) / 1_000_000;
  const lease = held.lease(key).pipe(
    Effect.mapError(
      (failure) => new SqlError({ reason: classifySqliteError(failure, { message: failure.message, operation: 'execute' }) }),
    ),
    Effect.provideService(Clock.Clock, physical),
  );
  const take = Effect.withFiber<() => void, SqlError, Scope.Scope>((fiber) => {
    const cost = Context.get(fiber.context, CurrentCost);
    const frame = Context.get(fiber.context, CurrentWriter);
    if (cost === null && frame === null) return lease;
    const askedAt = now();
    let acquiredAt: number | undefined;
    let ended = false;
    const finish = () => {
      if (acquiredAt === undefined || ended) return;
      ended = true;
      const heldMs = now() - acquiredAt;
      if (cost !== null) cost.counts.writerHoldMs += heldMs;
      if (frame !== null) frame.holdMs += heldMs;
    };
    return Effect.andThen(
      Effect.addFinalizer(() => Effect.sync(finish)),
      lease.pipe(
        Effect.map((release) => {
          acquiredAt = now();
          if (frame !== null) frame.acquired = true;
          return () => {
            release();
            finish();
          };
        }),
        Effect.ensuring(
          Effect.sync(() => {
            const waitedMs = (acquiredAt ?? now()) - askedAt;
            if (cost !== null) cost.counts.writerWaitMs += waitedMs;
            if (frame !== null) frame.waitMs += waitedMs;
          }),
        ),
      ),
    );
  });
  return {
    drain: Effect.scoped(Effect.asVoid(take)),
    statement: Effect.as(
      Effect.flatMap(take, (release) => Effect.suspend(() => settle(standing)).pipe(Effect.onError(() => Effect.sync(release)))),
      writer,
    ),
    transaction: Effect.uninterruptibleMask((restore) => {
      const scope = Context.getUnsafe(Fiber.getCurrent()!.context, Scope.Scope);
      return Effect.as(
        Effect.tap(restore(Effect.andThen(checkConnection, take)), (release) =>
          Effect.andThen(
            Effect.flatMap(marked, (level) => settle(level ?? standing)).pipe(Effect.onError(() => Effect.sync(release))),
            Scope.addFinalizer(
              scope,
              Effect.ensuring(
                Effect.ignore(
                  Effect.tapError(
                    Effect.suspend(() => settle(standing)),
                    (failure) => Effect.logWarning('Failed to restore SQLite synchronous level after transaction', failure),
                  ),
                ),
                Effect.sync(release),
              ),
            ),
          ),
        ),
        writer,
      );
    }),
  };
};
