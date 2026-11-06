import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { kind, shared } from '@runlith/testbed/worlds';
import { Clock, Context, Effect, FileSystem, Schema } from 'effect';
import { dirname, join } from 'node:path';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { ServingGit } from '../../../executions/contract/service/git.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { lineWrites } from '../../lineWrites.js';
import { makeDoorWorld } from '../doorFixture.js';
import { git, makeThreadDoors } from '../threadDoors.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { holdThreads } from '../threadScope.js';

type Options = {
  readonly tools?: readonly string[];
  readonly models?: (standing: ModelAccess['Service']) => ModelAccess['Service'];
  readonly own?: string;
};

class RepositorySeed extends Context.Service<RepositorySeed, { readonly root: string }>()('testing/LandingRepositorySeed') {}

const repositories = kind(RepositorySeed, (_params: {}, home) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(home, { recursive: true });
    yield* git(home, 'init', '-q', '-b', 'main');
    return RepositorySeed.of({ root: home });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

export const seedRepository = Effect.fn('landing.seedRepository')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const seed = yield* shared(repositories, {});
  yield* files.copy(seed.root, root, { overwrite: true });
});

export const nativeLanding = Effect.fnUntraced(function* (committed: Readonly<Record<string, string>>, options: Options = {}) {
  const world = yield* makeDoorWorld({ models: options.models, own: options.own });
  yield* holdThreads(world);
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('checkout'));
  yield* seedRepository(root);
  for (const [path, text] of Object.entries(committed)) {
    yield* files.makeDirectory(dirname(join(root, path)), { recursive: true });
    yield* files.writeFileString(join(root, path), text);
  }
  yield* git(root, 'add', ...Object.keys(committed));
  yield* git(root, 'commit', '-qm', 'base');
  const made = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
  const projectId = (made.body as { project: { id: number } }).project.id;
  const doors = makeThreadDoors(
    {
      ...world,
      runtime: {
        ...world.runtime,
        owners: Context.add(world.runtime.owners, ServingGit, ServingGit.of({ run: (_act, platform) => Effect.succeed(platform) })),
      },
    },
    projectId,
    options.tools ?? ['submit_work'],
  );
  const born = Effect.fnUntraced(function* (parent?: string) {
    const input = parent === undefined ? { approvalMode: 'trust' } : { parent, task: '' };
    const response = yield* world.op('create_thread', input, `project=${projectId}`);
    const {
      snapshot: { thread },
    } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(response.body);
    return yield* doors.doorsFor(thread.id, thread.ownerId);
  });
  const record = Context.get(world.runtime.owners, ChangeRecord);
  const write = Effect.fnUntraced(function* (threadId: string, path: string, after: string | null) {
    const at = join(root, path);
    const before = (yield* files.exists(at)) ? yield* files.readFileString(at) : null;
    expect(
      yield* record.land(
        { work: { projectId, threadId } },
        [
          {
            path: at,
            origin: after === null ? 'delete' : before === null ? 'write' : 'edit',
            before: before === null ? undefined : contentDigest(before),
            after: after === null ? undefined : contentDigest(after),
            beforeText: before ?? undefined,
            afterText: after ?? undefined,
            hunk: workspaceChangeHunk(before ?? '', after ?? ''),
            at: new Date(yield* Clock.currentTimeMillis),
          },
        ],
        lineWrites.replace({ root, path, before, after }, Effect.succeed(true)),
      ),
    ).toMatchObject({ _tag: 'written', kept: true });
  });
  const read = Effect.fnUntraced(function* (path: string) {
    const result = yield* spawnedEffect(['git', 'show', `HEAD:${path}`], { cwd: root });
    expect(result.exitCode).toBe(0);
    return new TextDecoder().decode(result.stdout);
  });
  return { world, files, root, projectId, doors, born, write, read };
});
