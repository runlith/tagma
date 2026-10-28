import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { CHECKOUT_DIRECTORY, FORMAT_FILE } from '../../../graph/contract/wire/storage.js';
import { GRAPH_STEPS } from '../../../graph/steps/sequence.js';
import { markerText } from '../../../graph/tree/marker.js';

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('graph format in detached copies', (it) => {
  it.effect('a detached caller reads its upgraded graph without changing the checkout, and every graph write refuses', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('format-project'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* suiteGit(root, 'commit', '--allow-empty', '-qm', 'code born');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      const op = (id: string, input: unknown, cwd = root) => world.op(id, input, `project=${project}&cwd=${encodeURIComponent(cwd)}`);
      expect((yield* op('write_setting', { key: 'graph.commit', value: 'manual', project })).status).toBe(200);
      const parentId = ((yield* op('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const made = yield* op('create_block', { title: 'Shared knowledge', body: 'branch knowledge', parentId });
      expect(made.status).toBe(200);
      const name = (made.body as { block: { name: string } }).block.name;
      expect((yield* op('sync_graph', {})).status).toBe(200);
      yield* world.runtime.pool.releaseProject(project);
      yield* files.writeFileString(join(root, CHECKOUT_DIRECTORY, FORMAT_FILE), markerText(GRAPH_STEPS.at(-2)!.id));
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'the previous graph format');
      const tip = yield* suiteGit(root, 'rev-parse', 'HEAD');
      const detached = join(yield* files.realPath(yield* world.directory('copies')), 'detached');
      yield* suiteGit(root, 'worktree', 'add', '--detach', detached, tip);
      expect(yield* op('read_block', { blockIds: [name] }, detached)).toMatchObject({
        status: 200,
        body: { reads: [{ name, body: 'branch knowledge' }] },
      });
      for (const [id, input] of [
        ['create_block', { title: 'Cannot be written here', parentId }],
        ['rewrite_graph_files', {}],
        ['sync_graph', {}],
        ['resolve_graph_conflict', {}],
      ] as const) {
        expect(yield* op(id, input, detached)).toMatchObject({ status: 409, body: { code: 'detached-checkout' } });
      }
      expect(yield* suiteGit(detached, 'status', '--porcelain')).toBe('');
      expect(yield* suiteGit(detached, 'rev-parse', 'HEAD')).toBe(tip);
    }),
  );

  it.effect('a detached stealth place shares the live main graph and cannot write it', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('stealth'));
      const project = yield* world.stealthProject(root);
      yield* suiteGit(root, 'commit', '--allow-empty', '-qm', 'code born');
      const op = (id: string, input: unknown, cwd = root) => world.op(id, input, `project=${project}&cwd=${encodeURIComponent(cwd)}`);
      const parentId = ((yield* op('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const made = yield* op('create_block', { title: 'Canonical knowledge', parentId });
      expect(made.status).toBe(200);
      const name = (made.body as { block: { name: string } }).block.name;
      const detached = join(yield* files.realPath(yield* world.directory('stealth-copies')), 'detached');
      yield* suiteGit(root, 'worktree', 'add', '--detach', detached, 'HEAD');
      expect((yield* op('read_block', { blockIds: [name] }, detached)).status).toBe(200);
      const later = yield* op('create_block', { title: 'Main wrote this after the detached read', parentId });
      expect(later.status).toBe(200);
      const laterName = (later.body as { block: { name: string } }).block.name;
      expect((yield* op('read_block', { blockIds: [laterName] }, detached)).status).toBe(200);
      expect(yield* op('rewrite_graph_files', {}, detached)).toMatchObject({
        status: 409,
        body: { code: 'detached-checkout' },
      });
      expect(world.runtime.pool.held().filter((copy) => copy.projectId === project)).toMatchObject([{ checkout: root }]);
      expect(yield* suiteGit(detached, 'status', '--porcelain')).toBe('');
    }),
  );
});
