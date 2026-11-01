import { readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Deferred, Effect, Exit } from 'effect';

export type SourceRetention = ReturnType<typeof sourceRetention>;
type SourceLease = { readonly release: Effect.Effect<void> };

type Sweep = { readonly directory: string; readonly current: Effect.Effect<string | null, unknown> };

export const sourceRetention = () => {
  const users = new Map<string, number>();
  const retired = new Map<string, Set<string>>();
  const sweeps = new Map<string, Sweep[]>();
  const cleaning = new Map<string, Deferred.Deferred<void>>();

  const remove = (path: string) => Effect.tryPromise({ try: () => rm(path, { force: true }), catch: (cause) => cause });
  const prune = (directory: string) =>
    Effect.tryPromise({
      try: () =>
        rmdir(directory).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code !== 'ENOENT' && cause.code !== 'ENOTEMPTY' && cause.code !== 'EEXIST') throw cause;
        }),
      catch: (cause) => cause,
    });
  const cleanup = (threadId: string): Effect.Effect<void, unknown> =>
    Effect.suspend(() => {
      if (users.has(threadId) || cleaning.has(threadId)) return Effect.void;
      const pending = retired.get(threadId);
      const directories = sweeps.get(threadId);
      if (pending === undefined && directories === undefined) return Effect.void;
      const done = Deferred.makeUnsafe<void>();
      cleaning.set(threadId, done);
      return Effect.gen(function* () {
        if (pending !== undefined) {
          for (const path of [...pending]) {
            yield* remove(path);
            yield* prune(dirname(path));
            pending.delete(path);
          }
          if (pending.size === 0 && retired.get(threadId) === pending) retired.delete(threadId);
        }
        if (directories !== undefined) {
          for (const sweep of [...directories]) {
            const current = yield* sweep.current;
            const entries = yield* Effect.tryPromise({
              try: () =>
                readdir(sweep.directory).catch((cause: NodeJS.ErrnoException) => {
                  if (cause.code === 'ENOENT') return [];
                  throw cause;
                }),
              catch: (cause) => cause,
            });
            for (const name of entries) {
              if (!/^[0-9a-f-]{36}\.jsonl(?:\.zst|\.entries(?:\.partial)?)?$/.test(name)) continue;
              if (current !== null && (name === `${current}.jsonl` || name.startsWith(`${current}.jsonl.`))) continue;
              yield* remove(join(sweep.directory, name));
            }
            yield* prune(sweep.directory);
            const at = directories.indexOf(sweep);
            if (at >= 0) directories.splice(at, 1);
          }
          if (directories.length === 0 && sweeps.get(threadId) === directories) sweeps.delete(threadId);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cleaning.delete(threadId);
            Deferred.doneUnsafe(done, Exit.void);
          }),
        ),
        Effect.andThen(Effect.suspend(() => cleanup(threadId))),
        Effect.uninterruptible,
      );
    });
  const enter = (threadId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const running = cleaning.get(threadId);
      if (running !== undefined) return Effect.andThen(Deferred.await(running), enter(threadId));
      users.set(threadId, (users.get(threadId) ?? 0) + 1);
      return Effect.void;
    });
  const reported = (threadId: string) =>
    cleanup(threadId).pipe(
      Effect.catchCause((cause) => Effect.logError(`The retired journal files of ${threadId} could not be removed`, cause)),
    );

  const hold = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<SourceLease> {
    yield* enter(threadId);
    let released = false;
    return {
      release: Effect.suspend(() => {
        if (released) return Effect.void;
        released = true;
        const left = (users.get(threadId) ?? 1) - 1;
        if (left > 0) {
          users.set(threadId, left);
          return Effect.void;
        }
        users.delete(threadId);
        return reported(threadId);
      }).pipe(Effect.uninterruptible),
    };
  }, Effect.uninterruptible);

  return {
    hold,
    using: <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        hold(threadId),
        () => work,
        (lease) => lease.release,
      ),
    retire: (threadId: string, paths: readonly string[]): Effect.Effect<void, unknown> =>
      Effect.suspend(() => {
        let pending = retired.get(threadId);
        if (pending === undefined) {
          pending = new Set();
          retired.set(threadId, pending);
        }
        for (const path of paths) pending.add(path);
        return cleanup(threadId);
      }),
    sweep: (threadId: string, directory: string, current: Effect.Effect<string | null, unknown>): Effect.Effect<void, unknown> =>
      Effect.suspend(() => {
        const pending = sweeps.get(threadId) ?? [];
        pending.push({ directory, current });
        sweeps.set(threadId, pending);
        return cleanup(threadId);
      }),
  };
};
