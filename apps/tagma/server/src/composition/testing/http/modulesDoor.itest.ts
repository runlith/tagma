import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';

const git = Effect.fnUntraced(function* (cwd: string, ...args: string[]) {
  const ran = yield* spawnedEffect(['git', '-c', 'user.name=suite', '-c', 'user.email=suite@tagma', ...args], { cwd });
  if (!ran.success) return yield* Effect.die(new Error(ran.stderr.toString()));
});

it.live(
  'set_module answers its declared shape and only the modules that call writes',
  () =>
    Effect.gen(function* () {
      const world = yield* makeDoorWorld();
      const root = realpathSync(yield* world.directory('modules'));
      mkdirSync(join(root, 'kernel'), { recursive: true });
      mkdirSync(join(root, 'other'), { recursive: true });
      const projectId = yield* world.stealthProject(root);
      yield* projectLeaving(world, projectId);
      yield* git(root, 'commit', '-q', '--allow-empty', '-m', 'born');
      const op = (input: unknown) => world.op('set_module', input, `project=${projectId}`);

      expect(yield* op({ modules: [{ id: 'kernel', title: 'Kernel', root: 'kernel' }] })).toMatchObject({ status: 200 });
      const alone = yield* op({ modules: [{ id: 'kernel', entries: { put: [{ at: '.' }] } }] });
      const born = yield* op({ modules: [{ id: 'other', title: 'Other', root: 'other', imports: { put: ['kernel'] } }] });
      const crowded = yield* op({ modules: [{ id: 'kernel', entries: { replace: [{ at: '.', role: 'port' }] } }] });

      for (const answered of [alone, crowded]) {
        expect(answered.status).toBe(200);
        expect((answered.body as { modules: { id: string }[] }).modules.map((module) => module.id)).toEqual(['kernel']);
      }
      expect((born.body as { modules: unknown[] }).modules).toHaveLength(1);
    }),
  60_000,
);
