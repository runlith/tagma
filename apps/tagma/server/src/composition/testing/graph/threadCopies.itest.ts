import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer, Queue } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { fixtureGraphMigrations } from '../migrations.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { type CopyEvent, ServedGraphs } from '../../../graph/contract/service/serving.js';
import { CopyKeeping } from '../../../graph/serving/copies.js';
import { graphPool, machineGraphOf } from '../../../graph/testing/doubles.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { type ThreadActivity, type ThreadRowBatch, ThreadRows } from '../../../threads/contract/service/rows.js';
import { ThreadPlacement } from '../../../threads/contract/service/placement.js';
import type { FileRoot } from '../../../workspace/contract/wire/roots.js';
import { threadCopiesLayer } from '../../threadCopies.js';

const unread = (): never => {
  throw new Error('graph copies read only running activity');
};

const next = Effect.fnUntraced(function* (events: Queue.Queue<CopyEvent>, kind: CopyEvent['kind'], treeRoot: string) {
  for (;;) {
    const event = yield* Queue.take(events);
    if (event.kind === kind && event.treeRoot === treeRoot) return event;
  }
});

layer(demoGraphLayer({ repos: ['alpha'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('thread copies', (it) => {
  it.effect(
    'a running thread keeps the copy it stands in past its keeping time, follows it when it moves, and lets it go when the run ends',
    () =>
      withDemo(({ graph, context, project, demoRoot, fixture }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const alpha = project('alpha');
            yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'stealth' });
            const moved = yield* fixture.directory('moved');
            yield* runGit(graph.git, 'worktree', ['worktree', 'add', '-b', 'moved', moved], { cwd: alpha.root });
            const pool = yield* Effect.acquireRelease(
              graphPool({
                migrations: fixtureGraphMigrations,
                identity: testSessionIdentity,
                machine: machineGraphOf(context),
                sourcePath: demoRoot,
              }).pipe(Effect.provideService(CopyKeeping, { idle: 1, ms: 150 })),
              (held) => held.dispose(),
            );
            const events = yield* Queue.unbounded<CopyEvent>();
            const unsubscribe = pool.copies.subscribe((event) => Queue.offerUnsafe(events, event));
            yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
            const running = new Map<string, ThreadActivity>();
            const listeners = new Set<(batch: ThreadRowBatch) => void>();
            const roots: { current: readonly FileRoot[] } = { current: [] };
            yield* Layer.build(
              threadCopiesLayer.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    Layer.succeed(ServedGraphs, pool),
                    Layer.succeed(Projects, Context.get(context, Projects)),
                    Layer.succeed(
                      ThreadPlacement,
                      ThreadPlacement.of({ rootOf: () => Effect.succeed(null), rootsOf: () => Effect.succeed(roots.current) }),
                    ),
                    Layer.mock(ThreadRows, {
                      current: unread,
                      latest: unread,
                      retain: unread,
                      release: unread,
                      waiting: unread,
                      waitingIds: unread,
                      activities: () => running,
                      subscribe: (listener) => {
                        listeners.add(listener);
                        return () => void listeners.delete(listener);
                      },
                    }),
                  ),
                ),
              ),
            );
            const state = (active: boolean, rootId: string | null) => {
              if (active) running.set('runner', { threadId: 'runner', projectId: alpha.id, parentThreadId: null, rootId, runId: 'run' });
              else running.delete('runner');
              for (const listener of listeners) listener({ rows: [], removed: [], activity: true, reset: false });
            };

            state(true, null);
            const main = yield* pool.resolve({ projectId: alpha.id });
            const other = yield* pool.resolve({ projectId: alpha.id, cwd: moved });
            yield* next(events, 'closed', other.layout.treeRoot);
            expect(pool.held().map((copy) => copy.treeRoot)).toEqual([main.layout.treeRoot]);

            roots.current = [{ path: other.checkout } as unknown as FileRoot];
            state(true, 'moved');
            yield* next(events, 'closed', main.layout.treeRoot);
            yield* pool.resolve({ projectId: alpha.id, cwd: moved });
            yield* pool.resolve({ projectId: alpha.id });
            yield* next(events, 'closed', main.layout.treeRoot);
            expect(pool.held().map((copy) => copy.treeRoot)).toEqual([other.layout.treeRoot]);

            state(false, 'moved');
            yield* next(events, 'closed', other.layout.treeRoot);
            expect(pool.held()).toEqual([]);
          }),
        ),
      ),
  );
});
