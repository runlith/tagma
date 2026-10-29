import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { lineWrites } from '../../lineWrites.js';
import { makeDoorWorld } from '../doorFixture.js';
import { git, makeThreadDoors } from '../threadDoors.js';
import { seedRepository } from './native.js';

it.live('submit_work carries a holder’s lines without attributing that holder’s undeclared tasks', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld();
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* world.directory('checkout'));
    const base = 'export const value = 1;\n';
    yield* files.writeFileString(join(root, 'shared.ts'), base);
    yield* seedRepository(root);
    yield* git(root, 'add', 'shared.ts');
    yield* git(root, 'commit', '-qm', 'base');
    const made = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
    const projectId = (made.body as { project: { id: number } }).project.id;
    const doors = makeThreadDoors(world, projectId, ['submit_work']);
    const born = Effect.fnUntraced(function* () {
      const response = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${projectId}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(response.body);
      return yield* doors.doorsFor(thread.id, thread.ownerId);
    });
    const holder = yield* born();
    const lander = yield* born();
    const parentId = ((yield* world.op('list_root_blocks', {}, `project=${projectId}`)).body as { blocks: { name: string }[] }).blocks[0]!
      .name;
    const created = yield* world.op('create_block', { tags: ['task'], title: 'Holder work', parentId }, `project=${projectId}`);
    const task = (created.body as { block: { name: string } }).block.name;
    const claim = () => world.op('claim_block', { blockId: task }, `project=${projectId}`, { [GRANT_HEADER]: holder.grant });
    const claimed = yield* claim();
    expect(claimed.status === 200 ? claimed : yield* claim()).toMatchObject({ status: 200 });

    const after = 'export const value = 2;\n';
    expect(
      yield* Context.get(world.runtime.owners, ChangeRecord).land(
        { work: { projectId, threadId: holder.threadId } },
        [
          {
            path: join(root, 'shared.ts'),
            origin: 'edit',
            before: contentDigest(base),
            after: contentDigest(after),
            beforeText: base,
            afterText: after,
            hunk: workspaceChangeHunk(base, after),
            at: new Date(yield* Clock.currentTimeMillis),
          },
        ],
        lineWrites.replace({ root, path: 'shared.ts', before: base, after }, Effect.succeed(true)),
      ),
    ).toMatchObject({ _tag: 'written', kept: true });

    const submitted = yield* doors.atNative('submit_work', { subject: 'land everything', paths: ['.'], whole: ['.'] }, lander);
    expect(submitted).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          subject: 'land everything',
          committed: ['shared.ts'],
          carried: [{ path: 'shared.ts', holders: [holder.threadId] }],
        },
      },
    });
    if (submitted.class === 'answer') expect((submitted.value as { submitted: { tasks?: unknown } }).submitted.tasks).toBeUndefined();
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
