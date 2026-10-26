import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { layer } from '@runlith/effect-test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { cp } from 'node:fs/promises';
import { Context, Deferred, Effect, FileSystem, Layer, Path } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from '../roots/registry.js';
import { FileRoots, RootReservations } from '../contract/service/roots.js';
import { CheckoutWatch } from '../contract/service/watch.js';
import { makeGitCheckoutRows } from '../checkouts/rows.js';
import { gitCheckoutRows } from './doubles.js';

export const provenance = { kind: 'adoption', id: 'operator' };
export const namespaceId = NamespaceId.make('test-checkouts');
const unreserved = Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) });
const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
);
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)), unreserved, watchProcessLayer);

class Seed extends Context.Service<Seed, { readonly root: string; readonly head: string; readonly mergeBase: string }>()(
  'workspace/testing/Seed',
) {}

export const run = (git: Git['Service'], cwd: string, args: readonly string[]): Effect.Effect<string> =>
  Effect.orDie(
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(`git ${args.join(' ')} in ${cwd}: ${answer.stderr}`),
    ),
  );

type Pause = { readonly gate: Deferred.Deferred<void>; readonly arrived: Deferred.Deferred<void> };
type Crowd = Pause & { readonly count: number };

export const pause: Effect.Effect<Pause> = Effect.all({ gate: Deferred.make<void>(), arrived: Deferred.make<void>() });

const watched = (git: Git['Service']) => {
  const counts = { spawns: 0, readings: 0, running: 0, peak: 0 };
  const commands: (readonly string[])[] = [];
  let paused: Pause | null = null;
  let crowd: Crowd | null = null;
  let refuse = false;
  let broken = false;
  const faces: Git['Service'] = {
    run: Effect.fnUntraced(function* (args, options) {
      counts.spawns += 1;
      commands.push(args);
      if (!args.includes('--porcelain=v2')) return yield* git.run(args, options);
      counts.readings += 1;
      if (broken) return yield* Effect.die(new Error('the status reader broke'));
      if (refuse) return { status: 128, stdout: '', stderr: 'fatal: not a git repository', overflow: false, messageOverflow: false };
      counts.running += 1;
      counts.peak = Math.max(counts.peak, counts.running);
      return yield* Effect.gen(function* () {
        const answer = yield* git.run(args, options);
        if (crowd !== null) {
          if (counts.running >= crowd.count) yield* Deferred.succeed(crowd.arrived, undefined);
          yield* Deferred.await(crowd.gate);
        }
        const held = paused;
        if (held === null) return answer;
        paused = null;
        yield* Deferred.succeed(held.arrived, undefined);
        yield* Deferred.await(held.gate);
        return answer;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            counts.running -= 1;
          }),
        ),
      );
    }),
  };
  return {
    faces,
    counts,
    commands,
    hold: (held: Pause) => {
      paused = held;
    },
    holdEvery: (held: Pause, count: number) => {
      crowd = { ...held, count };
    },
    refuseListing: () => {
      refuse = true;
    },
    admitListing: () => {
      refuse = false;
    },
    breakListing: (state: boolean) => {
      broken = state;
    },
  };
};

const seedLayer = Layer.effect(
  Seed,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const git = yield* Git;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'checkout-status-seed-' }));
    const root = paths.join(home, 'checkout');
    yield* files.makeDirectory(root);
    yield* run(git, root, ['init', '-q', '-b', 'main']);
    yield* run(git, root, ['config', 'user.email', 'git@test']);
    yield* run(git, root, ['config', 'user.name', 'git']);
    yield* files.writeFileString(paths.join(root, 'kept.txt'), 'one\n');
    yield* files.writeFileString(paths.join(root, 'held.txt'), 'alpha\n');
    yield* run(git, root, ['add', 'kept.txt', 'held.txt']);
    yield* run(git, root, ['commit', '-q', '-m', 'born']);
    yield* run(git, root, ['branch', 'base']);
    yield* files.writeFileString(paths.join(root, 'kept.txt'), 'one\ntwo\n');
    yield* run(git, root, ['commit', '-q', '-am', 'grown']);
    yield* run(git, root, ['branch', '--set-upstream-to=base', 'main']);
    const head = yield* run(git, root, ['rev-parse', 'HEAD']);
    const mergeBase = yield* run(git, root, ['rev-parse', 'base']);
    yield* files.writeFileString(paths.join(root, 'held.txt'), 'alpha\nbeta\n');
    yield* run(git, root, ['add', 'held.txt']);
    yield* files.writeFileString(paths.join(root, 'kept.txt'), 'one\ntwo\nthree\n');
    yield* files.writeFileString(paths.join(root, 'fresh.txt'), 'a\nb\nc\n');
    yield* files.writeFileString(paths.join(root, 'alone.txt'), 'x\n');
    return { root, head, mergeBase };
  }),
).pipe(Layer.provideMerge(layers));

export const rowTests = layer(seedLayer, { excludeTestServices: true });

export const fixture = Effect.gen(function* () {
  const seeded = yield* Seed;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const door = watched(yield* Git);
  const { db } = yield* MachineStore;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'checkout-status-' }));
  const root = paths.join(home, 'checkout');
  yield* Effect.promise(() => cp(seeded.root, root, { recursive: true }));
  const roots = yield* makeRootRegistry({ store: yield* makeFileRootStore({ db }), namespaceId });
  const registered = yield* roots.register({ path: root, provenance });
  const status = yield* gitCheckoutRows(door.faces, roots, files, yield* Effect.scope);
  const rowsOver = (watches: CheckoutWatch['Service']) =>
    makeGitCheckoutRows.pipe(
      Effect.provideService(Git, door.faces),
      Effect.provideService(FileRoots, roots),
      Effect.provideService(CheckoutWatch, watches),
    );
  return {
    files,
    paths,
    home,
    root,
    head: seeded.head,
    mergeBase: seeded.mergeBase,
    door,
    roots,
    status,
    rowsOver,
    rootId: registered.rootId,
  };
});
