import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect, Queue, Semaphore } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { TestClock } from 'effect/testing';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { Mirrors } from '../contract/service/mirrors.js';
import { idleMirrors } from '../testing/doubles.js';
import { MirrorBuilder } from '../contract/service/serving.js';
import { treeLedger } from '../tree/ledger.js';
import { makeFreshnessGate } from './freshness.js';
import { GraphSteps } from '../contract/service/steps.js';
import { shippedSteps } from '../steps/sequence.js';

layer(demoGraphLayer())('graph refresh retry clock', (it) => {
  it.effect('background retry reaches its deadline without another read and acts receive the latest failure', () =>
    withDemo(({ graph, context, projectId, fixture }) =>
      Effect.gen(function* () {
        const root = yield* fixture.directory('refresh-retry');
        const row = (yield* graph.projectPolicy.read([projectId])).get(projectId);
        if (row === undefined) return yield* Effect.die('the fixture project is missing');
        const first = new SqlError({ reason: new ConnectionError({ message: 'first outage', cause: new Error('first outage') }) });
        const second = new SqlError({ reason: new ConnectionError({ message: 'second outage', cause: new Error('second outage') }) });
        let failure = first;
        const attempted = yield* Queue.unbounded<void>();
        const permit = yield* Semaphore.make(1);
        const gate = yield* makeFreshnessGate({ gates: () => permit, storePath: graph.store.path, changed: () => undefined }).pipe(
          Effect.provideService(Git, graph.git),
          Effect.provideService(Mirrors, idleMirrors),
          Effect.provideService(GraphSteps, shippedSteps),
          Effect.provideService(
            MirrorBuilder,
            MirrorBuilder.of({
              build: () => Effect.die('this test serves no mirror'),
              level: () => Effect.die('this test levels no twin'),
              prepare: () => Effect.die('this test prepares no graph'),
              writeThrough: () => Effect.die('this test projects no act'),
              syncRegistry: () => Effect.andThen(Queue.offer(attempted, undefined), Effect.fail(failure)),
              registrySynced: () => Effect.succeed(true),
              forgetRegistry: () => Effect.die('the failed refresh never forgets its registry'),
              travelMirror: () => Effect.die('this test moves no mirror'),
            }),
          ),
        );
        yield* Effect.acquireRelease(
          gate.register(root, {
            checkout: root,
            row,
            layout: { mode: 'team', treeRoot: root, mirrorPath: graph.store.path },
            shadow: null,
            poolContext: context,
            ledger: yield* treeLedger({ root, stealth: null }, projectId),
            batches: null,
            topology: null,
            scope: yield* Effect.scope,
          }),
          (held) => Effect.sync(held.unregister),
        );
        yield* Queue.take(attempted);
        expect(yield* Effect.flip(gate.beforeAct(root))).toMatchObject({ code: 'graph-pool', reason: `SqlError: ${first.message}` });
        failure = second;
        yield* TestClock.adjust(999);
        yield* gate.fresh(root);
        expect(yield* Effect.flip(gate.beforeAct(root))).toMatchObject({ code: 'graph-pool', reason: `SqlError: ${first.message}` });
        yield* TestClock.adjust(1);
        yield* Queue.take(attempted);
        expect(yield* Effect.flip(gate.beforeAct(root))).toMatchObject({ code: 'graph-pool', reason: `SqlError: ${second.message}` });
      }),
    ),
  );
});
