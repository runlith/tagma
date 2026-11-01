import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Queue } from 'effect';
import { graphFixture } from '../graphFixture.js';
import { commitEffect, composed, OPERATOR, refusal, shEffect } from '../finishingFixture.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

it.live(
  'a staged entry in the base checkout holds back only a merge that writes its path, and stays staged through one that does not',
  () =>
    Effect.gen(function* () {
      const world = graphFixture();
      const demo = (yield* Effect.acquireRelease(world.openEffect(), () => Effect.orDie(world.releaseEffect))).effects;
      return yield* Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { finishing, make, project, projectId, waiting } = yield* composed(
          demo,
          makeMachineWorld(() => null),
        );
        yield* commitEffect(project, 'kept.ts', 'export const kept = 1;\n', 'kept');
        yield* commitEffect(project, 'merged.ts', 'export const merged = 1;\n', 'merged');
        const staged = () => shEffect(project, ['diff', '--cached', '--name-only']);

        const apart = yield* make('apart');
        yield* commitEffect(apart.path, 'merged.ts', 'export const merged = 2;\n', 'the worktree changes merged.ts');
        yield* files.writeFileString(join(project, 'kept.ts'), 'export const kept = 2;\n');
        yield* shEffect(project, ['add', '--', 'kept.ts']);
        const landed = yield* finishing.merge(projectId, apart.rootId, {});
        expect(landed.unsynced).toBeUndefined();
        expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(landed.base.head);
        expect(yield* staged()).toBe('kept.ts');
        expect(yield* shEffect(project, ['show', ':kept.ts'])).toBe('export const kept = 2;');
        expect(yield* files.readFileString(join(project, 'merged.ts'))).toBe('export const merged = 2;\n');

        const clash = yield* make('clash');
        yield* commitEffect(clash.path, 'merged.ts', 'export const merged = 3;\n', 'the worktree changes merged.ts again');
        yield* files.writeFileString(join(project, 'merged.ts'), 'export const merged = 4;\n');
        yield* shEffect(project, ['add', '--', 'merged.ts']);
        expect(yield* refusal(finishing.merge(projectId, clash.rootId, {}))).toBe('base-staged');
        expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(landed.base.head);
        expect(yield* staged()).toBe('kept.ts\nmerged.ts');

        const collide = yield* make('collide');
        yield* commitEffect(collide.path, 'dir', 'a file where the base stages a directory\n', 'the worktree adds the file dir');
        yield* files.makeDirectory(join(project, 'dir'));
        yield* files.writeFileString(join(project, 'dir', 'kept.ts'), 'export const inside = 1;\n');
        yield* shEffect(project, ['add', '--', 'dir/kept.ts']);
        expect(yield* refusal(finishing.merge(projectId, collide.rootId, {}))).toBe('base-staged');
        expect(yield* staged()).toBe('dir/kept.ts\nkept.ts\nmerged.ts');

        const queue = yield* waiting('1 hour');
        const ask = { mode: 'merge', message: null, after: 'keep', end: principalOf(OPERATOR) } as const;
        const queued = yield* queue.merge(projectId, clash.rootId, ask, true);
        expect('queued' in queued && queued.queued.refusal?.code).toBe('base-staged');
        const moved = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => queue.onMoved((id) => (id === projectId ? Queue.offerUnsafe(moved, undefined) : undefined))),
          (off) => Effect.sync(off),
        );
        const tried = 'queued' in queued ? queued.queued.attempts : 0;
        while (((yield* queue.ofProject(projectId))[0]?.attempts ?? 0) <= tried) yield* Queue.take(moved);
        yield* Effect.sleep('1 second');
        yield* shEffect(project, ['restore', '--staged', '--worktree', '--', 'merged.ts']);
        const landedQueued = Effect.gen(function* () {
          while ((yield* queue.ofProject(projectId)).length > 0) yield* Queue.take(moved);
        });
        yield* landedQueued.pipe(Effect.timeout('20 seconds'));
        expect(yield* shEffect(project, ['show', 'HEAD:merged.ts'])).toBe('export const merged = 3;');
        expect(yield* staged()).toBe('dir/kept.ts\nkept.ts');
      }).pipe(Effect.provide(demo.context));
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
