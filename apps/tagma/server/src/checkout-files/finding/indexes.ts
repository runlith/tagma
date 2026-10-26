import { Deferred, Effect, type Fiber, FiberSet, Scope, Stream } from 'effect';
import type { WorkerUnavailable } from '@runlith/utils/worker';
import { Git } from '@runlith/git/Git';
import { filesUnder } from '@runlith/git/entries';
import { GateRefusal, type GitRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { CheckoutWatch, type CheckoutShift, type Following } from '../../workspace/contract/service/watch.js';
import { rootReadRefusal } from '../../workspace/roots/refusal.js';
import type { RootRefusal } from '../../workspace/contract/wire/refusals.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { PathIndex, type FindAsk, type Found } from '../contract/service/pathIndex.js';
import type { FilesWorker } from '../worker/client.js';

const LINGER_MS = 120_000;

export const PATHS_PER_LISTING = 200;

type Refusal = GateRefusal<GitRefusal | RootRefusal | 'worker-unavailable' | 'index-lost' | 'superseded'>;

type Entry = {
  readonly rootId: RootId;
  readonly path: string;
  readonly generation: number;
  readonly ready: Deferred.Deferred<void, Refusal>;
  following: Following | null;
  consumer: Fiber.Fiber<void> | null;
  closer: ReturnType<typeof setTimeout> | null;
  supersede: (() => void) | null;
  dead: boolean;
};

const unavailable = (gone: WorkerUnavailable): Refusal =>
  new GateRefusal('worker-unavailable', gone.message, ['ask again; the worker starts afresh']);

const lostIndex = (): Refusal =>
  new GateRefusal('index-lost', 'the path index of this checkout was dropped while it was being asked', [
    'ask again; the index is rebuilt',
  ]);

const widens = (shift: CheckoutShift): boolean =>
  shift.rescan !== null ||
  shift.movements.includes('ignore') ||
  [...shift.paths.keys()].some((path) => path === '.gitignore' || path.endsWith('/.gitignore'));

export const makePathIndexes = Effect.fnUntraced(function* (input: { readonly worker: FilesWorker; readonly graphDirectory: string }) {
  const git = yield* Git;
  const watch = yield* CheckoutWatch;
  const { worker, graphDirectory } = input;
  const scope = yield* Scope.Scope;
  const entries = new Map<RootId, Entry>();
  const armed = yield* Effect.cached(FiberSet.makeRuntime<never, void, never>().pipe(Scope.provide(scope)));
  let generation = 0;
  let runner: ((work: Effect.Effect<void>) => unknown) | null = null;

  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      for (const entry of [...entries.values()]) discard(entry);
    }),
  );

  const shown = (path: string): boolean => path !== graphDirectory && !path.startsWith(`${graphDirectory}/`);

  const touch = (entry: Entry): void => {
    if (entry.closer !== null) clearTimeout(entry.closer);
    entry.closer = setTimeout(() => discard(entry), LINGER_MS);
    entry.closer.unref();
  };

  const discard = (entry: Entry): void => {
    if (entry.dead) return;
    entry.dead = true;
    if (entry.closer !== null) clearTimeout(entry.closer);
    entry.closer = null;
    if (entries.get(entry.rootId) === entry) entries.delete(entry.rootId);
    entry.consumer?.interruptUnsafe();
    entry.consumer = null;
    entry.following?.release();
    entry.following = null;
    entry.supersede?.();
    runner?.(Effect.asVoid(Effect.result(worker.ask({ kind: 'drop', root: entry.rootId, generation: entry.generation }))));
  };

  const build = Effect.fnUntraced(function* (entry: Entry) {
    const listed = yield* Effect.mapError(filesUnder(git, entry.path, '', { others: true }), gitRefusal);
    if (entry.dead) return;
    yield* Effect.mapError(
      worker.ask({
        kind: 'load',
        root: entry.rootId,
        generation: entry.generation,
        paths: listed.filter((path) => shown(path)),
      }),
      unavailable,
    );
  });

  const apply = Effect.fnUntraced(
    function* (entry: Entry, shift: CheckoutShift) {
      if (entry.dead) return;
      if (widens(shift)) return yield* build(entry);
      const scanned = [...shift.paths].filter(([path, move]) => move === 'rename' && shown(path)).map(([path]) => path);
      for (let at = 0; at < scanned.length && !entry.dead; at += PATHS_PER_LISTING) {
        const batch = scanned.slice(at, at + PATHS_PER_LISTING);
        const found = yield* Effect.mapError(filesUnder(git, entry.path, batch, { others: true }), gitRefusal);
        if (entry.dead) return;
        const patched = yield* Effect.mapError(
          worker.ask({
            kind: 'patch',
            root: entry.rootId,
            generation: entry.generation,
            scanned: batch,
            found: found.filter((path) => shown(path)),
          }),
          unavailable,
        );
        if (patched.kind === 'absent') return yield* build(entry);
      }
    },
    (effect, entry) =>
      Effect.matchEffect(effect, {
        onSuccess: () => Effect.void,
        onFailure: (refusal) =>
          Effect.andThen(
            Effect.logWarning('the path index of a checkout is dropped to be rebuilt on the next question', {
              root: entry.rootId,
              reason: refusal.reason,
            }),
            Effect.sync(() => discard(entry)),
          ),
      }),
  );

  const open = Effect.fnUntraced(function* (entry: Entry) {
    const following = yield* Effect.mapError(watch.follow(entry.rootId), rootReadRefusal);
    if (entry.dead) {
      following.release();
      return yield* lostIndex();
    }
    entry.following = following;
    yield* build(entry);
    entry.consumer = yield* Effect.forkIn(
      Stream.runForEach(following.shifts, (shift) => apply(entry, shift)),
      scope,
    );
    yield* Deferred.succeed(entry.ready, undefined);
  });

  const entryOf = Effect.fnUntraced(function* (place: ProjectRoot) {
    runner = yield* armed;
    const standing = entries.get(place.rootId);
    if (standing !== undefined && standing.path === place.path) return standing;
    if (standing !== undefined) discard(standing);
    const entry: Entry = {
      rootId: place.rootId,
      path: place.path,
      generation: ++generation,
      ready: Deferred.makeUnsafe<void, Refusal>(),
      following: null,
      consumer: null,
      closer: null,
      supersede: null,
      dead: false,
    };
    entries.set(place.rootId, entry);
    yield* open(entry).pipe(
      Effect.tapError((refusal) =>
        Effect.andThen(
          Effect.sync(() => discard(entry)),
          Deferred.fail(entry.ready, refusal),
        ),
      ),
    );
    return entry;
  });

  const answer = Effect.fnUntraced(function* (place: ProjectRoot, ask: FindAsk, retry: boolean): Effect.fn.Return<Found, Refusal> {
    const entry = yield* entryOf(place);
    yield* Deferred.await(entry.ready);
    touch(entry);
    entry.supersede?.();
    const superseded = Deferred.makeUnsafe<void>();
    const mine = (): void => void Deferred.doneUnsafe(superseded, Effect.void);
    entry.supersede = mine;
    const reply = yield* Effect.raceFirst(
      Effect.mapError(
        worker.ask({
          kind: 'find',
          root: entry.rootId,
          generation: entry.generation,
          query: ask.query,
          limit: ask.limit,
          recent: ask.recent,
        }),
        unavailable,
      ),
      Effect.andThen(
        Deferred.await(superseded),
        Effect.fail(
          new GateRefusal('superseded', 'a newer question about this checkout replaced this one', ['use the answer of the newer question']),
        ),
      ),
    ).pipe(Effect.ensuring(Effect.sync(() => void (entry.supersede === mine && (entry.supersede = null)))));
    if (reply.kind === 'found') return { files: reply.files, matched: reply.matched } satisfies Found;
    discard(entry);
    return retry ? yield* answer(place, ask, false) : yield* lostIndex();
  });

  return PathIndex.of({
    find: (place, ask) => answer(place, ask, true),
  });
});
