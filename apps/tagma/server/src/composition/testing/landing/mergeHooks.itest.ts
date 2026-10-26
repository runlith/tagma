import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, shEffect } from '../finishingFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('merge hook isolation', (it) => {
  it.effect(
    "a worktree merge runs its pre-merge-commit hook in the base's commit tree: the base checkout's unstaged work stays, and what the hook left unstaged reaches the base's working files",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
          );
          const side = yield* make('hooked');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          yield* commitEffect(project, 'theirs.txt', 'base\n', 'trunk moved');
          writeFileSync(join(project, 'theirs.txt'), 'another session is still writing this\n');
          const hook = join(project, '.git', 'hooks', 'pre-merge-commit');
          writeFileSync(hook, "#!/bin/sh\ngit checkout -- . || exit 1\nprintf 'hooked\\n' > feature.txt\n");
          chmodSync(hook, 0o755);

          const merged = yield* finishing.merge(projectId, side.rootId, { mode: 'merge' });

          const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
          expect(merged.base.head).toBe(head);
          expect(yield* shEffect(project, ['show', 'HEAD:feature.txt'])).toBe('feature');
          expect(readFileSync(join(project, 'theirs.txt'), 'utf8')).toBe('another session is still writing this\n');
          expect(readFileSync(join(project, 'feature.txt'), 'utf8')).toBe('hooked\n');
        }),
      ),
  );

  it.effect(
    "a hook of a merge whose tree starts tracking a file the base checkout keeps ignored sees and commits the tracked one, never the base's local copy",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { finishing, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
          );
          yield* commitEffect(project, '.gitignore', '.env\n', 'ignore the environment');
          const side = yield* make('tracking');
          writeFileSync(join(side.path, '.env'), 'tracked\n');
          yield* shEffect(side.path, ['add', '-f', '--', '.env']);
          yield* shEffect(side.path, ['commit', '-q', '-m', 'track the environment']);
          yield* commitEffect(project, 'trunk.txt', 'trunk\n', 'trunk moved');
          writeFileSync(join(project, '.env'), 'local\n');
          const seen = join(project, '.git', 'seen-env');
          const hook = join(project, '.git', 'hooks', 'pre-merge-commit');
          writeFileSync(hook, `#!/bin/sh\ncat .env > "${seen}"\ngit add -A\n`);
          chmodSync(hook, 0o755);

          yield* finishing.merge(projectId, side.rootId, { mode: 'merge' });

          expect(readFileSync(seen, 'utf8')).toBe('tracked\n');
          expect(yield* shEffect(project, ['ls-tree', 'HEAD', '--', '.env'])).toStartWith('100644 blob');
          expect(yield* shEffect(project, ['show', 'HEAD:.env'])).toBe('tracked');
        }),
      ),
  );
});
