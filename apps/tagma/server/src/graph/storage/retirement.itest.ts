import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { basename, dirname, join } from 'node:path';
import { existsSync, watch } from 'node:fs';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, FileSystem, Layer, Queue } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import { chain } from '../../platform/store/chain.js';
import { graphPool } from '../testing/doubles.js';
import { ServedGraphs } from '../contract/service/serving.js';
import { MIRROR_IDENTITY, type MirrorIdentity } from '../contract/wire/storage.js';
import { ShadowGit } from '../tree/shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';
import { mirrorPath, resolveStorageLayout, storageHomes, MIRROR_FILES } from './layout.js';
import { mirrorsLayer, retireMirrors } from './retirement.js';
import { Mirrors } from '../contract/service/mirrors.js';
import { GraphMigrations } from '../contract/service/source.js';
import { Capacity } from '../../platform/contract/service/capacity.js';
import { Maintenance } from '../../platform/contract/service/maintenance.js';
import { syncTopology } from '../tree/topology.js';
import { shippedSteps } from '../steps/sequence.js';
import { overTree } from '../serving/permits.js';

layer(demoGraphLayer({ repos: ['repository', 'removed'], source: 'repository' }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('mirror retirement', (it) => {
  it.effect('keeps recoverable copies and unregistered identities, and removes only trees and branches gone for good', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { id, root: source } = demo.project('repository');
        const root = yield* files.realPath(source);
        const git = demo.graph.git;
        const run = (...args: string[]) => runGit(git, 'mirror-fixture', ['-C', root, ...args]);
        const { appHome } = storageHomes(demo.graph.store.path);
        const gitDir = join(root, '.git');
        const baseline = chain(fixtureGraphMigrations)[0]!.name;
        const saved = Effect.fnUntraced(function* (identity: MirrorIdentity | null, tree: string) {
          const path = mirrorPath(appHome, id, tree);
          yield* files.makeDirectory(dirname(path), { recursive: true });
          yield* Effect.sync(() => {
            const db = new Database(path);
            try {
              db.exec('create table meta (key text primary key, value text not null); create table __drizzle_migrations (name text)');
              db.query('insert into __drizzle_migrations values (?)').run(baseline);
              if (identity !== null) db.query('insert into meta values (?, ?)').run(MIRROR_IDENTITY, JSON.stringify(identity));
            } finally {
              db.close();
            }
          });
          for (const ending of MIRROR_FILES.slice(1)) {
            if (ending === '-wal' || ending === '-shm') continue;
            if (ending === '.snapshots') yield* files.makeDirectory(`${path}${ending}`);
            else yield* files.writeFileString(`${path}${ending}`, 'kept companion');
          }
          return path;
        });
        const team = Effect.fnUntraced(function* (branch: string) {
          const checkout = join(dirname(root), branch);
          yield* run('worktree', 'add', '-b', branch, checkout);
          const treeRoot = join(checkout, '.tagma');
          const path = yield* saved({ projectId: id, checkout, treeRoot, mode: 'team', branch, gitDir }, treeRoot);
          return { checkout, path };
        });
        const gone = yield* team('gone');
        yield* run('worktree', 'remove', '--force', gone.checkout);
        yield* run('branch', '-D', 'gone');
        const archived = yield* team('archived');
        yield* runGit(git, 'mirror-detach', ['-C', archived.checkout, 'switch', '--detach']);
        yield* run('branch', '-D', 'archived');
        yield* files.remove(archived.checkout, { recursive: true });
        const kept = yield* team('kept');
        yield* run('worktree', 'remove', '--force', kept.checkout);
        const later = yield* team('later');
        const unknown = yield* saved(null, join(appHome, 'unknown-tree'));
        const old = demo.project('removed');
        const oldTree = join(old.root, '.tagma');
        const oldMirror = yield* saved(
          { projectId: old.id, treeRoot: oldTree, checkout: old.root, mode: 'team', branch: null, gitDir: null },
          oldTree,
        );
        yield* demo.graph.projectLifecycle.remove({ ref: 'removed' });
        yield* files.remove(old.root, { recursive: true });
        const stealth = yield* resolveStorageLayout({ mode: 'stealth', projectId: id, appHome, worktree: root });
        if (stealth.mode !== 'stealth') return yield* Effect.die('expected stealth layout');
        const shadow = yield* ShadowGit.open(stealth.gitDir, git, NO_SIDE);
        const stealthGone = join(dirname(stealth.treeRoot), 'retired');
        const stealthKept = join(dirname(stealth.treeRoot), 'stranded');
        yield* shadow.branch('retired', 'main');
        yield* shadow.branch('stranded', 'main');
        yield* shadow.attach(stealthGone, 'retired');
        yield* shadow.attach(stealthKept, 'stranded');
        const stealthMirror = yield* saved(
          { projectId: id, checkout: root, treeRoot: stealthGone, mode: 'stealth', branch: 'retired', gitDir: stealth.gitDir },
          stealthGone,
        );
        const strandedMirror = yield* saved(
          { projectId: id, checkout: root, treeRoot: stealthKept, mode: 'stealth', branch: 'stranded', gitDir: stealth.gitDir },
          stealthKept,
        );
        const unprovenTree = join(dirname(stealth.treeRoot), 'unproven');
        const unprovenMirror = yield* saved(
          { projectId: id, checkout: root, treeRoot: unprovenTree, mode: 'stealth', branch: null, gitDir: stealth.gitDir },
          unprovenTree,
        );
        yield* shadow.retire(stealthGone);
        yield* shadow.retire(stealthKept);
        yield* shadow.run('fixture-prune', ['--git-dir', stealth.gitDir, 'branch', '-D', 'retired']);
        const pool = yield* Effect.acquireRelease(
          graphPool({ machine: demo.context, sourcePath: root, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
          (pool) => pool.dispose(),
        );
        const sweep = () => retireMirrors({ baseline }).pipe(Effect.provide(demo.context), Effect.provideService(ServedGraphs, pool));
        expect((yield* sweep()).sort()).toEqual([gone.path, stealthMirror].sort());
        for (const path of [gone.path, stealthMirror])
          for (const ending of MIRROR_FILES) expect(yield* files.exists(`${path}${ending}`)).toBe(false);
        for (const path of [archived.path, kept.path, later.path, unknown, oldMirror, strandedMirror, unprovenMirror])
          expect(yield* files.exists(path)).toBe(true);
        expect(yield* sweep()).toEqual([]);
        yield* run('worktree', 'remove', '--force', later.checkout);
        yield* run('branch', '-D', 'later');
        expect(yield* sweep()).toEqual([later.path]);

        const checkout = join(dirname(root), 'late-retirement');
        yield* run('worktree', 'add', '-b', 'late-retirement', checkout);
        const lateTree = join(dirname(stealth.treeRoot), 'late-retirement');
        yield* shadow.branch('late-retirement', 'main');
        yield* shadow.attach(lateTree, 'late-retirement');
        yield* shadow.recordCheckout(lateTree, root, checkout);
        yield* shadow.attach(stealth.treeRoot, 'main');
        yield* shadow.recordCheckout(stealth.treeRoot, root, root);
        const lateMirror = yield* saved(
          { projectId: id, checkout, treeRoot: lateTree, mode: 'stealth', branch: 'late-retirement', gitDir: stealth.gitDir },
          lateTree,
        );
        yield* run('worktree', 'remove', '--force', checkout);
        yield* run('branch', '-D', 'late-retirement');
        const passes = yield* Queue.unbounded<void>();
        const capacity = Context.get(demo.context, Capacity);
        const observedCapacity = Capacity.of({
          ...capacity,
          ticket: (phase, work) => capacity.ticket(phase, work).pipe(Effect.tap(() => Queue.offer(passes, undefined))),
        });
        const mirrors = Context.get(yield* Layer.build(mirrorsLayer), Mirrors);
        yield* Effect.forkScoped(
          mirrors.serve.pipe(
            Effect.provide(
              demo.context.pipe(
                Context.add(ServedGraphs, pool),
                Context.add(GraphMigrations, fixtureGraphMigrations),
                Context.add(Capacity, observedCapacity),
                Context.add(Maintenance, { opened: Effect.void, isOpen: Effect.succeed(true) }),
              ),
            ),
          ),
        );
        yield* Queue.take(passes);
        yield* mirrors.departed(id);
        yield* Queue.take(passes);
        expect(yield* files.exists(lateMirror)).toBe(true);
        const goneLater = yield* Deferred.make<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            watch(dirname(lateMirror), (_event, name) => {
              if (name === basename(lateMirror) && !existsSync(lateMirror)) Deferred.doneUnsafe(goneLater, Effect.void);
            }),
          ),
          (watcher) => Effect.sync(() => watcher.close()),
        );
        yield* syncTopology(shadow, root, stealth.treeRoot, shippedSteps, {
          treeHold: (tree) => overTree(pool.gate, tree),
          retired: mirrors.departed(id),
        });
        yield* Deferred.await(goneLater);
        expect(yield* files.exists(lateMirror)).toBe(false);
      }),
    ),
  );
});
