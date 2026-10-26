import { Cause, Context, Effect, Exit, Layer, Scope } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';

export const testServices = Layer.mergeAll(TestClock.layer(), TestConsole.layer);

function valueOf<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  return exit.value;
}

export async function runTest<A, E>(effect: Effect.Effect<A, E>, onFinished: (cleanup: () => Promise<void>) => void): Promise<void> {
  const stop = new AbortController();
  const settled = Effect.runPromiseExit(effect, { signal: stop.signal });
  let completed = false;
  onFinished(async () => {
    if (completed) return;
    stop.abort();
    const exit = await settled;
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) valueOf(exit);
  });
  try {
    const exit = await settled;
    if (!stop.signal.aborted) valueOf(exit);
  } finally {
    completed = true;
  }
}

export function makeFixture<R, R2, E>(
  parent: Effect.Effect<Context.Context<R>>,
  source: Layer.Layer<R2, E, R>,
  parentMemo?: Layer.MemoMap,
  suppliedMemo?: Layer.MemoMap,
) {
  const memo = suppliedMemo ?? (parentMemo === undefined ? Layer.makeMemoMapUnsafe() : Layer.forkMemoMapUnsafe(parentMemo));
  let scope: Scope.Closeable | undefined;
  let context: Context.Context<R | R2> | undefined;
  let building: { readonly stop: AbortController; readonly settled: Promise<Exit.Exit<Context.Context<R | R2>, E>> } | undefined;
  const services = Effect.suspend(() =>
    context === undefined ? Effect.die('the test layer has not been built') : Effect.succeed(context),
  );
  return {
    memo,
    services,
    async acquire(): Promise<void> {
      const opened = Scope.makeUnsafe();
      scope = opened;
      const stop = new AbortController();
      const settled = Effect.runPromiseExit(
        Effect.gen(function* () {
          const inherited = yield* parent;
          const built = yield* Layer.buildWithMemoMap(source, memo, opened).pipe(Effect.provide(inherited));
          return Context.merge(inherited, built);
        }),
        { signal: stop.signal },
      );
      building = { stop, settled };
      try {
        const exit = await settled;
        if (!stop.signal.aborted) context = valueOf(exit);
      } finally {
        building = undefined;
      }
    },
    async release(): Promise<void> {
      const pending = building;
      pending?.stop.abort();
      try {
        if (pending !== undefined) {
          const exit = await pending.settled;
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) valueOf(exit);
        }
      } finally {
        if (scope !== undefined) valueOf(await Effect.runPromiseExit(Scope.close(scope, Exit.void)));
      }
    },
  };
}
