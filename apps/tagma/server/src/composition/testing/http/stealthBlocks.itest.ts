import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { graphHome, stealthTreeName } from '../../../graph/storage/layout.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

type Written = { readonly block: { readonly name: string } };

const rootOf = Effect.fnUntraced(function* (project: number) {
  const world = yield* DoorFixture;
  const roots = yield* world.op('list_root_blocks', { project });
  return (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
});

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('stealth blocks', (it) => {
  it.effect('a stealth subtree of a team project stays out of .tagma and the code history and commits to its own git', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('team'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const head = yield* suiteGit(root, 'rev-parse', 'HEAD');

      const terms = yield* world.op('create_block', {
        project,
        title: 'Vendor terms',
        body: 'kept inside',
        storage: 'stealth',
        parentId: yield* rootOf(project),
      });
      expect(terms.status).toBe(200);
      const parent = (terms.body as Written).block.name;
      expect((yield* world.op('create_block', { project, title: 'Clause', parentId: parent })).status).toBe(200);
      const refused = yield* world.op('create_block', { project, title: 'Public clause', parentId: parent, storage: 'team' });
      expect((refused.body as { code: string }).code).toBe('stealth-dependency');

      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(head);
      const tracked = yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(tracked).not.toContain('vendor-terms');

      yield* world.runtime.pool.releaseProject(project);
      const home = graphHome(world.dataHome, project);
      const tree = join(home, 'layers', stealthTreeName(root));
      const committed = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(committed.split('\n').some((path) => path.endsWith('/vendor-terms/index.md'))).toBe(true);
      expect(committed.split('\n').some((path) => path.endsWith('/vendor-terms/clause.md'))).toBe(true);

      const found = yield* world.op('search_blocks', { project, query: 'Clause' });
      expect(JSON.stringify(found.body)).toContain('"stealth":true');
      const kept = yield* world.op('query_blocks', { project, stealth: true, sort: { by: 'created', order: 'asc' } });
      expect((kept.body as { blocks: readonly { title: string }[] }).blocks.map((row) => row.title)).toEqual(['Vendor terms', 'Clause']);
      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
    }),
  );

  it.effect('set_block_storage carries a whole subtree out of .tagma into the stealth tree and back', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('moving'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const roadmap = ((yield* world.op('create_block', { project, title: 'Roadmap', parentId: yield* rootOf(project) })).body as Written)
        .block.name;
      const quarter = ((yield* world.op('create_block', { project, title: 'Quarter plan', parentId: roadmap })).body as Written).block.name;
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const inTeam = () => Effect.map(suiteGit(root, 'ls-files', '--', '.tagma'), (listed) => listed.includes('roadmap'));
      expect(yield* inTeam()).toBe(true);

      const hiding = yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'stealth' });
      expect(hiding.status).toBe(200);
      expect([...((hiding.body as { published?: readonly string[] }).published ?? [])].sort()).toEqual([quarter, roadmap].sort());
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      expect(yield* inTeam()).toBe(false);
      const unchanged = yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'stealth' });
      expect((unchanged.body as { code: string }).code).toBe('storage-unchanged');
      yield* world.runtime.pool.releaseProject(project);
      const tree = join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root));
      const hidden = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(hidden).toContain('/roadmap/quarter-plan.md');

      expect((yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'team' })).status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      expect(yield* inTeam()).toBe(true);
      expect(yield* suiteGit(root, 'ls-files', '--', '.tagma')).toContain('roadmap/quarter-plan.md');
    }),
  );

  it.effect('no team block depends on a stealth block, and a stealth block replaces no team block', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('law'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const code = (answer: { readonly body: unknown }) => (answer.body as { code?: string }).code;
      const parentId = yield* rootOf(project);
      const created = (input: Record<string, unknown>) =>
        Effect.map(world.op('create_block', { project, parentId, ...input }), (answer) => (answer.body as Written).block.name);
      const secret = yield* created({ title: 'Secret', storage: 'stealth' });
      const plan = yield* created({ title: 'Plan' });

      expect(code(yield* world.op('create_block', { project, parentId, title: 'Leak', body: `see [[${secret}]]` }))).toBe(
        'stealth-dependency',
      );
      expect(code(yield* world.op('link_blocks', { project, fromId: plan, kind: 'relates', toId: secret }))).toBe('stealth-dependency');
      expect((yield* world.op('link_blocks', { project, fromId: secret, kind: 'relates', toId: plan })).status).toBe(200);
      expect(code(yield* world.op('supersede_block', { project, oldId: plan, withId: secret }))).toBe('stealth-supersede');

      const roadmap = yield* created({ title: 'Roadmap' });
      const pointer = yield* created({ title: 'Pointer', body: `the plan is [[${roadmap}]]` });
      const hiding = yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'stealth' });
      expect(code(hiding)).toBe('stealth-dependency');
      expect((hiding.body as { reason: string }).reason).toContain(pointer);
      const together = yield* world.op('apply_batch', {
        project,
        source: JSON.stringify({
          ops: [
            { op: 'update', id: pointer, body: 'the plan is kept apart' },
            { op: 'storage', id: roadmap, storage: 'stealth' },
          ],
        }),
      });
      expect(together.status).toBe(200);
    }),
  );

  it.effect('one apply_batch creates the first stealth block of a project and moves another block into it', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('batch'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const parentId = yield* rootOf(project);
      const pricing = ((yield* world.op('create_block', { project, title: 'Pricing', parentId })).body as Written).block.name;
      const batch = yield* world.op('apply_batch', {
        project,
        source: JSON.stringify({
          ops: [
            { op: 'create', $id: 'deals', title: 'Deals', storage: 'stealth', parentId },
            { op: 'storage', id: pricing, storage: 'stealth' },
            { op: 'create', title: 'Changelog', parentId },
          ],
        }),
      });
      expect(batch.status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const tracked = yield* suiteGit(root, 'ls-files', '--', '.tagma');
      expect(tracked).toContain('changelog.md');
      expect(tracked).not.toContain('pricing');
      expect(tracked).not.toContain('deals');
      yield* world.runtime.pool.releaseProject(project);
      const tree = join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root));
      const hidden = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(hidden).toContain('/deals.md');
      expect(hidden).toContain('/pricing.md');
    }),
  );

  it.effect('a stealth block written in a worktree reaches main with merge_worktree of its branch, not before', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('branching'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, 'seed.txt'), 'seed\n');
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'seed');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const at = (cwd: string) => `project=${project}&cwd=${encodeURIComponent(cwd)}`;
      expect((yield* world.op('sync_graph', {}, at(root))).status).toBe(200);
      const repository = ((yield* world.op('read_repositories', {}, at(root))).body as CoveredRepositoriesAnswer).repositories[0]!.binding;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'side');
      const operationId = world.uniqueName();
      const mode = { kind: 'new-branch', branch: 'side', start: 'HEAD' };
      expect((yield* world.op('prepare_worktree', { operationId, repository, destination, mode }, at(root))).status).toBe(200);
      const created = yield* world.op('create_worktree', { operationId }, at(root));
      expect(created.status).toBe(200);
      const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;

      const plan = yield* world.op(
        'create_block',
        { title: 'Launch plan', storage: 'stealth', parentId: yield* rootOf(project) },
        at(destination),
      );
      expect(plan.status).toBe(200);
      const name = (plan.body as Written).block.name;
      const seen = (cwd: string) =>
        Effect.map(world.op('search_blocks', { query: name }, at(cwd)), (answer) => (answer.body as { total: number }).total);
      yield* files.writeFileString(join(destination, 'launch.txt'), 'launch\n');
      yield* suiteGit(destination, 'add', '-A');
      yield* suiteGit(destination, 'commit', '-qm', 'launch');
      expect(yield* seen(destination)).toBe(1);
      expect(yield* seen(root)).toBe(0);

      expect((yield* world.op('merge_worktree', { rootId }, at(root))).status).toBe(200);
      expect(yield* seen(root)).toBe(1);
      expect(yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('launch-plan');
    }),
  );

  it.effect('a stealth graph moves to team keeping the named subtrees stealth, and back to stealth losing no block', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('keeping'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const parentId = yield* rootOf(project);
      const created = (input: Record<string, unknown>) =>
        Effect.map(world.op('create_block', { project, parentId, ...input }), (answer) => (answer.body as Written).block.name);
      const roadmap = yield* created({ title: 'Roadmap' });
      const deals = yield* created({ title: 'Deals' });
      const terms = yield* created({ title: 'Acme terms', parentId: deals });
      const pointer = yield* created({ title: 'Pointer', body: `see [[${deals}]]` });
      const move = (mode: string, keep?: readonly string[]) => world.op('set_project_storage', { ref: String(project), mode, keep });

      const refused = yield* move('team', [deals]);
      expect((refused.body as { code: string; reason: string }).code).toBe('stealth-dependency');
      expect((refused.body as { reason: string }).reason).toContain(pointer);
      expect((yield* world.op('update_block', { project, blockId: pointer, body: 'kept apart' })).status).toBe(200);
      expect((yield* move('team', [deals])).status).toBe(200);
      const published = yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma');
      expect([
        published.includes('roadmap'),
        published.includes('pointer'),
        published.includes('deals'),
        published.includes('acme'),
      ]).toEqual([true, true, false, false]);
      const stealthOf = (name: string) =>
        Effect.map(world.op('read_block', { project, blockIds: [name] }), (answer) =>
          JSON.stringify(answer.body).includes('"stealth":true'),
        );
      expect([yield* stealthOf(roadmap), yield* stealthOf(deals), yield* stealthOf(terms)]).toEqual([false, true, true]);

      expect((yield* move('stealth')).status).toBe(200);
      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
      const titles = yield* world.op('query_blocks', { project, sort: { by: 'created', order: 'asc' } });
      expect((titles.body as { blocks: readonly { title: string }[] }).blocks.map((row) => row.title)).toEqual(
        expect.arrayContaining(['Roadmap', 'Deals', 'Acme terms', 'Pointer']),
      );
      expect([yield* stealthOf(deals), yield* stealthOf(terms)]).toEqual([false, false]);
    }),
  );

  it.effect('a team parent removed by a commit made elsewhere leaves its stealth child standing, and Tagma writes no file for it', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('displaced'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const partner = ((yield* world.op('create_block', { project, title: 'Partner', parentId: yield* rootOf(project) })).body as Written)
        .block.name;
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const terms = yield* world.op('create_block', { project, title: 'Partner terms', parentId: partner, storage: 'stealth' });
      const child = (terms.body as Written).block.name;
      yield* world.runtime.pool.releaseProject(project);
      const seen = (name = child) =>
        Effect.map(world.op('search_blocks', { project, query: name }), (answer) => (answer.body as { total: number }).total);
      expect(yield* seen()).toBe(1);
      const tree = join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root));
      const layer = () =>
        Effect.all([suiteGit(tree, 'rev-parse', 'HEAD'), suiteGit(tree, 'status', '--porcelain', '--untracked-files=all')]);
      const before = yield* layer();

      const file = (yield* suiteGit(root, 'ls-files', '--', '.tagma')).split('\n').find((path) => path.endsWith('/partner.md'));
      expect(file).toBeDefined();
      yield* suiteGit(root, 'rm', '-q', '--', file!);
      yield* suiteGit(root, 'commit', '-qm', 'drop the partner');
      yield* world.runtime.pool.releaseProject(project);
      expect(yield* seen(partner)).toBe(0);
      expect(yield* seen()).toBe(1);
      expect((yield* world.op('read_block', { project, blockIds: [child] })).body).toMatchObject({
        reads: [{ stealth: true, displaced: true }],
      });
      expect(yield* layer()).toEqual(before);
      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    }),
  );
});
