import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { workspaceChange } from '../../../change-record/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const gitIn = Effect.fnUntraced(function* (cwd: string, ...args: readonly string[]) {
  const ran = yield* spawnedEffect(['git', '-c', 'user.name=suite', '-c', 'user.email=suite@tagma', ...args], { cwd });
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${cwd}: ${ran.stderr.toString()}`));
  return ran.stdout.toString().trim();
});

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('record'));
  yield* files.makeDirectory(join(root, 'src'), { recursive: true });
  yield* files.writeFileString(join(root, 'src/a.ts'), 'export const a = 1;\n');
  yield* gitIn(root, 'init', '-q', '-b', 'main');
  yield* gitIn(root, 'add', '--', 'src');
  yield* gitIn(root, 'commit', '-q', '-m', 'the files as they stood');
  const projectId = yield* world.stealthProject(root);
  yield* projectLeaving(world, projectId);
  const store = Context.get(world.runtime.graph, MachineStore);
  const answer = yield* world.op('create_thread', { title: 'amber-fox', approvalMode: 'trust' }, `project=${projectId}`);
  expect(answer.status).toBe(200);
  const hooked = (answer.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  return { world, root, projectId, store, hooked };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ChangeRecord') {}

const carrying = (threadId: string) => ({ [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string });

const record = Effect.fnUntraced(function* (
  headers: Record<string, string>,
  write: { path: string; before: string | null; after: string },
) {
  const { world, root } = yield* Place;
  const answered = yield* world.op('record_write', { cwd: root, ...write }, `cwd=${encodeURIComponent(root)}`, headers);
  return answered.body as Record<string, unknown>;
});

const rowsOf = (path: string) =>
  Effect.flatMap(Place, ({ store, projectId }) =>
    store.db
      .select()
      .from(workspaceChange())
      .where(and(eq(workspaceChange().projectId, projectId), eq(workspaceChange().path, path))),
  );

layer(Layer.effect(Place, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('change record door', (it) => {
  it.effect('a write recorded under a session grant is that session own typed row, and its commit carries the hunk', () =>
    Effect.gen(function* () {
      const { world, root, hooked } = yield* Place;
      const files = yield* FileSystem.FileSystem;
      const at = join(root, 'src/a.ts');
      const before = yield* files.readFileString(at);
      const after = 'export const a = 2;\n';
      yield* files.writeFileString(at, after);
      const answered = yield* record(carrying(hooked), { path: 'src/a.ts', before, after });
      expect(answered.path).toBe('src/a.ts');
      expect((yield* rowsOf('src/a.ts')).map((row) => [row.holder, row.origin])).toEqual([[hooked, 'write']]);
      const submitted = yield* world.op(
        'submit_work',
        { subject: 'the write a hook recorded' },
        `cwd=${encodeURIComponent(root)}`,
        carrying(hooked),
      );
      const landed = (submitted.body as { submitted: Record<string, unknown> }).submitted;
      expect(landed.status).toBe('landed');
      expect(landed.committed).toEqual(['src/a.ts']);
      expect(yield* gitIn(root, 'show', 'HEAD:src/a.ts')).toBe('export const a = 2;');
    }),
  );

  it.effect('a caller with no proven session records nothing and is refused session-unproven', () =>
    Effect.gen(function* () {
      const { root } = yield* Place;
      const after = 'export const c = 1;\n';
      yield* (yield* FileSystem.FileSystem).writeFileString(join(root, 'src/c.ts'), after);
      const refused = yield* record({ 'x-tagma-session': 'claude-code:x' }, { path: 'src/c.ts', before: null, after });
      expect(refused.code).toBe('session-unproven');
      expect(yield* rowsOf('src/c.ts')).toEqual([]);
    }),
  );
});
