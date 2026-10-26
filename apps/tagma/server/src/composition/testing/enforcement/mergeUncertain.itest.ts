import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, refusal, shEffect } from '../finishingFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('uncertain merge publication', (it) => {
  it.effect(
    'a merge cut after its compare-and-set whose publication the ref and reflog no longer show stays uncertain, kept and untouched',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId, seen } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            { cutAfterPublishing: true },
          );
          const side = yield* make('rewritten');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          const cut = yield* shEffect(project, ['rev-parse', 'HEAD']);
          const ref = yield* shEffect(project, ['symbolic-ref', 'HEAD']);
          expect(Exit.hasDies(yield* Effect.exit(finishing.merge(projectId, side.rootId, {})))).toBe(true);
          const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
          yield* shEffect(project, ['update-ref', ref, cut, head]);
          yield* shEffect(project, ['reflog', 'expire', '--expire=now', '--all']);
          const doubted = { published: [], uncertain: [{ path: project, commit: head, rootId: side.rootId }], unread: [] };
          expect(yield* finishing.recover()).toMatchObject(doubted);
          expect(yield* finishing.recover()).toMatchObject(doubted);
          expect(yield* refusal(finishing.merge(projectId, side.rootId, {}))).toBe('finishing-cut');
          expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(cut);
          expect(existsSync(join(project, 'feature.txt'))).toBe(false);
          expect(seen.merged).toEqual([]);
        }),
      ),
  );
});
