import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { LAYERED, LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { seedRepository } from './native.js';

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('twin-project'));
  yield* seedRepository(root);
  const write = Effect.fnUntraced(function* (base: string, path: string, text: string) {
    yield* files.makeDirectory(join(base, path, '..'), { recursive: true });
    yield* files.writeFileString(join(base, path), text);
  });
  yield* write(root, 'tagma.config.ts', `export default ${JSON.stringify({ inspections: { [LAYERED_KEY]: LAYERED } })};\n`);
  yield* write(root, 'src/core/model.ts', 'export const model = 1;\n');
  yield* write(root, 'src/app/main.ts', "import { model } from '../core/model.js';\nexport const main = model;\n");
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'seed');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
  expect(added.status).toBe(200);
  const project = (added.body as { project: { id: number } }).project.id;
  const op = (id: string, input: unknown, cwd?: string) =>
    world.op(id, input, `project=${project}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`);
  const ok = Effect.fnUntraced(function* (id: string, input: unknown, cwd?: string) {
    const answered = yield* op(id, input, cwd);
    if (answered.status !== 200) return yield* Effect.die(new Error(`${id} refused: ${JSON.stringify(answered.body)}`));
    return answered.body;
  });
  const parent = ((yield* ok('list_root_blocks', {})) as { blocks: { name: string }[] }).blocks[0]!.name;
  yield* ok('set_module', {
    modules: [
      { id: 'core', title: 'Core', parent, root: 'src/core', entries: { put: [{ at: 'model.ts' }] } },
      { id: 'app', title: 'App', parent, root: 'src/app', imports: { put: ['core'] } },
    ],
  });
  const created = (yield* ok('create_block', { tags: ['rule'], title: 'Modules import along relations', parentId: parent })) as {
    block: { name: string };
  };
  yield* ok('enforce_rule', {
    blockId: created.block.name,
    base: null,
    strictness: 'gate',
    inspection: LAYERED_KEY,
    on: [{ op: 'merge_worktree', phase: 'before' }],
  });
  const repository = ((yield* ok('read_repositories', {})) as CoveredRepositoriesAnswer).repositories[0]!.binding;
  return { world, files, root, project, parent, repository, op, ok, write };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/MergeTwins') {}

layer(Layer.effect(Place, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('merge into a stealth project', (it) => {
  it.effect(
    'a branch whose graph twin adds a module card merges after the base twin, which moved on with its own graph commit, is brought into it',
    () =>
      Effect.gen(function* () {
        const { world, files, root, project, parent, repository, op, ok, write } = yield* Place;
        const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'extra');
        yield* ok('prepare_worktree', {
          operationId: 'extra',
          repository,
          destination,
          mode: { kind: 'new-branch', branch: 'extra', start: 'HEAD' },
        });
        const made = (yield* ok('create_worktree', { operationId: 'extra' })) as { operation: { rootId: string } };

        yield* write(destination, 'src/extra/extra.ts', 'export const extra = 1;\n');
        yield* write(
          destination,
          'src/app/main.ts',
          "import { model } from '../core/model.js';\nimport { extra } from '../extra/extra.js';\nexport const main = model + extra;\n",
        );
        yield* ok(
          'set_module',
          {
            modules: [
              { id: 'extra', title: 'Extra', parent, root: 'src/extra', entries: { put: [{ at: 'extra.ts' }] } },
              { id: 'app', imports: { put: ['extra'] } },
            ],
          },
          destination,
        );
        yield* suiteGit(destination, 'add', '-A');
        yield* suiteGit(destination, 'commit', '-qm', 'an extra module');

        yield* ok('create_block', { title: 'The base moved on', parentId: parent });
        yield* write(root, 'src/core/more.ts', 'export const more = 1;\n');
        yield* suiteGit(root, 'add', '-A');
        yield* suiteGit(root, 'commit', '-qm', 'the base moves on');

        const merged = yield* op('merge_worktree', { rootId: made.operation.rootId });
        expect(merged).toMatchObject({ status: 200, body: { status: 'merged' } });
        expect(yield* suiteGit(root, 'show', 'HEAD:src/extra/extra.ts')).toBe('export const extra = 1;');
        const seen = (yield* ok('search_blocks', { query: 'The base moved on' }, destination)) as { blocks: unknown[] };
        expect(seen.blocks.length).toBeGreaterThan(0);
      }),
  );
});
