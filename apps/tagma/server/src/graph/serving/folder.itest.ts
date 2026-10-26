import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { eq, sql } from 'drizzle-orm';
import { dirname, join } from 'node:path';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GraphStore, MachineStore } from '../../platform/contract/service/store.js';
import { runGit } from '../../platform/git/ownGit.js';
import { placeAt } from '../../projects/identity.js';
import { Blocks } from '../contract/service/blocks.js';
import { Orientation } from '../contract/service/orientation.js';
import { Sources } from '../contract/service/sources.js';
import { block, event } from '../store/tables.js';
import { legacyHome, mirrorPath, stealthTreeName, storageHomes } from '../storage/layout.js';
import { shippedSteps } from '../steps/sequence.js';
import { graphPool } from '../testing/doubles.js';
import { machineGraphOf } from './machine.js';

layer(demoGraphLayer({ repos: [] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('folder graphs', (it) => {
  it.effect('the global folder carries files and law, then follows git worktrees without exporting branch law', () =>
    withDemo(({ graph, context, demoRoot, projectId, fixture, as }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const global = (yield* graph.projects.global())!;
        expect((yield* graph.projectPolicy.read([global.id])).get(global.id)?.storage).toBe('stealth');
        const pool = yield* Effect.acquireRelease(
          graphPool({
            machine: machineGraphOf(context),
            sourcePath: demoRoot,
            identity: testSessionIdentity,
            migrations: fixtureGraphMigrations,
          }),
          (pool) => pool.dispose(),
        );
        const main = yield* pool.resolve({ projectId: global.id });
        expect(yield* pool.branches(global.id)).toEqual([{ branch: 'main', worktree: global.rootPath, canonical: true }]);
        const create = (copy: typeof main, title: string) =>
          as('op', Context.get(copy.context, Blocks).create({ projectId: global.id, tags: ['rule'], title })).pipe(
            Effect.provide(copy.context),
          );
        yield* create(main, 'Common law');
        const other = yield* pool.resolve({ projectId });
        const law = () =>
          Context.get(other.context, Orientation)
            .instructions({ projectId, audience: 'graph' })
            .pipe(
              Effect.map((set) =>
                set.entries
                  .filter((entry) => entry.kind === 'law')
                  .map((entry) => entry.text)
                  .join('\n'),
              ),
              Effect.provide(other.context),
            );
        expect(yield* law()).toContain('Common law');
        const path = join(global.rootPath, 'work.txt');
        yield* fs.writeFileString(path, 'project files\n');
        const git = (...args: string[]) => runGit(graph.git, 'folder-test', ['-C', global.rootPath, ...args]);
        yield* git('init', '-q', '-b', 'main');
        yield* git('add', 'work.txt');
        yield* git('-c', 'user.name=test', '-c', 'user.email=test@x', 'commit', '-qm', 'project born');
        const owner = yield* as(
          'op',
          Context.get(main.context, Blocks).create({
            projectId: global.id,
            tags: ['idea'],
            title: 'Work file',
            sources: [{ kind: 'file', ref: 'work.txt' }],
          }),
        ).pipe(Effect.provide(main.context));
        expect(
          (yield* Context.get(main.context, Sources).ownersOf(global.id, path).pipe(Effect.provide(main.context))).map((row) => row.uuid),
        ).toContain(owner.uuid);
        yield* pool.moveProjectStorage({ projectId: global.id, mode: 'team' });
        yield* pool.moveProjectStorage({ projectId: global.id, mode: 'stealth' });
        const topicPath = yield* fs.realPath(yield* fixture.directory('global-topic'));
        yield* git('worktree', 'add', '-q', '-b', 'topic', topicPath);
        const topic = yield* pool.resolve({ projectId: global.id, cwd: topicPath });
        expect(topic.checkout).toBe(topicPath);
        expect((yield* graph.projects.resolve(undefined, yield* placeAt(topicPath)))?.id).toBe(global.id);
        yield* create(topic, 'Branch law');
        expect(
          (yield* Context.get(topic.context, GraphStore).db.select().from(block).where(eq(block.projectId, global.id))).some(
            (row) => row.title === 'Common law',
          ),
        ).toBe(true);
        expect(yield* law()).toContain('Common law');
        expect(yield* law()).not.toContain('Branch law');
        expect(yield* fs.readFileString(path)).toBe('project files\n');
      }),
    ),
  );

  it.effect.each(['plain', 'stealth'] as const)(
    'the storage step keeps a legacy %s global tree, its git history and its mirror journal',
    (storage) =>
      withDemo(({ graph, context, demoRoot, as }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const global = (yield* graph.projects.global())!;
          const machine = machineGraphOf(context);
          const makePool = () =>
            graphPool({ machine, sourcePath: demoRoot, identity: testSessionIdentity, migrations: fixtureGraphMigrations });
          const pool = yield* Effect.acquireRelease(makePool(), (pool) => pool.dispose());
          const served = yield* pool.resolve({ projectId: global.id });
          if (served.layout.mode !== 'stealth') return yield* Effect.die('the fixture did not open stealth storage');
          const layout = served.layout;
          const doc = yield* as(
            'op',
            Context.get(served.context, Blocks).create({ projectId: global.id, title: 'Kept knowledge', body: 'kept body' }),
          ).pipe(Effect.provide(served.context));
          const journal = yield* Context.get(served.context, GraphStore).db.select().from(event).where(eq(event.projectId, global.id));
          yield* pool.releaseProject(global.id);
          const { appHome } = storageHomes(graph.store.path);
          const source =
            storage === 'plain'
              ? join(legacyHome(appHome), global.name)
              : join(appHome, global.name, 'trees', stealthTreeName(global.rootPath));
          yield* fs.makeDirectory(dirname(source), { recursive: true });
          if (storage === 'plain') {
            yield* runGit(graph.git, 'legacy-tree', ['clone', '--no-hardlinks', '--branch', 'main', layout.gitDir, source]);
          } else {
            const oldGit = join(appHome, global.name, 'graph.git');
            yield* runGit(graph.git, 'legacy-shadow', ['clone', '--bare', '--no-hardlinks', layout.gitDir, oldGit]);
            yield* runGit(graph.git, 'legacy-tree', ['--git-dir', oldGit, 'worktree', 'add', source, 'main']);
          }
          const head = yield* runGit(graph.git, 'legacy-head', ['-C', source, 'rev-parse', 'HEAD']);
          yield* fs.remove(dirname(layout.gitDir), { recursive: true });
          const oldMirror = mirrorPath(appHome, global.name, source);
          for (const suffix of ['', '-wal', '-shm'])
            if (yield* fs.exists(`${served.layout.mirrorPath}${suffix}`))
              yield* fs.rename(`${served.layout.mirrorPath}${suffix}`, `${oldMirror}${suffix}`);
          yield* graph.store.db.run(sql`insert into project_policy (project_id, storage) values (${global.id}, ${storage})
        on conflict (project_id) do update set storage = ${storage}`);
          yield* graph.store.db.run(sql`delete from meta where key = '20261021123000_storage_stealth'`);
          yield* shippedSteps.prepareStorage.pipe(
            Effect.provideService(MachineStore, graph.store),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Git, graph.git),
          );
          expect((yield* graph.projectPolicy.read([global.id])).get(global.id)?.storage).toBe('stealth');
          const reopened = yield* Effect.acquireRelease(makePool(), (pool) => pool.dispose());
          const migrated = yield* reopened.resolve({ projectId: global.id });
          const store = Context.get(migrated.context, GraphStore);
          expect(yield* store.db.select().from(block).where(eq(block.uuid, doc.uuid)).get()).toMatchObject({ id: doc.id, body: doc.body });
          expect(yield* store.db.select().from(event).where(eq(event.projectId, global.id))).toEqual(journal);
          expect((yield* runGit(graph.git, 'migrated-head', ['-C', migrated.layout.treeRoot, 'log', '--format=%H'])).split('\n')).toContain(
            head,
          );
          const added = yield* as(
            'op',
            Context.get(migrated.context, Blocks).create({ projectId: global.id, title: 'Writable after upgrade' }),
          ).pipe(Effect.provide(migrated.context));
          expect(yield* store.db.select().from(block).where(eq(block.uuid, added.uuid)).get()).toMatchObject({ title: added.title });
        }),
      ),
  );
});
