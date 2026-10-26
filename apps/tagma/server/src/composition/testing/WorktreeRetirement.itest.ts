import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { type DemoState, demoGraphLayer, withDemo } from './graphFixture.js';
import { commitEffect, composed as composedAt, OPERATOR, refusal, shEffect } from './finishingFixture.js';
import { makeMachineWorld } from '../../executions/testing/doubles.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';

const composed = (demo: DemoState, options?: Parameters<typeof composedAt>[2]) =>
  composedAt(
    demo,
    makeMachineWorld(() => null),
    options,
  );

const branchStands = (project: string, branch: string) =>
  Effect.map(shEffect(project, ['branch', '--list', branch]), (listed) => listed !== '');

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('worktree retirement', (it) => {
  it.effect(
    'deleting removes the folder and record whatever the folder holds or if it is gone; the branch goes when it adds only graph commits and merge-check leftovers, and otherwise keeps the uncommitted lines, on a new branch where the worktree stood on none; shells and a dev server standing in it refuse root-in-use unless the ending is asked',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { retirement, make, project, projectId, standing, seen, records, units, hold, stops, releasedUse } = yield* composed(demo);
          const side = yield* make('graph-only');
          yield* files.makeDirectory(join(side.path, '.tagma'), { recursive: true });
          yield* commitEffect(side.path, '.tagma/note.md', 'a block\n', 'tagma: graph @ 3 (amber-fox)');
          yield* commitEffect(side.path, '.merge_file_a1b2c3', 'left by a check\n', 'the work left uncommitted');
          yield* files.writeFileString(join(side.path, '.merge_file_d4e5f6'), 'left again\n');
          yield* files.writeFileString(join(project, '.git', 'info', 'exclude'), 'ignored/\n');
          yield* files.makeDirectory(join(side.path, 'ignored'));
          yield* files.writeFileString(join(side.path, 'ignored', 'cache.bin'), 'built\n');
          standing.push({ threadId: 'resting-agent', rootId: side.rootId, cleared: false, live: false, state: 'idle' });

          const deleted = yield* retirement.delete(projectId, side.rootId);

          expect(deleted.branch).toEqual({ status: 'deleted', name: side.branch });
          expect(deleted.committed).toBeNull();
          expect(yield* files.exists(side.path)).toBe(false);
          expect(yield* branchStands(project, side.branch)).toBe(false);
          expect(yield* units.read((unit) => records.byRoot(side.rootId as RootId, unit))).toBeNull();
          expect(seen.archived).toEqual([['resting-agent', true]]);
          expect(yield* shEffect(project, ['worktree', 'list', '--porcelain'])).not.toContain(side.path);

          const lost = yield* make('lost');
          yield* files.remove(lost.path, { recursive: true, force: true });
          const gone = yield* retirement.delete(projectId, lost.rootId);
          expect([gone.removed, gone.branch.status]).toEqual([false, 'deleted']);
          expect(yield* units.read((unit) => records.byRoot(lost.rootId as RootId, unit))).toBeNull();
          expect(yield* shEffect(project, ['worktree', 'list', '--porcelain'])).not.toContain(lost.path);

          const worked = yield* make('unmerged');
          yield* commitEffect(worked.path, 'u.txt', 'unmerged\n', 'work nobody merged');
          yield* files.writeFileString(join(worked.path, 'draft.txt'), 'half done\n');
          const kept = yield* retirement.delete(projectId, worked.rootId);
          expect(kept.committed?.paths).toEqual(['draft.txt']);
          const named = kept.branch.status === 'kept' ? kept.branch.commits.map((one) => one.sha) : [];
          expect(named).toEqual([kept.committed?.commit ?? '', yield* shEffect(project, ['rev-parse', `${worked.branch}~1`])]);
          expect(yield* shEffect(project, ['show', `${worked.branch}:draft.txt`])).toBe('half done');
          expect(yield* files.exists(worked.path)).toBe(false);

          const loose = yield* make('loose', true);
          yield* files.writeFileString(join(loose.path, 'loose.txt'), 'on no branch\n');
          const unbranched = yield* retirement.delete(projectId, loose.rootId);
          expect(yield* files.exists(loose.path)).toBe(false);
          const saved = unbranched.branch.status === 'kept' ? unbranched.branch.name : null;
          expect(saved).not.toBeNull();
          expect(yield* shEffect(project, ['show', `${saved}:loose.txt`])).toBe('on no branch');

          const running = yield* make('running');
          const held = [
            yield* hold(running.rootId, { holder: 'operator', program: 'zsh' }),
            yield* hold(running.rootId, { holder: 'operator', program: 'bun run dev' }),
          ];

          expect(yield* refusal(retirement.delete(projectId, running.rootId))).toBe('root-in-use');
          expect(stops).toEqual([]);
          expect(yield* files.exists(running.path)).toBe(true);

          const ending = yield* retirement.delete(projectId, running.rootId, OPERATOR);

          expect(yield* files.exists(running.path)).toBe(false);
          expect(ending.ended.map((one): string => one.execution.execution).sort()).toEqual([...held].sort());
          for (const useId of held) expect(yield* releasedUse(useId)).toBe(true);
        }),
      ),
  );
});
