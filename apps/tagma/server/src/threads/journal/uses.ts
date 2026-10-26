import { Deferred, Effect, Exit } from 'effect';

export type ThreadUses = ReturnType<typeof threadUses>;

export const threadUses = (released: (threadId: string) => void) => {
  const users = new Map<string, number>();
  const resting = new Map<string, Deferred.Deferred<void>>();
  return {
    using: <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          for (let standing = resting.get(threadId); standing !== undefined; standing = resting.get(threadId)) {
            yield* Deferred.await(standing);
          }
          users.set(threadId, (users.get(threadId) ?? 0) + 1);
        }),
        () => work,
        () =>
          Effect.sync(() => {
            const left = (users.get(threadId) ?? 1) - 1;
            if (left > 0) {
              users.set(threadId, left);
              return;
            }
            users.delete(threadId);
            released(threadId);
          }),
      ),
    rest: <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>, busy: A): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        if (users.has(threadId) || resting.has(threadId)) return Effect.succeed(busy);
        const done = Deferred.makeUnsafe<void>();
        resting.set(threadId, done);
        return Effect.ensuring(
          work,
          Effect.sync(() => {
            resting.delete(threadId);
            Deferred.doneUnsafe(done, Exit.void);
          }),
        );
      }),
  };
};
