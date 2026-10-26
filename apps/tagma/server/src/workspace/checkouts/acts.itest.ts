import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Path, type Scope } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { project } from '../../projects/store/table.js';
import { projectRoot } from '../store/tables.js';
import type { RootId } from '../contract/wire/ids.js';
import { makeFileRootStore } from '../store/rootRegistry.js';
import { makeRootRegistry } from '../roots/registry.js';
import { FileRoots, RootReservations } from '../contract/service/roots.js';
import { gitCheckoutRows } from '../testing/doubles.js';
import { makeGitCheckoutWrites } from './gitWrites.js';
import {
  CheckoutHoldings,
  CheckoutRows,
  GraphDirectory,
  type CheckoutWriteRefused,
  type CheckoutAt,
} from '../contract/service/checkouts.js';
import { keepName } from '../repositories/pushName.js';
import { indexPath, indexWrites } from '../../platform/git/index.js';
import { settleIndex } from '../../platform/git/settle.js';
import { placesOf } from '../../platform/git/places.js';
import { join } from 'node:path';
import { kind, shared } from '@runlith/testbed/worlds';

const provenance = { kind: 'adoption', id: 'operator' };
const namespaceId = NamespaceId.make('test-acts');
const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const reservations = Layer.succeed(RootReservations, { holding: () => Effect.succeed(new Map()) });
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)), reservations);

const run = (git: Git['Service'], cwd: string, args: readonly string[]): Effect.Effect<string> =>
  Effect.orDie(
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(`git ${args.join(' ')} in ${cwd}: ${answer.stderr}`),
    ),
  );

const writesOver = (roots: FileRoots['Service'], checkouts: CheckoutRows['Service'], holdings: CheckoutHoldings['Service']) =>
  makeGitCheckoutWrites.pipe(
    Effect.provideService(FileRoots, roots),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(CheckoutHoldings, holdings),
    Effect.provideService(GraphDirectory, CHECKOUT_DIRECTORY),
  );

class ActsSeed extends Context.Service<ActsSeed, string>()('workspace/testing/ActsSeed') {}

const seeded = kind(ActsSeed, (_params: null, home: string) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const root = join(home, 'acts-seed');
    yield* files.makeDirectory(root, { recursive: true });
    yield* run(git, root, ['init', '-q', '-b', 'main']);
    yield* run(git, root, ['config', 'user.email', 'git@test']);
    yield* run(git, root, ['config', 'user.name', 'git']);
    yield* files.writeFileString(join(root, 'kept.txt'), 'one\n');
    yield* run(git, root, ['add', 'kept.txt']);
    yield* run(git, root, ['commit', '-q', '-m', 'born']);
    yield* files.writeFileString(join(root, 'kept.txt'), 'one\ntwo\n');
    yield* files.writeFileString(join(root, 'fresh.txt'), 'a\n');
    return root;
  }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, gitLayer.pipe(Layer.provide(host))))),
);

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = yield* Git;
  const { db } = yield* MachineStore;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'checkout-acts-' }));
  const root = paths.join(home, 'checkout');
  yield* files.copy(yield* shared(seeded, null), root, { overwrite: true });
  const roots = yield* makeRootRegistry({ store: yield* makeFileRootStore({ db }), namespaceId });
  const registered = yield* roots.register({ path: root, provenance });
  const checkouts = yield* gitCheckoutRows(git, roots, files, yield* Effect.scope);
  const store = yield* MachineStore;
  const covering = yield* store.db
    .insert(project)
    .values({
      name: `acts-${yield* Clock.currentTimeMillis}`,
      repoKey: root,
      rootPath: root,
      createdAt: new Date(yield* Clock.currentTimeMillis),
    })
    .returning()
    .get();
  const projectId = covering?.id ?? 0;
  yield* store.db.insert(projectRoot).values({ projectId, rootId: registered.rootId, origin: 'canonical' });
  return {
    files,
    paths,
    root,
    store,
    projectId,
    checkouts,
    roots,
    git,
    acts: yield* writesOver(roots, checkouts, unheld),
    told: yield* writesOver(roots, checkouts, typing),
    rootId: registered.rootId,
    witness: registered.witness,
  };
});

const unheld: CheckoutHoldings['Service'] = { holdersOf: () => Effect.succeed(new Map()) };

const holder = (threadId: string, writing: boolean) => ({
  holder: { kind: 'thread' as const, thread: threadId },
  agentName: null,
  retired: false,
  writing,
  tasks: [],
});

const typing: CheckoutHoldings['Service'] = {
  holdersOf: (_rootId, paths) =>
    Effect.succeed(
      new Map(paths.includes('kept.txt') ? [['kept.txt', [holder('thread-idle', false), holder('thread-typing', true)]] as const] : []),
    ),
};

const here = (rootId: RootId): CheckoutAt => ({ projectId: 1, rootId, judged: null });

const work = <A, E>(
  job: Effect.Effect<A, E, MachineStore | MachineUnits | Git | FileSystem.FileSystem | Path.Path | RootReservations | Scope.Scope>,
) => Effect.provide(job, layers);

it.live('staging moves the path between the row’s areas, and unstaging moves it back', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, rootId } = yield* fixture;
      const staged = yield* acts.stage(here(rootId), ['kept.txt']);
      expect(staged.paths).toEqual(['kept.txt']);
      expect(staged.writing).toEqual([]);
      const after = yield* checkouts.read(rootId);
      expect(after.entries.staged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
      expect(after.entries.unstaged.entries).toEqual([]);
      yield* acts.unstage(here(rootId), ['kept.txt']);
      const back = yield* checkouts.read(rootId);
      expect(back.entries.staged.entries).toEqual([]);
      expect(back.entries.unstaged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
    }),
  ),
);

it.live('staging waits for index settlement and preserves both the settled entry and the user’s new staging', () =>
  work(
    Effect.gen(function* () {
      const { acts, git, files, paths, root, rootId } = yield* fixture;
      const blob = yield* run(git, root, ['rev-parse', 'HEAD:kept.txt']);
      yield* run(git, root, ['update-index', '--force-remove', 'kept.txt']);
      const index = yield* indexPath(git, root);
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const paused: Git['Service'] = {
        run: (args, options) =>
          args.includes('--index-info')
            ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.andThen(Deferred.await(released), git.run(args, options)))
            : git.run(args, options),
      };
      const settling = yield* Effect.forkScoped(
        settleIndex(paused, root, yield* placesOf(git, root), 'refs/heads/main', [{ path: 'kept.txt', base: null, landed: blob }]),
      );
      yield* Deferred.await(entered);
      const staging = yield* Effect.forkScoped(acts.stage(here(rootId), ['fresh.txt']));
      while (staging.pollUnsafe() === undefined && !indexWrites.standing(index).some((row) => row.waiters > 0)) {
        yield* Effect.sleep(1);
      }
      yield* Deferred.succeed(released, undefined);
      expect(Object.fromEntries((yield* Fiber.join(settling)).paths)).toEqual({ 'kept.txt': 'synced' });
      expect((yield* Fiber.join(staging)).paths).toEqual(['fresh.txt']);
      expect(yield* run(git, root, ['show', ':kept.txt'])).toBe('one');
      expect(yield* run(git, root, ['show', ':fresh.txt'])).toBe('a');
      expect(yield* files.readFileString(paths.join(root, 'kept.txt'))).toBe('one\ntwo\n');
    }).pipe(Effect.timeout('5 seconds')),
  ),
);

it.live('cancelling index settlement releases its lock and temporary files before another stage runs', () =>
  work(
    Effect.gen(function* () {
      const { acts, git, files, paths, root, rootId } = yield* fixture;
      const blob = yield* run(git, root, ['rev-parse', 'HEAD:kept.txt']);
      yield* run(git, root, ['update-index', '--force-remove', 'kept.txt']);
      const index = yield* indexPath(git, root);
      const before = yield* files.readFile(index);
      const entered = yield* Deferred.make<void>();
      const paused: Git['Service'] = {
        run: (args, options) =>
          args.includes('--index-info') ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never) : git.run(args, options),
      };
      const settling = yield* Effect.forkScoped(
        settleIndex(paused, root, yield* placesOf(git, root), 'refs/heads/main', [{ path: 'kept.txt', base: null, landed: blob }]),
      );
      yield* Deferred.await(entered);
      expect(yield* files.exists(`${index}.lock`)).toBe(true);
      yield* Fiber.interrupt(settling);
      expect(yield* files.exists(`${index}.lock`)).toBe(false);
      expect(yield* files.readFile(index)).toEqual(before);
      expect((yield* files.readDirectory(paths.dirname(index))).filter((name) => name.startsWith('index.tagma-'))).toEqual([]);
      yield* acts.stage(here(rootId), ['fresh.txt']);
      expect(yield* run(git, root, ['show', ':fresh.txt'])).toBe('a');
    }).pipe(Effect.timeout('5 seconds')),
  ),
);

it.live('an external index lock refuses staging without deleting the lock or changing either side', () =>
  work(
    Effect.gen(function* () {
      const { acts, git, files, root, rootId } = yield* fixture;
      const index = yield* indexPath(git, root);
      const before = yield* files.readFile(index);
      yield* files.writeFileString(`${index}.lock`, 'external writer');
      const failure = yield* Effect.flip(acts.stage(here(rootId), ['fresh.txt']));
      expect(failure).toMatchObject({ _tag: 'CheckoutWriteRefused', reason: 'git-refused' });
      expect(yield* files.readFileString(`${index}.lock`)).toBe('external writer');
      expect(yield* files.readFile(index)).toEqual(before);
      expect(yield* files.readFileString(`${root}/fresh.txt`)).toBe('a\n');
    }),
  ),
);

it.live('a linked worktree stages independently, and cancelling a queued stage preserves the held index', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, git, files, paths, root, roots, rootId } = yield* fixture;
      const linked = paths.join(paths.dirname(root), 'linked');
      yield* run(git, root, ['worktree', 'add', '-q', '-b', 'linked', linked]);
      yield* files.writeFileString(paths.join(linked, 'linked.txt'), 'linked\n');
      const other = yield* roots.register({ path: linked, provenance });
      const index = yield* indexPath(git, root);
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const owner = yield* Effect.forkScoped(
        indexWrites.hold(
          index,
          Effect.acquireUseRelease(
            files.writeFileString(`${index}.lock`, 'held by the other operation'),
            () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(released)),
            () => files.remove(`${index}.lock`),
          ),
        ),
      );
      yield* Deferred.await(entered);
      const queued = yield* Effect.forkScoped(acts.stage(here(rootId), ['fresh.txt']));
      while (queued.pollUnsafe() === undefined && !indexWrites.standing(index).some((row) => row.waiters > 0)) {
        yield* Effect.sleep(1);
      }
      yield* acts.stage(here(other.rootId), ['linked.txt']);
      expect(yield* run(git, linked, ['show', ':linked.txt'])).toBe('linked');
      yield* Fiber.interrupt(queued);
      expect(yield* files.readFileString(`${index}.lock`)).toBe('held by the other operation');
      yield* Deferred.succeed(released, undefined);
      yield* Fiber.join(owner);
      expect((yield* checkouts.read(rootId)).entries.untracked.entries.map((entry) => entry.path)).toEqual(['fresh.txt']);
      yield* acts.stage(here(rootId), ['fresh.txt']);
      expect(yield* run(git, root, ['show', ':fresh.txt'])).toBe('a');
    }).pipe(Effect.timeout('5 seconds')),
  ),
);

it.live('a discard restores the tracked path and deletes the untracked one, by the row’s own areas', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, files, paths, root, rootId } = yield* fixture;
      const discarded = yield* acts.discard(here(rootId), ['kept.txt', 'fresh.txt']);
      expect(discarded.restored).toEqual(['kept.txt']);
      expect(discarded.deleted).toEqual(['fresh.txt']);
      expect(yield* files.readFileString(paths.join(root, 'kept.txt'))).toBe('one\n');
      expect(yield* files.exists(paths.join(root, 'fresh.txt'))).toBe(false);
      const after = yield* checkouts.read(rootId);
      expect(after.entries.unstaged.entries).toEqual([]);
      expect(after.entries.untracked.entries).toEqual([]);
    }),
  ),
);

it.live('a path under the graph’s own tree refuses before git runs, however it is spelled', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, paths, root, rootId } = yield* fixture;
      const before = yield* checkouts.read(rootId);
      const block = '.tagma/blocks/one.md';
      for (const spelling of [block, `./${block}`, `src/../${block}`, paths.join(root, block)]) {
        const refused = yield* Effect.flip(acts.stage(here(rootId), [spelling]));
        expect({ spelling, tag: refused._tag }).toEqual({ spelling, tag: 'CheckoutWriteRefused' });
        expect({ spelling, ...refused }).toMatchObject({ spelling, reason: 'graph-path' });
      }
      const after = yield* checkouts.read(rootId);
      expect(after.revision).toBe(before.revision);
    }),
  ),
);

it.live('a branch named with no remote refuses instead of pushing somewhere nobody named', () =>
  work(
    Effect.gen(function* () {
      const { acts, rootId } = yield* fixture;
      const refused = yield* Effect.flip(acts.push(here(rootId), { branch: 'main' }));
      expect(refused._tag).toBe('CheckoutWriteRefused');
      expect(refused).toMatchObject({ reason: 'no-remote' });
      expect((refused as CheckoutWriteRefused).message).toContain('main');
    }),
  ),
);

it.live(
  "a bare push of a branch a rename kept on its old remote name goes there; one merely tracking another name is git's to refuse",
  () =>
    work(
      Effect.gen(function* () {
        const { acts, files, paths, root, rootId } = yield* fixture;
        const git = yield* Git;
        const bare = paths.join(paths.dirname(root), 'remote.git');
        yield* run(git, paths.dirname(root), ['init', '-q', '--bare', bare]);
        yield* run(git, root, ['remote', 'add', 'origin', bare]);
        yield* run(git, root, ['config', 'push.default', 'simple']);
        yield* run(git, root, ['push', '-q', '-u', 'origin', 'main']);
        const born = yield* run(git, root, ['rev-parse', 'HEAD']);
        yield* run(git, root, ['switch', '-q', '-c', 'fix', '--track', 'origin/main']);
        yield* files.writeFileString(paths.join(root, 'kept.txt'), 'three\n');
        yield* run(git, root, ['commit', '-q', '-am', 'a fix']);
        const refused = yield* Effect.flip(acts.push(here(rootId), {}));
        expect(refused).toMatchObject({ reason: 'git-refused' });
        expect(yield* run(git, bare, ['rev-parse', 'refs/heads/main'])).toBe(born);
        yield* keepName(git, root, 'fix', 'main');
        const tip = yield* run(git, root, ['rev-parse', 'HEAD']);
        yield* acts.push(here(rootId), {});
        expect(yield* run(git, bare, ['rev-parse', 'refs/heads/main'])).toBe(tip);
        expect((yield* git.run(['rev-parse', '--verify', '--quiet', 'refs/heads/fix'], { cwd: bare })).status).not.toBe(0);
      }),
    ),
);

it.live('an act names the holders of its paths that are writing them, and nobody else', () =>
  work(
    Effect.gen(function* () {
      const { told, rootId } = yield* fixture;
      const shared = yield* told.stage(here(rootId), ['kept.txt']);
      expect(shared.paths).toEqual(['kept.txt']);
      expect(shared.writing).toEqual(['thread-typing']);
      const quiet = yield* told.stage(here(rootId), ['fresh.txt']);
      expect(quiet.paths).toEqual(['fresh.txt']);
      expect(quiet.writing).toEqual([]);
    }),
  ),
);

it.live('an act naming no path refuses before git runs, and the tree is untouched', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, rootId } = yield* fixture;
      const before = yield* checkouts.read(rootId);
      for (const [verb, run] of [
        ['stage', acts.stage(here(rootId), [])],
        ['unstage', acts.unstage(here(rootId), [])],
        ['discard', acts.discard(here(rootId), [])],
      ] as const) {
        const refused = yield* Effect.flip(run);
        expect(refused._tag).toBe('CheckoutWriteRefused');
        expect(refused).toMatchObject({ reason: 'no-paths' });
        expect((refused as CheckoutWriteRefused).message).toContain(verb);
      }
      const after = yield* checkouts.read(rootId);
      expect(after.entries.staged.entries.map((entry) => entry.path)).toEqual(before.entries.staged.entries.map((entry) => entry.path));
      expect(after.entries.untracked.entries.map((entry) => entry.path)).toEqual(
        before.entries.untracked.entries.map((entry) => entry.path),
      );
    }),
  ),
);

it.live('an act approved for one place refuses when the registry now answers another', () =>
  work(
    Effect.gen(function* () {
      const { acts, checkouts, rootId, root } = yield* fixture;
      const before = yield* checkouts.read(rootId);
      const elsewhere = `${root}-moved`;
      const refused = yield* Effect.flip(acts.stage({ ...here(rootId), judged: elsewhere }, ['kept.txt']));
      expect(refused._tag).toBe('CheckoutWriteRefused');
      expect(refused).toMatchObject({ reason: 'root-moved' });
      expect((refused as CheckoutWriteRefused).message).toContain(elsewhere);
      const after = yield* checkouts.read(rootId);
      expect(after.entries.staged.entries.map((entry) => entry.path)).toEqual(before.entries.staged.entries.map((entry) => entry.path));
      const staged = yield* acts.stage({ ...here(rootId), judged: root }, ['kept.txt']);
      expect(staged.paths).toEqual(['kept.txt']);
    }),
  ),
);
