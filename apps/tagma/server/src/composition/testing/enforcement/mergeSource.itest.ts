import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, shEffect } from '../finishingFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('merge source recovery', (it) => {
  it.effect(
    'a rebase cut after its base moved moves the source ref by its recorded commit even when its worktree cannot follow, and the worktree file in the way stays as it was',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId, seen } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            { cutAfterPublishing: true },
          );
          const side = yield* make('stuck');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          yield* commitEffect(project, 'trunk.txt', 'trunk\n', 'trunk moved');
          expect(Exit.hasDies(yield* Effect.exit(finishing.merge(projectId, side.rootId, { mode: 'rebase' })))).toBe(true);
          const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
          writeFileSync(join(side.path, 'trunk.txt'), 'mine\n');
          expect(yield* finishing.recover()).toMatchObject({ published: [{ commit: head }], unread: [] });
          expect(yield* shEffect(project, ['rev-parse', side.branch])).toBe(head);
          expect(readFileSync(join(side.path, 'trunk.txt'), 'utf8')).toBe('mine\n');
          expect(seen.merged).toEqual([[side.rootId, 'rebase', head]]);
          expect(yield* finishing.recover()).toMatchObject({ published: [], uncertain: [], unread: [] });
        }),
      ),
  );

  it.effect(
    'a rebase cut after its base moved leaves the worktree alone when it was switched to another branch meanwhile, while the source ref still moves',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            { cutAfterPublishing: true },
          );
          const side = yield* make('switched');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          yield* commitEffect(project, 'trunk.txt', 'trunk\n', 'trunk moved');
          expect(Exit.hasDies(yield* Effect.exit(finishing.merge(projectId, side.rootId, { mode: 'rebase' })))).toBe(true);
          const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
          const tip = yield* shEffect(side.path, ['rev-parse', 'HEAD']);
          yield* shEffect(side.path, ['checkout', '-q', '-b', 'elsewhere']);
          yield* finishing.recover();
          expect(yield* shEffect(project, ['rev-parse', side.branch])).toBe(head);
          expect(yield* shEffect(side.path, ['symbolic-ref', '--short', 'HEAD'])).toBe('elsewhere');
          expect(yield* shEffect(side.path, ['rev-parse', 'HEAD'])).toBe(tip);
          expect(existsSync(join(side.path, 'trunk.txt'))).toBe(false);
        }),
      ),
  );
});
