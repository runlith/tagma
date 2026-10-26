import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { inGraphTree } from '../../../graph/contract/wire/storage.js';
import { suiteGit } from '../suiteGit.js';
import { makeDoorWorld } from '../doorFixture.js';

const REEXPORTS = { builtin: 'reexports', params: { base: '', allows: [], files: { extensions: ['.ts'], exclude: [] } } };

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('merge-base'));
  yield* files.makeDirectory(join(root, 'server'));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* files.writeFileString(
    join(root, 'tagma.config.ts'),
    `export default ${JSON.stringify({ inspections: { reexports: REEXPORTS } })};\n`,
  );
  yield* files.writeFileString(join(root, 'server', 'value.ts'), 'export const value = 1;\n');
  yield* files.writeFileString(join(root, 'server', 'shared.ts'), 'export const shared = 1;\n');
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'seed');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
  expect(added.status).toBe(200);
  const project = (added.body as { project: { id: number } }).project.id;
  expect((yield* world.op('write_setting', { project, key: 'graph.commit', value: 'manual' }, `project=${project}`)).status).toBe(200);
  return { world, project, root };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/MergeTakesBase') {}

const op = (id: string, input: unknown, cwd?: string) =>
  Effect.flatMap(Place, ({ world, project }) =>
    world.op(id, input, `project=${project}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`),
  );
const committed = Effect.fnUntraced(function* (checkout: string, message: string) {
  yield* suiteGit(checkout, 'add', '-A');
  yield* suiteGit(checkout, 'commit', '-qm', message);
});

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: '60 seconds',
})('merge takes base', (it) => {
  it.effect('a merge whose base changed the graph takes the base into the branch first and is judged by the merged graph', () =>
    Effect.gen(function* () {
      const { world, project, root } = yield* Place;
      const files = yield* FileSystem.FileSystem;
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const rule = (yield* op('create_block', { tags: ['rule'], title: 'No re-exports' })).body as { block: { name: string } };
      const gated = yield* op('enforce_rule', {
        blockId: rule.block.name,
        base: null,
        strictness: 'gate',
        inspection: 'reexports',
        on: [{ op: 'merge_worktree', phase: 'before' }],
      });
      expect(gated.status).toBe(200);
      const repository = ((yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer).repositories[0]!.binding;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'side');
      expect(
        (yield* op('prepare_worktree', {
          operationId: 'side',
          repository,
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'HEAD' },
        })).status,
      ).toBe(200);
      const created = yield* op('create_worktree', { operationId: 'side' });
      expect(created.status).toBe(200);
      const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;
      const watched = yield* op(
        'enforce_rule',
        { blockId: rule.block.name, base: (gated.body as { revision: string }).revision, strictness: 'watch' },
        destination,
      );
      expect(watched.status).toBe(200);
      expect((yield* op('sync_graph', {}, destination)).status).toBe(200);
      yield* files.writeFileString(join(destination, 'server', 'again.ts'), "export * from './value.js';\n");
      yield* committed(destination, 'the branch re-exports under its own watch');
      const tip = yield* suiteGit(destination, 'rev-parse', 'HEAD');
      const later = (yield* op('create_block', { tags: ['task'], title: 'A task main wrote after the branch parted' })).body as {
        block: { name: string };
      };
      expect((yield* op('sync_graph', {})).status).toBe(200);
      yield* files.writeFileString(join(root, 'server', 'shared.ts'), 'export const shared = 2;\n');
      yield* committed(root, 'main changes its graph and shared code');
      const mainTip = yield* suiteGit(root, 'rev-parse', 'HEAD');
      yield* files.writeFileString(join(destination, 'server', 'shared.ts'), 'export const shared = 3;\n');
      expect(yield* op('merge_worktree', { rootId })).toMatchObject({ status: 409, body: { code: 'source-dirty' } });
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(mainTip);
      const refusedTip = yield* suiteGit(destination, 'rev-parse', 'HEAD');
      expect(yield* suiteGit(destination, 'merge-base', tip, refusedTip)).toBe(tip);
      const beforeTake = (yield* suiteGit(destination, 'diff', '--name-only', tip, refusedTip)).split('\n').filter(Boolean);
      expect(beforeTake.every(inGraphTree)).toBe(true);
      yield* suiteGit(destination, 'checkout', '--', 'server/shared.ts');
      const pending = yield* op('create_block', { tags: ['task'], title: 'A task the branch has not committed yet' }, destination);
      expect(pending.status).toBe(200);
      const pendingTask = yield* Schema.decodeUnknownEffect(Schema.Struct({ block: Schema.Struct({ name: Schema.String }) }))(pending.body);
      const merged = yield* op('merge_worktree', { rootId });
      expect(merged.status).toBe(200);
      expect((merged.body as { watched?: readonly unknown[] }).watched?.length).toBe(1);
      const took = yield* suiteGit(destination, 'rev-parse', 'HEAD');
      const deliveredTip = yield* suiteGit(destination, 'rev-parse', 'HEAD^1');
      expect([yield* suiteGit(destination, 'merge-base', tip, deliveredTip), yield* suiteGit(destination, 'rev-parse', 'HEAD^2')]).toEqual([
        tip,
        mainTip,
      ]);
      const delivered = (yield* suiteGit(destination, 'diff', '--name-only', tip, deliveredTip)).split('\n').filter(Boolean);
      expect(delivered.length).toBeGreaterThan(0);
      expect(delivered.every(inGraphTree)).toBe(true);
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD^2')).toBe(took);
      expect(yield* op('search_blocks', { query: later.block.name, limit: 1 }, destination)).toMatchObject({
        status: 200,
        body: { total: 1, blocks: [{ name: later.block.name }] },
      });
      expect(yield* op('search_blocks', { query: pendingTask.block.name, limit: 1 }, root)).toMatchObject({
        status: 200,
        body: { total: 1, blocks: [{ name: pendingTask.block.name }] },
      });
    }),
  );
});
