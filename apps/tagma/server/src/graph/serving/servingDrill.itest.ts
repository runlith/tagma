import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join } from 'node:path';
import { Context, Deferred, Effect, Exit, FileSystem, Layer, Scope, Tracer } from 'effect';
import { TestClock } from 'effect/testing';
import { eq } from 'drizzle-orm';
import { Git } from '@runlith/git/Git';
import { demoGraphLayer, refusalOf, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraph } from '../../composition/testing/fixtureGraph.js';
import { fixtureGraphMigrations, fixtureMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity, testSessionIdentityLayer } from '../../platform/testing/identity.js';
import { GraphStore, MachineStore } from '../../platform/contract/service/store.js';
import { GraphUnits, MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { runGit } from '../../platform/git/ownGit.js';
import { projectsLayer } from '../../projects/testing/doubles.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { machineStoreLayer, registryExportLayer } from '../../installation/testing/doubles.js';
import { signedBy } from '../../invocation/testing/call.js';
import { TreeGuard } from '../contract/service/acts.js';
import { Blocks } from '../contract/service/blocks.js';
import { ProjectLifecycle, type ServedGraph } from '../contract/service/serving.js';
import { GraphSource } from '../contract/service/source.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerText } from '../tree/marker.js';
import { shippedSteps } from '../steps/sequence.js';
import type { GraphServices } from '../contract/service/services.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { block } from '../store/tables.js';
import { graphCommit } from '../settings.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { readBlockTree, writeBlockTree } from '../tree/layout.js';
import { machineGraphOf, machineRetirementGate } from './machine.js';
import { CopyKeeping } from './copies.js';
import { graphPool } from '../testing/doubles.js';

const openingPool = Effect.gen(function* () {
  const context = yield* Effect.context<GraphServices | GraphStore | GraphUnits | MachineStore | MachineUnits>();
  const machine = machineGraphOf(Context.add(context, Catalogs, NO_CATALOGS));
  return yield* Effect.acquireRelease(
    graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: (yield* GraphSource).sourcePath }),
    (pool) => pool.dispose(),
  );
});

const openMachine = Effect.fnUntraced(function* (home: string, sourcePath: string) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  const context = yield* Layer.build(
    Layer.mergeAll(
      registryExportLayer().pipe(
        Layer.provide(unitsLayer(MachineUnits, MachineStore)),
        Layer.provideMerge(fixtureGraph({ sourcePath }).pipe(Layer.provideMerge(projectsLayer()))),
      ),
      unitsLayer(MachineUnits, MachineStore),
      unitsLayer(GraphUnits, GraphStore),
    ).pipe(
      Layer.provideMerge(machineStoreLayer(join(home, 'tagma.sqlite'), fixtureMigrations, yield* sharedPool)),
      Layer.provideMerge(testSessionIdentityLayer),
    ),
  ).pipe(Scope.provide(scope));
  return { context, close: Scope.close(scope, Exit.void) };
});

class RecoveryHome extends Context.Service<
  RecoveryHome,
  {
    readonly base: string;
    readonly home: string;
    readonly repo: string;
    readonly first: Effect.Success<ReturnType<typeof openMachine>>;
  }
>()('testing/MachineRecovery') {}
const recoveryHome = kind(RecoveryHome, (_params: null, base) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = join(base, 'home');
    const repo = join(base, 'repo');
    yield* fs.makeDirectory(home, { recursive: true });
    yield* fs.makeDirectory(repo);
    return { base, home, repo, first: yield* openMachine(home, base) };
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

const create = (served: ServedGraph, title: string, body = title) =>
  Context.get(served.context, Blocks)
    .create({ projectId: served.projectId, title, body })
    .pipe(signedBy({ harness: 'test', key: 'drill' }), Effect.provide(served.context));

const byUuid = (served: ServedGraph, uuid: string) =>
  Context.get(served.context, GraphStore).db.select().from(block).where(eq(block.uuid, uuid)).get();

layer(BunFileSystem.layer, { excludeTestServices: true })('machine loss', (it) => {
  it.effect('the registry restores project identity after machine database loss, while its graph and subsequent writes survive', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, home, repo, first } = yield* own(recoveryHome, null, 'the machine database is removed between two installations');
      const git = (...args: string[]) => runGit(Context.get(first.context, Git), 'drill', args, { cwd: repo });
      yield* git('init', '-b', 'main');
      yield* fs.writeFileString(join(repo, 'seed'), 'the project\n');
      yield* git('add', '-A');
      yield* git('-c', 'user.name=op', '-c', 'user.email=op@x', 'commit', '-m', 'born');
      const project = yield* Context.get(first.context, ProjectLifecycle)
        .create({ name: 'drill', rootPath: repo, strictProvenance: false })
        .pipe(Effect.provide(first.context));
      const old = yield* Context.get(first.context, Blocks)
        .create({ projectId: project.id, title: 'Survivor', body: 'outlives every database' })
        .pipe(signedBy({ harness: 'test', key: 'drill' }), Effect.provide(first.context));
      const pool = yield* openingPool.pipe(Effect.provide(first.context));
      const served = yield* pool.resolve({ projectId: project.id });
      expect(served.layout.treeRoot.startsWith(home)).toBe(true);
      expect(yield* fs.exists(join(project.rootPath, '.tagma'))).toBe(false);
      const retired = Context.add(first.context, TreeGuard, machineRetirementGate(Context.get(first.context, MachineStore)));
      const refused = yield* refusalOf(
        Context.get(retired, Blocks).update({ id: old.id, title: 'forked truth' }).pipe(Effect.provide(retired)),
      );
      expect(refused.code).toBe('project-retired');
      expect(refused.reason).toContain('"drill"');
      expect(refused.unblock.join(' ')).toContain('project=drill');
      expect(refused.unblock.join(' ')).toContain(project.rootPath);
      expect((yield* byUuid(served, old.uuid))?.title).toBe('Survivor');
      yield* pool.dispose();
      yield* first.close;
      for (const suffix of ['', '-wal', '-shm']) yield* fs.remove(join(home, `tagma.sqlite${suffix}`), { force: true });
      const again = yield* openMachine(home, base);
      expect((yield* Context.get(again.context, Projects).resolve('drill'))?.id).toBe(project.id);
      const reopenedPool = yield* openingPool.pipe(Effect.provide(again.context));
      const reopened = yield* reopenedPool.resolve({ projectId: project.id });
      expect(yield* byUuid(reopened, old.uuid)).toMatchObject({ uuid: old.uuid, title: 'Survivor', body: 'outlives every database' });
      const born = yield* create(reopened, 'Post Drill');
      yield* reopenedPool.release(reopened);
      expect((yield* readBlockTree(reopened.layout.treeRoot)).some((entry) => entry.frontmatter.id === born.uuid)).toBe(true);
      expect(
        yield* runGit(Context.get(again.context, Git), 'drill', ['grep', '-h', '-F', `id: ${born.uuid}`, 'HEAD'], {
          cwd: reopened.layout.treeRoot,
        }),
      ).toBe(`id: ${born.uuid}`);
      for (const entry of yield* fs.readDirectory(reopened.layout.treeRoot)) {
        if (entry !== '.git') yield* fs.remove(join(reopened.layout.treeRoot, entry), { recursive: true });
      }
      for (const suffix of ['', '-wal', '-shm']) yield* fs.remove(`${reopened.layout.mirrorPath}${suffix}`, { force: true });
      const missing = yield* refusalOf(reopenedPool.resolve({ projectId: project.id }));
      expect(missing.code).toBe('tree-empty');
      expect(missing.reason).toContain(`"${project.name}"`);
      expect(missing.unblock.join(' ')).toContain(`tagma project remove ${project.name}`);
    }),
  );
});

layer(demoGraphLayer({ repos: ['team'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'served graph recovery',
  (it) => {
    it.effect('stealth storage rebuilds a lost mirror from files in the live pool', () =>
      withDemo(({ graph, projectId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            yield* graph.projectPolicy.setStorage({ id: projectId, mode: 'stealth' });
            const synchronized: Tracer.NativeSpan[] = [];
            const tracer = Tracer.make({
              span(options) {
                const span = new Tracer.NativeSpan(options);
                if (span.name === 'MirrorBuilder.syncRegistry') synchronized.push(span);
                return span;
              },
            });
            const pool = yield* openingPool;
            const served = yield* pool.resolve({ projectId }).pipe(Effect.withTracer(tracer));
            synchronized.length = 0;
            yield* served.settled(true);
            expect(new Set(synchronized.map((span) => span.attributes.get('written')))).toEqual(new Set([0]));
            const note = yield* create(served, 'Stealth Note', 'readable');
            expect(served.layout.treeRoot.startsWith(storageHomes(graph.store.path).appHome)).toBe(true);
            expect((yield* served.shadow!.log(served.layout.treeRoot)).length).toBeGreaterThan(0);
            expect((yield* readBlockTree(served.layout.treeRoot)).find((entry) => entry.frontmatter.id === note.uuid)?.body).toBe(
              'readable',
            );
            yield* pool.release(served);
            for (const suffix of ['', '-wal', '-shm']) yield* fs.remove(`${served.layout.mirrorPath}${suffix}`, { force: true });
            const again = yield* pool.resolve({ projectId });
            expect(yield* byUuid(again, note.uuid)).toMatchObject({ uuid: note.uuid, body: 'readable' });
          }),
        ),
      ),
    );

    it.effect('team files stay uncommitted, rebuild a lost mirror in a cold pool, and are adopted intact by a cloned project', () =>
      withDemo(({ graph, project, fixture, as }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const team = project('team');
            const git = (cwd: string, ...args: string[]) =>
              runGit(graph.git, 'drill', ['-c', 'user.name=op', '-c', 'user.email=op@x', ...args], { cwd });
            yield* graph.projectPolicy.setStorage({ id: team.id, mode: 'team' });
            yield* as('op', graph.settings.write({ key: graphCommit.id, scope: 'project', projectId: team.id, value: 'manual' }));
            const pool = yield* openingPool;
            const served = yield* pool.resolve({ projectId: team.id });
            const note = yield* create(served, 'Team Note', 'ships with the repo');
            expect(served.layout.treeRoot).toBe(join(team.root, '.tagma'));
            expect(served.shadow).toBeNull();
            expect((yield* readBlockTree(served.layout.treeRoot)).find((entry) => entry.frontmatter.id === note.uuid)?.body).toBe(
              note.body,
            );
            expect(yield* git(team.root, 'status', '--porcelain', '--', '.tagma')).not.toBe('');
            yield* git(team.root, 'add', '-A');
            yield* git(team.root, 'commit', '-m', 'graph');
            yield* pool.dispose();
            for (const suffix of ['', '-wal', '-shm']) yield* fs.remove(`${served.layout.mirrorPath}${suffix}`, { force: true });
            const coldPool = yield* openingPool;
            const cold = yield* coldPool.resolve({ projectId: team.id });
            expect(yield* byUuid(cold, note.uuid)).toMatchObject({ uuid: note.uuid, body: note.body });
            const clone = yield* fixture.directory('cloned-root');
            yield* fs.copy(served.layout.treeRoot, join(clone, '.tagma'), { overwrite: true });
            yield* git(clone, 'init', '-b', 'main');
            yield* git(clone, 'add', '-A');
            yield* git(clone, 'commit', '-m', 'cloned');
            const cloned = yield* graph.projectLifecycle.create({ name: 'cloned', rootPath: clone, storage: 'team' });
            const adopted = yield* coldPool.resolve({ projectId: cloned.id });
            expect(yield* byUuid(adopted, note.uuid)).toMatchObject({ uuid: note.uuid, projectId: cloned.id, body: note.body });
            expect((yield* readBlockTree(adopted.layout.treeRoot)).find((entry) => entry.frontmatter.id === note.uuid)?.body).toBe(
              note.body,
            );
          }),
        ),
      ),
    );

    it.effect('a refused source stays intact and an explicit archived replacement can be read and written', () =>
      withDemo(({ graph, fixture, refusal }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const root = yield* fs.realPath(yield* fixture.directory('replaced-root'));
            const tree = join(root, '.tagma');
            const source = join(tree, 'replaced', 'index.md');
            yield* fs.makeDirectory(dirname(source), { recursive: true });
            yield* runGit(graph.git, 'drill', ['init', '-b', 'main'], { cwd: root });
            const retained =
              '---\nid: 0199aaaa-0000-7000-8000-000000000001\nkind: gadget\ntitle: Replaced\nord: 1\n---\nRetained knowledge.\n';
            yield* fs.writeFileString(source, retained);
            yield* runGit(graph.git, 'drill', ['add', '-A'], { cwd: root });
            yield* runGit(graph.git, 'drill', ['-c', 'user.name=op', '-c', 'user.email=op@x', 'commit', '-m', 'carried graph'], {
              cwd: root,
            });
            const row = yield* graph.projectLifecycle.create({ name: 'replaced', rootPath: root, storage: 'team' });
            const pool = yield* openingPool;
            const refused = yield* refusal(pool.resolve({ projectId: row.id }));
            expect(refused.code).toBe('graph-pool');
            expect(refused.reason).toContain(source);
            expect(refused.unblock.join(' ')).toContain(source);
            expect(yield* fs.readFileString(source)).toBe(retained);
            expect(pool.held().map((copy) => copy.treeRoot)).not.toContain(tree);
            const archive = join(tree, '.archive');
            yield* fs.makeDirectory(archive);
            yield* fs.rename(dirname(source), join(archive, 'replaced'));
            const identity = '0199aaaa-0000-7000-8000-000000000002';
            yield* writeBlockTree(tree, [
              { parentId: null, frontmatter: { id: identity, title: 'replaced', ord: 1 }, body: 'A fresh graph.' },
            ]);
            yield* fs.writeFileString(join(tree, FORMAT_FILE), markerText(shippedSteps.last));
            const served = yield* pool.resolve({ projectId: row.id });
            expect(yield* byUuid(served, identity)).toMatchObject({ uuid: identity, body: 'A fresh graph.' });
            const born = yield* create(served, 'Current knowledge', 'Written through the new graph.');
            expect(yield* byUuid(served, born.uuid)).toMatchObject({ uuid: born.uuid, body: born.body });
            expect((yield* readBlockTree(tree)).map((entry) => entry.frontmatter.id)).not.toContain('0199aaaa-0000-7000-8000-000000000001');
            expect(yield* fs.readFileString(join(archive, 'replaced', 'index.md'))).toBe(retained);
          }),
        ),
      ),
    );

    it.effect('a code merge imports branch knowledge and an externally removed worktree retires after its copy becomes idle', () =>
      withDemo(({ graph, project, as, refusal }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const team = project('team');
            const git = (cwd: string, ...args: string[]) => runGit(graph.git, 'drill', args, { cwd });
            yield* graph.projectPolicy.setStorage({ id: team.id, mode: 'team' });
            yield* as('op', graph.settings.write({ key: graphCommit.id, scope: 'project', projectId: team.id, value: 'manual' }));
            const time = yield* Layer.build(TestClock.layer());
            const pool = yield* openingPool.pipe(Effect.provide(time), Effect.provideService(CopyKeeping, { idle: 2, ms: 1_000 }));
            const served = yield* pool.resolve({ projectId: team.id });
            yield* git(team.root, 'add', '-A');
            yield* git(team.root, 'commit', '-m', 'graph as served');
            const branchName = yield* git(team.root, 'symbolic-ref', '--short', 'HEAD');
            const worktree = join(dirname(team.root), 'team-wt');
            yield* git(team.root, 'worktree', 'add', '-b', 'team-branch', worktree, branchName);
            const branch = yield* pool.resolve({ projectId: team.id, cwd: worktree });
            const note = yield* create(branch, 'Branch Note', 'on the branch');
            yield* git(worktree, 'add', '-A');
            yield* git(worktree, 'commit', '-m', 'branch graph');
            expect(yield* byUuid(served, note.uuid)).toBeUndefined();
            yield* git(team.root, 'merge', '--no-ff', '-m', 'merge team branch', 'team-branch');
            yield* served.settled(true);
            expect(yield* byUuid(served, note.uuid)).toMatchObject({ uuid: note.uuid, body: note.body });
            expect(pool.held().map((copy) => copy.treeRoot)).toContain(branch.layout.treeRoot);
            const closed = yield* Deferred.make<void>();
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                pool.copies.subscribe((event) => {
                  if (event.kind === 'closed' && event.treeRoot === branch.layout.treeRoot) Deferred.doneUnsafe(closed, Effect.void);
                }),
              ),
              (stop) => Effect.sync(stop),
            );
            yield* git(team.root, 'worktree', 'remove', '--force', worktree);
            yield* pool.resolve({ projectId: team.id });
            expect(pool.held().map((copy) => copy.treeRoot)).toContain(branch.layout.treeRoot);
            yield* TestClock.adjust('1 second').pipe(Effect.provide(time));
            yield* Deferred.await(closed);
            expect(pool.held().map((copy) => copy.treeRoot)).not.toContain(branch.layout.treeRoot);
            expect((yield* refusal(branch.fresh())).code).toBe('not-served');
          }),
        ),
      ),
    );

    it.effect('an unresolved code merge refuses a graph act and preserves the last committed mirror', () =>
      withDemo(({ graph, project, as, refusal }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const team = project('team');
            const git = (cwd: string, ...args: string[]) => runGit(graph.git, 'drill', args, { cwd });
            yield* graph.projectPolicy.setStorage({ id: team.id, mode: 'team' });
            yield* as('op', graph.settings.write({ key: graphCommit.id, scope: 'project', projectId: team.id, value: 'manual' }));
            const pool = yield* openingPool;
            const served = yield* pool.resolve({ projectId: team.id });
            const note = yield* create(served, 'Team Note', 'the original body');
            const file = (yield* byUuid(served, note.uuid))?.path;
            if (file == null) return yield* Effect.die('the team note has no projected path');
            yield* git(team.root, 'add', '-A');
            yield* git(team.root, 'commit', '-m', 'graph as served');
            const main = yield* git(team.root, 'symbolic-ref', '--short', 'HEAD');
            for (const side of ['left', 'right']) {
              const worktree = join(dirname(team.root), `team-${side}`);
              yield* git(team.root, 'worktree', 'add', '-b', `team-${side}`, worktree, main);
              const path = join(worktree, '.tagma', file);
              yield* fs.writeFileString(path, (yield* fs.readFileString(path)).replace('the original body', `${side} claims it`));
              yield* git(worktree, 'add', '-A');
              yield* git(worktree, 'commit', '-m', side);
            }
            yield* git(team.root, 'merge', '--no-ff', '-m', 'merge left', 'team-left');
            yield* served.settled(true);
            const conflicted = yield* graph.git.run(['merge', '--no-ff', '-m', 'merge right', 'team-right'], { cwd: team.root });
            expect(conflicted.status).toBe(1);
            const refused = yield* refusal(create(served, 'During the merge'));
            expect(['tree-mid-merge', 'graph-pool']).toContain(refused.code);
            expect(yield* fs.exists(join(team.root, '.git', 'MERGE_HEAD'))).toBe(true);
            expect(yield* byUuid(served, note.uuid)).toMatchObject({ uuid: note.uuid, body: 'left claims it' });
          }),
        ),
      ),
    );

    it.effect(
      'an empty leftover mirror cannot replace project birth, and a removed project reopens under its own id when its root returns',
      () =>
        withDemo(({ graph, fixture, refusal }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const root = yield* fixture.directory('left-behind-root');
              const registered = yield* graph.projectLifecycle.create({ name: 'left-behind', rootPath: root, catalogs: [] });
              const layout = yield* resolveStorageLayout({
                mode: 'stealth',
                projectName: registered.name,
                ...storageHomes(graph.store.path),
                worktree: registered.rootPath,
              });
              yield* fs.makeDirectory(dirname(layout.mirrorPath), { recursive: true });
              yield* fs.writeFileString(layout.mirrorPath, '');
              const pool = yield* openingPool;
              const served = yield* pool.resolve({ projectId: registered.id });
              expect((yield* Context.get(served.context, Blocks).rootBlockOf(registered.id)).tags).toEqual([]);
              expect((yield* graph.projectLifecycle.remove({ ref: 'left-behind' })).id).toBe(registered.id);
              expect(pool.held().map((copy) => copy.treeRoot)).not.toContain(served.layout.treeRoot);
              expect((yield* refusal(served.fresh())).code).toBe('not-served');
              const again = yield* graph.projectLifecycle.create({ name: 'left-behind', rootPath: root, catalogs: [] });
              expect(again).toMatchObject({ id: registered.id, returned: true });
              const reopened = yield* pool.resolve({ projectId: registered.id });
              expect((yield* Context.get(reopened.context, Blocks).rootBlockOf(registered.id)).projectId).toBe(registered.id);
            }),
          ),
        ),
    );
  },
);
