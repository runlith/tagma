import { RequestKey } from '../../platform/contract/wire/ids.js';
import { rmSync, writeFileSync } from 'node:fs';
import { Deferred, Effect, FileSystem, Path, Queue, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { DemoState } from './graphFixture.js';
import { makeCoverageStore } from '../../workspace/store/coverage.js';
import type { WorktreeFeedEvent, WorktreeRow } from '../../worktrees/contract/wire/rows.js';
import { coveredWorkspace, environmentLedger, gitCheckoutRows } from '../../workspace/testing/doubles.js';
import { makeMergeChecks } from '../../worktrees/listing/mergeChecks.js';
import { CheckDriver } from '../../worktrees/contract/service/mergeChecks.js';
import { graphDriver } from '../../enforcement/commits/graphMerge.js';
import { makeActProgress } from '../../worktrees/progress.js';
import { makeBackendRegistry } from '../../workspace/environments/backends.js';
import { makeEnvironmentStore } from '../../workspace/store/environments.js';
import { makeEnvironmentUseStore } from '../../workspace/store/environmentUses.js';
import { makeEnvironmentUses } from '../../workspace/environments/uses.js';
import { type ThreadPlacing, WorktreeThreads } from '../../worktrees/contract/service/finishingGate.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { hostEnvironment, makeMachineWorld } from '../../executions/testing/doubles.js';
import { idleThreads, worktreeCreator, worktreeRowReader, worktreeStore } from '../../worktrees/testing/doubles.js';

const machineWorld = makeMachineWorld(() => null);

export const listingRig = (demo: DemoState) => {
  const composing = Effect.fnUntraced(
    function* (readings: Git['Service']) {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const liveGit = yield* Git;
      const files = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'worktree-listing-' });
      const access = yield* environmentLedger(
        makeBackendRegistry({ backends: [yield* hostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld })] }),
        makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }),
        units,
      );
      const state = yield* access.inspect('host');
      if (state.binding === null) return yield* Effect.die(new Error(`the host answered for no identity: ${state.reason}`));
      const acquired = yield* access.acquireActive({
        binding: state.binding,
        consumer: { kind: 'test', id: 'listing' },
        requires: ['files', 'exec'],
      });
      const operations = yield* worktreeStore(makeCoverageStore({ db }));
      const { roots, repositories, coverage } = yield* coveredWorkspace({
        namespaceId: state.binding.namespaceId,
        projects: demo.graph.projects,
        git: liveGit,
        reservations: operations,
      });
      const worktrees = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots,
        git: liveGit,
        files,
        paths,
        units,
      });
      const placed: ThreadPlacing[] = [];
      const movers = new Set<(threadId: string | null) => void>();
      const recorders = new Set<(projectId: number) => void>();
      const progress = yield* makeActProgress;
      const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, liveGit), Effect.provideService(CheckDriver, graphDriver));
      const checkouts = yield* gitCheckoutRows(readings, roots, files, yield* Effect.scope);
      const listing = yield* worktreeRowReader({
        recordMoved: (listener) => {
          recorders.add(listener);
          const created = worktrees.onRecorded(listener);
          return () => {
            recorders.delete(listener);
            created();
          };
        },
        options: {
          checks,
          progress,
        },
      }).pipe(
        Effect.provideService(Coverage, coverage),
        Effect.provideService(CheckoutRows, checkouts),
        Effect.provideService(Git, liveGit),
        Effect.provideService(MachineUnits, units),
        Effect.provideService(WorktreeRecords, operations),
        Effect.provideService(
          WorktreeThreads,
          idleThreads({
            placing: () => Effect.succeed([...placed]),
            threadsMoved: (_projectId, listener) => {
              movers.add(listener);
              return () => movers.delete(listener);
            },
          }),
        ),
      );
      const moved = (): void => {
        for (const listener of movers) listener(null);
      };
      const recordMoved = (projectId: number): void => {
        for (const listener of recorders) listener(projectId);
      };
      return {
        acquired,
        repositories,
        worktrees,
        listing,
        checks,
        checkouts,
        placed,
        moved,
        recordMoved,
        paths,
        progress,
        units,
        operations,
      };
    },
    Effect.provide(BunFileSystem.layer),
    Effect.provide(Path.layer),
  );

  const branchOf = (root: string) =>
    Effect.map(spawnedEffect(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd: root }), (run) => run.stdout.toString().trim());

  const headOf = (root: string) =>
    Effect.map(spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: root }), (run) => run.stdout.toString().trim());

  const next = Effect.fnUntraced(function* (frames: Queue.Queue<WorktreeFeedEvent>, matching: (event: WorktreeFeedEvent) => boolean) {
    for (;;) {
      const event = yield* Queue.take(frames);
      if (matching(event)) return event;
    }
  });

  return { composed: Effect.flatMap(Git, composing), composing, branchOf, headOf, next };
};
