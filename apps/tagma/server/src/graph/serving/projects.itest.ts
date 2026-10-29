import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Cause, Effect, Exit, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { CallerCheckout } from '../../workspace/contract/service/checkouts.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { placeAt } from '../../projects/identity.js';
import { project } from '../../projects/store/table.js';
import { signedBy } from '../../invocation/testing/call.js';
import { runGit } from '../../platform/git/ownGit.js';
import { writes } from '../../platform/contract/service/writes.js';
import { mapBudget } from '../settings.js';
import { block, meta } from '../store/tables.js';
import { rowsStepKey } from '../contract/wire/storage.js';
import { shippedSteps } from '../steps/sequence.js';

const testActing = writes('test', []);

layer(demoGraphLayer({ repos: ['repo'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'projects',
  (it) => {
    it.effect('names and ids resolve, unknown names list registered projects, and the global graph is permanent', () =>
      withDemo(({ graph, projectId, fixture, refusal }) =>
        Effect.gen(function* () {
          expect((yield* graph.projects.resolve(String(projectId)))?.id).toBe(projectId);
          expect((yield* graph.projects.resolve('demo'))?.id).toBe(projectId);
          const unknown = yield* refusal(graph.projects.resolve('nope'));
          expect(unknown.code).toBe('unknown-project');
          const registered = yield* graph.projects.list();
          for (const row of registered) expect(unknown.reason).toContain(row.name);
          expect([...unknown.reason.matchAll(/\((\d+)\)/g)].map((match) => Number(match[1])).sort()).toEqual(
            registered.map((row) => row.id).sort(),
          );
          const global = (yield* graph.projects.global())!;
          expect(global.name).toBe('global');
          expect((yield* graph.projects.resolve('global'))?.id).toBe(global.id);
          expect(global.rootPath.endsWith('/global')).toBe(true);
          expect(yield* runGit(graph.git, 'head', ['-C', global.rootPath, 'rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
          const root = yield* fixture.directory('alpha');
          const alpha = yield* graph.projectLifecycle.create({ name: 'alpha', rootPath: root });
          expect(
            (yield* graph.graphStore.db
              .select()
              .from(meta)
              .where(eq(meta.key, rowsStepKey(alpha.id)))
              .get())?.value,
          ).toBe(shippedSteps.last);
          expect((yield* graph.projects.list()).map((row) => row.name)).toEqual(['global', 'alpha', 'demo', 'repo']);
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'global', rootPath: root }))).code).toBe('reserved-project');
          expect((yield* refusal(graph.projectLifecycle.remove({ ref: String(global.id) }))).code).toBe('global-permanent');
          expect((yield* refusal(graph.projectLifecycle.move(global.id, root))).code).toBe('global-permanent');
        }),
      ),
    );

    it.effect('cwd uses segment boundaries and follows set-root without duplicating another registered root', () =>
      withDemo(({ graph, projectId, demoRoot, fixture, refusal }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sibling = `${demoRoot}-app`;
          yield* fs.makeDirectory(sibling);
          const nested = (yield* graph.projectLifecycle.create({ name: 'nested', rootPath: sibling })).id;
          const resolve = (cwd: string) => Effect.flatMap(placeAt(cwd), (here) => graph.projects.resolve(undefined, here));
          expect((yield* resolve(join(demoRoot, 'src')))?.id).toBe(projectId);
          expect((yield* resolve(join(sibling, 'src')))?.id).toBe(nested);
          expect(yield* resolve('/tmp/elsewhere')).toBeUndefined();
          expect(yield* graph.projects.resolve(undefined, undefined)).toBeUndefined();
          const moved = yield* fixture.directory('moved');
          expect((yield* graph.projectLifecycle.move(projectId, moved)).rootPath).toBe(yield* fs.realPath(moved));
          expect((yield* resolve(join(moved, 'src')))?.id).toBe(projectId);
          expect(yield* resolve(join(demoRoot, 'src'))).toBeUndefined();
          expect((yield* refusal(graph.projectLifecycle.move(projectId, sibling))).code).toBe('duplicate-root');
          const inside = join(sibling, 'app');
          yield* fs.makeDirectory(inside);
          expect((yield* graph.projectLifecycle.move(projectId, inside)).rootPath).toBe(yield* fs.realPath(inside));
          expect((yield* graph.projectLifecycle.move(projectId, demoRoot)).rootPath).toBe(yield* fs.realPath(demoRoot));
        }),
      ),
    );

    it.effect('a root named through a symlink before its first commit is registered at its physical path', () =>
      withDemo(({ graph, fixture }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const real = yield* fixture.directory('linked-real');
          const link = join(yield* fixture.directory('links'), 'linked');
          yield* fs.symlink(real, link);
          const linked = yield* graph.projectLifecycle.create({ name: 'linked', rootPath: link });
          expect(linked.rootPath).toBe(yield* fs.realPath(real));
          yield* runGit(graph.git, 'init', ['-C', link, 'init', '-q']);
          yield* runGit(graph.git, 'commit', [
            '-C',
            link,
            '-c',
            'user.name=t',
            '-c',
            'user.email=t@t',
            'commit',
            '-q',
            '--allow-empty',
            '-m',
            'first',
          ]);
          const resolve = (cwd: string) => Effect.flatMap(placeAt(cwd), (here) => graph.projects.resolve(undefined, here));
          expect((yield* resolve(link))?.id).toBe(linked.id);
          expect((yield* resolve(real))?.id).toBe(linked.id);
        }),
      ),
    );

    it.effect('a folder registered earlier under a non-physical spelling is found and comes back by its physical path', () =>
      withDemo(({ graph, fixture }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const real = yield* fixture.directory('legacy-real');
          const link = join(yield* fixture.directory('legacy-links'), 'legacy');
          yield* fs.symlink(real, link);
          const legacy = yield* graph.projectLifecycle.create({ name: 'legacy', rootPath: real });
          yield* graph.store.db.update(project).set({ repoKey: link, rootPath: link }).where(eq(project.id, legacy.id));
          const resolve = (cwd: string) => Effect.flatMap(placeAt(cwd), (here) => graph.projects.resolve(undefined, here));
          expect((yield* resolve(join(real, 'src')))?.id).toBe(legacy.id);
          yield* graph.projectLifecycle.remove({ ref: String(legacy.id) });
          expect((yield* graph.projectLifecycle.create({ name: 'legacy-again', rootPath: real })).id).toBe(legacy.id);
        }),
      ),
    );

    it.effect('registration and set-root refuse relative or missing directories', () =>
      withDemo(({ graph, projectId, demoRoot, refusal }) =>
        Effect.gen(function* () {
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'rel', rootPath: 'apps/demo' }))).code).toBe('relative-root');
          expect((yield* refusal(graph.projectLifecycle.move(projectId, 'apps/demo'))).code).toBe('relative-root');
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'ghost', rootPath: `${demoRoot}-gone` }))).code).toBe(
            'missing-root',
          );
          expect((yield* refusal(graph.projectLifecycle.move(projectId, `${demoRoot}-gone`))).code).toBe('missing-root');
        }),
      ),
    );

    it.effect('nested roots choose the deepest containing project', () =>
      withDemo(({ graph, projectId, demoRoot, fixture, refusal }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const inside = join(demoRoot, 'sub');
          yield* fs.makeDirectory(inside);
          const child = (yield* graph.projectLifecycle.create({ name: 'inside', rootPath: inside })).id;
          const umbrella = (yield* graph.projectLifecycle.create({ name: 'above', rootPath: fixture.root })).id;
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'again', rootPath: demoRoot }))).code).toBe('duplicate-root');
          const resolve = (cwd: string) => Effect.flatMap(placeAt(cwd), (here) => graph.projects.resolve(undefined, here));
          expect((yield* resolve(join(inside, 'deep')))?.id).toBe(child);
          expect((yield* resolve(join(demoRoot, 'src')))?.id).toBe(projectId);
          expect((yield* resolve(join(fixture.root, 'stray')))?.id).toBe(umbrella);
        }),
      ),
    );

    it.effect('an explicit scope selects its project while a request checkout supplies an implicit place', () =>
      withDemo(({ graph, projectId, demoRoot, fixture, nameOf, refusal, root }) =>
        Effect.gen(function* () {
          const area = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'scoped' })).id;
          const scopeName = yield* nameOf(area);
          const otherRoot = yield* fixture.directory('other');
          const other = yield* graph.projectLifecycle.create({ name: 'other', rootPath: otherRoot });
          expect(yield* graph.graphScopes.lens({ scopeName, cwd: '/tmp/elsewhere' })).toEqual({ projectId, scopeId: area });
          expect(yield* graph.graphScopes.lens({ scopeName })).toEqual({ projectId, scopeId: area });
          expect(yield* graph.graphScopes.lens({ scopeName, cwd: join(otherRoot, 'src') })).toEqual({ projectId, scopeId: area });
          expect((yield* refusal(graph.graphScopes.lens({ project: 'other', scopeName }))).code).toBe('scope-outside-project');
          expect((yield* graph.graphScopes.scope(projectId, area)).id).toBe(area);
          expect((yield* refusal(graph.graphScopes.scope(other.id, area))).code).toBe('scope-outside-project');
          yield* graph.sources.attach({ blockId: area, kind: 'dir', ref: 'apps/x' });
          expect(yield* graph.graphScopes.lens({ cwd: join(demoRoot, 'apps', 'x') })).toEqual({ projectId, scopeId: area });
          expect((yield* graph.graphScopes.lens({ project: 'demo', cwd: join(demoRoot, 'apps', 'x') })).scopeId).toBeUndefined();
          expect((yield* graph.graphScopes.lens({ cwd: '/tmp/elsewhere' })).projectId).toBeUndefined();
          const cwd = '/virtual/request/place';
          const checkout = {
            cwd,
            repo: Effect.succeed({
              key: demoRoot,
              path: 'apps/x',
              toplevel: demoRoot,
              gitDir: join(demoRoot, '.git'),
              mainWorktree: demoRoot,
            }),
          };
          expect(yield* graph.graphScopes.lens({ cwd })).toEqual({});
          expect(yield* graph.graphScopes.lens({ cwd }).pipe(Effect.provideService(CallerCheckout, checkout))).toEqual({
            projectId,
            scopeId: area,
          });
        }),
      ),
    );

    it.effect('removal is atomic and publishes committed changes even when a subscriber defects', () =>
      withDemo(({ graph, fixture, refusal }) =>
        Effect.gen(function* () {
          const spare = yield* graph.projectLifecycle.create({ name: 'spare', rootPath: yield* fixture.directory('spare') });
          const changes = yield* ProjectChanges;
          const published: Array<number | 'changed'> = [];
          const removed = changes.removed.subscribe(({ projectId }) =>
            Effect.sync(() => {
              published.push(projectId);
            }),
          );
          const changed = changes.changed.subscribe(
            Effect.sync(() => {
              published.push('changed');
            }),
          );
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              removed();
              changed();
            }),
          );
          const version = yield* graph.projects.registryVersion;
          const aborted = graph.act.unit(
            testActing,
            Effect.gen(function* () {
              yield* graph.projectLifecycle.remove({ ref: String(spare.id) });
              expect(published).toEqual([]);
              return yield* Effect.fail('aborted');
            }),
          );
          const rolledBack = yield* Effect.result(aborted);
          expect(rolledBack._tag).toBe('Failure');
          if (rolledBack._tag === 'Failure') expect(rolledBack.failure).toBe('aborted');
          expect((yield* graph.projects.byId(spare.id)).name).toBe('spare');
          expect(yield* graph.projects.registryVersion).toBe(version);
          const recovered = yield* graph.act.unit(testActing, Effect.result(aborted));
          expect(recovered._tag).toBe('Failure');
          if (recovered._tag === 'Failure') expect(recovered.failure).toBe('aborted');
          expect(published).toEqual([]);
          expect(yield* graph.projects.registryVersion).toBe(version);
          expect((yield* graph.projectLifecycle.remove({ ref: String(spare.id) })).name).toBe('spare');
          expect(published).toEqual([spare.id, 'changed']);
          expect(yield* graph.projects.registryVersion).toBe(version + 1);
          expect((yield* refusal(graph.projects.resolve('spare'))).code).toBe('unknown-project');

          const another = yield* graph.projectLifecycle.create({ name: 'release-failure', rootPath: yield* fixture.directory('release') });
          const failure = new Error('release failed');
          const delivered: string[] = [];
          const failingRelease = changes.removed.subscribe(() => Effect.die(failure));
          const nextRelease = changes.removed.subscribe(() =>
            Effect.sync(() => {
              delivered.push('removed');
            }),
          );
          const nextChange = changes.changed.subscribe(
            Effect.sync(() => {
              delivered.push('changed');
            }),
          );
          try {
            const before = yield* graph.projects.registryVersion;
            const outcome = yield* Effect.exit(graph.projectLifecycle.remove({ ref: String(another.id) }));
            expect(Exit.isFailure(outcome)).toBe(true);
            if (Exit.isFailure(outcome)) expect(Cause.squash(outcome.cause)).toBe(failure);
            expect(delivered).toEqual(['removed', 'changed']);
            expect(yield* graph.projects.registryVersion).toBe(before + 1);
            expect((yield* refusal(graph.projects.byId(another.id))).code).toBe('not-found');
          } finally {
            failingRelease();
            nextRelease();
            nextChange();
          }
        }),
      ),
    );

    it.effect(
      'a removed project frees its name and comes back at its root with its knowledge and settings, named as asked once its name is taken',
      () =>
        withDemo(({ graph, fixture, refusal }) =>
          Effect.gen(function* () {
            const root = yield* fixture.directory('spare');
            const spare = yield* graph.projectLifecycle.create({ name: 'spare-settings', rootPath: root });
            const kept = yield* graph.blocks.create({
              projectId: spare.id,
              parentId: (yield* graph.blocks.rootBlockOf(spare.id)).id,
              tags: ['idea'],
              title: 'kept',
            });
            yield* signedBy(null)(
              graph.settings.write({
                scope: 'project',
                projectId: spare.id,
                key: mapBudget.id,
                value: mapBudget.fallback + 1,
              }),
            );
            expect((yield* graph.projectLifecycle.remove({ ref: String(spare.id) })).name).toBe('spare-settings');
            expect((yield* refusal(graph.projects.resolve('spare-settings'))).code).toBe('unknown-project');
            expect((yield* graph.projects.list()).map((row) => row.id)).not.toContain(spare.id);
            const elsewhere = yield* fixture.directory('elsewhere');
            expect(yield* graph.projectLifecycle.create({ name: 'spare-settings', rootPath: elsewhere })).toMatchObject({
              name: 'spare-settings',
              returned: false,
            });

            const back = yield* graph.projectLifecycle.create({ name: 'renamed', rootPath: root, storage: 'team' });
            expect(back).toMatchObject({ id: spare.id, name: 'renamed', storage: spare.storage, returned: true });
            expect((yield* graph.settings.read(mapBudget, spare.id)).from).toBe('project');
            expect(yield* graph.graphStore.db.select({ title: block.title }).from(block).where(eq(block.id, kept.id))).toEqual([
              { title: 'kept' },
            ]);
          }),
        ),
    );

    it.effect('a folder added before its first commit comes back as the same project once it has commits', () =>
      withDemo(({ graph, fixture }) =>
        Effect.gen(function* () {
          const root = yield* fixture.directory('uncommitted');
          const early = yield* graph.projectLifecycle.create({ name: 'uncommitted', rootPath: root });
          yield* graph.projectLifecycle.remove({ ref: String(early.id) });
          yield* runGit(graph.git, 'init', ['init', '-q', '-b', 'main'], { cwd: root });
          yield* runGit(
            graph.git,
            'commit',
            ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first'],
            { cwd: root },
          );
          const back = yield* graph.projectLifecycle.create({ name: 'uncommitted', rootPath: root });
          expect(back).toMatchObject({ id: early.id, returned: true });
          expect(back.repoKey).not.toBe(root);
        }),
      ),
    );

    it.effect('repository registration canonicalizes worktrees, follows repository identity and carries the chosen mode', () =>
      withDemo(({ graph, project, fixture, refusal }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const repo = project('repo');
          yield* graph.projectLifecycle.remove({ ref: String(repo.id) });
          const worktree = yield* fixture.directory('branch');
          yield* runGit(graph.git, 'worktree', ['worktree', 'add', '-q', worktree, '-b', 'second'], { cwd: repo.root });
          const registered = yield* graph.projectLifecycle.create({ name: 'canon', rootPath: join(worktree, 'apps', 'x') });
          expect(registered.rootPath).toBe(repo.root);
          expect(registered.storage).toBe('stealth');
          const resolve = (cwd: string) => Effect.flatMap(placeAt(cwd), (here) => graph.projects.resolve(undefined, here));
          expect((yield* resolve(join(worktree, 'apps', 'x')))?.id).toBe(registered.id);
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'again', rootPath: worktree }))).code).toBe('duplicate-root');
          expect((yield* refusal(graph.projectLifecycle.create({ name: 'product', rootPath: join(repo.root, 'apps', 'x') }))).code).toBe(
            'duplicate-root',
          );
          expect((yield* resolve(join(repo.root, 'apps', 'x')))?.id).toBe(registered.id);
          const moved = `${repo.root}-moved`;
          yield* fs.rename(repo.root, moved);
          const found = yield* resolve(join(moved, 'apps', 'x'));
          expect(found?.id).toBe(registered.id);
          expect(found?.rootPath).toBe(repo.root);
          expect((yield* graph.projectLifecycle.move(registered.id, moved)).rootPath).toBe(moved);
          expect((yield* graph.projects.byId(registered.id)).rootPath).toBe(moved);
          expect(
            (yield* graph.projectLifecycle.create({ name: 'team', rootPath: yield* fixture.directory('team'), storage: 'team' })).storage,
          ).toBe('team');
        }),
      ),
    );

    it.effect('ready and search narrow to the live subtree of the scope block', () =>
      withDemo(({ graph, projectId, nameOf, root }) =>
        Effect.gen(function* () {
          const area = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'zone' })).id;
          const inside = (yield* graph.blocks.create({ projectId, parentId: area, tags: ['task'], title: 'inside' })).id;
          yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'outside' });
          expect((yield* graph.selection.ready({ projectId, scopeId: area })).map((row) => row.id)).toEqual([inside]);
          expect((yield* graph.ranking.search({ query: '', projectId, scopeId: area })).items.map((row) => row.name).sort()).toEqual(
            [yield* nameOf(area), yield* nameOf(inside)].sort(),
          );
          yield* graph.trash.delete({ id: inside });
          expect(yield* graph.selection.ready({ projectId, scopeId: area })).toEqual([]);
        }),
      ),
    );

    it.effect('dir sources choose the deepest scope and symbol or exact-file owners beat containing directories', () =>
      withDemo(({ graph, projectId, demoRoot, refusal, root }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(join(demoRoot, 'apps/x/src'), { recursive: true });
          yield* fs.writeFileString(join(demoRoot, 'apps/x/src/owner.ts'), 'export const owner = 1;\nexport const other = 2;\n');
          const area = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'x' })).id;
          yield* graph.sources.attach({ blockId: area, kind: 'dir', ref: 'apps/x' });
          const inner = (yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'src', parentId: area })).id;
          yield* graph.sources.attach({ blockId: inner, kind: 'dir', ref: 'apps/x/src' });
          expect((yield* graph.graphScopes.scopeByPlace(projectId, join(demoRoot, 'apps/x/beside')))?.id).toBe(area);
          expect((yield* graph.graphScopes.scopeByPlace(projectId, join(demoRoot, 'apps/x/src/more')))?.id).toBe(inner);
          expect(yield* graph.graphScopes.scopeByPlace(projectId, demoRoot)).toBeUndefined();
          expect(yield* graph.graphScopes.scopeByPlace(projectId, join(demoRoot, 'elsewhere'))).toBeUndefined();
          const fileDoc = (yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'the file', parentId: inner })).id;
          yield* graph.sources.attach({ blockId: fileDoc, kind: 'file', ref: 'apps/x/src/owner.ts' });
          const symbolDoc = (yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'the symbol', parentId: inner })).id;
          yield* graph.sources.attach({ blockId: symbolDoc, kind: 'symbol', ref: 'apps/x/src/owner.ts', symbol: 'owner' });
          const owners = (spelling: string) =>
            graph.sources.ownersOf(projectId, spelling).pipe(Effect.map((rows) => rows.map((row) => row.id)));
          expect(yield* owners('apps/x/src/owner.ts#owner')).toEqual([symbolDoc]);
          expect(yield* owners('apps/x/src/owner.ts#other')).toEqual([fileDoc]);
          expect(yield* owners('apps/x/src/owner.ts')).toEqual([fileDoc]);
          expect(yield* owners('apps/x/src/else.ts')).toEqual([inner]);
          expect(yield* owners('apps/x/README.md')).toEqual([area]);
          expect(yield* owners('apps/y/nothing.ts')).toEqual([]);
          expect(yield* owners(join(demoRoot, 'apps/x/src/owner.ts'))).toEqual([fileDoc]);
          expect((yield* refusal(graph.sources.ownersOf(projectId, '../outside.ts'))).code).toBe('source-outside');
          const twin = (yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'the twin', parentId: inner })).id;
          yield* graph.sources.attach({ blockId: twin, kind: 'file', ref: 'apps/x/src/owner.ts' });
          expect((yield* owners('apps/x/src/owner.ts')).sort((a, b) => a - b)).toEqual([fileDoc, twin]);
          expect(yield* owners('apps/x/src/owner.ts#owner')).toEqual([symbolDoc]);
          yield* graph.tasks.close({ id: symbolDoc });
          expect((yield* owners('apps/x/src/owner.ts#owner')).sort((a, b) => a - b)).toEqual([fileDoc, twin]);
          const top = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'the root' })).id;
          yield* graph.sources.attach({ blockId: top, kind: 'dir', ref: '.' });
          expect(yield* owners('apps/y/nothing.ts')).toEqual([top]);
          expect(yield* owners('apps/x/src/else.ts')).toEqual([inner]);
          const letter = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'a' })).id;
          yield* graph.sources.attach({ blockId: letter, kind: 'dir', ref: 'a' });
          yield* graph.sources.attach({ blockId: area, kind: 'file', ref: 'apps/x/src/drawn.ts' });
          expect(yield* owners('a/one.ts')).toEqual([letter]);
          expect(yield* owners('apps/x/src/drawn.ts')).toEqual([area]);
          expect(yield* owners('apps/x/src/beside.ts')).toEqual([inner]);
          expect(yield* owners('elsewhere.ts')).toEqual([top]);
        }),
      ),
    );
  },
);
