import { expect } from 'bun:test';
import { basename, dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

type Answer = { readonly status: number; readonly body: unknown };

const projectOf = (answer: Answer) => (answer.body as { project: { id: number; name: string } }).project;
const blockOf = (answer: Answer) => (answer.body as { block: { name: string } }).block.name;

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('project rename', (it) => {
  it.effect(
    'a renamed project answers to its new name with its graph, worktree copy, mirrors, graph remote and threads where they stood, also once its graphs open again',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const root = yield* world.directory('renamed');
        yield* suiteGit(root, 'init', '-q', '-b', 'main');
        yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'base');
        const added = projectOf(yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' }));
        yield* projectLeaving(world, added.id);
        const kept = blockOf(yield* world.op('create_block', { tags: ['idea'], title: 'Kept on main' }, `project=${added.id}`));
        const feature = join(dirname(root), `${basename(root)}-feature`);
        yield* suiteGit(root, 'worktree', 'add', '-q', '-b', 'feature', feature);
        const branched = blockOf(
          yield* world.op('create_block', { tags: ['idea'], title: 'Kept on the branch' }, `project=${added.id}&branch=feature`),
        );
        const bare = yield* world.directory('remote');
        yield* suiteGit(bare, 'init', '-q', '--bare');
        expect((yield* world.op('set_graph_remote', { ref: String(added.id), remote: bare })).status).toBe(200);
        const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${added.id}`);
        const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
        const main = yield* world.runtime.pool.resolve({ projectId: added.id });
        const branch = yield* world.runtime.pool.resolve({ projectId: added.id, branch: 'feature' });

        const name = world.uniqueName();
        expect(yield* world.op('update_project', { ref: added.name, name })).toMatchObject({
          status: 200,
          body: { project: { id: added.id, name } },
        });
        expect(yield* world.op('read_project', { ref: added.name })).toMatchObject({ body: { code: 'unknown-project' } });
        const standing = Effect.gen(function* () {
          const title = (block: string, lens: string) =>
            Effect.map(
              world.op('read_block', { blockIds: [block] }, lens),
              (answer) => (answer.body as { reads: { title: string }[] }).reads[0]?.title,
            );
          expect(yield* title(kept, `project=${name}`)).toBe('Kept on main');
          expect(yield* title(branched, `project=${name}&branch=feature`)).toBe('Kept on the branch');
          expect((yield* world.op('read_graph_remote', { ref: name })).body).toMatchObject({
            remote: { remote: bare, holds: 'this-graph' },
          });
          expect((yield* world.op('list_threads', { ids: [threadId], shape: 'rows' }, `project=${name}`)).body).toMatchObject({
            rows: [expect.anything()],
          });
          const reopened = yield* world.runtime.pool.resolve({ projectId: added.id });
          const copy = yield* world.runtime.pool.resolve({ projectId: added.id, branch: 'feature' });
          expect([reopened.layout, copy.layout]).toEqual([main.layout, branch.layout]);
        });
        yield* standing;
        yield* world.runtime.pool.releaseProject(added.id);
        yield* standing;
      }),
  );

  it.effect(
    'a removed project frees its name: another project takes it, and the removed one comes back under the name add_project asks for',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const name = world.uniqueName();
        const first = yield* world.directory('first');
        yield* suiteGit(first, 'init', '-q', '-b', 'main');
        const removed = projectOf(yield* world.op('add_project', { name, rootPath: first, storage: 'stealth' }));
        const kept = blockOf(yield* world.op('create_block', { tags: ['idea'], title: 'Kept while removed' }, `project=${removed.id}`));
        expect((yield* world.op('remove_project', { ref: name })).status).toBe(200);

        const second = yield* world.directory('second');
        yield* suiteGit(second, 'init', '-q', '-b', 'main');
        const taken = yield* world.op('add_project', { name, rootPath: second, storage: 'stealth' });
        expect(taken).toMatchObject({ status: 200, body: { project: { name }, returned: false } });
        expect((yield* world.op('read_block', { blockIds: [kept] }, `project=${name}`)).status).not.toBe(200);
        const back = world.uniqueName();
        expect(yield* world.op('add_project', { name: back, rootPath: first })).toMatchObject({
          status: 200,
          body: { project: { id: removed.id, name: back }, returned: true },
        });
        yield* projectLeaving(world, projectOf(taken).id, removed.id);
        expect((yield* world.op('read_block', { blockIds: [kept] }, `project=${back}`)).body).toMatchObject({
          reads: [{ title: 'Kept while removed' }],
        });
      }),
  );
});
