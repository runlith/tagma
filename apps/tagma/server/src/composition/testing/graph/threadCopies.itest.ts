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
import { ThreadLive } from '../../../threads/contract/service/engine.js';
import { ThreadPlacement } from '../../../threads/contract/service/placement.js';
import type { NativeThreadState } from '../../../threads/contract/service/state.js';
import type { FileRoot } from '../../../workspace/contract/wire/roots.js';
import { threadCopiesLayer } from '../../threadCopies.js';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';

const next = Effect.fnUntraced(function* (events: Queue.Queue<CopyEvent>, kind: CopyEvent['kind'], treeRoot: string) {
  for (;;) {
    const event = yield* Queue.take(events);
    if (event.kind === kind && event.treeRoot === treeRoot) return event;
  }
});

layer(demoGraphLayer({ repos: ['alpha'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 40_000,
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
            const live = yield* makeThreadLiveFeed<NativeThreadState>();
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
                    Layer.succeed(ThreadLive, live),
                  ),
                ),
              ),
            );
            const state = (running: boolean, rootId: string | null) =>
              live.publishState({
                state: {
                  thread: { id: 'runner', projectId: alpha.id },
                  position: 0,
                  activeRun: running ? { id: 'run' } : null,
                  latestRun: { id: 'run' },
                  place: rootId === null ? null : { rootId, branch: null },
                } as unknown as NativeThreadState,
                from: 0,
                deltas: [],
              });

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
