import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer, Queue } from 'effect';
import { demoGraphLayer, withDemo } from './graphFixture.js';
import type { PendingMerges } from '../../landing/contract/service/merges.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { principalOf } from '../../executions/terminals/principals.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { commitEffect, composed, OPERATOR, refusal, shEffect } from './finishingFixture.js';
import { makeMachineWorld } from '../../executions/testing/doubles.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { intentsOver, landingStore, mergeRequestsOver } from '../../landing/testing/doubles.js';
import { verifyMergeJournal } from '../../landing/testing/journalConformance.js';

const until = Effect.fnUntraced(function* <A, E, R>(
  merges: PendingMerges['Service'],
  projectId: number,
  probe: Effect.Effect<A | null, E, R>,
) {
  const moved = yield* Queue.unbounded<void>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      merges.onMoved((id) => {
        if (id === projectId) Queue.offerUnsafe(moved, undefined);
      }),
    ),
    (off) => Effect.sync(off),
  );
  for (;;) {
    const found = yield* probe;
    if (found !== null) return found;
    yield* Queue.take(moved);
  }
});

layer(Layer.merge(demoGraphLayer({ repos: ['finishing'] }), BunFileSystem.layer), {
  excludeTestServices: true,
})('worktree merge boundaries', (it) => {
  it.effect('real merge settlement keeps consent, receipts, pending restart, recovery and retirement decisions coherent', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { db } = yield* MachineStore;
        const units = yield* MachineUnits;
        const {
          finishing,
          retirement,
          updates,
          make,
          project,
          projectId,
          trunk,
          standing,
          holding,
          waiting,
          hold,
          releasedUse,
          seen,
          placedIn,
          stops,
        } = yield* composed(
          demo,
          makeMachineWorld(() => null),
          { project: demo.project('finishing') },
        );
        yield* verifyMergeJournal({
          projectId,
          lifecycle: intentsOver(db, units),
          mergeRequests: mergeRequestsOver(db, units),
          pendingStore: landingStore(db).pending,
          units,
        });
        const mergedSide = yield* make('consented');
        yield* commitEffect(mergedSide.path, 'feature.ts', 'export const feature = true;\n', 'the work of the worktree');
        standing.push({ threadId: 'agent-in-side', rootId: mergedSide.rootId, cleared: false, live: true, state: 'working' });
        yield* files.writeFileString(join(mergedSide.path, 'loose.txt'), 'not committed\n');
        const terms = yield* finishing.termsOf(projectId, mergedSide.rootId, 'keep', null);
        expect(terms.consents?.map((consent) => consent.condition)).toEqual(['agent-running', 'uncommitted']);
        expect(yield* refusal(finishing.termsOf(projectId, mergedSide.rootId, 'delete', 'agent-in-side'))).toBe('own-worktree');
        yield* files.remove(join(mergedSide.path, 'loose.txt'));
        const base = yield* shEffect(project, ['rev-parse', 'HEAD']);
        const merged = yield* finishing.merge(projectId, mergedSide.rootId, {});
        expect((yield* shEffect(project, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ')).toHaveLength(3);
        expect(yield* shEffect(project, ['symbolic-ref', '--short', 'HEAD'])).toBe(trunk);
        expect(yield* files.readFileString(join(project, 'feature.ts'))).toBe('export const feature = true;\n');
        expect(merged.base.head).toBe(yield* shEffect(project, ['rev-parse', 'HEAD']));
        expect(seen.merged).toEqual([[mergedSide.rootId, 'merge', merged.base.head]]);
        expect(seen.landed).toEqual([{ kind: 'tree', projectId, root: project, commit: merged.base.head, paths: ['feature.ts'], base }]);
        expect((yield* retirement.delete(projectId, mergedSide.rootId, OPERATOR)).branch).toEqual({
          status: 'deleted',
          name: mergedSide.branch,
        });
        expect(seen.stopped).toEqual(['agent-in-side']);
        expect(yield* files.exists(mergedSide.path)).toBe(false);

        const queuedSide = yield* make('queued');
        yield* commitEffect(queuedSide.path, 'queued.txt', 'from the worktree\n', 'worktree work');
        const shell = yield* hold(queuedSide.rootId, { holder: 'operator', program: 'zsh' });
        yield* files.writeFileString(join(project, 'queued.txt'), 'being written in main\n');
        holding.set('queued.txt', {
          holder: { kind: 'thread', thread: 'writer-in-main' },
          agentName: 'writer',
          tasks: [],
          retired: false,
          writing: true,
        });
        const caller = { _tag: 'Thread', threadId: ThreadId.make('queuer'), projectId } as const;
        const ask = { mode: 'merge', message: null, after: 'delete', end: principalOf(OPERATOR), caller } as const;
        const queued = yield* Effect.scoped(
          Effect.gen(function* () {
            const before = yield* waiting('1 hour');
            return yield* before.merge(projectId, queuedSide.rootId, ask, true);
          }),
        );
        expect('queued' in queued && [queued.queued.state, queued.queued.refusal?.code, queued.queued.endRunning]).toEqual([
          'waiting',
          'base-held',
          true,
        ]);
        holding.clear();
        yield* files.remove(join(project, 'queued.txt'));
        const restarted = yield* waiting('100 millis');
        expect(yield* restarted.resume()).toBe(1);
        yield* until(
          restarted,
          projectId,
          Effect.map(restarted.ofProject(projectId), (rows) => (rows.length === 0 ? true : null)),
        );
        expect(yield* files.readFileString(join(project, 'queued.txt'))).toBe('from the worktree\n');
        expect(yield* files.exists(queuedSide.path)).toBe(false);
        expect(yield* releasedUse(shell)).toBe(true);
        expect(seen.landed.at(-1)?.caller).toEqual(caller);

        const recoverySide = yield* make('recovery');
        placedIn.push(
          { threadId: 'lead', parentThreadId: null, createdAt: new Date(1), archivedAt: null },
          { threadId: 'child', parentThreadId: 'lead', createdAt: new Date(0), archivedAt: null },
        );
        expect((yield* updates.update(projectId, recoverySide.rootId, null)).threadId).toBe('lead');
        expect(seen.delivered.map(([threadId, intent]) => [threadId, intent])).toEqual([['lead', 'message']]);
        yield* commitEffect(recoverySide.path, 'hooked.txt', 'feature\n', 'work');
        const beforeHook = yield* shEffect(project, ['rev-parse', 'HEAD']);
        const hook = join(project, '.git', 'hooks', 'pre-merge-commit');
        yield* files.writeFileString(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        expect(yield* refusal(finishing.merge(projectId, recoverySide.rootId, {}))).toBe('git-refused');
        expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(beforeHook);
        expect(yield* shEffect(project, ['status', '--porcelain'])).toBe('');
        yield* files.remove(hook);
        yield* commitEffect(recoverySide.path, 'x.txt', 'side\n', 'side');
        yield* commitEffect(project, 'x.txt', 'main\n', 'main');
        yield* spawnedEffect(
          ['git', 'merge', '--no-ff', '-m', `interrupted\n\nTagma-Worktree: ${recoverySide.rootId}`, recoverySide.branch],
          { cwd: project },
        );
        expect(yield* files.exists(join(project, '.git', 'MERGE_HEAD'))).toBe(true);
        expect(yield* finishing.recover()).toEqual({ aborted: [project], published: [], uncertain: [], unread: [] });
        expect(yield* shEffect(project, ['status', '--porcelain'])).toBe('');
        yield* spawnedEffect(['git', 'merge', '--no-ff', '-m', 'the operator merging by hand', recoverySide.branch], { cwd: project });
        expect(yield* finishing.recover()).toEqual({ aborted: [], published: [], uncertain: [], unread: [] });
        expect(yield* files.exists(join(project, '.git', 'MERGE_HEAD'))).toBe(true);
        yield* shEffect(project, ['merge', '--abort']);

        const stuck = yield* make('stuck-shell');
        yield* hold(stuck.rootId, { holder: 'operator', program: 'sleep 1000', stuck: true });
        const unended = yield* Effect.flip(retirement.delete(projectId, stuck.rootId, OPERATOR));
        expect(unended._tag === 'WorktreeFinishRefused' ? unended.reason : unended._tag).toBe('root-in-use');
        expect(unended.message).toContain(stops.at(-1) ?? 'no stop was sent');
        expect(yield* files.exists(stuck.path)).toBe(true);
      }),
    ),
  );
});
