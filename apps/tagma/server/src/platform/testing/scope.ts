import { Cause, Data, Deferred, Effect, Exit, FileSystem, Inspectable, Result, Scope } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { dirname, join } from 'node:path';

export type ReleaseFailure = {
  readonly name: string;
  readonly path: string | null;
  readonly reason: string;
};

export type ReleaseReport = {
  readonly state: 'released' | 'failed' | 'unknown';
  readonly failures: readonly ReleaseFailure[];
  readonly remaining: readonly string[];
};

const failureOf = <E>(name: string, path: string | null, cause: Cause.Cause<E>): ReleaseFailure => {
  const failure = Cause.findError(cause);
  const reason = Result.isSuccess(failure) ? Inspectable.toStringUnknown(failure.success) : Cause.pretty(cause);
  return { name, path, reason: reason === '' ? 'the boundary answered with no reason' : reason };
};

const pathOccupied = (error: PlatformError): boolean => error.reason._tag === 'AlreadyExists';

export class FixtureNameInvalid extends Data.TaggedError('FixtureNameInvalid')<{ readonly name: string }> {}

export class FixtureRootConflict extends Data.TaggedError('FixtureRootConflict')<{ readonly root: string }> {}

export class FixtureRefused extends Data.TaggedError('FixtureRefused')<{ readonly root: string; readonly name: string }> {}

export type FixtureOutcome<A, E> = {
  readonly outcome: Exit.Exit<A, E>;
  readonly release: ReleaseReport;
};

export class FixtureScope {
  private readonly producers: {
    readonly name: string;
    readonly stopped: Effect.Effect<ReleaseFailure | undefined>;
  }[] = [];
  private readonly owned: { readonly name: string; readonly path: string }[] = [];
  private readonly creating: Deferred.Deferred<void>[] = [];
  private closing: Deferred.Deferred<ReleaseReport> | undefined;

  private constructor(
    readonly root: string,
    private readonly fileSystem: FileSystem.FileSystem,
  ) {
    this.owned.push({ name: 'root', path: root });
  }

  directory(name: string): Effect.Effect<string, FixtureRefused | FixtureNameInvalid | PlatformError> {
    return Effect.suspend<string, FixtureRefused | FixtureNameInvalid | PlatformError, never>(() => {
      if (this.closing !== undefined) return Effect.fail(new FixtureRefused({ root: this.root, name }));
      const path = this.under(name);
      if (path === undefined) return Effect.fail(new FixtureNameInvalid({ name }));
      this.owned.push({ name, path });
      const made = Deferred.makeUnsafe<void>();
      this.creating.push(made);
      return Effect.uninterruptible(
        Effect.as(this.fileSystem.makeDirectory(path, { recursive: true }), path).pipe(Effect.ensuring(Deferred.done(made, Exit.void))),
      );
    });
  }

  producer<E>(name: string, stop: Effect.Effect<void, E>): Effect.Effect<void, FixtureRefused> {
    return Effect.suspend<void, FixtureRefused, never>(() => {
      if (this.closing !== undefined) return Effect.fail(new FixtureRefused({ root: this.root, name }));
      const stopped = Effect.map(Effect.exit(stop), (ended) => (Exit.isFailure(ended) ? failureOf(name, null, ended.cause) : undefined));
      this.producers.push({ name, stopped });
      return Effect.void;
    });
  }

  close(): Effect.Effect<ReleaseReport> {
    return Effect.suspend(() => {
      const standing = this.closing;
      if (standing !== undefined) return Deferred.await(standing);
      const retained = Deferred.makeUnsafe<ReleaseReport>();
      this.closing = retained;
      return Effect.andThen(Effect.forEach(this.creating, Deferred.await, { discard: true }), this.closeOnce()).pipe(
        Effect.onExit((ended) => Effect.asVoid(Deferred.done(retained, ended))),
        Effect.uninterruptible,
      );
    });
  }

  private closeOnce(): Effect.Effect<ReleaseReport> {
    return FixtureScope.release(this.producers, this.owned, this.fileSystem);
  }

  private static readonly release = Effect.fnUntraced(function* (
    producers: readonly FixtureScope['producers'][number][],
    owned: readonly FixtureScope['owned'][number][],
    fileSystem: FileSystem.FileSystem,
  ) {
    const failures: ReleaseFailure[] = [];
    let unconfirmed = false;
    for (const held of [...producers].reverse()) {
      const failure = yield* held.stopped;
      if (failure !== undefined) {
        unconfirmed = true;
        failures.push(failure);
      }
    }

    if (!unconfirmed) {
      for (const held of [...owned].reverse()) {
        const removed = yield* Effect.exit(fileSystem.remove(held.path, { recursive: true, force: true }));
        if (Exit.isFailure(removed)) failures.push(failureOf(held.name, held.path, removed.cause));
      }
    }

    const remaining: string[] = [];
    let unmeasured = false;
    for (const held of owned) {
      const standing = yield* Effect.exit(fileSystem.exists(held.path));
      if (Exit.isFailure(standing)) {
        unmeasured = true;
        failures.push(failureOf(held.name, held.path, standing.cause));
        continue;
      }
      if (standing.value) remaining.push(held.path);
    }

    return {
      state: unconfirmed || unmeasured ? 'unknown' : failures.length === 0 && remaining.length === 0 ? 'released' : 'failed',
      failures,
      remaining,
    } satisfies ReleaseReport;
  });

  private under(name: string): string | undefined {
    if (name.startsWith('/')) return undefined;
    const segments = name.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.length === 0 || segments.includes('..')) return undefined;
    return join(this.root, ...segments);
  }

  private static readonly open = Effect.fnUntraced(function* (root: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirname(root), { recursive: true });
    yield* Effect.catchIf(fileSystem.makeDirectory(root), pathOccupied, () => Effect.fail(new FixtureRootConflict({ root })));
    return new FixtureScope(root, fileSystem);
  });

  static acquire(root: string): Effect.Effect<FixtureScope, FixtureRootConflict | PlatformError, Scope.Scope | FileSystem.FileSystem> {
    return Effect.acquireRelease(FixtureScope.open(root), (held) => Effect.asVoid(held.close()));
  }

  static readonly use = Effect.fnUntraced(function* <A, E, R>(root: string, body: (fixture: FixtureScope) => Effect.Effect<A, E, R>) {
    const [fixture, outcome] = yield* Effect.acquireUseRelease(
      FixtureScope.open(root),
      (held) => Effect.map(Effect.exit(Effect.suspend(() => body(held))), (ended) => [held, ended] as const),
      (held) => Effect.asVoid(held.close()),
    );
    return { outcome, release: yield* fixture.close() } satisfies FixtureOutcome<A, E>;
  });
}
