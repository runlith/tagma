import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { ServingGit } from '../../../executions/contract/service/git.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { git, makeThreadDoors } from '../threadDoors.js';

it.live('submit_work lands the first commit without an unjudged opening measurement', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld();
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* world.directory('unborn'));
    yield* git(root, 'init', '-q', '-b', 'main');
    yield* files.writeFileString(join(root, 'source.ts'), 'export const value = 1;\n');
    const made = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
    expect(made.status).toBe(200);
    const projectId = (made.body as { project: { id: number } }).project.id;
    yield* projectLeaving(world, projectId);
    const created = yield* world.op('create_thread', { approvalMode: 'trust' }, `project=${projectId}`);
    const {
      snapshot: { thread },
    } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body);
    const doors = makeThreadDoors(
      {
        ...world,
        runtime: {
          ...world.runtime,
          owners: Context.add(world.runtime.owners, ServingGit, ServingGit.of({ run: (_act, platform) => Effect.succeed(platform) })),
        },
      },
      projectId,
      ['submit_work'],
    );
    const caller = yield* doors.doorsFor(thread.id, thread.ownerId);
    const answer = yield* doors.atNative('submit_work', { checkout: root, paths: ['.'], subject: 'first commit', tasks: [] }, caller);
    expect(answer).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed', committed: ['source.ts'] } } });
    if (answer.class === 'answer') {
      expect((answer.value as { submitted: { unjudged?: readonly unknown[] } }).submitted.unjudged ?? []).toEqual([]);
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
