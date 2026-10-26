import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Cause, Deferred, Effect, Exit, FileSystem, Layer, Path, Queue, type Scope, Stream } from 'effect';
import { watchingHead } from './tree.js';
import type { WatchEvent } from '../../platform/watch/tree.js';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { watchProcessAt, watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { watchTickets } from '../../platform/watch/tickets.js';
import { FileWatcher, WatchTickets } from '../../platform/contract/service/watch.js';
import { FileRoots, RootReservations } from '../contract/service/roots.js';
import type { CheckoutShift } from '../contract/service/watch.js';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from '../roots/registry.js';
import { type CheckoutWatchOptions, makeCheckoutWatches } from './shared.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const reservations = Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) });
const layers = Layer.mergeAll(
  storage,
  BunFileSystem.layer,
  Path.layer,
  gitLayer.pipe(Layer.provide(host)),
  reservations,
  watchProcessLayer,
);

const fixture = Effect.fnUntraced(function* (options: CheckoutWatchOptions = {}, dieOnce = false) {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const real = yield* Git;
  let dying = dieOnce;
  const git: Git['Service'] = {
    run: (args, runOptions) => {
      if (!dying) return real.run(args, runOptions);
      dying = false;
      return Effect.die(new Error('git broke while the watcher opened'));
    },
    objects: real.objects,
  };
  const { db } = yield* MachineStore;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'checkout-watch-' }));
  const root = paths.join(home, 'checkout');
  yield* files.makeDirectory(root, { recursive: true });
  yield* Effect.orDie(real.run(['init', '-q', '-b', 'main'], { cwd: root }));
  const roots = yield* makeRootRegistry({ store: yield* makeFileRootStore({ db }), namespaceId: NamespaceId.make('test-watch') });
  const registered = yield* roots.register({ path: root, provenance: { kind: 'adoption', id: 'operator' } });
  const watches = yield* makeCheckoutWatches(options).pipe(Effect.provideService(Git, git), Effect.provideService(FileRoots, roots));
  return { files, paths, root, roots, watches, rootId: registered.rootId };
});

const work = <A, E>(
  job: Effect.Effect<A, E, MachineStore | MachineUnits | Git | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(job, layers);

const naming = (path: string) => (shift: CheckoutShift) => shift.paths.has(path);

it.live('every follower of a checkout shares one watcher and each is told the paths that moved', () =>
  work(
    Effect.gen(function* () {
      const tickets = watchTickets(8);
      const { files, paths, root, watches, rootId } = yield* fixture();
      yield* Effect.gen(function* () {
        const first = yield* watches.follow(rootId);
        const held = tickets.standing().active;
        const second = yield* watches.follow(rootId);
        expect(held).toBeGreaterThan(0);
        expect(tickets.standing().active).toBe(held);
        yield* files.writeFileString(paths.join(root, 'seen.txt'), 'x\n');
        for (const following of [first, second]) {
          const told = yield* Stream.runHead(Stream.filter(following.shifts, naming('seen.txt')));
          expect(told._tag === 'Some' && told.value.movements.includes('tree')).toBe(true);
        }
        first.release();
        second.release();
      }).pipe(Effect.provideService(WatchTickets, tickets));
    }),
  ),
);

it.live('a follower that has not read since a burst gets the folded paths, and past the limit one overflow rescan without names', () =>
  work(
    Effect.gen(function* () {
      const { files, paths, root, watches, rootId } = yield* fixture({ limit: 3 });
      const probe = yield* watches.follow(rootId);
      const slow = yield* watches.follow(rootId);
      const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];
      for (const name of names) yield* files.writeFileString(paths.join(root, name), 'x\n');
      yield* Stream.runDrain(Stream.takeUntil(probe.shifts, (shift) => shift.rescan === 'overflow' || shift.paths.has('e.txt')));
      const folded = yield* Stream.runHead(slow.shifts);
      expect(folded._tag === 'Some' && folded.value.rescan).toBe('overflow');
      expect(folded._tag === 'Some' && folded.value.paths.size).toBe(0);
    }),
  ),
);

it.live('a watcher the machine could not grant is retried by its owner and its followers hear that it came back', () =>
  work(
    Effect.gen(function* () {
      let refused = 1;
      const tickets = WatchTickets.of({
        grant: () => Effect.succeed(refused-- > 0 ? null : () => undefined),
        standing: () => ({ budget: 1, active: 0 }),
      });
      const { files, paths, root, watches, rootId } = yield* fixture({ reopenMs: 10 });
      yield* Effect.gen(function* () {
        const following = yield* watches.follow(rootId);
        expect(following.watching()).toBe(false);
        const lost = yield* Stream.runHead(following.shifts);
        expect(lost._tag === 'Some' && lost.value.rescan).not.toBeNull();
        yield* Stream.runDrain(Stream.takeUntil(following.shifts, () => following.watching())).pipe(
          Effect.when(Effect.sync(() => !following.watching())),
        );
        expect(following.watching()).toBe(true);
        yield* files.writeFileString(paths.join(root, 'again.txt'), 'x\n');
        const told = yield* Stream.runHead(Stream.filter(following.shifts, naming('again.txt')));
        expect(told._tag).toBe('Some');
      }).pipe(Effect.provideService(WatchTickets, tickets));
    }),
  ),
);

it.live('a killed watch process tells the follower to rescan, its watch reopens by itself, and the next write is named', () =>
  work(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const socket = yield* files.makeTempDirectoryScoped({ prefix: 'checkout-watch-process-' });
      const watcher = yield* watchProcessAt(socket);
      yield* Effect.gen(function* () {
        const { paths, root, watches, rootId } = yield* fixture({ reopenMs: 10 });
        const following = yield* watches.follow(rootId);
        expect(following.watching()).toBe(true);
        yield* Effect.promise(async () => {
          if (Bun.spawnSync(['pkill', '-KILL', '-f', socket]).exitCode !== 0) throw new Error('no watch process to kill');
        });
        const lost = yield* Stream.runHead(Stream.filter(following.shifts, (shift) => shift.rescan !== null));
        expect(lost._tag === 'Some' && lost.value.rescan).toBe('error');
        yield* Stream.runDrain(Stream.takeUntil(following.shifts, () => following.watching())).pipe(
          Effect.when(Effect.sync(() => !following.watching())),
        );
        yield* files.writeFileString(paths.join(root, 'after.txt'), 'x\n');
        const told = yield* Stream.runHead(Stream.filter(following.shifts, naming('after.txt')));
        expect(told._tag).toBe('Some');
        following.release();
      }).pipe(Effect.provideService(FileWatcher, watcher));
    }),
  ),
);

it.live('a watcher that dies while opening leaves no record behind, and the next follow opens afresh', () =>
  work(
    Effect.gen(function* () {
      const { watches, rootId } = yield* fixture({}, true);
      const first = yield* Effect.exit(watches.follow(rootId));
      expect(Exit.isFailure(first) && Cause.hasDies(first.cause)).toBe(true);
      const second = yield* watches.follow(rootId);
      expect(second.watching()).toBe(true);
      second.release();
    }),
  ),
);

it.live('the HEAD observer filters named index replacements and ref locks while reporting HEAD, packed and loose refs', () =>
  work(
    Effect.gen(function* () {
      const { files, paths, root } = yield* fixture();
      const git = yield* Git;
      const heard: WatchEvent[] = [];
      const events = yield* Queue.unbounded<WatchEvent>();
      const following = yield* Effect.acquireRelease(
        watchingHead(git, root, (event) => {
          heard.push(event);
          Queue.offerUnsafe(events, event);
        }),
        (watching) => Effect.sync(() => watching.close()),
      );
      heard.length = 0;
      const arrived = (name: string) =>
        Stream.runDrain(Stream.takeUntil(Stream.fromQueue(events), (event) => event.paths?.includes(name) === true));
      yield* files.writeFileString(paths.join(root, '.git', 'index.next'), 'unrelated\n');
      yield* files.rename(paths.join(root, '.git', 'index.next'), paths.join(root, '.git', 'index'));
      for (const name of ['HEAD', 'packed-refs']) {
        yield* files.writeFileString(paths.join(root, '.git', `${name}.next`), 'changed\n');
        yield* files.rename(paths.join(root, '.git', `${name}.next`), paths.join(root, '.git', name));
        yield* arrived(name);
        expect(heard.some((event) => event.paths?.includes(name))).toBe(true);
      }
      const lock = paths.join(root, '.git', 'refs', 'heads', 'main.lock');
      yield* files.writeFileString(lock, 'changed\n');
      yield* files.rename(lock, paths.join(root, '.git', 'refs', 'heads', 'main'));
      yield* arrived('main');
      expect(
        heard
          .filter((event) => event.paths !== undefined)
          .every((event) => event.paths?.every((path) => path === 'HEAD' || path === 'packed-refs' || path === 'main')),
      ).toBe(true);
      expect(following.watching()).toBe(true);
    }),
  ),
);

it.live('a root relocated during watcher recovery is followed at its current location', () =>
  work(
    Effect.gen(function* () {
      const { files, paths, root, roots, rootId } = yield* fixture();
      const git = yield* Git;
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      let canGrant = false;
      let grants = 0;
      const tickets = WatchTickets.of({
        grant: Effect.fn('WatchTickets.grant')(function* () {
          if (!canGrant) return null;
          grants += 1;
          if (grants === 1) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(resume);
          }
          return () => undefined;
        }),
        standing: () => ({ budget: 8, active: 0 }),
      });
      yield* Effect.gen(function* () {
        const watches = yield* Effect.provideService(makeCheckoutWatches({ reopenMs: 1 }), FileRoots, roots);
        const first = yield* watches.follow(rootId);
        canGrant = true;
        yield* Deferred.await(entered);
        const relocated = paths.join(paths.dirname(root), 'relocated');
        yield* files.rename(root, relocated);
        yield* files.makeDirectory(root);
        yield* Effect.orDie(git.run(['init', '-q', '-b', 'main'], { cwd: root }));
        yield* roots.register({ path: relocated, provenance: { kind: 'adoption', id: 'operator' } });
        const second = yield* watches.follow(rootId);
        yield* Deferred.succeed(resume, undefined);
        for (const following of [first, second]) {
          yield* Stream.runDrain(Stream.takeUntil(following.shifts, () => following.watching()));
        }
        yield* files.writeFileString(paths.join(relocated, 'moved.txt'), 'now here\n');
        const heard = yield* Stream.runHead(Stream.filter(first.shifts, naming('moved.txt')));
        expect(heard._tag).toBe('Some');
        first.release();
        second.release();
      }).pipe(Effect.provideService(WatchTickets, tickets));
    }),
  ),
);
