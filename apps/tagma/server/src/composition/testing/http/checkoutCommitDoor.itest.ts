import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { workspaceChange } from '../../../change-record/testing/doubles.js';
import type { CommitLocations, CommitReading } from '../../../workspace/contract/wire/history.js';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const git = Effect.fnUntraced(function* (cwd: string, ...args: readonly string[]) {
  const ran = yield* spawnedEffect(['git', '-c', 'user.name=suite', '-c', 'user.email=suite@tagma', ...args], { cwd });
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${cwd}: ${ran.stderr.toString()}`));
  return ran.stdout.toString().trim();
});
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('commit-checkout'));
  const projectId = yield* world.stealthProject(root);
  yield* projectLeaving(world, projectId);
  yield* files.writeFileString(join(root, 'moving.txt'), 'moved\n');
  yield* files.writeFileString(join(root, 'kept.txt'), 'one\n');
  yield* git(root, 'add', '-A');
  yield* git(root, 'commit', '-qm', 'born');
  yield* git(root, 'mv', 'moving.txt', 'moved.txt');
  yield* files.writeFileString(join(root, 'kept.txt'), 'one\ntwo\nthree\n');
  yield* files.writeFileString(join(root, 'added.txt'), 'a\nb\n');
  yield* git(root, 'add', '-A');
  yield* git(root, 'commit', '-qm', 'three changes');
  const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const covered = coverage.roots.find((row) => row.path === root);
  if (covered === undefined) return yield* Effect.die(new Error(`the coverage of project ${projectId} answered no root for ${root}`));
  return { world, projectId, rootId: covered.rootId, sha: yield* git(root, 'rev-parse', 'HEAD') };
});
class Commit extends Context.Service<Commit, Effect.Success<typeof setup>>()('testing/Commit') {}
const reading = (projectId: number, rootId: RootId, query: Record<string, string | number>) =>
  Effect.flatMap(Commit, ({ world }) =>
    Effect.map(world.op('read_commit', { root: rootId, ...query }, `project=${projectId}`), (answered) =>
      answered.status === 200 ? { ...answered, body: (answered.body as { commit: CommitReading }).commit } : answered,
    ),
  );

layer(Layer.effect(Commit, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('commit HTTP door', (it) => {
  it.effect("the door reads one commit's paths from its first parent with renames paired, and pages them on the sha it pinned", () =>
    Effect.gen(function* () {
      const { projectId, rootId, sha } = yield* Commit;
      const whole = (yield* reading(projectId, rootId, { commit: 'HEAD' })).body as CommitReading;
      expect(whole.sha).toBe(sha);
      expect(whole.subject).toBe('three changes');
      expect(whole.author).toBe('suite');
      expect(whole.files.map((file) => [file.status, file.path, file.oldPath ?? null, file.lines])).toEqual([
        ['added', 'added.txt', null, { added: 2, removed: 0 }],
        ['modified', 'kept.txt', null, { added: 2, removed: 0 }],
        ['renamed', 'moved.txt', 'moving.txt', { added: 0, removed: 0 }],
      ]);
      expect([whole.added, whole.removed, whole.changed, whole.total, whole.next]).toEqual([4, 0, 3, 3, null]);
      const first = (yield* reading(projectId, rootId, { commit: sha.slice(0, 10), limit: 2 })).body as CommitReading;
      expect(first.files.map((file) => file.path)).toEqual(['added.txt', 'kept.txt']);
      expect([first.shown, first.total, first.complete]).toEqual([2, 3, true]);
      expect(first.next).not.toBeNull();
      const rest = (yield* reading(projectId, rootId, { commit: sha, limit: 2, cursor: first.next ?? '' })).body as CommitReading;
      expect(rest.files.map((file) => file.path)).toEqual(['moved.txt']);
      expect(rest.next).toBeNull();
      const moved = yield* reading(projectId, rootId, { commit: 'HEAD~1', limit: 2, cursor: first.next ?? '' });
      expect(moved.status).toBe(409);
      expect((moved.body as RefusalBody).code).toBe('cursor-stale');
      const garbled = yield* reading(projectId, rootId, { commit: sha, cursor: 'not a cursor' });
      expect(garbled.status).toBe(409);
      expect((garbled.body as RefusalBody).code).toBe('bad-cursor');
      const nowhere = yield* reading(projectId, rootId, { commit: 'no-such-revision' });
      expect(nowhere.status).toBe(409);
      expect((nowhere.body as RefusalBody).code).toBe('not-found');
    }),
  );
  it.effect('commit ids are located in the stores of the projects holding them, and an id no store holds is left out', () =>
    Effect.gen(function* () {
      const { world, projectId, sha } = yield* Commit;
      const files = yield* FileSystem.FileSystem;
      const other = yield* files.realPath(yield* world.directory('commit-elsewhere'));
      const otherId = yield* world.stealthProject(other);
      yield* projectLeaving(world, otherId);
      yield* files.writeFileString(join(other, 'far.txt'), 'far\n');
      yield* git(other, 'add', '-A');
      yield* git(other, 'commit', '-qm', 'far away');
      const far = yield* git(other, 'rev-parse', 'HEAD');
      const located = yield* world.op('locate_commits', { commits: [far.slice(0, 10), sha, 'f'.repeat(40)] }, `project=${projectId}`);
      expect(located.status).toBe(200);
      expect((located.body as CommitLocations).commits).toEqual([
        { id: far.slice(0, 10), sha: far, subject: 'far away', projectId: otherId },
        { id: sha, sha, subject: 'three changes', projectId },
      ]);
    }),
  );
  it.effect('a thread narrows the commit to the paths its record was stamped with, while changed still counts the whole commit', () =>
    Effect.gen(function* () {
      const { world, projectId, rootId, sha } = yield* Commit;
      const store = Context.get(world.runtime.graph, MachineStore);
      const at = new Date(yield* Clock.currentTimeMillis);
      const row = (threadId: string, path: string, commit: string) => ({
        projectId,
        holderProjectId: projectId,
        holder: threadId,
        checkout: rootId,
        path,
        state: 'committed' as const,
        origin: 'edit' as const,
        afterHash: path,
        at,
        commit,
        committedAt: at,
      });
      yield* store.db
        .insert(workspaceChange())
        .values([
          row('thread-one', 'kept.txt', sha),
          row('thread-two', 'added.txt', sha),
          row('thread-one', 'added.txt', 'f'.repeat(40)),
          row('thread-three', 'moving.txt', sha),
        ]);
      const narrowed = (yield* reading(projectId, rootId, { commit: sha, thread: 'thread-one' })).body as CommitReading;
      expect(narrowed.files.map((file) => file.path)).toEqual(['kept.txt']);
      expect([narrowed.total, narrowed.changed, narrowed.added, narrowed.removed]).toEqual([1, 3, 2, 0]);
      const renamed = (yield* reading(projectId, rootId, { commit: sha, thread: 'thread-three' })).body as CommitReading;
      expect(renamed.files.map((file) => [file.path, file.oldPath])).toEqual([['moved.txt', 'moving.txt']]);
      const none = (yield* reading(projectId, rootId, { commit: sha, thread: 'thread-none' })).body as CommitReading;
      expect([none.files, none.total, none.changed]).toEqual([[], 0, 3]);
    }),
  );
});
