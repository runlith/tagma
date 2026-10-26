import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, shEffect } from '../finishingFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { type TreeSubject, UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('merge publication', (it) => {
  it.effect(
    'a merge whose base moves under its compare-and-set is judged again on the moved base and lands what its hook made of the merged files',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const judged: TreeSubject[] = [];
          let base = '';
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            {
              before: Effect.fnUntraced(function* (subject) {
                if (subject.kind !== 'tree') return UNCHECKED;
                if (judged.push(subject) === 1)
                  yield* commitEffect(base, 'aside.txt', 'aside\n', 'aside').pipe(
                    Effect.provideService(FileSystem.FileSystem, files),
                    Effect.orDie,
                  );
                return UNCHECKED;
              }),
            },
          );
          base = project;
          const hook = join(project, '.git', 'hooks', 'pre-merge-commit');
          writeFileSync(hook, '#!/bin/sh\n{ cat feature.txt && printf "checked\\n"; } > stamp.txt && git add stamp.txt\n');
          chmodSync(hook, 0o755);
          const side = yield* make('side');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          const cut = yield* shEffect(project, ['rev-parse', 'HEAD']);
          yield* finishing.merge(projectId, side.rootId, {});
          const [, moved = '', merged = ''] = (yield* shEffect(project, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ');
          expect(moved).not.toBe(cut);
          expect(merged).toBe(yield* shEffect(side.path, ['rev-parse', 'HEAD']));
          expect(judged[0]?.base).toBe(cut);
          expect(judged.at(-1)?.base).toBe(moved);
          expect(judged.at(-1)?.paths).toContain('stamp.txt');
          expect(judged.at(-1)?.built).toBe(yield* shEffect(project, ['rev-parse', 'HEAD^{tree}']));
          expect(yield* shEffect(project, ['show', 'HEAD:stamp.txt'])).toBe('feature\nchecked');
          expect(yield* shEffect(project, ['status', '--porcelain'])).toBe('');
        }),
      ),
  );
  it.effect(
    'a merge whose checkout cannot be brought to it after it published answers landed and unsynced, and the file in its way stays as it was',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          let base = '';
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            {
              before: () => Effect.sync(() => (writeFileSync(join(base, 'feature.txt'), 'peer\n'), UNCHECKED)),
            },
          );
          base = project;
          const side = yield* make('unsynced');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          const answer = yield* finishing.merge(projectId, side.rootId, {});
          expect(answer.base.head).toBe(yield* shEffect(project, ['rev-parse', 'HEAD']));
          expect(answer.unsynced?.paths).toEqual(['feature.txt']);
          expect(readFileSync(join(project, 'feature.txt'), 'utf8')).toBe('peer\n');
        }),
      ),
  );
});
