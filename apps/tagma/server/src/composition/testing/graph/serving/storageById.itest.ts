import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { Git } from '@runlith/git/Git';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { MIRROR_IDENTITY, TREE_ORIGINS, TREE_SERVED } from '../../../../graph/contract/wire/storage.js';
import { machineGraphOf } from '../../../../graph/serving/machine.js';
import { shippedSteps } from '../../../../graph/steps/sequence.js';
import { block, event } from '../../../../graph/store/tables.js';
import { graphsHome, MIRROR_FILES, mirrorFile, mirrorsHome, storageHomes } from '../../../../graph/storage/layout.js';
import { graphPool } from '../../../../graph/testing/doubles.js';
import { GraphStore, MachineStore } from '../../../../platform/contract/service/store.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { testSessionIdentity } from '../../../../platform/testing/identity.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { servingLayer, withServing } from './fixture.js';

const keyOf = (path: string) => Bun.hash(path).toString(16);

type Identity = { readonly treeRoot: string; readonly gitDir: string | null };

const identityIn = (db: Database): Identity =>
  JSON.parse(db.query<{ value: string }, [string]>('select value from meta where key = ?').get(MIRROR_IDENTITY)!.value) as Identity;

const identityAt = (path: string): Identity => {
  const db = new Database(path, { readonly: true });
  try {
    return identityIn(db);
  } finally {
    db.close();
  }
};

layer(servingLayer, { excludeTestServices: true })('graph storage keyed by project id', (it) => {
  it.effect(
    'the boot step carries a graph stored under its project name to its id, finishing moves an earlier boot cut short, and never takes it for the storage of a project named by that id',
    () =>
      withServing(({ demo, pool, served, projectId, repo }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const git = demo.graph.git;
          const { name } = yield* demo.graph.projects.byId(projectId);
          const { appHome } = storageHomes(demo.graph.store.path);
          const featureCheckout = join(dirname(repo), 'storage-feature');
          yield* runGit(git, 'feature', ['-C', repo, 'worktree', 'add', '-b', 'storage-feature', featureCheckout, 'main']);
          const root = yield* Effect.provide(
            Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(projectId)),
            served.context,
          );
          const kept = yield* demo
            .as(
              'op',
              Context.get(served.context, Blocks).create({
                projectId,
                parentId: root.id,
                tags: ['idea'],
                title: 'Kept across the move',
                body: 'kept',
              }),
            )
            .pipe(Effect.provide(served.context));
          const feature = yield* pool.resolve({ projectId, cwd: featureCheckout });
          const journal = yield* Context.get(served.context, GraphStore).db.select().from(event).where(eq(event.projectId, projectId));
          const head = yield* runGit(git, 'head', ['-C', served.layout.treeRoot, 'rev-parse', 'HEAD']);
          const roots = [served.layout.treeRoot, feature.layout.treeRoot];
          if (served.layout.mode !== 'stealth') return yield* Effect.die('the fixture serves stealth storage');
          const byId = { graph: dirname(served.layout.gitDir), mirror: dirname(served.layout.mirrorPath) };
          yield* pool.releaseProject(projectId);

          const named = { graph: join(graphsHome(appHome), name), mirror: join(mirrorsHome(appHome), name) };
          const nameRoot = (root: string) => join(named.graph, root.slice(byId.graph.length + 1));
          const realBefore = yield* Effect.forEach(roots, (root) => fs.realPath(root));
          yield* fs.rename(byId.graph, named.graph);
          yield* runGit(git, 'rewind', ['--git-dir', join(named.graph, 'graph.git'), 'worktree', 'repair', ...roots.map(nameRoot)]);
          for (const [at, root] of roots.entries()) {
            const realNamed = yield* fs.realPath(nameRoot(root));
            for (const kind of [TREE_ORIGINS, TREE_SERVED]) {
              const record = join(named.graph, 'graph.git', kind, keyOf(realBefore[at]!));
              if (yield* fs.exists(record)) yield* fs.rename(record, join(named.graph, 'graph.git', kind, keyOf(realNamed)));
            }
          }
          yield* fs.rename(byId.mirror, named.mirror);
          for (const root of roots) {
            for (const ending of MIRROR_FILES) {
              const from = `${mirrorFile(named.mirror, root)}${ending}`;
              if (yield* fs.exists(from)) yield* fs.rename(from, `${mirrorFile(named.mirror, nameRoot(root))}${ending}`);
            }
            const db = new Database(mirrorFile(named.mirror, nameRoot(root)));
            try {
              const written = { ...identityIn(db), treeRoot: nameRoot(root), gitDir: join(named.graph, 'graph.git') };
              db.query('update meta set value = ? where key = ?').run(JSON.stringify(written), MIRROR_IDENTITY);
            } finally {
              db.close();
            }
          }
          expect(yield* runGit(git, 'named', ['-C', nameRoot(served.layout.treeRoot), 'rev-parse', 'HEAD'])).toBe(head);
          const [numbered] = yield* demo.graph.store.db.all<{ id: number }>(
            sql`insert into project (name, repo_key, root_path, created_at) values (${String(projectId)}, 'numbered', ${yield* demo.fixture.directory('numbered')}, 0) returning id`,
          );
          if (numbered === undefined) return yield* Effect.die('the numbered project was not registered');

          const staging = `${graphsHome(appHome)}.moving`;
          yield* fs.makeDirectory(staging);
          yield* fs.rename(named.graph, join(staging, String(projectId)));
          yield* demo.graph.store.db.run(sql`delete from meta where key = '20261027000000_storage_by_id'`);
          const step = shippedSteps.prepareStorage.pipe(
            Effect.provideService(MachineStore, demo.graph.store),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Git, git),
          );
          yield* step;
          yield* demo.graph.store.db.run(sql`delete from meta where key = '20261027000000_storage_by_id'`);
          yield* demo.graph.store.db.run(sql`insert into meta (key, value) values ('20261027000000_storage_by_id:staged', 'done')`);
          yield* step;

          expect(yield* fs.exists(named.graph)).toBe(false);
          expect(yield* fs.exists(named.mirror)).toBe(false);
          expect(yield* fs.exists(join(graphsHome(appHome), String(numbered.id)))).toBe(false);
          expect(yield* fs.exists(join(mirrorsHome(appHome), String(numbered.id)))).toBe(false);
          expect(roots.map((root) => identityAt(mirrorFile(byId.mirror, root)))).toEqual(
            roots.map((root) => expect.objectContaining({ treeRoot: root, gitDir: join(byId.graph, 'graph.git') })),
          );
          const reopened = yield* Effect.acquireRelease(
            graphPool({
              machine: machineGraphOf(demo.context),
              sourcePath: repo,
              identity: testSessionIdentity,
              migrations: fixtureGraphMigrations,
            }),
            (held) => held.dispose(),
          );
          const main = yield* reopened.resolve({ projectId });
          const store = Context.get(main.context, GraphStore);
          expect(main.layout.treeRoot).toBe(served.layout.treeRoot);
          expect(yield* store.db.select().from(block).where(eq(block.uuid, kept.uuid)).get()).toMatchObject({ id: kept.id, body: 'kept' });
          expect(yield* store.db.select().from(event).where(eq(event.projectId, projectId))).toEqual(journal);
          expect((yield* runGit(git, 'moved-log', ['-C', main.layout.treeRoot, 'log', '--format=%H'])).split('\n')).toContain(head);
          const added = yield* demo
            .as(
              'op',
              Context.get(main.context, Blocks).create({ projectId, parentId: root.id, tags: ['idea'], title: 'Written after the move' }),
            )
            .pipe(Effect.provide(main.context));
          expect(yield* store.db.select().from(block).where(eq(block.uuid, added.uuid)).get()).toMatchObject({
            title: 'Written after the move',
          });
          expect((yield* reopened.resolve({ projectId, cwd: featureCheckout })).layout.treeRoot).toBe(feature.layout.treeRoot);
        }),
      ),
  );
});
