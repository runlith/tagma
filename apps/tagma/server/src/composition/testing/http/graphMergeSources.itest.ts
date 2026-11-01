import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit, suiteGitRan } from '../suiteGit.js';

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('team graph merge', (it) => {
  it.effect('a resolved merge preserves source identities and reports mirror failures', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('merge-sources'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* suiteGit(root, 'commit', '--allow-empty', '-qm', 'code born');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const query = `project=${project}`;
      expect((yield* world.op('write_setting', { key: 'graph.commit', value: 'manual', project }, query)).status).toBe(200);
      const parentId = ((yield* world.op('list_root_blocks', {}, query)).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const conflict = yield* world.op('create_block', { title: 'Conflicting knowledge', body: 'base', parentId }, query);
      const sourced = yield* world.op('create_block', { title: 'Sourced knowledge', parentId }, query);
      expect([conflict.status, sourced.status]).toEqual([200, 200]);
      const conflictName = (conflict.body as { block: { name: string } }).block.name;
      const sourceName = (sourced.body as { block: { name: string } }).block.name;
      const graph = yield* world.runtime.pool.resolve({ projectId: project });
      const pathOf = Effect.fnUntraced(function* (name: string) {
        const id = yield* Context.get(graph.context, BlockNames).idOfName(name);
        const row = yield* Context.get(graph.context, Blocks).rawBlockById(id);
        if (row.path === null) return yield* Effect.die('the block has no file');
        return row.path;
      });
      const conflictPath = yield* pathOf(conflictName);
      const sourcePath = yield* pathOf(sourceName);
      expect((yield* world.op('sync_graph', {}, query)).status).toBe(200);
      yield* world.runtime.pool.releaseProject(project);
      const side = join(yield* files.realPath(yield* world.directory('worktrees')), 'side');
      yield* suiteGit(root, 'worktree', 'add', '-q', '-b', 'side', side);
      const relativeConflict = join('.tagma', conflictPath);
      const relativeSource = join('.tagma', sourcePath);
      const original = yield* files.readFileString(join(root, relativeConflict));
      const sourceText = yield* files.readFileString(join(root, relativeSource));
      const sources =
        'sources:\n  - kind: file\n    ref: owned.ts\n  - kind: symbol\n    ref: owned.ts\n    symbol: one\n  - kind: file\n    ref: owned.ts\n  - kind: symbol\n    ref: owned.ts\n    symbol: two\n';
      yield* files.writeFileString(join(root, relativeSource), sourceText.replace('\n---\n', `\n${sources}---\n`));
      yield* files.writeFileString(join(root, relativeConflict), original.replace('base', 'main'));
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'main knowledge');
      yield* files.writeFileString(join(side, relativeConflict), original.replace('base', 'side'));
      yield* suiteGit(side, 'add', '-A');
      yield* suiteGit(side, 'commit', '-qm', 'side knowledge');
      expect((yield* suiteGitRan(side, 'merge', '--no-edit', 'main')).success).toBe(false);
      yield* files.writeFileString(join(side, relativeConflict), original.replace('base', 'combined'));
      const resolved = yield* world.op('resolve_graph_conflict', { branch: 'side' }, query);
      expect(resolved).toMatchObject({ status: 200, body: { status: 'ok', commit: null, resolved: [relativeConflict], remaining: [] } });
      expect(yield* suiteGit(side, 'diff', '--name-only', '--diff-filter=U')).toBe('');
      expect(yield* suiteGit(side, 'rev-parse', '--verify', 'MERGE_HEAD')).toMatch(/^[0-9a-f]{40}$/);
      const read = yield* world.op('read_block', { blockIds: [sourceName], depth: 0 }, `${query}&branch=side`);
      expect(read.status).toBe(200);
      const shown = (read.body as { reads: { sources: { kind: string; ref: string; symbol: string | null }[] }[] }).reads[0]!.sources;
      const expected = [
        { kind: 'file', ref: 'owned.ts', symbol: null },
        { kind: 'symbol', ref: 'owned.ts', symbol: 'one' },
        { kind: 'symbol', ref: 'owned.ts', symbol: 'two' },
      ];
      expect(shown.map(({ kind, ref, symbol }) => ({ kind, ref, symbol }))).toEqual(expected);
      const sourceFile = join(side, relativeSource);
      yield* files.writeFileString(sourceFile, `${sourceText.replace('\n---\n', `\n${sources}---\n`)}after repair\n`);
      expect(yield* world.op('resolve_graph_conflict', { branch: 'side' }, query)).toMatchObject({
        status: 200,
        body: { status: 'ok', resolved: [] },
      });
      const refreshed = yield* world.op('read_block', { blockIds: [sourceName], depth: 0 }, `${query}&branch=side`);
      expect(refreshed).toMatchObject({ status: 200, body: { reads: [{ body: 'after repair\n', sources: expected }] } });
      const target = original.match(/^id: (.+)$/m)?.[1];
      if (target === undefined) return yield* Effect.die('the conflict file has no identity');
      const edge = `edges:\n  - kind: supersedes\n    to: ${target}\n`;
      yield* files.writeFileString(join(side, relativeConflict), original.replace('\n---\n', `\n${edge}---\n`).replace('base', 'combined'));
      yield* files.writeFileString(sourceFile, sourceText.replace('\n---\n', `\n${edge}${sources}---\n`));
      const refused = yield* world.op('resolve_graph_conflict', { branch: 'side' }, query);
      expect(refused).toMatchObject({
        status: 409,
        body: { code: 'graph-pool', reason: expect.stringContaining('UNIQUE constraint failed') },
      });
    }),
  );
});
