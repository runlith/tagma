import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { systemError } from 'effect/PlatformError';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Blocks } from '../contract/service/blocks.js';
import type { ServedGraph } from '../contract/service/serving.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { block } from '../store/tables.js';
import { graphCommit } from '../settings.js';
import { readBlockTree } from '../tree/layout.js';
import { machineGraphOf } from './machine.js';
import { graphPool } from '../testing/doubles.js';

layer(demoGraphLayer({ repos: ['travel'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('graph storage moves', (it) => {
  it.effect('a cross-device move stays asynchronous and preserves handles, writes, unrelated files and refused targets', () =>
    withDemo(({ graph, context, project, demoRoot, as, refusal }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const travel = project('travel');
          const projectId = travel.id;
          const repo = travel.root;
          const target = join(repo, '.tagma');
          const workflow = join(target, 'workflows', 'review.json');
          const git = (...args: string[]) => runGit(graph.git, 'test-storage', args, { cwd: repo });
          yield* fs.makeDirectory(join(target, 'workflows'), { recursive: true });
          yield* fs.writeFileString(workflow, '{}\n');
          yield* git('add', '-A');
          yield* git('commit', '-m', 'unrelated workflow');
          yield* as('op', graph.settings.write({ key: graphCommit.id, scope: 'project', projectId, value: 'manual' }));
          const copying = yield* Deferred.make<void>();
          const proceed = yield* Deferred.make<void>();
          const disk: FileSystem.FileSystem = {
            ...fs,
            rename: (source, destination) =>
              destination.startsWith(`${target}/`)
                ? Effect.fail(systemError({ _tag: 'Unknown', module: 'FileSystem', method: 'rename', cause: { code: 'EXDEV' } }))
                : fs.rename(source, destination),
            copy: Effect.fnUntraced(function* (source, destination, options) {
              yield* fs.copy(source, destination, options);
              yield* Deferred.succeed(copying, undefined);
              yield* Deferred.await(proceed);
            }),
          };
          const machine = machineGraphOf(Context.add(Context.add(context, Catalogs, NO_CATALOGS), FileSystem.FileSystem, disk));
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
            (held) => held.dispose(),
          );
          yield* pool.birth(projectId);
          const initial = yield* pool.resolve({ projectId });
          const original = initial.layout.treeRoot;
          const doc = yield* as(
            'op',
            Effect.gen(function* () {
              const blocks = Context.get(initial.context, Blocks);
              return yield* blocks.create({
                projectId,
                parentId: (yield* blocks.rootBlockOf(projectId)).id,
                tags: ['idea'],
                title: 'The Charter',
                body: 'what the project is',
              });
            }),
          ).pipe(Effect.provide(initial.context));
          const byUuid = (copy: ServedGraph, uuid: string) =>
            Context.get(copy.context, GraphStore).db.select().from(block).where(eq(block.uuid, uuid)).get();
          const moving = yield* Effect.forkScoped(pool.moveProjectStorage({ projectId, mode: 'team' }));
          yield* Effect.raceFirst(Deferred.await(copying), Fiber.join(moving));
          expect(yield* fs.exists(original)).toBe(true);
          expect((yield* graph.projectPolicy.read([projectId])).get(projectId)?.storage).toBe('stealth');
          const resolving = yield* Effect.forkScoped(pool.resolve({ projectId }));
          yield* Deferred.succeed(proceed, undefined);
          const moved = yield* Fiber.join(moving);
          expect(moved).toMatchObject({ treeRoot: target, row: { storage: 'team' } });
          expect((yield* graph.projectPolicy.read([projectId])).get(projectId)?.storage).toBe('team');
          expect(yield* fs.readFileString(workflow)).toBe('{}\n');
          expect(yield* fs.exists(original)).toBe(false);
          const team = yield* Fiber.join(resolving);
          expect(team.layout.treeRoot).toBe(target);
          expect(yield* byUuid(team, doc.uuid)).toMatchObject({ id: doc.id, body: doc.body });
          expect(yield* git('status', '--porcelain', '--', '.tagma')).not.toBe('');
          const born = yield* as(
            'op',
            Effect.gen(function* () {
              const blocks = Context.get(team.context, Blocks);
              return yield* blocks.create({
                projectId,
                parentId: (yield* blocks.rootBlockOf(projectId)).id,
                tags: ['task'],
                title: 'Written in team mode',
              });
            }),
          ).pipe(Effect.provide(team.context));
          expect((yield* readBlockTree(target)).map((entry) => entry.frontmatter.id)).toContain(born.uuid);
          const returned = yield* pool.moveProjectStorage({ projectId, mode: 'stealth' });
          expect(returned).toMatchObject({ treeRoot: original, row: { storage: 'stealth' } });
          expect(yield* fs.readDirectory(target)).toEqual(['workflows']);
          expect(yield* fs.readFileString(workflow)).toBe('{}\n');
          expect(yield* git('status', '--porcelain', '--', '.tagma')).toBe('');
          const stealth = yield* pool.resolve({ projectId });
          expect(yield* byUuid(stealth, doc.uuid)).toMatchObject({ id: doc.id, body: doc.body });
          expect(yield* byUuid(stealth, born.uuid)).toMatchObject({ id: born.id, title: born.title });
          expect((yield* refusal(pool.moveProjectStorage({ projectId, mode: 'stealth' }))).code).toBe('storage-unchanged');
          const squatter = join(target, 'squatter.md');
          yield* fs.writeFileString(squatter, 'not this graph\n');
          expect((yield* refusal(pool.moveProjectStorage({ projectId, mode: 'team' }))).code).toBe('target-holds-tree');
          expect((yield* graph.projectPolicy.read([projectId])).get(projectId)?.storage).toBe('stealth');
          expect(yield* fs.readFileString(squatter)).toBe('not this graph\n');
          const standing = yield* pool.resolve({ projectId });
          expect((yield* byUuid(standing, doc.uuid))?.id).toBe(doc.id);
        }),
      ),
    ),
  );
});
