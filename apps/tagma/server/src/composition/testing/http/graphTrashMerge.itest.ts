import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { FORMAT_FILE } from '../../../graph/contract/wire/storage.js';
import { GRAPH_STEPS } from '../../../graph/steps/sequence.js';
import { markerText } from '../../../graph/tree/marker.js';
import { readBlockTree, writeBlockTree } from '../../../graph/tree/layout.js';

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('trash through graph adoption', (it) => {
  it.effect('unresolved edges remain subject to retagging, arriving targets and cross-graph moves', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const sourceRoot = yield* files.realPath(yield* world.directory('unbound-source'));
      const targetRoot = yield* files.realPath(yield* world.directory('unbound-target'));
      const source = yield* world.stealthProject(sourceRoot);
      const target = yield* world.stealthProject(targetRoot);
      yield* projectLeaving(world, source, target);
      const op = (project: number, id: string, input: unknown) => world.op(id, input, `project=${project}`);
      const sourceParent = ((yield* op(source, 'list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const targetParent = ((yield* op(target, 'list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const made = yield* op(source, 'create_block', { title: 'Arriving target', parentId: sourceParent });
      expect(made.status).toBe(200);
      const name = (made.body as { block: { name: string } }).block.name;
      const sourceTree = (yield* world.runtime.pool.resolve({ projectId: source })).layout.treeRoot;
      const targetTree = (yield* world.runtime.pool.resolve({ projectId: target })).layout.treeRoot;
      const uuid = (yield* readBlockTree(sourceTree)).find((row) => row.frontmatter.title === 'Arriving target')!.frontmatter.id;
      const holder = '0198ffff-0000-7000-8000-10000000a001';
      const holderName = holder.replaceAll('-', '');
      const unknown = '0198ffff-0000-7000-8000-10000000b002';
      const predecessor = '0198ffff-0000-7000-8000-10000000c003';
      yield* world.runtime.pool.releaseProject(target);
      const initial = yield* readBlockTree(targetTree);
      yield* writeBlockTree(targetTree, [
        ...initial,
        {
          parentId: initial.find((row) => row.parentId === null)!.frontmatter.id,
          frontmatter: {
            id: holder,
            title: 'Unresolved holder',
            ord: 2,
            tags: ['task'],
            fields: { status: 'open' },
            edges: [{ kind: 'waits-on', to: uuid }],
          },
          body: '',
        },
      ]);
      expect(yield* op(target, 'read_block', { blockIds: [holderName] })).toMatchObject({ status: 200 });
      expect(yield* op(target, 'update_block', { blockId: holderName, tags: [] })).toMatchObject({
        status: 409,
        body: { code: 'edge-undeclared' },
      });
      expect((yield* op(target, 'unlink_blocks', { fromId: holderName, kind: 'waits-on', toId: uuid.replaceAll('-', '') })).status).toBe(
        200,
      );
      expect((yield* op(target, 'update_block', { blockId: holderName, tags: [] })).status).toBe(200);
      const linked = (yield* readBlockTree(targetTree)).map((row) =>
        row.frontmatter.id === holder ? { ...row, frontmatter: { ...row.frontmatter, edges: [{ kind: 'relates', to: uuid }] } } : row,
      );
      yield* world.runtime.pool.releaseProject(target);
      yield* writeBlockTree(targetTree, linked);
      expect(yield* op(target, 'read_block', { blockIds: [holderName] })).toMatchObject({ status: 200 });
      expect((yield* op(source, 'update_block', { blockId: name, parentId: `${target}/${targetParent}` })).status).toBe(200);
      expect(yield* op(target, 'read_block', { blockIds: [holderName], depth: 0 })).toMatchObject({
        status: 200,
        body: { reads: [{ edgesOut: [{ kind: 'relates', toName: name }] }] },
      });
      const carrying = (yield* readBlockTree(targetTree)).map((row) =>
        row.frontmatter.id === holder
          ? {
              ...row,
              frontmatter: { ...row.frontmatter, edges: [...(row.frontmatter.edges ?? []), { kind: 'discovered-from', to: unknown }] },
            }
          : row,
      );
      yield* world.runtime.pool.releaseProject(target);
      yield* writeBlockTree(targetTree, carrying);
      expect((yield* op(target, 'update_block', { blockId: holderName, parentId: `${source}/${sourceParent}` })).status).toBe(200);
      expect(yield* op(source, 'read_block', { blockIds: [holderName], depth: 0 })).toMatchObject({
        status: 200,
        body: {
          reads: [
            {
              edgesOut: expect.arrayContaining([
                expect.objectContaining({ kind: 'discovered-from', toIdentity: unknown.replaceAll('-', '') }),
              ]),
            },
          ],
        },
      });
      expect((yield* op(source, 'update_block', { blockId: holderName, parentId: `${target}/${targetParent}` })).status).toBe(200);
      const returned = yield* readBlockTree(targetTree);
      expect(returned.find((row) => row.frontmatter.id === holder)?.frontmatter.edges).toContainEqual({
        kind: 'discovered-from',
        to: unknown,
      });
      const boundary = returned.map((row) =>
        row.frontmatter.id === holder
          ? {
              ...row,
              frontmatter: { ...row.frontmatter, edges: [...(row.frontmatter.edges ?? []), { kind: 'supersedes', to: predecessor }] },
            }
          : row,
      );
      yield* world.runtime.pool.releaseProject(target);
      yield* writeBlockTree(targetTree, boundary);
      expect(yield* op(target, 'update_block', { blockId: holderName, parentId: `${source}/${sourceParent}` })).toMatchObject({
        status: 409,
        body: { code: 'relocation-shape' },
      });
    }),
  );

  it.effect('a merged branch brought to the current format retains incoming edges when their target is restored', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('trash-merge'));
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      yield* suiteGit(root, 'commit', '--allow-empty', '-qm', 'code born');
      const op = (id: string, input: unknown, cwd = root) => world.op(id, input, `project=${project}&cwd=${encodeURIComponent(cwd)}`);
      const parentId = ((yield* op('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const target = yield* op('create_block', { title: 'Restorable knowledge', parentId });
      expect(target.status).toBe(200);
      const targetName = (target.body as { block: { name: string } }).block.name;
      const holder = yield* op('create_block', {
        title: 'Related knowledge',
        parentId,
        edges: [{ kind: 'relates', to: targetName }],
      });
      expect(holder.status).toBe(200);
      const holderName = (holder.body as { block: { name: string } }).block.name;
      expect((yield* op('delete_block', { blockId: targetName })).status).toBe(200);
      const side = join(yield* files.realPath(yield* world.directory('trash-copies')), 'side');
      yield* suiteGit(root, 'worktree', 'add', '-q', '-b', 'side', side);
      expect((yield* op('read_block', { blockIds: [holderName] }, side)).status).toBe(200);
      const branch = yield* world.runtime.pool.resolve({ projectId: project, cwd: side });
      const tree = branch.layout.treeRoot;
      yield* world.runtime.pool.releaseProject(project);
      yield* files.writeFileString(join(tree, FORMAT_FILE), markerText(GRAPH_STEPS.at(-2)!.id));
      yield* suiteGit(tree, 'add', '-A');
      yield* suiteGit(tree, 'commit', '-qm', 'branch uses the previous graph format');
      yield* files.writeFileString(join(side, 'feature.txt'), 'feature\n');
      yield* suiteGit(side, 'add', 'feature.txt');
      yield* suiteGit(side, 'commit', '-qm', 'feature code');
      yield* suiteGit(root, 'merge', '--no-ff', '-qm', 'merge side', 'side');
      expect((yield* op('read_block', { blockIds: [holderName] })).status).toBe(200);
      expect((yield* op('read_graph_recovery', {})).body).toMatchObject({ recovery: null });
      expect((yield* op('restore_block', { blockId: targetName })).status).toBe(200);
      expect(yield* op('read_block', { blockIds: [holderName], depth: 0 })).toMatchObject({
        status: 200,
        body: { reads: [{ edgesOut: [{ kind: 'relates', toName: targetName }] }] },
      });
    }),
  );
});
