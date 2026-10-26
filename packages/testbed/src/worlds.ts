import { Cause, type Context, Deferred, Effect, Exit, Layer, Scope } from 'effect';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { closeOnExec, lockExclusive } from '@runlith/file-lock/flock';
import type { Cost, Meter } from './core/ledger.ts';
import { quietly } from './core/pristine.ts';
import { worldHome } from './core/run.ts';
import { claim, holding, meter, runRoot, span, worldTaken } from './fixture.ts';

export type Params = null | boolean | number | string | readonly Params[] | { readonly [key: string]: Params | undefined };

export type Kind<I, S, P extends Params, E> = {
  readonly tag: Context.Key<I, S>;
  readonly build: (params: P, home: string) => Effect.Effect<S, E, Scope.Scope>;
};

export type Taking = {
  readonly own?: string;
};

export const kind = <I, S, P extends Params = null, E = never>(
  tag: Context.Key<I, S>,
  build: (params: P, home: string) => Effect.Effect<S, E, Scope.Scope>,
): Kind<I, S, P, E> => ({ tag, build });

const BUILD_BUDGET_MS = 60_000;

const NOTHING: Cost = { cpu: 0, wall: 0 };

const registry = new Map<string, Deferred.Deferred<unknown, unknown>>();

const runner = typeof Bun === 'undefined' ? undefined : (createRequire(import.meta.url)('bun:test') as typeof import('bun:test'));

const canonical = (value: Params | undefined): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as { readonly [key: string]: Params | undefined };
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
};

const keyOf = (name: string, params: Params): string => `${name} ${canonical(params)}`;

const between = (from: Meter | undefined, to: Meter | undefined): Cost =>
  from === undefined || to === undefined ? NOTHING : { cpu: to.own - from.own + (to.kids - from.kids), wall: to.wall - from.wall };

const built = <S, E>(work: Effect.Effect<S, E, Scope.Scope>, scope: Scope.Scope) =>
  Effect.suspend(() => {
    const started = meter();
    const stopHolding = holding();
    const stopSpan = span('world');
    return Effect.exit(Scope.provide(work, scope)).pipe(
      Effect.map((exit) => ({ exit, cost: between(started, meter()) })),
      Effect.ensuring(
        Effect.sync(() => {
          stopSpan();
          stopHolding();
        }),
      ),
    );
  });

const taken = <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P, noted: boolean): Effect.Effect<S, E> =>
  Effect.suspend(() => {
    const key = keyOf(kind.tag.key, params);
    const standing = registry.get(key) as Deferred.Deferred<S, E> | undefined;
    if (standing !== undefined) {
      if (noted) worldTaken({ kind: kind.tag.key, key, built: false, own: null, cost: NOTHING });
      return Deferred.await(standing);
    }
    const settled = Deferred.makeUnsafe<S, E>();
    registry.set(key, settled as Deferred.Deferred<unknown, unknown>);
    Effect.runFork(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const home = worldHome();
        const unclaim = claim(home);
        const { exit, cost } = yield* built(kind.build(params, home), scope);
        let answer = exit;
        if (Exit.isFailure(exit)) {
          registry.delete(key);
          const closed = yield* Effect.exit(Scope.close(scope, exit));
          unclaim();
          if (Exit.isFailure(closed)) answer = Exit.failCause(Cause.combine(exit.cause, closed.cause));
        }
        worldTaken({ kind: kind.tag.key, key, built: true, own: null, cost });
        yield* Deferred.done(settled, answer);
      }),
    );
    return Deferred.await(settled);
  });

export const shared = <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P): Effect.Effect<S, E> => taken(kind, params, true);

export const open = <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P): Promise<S> => Effect.runPromise(shared(kind, params));

export const own = Effect.fnUntraced(function* <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P, reason: string) {
  const started = meter();
  const stopSpan = span('world');
  const exit = yield* Effect.exit(kind.build(params, worldHome())).pipe(Effect.ensuring(Effect.sync(stopSpan)));
  worldTaken({ kind: kind.tag.key, key: keyOf(kind.tag.key, params), built: true, own: reason, cost: between(started, meter()) });
  return yield* exit;
});

const ownEarly = <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P, reason: string): Layer.Layer<I, E> => {
  let scope: Scope.Closeable | undefined;
  let started: Promise<Exit.Exit<S, E>> | undefined;
  const start = (): Promise<Exit.Exit<S, E>> =>
    (started ??= Effect.runPromise(
      Effect.gen(function* () {
        const made = yield* Scope.make();
        const exit = yield* Effect.exit(Scope.provide(own(kind, params, reason), made));
        if (Exit.isFailure(exit)) yield* Scope.close(made, exit);
        else scope = made;
        return exit;
      }),
    ));
  runner?.beforeAll(() => start().then(() => undefined), BUILD_BUDGET_MS);
  return Layer.effect(
    kind.tag,
    Effect.acquireRelease(
      Effect.flatMap(Effect.promise(start), (exit): Effect.Effect<S, E> => exit),
      () =>
        Effect.suspend(() => {
          const held = scope;
          scope = undefined;
          started = undefined;
          return held === undefined ? Effect.void : Scope.close(held, Exit.void);
        }),
    ),
  );
};

export type RunKind<V extends Params, P extends Params, E> = {
  readonly name: string;
  readonly build: (params: P, directory: string) => Effect.Effect<V, E, Scope.Scope>;
};

export type Made<V> = { readonly directory: string; readonly value: V };

export const runKind = <V extends Params, P extends Params = null, E = never>(
  name: string,
  build: (params: P, directory: string) => Effect.Effect<V, E, Scope.Scope>,
): RunKind<V, P, E> => ({ name, build });

const LOCK_PROBE_MS = 50;

const made = new Map<string, Deferred.Deferred<unknown, unknown>>();

const files = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

let local: string | undefined;

const settled = <V>(pointer: string): Made<V> | undefined =>
  quietly(() => {
    try {
      return JSON.parse(files.readFileSync(pointer, 'utf8')) as Made<V>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  });

const locked = (path: string): number | undefined =>
  quietly(() => {
    const handle = files.openSync(path, 'a', 0o600);
    closeOnExec(handle);
    if (lockExclusive(handle) === 'locked') return handle;
    files.closeSync(handle);
    return undefined;
  });

const attempt = (stem: string): string =>
  quietly(() => {
    const directory = `${stem}.${process.pid}.${randomUUID().slice(0, 8)}`;
    files.mkdirSync(directory, { recursive: true });
    return directory;
  });

const published = <V>(pointer: string, made: Made<V>): void =>
  quietly(() => {
    files.writeFileSync(`${pointer}.draft`, JSON.stringify(made));
    files.renameSync(`${pointer}.draft`, pointer);
  });

const producedUnder = Effect.fnUntraced(function* <V extends Params, P extends Params, E>(
  kind: RunKind<V, P, E>,
  params: P,
  stem: string,
): Effect.fn.Return<{ readonly made: Made<V>; readonly cost: Cost | undefined }, E> {
  const again = settled<V>(`${stem}.json`);
  if (again !== undefined) return { made: again, cost: undefined };
  const directory = attempt(stem);
  const scope = yield* Scope.make();
  const { exit, cost } = yield* built(kind.build(params, directory), scope);
  yield* Scope.close(scope, exit);
  const made: Made<V> = { directory, value: yield* exit };
  published(`${stem}.json`, made);
  return { made, cost };
});

const producing = Effect.fnUntraced(function* <V extends Params, P extends Params, E>(
  kind: RunKind<V, P, E>,
  params: P,
  key: string,
): Effect.fn.Return<{ readonly made: Made<V>; readonly cost: Cost | undefined }, E> {
  const base = join(runRoot() ?? (local ??= worldHome()), 'run-worlds');
  quietly(() => files.mkdirSync(base, { recursive: true }));
  const stem = join(base, createHash('sha256').update(key).digest('hex').slice(0, 16));
  for (;;) {
    const standing = settled<V>(`${stem}.json`);
    if (standing !== undefined) return { made: standing, cost: undefined };
    const handle = locked(`${stem}.lock`);
    if (handle === undefined) {
      yield* Effect.sleep(LOCK_PROBE_MS);
      continue;
    }
    return yield* producedUnder(kind, params, stem).pipe(Effect.ensuring(Effect.sync(() => quietly(() => files.closeSync(handle)))));
  }
});

export const once = <V extends Params, P extends Params, E>(kind: RunKind<V, P, E>, params: P): Effect.Effect<Made<V>, E> =>
  Effect.suspend(() => {
    const key = keyOf(kind.name, params);
    const standing = made.get(key) as Deferred.Deferred<Made<V>, E> | undefined;
    if (standing !== undefined) return Deferred.await(standing);
    const answer = Deferred.makeUnsafe<Made<V>, E>();
    made.set(key, answer as Deferred.Deferred<unknown, unknown>);
    Effect.runFork(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(producing(kind, params, key));
        if (Exit.isFailure(exit)) made.delete(key);
        else worldTaken({ kind: kind.name, key, built: exit.value.cost !== undefined, own: null, cost: exit.value.cost ?? NOTHING });
        yield* Deferred.done(
          answer,
          Exit.map(exit, (done) => done.made),
        );
      }),
    );
    return Deferred.await(answer);
  });

export const world = <I, S, P extends Params, E>(kind: Kind<I, S, P, E>, params: P, taking: Taking = {}): Layer.Layer<I, E> => {
  if (taking.own !== undefined)
    return runner === undefined ? Layer.effect(kind.tag, own(kind, params, taking.own)) : ownEarly(kind, params, taking.own);
  runner?.beforeAll(() => Effect.runPromise(taken(kind, params, false)), BUILD_BUDGET_MS);
  return Layer.effect(kind.tag, shared(kind, params));
};
