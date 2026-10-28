import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { PathHistory } from '../../../workspace/contract/wire/history.js';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { suiteGit } from '../suiteGit.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';

const checkout = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('history-checkout'));
  const projectId = yield* world.stealthProject(root);
  yield* files.writeFileString(join(root, 'kept.txt'), 'one\n');
  yield* files.writeFileString(join(root, 'other.txt'), 'alpha\n');
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'born');
  yield* files.writeFileString(join(root, 'kept.txt'), 'two\n');
  yield* suiteGit(root, 'commit', '-qam', 'kept again');
  yield* files.writeFileString(join(root, 'other.txt'), 'beta\n');
  yield* suiteGit(root, 'commit', '-qam', 'only the other one');
  const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const covered = coverage.roots.find((row) => row.path === root);
  if (covered === undefined) return yield* Effect.die(new Error(`the coverage of project ${projectId} answered no root for ${root}`));
  return { projectId, root, rootId: covered.rootId };
});

const history = (projectId: number, input: Record<string, unknown>) =>
  Effect.flatMap(DoorFixture, (world) =>
    Effect.map(world.op('read_checkout_history', input, `project=${projectId}`), (answered) =>
      answered.status === 200 ? { ...answered, body: (answered.body as { history: PathHistory }).history } : answered,
    ),
  );
const asking = (projectId: number, rootId: RootId, path: string, limit?: number, cursor?: string) =>
  history(projectId, { root: rootId, ...(cursor === undefined ? { path } : { cursor }), limit });

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('checkout history door', (it) => {
  it.effect('history pages paths, branches and literal message filters while each cursor keeps its original head and selection', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { projectId, root, rootId } = yield* checkout;
      const kept = yield* asking(projectId, rootId, 'kept.txt', 5);
      expect(kept.status).toBe(200);
      const read = kept.body as PathHistory;
      expect(read.rootId).toBe(rootId);
      expect(read.path).toBe('kept.txt');
      expect(read.commits.map((commit) => commit.subject)).toEqual(['kept again', 'born']);
      expect(read.next).toBeNull();
      expect(read.total).toBeNull();
      expect(read.shown).toBe(2);
      const newest = read.commits[0];
      expect(newest?.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(newest?.author).toBe('suite');
      expect(newest?.date.startsWith('20')).toBe(true);
      expect(read.commits[1]?.parents).toEqual([]);
      const bounded = (yield* asking(projectId, rootId, 'kept.txt', 1)).body as PathHistory;
      expect(bounded.commits.map((commit) => commit.subject)).toEqual(['kept again']);
      expect(bounded.next).not.toBeNull();
      yield* files.writeFileString(join(root, 'kept.txt'), 'three\n');
      yield* suiteGit(root, 'commit', '-qam', 'later kept edit');
      const continued = (yield* asking(projectId, rootId, 'kept.txt', 1, bounded.next ?? '')).body as PathHistory;
      expect(continued.commits.map((commit) => commit.subject)).toEqual(['born']);
      expect(continued.next).toBeNull();
      expect(continued.total).toBeNull();
      const stale = yield* history(projectId, { root: rootId, path: 'other.txt', cursor: bounded.next ?? '', limit: 1 });
      expect(stale.status).toBe(409);
      expect((stale.body as RefusalBody).code).toBe('cursor-stale');
      const never = (yield* asking(projectId, rootId, 'absent.txt', 5)).body as PathHistory;
      expect(never.commits).toEqual([]);
      expect(never.next).toBeNull();
      const elsewhere = yield* asking(projectId, '01a00000-0000-7000-8000-000000000000' as RootId, 'kept.txt', 5);
      expect(elsewhere.status).toBe(409);
      expect((elsewhere.body as RefusalBody).code).toBe('not-found');
      yield* Effect.gen(function* () {
        for (const [name, email, subject] of [
          ['tagma', 'tagma@tagma', 'tagma: graph @ 1'],
          ['Tagma', 'agent@tagma.dev', 'Sync graph files'],
        ] as const) {
          yield* files.writeFileString(join(root, 'graph.md'), `${subject}\n`);
          yield* suiteGit(root, 'add', 'graph.md');
          const synced = yield* spawnedEffect(['git', '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-qm', subject], {
            cwd: root,
          });
          expect(synced.success).toBe(true);
        }
        const branch = (limit: number, cursor?: string) => history(projectId, { root: rootId, limit, cursor });
        const first = (yield* branch(2)).body as PathHistory;
        expect(first.path).toBeNull();
        expect(first.commits.map((commit) => [commit.subject, commit.graph])).toEqual([
          ['Sync graph files', true],
          ['tagma: graph @ 1', true],
        ]);
        expect(first.total).toBeNull();
        expect(first.next).not.toBeNull();
        yield* files.writeFileString(join(root, 'kept.txt'), 'landed mid-walk\n');
        yield* suiteGit(root, 'commit', '-qam', 'landed mid-walk');
        const rest = (yield* branch(5, first.next ?? '')).body as PathHistory;
        expect(rest.path).toBeNull();
        expect(rest.commits.map((commit) => commit.subject)).toEqual(['later kept edit', 'only the other one', 'kept again', 'born']);
        expect(rest.next).toBeNull();
        const narrowed = yield* history(projectId, { root: rootId, path: 'kept.txt', limit: 2, cursor: first.next ?? '' });
        expect(narrowed.status).toBe(409);
        expect((narrowed.body as RefusalBody).code).toBe('cursor-stale');
      });
      yield* Effect.gen(function* () {
        yield* files.writeFileString(join(root, 'kept.txt'), 'three\n');
        yield* suiteGit(root, 'commit', '-qam', 'Kept once MORE');
        const grepped = (limit: number, cursor?: string, grep?: string) => history(projectId, { root: rootId, limit, grep, cursor });
        const first = (yield* grepped(1, undefined, 'kept')).body as PathHistory;
        expect(first.grep).toBe('kept');
        expect(first.commits.map((commit) => commit.subject)).toEqual(['Kept once MORE']);
        expect(first.next).not.toBeNull();
        yield* files.writeFileString(join(root, 'kept.txt'), 'four\n');
        yield* suiteGit(root, 'commit', '-qam', 'landed mid-walk');
        const rest = (yield* grepped(5, first.next ?? '')).body as PathHistory;
        expect(rest.grep).toBe('kept');
        expect(rest.commits.map((commit) => commit.subject)).toEqual(['later kept edit', 'kept again']);
        expect(rest.next).toBeNull();
        const widened = yield* grepped(1, first.next ?? '', 'born');
        expect(widened.status).toBe(409);
        expect((widened.body as RefusalBody).code).toBe('cursor-stale');
        const literal = (yield* grepped(5, undefined, 'k.pt')).body as PathHistory;
        expect(literal.commits).toEqual([]);
      });
    }),
  );
});
