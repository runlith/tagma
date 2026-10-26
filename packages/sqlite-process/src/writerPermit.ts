import type { Held } from '@runlith/held/Held';
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
  const take = held.lease(key).pipe(
    Effect.mapError(
      (failure) => new SqlError({ reason: classifySqliteError(failure, { message: failure.message, operation: 'execute' }) }),
    ),
    Effect.provideService(Clock.Clock, Context.get(Context.empty(), Clock.Clock)),
  );
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
