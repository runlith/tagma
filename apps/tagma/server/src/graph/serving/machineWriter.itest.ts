import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { demoGraphLayer, type DemoState, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { project } from '../../projects/store/table.js';
import { graphPool } from '../testing/doubles.js';

const servedTree = Effect.fnUntraced(function* ({ context, projectId, demoRoot }: DemoState) {
  const pool = yield* Effect.acquireRelease(
    graphPool({ machine: context, sourcePath: demoRoot, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
    (held) => held.dispose(),
  );
  return yield* pool.resolve({ projectId });
});

layer(demoGraphLayer({ repos: [] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'served trees beside the machine writer',
  (it) => {
    it.effect(
      'a fiber holding the machine writer that asks for a fresh tree is refused before it waits, and a tree refreshes over a moved registry while another transaction holds the writer',
      () =>
        withDemo((demo) =>
          Effect.scoped(
            Effect.gen(function* () {
              const served = yield* servedTree(demo);
              const exit = yield* Effect.exit(demo.graph.store.transaction('test', () => served.settled()));
              if (Exit.isSuccess(exit)) return yield* Effect.die('the settle under the machine writer answered');
              expect(Cause.squash(exit.cause)).toMatchObject({
                _tag: 'WaitUnderHold',
                waitingOn: `tree-refresh:${served.layout.treeRoot}`,
                holding: [`writer:${demo.graph.store.path}`],
              });
              expect(yield* demo.graph.store.transaction('test', () => Effect.succeed('free'))).toBe('free');
              yield* demo.graph.projectLifecycle.create({ name: 'epsilon', rootPath: yield* demo.fixture.directory('epsilon') });
              const holding = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              const holder = yield* Effect.forkScoped(
                demo.graph.store.transaction('test', () => Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(release))),
              );
              yield* Deferred.await(holding);
              yield* served.settled(true);
              const mirror = Context.get(served.context, GraphStore);
              expect((yield* mirror.db.select().from(project)).map((row) => row.name)).toContain('epsilon');
              yield* Deferred.succeed(release, undefined);
              yield* Fiber.join(holder);
            }),
          ),
        ),
    );
  },
);
