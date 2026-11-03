import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Clock, Data, Deferred, Effect, Exit, FileSystem, Layer, PubSub, Semaphore, Stream } from 'effect';
import { UserEnvironment, type UserPaths } from '../../installation/contract/service/userEnvironment.js';
import { locatedIn } from '../../installation/process/userEnvironment.js';
import { type HarnessProgram, InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { harnessPresentation } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import type { HarnessInstall } from '../../threads/contract/wire/harness/externalSession.js';

const VERSION_BUDGET_MS = 5_000;

type Probe =
  | { readonly _tag: 'Answered'; readonly version: string }
  | { readonly _tag: 'Failed'; readonly reason: string }
  | { readonly _tag: 'Slow' };

type Found = {
  readonly program: HarnessProgram;
  readonly key: string;
  readonly version: string | null;
  readonly unreadable: string | null;
};

type Resolved = { readonly _tag: 'Found'; readonly found: Found } | { readonly _tag: 'Missing'; readonly reason: string };

type Entry = {
  readonly path: string;
  done: Resolved | null;
  readonly last: Resolved | null;
  readonly waiting: Deferred.Deferred<Resolved>;
};

class ProbeRefused extends Data.TaggedError('ProbeRefused')<{ readonly message: string }> {}

const sameAnswer = (now: Resolved, was: Resolved | null): boolean =>
  was !== null &&
  (now._tag === 'Missing'
    ? was._tag === 'Missing' && was.reason === now.reason
    : was._tag === 'Found' &&
      was.found.program.path === now.found.program.path &&
      was.found.program.runtime === now.found.program.runtime &&
      was.found.version === now.found.version &&
      was.found.unreadable === now.found.unreadable);

const onPath = (dir: string, path: string): boolean => path.split(':').some((entry) => entry.length > 0 && resolve(entry) === resolve(dir));

export const installedHere = (adapter: HarnessAdapter): string | null =>
  locatedIn(adapter.binary, [...(process.env.PATH ?? '').split(':'), ...(adapter.installedIn?.(homedir()) ?? [])])[0] ?? null;

export const pathWith = (runtime: string | null, path: string): string => (runtime === null ? path : `${runtime}:${path}`);

export const makeInstalledHarnesses = Effect.fnUntraced(function* (input: { readonly budgetMs: number }) {
  const { budgetMs } = input;
  const users = yield* UserEnvironment;
  const files = yield* FileSystem.FileSystem;
  const adapters = yield* HarnessAdapters;
  const home = homedir();
  const memo = new Map<string, Entry>();
  const failed = new Map<string, string>();
  let generation = 0;
  const probes = yield* Semaphore.make(3);
  const scope = yield* Effect.scope;
  const moved = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);

  const fileKey = Effect.fn('InstalledHarnesses.fileKey')(
    function* (path: string) {
      const real = yield* files.realPath(path);
      const info = yield* Effect.tryPromise(() => stat(real));
      return `${real}\u0000${info.mtimeMs}\u0000${info.size}`;
    },
    (effect, path) =>
      Effect.catch(effect, (cause) =>
        Effect.logDebug('The CLI fingerprint is unreadable; its cached resolution is not trusted.', { path, cause }).pipe(Effect.as(null)),
      ),
  );
  const runtimeOf = Effect.fn('InstalledHarnesses.runtimeOf')(function* (candidate: string, path: string) {
    const dir = dirname(candidate);
    if (onPath(dir, path)) return null;
    const exists = yield* files
      .exists(join(dir, 'node'))
      .pipe(
        Effect.catch((cause) =>
          Effect.logDebug('The adjacent CLI runtime could not be inspected; PATH is kept.', { candidate, cause }).pipe(Effect.as(false)),
        ),
      );
    return exists ? dir : null;
  });
  const probed = Effect.fn('InstalledHarnesses.probe')(function* (
    candidate: string,
    path: string,
    budget: number,
    declared: Readonly<Record<string, string>>,
  ) {
    const born = generation;
    const file = yield* fileKey(candidate);
    const key = file === null ? null : `${file}\u0000${path}`;
    const known = key === null ? undefined : failed.get(key);
    if (known !== undefined) return { _tag: 'Failed', reason: known } as const;
    const refused = (cause: unknown) =>
      new ProbeRefused({ message: `${candidate} could not run: ${cause instanceof Error ? cause.message : String(cause)}` });
    const answer: Probe = yield* Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            Bun.spawn([candidate, '--version'], {
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'ignore',
              env: { ...process.env, ...declared, PATH: path },
            }),
          catch: refused,
        }),
        (child) =>
          Effect.promise(async () => {
            if (child.exitCode === null) child.kill('SIGKILL');
            await child.exited;
          }),
      );
      const [printed, exitCode] = yield* Effect.tryPromise({
        try: () => Promise.all([new Response(child.stdout).text(), child.exited]),
        catch: refused,
      });
      if (exitCode !== 0) return { _tag: 'Failed', reason: `${candidate} --version exited ${exitCode}` } as const;
      const first = printed.trim().split('\n', 1)[0]?.trim() ?? '';
      return first.length === 0
        ? ({ _tag: 'Failed', reason: `${candidate} --version printed nothing` } as const)
        : ({ _tag: 'Answered', version: first } as const);
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({ duration: budget, orElse: () => Effect.succeed({ _tag: 'Slow' } as const) }),
      probes.withPermit,
      Effect.match({ onFailure: (failure) => ({ _tag: 'Failed', reason: failure.message }) as const, onSuccess: (answer) => answer }),
    );
    if (answer._tag === 'Failed' && key !== null && born === generation) failed.set(key, answer.reason);
    return answer;
  });

  const search = Effect.fn('InstalledHarnesses.search')(function* (adapter: HarnessAdapter, path: string) {
    const candidates = yield* users.locate(adapter.binary, adapter.installedIn?.(home) ?? []);
    if (candidates.length === 0) {
      return { _tag: 'Missing', reason: `${adapter.binary} is on neither PATH nor in the places it installs to` } as Resolved;
    }
    const reasons: string[] = [];
    let slow: string | null = null;
    let second: number | null = null;
    for (const [at, candidate] of candidates.entries()) {
      const runtime = yield* runtimeOf(candidate, path);
      const budget = second === null ? budgetMs : Math.max(1, Math.floor(second / (candidates.length - at)));
      const startedAt = yield* Clock.currentTimeMillis;
      const answer = yield* probed(candidate, pathWith(runtime, path), budget, adapter.env ?? {});
      if (second !== null) second = Math.max(0, second - ((yield* Clock.currentTimeMillis) - startedAt));
      if (answer._tag === 'Answered') {
        const found: Found = {
          program: { path: candidate, runtime },
          key: (yield* fileKey(candidate)) ?? candidate,
          version: answer.version,
          unreadable: null,
        };
        return { _tag: 'Found', found } as Resolved;
      }
      if (answer._tag === 'Slow') {
        slow ??= candidate;
        second ??= budgetMs;
        reasons.push(`${candidate} did not answer --version in ${budget} ms`);
      } else reasons.push(answer.reason);
    }
    if (slow === null) return { _tag: 'Missing', reason: reasons.join('; ') } as Resolved;
    const found: Found = {
      program: { path: slow, runtime: yield* runtimeOf(slow, path) },
      key: (yield* fileKey(slow)) ?? slow,
      version: null,
      unreadable: `--version did not answer in ${budgetMs} ms`,
    };
    return { _tag: 'Found', found } as Resolved;
  });

  const entryOf = (adapter: HarnessAdapter): Effect.Effect<Entry> =>
    Effect.suspend(() => {
      const path = process.env.PATH ?? '';
      const held = memo.get(adapter.harness);
      if (held !== undefined && held.path === path && held.done?._tag !== 'Found') return Effect.succeed(held);
      const known = held?.path === path ? held.done : null;
      const entry: Entry = { path, done: null, last: known, waiting: Deferred.makeUnsafe<Resolved>() };
      memo.set(adapter.harness, entry);
      const reading =
        known?._tag === 'Found'
          ? Effect.flatMap(fileKey(known.found.program.path), (key) =>
              key === known.found.key ? Effect.succeed<Resolved>(known) : search(adapter, path),
            )
          : search(adapter, path);
      return reading.pipe(
        Effect.tap((resolved) =>
          Effect.flatMap(
            Effect.sync(() => {
              entry.done = resolved;
              return !sameAnswer(resolved, known);
            }),
            (news) => Effect.andThen(Deferred.succeed(entry.waiting, resolved), news ? PubSub.publish(moved, undefined) : Effect.void),
          ),
        ),
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.andThen(
                Effect.sync(() => {
                  if (memo.get(adapter.harness) === entry) memo.delete(adapter.harness);
                }),
                Deferred.done(entry.waiting, exit),
              ),
        ),
        Effect.withSpan('InstalledHarnesses.resolve', { root: true }),
        Effect.forkIn(scope),
        Effect.as(entry),
      );
    });

  const resolveProgram = Effect.fnUntraced(function* (adapter: HarnessAdapter) {
    const entry = yield* entryOf(adapter);
    return entry.done ?? (yield* Deferred.await(entry.waiting));
  });

  const standing = Effect.fnUntraced(function* (adapter: HarnessAdapter, paths: UserPaths) {
    const path = process.env.PATH ?? '';
    const candidates = yield* users.locate(adapter.binary, adapter.installedIn?.(home) ?? []);
    const candidate = candidates[0];
    if (candidate === undefined)
      return rowOf(adapter, { _tag: 'Missing', reason: `${adapter.binary} is on neither PATH nor in the places it installs to` }, paths);
    const held = memo.get(adapter.harness);
    const known = held?.path === path ? (held.done ?? held.last) : null;
    if (known?._tag === 'Found' && candidates.includes(known.found.program.path)) {
      const key = yield* fileKey(known.found.program.path);
      if (key === known.found.key) return rowOf(adapter, known, paths);
    }
    const runtime = yield* runtimeOf(candidate, path);
    const key = yield* fileKey(candidate);
    return rowOf(
      adapter,
      {
        _tag: 'Found',
        found: {
          program: { path: candidate, runtime },
          key: key ?? candidate,
          version: null,
          unreadable: key === null ? null : (failed.get(`${key}\u0000${pathWith(runtime, path)}`) ?? null),
        },
      },
      paths,
    );
  });

  const rowOf = (adapter: HarnessAdapter, resolved: Resolved, paths: UserPaths): HarnessInstall => {
    const serves = adapter.acp?.hosts != null ? (adapter.acp.serves ?? null) : null;
    if (resolved._tag === 'Found') {
      const { found } = resolved;
      return {
        harness: adapter.harness,
        presentation: harnessPresentation(adapter),
        binary: found.program.path,
        version: found.version,
        unreadable: found.unreadable,
        serves,
        searching: false,
        missing: null,
      };
    }
    const profile = paths.profile;
    const told =
      profile === null || profile.outcome === 'read' || profile.outcome === 'not-needed'
        ? resolved.reason
        : `${resolved.reason}; the login profile was not read (${profile.outcome}${profile.detail === null ? '' : `: ${profile.detail}`})`;
    return {
      harness: adapter.harness,
      presentation: harnessPresentation(adapter),
      binary: null,
      version: null,
      unreadable: null,
      serves,
      searching: paths.reading,
      missing: told,
    };
  };

  const observed = new Map<string, HarnessInstall>();
  const moves = (row: HarnessInstall, before: HarnessInstall | undefined): boolean =>
    before === undefined ||
    row.binary !== before.binary ||
    row.version !== before.version ||
    row.unreadable !== before.unreadable ||
    row.searching !== before.searching ||
    row.missing !== before.missing;
  const rows = Effect.fnUntraced(function* (paths: UserPaths) {
    const found = yield* Effect.forEach(adapters.all(), (adapter) => standing(adapter, paths), { concurrency: 3 });
    const changed = found.length !== observed.size || found.some((row) => moves(row, observed.get(row.harness)));
    observed.clear();
    for (const row of found) observed.set(row.harness, row);
    if (changed) yield* PubSub.publish(moved, undefined);
    return found;
  });
  const availability = Effect.fn('InstalledHarnesses.availability')(function* (binary: string) {
    const declared = adapters.all();
    const adapter = declared.find((one) => one.binary === binary);
    if (adapter === undefined)
      return declared.length === 0 ? ({ _tag: 'Searching' } as const) : ({ _tag: 'Missing', reason: `no harness runs ${binary}` } as const);
    const row = yield* Effect.flatMap(users.now, (paths) => standing(adapter, paths));
    const before = observed.get(row.harness);
    observed.set(row.harness, row);
    if (before !== undefined && moves(row, before)) yield* PubSub.publish(moved, undefined);
    if (row.binary !== null) return { _tag: 'Found' } as const;
    return row.searching
      ? ({ _tag: 'Searching' } as const)
      : ({ _tag: 'Missing', reason: row.missing ?? `${binary} was not found` } as const);
  });

  yield* Effect.forkScoped(Effect.andThen(users.ready, PubSub.publish(moved, undefined)));
  yield* Effect.forkScoped(
    Stream.runForEach(adapters.changes, () =>
      Effect.andThen(
        Effect.sync(() => {
          memo.clear();
          failed.clear();
          generation += 1;
        }),
        PubSub.publish(moved, undefined),
      ),
    ),
  );

  return InstalledHarnesses.of({
    read: Effect.flatMap(users.now, rows).pipe(Effect.withSpan('InstalledHarnesses.read')),
    settled: Effect.flatMap(users.ready, rows).pipe(Effect.withSpan('InstalledHarnesses.settled')),
    refresh: Effect.gen(function* () {
      const paths = yield* users.refresh;
      memo.clear();
      failed.clear();
      generation += 1;
      const answered = yield* rows(paths);
      yield* PubSub.publish(moved, undefined);
      return answered;
    }).pipe(Effect.withSpan('InstalledHarnesses.refresh')),
    availability,
    locate: Effect.fn('InstalledHarnesses.locate')(function* (name) {
      const adapter = adapters.all().find((one) => one.binary === name);
      if (adapter === undefined) return null;
      const paths = yield* users.now;
      const candidates = yield* users.locate(name, adapter.installedIn?.(home) ?? []);
      const candidate = candidates[0];
      return candidate === undefined ? null : { path: candidate, runtime: yield* runtimeOf(candidate, paths.path) };
    }),
    program: Effect.fn('InstalledHarnesses.program')(function* (name, by = 'binary') {
      const adapter = adapters.all().find((one) => one[by] === name);
      if (adapter === undefined) return null;
      yield* users.ready;
      const resolved = yield* resolveProgram(adapter);
      return resolved._tag === 'Found' ? resolved.found.program : null;
    }),
    changes: Stream.fromPubSub(moved),
  });
});

export const installedHarnessesWith = (
  budgetMs: number,
): Layer.Layer<InstalledHarnesses, never, UserEnvironment | FileSystem.FileSystem | HarnessAdapters> =>
  Layer.effect(InstalledHarnesses, makeInstalledHarnesses({ budgetMs }));

export const installedHarnessesLayer = installedHarnessesWith(VERSION_BUDGET_MS);
