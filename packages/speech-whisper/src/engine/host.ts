import { type Duration, Effect, Exit, Scope, Semaphore } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import type { Channel } from './channel.ts';
import { type EnginePaths, spawn } from './spawn.ts';

type Running = {
  readonly channel: Channel;
  readonly scope: Scope.Closeable;
};

export const makeHost = Effect.fnUntraced(function* ({ paths, within }: { readonly paths: EnginePaths; readonly within: Duration.Input }) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  let current: Running | undefined;

  const alive = (): Channel | undefined => {
    const channel = current?.channel;
    return channel?.alive === true ? channel : undefined;
  };

  const retire = Effect.suspend(() => {
    const gone = current;
    current = undefined;
    return gone === undefined ? Effect.void : Scope.close(gone.scope, Exit.void);
  });

  const start = Effect.gen(function* () {
    const child = yield* Scope.fork(scope);
    const started = yield* spawn(paths, within).pipe(
      Scope.provide(child),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.exit,
    );
    if (Exit.isFailure(started)) {
      yield* Scope.close(child, started);
      return yield* started;
    }
    current = { channel: started.value, scope: child };
    return started.value;
  });

  const channel = lock.withPermit(
    Effect.suspend(() => {
      const standing = alive();
      if (standing !== undefined) return Effect.succeed(standing);
      return Effect.andThen(retire, start);
    }),
  );

  return {
    get running(): Channel | undefined {
      return alive();
    },
    channel,
  };
});

export type Host = Effect.Success<ReturnType<typeof makeHost>>;
